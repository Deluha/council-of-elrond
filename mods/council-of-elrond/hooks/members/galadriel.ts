import { truncate } from './shared.js'
import { FILE_PATH_FIELDS, SHELL_TOOLS } from '../rules/classify.js'
import type { Call, Classification } from '../rules/classify.js'
import type { ShellPart } from '../rules/shell.js'
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
  /** A read-only git command from the table. */
  | { kind: 'git'; label: string; argv: readonly string[] }

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

const unquote = (word: string): string => word.replace(/^['"]|['"]$/g, '')

const positionals = (words: readonly string[]): string[] => words.filter(word => word !== '' && !word.startsWith('-'))

const hasGlob = (word: string): boolean => /[*?[\]{}]/.test(word)

/** Options that point git at another repository: a preview there is not ours to guess. */
const ELSEWHERE = /^(-C|-c|--git-dir|--work-tree)(=|$)/

/** The subcommand and its arguments; the parser has already dropped git's global options. */
function gitArgs(part: ShellPart): { sub: string; rest: readonly string[] } | undefined {
  if (part.words.some(word => ELSEWHERE.test(word))) return undefined
  const sub = part.coreWords[1]
  return sub === undefined ? undefined : { sub, rest: part.coreWords.slice(2) }
}

/** The remote a push names, and the commits it would send as a git range. */
function pushRange(rest: readonly string[]): { remote?: string; range: string } {
  const words = positionals(rest)
  const remote = words[0] !== undefined && SAFE_REF.test(words[0]) ? words[0] : undefined
  const refspec = words[1]
  const destination =
    refspec === undefined ? undefined : refspec.slice(refspec.indexOf(':') + 1).replace(/^\+/, '').replace(/^refs\/heads\//, '')
  const range =
    remote !== undefined && destination !== undefined && SAFE_REF.test(destination)
      ? `${remote}/${destination}..HEAD`
      : '@{upstream}..HEAD'
  return { ...(remote !== undefined && { remote }), range }
}

/** The ref a merge names, past the options that take a value. */
function mergeRef(rest: readonly string[]): string | undefined {
  const valued = new Set(['-m', '-F', '-s', '-X', '--file', '--strategy', '--strategy-option', '--cleanup', '--into-name'])
  return positionals(rest.filter((word, i) => !valued.has(rest[i - 1] ?? ''))).find(word => SAFE_REF.test(word))
}

function pushInspections(rest: readonly string[]): Inspection[] {
  const { remote, range } = pushRange(rest)
  return [
    { kind: 'git', label: 'current branch', argv: ['git', 'rev-parse', '--abbrev-ref', 'HEAD'] },
    ...(remote !== undefined ? [{ kind: 'git' as const, label: `remote ${remote}`, argv: ['git', 'remote', 'get-url', remote] }] : []),
    { kind: 'git', label: `commits it would send (${range})`, argv: ['git', 'log', '--oneline', '-n', '30', range, '--'] },
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
      { kind: 'git', label: `diff of ${relative} against the last commit`, argv: ['git', 'diff', '--stat', 'HEAD', '--', relative] },
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
      for (const word of positionals(args)) {
        const target = unquote(word)
        if (hasGlob(target) || /[$`]/.test(target)) continue
        const path = resolve(target, cwd, context.home)
        plan.push({ kind: 'path', label: `${program} target ${target}`, path })
      }
    } else if (program === 'git') {
      const git = gitArgs(part)
      if (git === undefined) continue
      if (git.sub === 'push') plan.push(...pushInspections(git.rest))
      else if (git.sub === 'merge') plan.push(...mergeInspections(git.rest))
      else if (['reset', 'rebase'].includes(git.sub) || (git.sub === 'commit' && git.rest.includes('--amend'))) plan.push(...HISTORY)
    }
    if (plan.length >= MAX_INSPECTIONS) break
  }
  // One of each: a compound command can name the same inspection twice.
  const unique = new Map(plan.map(step => [step.kind === 'git' ? step.argv.join('\u0000') : step.path, step]))
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
 * would run elsewhere (`-C`, `--git-dir`) gets none.
 */
export function rangeDiffInspection(kind: 'push' | 'merge', part: ShellPart): Inspection | undefined {
  const git = gitArgs(part)
  if (git === undefined) return undefined
  const range = kind === 'push' ? pushRange(git.rest).range : (() => {
    const ref = mergeRef(git.rest)
    return ref === undefined ? undefined : `HEAD...${ref}`
  })()
  if (range === undefined) return undefined
  return { kind: 'git', label: range, argv: ['git', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', range, '--'] }
}
