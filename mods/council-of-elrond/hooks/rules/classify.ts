import type { CompiledConfig, CompiledRule } from '../config/schema.js'
import { strictness } from '../config/types.js'
import type { MemberName, Profile, RuleSource, Tier } from '../config/types.js'
import { forcesCurrentBranch, mayMoveHead, runCheck } from './checks.js'
import type { CheckContext } from './checks.js'
import { touchesProtected } from './globs.js'
import type { ProtectedMatcher } from './globs.js'
import { relativeTo, resolve } from './paths.js'
import { splitShell } from './shell.js'
import type { ShellPart } from './shell.js'

/** Tools whose `command` is a shell command line. */
export const SHELL_TOOLS: ReadonlySet<string> = new Set(['Bash', 'Monitor'])

/** File tools and the input field holding their path. */
export const FILE_PATH_FIELDS: Readonly<Record<string, string>> = {
  Write: 'file_path',
  Edit: 'file_path',
  NotebookEdit: 'notebook_path',
}

export type Call = {
  tool: string
  /** The tool's arguments, without the envelope (`tool`, `tool_use_id`, `agentId`). */
  input: Readonly<Record<string, unknown>>
}

export type ClassifyContext = Omit<CheckContext, 'protectedBranches' | 'production'> & {
  /** Where a file tool's path really lands (symbolic links resolved), when known. */
  realPath?: string
}

export type Finding = {
  tier: Tier
  /** The rule's id, or `protected-path`. */
  ruleId: string
  source: RuleSource | 'protected'
  reason: string
  member?: MemberName
  profile?: Profile
  /** The part of the call it is about: one shell command, or the file path. */
  subject: string
  /** The parsed shell part, and the directory it runs in (after any `cd`). */
  part?: ShellPart
  cwd?: string
}

export type Classification = {
  tier: Tier
  /** The finding that set the tier; absent when nothing matched (allow). */
  decided?: Finding
  /** Every subject's deciding finding above allow. */
  findings: readonly Finding[]
  /** A protected path is involved: never offer an allow rule for this call. */
  isProtected: boolean
  /** Files a script-running part names, for reviewer context. */
  scriptPaths: readonly string[]
  /**
   * Rules of a project file nobody has confirmed that matched and did not
   * decide: they add no tier (an unconfirmed rule only adds to the shipped
   * decision), and are listed so the audit line and the person can see them.
   */
  added: readonly Finding[]
  /**
   * An unconfirmed project `ask` rule that matched a call the shipped rules
   * review: the call is reviewed as the shipped decision says, and only then
   * put to the person. Only ever set when `tier` is `review`.
   */
  alsoAsk?: Finding
}

type Subject = {
  label: string
  part?: ShellPart
  /** Relative to the root when inside it, else absolute. */
  path?: string
  /** Candidate paths to test against the protected globs. */
  candidates: readonly string[]
  /** Every word that could name a file, to test against the protected globs (a shell part). */
  protectedWords?: readonly string[]
}

const toFinding = (rule: CompiledRule, subject: string): Finding => ({
  tier: rule.tier,
  ruleId: rule.id,
  source: rule.source,
  reason: rule.reason,
  ...(rule.member !== undefined && { member: rule.member }),
  ...(rule.profile !== undefined && { profile: rule.profile }),
  subject,
})

const strictest = (findings: readonly Finding[]): Finding | undefined =>
  findings.reduce<Finding | undefined>(
    (best, finding) => (best === undefined || strictness(finding.tier) > strictness(best.tier) ? finding : best),
    undefined,
  )

function ruleMatches(
  rule: CompiledRule,
  call: Call,
  subject: Subject,
  inputJson: string,
  context: CheckContext,
): boolean {
  if (!rule.matchesTool(call.tool)) return false
  if (rule.commandRe !== undefined && (subject.part === undefined || !rule.commandRe.test(subject.part.core))) return false
  if (rule.check !== undefined && (subject.part === undefined || !runCheck(rule.check, subject.part, context))) return false
  if (rule.pathRe !== undefined && (subject.path === undefined || !rule.pathRe.test(subject.path))) return false
  if (rule.inputRe !== undefined && !rule.inputRe.test(inputJson)) return false
  return true
}

/** The words of a shell part that could name a file. */
function pathWordsOf(part: ShellPart): string[] {
  const out: string[] = []
  for (const word of [...part.coreWords.slice(1), ...part.redirects.map(r => r.target)]) {
    if (word === '' || word.includes('$(')) continue
    const value = word.startsWith('-') ? (word.includes('=') ? word.slice(word.indexOf('=') + 1) : '') : word
    if (value !== '') out.push(value)
  }
  if (part.coreWords[0] !== undefined && part.coreWords[0].includes('/')) out.push(part.coreWords[0])
  return out
}

/**
 * Every word of a shell part that could name a file the protected paths cover:
 * all the words as written (so a path given as a wrapper's or runner's option
 * value is seen, not only the words left once those are stripped), the words
 * of the command that remains, the redirect targets, the value side of a
 * `name=value` or `--opt=value` word, and what is glued to a wrapper option.
 */
function protectedWordsOf(part: ShellPart): string[] {
  const out = new Set<string>()
  const add = (word: string) => {
    if (word !== '' && !word.includes('$(')) out.add(word)
  }
  for (const word of [...part.words, ...part.coreWords, ...part.redirects.map(r => r.target), ...part.optionValues]) {
    if (word === '' || word.includes('$(')) continue
    if (!word.startsWith('-')) add(word)
    const eq = word.indexOf('=')
    if (eq >= 0) add(word.slice(eq + 1))
  }
  return [...out]
}

function isProtectedPath(candidate: string, matchers: readonly ProtectedMatcher[], context: ClassifyContext, cwd: string): boolean {
  const absolute = resolve(candidate.replace(/^['"]|['"]$/g, ''), cwd, context.home)
  const relative = relativeTo(absolute, context.root)
  const forms = relative !== undefined ? [relative] : [absolute.slice(1)]
  return forms.some(form => touchesProtected(form, matchers))
}

/**
 * Programs that only read what they are given. A shell part naming a
 * write-protected path (a plugin folder) is let through when it is one of
 * these, unless one of its options writes (`WRITING_OPTIONS`).
 */
const READERS: ReadonlySet<string> = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'bat', 'ls', 'tree', 'stat', 'file', 'wc', 'du', 'find',
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'diff', 'cmp', 'sort', 'uniq', 'cut', 'jq', 'yq',
  'md5sum', 'sha1sum', 'sha256sum', 'shasum', 'realpath', 'readlink', 'basename', 'dirname', 'test', '[', 'cd', 'pushd',
])

const hasOption = (words: readonly string[], pattern: RegExp): boolean => words.some(word => pattern.test(word))

/**
 * The options and operands with which a reader writes a file after all: a
 * reader that does is not one. Beyond the brief's own (`find` actions, `jq` and
 * `yq` in place), those of `sort`, `tree`, `less`, `file` and `uniq`, which
 * write to a named file or folder.
 */
const WRITING_OPTIONS: Readonly<Record<string, (words: readonly string[]) => boolean>> = {
  find: words => hasOption(words, /^-(delete|exec|execdir|ok|okdir|fls|fprint\w*)$/),
  jq: words => hasOption(words, /^--in-?place/),
  yq: words => hasOption(words, /^-[A-Za-z0-9]*i[A-Za-z0-9]*$|^--in-?place/),
  sort: words => hasOption(words, /^-[A-Za-z0-9]*[oT]|^--(o|t)/),
  tree: words => hasOption(words, /^-[A-Za-z0-9]*o|^--o/),
  less: words => hasOption(words, /^-[A-Za-z0-9]*[oO]|^--(log|LOG)/),
  file: words => hasOption(words, /^-[A-Za-z0-9]*C|^--compile/),
  uniq: words => words.filter(word => !word.startsWith('-')).length > 1,
}

/**
 * Whether a shell part that names a write-protected path (the words in `hits`)
 * is a read or a run of what it names, which the ordinary rules judge, and not
 * a write:
 * - a read: the program is one of `READERS`, resolved (no unread wrapper
 *   option), none of its options writes, and the path is one of its operands,
 *   not a redirect target, an option value of a wrapper or an assignment;
 * - a run: the path is the program word written as a path, or the script an
 *   interpreter or a shell is given (the ordinary `script-file` or
 *   `script-shell` rule matches, and no code flag or piped code is read).
 * Anything else naming the path writes, or may.
 */
function isReadOrRun(part: ShellPart, hits: readonly string[], matched: readonly CompiledRule[]): boolean {
  if (part.isUnresolved === true || part.isUnreadable === true) return false
  const core = part.coreWords
  const program = core[0]
  if (program === undefined) return false
  // The words before the command (wrappers, assignments, their option values) must not be what names the path.
  const at = part.words.length - core.length
  if (at < 0 || core.some((word, index) => part.words[at + index] !== word)) return false
  const elsewhere = [...part.words.slice(0, at), ...part.optionValues, ...part.redirects.map(redirect => redirect.target)]
  const rest = core.slice(1)
  const isReader = READERS.has(program) && !(WRITING_OPTIONS[program]?.(rest) ?? false)
  const ids = new Set(matched.map(rule => rule.id))
  const isScriptRun = (ids.has('script-file') || ids.has('script-shell')) && !ids.has('script-inline') && !ids.has('script-stdin')
  // The script is the first word that is no option, when options alone come before it.
  const firstOperand = rest.findIndex(word => !word.startsWith('-'))
  const script = isScriptRun && firstOperand >= 0 && rest.slice(0, firstOperand).every(word => word.startsWith('-')) ? rest[firstOperand] : undefined
  const isProgramOk = program.includes('/') || isReader || script !== undefined
  return hits.every(hit => {
    if (elsewhere.some(word => word.includes(hit))) return false
    const operands = rest.filter(word => word === hit).length
    if (hit === program && !isProgramOk) return false
    if (operands === 0) return hit === program
    return isReader || (hit === script && operands === 1 && !/[\s;&|<>$`()]/.test(hit))
  })
}

function subjectsOf(call: Call, context: ClassifyContext): { subjects: Subject[]; tooLong: boolean; cut: boolean } {
  if (SHELL_TOOLS.has(call.tool)) {
    const command = typeof call.input.command === 'string' ? call.input.command : ''
    const split = splitShell(command)
    return {
      subjects: split.parts.map(part => ({ label: part.text, part, candidates: pathWordsOf(part), protectedWords: protectedWordsOf(part) })),
      tooLong: split.isTooLong,
      cut: split.isCut,
    }
  }
  const field = FILE_PATH_FIELDS[call.tool]
  const given = field !== undefined ? call.input[field] : undefined
  if (typeof given === 'string') {
    const absolute = resolve(given, context.cwd, context.home)
    const path = relativeTo(absolute, context.root) ?? absolute
    const candidates = context.realPath !== undefined ? [given, context.realPath] : [given]
    return { subjects: [{ label: path, path, candidates }], tooLong: false, cut: false }
  }
  return { subjects: [{ label: call.tool, candidates: [] }], tooLong: false, cut: false }
}

const SCRIPT_RULES = /^script-/

/** Where a `cd` or `pushd` part goes, or undefined for any other part. */
function cdTargetOf(part: ShellPart | undefined, cwd: string, home?: string): string | undefined {
  if (part === undefined || (part.coreWords[0] !== 'cd' && part.coreWords[0] !== 'pushd')) return undefined
  const target = part.coreWords.find((word, index) => index > 0 && !word.startsWith('-')) ?? home ?? '/'
  return /[$`]|^-$/.test(target) ? '/' : resolve(target, cwd, home)
}

/**
 * Where a shell part leaves the working directory: `cd` and `pushd` (not
 * nested) move where later parts' paths land. A target the parser cannot
 * know (a variable, `-`) lands anywhere: `/`. The one copy, shared by
 * `classify` and `targetsOf`; `cwdTracker` is the same logic that also follows
 * a `cd` inside a nested level.
 */
export function cwdAfter(part: ShellPart | undefined, cwd: string, home?: string): string {
  if (part !== undefined && part.isNested) return cwd
  return cdTargetOf(part, cwd, home) ?? cwd
}

/** Where a part runs: before and after its own `cd`, for the levels the shell keeps apart. */
type Step = {
  /** The folders it may run in: the one the nesting levels give, and the one that ignores a `cd` in a nested level. */
  before: readonly string[]
  /** The same, after the part's own `cd`. */
  after: readonly string[]
  /** A wrapper or runner option moved it somewhere unknown: `/` too. */
  isUnknown: boolean
}

/**
 * Follows the working directory through the parts of a command, in order. A
 * `cd` moves the folder for the later parts of its own nesting level (a
 * subshell, a `$(...)`, an `sh -c` script, at any depth) and for the levels
 * opened after it; the level that holds it, and the top level after a
 * subshell, are unaffected. The folder as it was kept before nested levels
 * were followed (a nested `cd` ignored) is returned too, so following them
 * only ever adds a place to look at.
 */
export function cwdTracker(start: string, home?: string): (part: ShellPart | undefined) => Step {
  const levels = new Map<number, string>([[0, start]])
  let top = start
  return part => {
    if (part === undefined) return { before: [top], after: [top], isUnknown: false }
    const held = part.parentScope !== undefined ? levels.get(part.parentScope) : undefined
    const here = levels.get(part.scope) ?? held ?? top
    const legacyBefore = top
    const moved = cdTargetOf(part, here, home)
    const after = moved ?? here
    levels.set(part.scope, after)
    if (!part.isNested) top = cdTargetOf(part, top, home) ?? top
    const legacyAfter = top
    const distinct = (a: string, b: string): string[] => (a === b ? [a] : [a, b])
    return { before: distinct(here, legacyBefore), after: distinct(after, legacyAfter), isUnknown: part.movesDir }
  }
}

/**
 * The shell parts that force-push the checked-out branch (no refspec, or one
 * on `HEAD`) and the directory each runs in, after any `cd`. Empty for any
 * other call, which is how a call that needs no branch lookup pays for none.
 * A part with two possible folders (see `cwdTracker`) is listed once for each.
 * `isHeadMoved` says an earlier part of the call can move HEAD, so whatever
 * branch is read, a later force push of the current branch counts as unknown
 * (`classify` applies it; a protected branch read still blocks).
 */
export function forcePushPlaces(call: Call, context: ClassifyContext): { part: ShellPart; cwd: string; isHeadMoved: boolean }[] {
  if (!SHELL_TOOLS.has(call.tool)) return []
  const command = typeof call.input.command === 'string' ? call.input.command : ''
  const places: { part: ShellPart; cwd: string; isHeadMoved: boolean }[] = []
  const step = cwdTracker(context.cwd, context.home)
  let isHeadMoved = false
  for (const part of splitShell(command).parts) {
    const { after } = step(part)
    if (forcesCurrentBranch(part)) for (const cwd of after) places.push({ part, cwd, isHeadMoved })
    if (mayMoveHead(part)) isHeadMoved = true
  }
  return places
}

/** A place a call touches (C5): a working directory, or a path it names. */
export type Target = { path: string; isWorkingDir: boolean }

/**
 * Where a call works and what it names, absolute, in the order met (the first
 * is where the call starts). A shell part runs in the directory before its own
 * `cd`; a file tool's path (and its real path) count as working directories,
 * so a file outside every repository falls to the root's rules.
 */
export function targetsOf(call: Call, context: ClassifyContext): Target[] {
  if (SHELL_TOOLS.has(call.tool)) {
    const targets: Target[] = []
    let cwd = context.cwd
    for (const subject of subjectsOf(call, context).subjects) {
      targets.push({ path: cwd, isWorkingDir: true })
      // A wrapper option moved the part somewhere unknown: `/` is a place it works in too.
      if (subject.part?.movesDir === true) targets.push({ path: '/', isWorkingDir: true })
      for (const word of subject.candidates) {
        targets.push({ path: resolve(word.replace(/^['"]|['"]$/g, ''), cwd, context.home), isWorkingDir: false })
      }
      cwd = cwdAfter(subject.part, cwd, context.home)
    }
    return targets.length === 0 ? [{ path: context.cwd, isWorkingDir: true }] : targets
  }
  const field = FILE_PATH_FIELDS[call.tool]
  const given = field !== undefined ? call.input[field] : undefined
  if (typeof given === 'string') {
    const files = [resolve(given, context.cwd, context.home), ...(context.realPath !== undefined ? [context.realPath] : [])]
    return files.map(path => ({ path, isWorkingDir: true }))
  }
  return [{ path: context.cwd, isWorkingDir: true }]
}

/**
 * What an unconfirmed file's rules add to a call's shipped decision (`base`,
 * the call as the shipped rules and the confirmed rules decide it): they only
 * add. A block blocks; an ask or a review rule raises a call the shipped rules
 * let through; an ask rule on a call they review is handed back as `alsoAsk`.
 * It is the call's tier that counts, not one part's: a part the shipped rules
 * allow, in a call they review, takes nothing away from that review.
 */
export function applyAdditions(base: Classification, unconfirmed: readonly Finding[]): Classification {
  const addition = strictest(unconfirmed)
  if (addition === undefined) return base
  const others = unconfirmed.filter(finding => finding !== addition)
  if (addition.tier === 'ask' && base.tier === 'review') return { ...base, added: [...base.added, ...unconfirmed], alsoAsk: addition }
  if (strictness(addition.tier) > strictness(base.tier)) {
    const findings = [...base.findings, addition]
    return { ...base, tier: addition.tier, decided: strictest(findings) as Finding, findings, added: [...base.added, ...others] }
  }
  return { ...base, added: [...base.added, ...unconfirmed] }
}

/**
 * The call as the shipped rules and the rules of a confirmed file decide it,
 * with the rules of a file nobody has confirmed set apart (`unconfirmed`, each
 * with the part and folder it matched in): `applyAdditions` puts them on top.
 * One scope's `classify` is the two together.
 */
export function classifyBase(call: Call, config: CompiledConfig, context: ClassifyContext): { base: Classification; unconfirmed: Finding[] } {
  const checkContext: CheckContext = {
    ...context,
    protectedBranches: config.protectedBranches,
    production: config.production,
  }
  const inputJson = JSON.stringify(call.input)
  const { subjects, tooLong, cut } = subjectsOf(call, context)
  const findings: Finding[] = []
  const unconfirmed: Finding[] = []
  const scriptPaths: string[] = []
  let isProtected = false

  if (tooLong || cut) {
    findings.push({
      tier: 'review',
      ruleId: tooLong ? 'command-too-long' : 'command-too-complex',
      source: 'shipped',
      reason: tooLong ? 'The command is too long to classify.' : 'The command is too complex to classify fully.',
      subject: call.tool,
    })
  }

  // Each part is looked at where it runs. A folder the nesting levels give and
  // the folder that ignores a nested `cd` are both tried, and a part whose
  // wrapper moved it somewhere unknown is also tried at `/`: the strictest wins.
  const track = cwdTracker(context.cwd, context.home)
  // An earlier part that can move HEAD (or runs something unread) makes the branch read before the call unsure for the parts after it.
  let isHeadMoved = false
  for (const subject of subjects) {
    const part = subject.part
    const { after, isUnknown } = track(part)
    let best: { deciding: Finding; cwd: string } | undefined
    for (const cwd of isUnknown ? [...after, '/'] : after) {
      const partContext = { ...checkContext, cwd, isHeadMoved }
      const matches = config.rules.filter(rule => ruleMatches(rule, call, subject, inputJson, partContext))
      const project = matches.find(rule => rule.source === 'project' && rule.isUnconfirmed !== true)
      const shipped = matches.filter(rule => rule.source === 'shipped')
      const floor: Finding[] = shipped.filter(rule => rule.tier === 'block').map(rule => toFinding(rule, subject.label))
      for (const rule of matches.filter(rule => rule.isUnconfirmed === true)) {
        const finding = { ...toFinding(rule, subject.label), ...(part !== undefined && { part, cwd }) }
        if (!unconfirmed.some(known => known.ruleId === finding.ruleId && known.subject === finding.subject)) unconfirmed.push(finding)
      }

      const words = subject.protectedWords ?? subject.candidates
      const protectedHit = words.some(candidate => isProtectedPath(candidate, config.protectedPaths, context, cwd))
      // A write-protected path asks for a write; a shell part that only reads it, or runs what it names, is judged by the ordinary rules.
      const writeHits = words.filter(candidate => isProtectedPath(candidate, config.writeProtectedPaths, context, cwd))
      const isWriteHit = writeHits.length > 0 && (part === undefined || !isReadOrRun(part, writeHits, shipped))
      if (protectedHit || isWriteHit) {
        isProtected = true
        floor.push({
          tier: 'ask',
          ruleId: 'protected-path',
          source: 'protected',
          reason: 'Touches a protected path.',
          subject: subject.label,
        })
      }

      const decision =
        project !== undefined
          ? toFinding(project, subject.label)
          : strictest(shipped.map(rule => toFinding(rule, subject.label)))
      const deciding = strictest([...(decision !== undefined ? [decision] : []), ...floor])
      if (deciding !== undefined && (best === undefined || strictness(deciding.tier) > strictness(best.deciding.tier))) best = { deciding, cwd }
    }
    if (part !== undefined && mayMoveHead(part)) isHeadMoved = true
    if (best === undefined || best.deciding.tier === 'allow') continue
    findings.push(part !== undefined ? { ...best.deciding, part, cwd: best.cwd } : best.deciding)
    if (SCRIPT_RULES.test(best.deciding.ruleId) && subject.part !== undefined) {
      scriptPaths.push(...pathWordsOf(subject.part).filter(word => /[./]/.test(word)))
    }
  }

  const decided = strictest(findings)
  return {
    base: {
      tier: decided?.tier ?? 'allow',
      ...(decided !== undefined && { decided }),
      findings,
      isProtected,
      scriptPaths: [...new Set(scriptPaths)],
      added: [],
    },
    unconfirmed,
  }
}

/**
 * The tier of a call, by the rules alone: pure, no I/O.
 *
 * Per subject (each shell part, or the file path): a project rule of a
 * confirmed file that matches decides first, else the strictest shipped rule
 * that matches; shipped block rules and protected paths are a floor no project
 * rule lowers. The call takes its strictest subject. Nothing matching is
 * allow. The rules of a file nobody has confirmed (`isUnconfirmed`) come last,
 * on the call as a whole, and only add (`applyAdditions`).
 */
export function classify(call: Call, config: CompiledConfig, context: ClassifyContext): Classification {
  const { base, unconfirmed } = classifyBase(call, config, context)
  return applyAdditions(base, unconfirmed)
}
