import { redact } from '../redact.js'
import { text } from '../strings.js'
import type { Mode, StringKey } from '../strings.js'

/**
 * The refusal Claude reads. It always says who decided, the verdict, the
 * reason, a safer alternative and not to retry unchanged; the rounds left
 * join it once rounds are counted (stage 2).
 */
export type Refusal = {
  who: StringKey
  verdict: string
  reason: string
  alternative: string
  roundsLeft?: number
  instruction?: string
}

export function refusalText(refusal: Refusal, mode: Mode = 'plain'): string {
  const lines = [
    text('refusal.head', {}, mode),
    text('refusal.decided', { who: text(refusal.who, {}, mode), verdict: refusal.verdict }, mode),
    ...(refusal.instruction !== undefined
      ? [text('refusal.instruction', { text: redact(refusal.instruction) }, mode)]
      : []),
    text('refusal.reason', { reason: redact(refusal.reason) }, mode),
    text('refusal.alternative', { alternative: redact(refusal.alternative) }, mode),
    ...(refusal.roundsLeft !== undefined ? [text('refusal.rounds', { rounds: refusal.roundsLeft }, mode)] : []),
    text('refusal.noRetry', {}, mode),
  ]
  return lines.join('\n')
}
