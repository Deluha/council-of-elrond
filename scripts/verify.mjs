#!/usr/bin/env node
// One command that runs the checks the current change needs, the way CI runs them.
//
//   node scripts/verify.mjs            the current change: files differing from the merge base with
//                                      origin/main (else main), plus staged, unstaged and untracked
//   node scripts/verify.mjs --staged   what the pre-commit hook checks: the staged files
//   node scripts/verify.mjs --all      every check
//   node scripts/verify.mjs --help
//
// Prints one table (check, result, time, note) and one summary line. Exit 0 only when no row is FAIL.
// Results: PASS, FAIL, WARN (counted, never fails), SKIP (with the reason), MANUAL (a check no
// tool does yet; the row says what to do), INFO. A SKIP is acceptable only for a reason that is not
// a missing prerequisite. A missing prerequisite of a GATE (the pinned build, or the binary a gate
// runs) is a SKIP marked `missing`, and the run then fails: the summary says FAIL and the exit status
// is 1. The one optional part is hygiene's link check, which needs python3: without it the hygiene
// row is a WARN (a contributor need not have python3; CI always runs the link check).
//
// Environment: COUNCIL_CLAUDE (the Claude Code binary, default "claude"); COUNCIL_ALLOW_UNPINNED=1
// (run on a build other than CI's pin; the pinned-build row then says WARN).
//
// Git variables. Git exports GIT_DIR, GIT_INDEX_FILE and GIT_WORK_TREE to the pre-commit hook. verify
// keeps them for its own git calls (`git diff --cached` must read the index being committed) and for
// hygiene, which reads the staged files; it strips every GIT_* variable from the child processes
// that run tests (`node --test scripts/tests/` and the plugin test run), which build their own
// repositories and must not act on the real one.
//
// A git failure is red: if the change set cannot be computed, the table gets a `git` row marked
// FAIL, every check is selected and the exit status is non-zero whatever the checks say.
//
// No dependency; Node 22. The selection, the pin read, the conventions check and the summary are
// pure exported functions, tested in scripts/tests/verify.test.mjs.

import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { patternToRegExp } from './check-guidance.mjs'

const MOD = 'mods/council-of-elrond'

/** Every check id, in the order the table prints them. */
export const CHECKS = [
  'hygiene',
  'guidance',
  'ask-first',
  'pinned-build',
  'tests',
  'typecheck',
  'validate-plugin',
  'no-tool-check',
  'conventions',
  'validate-marketplace',
  'sweep',
  'mutation',
  'scripts-tests',
]

/** The ask-first paths when .claude/settings.json has no permissions.ask list. */
export const FALLBACK_ASK = [
  '/mods/council-of-elrond/hooks/rules/**',
  '/mods/council-of-elrond/hooks/config/defaults.ts',
  '/mods/council-of-elrond/hooks/config/trust.ts',
  '/mods/council-of-elrond/hooks/config/schema.ts',
  '/mods/council-of-elrond/hooks/redact.ts',
  '/mods/council-of-elrond/hooks/members/gollum.ts',
  '/mods/council-of-elrond/.claude-plugin/plugin.json',
  '/.claude-plugin/marketplace.json',
  '/.github/**',
  '/.githooks/**',
  '/scripts/**',
  '/SECURITY.md',
  '/LICENSE',
  '/.claude/settings.json',
]

// ---------------------------------------------------------------------------------------------
// Selection

const MOD_CODE = new RegExp(`^(?:${MOD}/(?:hooks|tests|types|\\.claude-plugin)/|mods/tsconfig\\.json$|mods/types/)`)
const MANIFEST = /(?:^|\/)\.claude-plugin\/(?:marketplace|plugin)\.json$/
const SWEEP = new RegExp(`^${MOD}/hooks/(?:rules/|config/defaults\\.ts$|redact\\.ts$|members/gollum\\.ts$)`)
const MUTATION_FILES = [`${MOD}/hooks/rules/classify.ts`, `${MOD}/hooks/elrond/operations.ts`]
const REGISTER = `${MOD}/hooks/register.ts`
const AUTOMATION = /^(?:scripts|\.githooks|\.claude|\.github)\//
const MUTATION_TOKENS = /\bnext\(|\.catch\(|\bproceed\(|\bdeny:/

const GATES = ['pinned-build', 'tests', 'typecheck', 'validate-plugin', 'no-tool-check', 'conventions']
/** The rows that run the Claude Code binary, so they need the pinned build (and the pinned-build row). */
const NEEDS_PIN = ['tests', 'validate-plugin', 'no-tool-check', 'validate-marketplace']
/** A change to a workflow may move the pin: the gates then run on another build. */
const WORKFLOW = /^\.github\/workflows\/(?:ci|release)\.yml$/

/**
 * The check ids a change needs, in table order.
 *
 * `paths` are repository-relative. `ctx.registerHunks` is the text of each diff hunk of
 * hooks/register.ts (its lines with their +, - or space prefix); when register.ts changed and the
 * hunks are not given, the mutation row is selected, the safer side. `ctx.all` selects everything.
 */
export function selectChecks(paths, ctx = {}) {
  if (ctx.all) return [...CHECKS]
  const sel = new Set(['hygiene', 'guidance', 'ask-first'])
  for (const raw of paths) {
    const p = raw.replace(/^\.\//, '')
    if (MOD_CODE.test(p)) for (const g of GATES) sel.add(g)
    if (MANIFEST.test(p)) sel.add('validate-marketplace')
    if (WORKFLOW.test(p)) for (const c of [...GATES, 'validate-marketplace']) sel.add(c)
    if (SWEEP.test(p)) sel.add('sweep')
    if (MUTATION_FILES.includes(p)) sel.add('mutation')
    if (p === REGISTER && (ctx.registerHunks === undefined || ctx.registerHunks.some((h) => hunkTouchesGate(h)))) sel.add('mutation')
    if (AUTOMATION.test(p)) sel.add('scripts-tests')
  }
  if (NEEDS_PIN.some((c) => sel.has(c))) sel.add('pinned-build')
  return CHECKS.filter((c) => sel.has(c))
}

/** Whether a hunk (its lines, prefixed + - or space) touches next(, .catch(, proceed( or deny:. */
export function hunkTouchesGate(hunk) {
  return hunk
    .split('\n')
    .filter((l) => /^[ +-]/.test(l) && !l.startsWith('+++') && !l.startsWith('---'))
    .some((l) => MUTATION_TOKENS.test(l.slice(1)))
}

// ---------------------------------------------------------------------------------------------
// The pin (the same read as scripts/pinned-claude.sh)

/** The Claude Code version CI installs: the first @anthropic-ai/claude-code@X.Y.Z in the workflow. */
export function readPin(ciText) {
  const m = /@anthropic-ai\/claude-code@[0-9][0-9.]*/.exec(ciText)
  return m ? m[0].replace(/.*@/, '') : ''
}

/** Whether a `--version` output is the pinned build: the pin alone or the pin and a space, on the first line. */
export function isPinned(versionOutput, pin) {
  const have = (versionOutput ?? '').split('\n')[0] ?? ''
  return pin !== '' && (have === pin || have.startsWith(`${pin} `))
}

// ---------------------------------------------------------------------------------------------
// The diff

/** Parse a unified diff into { path, hunks: [text], added: [line], removed: [line] } per file. */
export function parseDiff(text) {
  const files = new Map()
  let cur = null
  let hunk = null
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      cur = null
      hunk = null
      continue
    }
    if (line.startsWith('+++ ')) {
      const p = line.slice(4)
      if (p !== '/dev/null') cur = register(files, p.replace(/^b\//, ''))
      continue
    }
    if (line.startsWith('--- ')) {
      const p = line.slice(4)
      if (p !== '/dev/null') cur = register(files, p.replace(/^a\//, ''))
      continue
    }
    if (!cur) continue
    if (line.startsWith('@@')) {
      hunk = []
      cur.hunks.push(hunk)
      continue
    }
    if (!hunk) continue
    if (line.startsWith('+')) cur.added.push(line.slice(1))
    else if (line.startsWith('-')) cur.removed.push(line.slice(1))
    if (/^[ +-]/.test(line)) hunk.push(line)
  }
  for (const f of files.values()) f.hunks = f.hunks.map((h) => h.join('\n'))
  return files
}

function register(files, path) {
  let f = files.get(path)
  if (!f) files.set(path, (f = { path, hunks: [], added: [], removed: [] }))
  return f
}

// ---------------------------------------------------------------------------------------------
// Conventions (mechanical; the changed files only)

const isComment = (l) => /^\s*(?:\/\/|\/\*|\*)/.test(l)
const stripTrailingComment = (l) => l.replace(/\s\/\/.*$/, '')
const DOLLAR_PARAM = /[(,]\s*\$\s*(?:[:,)=?]|\s*=>)|(?:^|[^\w$.])\$\s*=>/
const DOLLAR_IMPORT = /^\s*import\b[^;]*(?:[\s{,]\$[\s,}]|\bas\s+\$\b)|^\s*import\s+\$\s+from/
const DOLLAR_USE = /(?<![\w$.'"`])\$\.[A-Za-z_]/
const ATOM_CALL = /\batom\s*\(/

/**
 * The mechanical items of the pre-check, over the changed files.
 *
 * `changed` are the changed paths; `files` maps a path to { added, removed } lines (a new file's
 * whole text is `added`). `userConfigChanged` says whether plugin.json's userConfig changed.
 * `all` skips the changed-set rules (the warnings, and the atom count in register.ts).
 * Returns { fails: [text], warns: [text] }.
 */
export function checkConventions({ changed, files, userConfigChanged = false, all = false }) {
  const fails = []
  const warns = []
  for (const [path, f] of files) {
    if (!path.startsWith(`${MOD}/hooks/`) || !path.endsWith('.ts')) continue
    const code = f.added.map(stripTrailingComment).filter((l) => !isComment(l))
    if (path !== REGISTER) {
      if (code.some((l) => DOLLAR_PARAM.test(l) || DOLLAR_IMPORT.test(l) || DOLLAR_USE.test(l))) {
        fails.push(`${path}: takes or imports $; only hooks/register.ts does`)
      }
      if (code.some((l) => ATOM_CALL.test(l))) fails.push(`${path}: calls atom(; the session is one $.state value, changed only through hooks/state.ts`)
    } else if (!all) {
      const net = code.filter((l) => ATOM_CALL.test(l)).length - f.removed.map(stripTrailingComment).filter((l) => !isComment(l) && ATOM_CALL.test(l)).length
      if (net > 0) fails.push(`${path}: adds an atom( call; the session is one $.state value, changed only through hooks/state.ts`)
    }
  }
  if (!all) {
    const hooksChanged = changed.some((p) => p.startsWith(`${MOD}/hooks/`))
    if (hooksChanged && !changed.some((p) => p.startsWith(`${MOD}/tests/`))) warns.push('hooks/ changed with no change under tests/')
    const needsDocs =
      changed.includes(`${MOD}/hooks/strings.ts`) || changed.includes(`${MOD}/hooks/elrond/commands.ts`) || userConfigChanged
    const docsChanged = changed.some((p) => p === `${MOD}/README.md` || p === 'CHANGELOG.md' || p === `${MOD}/CHANGELOG.md`)
    if (needsDocs && !docsChanged) warns.push('strings.ts, commands.ts or userConfig changed with no change to the mod README.md or CHANGELOG.md')
  }
  return { fails, warns }
}

// ---------------------------------------------------------------------------------------------
// Ask-first

/** The ask-first path patterns: permissions.ask Edit(...) entries of settings.json, else the fallback list. */
export function askFirstPatterns(settingsText) {
  let entries = null
  try {
    const ask = JSON.parse(settingsText ?? '')?.permissions?.ask
    if (Array.isArray(ask)) entries = ask
  } catch {
    // fall back
  }
  const list = entries ?? FALLBACK_ASK.map((p) => `Edit(${p})`)
  const out = []
  for (const e of list) {
    const m = /^(?:Edit|Write|MultiEdit|NotebookEdit)\((.*)\)$/.exec(String(e))
    if (m) out.push((m[1] ?? '').replace(/^\/+/, '').replace(/\/$/, '/**'))
  }
  return out
}

export function askFirstMatches(changed, patterns) {
  const res = patterns.map((p) => patternToRegExp(p))
  return changed.filter((c) => res.some((re) => re.test(c)))
}

// ---------------------------------------------------------------------------------------------
// Summary and table

/** A copy of an environment without any GIT_* variable (see "Git variables" at the top). */
export function withoutGitEnv(env) {
  return Object.fromEntries(Object.entries(env ?? {}).filter(([key]) => !key.startsWith('GIT_')))
}

/** A row that fails the run: FAIL, or a SKIP that is a missing prerequisite (the pinned build, a binary). */
export const isFailing = (row) => row.result === 'FAIL' || (row.result === 'SKIP' && row.missing === true)

/** The one summary line: never PASS with a FAIL row, never a bare PASS with anything outstanding. */
export function summarize(rows) {
  const count = (r) => rows.filter((x) => x.result === r).length
  const failing = rows.filter(isFailing)
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
  if (failing.length > 0) return `FAIL (${failing.map((x) => x.id).join(', ')})`
  const extras = []
  const manual = count('MANUAL')
  const warn = count('WARN')
  const skip = count('SKIP')
  const eyes = rows.reduce((n, r) => n + (r.attention ?? 0), 0)
  if (manual) extras.push(`${plural(manual, 'manual check', 'manual checks')} outstanding`)
  if (warn) extras.push(plural(warn, 'warning', 'warnings'))
  if (skip) extras.push(`${skip} skipped`)
  if (eyes) extras.push(`${plural(eyes, 'changed file needs', 'changed files need')} the maintainer's eye`)
  return extras.length ? `PASS (${extras.join(', ')})` : 'PASS'
}

const COLOURS = { PASS: 32, FAIL: 31, WARN: 33, SKIP: 36, MANUAL: 35, INFO: 34 }

export function renderTable(rows, colour = false) {
  const idW = Math.max(5, ...rows.map((r) => r.id.length))
  const resW = Math.max(6, ...rows.map((r) => r.result.length))
  const lines = [`${'check'.padEnd(idW)}  ${'result'.padEnd(resW)}  ${'time'.padStart(7)}  note`]
  for (const r of rows) {
    const res = r.result.padEnd(resW)
    const shown = colour && COLOURS[r.result] ? `\u001b[${COLOURS[r.result]}m${res}\u001b[0m` : res
    const time = r.ms === undefined ? '' : `${(r.ms / 1000).toFixed(1)}s`
    lines.push(`${r.id.padEnd(idW)}  ${shown}  ${time.padStart(7)}  ${r.note ?? ''}`)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------------------------
// Running things

/** Run a command; never throws. Returns { status, stdout, stderr, error, timedOut }. */
export function runCommand(cmd, args, { cwd, timeout = 120_000, env } = {}) {
  try {
    const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error, timedOut: r.error?.code === 'ETIMEDOUT' }
  } catch (error) {
    return { status: null, stdout: '', stderr: '', error, timedOut: false }
  }
}

const tailOf = (r, n = 40) => `${r.stdout}${r.stderr}`.trimEnd().split('\n').slice(-n).join('\n')
const lastLine = (r) => {
  const lines = `${r.stdout}\n${r.stderr}`.split('\n').map((l) => l.trim()).filter(Boolean)
  return (lines[lines.length - 1] ?? '').slice(0, 160)
}

/** Turn a finished command into a row result. */
export function outcome(r, label, timeoutMs) {
  if (r.timedOut) return { result: 'FAIL', note: `${label} timed out after ${Math.round(timeoutMs / 1000)}s`, detail: tailOf(r) }
  if (r.error) {
    const why = r.error.code === 'ENOENT' ? 'not found' : (r.error.message ?? String(r.error))
    return { result: 'FAIL', note: `could not run ${label}: ${why}` }
  }
  if (r.status !== 0) return { result: 'FAIL', note: `${label} exited ${r.status}${lastLine(r) ? `: ${lastLine(r)}` : ''}`, detail: tailOf(r) }
  return { result: 'PASS', note: '' }
}

class GitError extends Error {}

const USAGE = `usage: node scripts/verify.mjs [--staged | --all] [--help]

  (no option)  check the current change: files differing from the merge base with
               origin/main (else main), plus staged, unstaged and untracked files
  --staged     check the staged files (what the pre-commit hook runs)
  --all        run every check
`

/**
 * Run verify. deps (all optional): root, run(cmd, args, opts), write(text), isTTY.
 * Returns the exit status.
 */
export async function main(argv, env = process.env, deps = {}) {
  const write = deps.write ?? ((s) => process.stdout.write(s))
  const root = deps.root ?? resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const run = deps.run ?? runCommand
  const colour = deps.isTTY ?? Boolean(process.stdout.isTTY)
  const args = new Set(argv)
  if (args.has('--help') || args.has('-h')) {
    write(USAGE)
    return 0
  }
  const unknown = argv.filter((a) => !['--staged', '--all'].includes(a))
  if (unknown.length > 0 || (args.has('--staged') && args.has('--all'))) {
    write(`verify: ${unknown.length ? `unknown option ${unknown[0]}` : '--staged and --all exclude each other'}\n${USAGE}`)
    return 2
  }
  const staged = args.has('--staged')
  const all = args.has('--all')

  const rows = []
  const git = (gitArgs) => {
    const r = run('git', gitArgs, { cwd: root, timeout: 120_000, env })
    if (r.error || r.status !== 0) {
      throw new GitError(`git ${gitArgs[0]} failed: ${r.error ? (r.error.code === 'ENOENT' ? 'git not found' : r.error.message) : (r.stderr.trim().split('\n')[0] || `exit ${r.status}`)}`)
    }
    return r.stdout
  }

  // The change set.
  let changed = []
  let untracked = new Set()
  let diffText = ''
  let base = null
  let gitFailed = false
  if (!all) {
    const t0 = Date.now()
    try {
      git(['rev-parse', '--is-inside-work-tree'])
      const sel = staged ? 'staged' : 'default'
      if (sel === 'staged') {
        base = 'HEAD'
        changed = splitZ(git(['diff', '--cached', '--name-only', '-z', '--no-renames']))
        diffText = git(['diff', '--cached', '--no-color', '--no-ext-diff', '--no-renames', '--', 'mods'])
      } else {
        for (const ref of ['origin/main', 'main']) {
          const r = run('git', ['merge-base', 'HEAD', ref], { cwd: root, env })
          if (!r.error && r.status === 0 && r.stdout.trim()) {
            base = r.stdout.trim()
            break
          }
        }
        if (base === null) throw new GitError('git merge-base failed: no merge base with origin/main or main')
        const tracked = splitZ(git(['diff', '--name-only', '-z', '--no-renames', base]))
        const others = splitZ(git(['ls-files', '--others', '--exclude-standard', '-z']))
        untracked = new Set(others)
        changed = [...new Set([...tracked, ...others])]
        diffText = git(['diff', '--no-color', '--no-ext-diff', '--no-renames', base, '--', 'mods'])
      }
    } catch (e) {
      gitFailed = true
      rows.push({ id: 'git', result: 'FAIL', ms: Date.now() - t0, note: `${e.message}; the change set is unknown, so every check runs` })
    }
  }
  if (!all && !gitFailed && staged && changed.length === 0) {
    write('verify: nothing is staged\n')
    return 0
  }

  const diff = parseDiff(diffText)
  const registerHunks = gitFailed || all ? undefined : (diff.get(REGISTER)?.hunks ?? [])
  const selected = selectChecks(changed, { all: all || gitFailed, registerHunks })

  // Shared state.
  const readRoot = (rel) => {
    try {
      return readFileSync(join(root, rel), 'utf8')
    } catch {
      return null
    }
  }
  const bin = env.COUNCIL_CLAUDE || 'claude'
  const allowUnpinned = env.COUNCIL_ALLOW_UNPINNED === '1'
  let pinState = null
  const pinned = () => {
    if (pinState) return pinState
    const pin = readPin(readRoot('.github/workflows/ci.yml') ?? '')
    if (pin === '') return (pinState = { ok: false, pin, note: 'could not read the pin from .github/workflows/ci.yml' })
    const r = run(bin, ['--version'], { cwd: root, timeout: 30_000, env })
    const have = r.error || r.status !== 0 ? '' : (r.stdout.split('\n')[0] ?? '').trim()
    if (isPinned(have, pin)) return (pinState = { ok: true, pin, have, note: `${bin} reports ${have}` })
    const shown = have || 'nothing (not found, or it failed to run)'
    return (pinState = { ok: false, pin, have, note: `${bin} reports ${shown}; CI pins ${pin}. Install it (npm install --prefix <folder> @anthropic-ai/claude-code@${pin}) and export COUNCIL_CLAUDE=<folder>/node_modules/.bin/claude` })
  }
  const canUsePinned = () => pinned().ok || (allowUnpinned && pinned().pin !== '')
  let validated = null

  // The children that run tests get no GIT_* variable: under pre-commit they would point at the real index.
  const testEnv = withoutGitEnv(env)
  const commandRow = (label, cmd, cmdArgs, timeout, extra = {}, childEnv = env) => {
    const r = run(cmd, cmdArgs, { cwd: root, timeout, env: childEnv })
    return { ...outcome(r, label, timeout), raw: r, ...extra }
  }

  // A MANUAL row says why it was selected: by a change, or by --all (which selects it whatever changed).
  const manual = (what, todo) => ({
    result: 'MANUAL',
    note: all ? `selected by --all: nothing to do unless ${what} changed; then ${todo}` : gitFailed ? `the change set is unknown (git failed): if ${what} changed, ${todo}` : `${what} changed: ${todo}`,
  })

  const impl = {
    hygiene: () => {
      const row = commandRow('check-hygiene.sh', 'bash', ['scripts/check-hygiene.sh', ...(staged ? ['--staged'] : [])], 120_000)
      if (row.result !== 'PASS') return row
      // check-hygiene.sh skips its link check without python3, silently; say so here.
      const py = run('python3', ['--version'], { cwd: root, timeout: 30_000, env })
      if (py.error || py.status !== 0) return { ...row, result: 'WARN', note: 'link check skipped: python3 not found' }
      return row
    },
    guidance: () => {
      const r = run('node', ['scripts/check-guidance.mjs', '--json'], { cwd: root, timeout: 120_000, env })
      if (r.error || (r.status !== 0 && r.status !== 1)) return outcome(r, 'check-guidance.mjs', 120_000)
      let findings
      try {
        findings = JSON.parse(r.stdout).findings
      } catch {
        return { result: 'FAIL', note: 'check-guidance.mjs printed no JSON', detail: tailOf(r) }
      }
      if (findings.length === 0 && r.status === 0) return { result: 'PASS', note: '' }
      const first = findings[0]
      return {
        result: 'FAIL',
        note: `${findings.length} finding${findings.length === 1 ? '' : 's'}${first ? `; first: ${first.id} ${first.file}:${first.line}` : ''}`,
        detail: findings.map((f) => `${f.id} ${f.file}:${f.line} ${f.message}`).slice(0, 40).join('\n'),
      }
    },
    'ask-first': () => {
      if (gitFailed) return { result: 'INFO', note: 'the change set is unknown; check the ask-first list in CLAUDE.md by hand' }
      if (all) return { result: 'INFO', note: 'not applicable to --all' }
      const hits = askFirstMatches(changed, askFirstPatterns(readRoot('.claude/settings.json')))
      if (hits.length === 0) return { result: 'INFO', note: 'no changed file is on the ask-first list' }
      const shown = hits.slice(0, 6).join(', ') + (hits.length > 6 ? `, and ${hits.length - 6} more` : '')
      return { result: 'INFO', attention: hits.length, note: `edits here need the maintainer's eye (CLAUDE.md, "Ask first"): ${shown}` }
    },
    'pinned-build': () => {
      const p = pinned()
      if (p.ok) return { result: 'PASS', note: p.note }
      if (allowUnpinned && p.pin !== '') return { result: 'WARN', note: `COUNCIL_ALLOW_UNPINNED=1: the gates run on an unpinned build. ${p.note}` }
      return { result: 'FAIL', note: p.note }
    },
    tests: () => {
      if (!canUsePinned()) return { result: 'SKIP', missing: true, note: 'not the pinned build' }
      return commandRow(`${bin} plugin test`, bin, ['plugin', 'test', MOD], 600_000, {}, testEnv)
    },
    typecheck: () => commandRow('tsc', 'tsc', ['-p', 'mods'], 120_000),
    'validate-plugin': () => {
      if (!canUsePinned()) return { result: 'SKIP', missing: true, note: 'not the pinned build' }
      const row = commandRow(`${bin} plugin validate`, bin, ['plugin', 'validate', '--strict', MOD], 120_000)
      validated = row.raw
      return row
    },
    'no-tool-check': () => {
      if (!canUsePinned()) return { result: 'SKIP', missing: true, note: 'not the pinned build' }
      if (!validated || validated.error) return { result: 'SKIP', missing: true, note: 'validate-plugin did not run' }
      if (/tool.check/.test(`${validated.stdout}${validated.stderr}`)) {
        return { result: 'FAIL', note: 'register.ts registers a tool.check hook; the mod must never take part in the permission decision' }
      }
      return { result: 'PASS', note: 'no tool.check hook' }
    },
    conventions: () => {
      const files = new Map()
      for (const [path, f] of diff) files.set(path, f)
      if (all) {
        for (const rel of walk(root, `${MOD}/hooks`)) if (rel.endsWith('.ts')) files.set(rel, { path: rel, added: (readRoot(rel) ?? '').split('\n'), removed: [] })
      } else {
        for (const rel of untracked) if (rel.startsWith(`${MOD}/hooks/`) && rel.endsWith('.ts')) files.set(rel, { path: rel, added: (readRoot(rel) ?? '').split('\n'), removed: [] })
      }
      const userConfigChanged = !all && changed.some((p) => p === `${MOD}/.claude-plugin/plugin.json`) ? pluginUserConfigChanged() : false
      const { fails, warns } = checkConventions({ changed, files, userConfigChanged, all })
      if (fails.length) return { result: 'FAIL', note: fails[0] + (fails.length > 1 ? ` (and ${fails.length - 1} more)` : ''), detail: [...fails, ...warns].join('\n') }
      if (warns.length) return { result: 'WARN', note: warns.join('; ') }
      return { result: 'PASS', note: '' }
    },
    'validate-marketplace': () => {
      if (!canUsePinned()) return { result: 'SKIP', missing: true, note: 'not the pinned build' }
      return commandRow(`${bin} plugin validate`, bin, ['plugin', 'validate', '--strict', '.'], 120_000)
    },
    sweep: () => manual('a rule, protected path, redaction or secrets-scan file', 'run the sweep against main by hand and note "lower than main: none" in the pull request (references/domain-gate-direction.md)'),
    mutation: () => manual('a path that decides whether a call runs', 'break it on purpose and watch a test fail (R7 in CLAUDE.md; references/conventions.md)'),
    'scripts-tests': () => commandRow('node --test', 'node', ['--test', 'scripts/tests/'], 120_000, {}, testEnv),
  }

  function pluginUserConfigChanged() {
    const rel = `${MOD}/.claude-plugin/plugin.json`
    try {
      const now = staged ? run('git', ['show', `:${rel}`], { cwd: root, env }) : { status: 0, stdout: readRoot(rel) ?? '' }
      const old = run('git', ['show', `${base ?? 'HEAD'}:${rel}`], { cwd: root, env })
      if (old.error || old.status !== 0 || now.status !== 0) return true
      return JSON.stringify(JSON.parse(old.stdout).userConfig ?? null) !== JSON.stringify(JSON.parse(now.stdout).userConfig ?? null)
    } catch {
      return true
    }
  }

  for (const id of selected) {
    const t0 = Date.now()
    let res
    try {
      res = impl[id]()
    } catch (e) {
      res = { result: 'FAIL', note: `crashed: ${e instanceof Error ? e.message : String(e)}` }
    }
    rows.push({ id, ...res, ms: res.ms ?? Date.now() - t0 })
  }

  write(`${renderTable(rows, colour)}\n`)
  for (const r of rows) if (r.result === 'FAIL' && r.detail) write(`\n--- ${r.id}: output (last lines) ---\n${r.detail}\n`)
  const summary = summarize(rows)
  write(`\nverify: ${summary}\n`)
  return rows.some(isFailing) ? 1 : 0
}

function splitZ(text) {
  return text.split('\0').filter(Boolean)
}

function walk(root, rel) {
  const out = []
  let entries
  try {
    entries = readdirSync(join(root, rel), { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const next = `${rel}/${e.name}`
    if (e.isDirectory()) out.push(...walk(root, next))
    else if (e.isFile()) out.push(next)
  }
  return out
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.stdout.on('error', () => {})
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  }, (e) => {
    process.stderr.write(`verify: crashed: ${e instanceof Error ? e.message : String(e)}\n`)
    process.exitCode = 1
  })
}
