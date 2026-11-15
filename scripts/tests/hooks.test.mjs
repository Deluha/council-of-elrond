// Tests for scripts/hooks/lint-edited.mjs and scripts/hooks/session-start.sh. Offline; every file
// is created in a temporary folder and the repository is not touched.
// Run: node --test scripts/tests/

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { editorconfigFindings, filePathOf } from '../hooks/lint-edited.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')
const LINT = join(repo, 'scripts', 'hooks', 'lint-edited.mjs')
const START = join(repo, 'scripts', 'hooks', 'session-start.sh')

const made = []
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})
const tmp = (prefix) => {
  const d = mkdtempSync(join(tmpdir(), prefix))
  made.push(d)
  return d
}
const put = (root, rel, text, mode) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), text)
  if (mode) chmodSync(join(root, rel), mode)
  return join(root, rel)
}

describe('lint-edited.mjs', () => {
  const lint = (input, options = {}) => {
    const r = spawnSync(process.execPath, [LINT], { input, encoding: 'utf8', timeout: 30_000, ...options })
    return { status: r.status, stdout: r.stdout, stderr: r.stderr }
  }
  const forFile = (file, extra = {}) => JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: file }, ...extra })
  const context = (r) => JSON.parse(r.stdout).hookSpecificOutput

  test('malformed, empty and unrelated input is silence and exit 0', () => {
    for (const input of ['', '   \n', 'not json', '{', '[]', 'null', '42', '"x"', '{}', '{"tool_input":{}}', '{"tool_input":{"file_path":42}}', '{"tool_input":"x"}']) {
      const r = lint(input)
      assert.equal(r.status, 0, JSON.stringify(input))
      assert.equal(r.stdout, '', JSON.stringify(input))
    }
  })

  test('a missing file, a folder and a deleted file are silence and exit 0', () => {
    const dir = tmp('lint-')
    assert.deepEqual(lint(forFile(join(dir, 'nope.ts'))), { status: 0, stdout: '', stderr: '' })
    assert.equal(lint(forFile(dir)).stdout, '')
    const file = put(dir, 'gone.mjs', 'const a = ;\n')
    rmSync(file)
    const r = lint(forFile(file))
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '')
  })

  test('a binary file, an unknown extension and a huge file are silence', () => {
    const dir = tmp('lint-')
    const bin = join(dir, 'image.ts')
    writeFileSync(bin, Buffer.from([0x89, 0x50, 0, 0, 0xff, 0x0d, 0x0a, 0x1a, 0x0a]))
    assert.equal(lint(forFile(bin)).stdout, '')
    put(dir, 'data.bin', 'a  \r\n\t')
    assert.equal(lint(forFile(join(dir, 'data.bin'))).stdout, '')
    const big = put(dir, 'big.md', `${'x\n'.repeat(700_000)}tail  `)
    assert.equal(lint(forFile(big)).stdout, '')
  })

  test('a syntax error is reported, and the exit is still 0', () => {
    const dir = tmp('lint-')
    for (const [name, text] of [['bad.mjs', 'const x = ;\n'], ['bad.js', 'if (\n'], ['bad.ts', 'export const = 1\n'], ['bad.json', '{"a":}\n'], ['bad.sh', 'if [ 1 ]; then\n']]) {
      const r = lint(forFile(put(dir, name, text)))
      assert.equal(r.status, 0, name)
      const out = context(r)
      assert.equal(out.hookEventName, 'PostToolUse')
      assert.match(out.additionalContext, new RegExp(name.replace('.', '\\.')))
      assert.match(out.additionalContext, /syntax error|not valid JSON/, name)
    }
  })

  test('a .ts file with an enum is reported: strip-only mode cannot run it', () => {
    const dir = tmp('lint-')
    const r = lint(forFile(put(dir, 'e.ts', 'export enum A { B }\n')))
    assert.match(context(r).additionalContext, /syntax error/)
  })

  test('a clean file is silence and exit 0', () => {
    const dir = tmp('lint-')
    for (const [name, text] of [['ok.mjs', 'export const a = 1\n'], ['ok.ts', 'export const a: number = 1\n'], ['ok.json', '{"a": 1}\n'], ['ok.sh', 'echo hi\n'], ['ok.md', '# Title\n\nText with a trailing pair of spaces  \n']]) {
      const r = lint(forFile(put(dir, name, text)))
      assert.deepEqual(r, { status: 0, stdout: '', stderr: '' }, name)
    }
  })

  test('the .editorconfig rules are reported', () => {
    const dir = tmp('lint-')
    const cases = [
      ['crlf.ts', 'export const a = 1\r\n', /CRLF/],
      ['nofinal.md', 'no newline at the end', /no final newline/],
      ['tab.ts', 'export const a = {\n\tb: 1,\n}\n', /tab/],
      ['trail.ts', 'export const a = 1 \n', /trailing whitespace/],
    ]
    for (const [name, text, re] of cases) {
      const r = lint(forFile(put(dir, name, text)))
      assert.equal(r.status, 0)
      assert.match(context(r).additionalContext, re, name)
    }
  })

  test('the path may come from other documented spellings, and a relative one from cwd', () => {
    const dir = tmp('lint-')
    put(dir, 'sub/bad.mjs', 'const x = ;\n')
    const a = lint(JSON.stringify({ cwd: dir, tool_input: { file_path: 'sub/bad.mjs' } }))
    assert.match(context(a).additionalContext, /syntax error/)
    const b = lint(JSON.stringify({ tool_response: { filePath: join(dir, 'sub/bad.mjs') } }))
    assert.match(context(b).additionalContext, /syntax error/)
    assert.equal(filePathOf({ tool_input: { path: '/x' } }), '/x')
    assert.equal(filePathOf(null), null)
  })

  test('a type error in a .ts under mods/ is reported for that file only, when tsc is available', (t) => {
    if (spawnSync('tsc', ['--version']).status !== 0) return t.skip('tsc is not installed')
    const root = tmp('lint-proj-')
    mkdirSync(join(root, '.git'))
    put(root, 'mods/tsconfig.json', readFileSync(join(repo, 'mods/tsconfig.json'), 'utf8'))
    put(root, 'mods/types/claude-code.d.ts', 'export {}\n')
    put(root, 'mods/council-of-elrond/types/index.d.ts', 'export {}\n')
    const bad = put(root, 'mods/council-of-elrond/hooks/a.ts', "import { b } from './b.js'\nexport const a: number = 'x'\nexport const c = b\n")
    put(root, 'mods/council-of-elrond/hooks/b.ts', "export const b: string = 1\n")
    const r = lint(forFile(bad))
    assert.equal(r.status, 0)
    const text = context(r).additionalContext
    assert.match(text, /this file and its imports only/)
    assert.match(text, /hooks\/a\.ts:2 error TS2322/)
    assert.doesNotMatch(text, /hooks\/b\.ts:1/)
    assert.match(text, /1 more in its imports/)
    const clean = put(root, 'mods/council-of-elrond/hooks/c.ts', 'export const c: number = 1\n')
    assert.equal(lint(forFile(clean)).stdout, '')
  })

  test('the editorconfig function: markdown may end a line with spaces; .d.ts and LF files are fine', () => {
    assert.deepEqual(editorconfigFindings('a  \nb\n', '.md'), [])
    assert.equal(editorconfigFindings('a  \nb\n', '.ts').length, 1)
    assert.deepEqual(editorconfigFindings('', '.ts'), [])
    assert.deepEqual(editorconfigFindings('a\n  b\n', '.ts'), [])
  })
})

describe('session-start.sh', () => {
  const PIN = '2.1.322'

  /** A project folder (a git repository with the CI pin and a .githooks folder), a home, and a folder of stub tools. */
  function setup({ npmFails = false } = {}) {
    const base = tmp('session-')
    const project = join(base, 'project')
    const home = join(base, 'home')
    const stubs = join(base, 'stubs')
    const log = join(base, 'npm.log')
    mkdirSync(home, { recursive: true })
    put(project, '.github/workflows/ci.yml', `run: npm install -g @anthropic-ai/claude-code@${PIN} typescript\n`)
    put(project, '.githooks/pre-commit', '#!/bin/sh\n')
    const git = (...args) => spawnSync('git', args, { cwd: project, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } })
    git('init', '-q')
    git('add', '.')
    git('-c', 'user.name=me', '-c', 'user.email=me@example.com', 'commit', '-q', '-m', 'fixture')
    // npm: logs its arguments and creates what the real one would.
    put(stubs, 'npm', `#!/bin/sh
echo "$*" >> "${log}"
${npmFails ? 'echo "npm ERR! offline" >&2; exit 1' : ''}
prefix=""
while [ $# -gt 0 ]; do
  case "$1" in
    --prefix) prefix=$2; shift ;;
    @anthropic-ai/claude-code@*) pkg=claude; ver=\${1#*@anthropic-ai/claude-code@} ;;
    typescript) pkg=tsc ;;
  esac
  shift
done
mkdir -p "$prefix/node_modules/.bin"
if [ "$pkg" = claude ]; then
  printf '#!/bin/sh\\necho "%s (Claude Code)"\\n' "$ver" > "$prefix/node_modules/.bin/claude"
  chmod +x "$prefix/node_modules/.bin/claude"
else
  printf '#!/bin/sh\\necho "Version 6.0.0"\\n' > "$prefix/node_modules/.bin/tsc"
  chmod +x "$prefix/node_modules/.bin/tsc"
fi
`, 0o755)
    // claude: `plugin list` says what STUB_PLUGINS says.
    put(stubs, 'claude', '#!/bin/sh\n[ "$1 $2" = "plugin list" ] && echo "$STUB_PLUGINS"\nexit 0\n', 0o755)
    const env = (extra = {}) => ({
      PATH: `${stubs}:/usr/bin:/bin`,
      HOME: home,
      CLAUDE_PROJECT_DIR: project,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      ...extra,
    })
    const run = (extra) => {
      const r = spawnSync('bash', [START], { env: env(extra), encoding: 'utf8', timeout: 60_000 })
      return { status: r.status, stdout: r.stdout, stderr: r.stderr }
    }
    const installs = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [])
    const hooksPath = () => git('config', '--get', 'core.hooksPath').stdout.trim()
    const status = () => git('status', '--porcelain').stdout
    const tscPresent = spawnSync('bash', ['-c', 'command -v tsc'], { env: { PATH: '/usr/bin:/bin' } }).status === 0
    return { base, project, home, run, installs, hooksPath, status, git, tscPresent }
  }

  test('outside a cloud session it does nothing', () => {
    const s = setup()
    for (const extra of [{}, { CLAUDE_CODE_REMOTE: 'false' }, { CLAUDE_CODE_REMOTE: '1' }]) {
      const r = s.run(extra)
      assert.deepEqual(r, { status: 0, stdout: '', stderr: '' })
    }
    assert.deepEqual(s.installs(), [])
    assert.equal(s.hooksPath(), '')
  })

  test('the opt-out does nothing', () => {
    const s = setup()
    const r = s.run({ CLAUDE_CODE_REMOTE: 'true', COUNCIL_SKIP_SESSION_SETUP: '1' })
    assert.deepEqual(r, { status: 0, stdout: '', stderr: '' })
    assert.deepEqual(s.installs(), [])
    assert.equal(s.hooksPath(), '')
  })

  test('the first run installs the pinned build and typescript outside the repository; the second run installs nothing', () => {
    const s = setup()
    const envFile = join(s.base, 'envfile')
    writeFileSync(envFile, '')
    const first = s.run({ CLAUDE_CODE_REMOTE: 'true', CLAUDE_ENV_FILE: envFile })
    assert.equal(first.status, 0)
    const cache = join(s.home, '.cache', 'council-of-elrond')
    const installs = s.installs()
    assert.ok(installs.some((l) => l.includes(`--prefix ${cache}/claude-${PIN}`) && l.includes(`@anthropic-ai/claude-code@${PIN}`)), installs.join('\n'))
    if (!s.tscPresent) assert.ok(installs.some((l) => l.includes('typescript')), installs.join('\n'))
    assert.match(first.stdout, new RegExp(`COUNCIL_CLAUDE=${cache}/claude-${PIN}/node_modules/\\.bin/claude`))
    assert.match(readFileSync(envFile, 'utf8'), /^export COUNCIL_CLAUDE=.*claude-2\.1\.322.*\.bin\/claude$/m)
    assert.equal(s.hooksPath(), '.githooks')
    assert.equal(s.status(), '', 'the project is untouched')

    const before = s.installs().length
    const second = s.run({ CLAUDE_CODE_REMOTE: 'true', CLAUDE_ENV_FILE: envFile })
    assert.equal(second.status, 0)
    assert.equal(s.installs().length, before, 'nothing was installed again')
    assert.match(second.stdout, /COUNCIL_CLAUDE=/)
    assert.equal(s.status(), '')
  })

  test('a cache holding another version is replaced', () => {
    const s = setup()
    const bin = put(join(s.home, '.cache/council-of-elrond'), `claude-${PIN}/node_modules/.bin/claude`, '#!/bin/sh\necho "2.0.1 (Claude Code)"\n', 0o755)
    assert.ok(existsSync(bin))
    s.run({ CLAUDE_CODE_REMOTE: 'true' })
    assert.ok(s.installs().some((l) => l.includes(`@anthropic-ai/claude-code@${PIN}`)))
  })

  test('it leaves an existing core.hooksPath alone', () => {
    const s = setup()
    s.git('config', 'core.hooksPath', '.other')
    s.run({ CLAUDE_CODE_REMOTE: 'true' })
    assert.equal(s.hooksPath(), '.other')
  })

  test('it warns when the plugin is installed in the session', () => {
    const s = setup()
    const quiet = s.run({ CLAUDE_CODE_REMOTE: 'true', STUB_PLUGINS: 'other-plugin' })
    assert.doesNotMatch(quiet.stdout, /WARNING/)
    const loud = s.run({ CLAUDE_CODE_REMOTE: 'true', STUB_PLUGINS: 'council-of-elrond  1.0.0' })
    assert.equal(loud.status, 0)
    assert.match(loud.stdout, /WARNING: the council-of-elrond plugin is installed/)
  })

  test('a failing install prints a line and still exits 0', () => {
    const s = setup({ npmFails: true })
    const r = s.run({ CLAUDE_CODE_REMOTE: 'true' })
    assert.equal(r.status, 0)
    assert.match(r.stdout, /installing @anthropic-ai\/claude-code@2\.1\.322 failed/)
    assert.doesNotMatch(r.stdout, /COUNCIL_CLAUDE=/)
    assert.equal(s.status(), '')
  })

  test('no workflow file, no npm and an unreadable pin all exit 0', () => {
    const s = setup()
    rmSync(join(s.project, '.github'), { recursive: true })
    const r = s.run({ CLAUDE_CODE_REMOTE: 'true' })
    assert.equal(r.status, 0)
    assert.match(r.stdout, /nothing to set up/)
    put(s.project, '.github/workflows/ci.yml', 'run: nothing\n')
    const r2 = s.run({ CLAUDE_CODE_REMOTE: 'true' })
    assert.equal(r2.status, 0)
    assert.match(r2.stdout, /could not read the pinned/)
    put(s.project, '.github/workflows/ci.yml', `run: @anthropic-ai/claude-code@${PIN}\n`)
    const noNpm = spawnSync('bash', [START], { env: { PATH: '/usr/bin:/bin', HOME: s.home, CLAUDE_PROJECT_DIR: s.project, CLAUDE_CODE_REMOTE: 'true', GIT_CONFIG_GLOBAL: '/dev/null' }, encoding: 'utf8' })
    assert.equal(noNpm.status, 0)
  })

  test('the script itself parses', () => {
    assert.equal(spawnSync('bash', ['-n', START]).status, 0)
  })
})
