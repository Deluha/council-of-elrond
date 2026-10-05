import type { MemberName, Profile } from '../config/types.js'
import { FILE_PATH_FIELDS } from '../rules/classify.js'
import type { Call, Classification, Finding } from '../rules/classify.js'

/**
 * Which model member reviews a review-tier call. The rule that gated the call
 * names its member (and Aragorn's profile); Gandalf takes whatever no
 * enabled specialist can. With Gandalf off too, nobody reviews and the call
 * goes to the user.
 */

export type Enabled = Readonly<Record<MemberName, boolean>>

/** Why the call did not go to the member its rule named. */
export type Fallback =
  /** The named member is switched off. */
  | 'disabled'
  /** The call's parts name different reviewers: one specialist would judge only its own part. */
  | 'mixed'
  /** The diff reviewer was named for a call with no file to diff. */
  | 'no-diff'

export type Route =
  | { kind: 'member'; member: MemberName; profile?: Profile; fallback?: Fallback; wanted?: Seat }
  /** Nobody can review: the call goes to the user. */
  | { kind: 'none'; wanted: Seat }

export type Seat = { member: MemberName; profile?: Profile }

/** The seat a finding asks for: Gandalf when it names nobody; Aragorn's profile from the part when unnamed. */
export function seatOf(finding: Finding): Seat {
  const member = finding.member ?? 'gandalf'
  if (member !== 'aragorn') return { member }
  if (finding.profile !== undefined) return { member, profile: finding.profile }
  return { member, profile: finding.part?.coreWords[0] === 'git' ? 'git' : 'database' }
}

const sameSeat = (a: Seat, b: Seat): boolean => a.member === b.member && a.profile === b.profile

const GANDALF: Seat = { member: 'gandalf' }

/**
 * The reviewer for a review-tier call: pure, from the classification and
 * which members are on.
 */
export function route(call: Call, classification: Classification, enabled: Enabled): Route {
  const seats = classification.findings.filter(finding => finding.tier === 'review').map(seatOf)
  const first = seats[0] ?? (classification.decided !== undefined ? seatOf(classification.decided) : GANDALF)
  const isMixed = seats.some(seat => !sameSeat(seat, first))
  let seat = first
  let fallback: Fallback | undefined
  if (isMixed) {
    seat = GANDALF
    fallback = 'mixed'
  } else if (seat.member === 'legolas' && FILE_PATH_FIELDS[call.tool] === undefined) {
    seat = GANDALF
    fallback = 'no-diff'
  } else if (!enabled[seat.member]) {
    seat = GANDALF
    fallback = 'disabled'
  }
  if (!enabled[seat.member]) return { kind: 'none', wanted: first }
  return { kind: 'member', ...seat, ...(fallback !== undefined && { fallback, wanted: first }) }
}
