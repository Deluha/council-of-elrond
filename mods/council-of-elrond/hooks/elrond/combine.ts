import type { MemberName, Profile } from '../config/types.js'
import { isGimliBlock } from '../members/gimli.js'
import type { GimliRun } from '../members/gimli.js'
import { VERDICTS } from '../members/shared.js'
import type { Verdict, VerdictValue } from '../members/shared.js'
import { text } from '../strings.js'
import type { StringKey } from '../strings.js'
import type { MemberOpinion } from './escalation.js'

/**
 * Combining the full council: the strictest verdict wins (block, then revise,
 * then approve). A member that errored, timed out or answered malformed
 * counts as a block from that member; a check that failed, timed out or
 * could not start is a block too. Each reason is labelled with who gave it.
 * Members never see each other's verdicts: this runs after all of them.
 */

/** One model member's part in the council. */
export type Voice =
  | { kind: 'verdict'; who: StringKey; member: MemberName; profile?: Profile; verdict: Verdict }
  /** No verdict: an error, a timeout, a malformed reply. Counts as a block. */
  | { kind: 'failed'; who: StringKey; member: MemberName; profile?: Profile; problem: string }
  /** Never asked: the sequential council stopped at an earlier block, or there was nothing to review. */
  | { kind: 'skipped'; who: StringKey; member: MemberName; profile?: Profile; why: string }

export type Combined = {
  verdict: VerdictValue
  /** Every voice that didn't approve, labelled, one per line: the reason Claude and the user read. */
  reason: string
  /** The same without any check's output: what the audit log keeps. */
  summary: string
  /** The safer alternatives of those voices, labelled. */
  alternative: string
  /** Blocked only because members gave no verdict: no member blocked or asked to revise, and every check passed. */
  isFailureOnly: boolean
  /** How many model members gave a verdict or failed; zero means nobody reviewed. */
  reviewed: number
  /** Each voice and check, for the question put to the user. */
  opinions: MemberOpinion[]
}

const rank = (verdict: VerdictValue): number => VERDICTS.indexOf(verdict)

const valueOf = (voice: Voice): VerdictValue | undefined =>
  voice.kind === 'verdict' ? voice.verdict.verdict : voice.kind === 'failed' ? 'block' : undefined

/** What a check run says, in a line. */
export function runLine(run: GimliRun): string {
  switch (run.status) {
    case 'passed':
      return text('gimli.passed', { name: run.name })
    case 'failed':
      return run.code === null || run.code === undefined
        ? text('gimli.killed', { name: run.name, signal: run.signal ?? 'a signal' })
        : text('gimli.failed', { name: run.name, code: run.code })
    case 'timed-out':
      return text('gimli.timedOut', { name: run.name, seconds: Math.round(run.ms / 1000) })
    case 'error':
      return text('gimli.error', { name: run.name })
    case 'stopped':
      return text('gimli.stopped', { name: run.name })
  }
}

const withTail = (run: GimliRun): string => (run.tail === '' ? runLine(run) : `${runLine(run)} ${text('gimli.tail', { tail: run.tail })}`)

export function combine(voices: readonly Voice[], runs: readonly GimliRun[]): Combined {
  let verdict: VerdictValue = 'approve'
  const reasons: string[] = []
  const summaries: string[] = []
  const alternatives: string[] = []
  let isRealBlock = false
  for (const voice of voices) {
    const value = valueOf(voice)
    if (value === undefined || value === 'approve') continue
    if (rank(value) > rank(verdict)) verdict = value
    const who = text(voice.who)
    if (voice.kind === 'verdict') {
      isRealBlock = true
      reasons.push(text('council.voice', { who, verdict: value, reason: voice.verdict.reason }))
      summaries.push(reasons.at(-1) as string)
      alternatives.push(text('council.voice', { who, verdict: value, reason: voice.verdict.safer_alternative }))
    } else if (voice.kind === 'failed') {
      reasons.push(text('council.noVerdict', { who, problem: voice.problem }))
      summaries.push(reasons.at(-1) as string)
    }
  }
  const failedRuns = runs.filter(isGimliBlock)
  if (failedRuns.length > 0) {
    verdict = 'block'
    isRealBlock = true
    for (const run of failedRuns) {
      reasons.push(text('council.voice', { who: text('who.gimli'), verdict: 'block', reason: withTail(run) }))
      summaries.push(text('council.voice', { who: text('who.gimli'), verdict: 'block', reason: runLine(run) }))
    }
    alternatives.push(text('alternative.gimli', { names: failedRuns.map(run => `"${run.name}"`).join(', ') }))
  }
  if (verdict !== 'approve' && alternatives.length === 0) alternatives.push(text('alternative.ask'))

  const opinions: MemberOpinion[] = [
    ...voices.flatMap((voice): MemberOpinion[] =>
      voice.kind === 'verdict'
        ? [{ who: voice.who, verdict: voice.verdict.verdict, reason: voice.verdict.reason }]
        : voice.kind === 'failed'
          ? [{ who: voice.who, problem: voice.problem }]
          : [],
    ),
    ...runs.map((run): MemberOpinion => ({ who: 'who.gimli', verdict: isGimliBlock(run) ? 'block' : 'approve', reason: runLine(run) })),
  ]
  return {
    verdict,
    reason: reasons.map(line => `\n- ${line}`).join(''),
    summary: summaries.join(' '),
    alternative: alternatives.length === 1 ? (alternatives[0] as string) : alternatives.map(line => `\n- ${line}`).join(''),
    isFailureOnly: verdict === 'block' && !isRealBlock,
    reviewed: voices.filter(voice => voice.kind !== 'skipped').length,
    opinions,
  }
}

/** Whether the council has already blocked for real, so a check still running can no longer matter. */
export const hasRealBlock = (voices: readonly Voice[]): boolean =>
  voices.some(voice => voice.kind === 'verdict' && voice.verdict.verdict === 'block')
