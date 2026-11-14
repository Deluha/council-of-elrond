import { CLIENT_OPTIONS } from '../members/aragorn.js'
import { redact } from '../redact.js'
import { FILE_PATH_FIELDS, SHELL_TOOLS } from '../rules/classify.js'
import type { Call, Classification } from '../rules/classify.js'
import { relativeTo, resolve } from '../rules/paths.js'
import { isCurrentBranchRef, parsePush } from '../rules/push.js'
import { splitShell } from '../rules/shell.js'
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

/**
 * What a call attempts. `key` and `verbKey` name the whole call (as they always
 * did); `partKeys` and `partVerbKeys` name each gated part of a shell call on
 * its own, as a call made of that part alone would be named, so a part cannot
 * be retried under a new key by appending another command to it. For a call of
 * one part, a file tool or another tool they hold just `key` and `verbKey`.
 */
export type Operation = {
  key: string
  verbKey: string
  /** Each gated part's own key, distinct, for at most the first MAX_PART_KEYS parts. */
  partKeys: readonly string[]
  /** Each gated part's own verb key, distinct, for at most the first MAX_PART_KEYS parts. */
  partVerbKeys: readonly string[]
  /**
   * A shell call with more gated parts than MAX_PART_KEYS: the keys cover only the
   * first ones, so a locked or out-of-rounds part could sit past them. No model
   * reviews it; it goes to the person (present only when true).
   */
  hasTooManyParts?: boolean
}

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
const SQL_TARGET_OPTIONS: ReadonlySet<string> = new Set(['-d', '--dbname', '-h', '--host', '-D', '--database', '--db'])

const MAX_TARGETS = 8
const MAX_KEY_CHARS = 300
/** Gated parts of one call that get a key of their own: a compound command cannot grow the session state past this. */
export const MAX_PART_KEYS = 8

const programOf = (part: ShellPart): string => {
  const first = part.coreWords[0] ?? ''
  return first.slice(first.lastIndexOf('/') + 1)
}

/** A path as the key spells it: relative to the root when inside it, no trailing slash. */
function normalPath(word: string, cwd: string, context: OperationContext): string {
  const absolute = resolve(word, cwd, context.home)
  const relative = relativeTo(absolute, context.root)
  const out = relative ?? absolute
  return out === '' ? '.' : out.replace(/\/+$/, '') || '/'
}

const positionals = (words: readonly string[]): string[] => words.filter(word => !word.startsWith('-') && word !== '')

/** `git push [options] [remote] [refspec...]`: remote plus destination branches. */
function pushTargets(args: readonly string[]): string[] {
  const { remote, refspecs } = parsePush(args)
  const branches = refspecs.map(spec => (isCurrentBranchRef(spec.destination) ? '(current branch)' : spec.destination))
  return [remote ?? '(default remote)', ...(branches.length > 0 ? branches : ['(current branch)'])]
}

/**
 * The database a SQL client talks to: option values, else its first
 * positional. The value of an inline-SQL option (`-c "..."`) is skipped, so a
 * rephrased statement is the same operation.
 */
function sqlTargets(program: string, args: readonly string[]): string[] {
  const inline = CLIENT_OPTIONS[program]?.inline ?? []
  const rest: string[] = []
  for (let i = 0; i < args.length; i++) {
    const word = args[i] ?? ''
    if (inline.includes(word)) i++
    else if (word.startsWith('--') && word.includes('=') && inline.includes(word.slice(0, word.indexOf('=')))) continue
    else rest.push(word)
  }
  const out: string[] = []
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i] ?? ''
    const eq = word.indexOf('=')
    if (eq > 0 && SQL_TARGET_OPTIONS.has(word.slice(0, eq))) out.push(word.slice(eq + 1))
    else if (SQL_TARGET_OPTIONS.has(word) && rest[i + 1] !== undefined) out.push(rest[++i] ?? '')
    else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(word)) out.push(word)
  }
  if (out.length === 0) {
    const first = positionals(rest)[0]
    if (first !== undefined) out.push(first)
  }
  return out.map(target => redact(target))
}

/** Files a part's redirects write to (not `2>&1`, not /dev/null). */
const writtenFiles = (part: ShellPart, cwd: string, context: OperationContext): string[] =>
  part.redirects
    .filter(redirect => redirect.op.includes('>') && !redirect.target.startsWith('&') && redirect.target !== '/dev/null')
    .map(redirect => normalPath(redirect.target, cwd, context))

/** `git [global options] SUB rest`: the subcommand and what follows it, skipping the global options. */
function gitCommand(args: readonly string[]): { sub: string; rest: readonly string[] } {
  // `git -C dir push`: skip global options to find the subcommand.
  let index = 0
  while (index < args.length && (args[index] ?? '').startsWith('-')) index += ['-C', '-c'].includes(args[index] ?? '') ? 2 : 1
  return { sub: args[index] ?? '', rest: args.slice(index + 1) }
}

/** What marks a force or delete push's own retry count: the part key plus this. */
export const FORCE_SUFFIX = ' !force'

/** Whether a shell part is a `git push` that forces or deletes (the shared push parser's reading, as the force-push check has it). */
export function isForcePush(part: ShellPart): boolean {
  if (programOf(part) !== 'git') return false
  const { sub, rest } = gitCommand(part.coreWords.slice(1))
  if (sub !== 'push') return false
  const push = parsePush(rest)
  return push.isForce || push.isDelete || push.refspecs.some(spec => spec.isPlus || spec.source === '')
}

/** One shell part's verb and targets. */
export function partOperation(part: ShellPart, cwd: string, context: OperationContext): { verb: string; targets: string[] } {
  const program = programOf(part)
  const args = part.coreWords.slice(1)
  if (program === 'git') {
    const { sub, rest } = gitCommand(args)
    if (sub === 'push') return { verb: 'git push', targets: pushTargets(rest) }
    return { verb: `git ${sub}`.trim(), targets: positionals(rest) }
  }
  if (SQL_CLIENTS.has(program)) return { verb: program, targets: sqlTargets(program, args) }
  if (SUBCOMMAND_PROGRAMS.has(program)) {
    const sub = positionals(args)[0]
    const rest = sub === undefined ? [] : args.slice(args.indexOf(sub) + 1)
    return { verb: sub === undefined ? program : `${program} ${sub}`, targets: positionals(rest) }
  }
  if (PATH_PROGRAMS.has(program)) {
    return { verb: program, targets: [...positionals(args).map(word => normalPath(word, cwd, context)), ...writtenFiles(part, cwd, context)] }
  }
  // A redirect write is what the part does: key on the file, not on what the program was given.
  const written = writtenFiles(part, cwd, context)
  return { verb: program, targets: written.length > 0 ? written : positionals(args) }
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
      const key = cap(`shell:${redact(text)}`)
      return { key, verbKey: 'shell:(unparsed)', partKeys: [key], partVerbKeys: ['shell:(unparsed)'] }
    }
    const ops = parts.map(finding => partOperation(finding.part as ShellPart, finding.cwd ?? context.cwd, context))
    const verbs = sortedUnique(ops.map(op => op.verb))
    const lines = ops.map(op => `${op.verb} ${sortedUnique(op.targets).slice(0, MAX_TARGETS).join(' ')}`.trim())
    const key = sortedUnique(lines)
    // The key can hold a target a command named verbatim (a push URL with a
    // token, a connection string); it is written to the audit log, so redact.
    // A part's own key is the key of a call made of that part alone.
    const partKeys = lines.slice(0, MAX_PART_KEYS).map(line => cap(redact(`shell:${line}`)))
    // A force or delete push also keeps a count of its own, which a plain push of the same target never clears.
    const variants = parts.slice(0, MAX_PART_KEYS).flatMap((finding, index) => (isForcePush(finding.part as ShellPart) ? [`${partKeys[index] as string}${FORCE_SUFFIX}`] : []))
    return {
      key: cap(redact(`shell:${key.join(' ; ')}`)),
      verbKey: cap(`shell:${verbs.join(' ; ')}`),
      partKeys: sortedUnique([...partKeys, ...variants]),
      partVerbKeys: sortedUnique(ops.slice(0, MAX_PART_KEYS).map(op => cap(`shell:${op.verb}`))),
      ...(parts.length > MAX_PART_KEYS && { hasTooManyParts: true }),
    }
  }
  const field = FILE_PATH_FIELDS[call.tool]
  const given = field === undefined ? undefined : call.input[field]
  if (typeof given === 'string') {
    const path = context.realPath !== undefined ? normalPath(context.realPath, '/', context) : normalPath(given, context.cwd, context)
    const key = cap(`file:${path}`)
    return { key, verbKey: `file:${call.tool}`, partKeys: [key], partVerbKeys: [`file:${call.tool}`] }
  }
  const key = cap(`tool:${call.tool}`)
  return { key, verbKey: key, partKeys: [key], partVerbKeys: [key] }
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
/** Distinct verb keys the counters hold; a new verb past this counts on `OTHER_VERBS_KEY`. Nothing stored is evicted. */
export const MAX_VERB_KEYS = 200
/** The one shared key the verbs past MAX_VERB_KEYS count on. */
export const OTHER_VERBS_KEY = 'shell:(other verbs)'

const ZERO: OpState = { rounds: 0, wipes: 0 }

export const opOf = (state: OpsState, key: string): OpState => state.ops[key] ?? ZERO

/** Keeps the newest MAX_OPS entries, so a long prompt cannot grow state without bound. */
function withOp<T extends OpsState>(state: T, key: string, op: OpState): T {
  const { [key]: _old, ...rest } = state.ops
  const entries = Object.entries({ ...rest, [key]: op })
  return { ...state, ops: Object.fromEntries(entries.slice(-MAX_OPS)) }
}

export type Lockout = { kind: 'key' | 'verb'; wipes: number } | undefined

/** The keys an operation's rounds and failed attempts are counted on: each part's own, then the whole call's. */
const keysOf = (operation: Operation): string[] => [...new Set([...operation.partKeys, operation.key])]

/**
 * The verb keys a call is checked against: each part's own, and the joined
 * verb key, which a version of the counters that counted it may have stored.
 */
const verbKeysChecked = (operation: Operation): string[] => [...new Set([...operation.partVerbKeys, operation.verbKey])]

/** The most failed attempts on any verb of the call, and the verb key that holds them. */
function worstVerb(state: OpsState, operation: Operation): { verbKey: string; wipes: number } | undefined {
  let worst: { verbKey: string; wipes: number } | undefined
  const consider = (verbKey: string, wipes: number): void => {
    if (wipes >= VERB_WIPE_CAP && (worst === undefined || wipes > worst.wipes)) worst = { verbKey, wipes }
  }
  for (const verbKey of verbKeysChecked(operation)) consider(verbKey, state.verbWipes[verbKey] ?? 0)
  // A part's verb with no entry of its own may have been counted on the shared key (the counters were full then).
  const other = state.verbWipes[OTHER_VERBS_KEY] ?? 0
  if (operation.partVerbKeys.some(verbKey => state.verbWipes[verbKey] === undefined)) consider(OTHER_VERBS_KEY, other)
  return worst
}

/**
 * Whether the operation is locked out: 3 failed attempts on its whole key or on
 * any part's own key, or 5 on the verb of any part (or on its stored joined verb key).
 */
export function lockoutOf(state: OpsState, operation: Operation): Lockout {
  const key = Math.max(...keysOf(operation).map(known => opOf(state, known).wipes))
  if (key >= KEY_WIPE_CAP) return { kind: 'key', wipes: key }
  const verb = worstVerb(state, operation)
  return verb === undefined ? undefined : { kind: 'verb', wipes: verb.wipes }
}

/** The verb key that locks the operation out (for saying which kind is locked), when a verb does and no key does. */
export const lockedVerbOf = (state: OpsState, operation: Operation): string | undefined => worstVerb(state, operation)?.verbKey

/** One review verdict on the operation: a non-approve verdict uses a round, on its whole key and each part's own. */
export function noteRound<T extends OpsState>(state: T, operation: Operation, isApprove: boolean): T {
  if (isApprove) return state
  return keysOf(operation).reduce((current, key) => {
    const op = opOf(current, key)
    return withOp(current, key, { ...op, rounds: op.rounds + 1 })
  }, state)
}

/** The rounds left on the operation: the fewest of its whole key and its parts' own. */
export const roundsLeft = (state: OpsState, operation: Operation): number =>
  Math.max(0, ROUND_CAP - Math.max(...keysOf(operation).map(key => opOf(state, key).rounds)))

/**
 * Failed attempts since the user last wrote, for the status and the debate
 * pane: how many (the per-verb counters, which only a new prompt clears; a call
 * of several verbs counts once on each), over how many tracked keys, and how
 * many of those are locked out: keys at their cap, and verbs at theirs.
 */
export function attemptsOf(state: OpsState): { count: number; ops: number; locked: number } {
  const ops = Object.values(state.ops)
  const verbs = Object.values(state.verbWipes)
  return {
    count: verbs.reduce((sum, n) => sum + n, 0),
    ops: ops.length,
    locked: ops.filter(op => op.wipes >= KEY_WIPE_CAP).length + verbs.filter(wipes => wipes >= VERB_WIPE_CAP).length,
  }
}

/** Out of rounds: the next attempt goes to the user, with no model call. Its whole key, or any part's own, is. */
export const isOutOfRounds = (state: OpsState, operation: Operation): boolean => keysOf(operation).some(key => opOf(state, key).rounds >= ROUND_CAP)

/**
 * A failed attempt, counted on the whole key, on each part's own key, and on
 * each distinct part verb. The joined verb key is not counted: the per-verb
 * counters replace it (a stored one is still read, by `lockoutOf`).
 */
export function noteWipe<T extends OpsState>(state: T, operation: Operation): T {
  const counted = keysOf(operation).reduce((current, key) => {
    const op = opOf(current, key)
    return withOp(current, key, { ...op, wipes: op.wipes + 1 })
  }, state)
  const verbWipes = { ...counted.verbWipes }
  let known = Object.keys(verbWipes).filter(verbKey => verbKey !== OTHER_VERBS_KEY).length
  for (const verbKey of new Set(operation.partVerbKeys)) {
    // A verb already counted keeps its entry; a new one past the bound shares one, each verb once.
    const isNew = verbWipes[verbKey] === undefined
    const target = isNew && known >= MAX_VERB_KEYS ? OTHER_VERBS_KEY : verbKey
    if (isNew && target === verbKey) known++
    verbWipes[target] = (verbWipes[target] ?? 0) + 1
  }
  return { ...counted, verbWipes }
}

/**
 * The user typed an instruction: the call's own rounds start over, on its whole
 * key only. A part's rounds stay: giving them back would lower a count a call of
 * that part alone has used (DESIGN §15 item 20). For a call of one part, a file
 * tool or another tool the whole key is the only key.
 */
export function resetRounds<T extends OpsState>(state: T, operation: Operation): T {
  const op = opOf(state, operation.key)
  return op.rounds === 0 ? state : withOp(state, operation.key, { ...op, rounds: 0 })
}

/**
 * The call ran and succeeded: its own whole key starts over. Part keys and the
 * verb counters stay, so a success never lowers what a call of one part alone
 * has counted (DESIGN §15 item 20).
 */
export function resetOperation<T extends OpsState>(state: T, operation: Operation): T {
  if (state.ops[operation.key] === undefined) return state
  const { [operation.key]: _done, ...rest } = state.ops
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
  // Seen on 2.1.294: a `git push` in `-p` ("This command requires approval").
  /\brequires? approval\b/i,
  /requested permissions? to (use|write|edit|read|run)/i,
  /haven'?t granted it yet/i,
  /permission to (use|edit|read) .+ has been denied/i,
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

/**
 * Whether a call has a `git` part, gated or not: the branch, the index and the
 * history are not in a call's key, so the same words can mean another thing
 * the next time. A command too long or too complex to split is read as text.
 */
export function hasGitPart(call: Call): boolean {
  if (!SHELL_TOOLS.has(call.tool) || typeof call.input.command !== 'string') return false
  const split = splitShell(call.input.command)
  if (split.isTooLong || split.isCut) return /\bgit\b/.test(call.input.command)
  return split.parts.some(part => programOf(part) === 'git')
}

/** Notes an approved fingerprint; the cache lives until the next prompt. */
export const cacheApprove = (cache: readonly string[], fingerprint: string): string[] =>
  [...cache.filter(known => known !== fingerprint), fingerprint].slice(-MAX_CACHE)
