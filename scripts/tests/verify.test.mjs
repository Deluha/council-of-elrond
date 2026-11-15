// Tests for scripts/verify.mjs: selection, the pin read, the diff and conventions rules, the
// summary line, and the whole run with every command and git call injected.
// Run: node --test scripts/tests/

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import * as v from '../verify.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')
const MOD = 'mods/council-of-elrond'
const GATES = ['pinned-build', 'tests', 'typecheck', 'validate-plugin', 'no-tool-check', 'conventions']
const BASE = ['hygiene', 'guidance', 'ask-first']

const made = []
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})
const tmp = (prefix = 'verify-') => {
  const d = mkdtempSync(join(tmpdir(), prefix))
  made.push(d)
  return d
}
const put = (root, rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), text)
}

describe('selectChecks', () => {
  test('anything selects hygiene, guidance and the ask-first report', () => {
    assert.deepEqual(v.selectChecks([]), BASE)
    assert.deepEqual(v.selectChecks(['somewhere/else.txt']), BASE)
  })

  test('documents only select no gate and no test run', () => {
    const docs = ['README.md', 'CHANGELOG.md', 'docs/MAINTENANCE.md', `${MOD}/README.md`, `${MOD}/DESIGN.md`, `${MOD}/ROADMAP.md`, 'CLAUDE.md']
    assert.deepEqual(v.selectChecks(docs), BASE)
  })

  for (const path of [
    `${MOD}/hooks/strings.ts`,
    `${MOD}/hooks/elrond/view.ts`,
    `${MOD}/tests/state.test.ts`,
    `${MOD}/types/index.d.ts`,
    `${MOD}/.claude-plugin/plugin.json`,
    'mods/tsconfig.json',
    'mods/types/claude-code.d.ts',
  ]) {
    test(`mod code selects the gates: ${path}`, () => {
      const sel = v.selectChecks([path])
      for (const g of GATES) assert.ok(sel.includes(g), `${g} missing`)
      assert.ok(!sel.includes('scripts-tests'))
    })
  }

  test('the mod folder outside the code folders is a document', () => {
    assert.deepEqual(v.selectChecks([`${MOD}/SPEC.md`, 'mods/types/NOTICE.md'.replace('types/', '')]), BASE)
    assert.ok(v.selectChecks(['mods/types/NOTICE.md']).includes('tests'), 'mods/types/ is vendored-types territory')
  })

  test('the manifests select the marketplace validation', () => {
    assert.deepEqual(v.selectChecks(['.claude-plugin/marketplace.json']), [...BASE, 'validate-marketplace'])
    assert.ok(v.selectChecks([`${MOD}/.claude-plugin/plugin.json`]).includes('validate-marketplace'))
    assert.ok(!v.selectChecks([`${MOD}/hooks/strings.ts`]).includes('validate-marketplace'))
  })

  test('safety-sensitive code selects the sweep row', () => {
    for (const p of [`${MOD}/hooks/rules/shell.ts`, `${MOD}/hooks/rules/classify.ts`, `${MOD}/hooks/config/defaults.ts`, `${MOD}/hooks/redact.ts`, `${MOD}/hooks/members/gollum.ts`]) {
      assert.ok(v.selectChecks([p]).includes('sweep'), p)
    }
    for (const p of [`${MOD}/hooks/config/schema.ts`, `${MOD}/hooks/members/galadriel.ts`, `${MOD}/hooks/strings.ts`]) {
      assert.ok(!v.selectChecks([p]).includes('sweep'), p)
    }
  })

  test('the mutation row: classify.ts and operations.ts always, register.ts only for a hunk touching the gate', () => {
    assert.ok(v.selectChecks([`${MOD}/hooks/rules/classify.ts`]).includes('mutation'))
    assert.ok(v.selectChecks([`${MOD}/hooks/elrond/operations.ts`]).includes('mutation'))
    assert.ok(!v.selectChecks([`${MOD}/hooks/rules/shell.ts`]).includes('mutation'))
    const reg = `${MOD}/hooks/register.ts`
    for (const touched of ['+  return next(e)', '-  await proceed()', ' }).catch(async () => {', '+    deny: reason,']) {
      assert.ok(v.selectChecks([reg], { registerHunks: [`+  const a = 1\n${touched}`] }).includes('mutation'), touched)
    }
    assert.ok(!v.selectChecks([reg], { registerHunks: ['+  const label = text("a")\n+  return label'] }).includes('mutation'))
    assert.ok(!v.selectChecks([reg], { registerHunks: [] }).includes('mutation'))
  })

  test('register.ts changed with no hunks given selects the mutation row, the safer side', () => {
    assert.ok(v.selectChecks([`${MOD}/hooks/register.ts`]).includes('mutation'))
  })

  test('automation selects the script tests', () => {
    for (const p of ['scripts/verify.mjs', 'scripts/tests/verify.test.mjs', '.githooks/pre-commit', '.claude/rules/x.md', '.claude/settings.json', '.github/workflows/ci.yml']) {
      assert.ok(v.selectChecks([p]).includes('scripts-tests'), p)
    }
  })

  test('the result is in table order, without duplicates', () => {
    const sel = v.selectChecks([`${MOD}/hooks/rules/classify.ts`, `${MOD}/hooks/redact.ts`, 'scripts/x.sh', `${MOD}/tests/a.test.ts`])
    assert.deepEqual(sel, v.CHECKS.filter((c) => sel.includes(c)))
    assert.equal(new Set(sel).size, sel.length)
  })

  test('all selects every check', () => {
    assert.deepEqual(v.selectChecks([], { all: true }), v.CHECKS)
  })
})

describe('the pin', () => {
  const shellPin = (cwd) => {
    const r = spawnSync('bash', ['-c', `. "${repo}/scripts/pinned-claude.sh" && pinned_version`], { cwd, encoding: 'utf8' })
    return r.stdout.trim()
  }

  test('reads the same version as scripts/pinned-claude.sh, in the real workflow', () => {
    const text = readFileSync(join(repo, '.github/workflows/ci.yml'), 'utf8')
    assert.match(v.readPin(text), /^\d+\.\d+\.\d+$/)
    assert.equal(v.readPin(text), shellPin(repo))
  })

  test('and in odd workflows', () => {
    for (const ci of [
      'run: npm install -g @anthropic-ai/claude-code@2.1.322 typescript\n',
      'a: @anthropic-ai/claude-code@9.10.11\nb: @anthropic-ai/claude-code@1.0.0\n',
      'run: npm install -g @anthropic-ai/claude-code@latest\n',
      'run: nothing here\n',
    ]) {
      const dir = tmp('pin-')
      put(dir, '.github/workflows/ci.yml', ci)
      assert.equal(v.readPin(ci), shellPin(dir), ci)
    }
  })

  test('the same build test as check_pinned_claude', () => {
    const dir = tmp('pin-')
    put(dir, '.github/workflows/ci.yml', 'run: npm i @anthropic-ai/claude-code@2.1.322\n')
    for (const version of ['2.1.322 (Claude Code)', '2.1.322', '2.1.3220 (Claude Code)', '2.1.32', '2.1.325 (Claude Code)', '']) {
      const stub = join(dir, 'claude-stub')
      writeFileSync(stub, `#!/bin/sh\necho '${version}'\n`)
      chmodSync(stub, 0o755)
      const r = spawnSync('bash', ['-c', `. "${repo}/scripts/pinned-claude.sh" && check_pinned_claude >/dev/null`], { cwd: dir, env: { ...process.env, COUNCIL_CLAUDE: stub } })
      assert.equal(v.isPinned(version, '2.1.322'), r.status === 0, `version ${JSON.stringify(version)}`)
    }
    assert.equal(v.isPinned('2.1.322', ''), false)
  })
})

describe('parseDiff and hunkTouchesGate', () => {
  const diff = [
    'diff --git a/mods/x.ts b/mods/x.ts',
    '--- a/mods/x.ts',
    '+++ b/mods/x.ts',
    '@@ -1,3 +1,3 @@ function proceed(',
    ' keep',
    '-old line',
    '+new line',
    '@@ -20,2 +20,3 @@',
    ' ctx',
    '+  return next(e)',
    'diff --git a/mods/gone.ts b/mods/gone.ts',
    '--- a/mods/gone.ts',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-bye',
  ].join('\n')

  test('collects hunks, added and removed lines per file, including a deleted file', () => {
    const files = v.parseDiff(diff)
    const x = files.get('mods/x.ts')
    assert.equal(x.hunks.length, 2)
    assert.deepEqual(x.added, ['new line', '  return next(e)'])
    assert.deepEqual(x.removed, ['old line'])
    assert.deepEqual(files.get('mods/gone.ts').removed, ['bye'])
  })

  test('a hunk header is not hunk content', () => {
    const x = v.parseDiff(diff).get('mods/x.ts')
    assert.equal(v.hunkTouchesGate(x.hunks[0]), false)
    assert.equal(v.hunkTouchesGate(x.hunks[1]), true)
  })
})

describe('conventions', () => {
  const hooks = (name) => `${MOD}/hooks/${name}`
  const file = (added, removed = []) => ({ added, removed })
  const run = (files, extra = {}) =>
    v.checkConventions({ changed: [...Object.keys(files), `${MOD}/tests/a.test.ts`], files: new Map(Object.entries(files)), ...extra })

  test('a parameter or import named $ outside register.ts fails', () => {
    for (const line of ['export function f($: Kit) {', 'const f = ($, x) => 1', 'const g = (a, $) => a', 'const h = $ => 1', "import { $ } from 'claude-code'", "import { a as $ } from 'x'", 'const s = $.state.get()']) {
      assert.equal(run({ [hooks('elrond/x.ts')]: file([line]) }).fails.length, 1, line)
    }
  })

  test('register.ts may take $; comments, template strings and regexes may mention it', () => {
    assert.equal(run({ [hooks('register.ts')]: file(['function f($: Kit) {']) }).fails.length, 0)
    for (const line of ['// takes $ as a parameter ($, x)', ' * the $.state value', 'const re = /[.*+?^${}()|[\\]\\\\/]/g', 'const t = `${a}-${b}`', 'const p = pay$ment(a)']) {
      assert.equal(run({ [hooks('elrond/x.ts')]: file([line]) }).fails.length, 0, line)
    }
  })

  test('a new atom( call fails outside register.ts, and a net new one in it', () => {
    assert.equal(run({ [hooks('state.ts')]: file(["const a = atom({ key: 'x' }, 1)"]) }).fails.length, 1)
    assert.equal(run({ [hooks('register.ts')]: file(["const c = atom({ key: 'c' }, 1)"]) }).fails.length, 1)
    assert.equal(run({ [hooks('register.ts')]: file(["const session = atom({ key: 's' }, 2)"], ["const session = atom({ key: 's' }, 1)"]) }).fails.length, 0)
    assert.equal(run({ [hooks('register.ts')]: file(["import { atom, read } from 'claude-code'"]) }).fails.length, 0)
    assert.equal(run({ [hooks('state.ts')]: file(['// no atom( here']) }).fails.length, 0)
  })

  test('a hooks/ change with no tests/ change warns', () => {
    const only = v.checkConventions({ changed: [hooks('strings.ts')], files: new Map(), userConfigChanged: false })
    assert.equal(only.warns.filter((w) => /tests\//.test(w)).length, 1)
    const both = v.checkConventions({ changed: [hooks('strings.ts'), `${MOD}/tests/a.test.ts`, 'CHANGELOG.md'], files: new Map() })
    assert.deepEqual(both.warns, [])
  })

  test('strings.ts, commands.ts or a userConfig change with no README or CHANGELOG change warns', () => {
    const t = `${MOD}/tests/a.test.ts`
    for (const changed of [[hooks('strings.ts')], [hooks('elrond/commands.ts')]]) {
      assert.equal(v.checkConventions({ changed: [...changed, t], files: new Map() }).warns.length, 1)
      assert.equal(v.checkConventions({ changed: [...changed, t, `${MOD}/README.md`], files: new Map() }).warns.length, 0)
      assert.equal(v.checkConventions({ changed: [...changed, t, 'CHANGELOG.md'], files: new Map() }).warns.length, 0)
    }
    assert.equal(v.checkConventions({ changed: [`${MOD}/.claude-plugin/plugin.json`], files: new Map(), userConfigChanged: true }).warns.length, 1)
    assert.equal(v.checkConventions({ changed: [`${MOD}/.claude-plugin/plugin.json`], files: new Map(), userConfigChanged: false }).warns.length, 0)
  })

  test('warnings never fail', () => {
    const r = v.checkConventions({ changed: [hooks('strings.ts')], files: new Map() })
    assert.ok(r.warns.length > 0)
    assert.deepEqual(r.fails, [])
  })

  test('--all skips the changed-set rules but still reads the files', () => {
    const r = v.checkConventions({ changed: [], files: new Map([[hooks('x.ts'), file(['const f = ($) => 1'])], [hooks('register.ts'), file(["const a = atom({}, 1)"])]]), all: true })
    assert.equal(r.fails.length, 1)
    assert.deepEqual(r.warns, [])
  })
})

describe('summarize', () => {
  const row = (result, extra = {}) => ({ id: 'x', result, ...extra })

  test('a bare PASS only when nothing is outstanding', () => {
    assert.equal(v.summarize([row('PASS'), row('INFO')]), 'PASS')
  })

  test('manual checks, warnings, skips and files for the maintainer are named', () => {
    assert.equal(v.summarize([row('PASS'), row('MANUAL'), row('MANUAL'), row('WARN')]), 'PASS (2 manual checks outstanding, 1 warning)')
    assert.equal(v.summarize([row('MANUAL')]), 'PASS (1 manual check outstanding)')
    assert.match(v.summarize([row('SKIP')]), /^PASS \(1 skipped\)$/)
    assert.match(v.summarize([row('INFO', { attention: 3 })]), /^PASS \(3 changed files need the maintainer's eye\)$/)
  })

  test('a FAIL row is never a PASS, whatever else is there', () => {
    const others = ['PASS', 'WARN', 'MANUAL', 'SKIP', 'INFO', 'FAIL']
    for (const a of others) {
      for (const b of others) {
        const rows = [row(a), row(b), row('FAIL', { id: 'tests' })]
        assert.match(v.summarize(rows), /^FAIL/, `${a} ${b}`)
      }
    }
  })

  test('PASS (...) never appears bare when MANUAL or WARN rows exist', () => {
    for (const r of ['MANUAL', 'WARN']) assert.notEqual(v.summarize([row('PASS'), row(r)]), 'PASS')
  })
})

describe('the table', () => {
  test('no colour codes unless asked', () => {
    const rows = [{ id: 'tests', result: 'PASS', ms: 1500, note: '' }, { id: 'sweep', result: 'MANUAL', ms: 0, note: 'by hand' }]
    assert.ok(!v.renderTable(rows, false).includes('\u001b'))
    assert.ok(v.renderTable(rows, true).includes('\u001b['))
    assert.match(v.renderTable(rows, false), /tests\s+PASS\s+1\.5s/)
  })
})

describe('main, with every command injected', () => {
  /** A repository folder with what verify reads, and a recorder for the commands it runs. */
  function setup({ git, commands = {}, settings } = {}) {
    const root = tmp('main-')
    put(root, '.github/workflows/ci.yml', 'run: npm install -g @anthropic-ai/claude-code@2.1.322 typescript\n')
    if (settings) put(root, '.claude/settings.json', settings)
    const calls = []
    const out = []
    const run = (cmd, args) => {
      calls.push([cmd, ...args].join(' '))
      if (cmd === 'git') return git([cmd, ...args].join(' '), args)
      for (const [pattern, result] of Object.entries(commands)) if ([cmd, ...args].join(' ').includes(pattern)) return typeof result === 'function' ? result() : result
      if (args[0] === '--version') return ok('2.1.322 (Claude Code)\n')
      return ok('')
    }
    return { root, calls, out, deps: { root, run, write: (s) => out.push(s), isTTY: false }, text: () => out.join('') }
  }
  const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' })
  const bad = (stderr = 'boom') => ({ status: 1, stdout: '', stderr })
  const guidanceOk = ok(JSON.stringify({ findings: [] }))
  const env = { COUNCIL_CLAUDE: 'fake-claude' }

  /** git answers for the default mode: merge base on main, then the given changed and untracked files. */
  const gitDefault = (changed = [], untracked = [], diff = '') => (line, args) => {
    if (args[0] === 'rev-parse') return ok('true\n')
    if (args[0] === 'merge-base') return args[2] === 'origin/main' ? { status: 1, stdout: '', stderr: '' } : ok('abc123\n')
    if (args[0] === 'diff' && args.includes('--name-only')) return ok(changed.map((p) => `${p}\0`).join(''))
    if (args[0] === 'ls-files') return ok(untracked.map((p) => `${p}\0`).join(''))
    if (args[0] === 'diff') return ok(diff)
    return ok('')
  }

  test('a git failure is red: a git row, every check selected, non-zero exit even when every check passes', async () => {
    const s = setup({ git: () => ({ status: 128, stdout: '', stderr: 'fatal: not a git repository\n' }), commands: { 'check-guidance': guidanceOk } })
    const code = await v.main([], env, s.deps)
    assert.notEqual(code, 0)
    const text = s.text()
    assert.match(text, /git\s+FAIL/)
    for (const id of v.CHECKS) assert.match(text, new RegExp(`^${id}\\s`, 'm'), `${id} row`)
    assert.match(text, /verify: FAIL/)
  })

  test('git missing, or a failing merge-base, is red too', async () => {
    const missing = setup({ git: () => ({ status: null, stdout: '', stderr: '', error: Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }) }) })
    assert.notEqual(await v.main([], env, missing.deps), 0)
    assert.match(missing.text(), /git not found/)
    const noBase = setup({ git: (line, args) => (args[0] === 'rev-parse' ? ok('true\n') : { status: 1, stdout: '', stderr: 'fatal: Not a valid object name' }) })
    assert.notEqual(await v.main([], env, noBase.deps), 0)
    assert.match(noBase.text(), /no merge base/)
    assert.match(noBase.text(), /^tests\s/m)
  })

  test('--staged git failure is red as well', async () => {
    const s = setup({ git: () => bad('fatal: nope') })
    assert.notEqual(await v.main(['--staged'], env, s.deps), 0)
    assert.match(s.text(), /^git\s+FAIL/m)
  })

  test('a documents-only change runs hygiene and guidance and nothing else', async () => {
    const s = setup({ git: gitDefault(['README.md', `${MOD}/DESIGN.md`]), commands: { 'check-guidance': guidanceOk } })
    const code = await v.main([], env, s.deps)
    assert.equal(code, 0)
    const names = s.calls.filter((c) => !c.startsWith('git ')).map((c) => c.split(' ').slice(0, 2).join(' '))
    assert.deepEqual(names, ['bash scripts/check-hygiene.sh', 'node scripts/check-guidance.mjs'])
    assert.match(s.text(), /verify: PASS\n/)
  })

  test('untracked files count as changed', async () => {
    const s = setup({ git: gitDefault([], [`${MOD}/hooks/new.ts`]), commands: { 'check-guidance': guidanceOk } })
    await v.main([], env, s.deps)
    assert.match(s.text(), /^tests\s/m)
  })

  test('a mod change on the pinned build runs the gates; the summary names the warning', async () => {
    const s = setup({ git: gitDefault([`${MOD}/hooks/strings.ts`]), commands: { 'check-guidance': guidanceOk, 'plugin validate': ok('valid\n') } })
    const code = await v.main([], env, s.deps)
    assert.equal(code, 0)
    const text = s.text()
    for (const id of ['pinned-build', 'tests', 'typecheck', 'validate-plugin', 'no-tool-check']) assert.match(text, new RegExp(`^${id}\\s+PASS`, 'm'), id)
    assert.match(text, /conventions\s+WARN/)
    assert.match(text, /verify: PASS \(1 warning\)\n/)
    assert.ok(s.calls.includes('fake-claude plugin test mods/council-of-elrond'))
    assert.ok(s.calls.includes('tsc -p mods'))
    assert.ok(s.calls.includes('fake-claude plugin validate --strict mods/council-of-elrond'))
  })

  test('an unpinned build: the pin row fails and the rows that need it are skipped', async () => {
    const s = setup({ git: gitDefault([`${MOD}/hooks/strings.ts`, `${MOD}/tests/a.test.ts`]), commands: { '--version': ok('2.1.325 (Claude Code)\n'), 'check-guidance': guidanceOk } })
    const code = await v.main([], env, s.deps)
    assert.equal(code, 1)
    const text = s.text()
    assert.match(text, /pinned-build\s+FAIL/)
    for (const id of ['tests', 'validate-plugin', 'no-tool-check']) assert.match(text, new RegExp(`^${id}\\s+SKIP.*not the pinned build`, 'm'), id)
    assert.match(text, /^typecheck\s+PASS/m)
    assert.ok(!s.calls.some((c) => c.includes('plugin test')))
  })

  test('COUNCIL_ALLOW_UNPINNED=1 runs them and the pin row says so', async () => {
    const s = setup({ git: gitDefault([`${MOD}/hooks/strings.ts`, `${MOD}/tests/a.test.ts`, 'CHANGELOG.md']), commands: { '--version': ok('2.1.325 (Claude Code)\n'), 'check-guidance': guidanceOk } })
    const code = await v.main([], { ...env, COUNCIL_ALLOW_UNPINNED: '1' }, s.deps)
    assert.equal(code, 0)
    assert.match(s.text(), /pinned-build\s+WARN.*COUNCIL_ALLOW_UNPINNED=1/)
    assert.match(s.text(), /^tests\s+PASS/m)
    assert.match(s.text(), /verify: PASS \(1 warning\)/)
  })

  test('a tool.check in the validate output fails the no-tool-check row', async () => {
    const s = setup({ git: gitDefault([`${MOD}/hooks/strings.ts`, `${MOD}/tests/a.test.ts`, 'CHANGELOG.md']), commands: { 'plugin validate': ok('hook tool.check registered\n'), 'check-guidance': guidanceOk } })
    assert.equal(await v.main([], env, s.deps), 1)
    assert.match(s.text(), /no-tool-check\s+FAIL/)
  })

  test('a failing command is a FAIL row with its output; a command that cannot start is a FAIL, not a crash', async () => {
    const s = setup({
      git: gitDefault([`${MOD}/hooks/strings.ts`, `${MOD}/tests/a.test.ts`, 'CHANGELOG.md']),
      commands: {
        'plugin test': bad('1 test failed: expected a'),
        'tsc -p': { status: null, stdout: '', stderr: '', error: Object.assign(new Error('spawn tsc ENOENT'), { code: 'ENOENT' }) },
        'check-guidance': guidanceOk,
      },
    })
    assert.equal(await v.main([], env, s.deps), 1)
    const text = s.text()
    assert.match(text, /tests\s+FAIL.*1 test failed/)
    assert.match(text, /typecheck\s+FAIL.*could not run tsc: not found/)
    assert.match(text, /--- tests: output/)
  })

  test('a timeout is a FAIL that says so', async () => {
    const s = setup({ git: gitDefault([`${MOD}/hooks/strings.ts`, `${MOD}/tests/a.test.ts`, 'CHANGELOG.md']), commands: { 'plugin test': { status: null, stdout: '', stderr: '', error: Object.assign(new Error('x'), { code: 'ETIMEDOUT' }), timedOut: true }, 'check-guidance': guidanceOk } })
    assert.equal(await v.main([], env, s.deps), 1)
    assert.match(s.text(), /tests\s+FAIL.*timed out after 600s/)
  })

  test('the sweep and mutation rows are MANUAL and the summary says so', async () => {
    const s = setup({ git: gitDefault([`${MOD}/hooks/rules/classify.ts`, `${MOD}/tests/a.test.ts`]), commands: { 'check-guidance': guidanceOk } })
    assert.equal(await v.main([], env, s.deps), 0)
    assert.match(s.text(), /^sweep\s+MANUAL/m)
    assert.match(s.text(), /^mutation\s+MANUAL/m)
    assert.match(s.text(), /verify: PASS \(2 manual checks outstanding, /)
  })

  test('the guidance findings fail the row, with the first one in the note', async () => {
    const findings = [{ id: 'G1', file: 'CLAUDE.md', line: 3, message: 'pointer `x.md` does not resolve' }]
    const s = setup({ git: gitDefault(['README.md']), commands: { 'check-guidance': { status: 1, stdout: JSON.stringify({ findings }), stderr: '' } } })
    assert.equal(await v.main([], env, s.deps), 1)
    assert.match(s.text(), /guidance\s+FAIL.*1 finding; first: G1 CLAUDE\.md:3/)
    assert.match(s.text(), /G1 CLAUDE\.md:3 pointer/)
  })

  test('the ask-first report names the changed files that need the maintainer', async () => {
    const settings = JSON.stringify({ permissions: { ask: ['Edit(/scripts/**)', 'Edit(/SECURITY.md)'], deny: ['Edit(/x)'] } })
    const s = setup({ settings, git: gitDefault(['scripts/verify.mjs', 'README.md']), commands: { 'check-guidance': guidanceOk } })
    await v.main([], env, s.deps)
    assert.match(s.text(), /ask-first\s+INFO.*scripts\/verify\.mjs/)
    assert.doesNotMatch(s.text(), /ask-first.*README/)
    assert.match(s.text(), /verify: .*1 changed file needs the maintainer's eye/)
  })

  test('without a settings ask list the built-in list is used', () => {
    const patterns = v.askFirstPatterns(null)
    assert.deepEqual(v.askFirstMatches(['.github/workflows/ci.yml', 'README.md', `${MOD}/hooks/redact.ts`], patterns), ['.github/workflows/ci.yml', `${MOD}/hooks/redact.ts`])
    assert.equal(v.FALLBACK_ASK.length, 14)
  })

  test('--staged with nothing staged exits 0 without running anything', async () => {
    const s = setup({ git: (line, args) => (args[0] === 'rev-parse' ? ok('true\n') : ok('')) })
    assert.equal(await v.main(['--staged'], env, s.deps), 0)
    assert.deepEqual(s.calls.filter((c) => !c.startsWith('git ')), [])
  })

  test('--staged runs hygiene with --staged', async () => {
    const s = setup({ git: (line, args) => (args[0] === 'rev-parse' ? ok('true\n') : args.includes('--name-only') ? ok('README.md\0') : ok('')), commands: { 'check-guidance': guidanceOk } })
    assert.equal(await v.main(['--staged'], env, s.deps), 0)
    assert.ok(s.calls.includes('bash scripts/check-hygiene.sh --staged'))
  })

  test('--all runs every check and needs no git', async () => {
    const s = setup({ git: () => bad('no git'), commands: { 'check-guidance': guidanceOk } })
    await v.main(['--all'], env, s.deps)
    for (const id of v.CHECKS) assert.match(s.text(), new RegExp(`^${id}\\s`, 'm'), id)
    assert.doesNotMatch(s.text(), /^git\s/m)
    assert.ok(!s.calls.some((c) => c.startsWith('git ')))
  })

  test('--help exits 0 and an unknown option exits 2', async () => {
    const s = setup({ git: () => bad() })
    assert.equal(await v.main(['--help'], env, s.deps), 0)
    assert.match(s.text(), /usage/)
    const t = setup({ git: () => bad() })
    assert.equal(await v.main(['--nope'], env, t.deps), 2)
    assert.equal(await v.main(['--staged', '--all'], env, t.deps), 2)
  })
})

describe('main against a real git repository', () => {
  const git = (cwd, ...args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'me', GIT_AUTHOR_EMAIL: 'me@example.com', GIT_COMMITTER_NAME: 'me', GIT_COMMITTER_EMAIL: 'me@example.com', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } })
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
    return r.stdout
  }

  test('the change set is the merge base diff plus staged, unstaged and untracked files', async (t) => {
    if (spawnSync('git', ['--version']).status !== 0) return t.skip('git is not installed')
    const root = tmp('real-')
    put(root, '.github/workflows/ci.yml', 'run: npm i @anthropic-ai/claude-code@2.1.322\n')
    put(root, 'README.md', 'one\n')
    put(root, 'tracked.txt', 'one\n')
    git(root, 'init', '-q', '-b', 'main')
    git(root, 'add', '.')
    git(root, 'commit', '-q', '-m', 'first')
    git(root, 'switch', '-q', '-c', 'work')
    put(root, `${MOD}/hooks/committed.ts`, 'export const a = 1\n')
    git(root, 'add', '.')
    git(root, 'commit', '-q', '-m', 'second')
    put(root, 'README.md', 'two\n')
    put(root, 'scripts/untracked.sh', 'echo hi\n')
    const seen = []
    const run = (cmd, args, opts) => {
      if (cmd === 'git') return v.runCommand(cmd, args, { ...opts, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } })
      seen.push([cmd, ...args].join(' '))
      return args[0] === '--version' ? { status: 0, stdout: '2.1.322 (Claude Code)\n', stderr: '' } : { status: 0, stdout: JSON.stringify({ findings: [] }), stderr: '' }
    }
    const out = []
    const code = await v.main([], { COUNCIL_CLAUDE: 'fake' }, { root, run, write: (s) => out.push(s), isTTY: false })
    const text = out.join('')
    assert.equal(code, 0, text)
    assert.match(text, /^tests\s+PASS/m, 'the committed mod change since the merge base selects the gates')
    assert.match(text, /^scripts-tests\s+PASS/m, 'an untracked script selects the script tests')
    assert.match(text, /^conventions\s+WARN/m, 'hooks changed with no tests')
    assert.ok(seen.includes('fake plugin test mods/council-of-elrond'))
  })

  test('outside a repository the run is red', async () => {
    const root = tmp('norepo-')
    put(root, '.github/workflows/ci.yml', 'run: npm i @anthropic-ai/claude-code@2.1.322\n')
    const out = []
    const run = (cmd, args, opts) =>
      cmd === 'git'
        ? v.runCommand(cmd, args, { ...opts, env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(root) } })
        : args[0] === '--version'
          ? { status: 0, stdout: '2.1.322\n', stderr: '' }
          : { status: 0, stdout: JSON.stringify({ findings: [] }), stderr: '' }
    const code = await v.main([], { COUNCIL_CLAUDE: 'fake' }, { root, run, write: (s) => out.push(s), isTTY: false })
    assert.notEqual(code, 0)
    assert.match(out.join(''), /^git\s+FAIL/m)
  })
})
