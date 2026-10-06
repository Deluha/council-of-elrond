import type { BigOperation, CompiledConfig } from '../config/schema.js'
import type { Profile } from '../config/types.js'
import { FILE_PATH_FIELDS } from '../rules/classify.js'
import type { Call, Classification, Finding } from '../rules/classify.js'
import type { ShellPart } from '../rules/shell.js'
import type { Enabled } from './routing.js'
import { seatOf } from './routing.js'

/**
 * The full council: which review-tier calls are big operations, and who sits
 * for one. Pure: the current branch, the one fact a rule cannot see, comes in
 * from register.ts.
 */

/** Why a call is a big operation: the config entry that matched, and the part it matched. */
export type Big = { entry: string; subject: string }

/** What decides a big operation besides the call: the current branch, when a merge needs it. */
export type BigContext = {
  /** The checked-out branch; undefined when unknown (a merge into it then counts as big). */
  currentBranch?: string
}

const isGit = (part: ShellPart, sub: string): boolean => part.coreWords[0] === 'git' && part.coreWords[1] === sub

/** A merge lands on the checked-out branch; a pull request merge on a base the command doesn't name. */
const isMerge = (part: ShellPart): boolean =>
  (isGit(part, 'merge') && !part.coreWords.slice(2).some(word => ['--abort', '--quit', '--continue'].includes(word))) ||
  (part.coreWords[0] === 'gh' && part.coreWords[1] === 'pr' && part.coreWords[2] === 'merge')

/** Whether working out a big operation needs the current branch: only a `git merge` does. */
export const needsCurrentBranch = (classification: Classification, compiled: CompiledConfig): boolean =>
  compiled.bigOperations.some(big => big.kind === 'check') &&
  classification.findings.some(finding => finding.part !== undefined && isGit(finding.part, 'merge'))

function matches(big: BigOperation, finding: Finding, compiled: CompiledConfig, context: BigContext): boolean {
  if (big.kind === 'rule') return finding.ruleId === big.ruleId
  const part = finding.part
  if (part === undefined) return false
  if (big.kind === 'command') return big.re.test(part.core)
  // merge-to-protected: an unknown current branch counts, since the merge may land on a protected one.
  if (!isMerge(part)) return false
  if (part.coreWords[0] === 'gh') return true
  const branch = context.currentBranch
  return branch === undefined || branch === 'HEAD' || compiled.protectedBranches.some(re => re.test(branch))
}

/**
 * The big operation a review-tier call is, if any: the first configured entry
 * one of its review parts matches. Other tiers never reach the council.
 */
export function bigOperationOf(classification: Classification, compiled: CompiledConfig, context: BigContext = {}): Big | undefined {
  if (classification.tier !== 'review') return undefined
  for (const finding of classification.findings) {
    if (finding.tier !== 'review') continue
    const big = compiled.bigOperations.find(entry => matches(entry, finding, compiled, context))
    if (big !== undefined) return { entry: big.entry, subject: finding.subject }
  }
  return undefined
}

/**
 * One seat at the full council. The diff reviewer reviews a file tool's own
 * diff, or the changes a push or merge would send or bring in (`range`).
 */
export type CouncilSeat =
  | { member: 'gandalf' }
  | { member: 'legolas'; range?: 'push' | 'merge' }
  | { member: 'aragorn'; profile: Profile }

/** The push or merge a diff reviewer could read the changes of, if the call has one. */
export function rangeOf(classification: Classification): { kind: 'push' | 'merge'; part: ShellPart } | undefined {
  for (const finding of classification.findings) {
    const part = finding.part
    if (part === undefined || finding.tier !== 'review') continue
    if (isGit(part, 'push')) return { kind: 'push', part }
    if (isGit(part, 'merge') && isMerge(part)) return { kind: 'merge', part }
  }
  return undefined
}

/**
 * Who sits for a big operation: every enabled model member with something of
 * this call to review. The general reviewer always; the git and database
 * reviewer once per profile the call's parts ask for; the diff reviewer for a
 * file change, or for a push or merge (the changes it would send or bring in,
 * read by a fixed `git diff`, so only while the read-only preview is on).
 * Each gets its own brief; none sees another's verdict.
 */
export function councilSeats(call: Call, classification: Classification, enabled: Enabled, options: { ranges: boolean }): CouncilSeat[] {
  const seats: CouncilSeat[] = []
  if (enabled.gandalf) seats.push({ member: 'gandalf' })
  if (enabled.legolas) {
    if (FILE_PATH_FIELDS[call.tool] !== undefined) seats.push({ member: 'legolas' })
    else if (options.ranges) {
      const range = rangeOf(classification)
      if (range !== undefined) seats.push({ member: 'legolas', range: range.kind })
    }
  }
  if (enabled.aragorn) {
    const profiles = new Set<Profile>()
    for (const finding of classification.findings) {
      if (finding.tier !== 'review') continue
      const seat = seatOf(finding)
      if (seat.member === 'aragorn' && seat.profile !== undefined) profiles.add(seat.profile)
    }
    for (const profile of ['git', 'database'] as const) if (profiles.has(profile)) seats.push({ member: 'aragorn', profile })
  }
  return seats
}

/** A seat as typed in config and shown by `/council test`: `aragorn/git`, `gandalf`. */
export const councilSeatId = (seat: CouncilSeat): string =>
  seat.member === 'aragorn' ? `${seat.member}/${seat.profile}` : seat.member
