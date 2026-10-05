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
}

export type Answer =
  | { kind: 'allow-once' }
  | { kind: 'keep-blocked' }
  | { kind: 'instruction'; text: string }

export type Unanswered = 'dismissed' | 'chat' | 'unavailable'

const MAX_QUESTION_CHARS = 1_500

export const optionsOf = (mode: Mode = 'plain'): [string, string] => [
  text('ask.allowOnce', {}, mode),
  text('ask.keepBlocked', {}, mode),
]

export function questionText(question: Question, mode: Mode = 'plain'): string {
  const lines = [
    text('ask.title', {}, mode),
    text(question.why, {}, mode),
    text('ask.call', { call: truncate(redact(question.call), 12, 600) }, mode),
    text('ask.rule', { reason: question.ruleReason }, mode),
    ...question.opinions.map(opinion =>
      'problem' in opinion
        ? text('ask.failed', { who: text(opinion.who, {}, mode), problem: opinion.problem }, mode)
        : text('ask.verdict', { who: text(opinion.who, {}, mode), verdict: opinion.verdict, reason: redact(opinion.reason) }, mode),
    ),
    text('ask.close', {}, mode),
  ]
  const joined = lines.join('\n')
  return joined.length > MAX_QUESTION_CHARS ? `${joined.slice(0, MAX_QUESTION_CHARS - 1)}…` : joined
}

/** Labels compare exactly; anything else the user typed is an instruction. */
export function interpretAnswer(answer: string, mode: Mode = 'plain'): Answer {
  const [allow, keep] = optionsOf(mode)
  if (answer === allow) return { kind: 'allow-once' }
  if (answer === keep) return { kind: 'keep-blocked' }
  return { kind: 'instruction', text: answer.trim() }
}

/** Why `$.ui.ask` rejected: the user chose to chat, or dismissed it. */
export const interpretRejection = (error: unknown): Unanswered =>
  /chat/i.test(error instanceof Error ? error.message : String(error)) ? 'chat' : 'dismissed'
