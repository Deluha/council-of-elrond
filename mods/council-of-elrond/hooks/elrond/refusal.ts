import { cleanText } from '../config/trust.js'
import { label } from '../members/shared.js'
import { redact, SECRET_PATTERNS } from '../redact.js'
import type { SecretPattern } from '../redact.js'
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
  /** The reason is a project rule's: text from the repository's rules file, cleaned, capped and introduced as the project's, never as the council's own. */
  isProjectReason?: boolean
}

/**
 * A project rule's reason as Claude and the audit log read it: redacted, on one line, with control, invisible and
 * direction-changing characters gone, capped at 200 characters, after a lead-in that says whose words they are.
 */
export const projectReasonText = (reason: string, mode: Mode = 'plain', patterns: readonly SecretPattern[] = SECRET_PATTERNS): string =>
  text('refusal.reasonProject', { reason: label(cleanText(redact(reason, patterns))) }, mode)

/** `patterns`: the call's (the shipped ones and a confirmed project file's), for everything a reviewer or a rule wrote. */
export function refusalText(refusal: Refusal, mode: Mode = 'plain', patterns: readonly SecretPattern[] = SECRET_PATTERNS): string {
  const lines = [
    text('refusal.head', {}, mode),
    text('refusal.decided', { who: text(refusal.who, {}, mode), verdict: refusal.verdict }, mode),
    ...(refusal.instruction !== undefined
      ? [text('refusal.instruction', { text: redact(refusal.instruction, patterns) }, mode)]
      : []),
    refusal.isProjectReason === true ? projectReasonText(refusal.reason, mode, patterns) : text('refusal.reason', { reason: redact(refusal.reason, patterns) }, mode),
    text('refusal.alternative', { alternative: redact(refusal.alternative, patterns) }, mode),
    ...(refusal.roundsLeft !== undefined ? [text('refusal.rounds', { rounds: refusal.roundsLeft }, mode)] : []),
    text('refusal.noRetry', {}, mode),
  ]
  return lines.join('\n')
}
