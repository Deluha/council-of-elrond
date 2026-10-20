import { MAX_GIMLI_COMMANDS } from '../config/schema.js'
import { strictness } from '../config/types.js'
import type { GimliCommand } from '../config/types.js'
import type { Classification, Target } from './classify.js'
import { relativeTo, resolve } from './paths.js'

/**
 * Rules per repository (C5, DESIGN §14.5). A session root that is the parent of
 * several repositories has no rules file of its own; each repository directly
 * below it may have one. A call touches the repositories its working
 * directories and path targets sit in. Everything here is pure: register.ts
 * finds which candidate children are repositories and hands the set in.
 *
 * A scope is named by its directory: a repository's, or the session root for
 * the root scope (the root's own config, today's behaviour).
 */

/** `<root>/<first segment>` of a path strictly inside the root. */
function childOf(path: string, root: string): string | undefined {
  const relative = relativeTo(path, root)
  if (relative === undefined || relative === '.') return undefined
  return `${root.replace(/\/$/, '')}/${relative.split('/')[0]}`
}

/** The child directories the targets sit in, once each, in the order met: the ones to ask "is this a repository?". */
export function candidateChildren(targets: readonly Target[], root: string): string[] {
  const found = new Set<string>()
  for (const target of targets) {
    const child = childOf(target.path, root)
    if (child !== undefined) found.add(child)
  }
  return [...found]
}

/**
 * The scopes a call touches, the first target's first, then in the order met,
 * each once. A target in a repository (below it, or the directory itself)
 * brings in that repository. A working directory in none (the root, a plain
 * child, outside the root, `/`) brings in the root scope; a path the call
 * merely names, in none, brings in nothing. Nothing at all: the root scope.
 */
export function scopesTouched(targets: readonly Target[], root: string, repositories: ReadonlySet<string>): string[] {
  const touched = new Set<string>()
  for (const target of targets) {
    const child = childOf(target.path, root)
    if (child !== undefined && repositories.has(child)) touched.add(child)
    else if (target.isWorkingDir) touched.add(root)
  }
  return touched.size === 0 ? [root] : [...touched]
}

/**
 * One classification from one per scope: the strictest tier wins, the earliest
 * scope on a tie. A protected path in any scope protects the call, and the
 * scripts of all are listed. One scope: that classification, unchanged.
 */
export function combineClassifications(classifications: readonly Classification[]): { classification: Classification; index: number } {
  const [first, ...rest] = classifications
  if (first === undefined) throw new Error('no scope to classify against')
  if (rest.length === 0) return { classification: first, index: 0 }
  let index = 0
  classifications.forEach((candidate, at) => {
    if (strictness(candidate.tier) > strictness((classifications[index] as Classification).tier)) index = at
  })
  const winner = classifications[index] as Classification
  return {
    classification: {
      ...winner,
      isProtected: classifications.some(candidate => candidate.isProtected),
      scriptPaths: [...new Set(classifications.flatMap(candidate => candidate.scriptPaths))],
    },
    index,
  }
}

/**
 * What tells one scope's keys from another's (the verdict cache, a chat
 * allowance): empty for the root scope alone, so those keys stay as they were.
 */
export const scopeTagOf = (dirs: readonly string[], root: string): string =>
  dirs.length === 1 && dirs[0] === root ? '' : [...dirs].sort().join('\n')

/** Items of every list, once per `id`, the first met kept. */
export function unionById<T extends { id: string }>(lists: readonly (readonly T[])[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of lists.flat()) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

/** Entries every list holds, in the first list's order. */
export const intersection = (lists: readonly (readonly string[])[]): string[] => {
  const [first, ...rest] = lists
  return first === undefined ? [] : [...new Set(first)].filter(entry => rest.every(list => list.includes(entry)))
}

/**
 * The project checks of the scopes a call touched, in scope order, each with
 * the directory it runs in, at most MAX_GIMLI_COMMANDS in all.
 */
export function checksOf(scopes: readonly { dir: string; commands: readonly GimliCommand[] }[]): { command: GimliCommand; dir: string }[] {
  return scopes.flatMap(scope => scope.commands.map(command => ({ command, dir: scope.dir }))).slice(0, MAX_GIMLI_COMMANDS)
}

/**
 * Whose audit logs get the call's line: every repository touched, else the
 * root's. Directories whose log resolves to the same file (an absolute path)
 * count once.
 */
export function auditDirsOf(dirs: readonly string[], root: string, logPath: string): string[] {
  const repositories = dirs.filter(dir => dir !== root)
  const chosen = repositories.length > 0 ? repositories : [root]
  const files = new Set<string>()
  return chosen.filter(dir => {
    const file = resolve(logPath, dir)
    if (files.has(file)) return false
    files.add(file)
    return true
  })
}

/**
 * Where the mod may write a rules entry for this call: the session root when
 * the lookup is off (today's behaviour), the one repository when the call
 * touched exactly one, else nowhere. A write can never create a root rules
 * file that would switch the lookup off.
 */
export function writeDirOf(dirs: readonly string[], root: string, isMulti: boolean): string | undefined {
  if (!isMulti) return root
  const [only] = dirs
  return dirs.length === 1 && only !== undefined && only !== root ? only : undefined
}
