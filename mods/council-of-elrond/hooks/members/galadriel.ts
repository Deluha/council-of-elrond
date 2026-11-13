import { cut } from './shared.js'
import type { Cut } from './shared.js'
import { FILE_PATH_FIELDS, SHELL_TOOLS } from '../rules/classify.js'
import type { Call, Classification } from '../rules/classify.js'
import type { ShellPart } from '../rules/shell.js'
import { relativeTo, resolve } from '../rules/paths.js'
import { parsePush } from '../rules/push.js'

/**
 * Galadriel, the mirror: a read-only preview of what a gated call would
 * touch. The inspections come from a fixed table in this file; the call's
 * targets are passed only as data (after `--`, or checked as plain names),
 * and nothing of the proposed command is ever run. No preview is fine: it
 * is never a reason to allow or block.
 */

export type Inspection =
  /** Lists a path the call names: `$.fs.stat`, then `$.fs.list` for a folder. No process. */
  | { kind: 'path'; label: string; path: string }
  /**
   * A read-only git command from the table. `orElse` is a second table entry,
   * tried only when the first fails; it is an alternative, not a step.
   */
  | {
      kind: 'git'
      label: string
      argv: readonly string[]
      orElse?: { label: string; argv: readonly string[] }
      /** The folder the call's own `cd` leads to inside the root; absent, git runs where the session's rules scope says. */
      cwd?: string
      /** This step lists the commits one refspec of a push would send; if it reads nothing, the preview says so. */
      isCommits?: boolean
    }
  /** A line of the preview no process produces: what the preview could not show. Not counted against the cap. */
  | { kind: 'note'; label: string }

export type InspectionResult =
  | { kind: 'path'; label: string; state: 'missing' }
  | { kind: 'path'; label: string; state: 'file'; size: number }
  | { kind: 'path'; label: string; state: 'dir'; entries: readonly string[]; total: number }
  | { kind: 'git'; label: string; exitCode: number; stdout: string }
  | { kind: 'note'; label: string }
  | { kind: 'failed'; label: string }

export const MAX_INSPECTIONS = 3
/** A push's refspecs that get their own commits and changes; the rest are said to be left out. */
export const MAX_PUSH_REFSPECS = 3
export const INSPECTION_TIMEOUT_MS = 5_000
export const MAX_LISTED = 20

/** A ref or remote name safe to hand git as an argument: never an option. */
const SAFE_REF = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/@{}^~-]{1,200}$/

const positionals = (words: readonly string[]): string[] => words.filter(word => word !== '' && !word.startsWith('-'))

const hasGlob = (word: string): boolean => /[*?[\]{}]/.test(word)

/** Options that point git at another repository: a preview there is not ours to guess. */
const ELSEWHERE = /^(-C|-c|--git-dir|--work-tree|--namespace)(=|$)/

/** An assignment of a variable that moves git's repository, work tree, index, objects or namespace. */
const GIT_LOCATION_NAMES = 'GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|NAMESPACE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES)='
const GIT_LOCATION = new RegExp(`(^|[\\s;&|(])(export\\s+)?${GIT_LOCATION_NAMES}`)
const GIT_LOCATION_WORD = new RegExp(`^${GIT_LOCATION_NAMES}`)

/** Where a git part runs: the call's command text, the root, and the part's working directory (after any `cd`). */
export type GitPlace = { command: string; root: string; cwd: string }

/**
 * Whether git would run somewhere the mod's own git cannot show: an option
 * that points it elsewhere, a location variable set anywhere in the command
 * (an earlier `export GIT_DIR=...;` counts, as does `env GIT_WORK_TREE=...`),
 * or a working directory outside the root, which includes the `/` an
 * unknowable `cd` lands at. Erring toward "elsewhere" is the safe side: no
 * preview, no range diff, and an unknown current branch.
 */
export function runsElsewhere(part: ShellPart, place: GitPlace): boolean {
  return (
    part.words.some(word => ELSEWHERE.test(word) || GIT_LOCATION_WORD.test(word)) ||
    GIT_LOCATION.test(place.command) ||
    relativeTo(place.cwd, place.root) === undefined
  )
}

/** The command text of a shell call; empty for anything else. */
const commandOf = (call: Call): string => (typeof call.input.command === 'string' ? call.input.command : '')

/** The subcommand and its arguments; the parser has already dropped git's global options. */
function gitArgs(part: ShellPart, place: GitPlace): { sub: string; rest: readonly string[] } | undefined {
  if (runsElsewhere(part, place)) return undefined
  const sub = part.coreWords[1]
  return sub === undefined ? undefined : { sub, rest: part.coreWords.slice(2) }
}

/** What one refspec of a push would send, as a git range of its own source. */
type PushRange = {
  /** `<remote>/<destination>..<source>`; `@{upstream}..HEAD` for a push that names no refspec. */
  range: string
  /** What is pushed: the range's end. */
  source: string
  /** The remote's default branch (`<remote>/HEAD`), for a branch the remote doesn't have yet; only a named remote has one. */
  fallback?: string
}

type PushPlan = {
  remote?: string
  ranges: PushRange[]
  /** Refspecs, among those looked at, whose commits cannot be named (a source or destination that is not a safe ref, or no remote to compare with). */
  unseen: number
  /** Refspecs past MAX_PUSH_REFSPECS, which are not looked at. */
  past: number
  /** How many refspecs the push names. */
  total: number
  /** `--all`, `--mirror` or `--tags` with no refspec: the push sends more than the current branch's commits shown. */
  isBroad: boolean
}

/** The line said, trusted, when what some refspecs would send could not be shown. */
export const unseenPushNote = (count: number): string =>
  `The commits ${count === 1 ? 'one refspec' : `${count} refspecs`} of this push would send could not be shown, so what ${count === 1 ? 'it sends is' : 'they send is'} unknown.`

const pastPushNote = (total: number): string =>
  `This push names ${total} refspecs and commits are shown for the first ${MAX_PUSH_REFSPECS} only, so what the others would send is unknown.`

/** The line said, trusted, when a push of every branch or tag is shown as the current branch's commits only. */
export const broadPushNote = 'This push sends more branches or tags than the commits shown: only the current branch is listed, so what the others would send is unknown.'

/** The notes a push plan calls for, one line each. */
const pushNotes = (plan: PushPlan): string[] => [
  ...(plan.unseen > 0 ? [unseenPushNote(plan.unseen)] : []),
  ...(plan.past > 0 ? [pastPushNote(plan.total)] : []),
  ...(plan.isBroad ? [broadPushNote] : []),
]

/** Flags that send more than the refspecs name (or, with none, more than the current branch). */
const BROAD_PUSH_FLAGS: ReadonlySet<string> = new Set(['--all', '--mirror', '--tags'])

/**
 * What a push would send, per refspec: its own source against the remote's
 * branch it lands on, never the checked-out branch unless the refspec names
 * it. A delete sends no commits and has no range. A push that names no
 * refspec sends the current branch: `@{upstream}..HEAD`.
 */
function pushPlan(rest: readonly string[]): PushPlan {
  const push = parsePush(rest)
  const remote = push.remote !== undefined && SAFE_REF.test(push.remote) ? push.remote : undefined
  const fallback = remote === undefined ? undefined : `${remote}/HEAD`
  const base = { ...(remote !== undefined && { remote }) }
  if (push.refspecs.length === 0) {
    return {
      ...base,
      ranges: [{ range: '@{upstream}..HEAD', source: 'HEAD', ...(fallback !== undefined && { fallback }) }],
      unseen: 0,
      past: 0,
      total: 0,
      isBroad: rest.some(word => BROAD_PUSH_FLAGS.has(word)),
    }
  }
  const ranges = new Map<string, PushRange>()
  let unseen = 0
  for (const spec of push.refspecs.slice(0, MAX_PUSH_REFSPECS)) {
    if (push.isDelete || spec.source === '') continue
    if (remote === undefined || !SAFE_REF.test(spec.source) || !SAFE_REF.test(spec.destination)) {
      unseen++
      continue
    }
    const range = `${remote}/${spec.destination}..${spec.source}`
    ranges.set(range, { range, source: spec.source, ...(fallback !== undefined && { fallback }) })
  }
  return { ...base, ranges: [...ranges.values()], unseen, past: Math.max(0, push.refspecs.length - MAX_PUSH_REFSPECS), total: push.refspecs.length, isBroad: false }
}

/** The ref a merge names, past the options that take a value. */
function mergeRef(rest: readonly string[]): string | undefined {
  const valued = new Set(['-m', '-F', '-s', '-X', '--file', '--strategy', '--strategy-option', '--cleanup', '--into-name'])
  return positionals(rest.filter((word, i) => !valued.has(rest[i - 1] ?? ''))).find(word => SAFE_REF.test(word))
}

/** A push's steps, and how many of them are commit lists past the first (they raise the cap by that much). */
function pushInspections(rest: readonly string[]): { steps: Inspection[]; extra: number } {
  const plan = pushPlan(rest)
  const logs = plan.ranges.map(
    ({ range, source, fallback }): Inspection => ({
      kind: 'git',
      label: `commits it would send (${range})`,
      argv: ['git', 'log', '--oneline', '-n', '30', range, '--'],
      isCommits: true,
      ...(fallback !== undefined && {
        orElse: {
          label: `commits it would send (${fallback}..${source}: the remote has no such branch yet, so against its default branch)`,
          argv: ['git', 'log', '--oneline', '-n', '30', `${fallback}..${source}`, '--'],
        },
      }),
    }),
  )
  return {
    steps: [
      { kind: 'git', label: 'current branch', argv: ['git', 'rev-parse', '--abbrev-ref', 'HEAD'] },
      ...(plan.remote !== undefined ? [{ kind: 'git' as const, label: `remote ${plan.remote}`, argv: ['git', 'remote', 'get-url', plan.remote] }] : []),
      ...logs,
      ...pushNotes(plan).map((label): Inspection => ({ kind: 'note', label })),
    ],
    extra: Math.max(0, logs.length - 1),
  }
}

/** Recent history, decorated so the reviewer sees which commits a remote branch already holds. */
const HISTORY: readonly Inspection[] = [
  { kind: 'git', label: 'recent commits', argv: ['git', 'log', '--oneline', '--decorate=short', '-n', '20', '--'] },
  { kind: 'git', label: 'uncommitted changes', argv: ['git', 'status', '--porcelain'] },
]

/** A merge shows the current branch and the commits it would bring in. */
function mergeInspections(rest: readonly string[]): Inspection[] {
  const ref = mergeRef(rest)
  return [
    { kind: 'git', label: 'current branch', argv: ['git', 'rev-parse', '--abbrev-ref', 'HEAD'] },
    ...(ref !== undefined
      ? [{ kind: 'git' as const, label: `commits it would bring in (HEAD..${ref})`, argv: ['git', 'log', '--oneline', '-n', '30', `HEAD..${ref}`, '--'] }]
      : []),
  ]
}

export type PlanContext = { root: string; cwd: string; home?: string }

/**
 * The git steps tagged with the folder of a part that `cd`s inside the root.
 * A part working where the session does gets none: git then runs where the
 * rules scope says, as it always has.
 */
function inFolder(steps: readonly Inspection[], cwd: string, sessionCwd: string): Inspection[] {
  return cwd === sessionCwd ? [...steps] : steps.map(step => (step.kind === 'git' ? { ...step, cwd } : step))
}

/**
 * Where the current branch of a call with a merge is read, for whether the
 * merge lands on a protected branch. Undefined when any merge part would run
 * elsewhere (the branch is then unknown); otherwise the first merge part's
 * folder, absent when that part works where the session does.
 */
export function mergePlace(call: Call, classification: Classification, context: PlanContext): { cwd?: string } | undefined {
  const merges = classification.findings.filter(
    finding => finding.part !== undefined && finding.part.coreWords[0] === 'git' && finding.part.coreWords[1] === 'merge',
  )
  const command = commandOf(call)
  for (const finding of merges) {
    if (finding.part !== undefined && runsElsewhere(finding.part, { command, root: context.root, cwd: finding.cwd ?? context.cwd })) return undefined
  }
  const cwd = merges[0]?.cwd ?? context.cwd
  return cwd === context.cwd ? {} : { cwd }
}

/**
 * The inspections for a gated call, from the table alone: deletes list their
 * targets, a push shows the branch, remote and commits it would send, a
 * merge the commits it would bring in, a reset, rebase or amend shows recent
 * history (decorated with remote branches), a file write shows the file's diff
 * and whether git tracks it. Anything else has no preview.
 */
export function planPreview(call: Call, classification: Classification, context: PlanContext): Inspection[] {
  const field = FILE_PATH_FIELDS[call.tool]
  const given = field === undefined ? undefined : call.input[field]
  if (typeof given === 'string') {
    const absolute = resolve(given, context.cwd, context.home)
    const relative = relativeTo(absolute, context.root)
    if (relative === undefined || relative === '') return []
    return [
      // No configured program starts: not an external diff driver, not a textconv filter.
      { kind: 'git', label: `diff of ${relative} against the last commit`, argv: ['git', 'diff', '--stat', '--no-ext-diff', '--no-textconv', 'HEAD', '--', relative] },
      { kind: 'git', label: `whether git tracks ${relative}`, argv: ['git', 'ls-files', '--error-unmatch', '--', relative] },
    ]
  }
  if (!SHELL_TOOLS.has(call.tool)) return []

  const plan: Inspection[] = []
  // A push with several refspecs lists the commits of each: its extra lists raise the cap, as the notes never count.
  let allowed = MAX_INSPECTIONS
  for (const finding of classification.findings) {
    const part = finding.part
    if (part === undefined) continue
    const words = part.coreWords
    const program = (words[0] ?? '').slice((words[0] ?? '').lastIndexOf('/') + 1)
    const cwd = finding.cwd ?? context.cwd
    if (['rm', 'rmdir', 'unlink', 'shred', 'srm', 'trash'].includes(program) || (program === 'find' && /\s-delete(\s|$)/.test(part.core))) {
      // find: its start folders come before the first expression.
      const end = program === 'find' ? words.findIndex((word, i) => i > 0 && word.startsWith('-')) : -1
      const args = words.slice(1, end === -1 ? undefined : end)
      for (const target of positionals(args)) {
        if (hasGlob(target) || /[$`]/.test(target)) continue
        const path = resolve(target, cwd, context.home)
        plan.push({ kind: 'path', label: `${program} target ${target}`, path })
      }
    } else if (program === 'git') {
      const git = gitArgs(part, { command: commandOf(call), root: context.root, cwd })
      if (git === undefined) continue
      let steps: readonly Inspection[] = []
      if (git.sub === 'push') {
        const pushed = pushInspections(git.rest)
        steps = pushed.steps
        allowed += pushed.extra
      } else if (git.sub === 'merge') steps = mergeInspections(git.rest)
      else if (['reset', 'rebase'].includes(git.sub) || (git.sub === 'commit' && git.rest.includes('--amend'))) steps = HISTORY
      plan.push(...inFolder(steps, cwd, context.cwd))
    }
    if (plan.filter(step => step.kind !== 'note').length >= allowed) break
  }
  // One of each: a compound command can name the same inspection twice.
  // The folder is part of the key: the same command in two folders is two inspections.
  const unique = new Map(plan.map(step => [step.kind === 'git' ? [step.cwd ?? '', ...step.argv].join('\u0000') : step.kind === 'note' ? `note\u0000${step.label}` : step.path, step]))
  let kept = 0
  return [...unique.values()].filter(step => step.kind === 'note' || ++kept <= allowed)
}

/**
 * The preview text: each inspection's result under its label, cut to the line
 * limit (its start and its end), with what the cut left out. `redactText` runs
 * on the whole text before the cut, so a cut never splits a secret.
 */
export function formatPreviewCut(results: readonly InspectionResult[], maxLines: number, redactText: (text: string) => string = value => value): Cut | undefined {
  const blocks: string[] = []
  for (const result of results) {
    if (result.kind === 'failed') continue
    if (result.kind === 'note') {
      blocks.push(result.label)
      continue
    }
    if (result.kind === 'path') {
      if (result.state === 'missing') blocks.push(`${result.label}: does not exist`)
      else if (result.state === 'file') blocks.push(`${result.label}: a file, ${result.size} bytes`)
      else {
        const more = result.total > result.entries.length ? `\n  … and ${result.total - result.entries.length} more` : ''
        blocks.push(`${result.label}: a folder with ${result.total} entries${result.entries.map(name => `\n  ${name}`).join('')}${more}`)
      }
      continue
    }
    const out = result.stdout.trimEnd()
    if (result.label.startsWith('whether git tracks')) {
      blocks.push(`${result.label}: ${result.exitCode === 0 ? 'yes' : 'no (untracked or new)'}`)
    } else if (result.exitCode === 0) {
      blocks.push(`${result.label}:${out === '' ? ' (none)' : `\n${out.replace(/^/gm, '  ')}`}`)
    }
  }
  if (blocks.length === 0) return undefined
  return cut(redactText(blocks.join('\n')), maxLines, maxLines * 200)
}

/** `formatPreviewCut`'s text. */
export const formatPreview = (results: readonly InspectionResult[], maxLines: number): string | undefined => formatPreviewCut(results, maxLines)?.text

/**
 * The note for the commit lists of a plan that read nothing (git failed, timed
 * out, or the folder is not one it may run in): what that refspec would send
 * is as unknown as for one whose ref could not be named. `results` line up
 * with `plan`, one each.
 */
export function unreadCommitsNote(plan: readonly Inspection[], results: readonly InspectionResult[]): string | undefined {
  const unread = plan.filter((step, index) => {
    const result = results[index]
    return step.kind === 'git' && step.isCommits === true && !(result?.kind === 'git' && result.exitCode === 0)
  }).length
  return unread > 0 ? unseenPushNote(unread) : undefined
}

/**
 * For the full council's diff reviewer: the changes a push would send, or a
 * merge would bring in, as read-only `git diff`s from this table: one per
 * refspec of a push (at most MAX_PUSH_REFSPECS), each from its own source.
 * The ranges come from the same validated refs the preview uses; a call git
 * would run elsewhere (`-C`, `--git-dir`, a location variable, a folder
 * outside the root) gets none (undefined); one that `cd`s inside the root
 * carries that folder. `notes` say, trusted, which refspecs have no diff.
 */
export function rangeDiffInspections(
  kind: 'push' | 'merge',
  part: ShellPart,
  call: Call,
  context: PlanContext,
  partCwd: string = context.cwd,
): { inspections: Inspection[]; notes: string[] } | undefined {
  const git = gitArgs(part, { command: commandOf(call), root: context.root, cwd: partCwd })
  if (git === undefined) return undefined
  const diff = (against: string): string[] => ['git', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', against, '--']
  const place = partCwd !== context.cwd ? { cwd: partCwd } : {}
  if (kind === 'merge') {
    const ref = mergeRef(git.rest)
    return ref === undefined ? undefined : { inspections: [{ kind: 'git', label: `HEAD...${ref}`, argv: diff(`HEAD...${ref}`), ...place }], notes: [] }
  }
  const plan = pushPlan(git.rest)
  return {
    inspections: plan.ranges.map(
      ({ range, source, fallback }): Inspection => ({
        kind: 'git',
        label: range,
        argv: diff(range),
        // Three dots: the changes since the branch point, which is what a new branch adds to the remote.
        ...(fallback !== undefined && { orElse: { label: `${fallback}...${source}`, argv: diff(`${fallback}...${source}`) } }),
        ...place,
      }),
    ),
    notes: pushNotes(plan),
  }
}
