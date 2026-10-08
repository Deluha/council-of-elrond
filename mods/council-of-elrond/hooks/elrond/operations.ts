import { redact } from '../redact.js'
import { FILE_PATH_FIELDS, SHELL_TOOLS } from '../rules/classify.js'
import type { Call, Classification } from '../rules/classify.js'
import { relativeTo, resolve } from '../rules/paths.js'
import type { ShellPart } from '../rules/shell.js'

/**
 * Operations: what a call is trying to do, so a rephrased retry counts
 * against the same attempt. The key is tool family + verb + normalised
 * targets; the verb key drops the targets, to catch retries that change them.
 */

export type OperationContext = {
  root: string
  cwd: string
  home?: string
  /** A file tool's path with symbolic links resolved, when known. */
  realPath?: string
}

export type Operation = { key: string; verbKey: string }

/** Programs whose first word after the name is a subcommand that names the verb. */
const SUBCOMMAND_PROGRAMS: ReadonlySet<string> = new Set([
  'git', 'npm', 'pnpm', 'yarn', 'bun', 'cargo', 'docker', 'docker-compose', 'podman', 'kubectl', 'helm',
  'terraform', 'tofu', 'gh', 'aws', 'gcloud', 'az', 'prisma', 'knex', 'alembic', 'rails', 'rake',
  'flyway', 'liquibase', 'goose', 'dbmate', 'atlas', 'drizzle-kit', 'sequelize', 'typeorm', 'gem', 'twine',
  'systemctl', 'launchctl', 'brew', 'apt', 'apt-get', 'dnf', 'yum', 'pip', 'pip3', 'uv', 'poetry',
])

/** Programs whose arguments are all paths, resolved so `./build` and `build/` match. */
const PATH_PROGRAMS: ReadonlySet<string> = new Set([
  'rm', 'rmdir', 'unlink', 'shred', 'srm', 'trash', 'mv', 'cp', 'ln', 'chmod', 'chown', 'chgrp',
  'truncate', 'touch', 'mkdir', 'tee', 'find', 'sed', 'perl', 'ruby', 'bash', 'sh', 'zsh', 'source', '.',
  'python', 'python3', 'node', 'deno', 'scp', 'rsync',
])

const SQL_CLIENTS: ReadonlySet<string> = new Set([
  'psql', 'pg_restore', 'dropdb', 'createdb', 'mysql', 'mariadb', 'mysqladmin', 'sqlite3', 'mongo', 'mongosh',
  'mongorestore', 'redis-cli', 'cqlsh', 'sqlcmd', 'clickhouse', 'clickhouse-client',
])

/** Options of SQL clients that name the database or its host. */
const SQL_TARGET_OPTIONS: ReadonlySet<string> = new Set(['-d', '--dbname', '-h', '--host', '-D', '--database', '--db', '-n'])

const MAX_TARGETS = 8
const MAX_KEY_CHARS = 300

const unquote = (word: string): string => word.replace(/^['"]|['"]$/g, '')

const programOf = (part: ShellPart): string => {
  const first = part.coreWords[0] ?? ''
  return first.slice(first.lastIndexOf('/') + 1)
}

/** A path as the key spells it: relative to the root when inside it, no trailing slash. */
function normalPath(word: string, cwd: string, context: OperationContext): string {
  const absolute = resolve(unquote(word), cwd, context.home)
  const relative = relativeTo(absolute, context.root)
  const out = relative ?? absolute
  return out === '' ? '.' : out.replace(/\/+$/, '') || '/'
}

const positionals = (words: readonly string[]): string[] => words.filter(word => !word.startsWith('-') && word !== '')

/** `git push [options] [remote] [refspec...]`: remote plus destination branches. */
function pushTargets(args: readonly string[]): string[] {
  const words = positionals(args)
  const remote = words[0] ?? '(default remote)'
  const branches = words.slice(1).map(refspec => {
    const destination = refspec.includes(':') ? refspec.slice(refspec.indexOf(':') + 1) : refspec
    return destination.replace(/^\+/, '').replace(/^refs\/heads\//, '')
  })
  return [remote, ...(branches.length > 0 ? branches : ['(current branch)'])]
}

/** The database a SQL client talks to: option values, else its first positional. */
function sqlTargets(args: readonly string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const word = args[i] ?? ''
    const eq = word.indexOf('=')
    if (eq > 0 && SQL_TARGET_OPTIONS.has(word.slice(0, eq))) out.push(word.slice(eq + 1))
    else if (SQL_TARGET_OPTIONS.has(word) && args[i + 1] !== undefined) out.push(args[++i] ?? '')
    else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(word)) out.push(word)
  }
  if (out.length === 0) {
    const first = positionals(args)[0]
    if (first !== undefined) out.push(first)
  }
  return out.map(target => redact(unquote(target)))
}

/** Files a part's redirects write to (not `2>&1`, not /dev/null). */
const writtenFiles = (part: ShellPart, cwd: string, context: OperationContext): string[] =>
  part.redirects
    .filter(redirect => redirect.op.includes('>') && !redirect.target.startsWith('&') && redirect.target !== '/dev/null')
    .map(redirect => normalPath(redirect.target, cwd, context))

/** One shell part's verb and targets. */
export function partOperation(part: ShellPart, cwd: string, context: OperationContext): { verb: string; targets: string[] } {
  const program = programOf(part)
  const args = part.coreWords.slice(1)
  if (program === 'git') {
    // `git -C dir push`: skip global options to find the subcommand.
    let index = 0
    while (index < args.length && (args[index] ?? '').startsWith('-')) index += ['-C', '-c'].includes(args[index] ?? '') ? 2 : 1
    const sub = args[index] ?? ''
    const rest = args.slice(index + 1)
    if (sub === 'push') return { verb: 'git push', targets: pushTargets(rest) }
    return { verb: `git ${sub}`.trim(), targets: positionals(rest).map(unquote) }
  }
  if (SQL_CLIENTS.has(program)) return { verb: program, targets: sqlTargets(args) }
  if (SUBCOMMAND_PROGRAMS.has(program)) {
    const sub = positionals(args)[0]
    const rest = sub === undefined ? [] : args.slice(args.indexOf(sub) + 1)
    return { verb: sub === undefined ? program : `${program} ${sub}`, targets: positionals(rest).map(unquote) }
  }
  if (PATH_PROGRAMS.has(program)) {
    return { verb: program, targets: [...positionals(args).map(word => normalPath(word, cwd, context)), ...writtenFiles(part, cwd, context)] }
  }
  return { verb: program, targets: [...positionals(args).map(unquote), ...writtenFiles(part, cwd, context)] }
}

const cap = (key: string): string => (key.length > MAX_KEY_CHARS ? `${key.slice(0, MAX_KEY_CHARS - 1)}…` : key)

const sortedUnique = (items: readonly string[]): string[] => [...new Set(items)].sort()

/**
 * The operation a gated call attempts. Shell: each gated part's verb and
 * targets (flags dropped, paths resolved, targets sorted); file tools share
 * the `file` family keyed on the real path; anything else is its tool.
 */
export function operationOf(call: Call, classification: Classification, context: OperationContext): Operation {
  if (SHELL_TOOLS.has(call.tool)) {
    const parts = classification.findings.filter(finding => finding.part !== undefined)
    if (parts.length === 0) {
      const text = typeof call.input.command === 'string' ? call.input.command.replace(/\s+/g, ' ').trim() : ''
      return { key: cap(`shell:${redact(text)}`), verbKey: 'shell:(unparsed)' }
    }
    const ops = parts.map(finding => partOperation(finding.part as ShellPart, finding.cwd ?? context.cwd, context))
    const verbs = sortedUnique(ops.map(op => op.verb))
    const key = sortedUnique(ops.map(op => `${op.verb} ${sortedUnique(op.targets).slice(0, MAX_TARGETS).join(' ')}`.trim()))
    // The key can hold a target a command named verbatim (a push URL with a
    // token, a connection string); it is written to the audit log, so redact.
    return { key: cap(redact(`shell:${key.join(' ; ')}`)), verbKey: cap(`shell:${verbs.join(' ; ')}`) }
  }
  const field = FILE_PATH_FIELDS[call.tool]
  const given = field === undefined ? undefined : call.input[field]
  if (typeof given === 'string') {
    const path = context.realPath !== undefined ? normalPath(context.realPath, '/', context) : normalPath(given, context.cwd, context)
    return { key: cap(`file:${path}`), verbKey: `file:${call.tool}` }
  }
  return { key: cap(`tool:${call.tool}`), verbKey: cap(`tool:${call.tool}`) }
}

// ── Rounds, failed attempts, lockout ────────────────────────────────────────

export const ROUND_CAP = 2
export const KEY_WIPE_CAP = 3
export const VERB_WIPE_CAP = 5

export type OpState = { rounds: number; wipes: number }

export type OpsState = {
  ops: Readonly<Record<string, OpState>>
  verbWipes: Readonly<Record<string, number>>
}

const MAX_OPS = 200

const ZERO: OpState = { rounds: 0, wipes: 0 }

export const opOf = (state: OpsState, key: string): OpState => state.ops[key] ?? ZERO

/** Keeps the newest MAX_OPS entries, so a long prompt cannot grow state without bound. */
function withOp<T extends OpsState>(state: T, key: string, op: OpState): T {
  const { [key]: _old, ...rest } = state.ops
  const entries = Object.entries({ ...rest, [key]: op })
  return { ...state, ops: Object.fromEntries(entries.slice(-MAX_OPS)) }
}

export type Lockout = { kind: 'key' | 'verb'; wipes: number } | undefined

/** Whether the operation is locked out: 3 failed attempts on its key, or 5 on its verb. */
export function lockoutOf(state: OpsState, operation: Operation): Lockout {
  const key = opOf(state, operation.key).wipes
  if (key >= KEY_WIPE_CAP) return { kind: 'key', wipes: key }
  const verb = state.verbWipes[operation.verbKey] ?? 0
  if (verb >= VERB_WIPE_CAP) return { kind: 'verb', wipes: verb }
  return undefined
}

/** One review verdict on the operation: a non-approve verdict uses a round. */
export function noteRound<T extends OpsState>(state: T, key: string, isApprove: boolean): T {
  if (isApprove) return state
  const op = opOf(state, key)
  return withOp(state, key, { ...op, rounds: op.rounds + 1 })
}

export const roundsLeft = (state: OpsState, key: string): number => Math.max(0, ROUND_CAP - opOf(state, key).rounds)

/** Out of rounds: the next attempt goes to the user, with no model call. */
export const isOutOfRounds = (state: OpsState, key: string): boolean => opOf(state, key).rounds >= ROUND_CAP

/** A failed attempt, counted on the key and on its verb. */
export function noteWipe<T extends OpsState>(state: T, operation: Operation): T {
  const op = opOf(state, operation.key)
  const counted = withOp(state, operation.key, { ...op, wipes: op.wipes + 1 })
  return { ...counted, verbWipes: { ...counted.verbWipes, [operation.verbKey]: (counted.verbWipes[operation.verbKey] ?? 0) + 1 } }
}

/** The user typed an instruction: the operation's rounds start over. */
export function resetRounds<T extends OpsState>(state: T, key: string): T {
  const op = opOf(state, key)
  return op.rounds === 0 ? state : withOp(state, key, { ...op, rounds: 0 })
}

/** The call ran and succeeded: its own operation starts over (the verb counter stays). */
export function resetOperation<T extends OpsState>(state: T, key: string): T {
  if (state.ops[key] === undefined) return state
  const { [key]: _done, ...rest } = state.ops
  return { ...state, ops: rest }
}

// ── What happened to the call, and whether it counts as a failed attempt ────

export type Outcome = 'ran' | 'error' | 'refused' | 'refused-by-user' | 'denied-by-permission'

/**
 * Claude Code's words when the person refuses a call at its own permission
 * prompt (with or without feedback). Read from the 2.1.289 binary.
 */
const USER_REFUSAL: readonly RegExp[] = [
  /the user doesn'?t want to proceed with this tool use/i,
  /the user doesn'?t want to take this action/i,
]

/**
 * Claude Code's words when its permission check stops a call with nobody
 * asked: no one to ask (`-p`), or a deny rule. The first is verified live.
 */
const AUTOMATIC_DENIAL: readonly RegExp[] = [
  /needs? approval/i,
  /requested permissions? to (use|write|edit|read|run)/i,
  /haven'?t granted it yet/i,
  /permission to use .+ has been denied/i,
]

export const isUserRefusal = (text: string): boolean => USER_REFUSAL.some(re => re.test(text))

export const isAutomaticDenial = (text: string): boolean => AUTOMATIC_DENIAL.some(re => re.test(text))

export function outcomeOf(result: { deny?: string; isError?: boolean; text?: string }): Outcome {
  if (result.deny !== undefined) return 'refused'
  if (result.isError !== true) return 'ran'
  const text = result.text ?? ''
  if (isUserRefusal(text)) return 'refused-by-user'
  return isAutomaticDenial(text) ? 'denied-by-permission' : 'error'
}

export type WipePolicy = {
  /** A gated call that ran and errored counts (userConfig `toolErrorsAreWipes`). */
  toolErrors: boolean
}

/**
 * Whether a call that went through `next(e)` counts as a failed attempt. The
 * person refusing at Claude Code's prompt always does, like "keep blocked";
 * an automatic denial never does, since nobody chose it.
 */
export const isWipeOutcome = (outcome: Outcome, policy: WipePolicy): boolean =>
  outcome === 'refused-by-user' || (outcome === 'error' && policy.toolErrors)

// ── Cache ───────────────────────────────────────────────────────────────────

const MAX_CACHE = 100

/** Notes an approved fingerprint; the cache lives until the next prompt. */
export const cacheApprove = (cache: readonly string[], fingerprint: string): string[] =>
  [...cache.filter(known => known !== fingerprint), fingerprint].slice(-MAX_CACHE)
