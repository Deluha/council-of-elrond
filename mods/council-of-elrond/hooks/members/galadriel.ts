import { truncate } from './shared.js'
import { FILE_PATH_FIELDS, SHELL_TOOLS } from '../rules/classify.js'
import type { Call, Classification } from '../rules/classify.js'
import type { ShellPart } from '../rules/shell.js'
import { PUSH_OPTIONS_WITH_ARG } from '../rules/checks.js'
import { relativeTo, resolve } from '../rules/paths.js'

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
    }

export type InspectionResult =
  | { kind: 'path'; label: string; state: 'missing' }
  | { kind: 'path'; label: string; state: 'file'; size: number }
  | { kind: 'path'; label: string; state: 'dir'; entries: readonly string[]; total: number }
  | { kind: 'git'; label: string; exitCode: number; stdout: string }
  | { kind: 'failed'; label: string }

export const MAX_INSPECTIONS = 3
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

/**
 * The remote a push names, and the commits it would send as a git range.
 * `fallback` is the remote's default branch (`<remote>/HEAD`), for a branch
 * the remote doesn't have yet; only a named remote has one.
 */
function pushRange(rest: readonly string[]): { remote?: string; range: string; fallback?: string } {
  // An option's value is not a remote or a refspec (`-o ci.skip`).
  const kept: string[] = []
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i] as string
    if (PUSH_OPTIONS_WITH_ARG.has(word)) i++
    else kept.push(word)
  }
  const words = positionals(kept)
  const remote = words[0] !== undefined && SAFE_REF.test(words[0]) ? words[0] : undefined
  const refspec = words[1]
  const destination =
    refspec === undefined ? undefined : refspec.slice(refspec.indexOf(':') + 1).replace(/^\+/, '').replace(/^refs\/heads\//, '')
  const range =
    remote !== undefined && destination !== undefined && SAFE_REF.test(destination)
      ? `${remote}/${destination}..HEAD`
      : '@{upstream}..HEAD'
  return { ...(remote !== undefined && { remote, fallback: `${remote}/HEAD` }), range }
}

/** The ref a merge names, past the options that take a value. */
function mergeRef(rest: readonly string[]): string | undefined {
  const valued = new Set(['-m', '-F', '-s', '-X', '--file', '--strategy', '--strategy-option', '--cleanup', '--into-name'])
  return positionals(rest.filter((word, i) => !valued.has(rest[i - 1] ?? ''))).find(word => SAFE_REF.test(word))
}

function pushInspections(rest: readonly string[]): Inspection[] {
  const { remote, range, fallback } = pushRange(rest)
  return [
    { kind: 'git', label: 'current branch', argv: ['git', 'rev-parse', '--abbrev-ref', 'HEAD'] },
    ...(remote !== undefined ? [{ kind: 'git' as const, label: `remote ${remote}`, argv: ['git', 'remote', 'get-url', remote] }] : []),
    {
      kind: 'git',
      label: `commits it would send (${range})`,
      argv: ['git', 'log', '--oneline', '-n', '30', range, '--'],
      ...(fallback !== undefined && {
        orElse: {
          label: `commits it would send (${fallback}..HEAD: the remote has no such branch yet, so against its default branch)`,
          argv: ['git', 'log', '--oneline', '-n', '30', `${fallback}..HEAD`, '--'],
        },
      }),
    },
  ]
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
      if (git.sub === 'push') steps = pushInspections(git.rest)
      else if (git.sub === 'merge') steps = mergeInspections(git.rest)
      else if (['reset', 'rebase'].includes(git.sub) || (git.sub === 'commit' && git.rest.includes('--amend'))) steps = HISTORY
      plan.push(...inFolder(steps, cwd, context.cwd))
    }
    if (plan.length >= MAX_INSPECTIONS) break
  }
  // One of each: a compound command can name the same inspection twice.
  // The folder is part of the key: the same command in two folders is two inspections.
  const unique = new Map(plan.map(step => [step.kind === 'git' ? [step.cwd ?? '', ...step.argv].join('\u0000') : step.path, step]))
  return [...unique.values()].slice(0, MAX_INSPECTIONS)
}

/** The preview text: each inspection's result under its label, cut to the line limit. */
export function formatPreview(results: readonly InspectionResult[], maxLines: number): string | undefined {
  const blocks: string[] = []
  for (const result of results) {
    if (result.kind === 'failed') continue
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
  return truncate(blocks.join('\n'), maxLines, maxLines * 200)
}

/**
 * For the full council's diff reviewer: the changes a push would send, or a
 * merge would bring in, as one read-only `git diff` from this table. The
 * range comes from the same validated refs the preview uses; a call git
 * would run elsewhere (`-C`, `--git-dir`, a location variable, a folder
 * outside the root) gets none; one that `cd`s inside the root carries that folder.
 */
export function rangeDiffInspection(
  kind: 'push' | 'merge',
  part: ShellPart,
  call: Call,
  context: PlanContext,
  partCwd: string = context.cwd,
): Inspection | undefined {
  const git = gitArgs(part, { command: commandOf(call), root: context.root, cwd: partCwd })
  if (git === undefined) return undefined
  const pushed = kind === 'push' ? pushRange(git.rest) : undefined
  const range = pushed !== undefined ? pushed.range : (() => {
    const ref = mergeRef(git.rest)
    return ref === undefined ? undefined : `HEAD...${ref}`
  })()
  if (range === undefined) return undefined
  const diff = (against: string): string[] => ['git', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', against, '--']
  // Three dots: the changes since the branch point, which is what a new branch adds to the remote.
  const orElse = pushed?.fallback === undefined ? undefined : { label: `${pushed.fallback}...HEAD`, argv: diff(`${pushed.fallback}...HEAD`) }
  return { kind: 'git', label: range, argv: diff(range), ...(orElse !== undefined && { orElse }), ...(partCwd !== context.cwd && { cwd: partCwd }) }
}
