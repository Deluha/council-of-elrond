import { truncate } from '../members/shared.js'
import { redact } from '../redact.js'
import { text } from '../strings.js'
import type { Mode, StringKey } from '../strings.js'

/**
 * The escalation: the question put to the user, and what their answer means.
 * The dialog is the engine's AskUserQuestion: two labelled options and a
 * free-text "Other", which reaches Claude as an instruction.
 */

export type MemberOpinion =
  | { who: StringKey; verdict: string; reason: string }
  | { who: StringKey; problem: string }

export type Question = {
  call: string
  ruleReason: string
  why: StringKey
  opinions: readonly MemberOpinion[]
  /** The read-only preview, when there is one. */
  preview?: string
  /** Possible secrets the scan found, already redacted. */
  secrets?: readonly { label: string; snippet: string }[]
  /** The dialog offers the allowlist (one finding exactly). */
  canAllowlist?: boolean
}

export type Answer =
  | { kind: 'allow-once' }
  | { kind: 'keep-blocked' }
  | { kind: 'allowlist' }
  | { kind: 'instruction'; text: string }

export type Unanswered = 'dismissed' | 'chat' | 'unavailable'

const MAX_QUESTION_CHARS = 2_500

const PREVIEW_LINES = 15

/** The dialog's labels; a secrets question adds the allowlist. */
export const optionsOf = (mode: Mode = 'plain', withAllowlist = false): string[] => [
  text('ask.allowOnce', {}, mode),
  ...(withAllowlist ? [text('ask.allowlist', {}, mode)] : []),
  text('ask.keepBlocked', {}, mode),
]

export function questionText(question: Question, mode: Mode = 'plain'): string {
  const lines = [
    text('ask.title', {}, mode),
    text(question.why, {}, mode),
    text('ask.call', { call: truncate(redact(question.call), 12, 600) }, mode),
    ...(question.ruleReason !== '' ? [text('ask.rule', { reason: question.ruleReason }, mode)] : []),
    ...(question.secrets ?? []).map(secret =>
      text('ask.secret', { label: secret.label, snippet: redact(secret.snippet) }, mode),
    ),
    ...question.opinions.map(opinion =>
      'problem' in opinion
        ? text('ask.failed', { who: text(opinion.who, {}, mode), problem: opinion.problem }, mode)
        : text('ask.verdict', { who: text(opinion.who, {}, mode), verdict: opinion.verdict, reason: redact(opinion.reason) }, mode),
    ),
    ...(question.preview !== undefined
      ? [text('ask.preview', { preview: truncate(redact(question.preview), PREVIEW_LINES, 900) }, mode)]
      : []),
    text(question.canAllowlist === true ? 'ask.closeSecret' : 'ask.close', {}, mode),
  ]
  const joined = lines.join('\n')
  return joined.length > MAX_QUESTION_CHARS ? `${joined.slice(0, MAX_QUESTION_CHARS - 1)}…` : joined
}

/** Labels compare exactly; anything else the user typed is an instruction. */
export function interpretAnswer(answer: string, mode: Mode = 'plain', withAllowlist = false): Answer {
  if (answer === text('ask.allowOnce', {}, mode)) return { kind: 'allow-once' }
  if (answer === text('ask.keepBlocked', {}, mode)) return { kind: 'keep-blocked' }
  if (withAllowlist && answer === text('ask.allowlist', {}, mode)) return { kind: 'allowlist' }
  return { kind: 'instruction', text: answer.trim() }
}

/** Why `$.ui.ask` rejected: the user chose to chat, or dismissed it. */
export const interpretRejection = (error: unknown): Unanswered =>
  /chat/i.test(error instanceof Error ? error.message : String(error)) ? 'chat' : 'dismissed'
