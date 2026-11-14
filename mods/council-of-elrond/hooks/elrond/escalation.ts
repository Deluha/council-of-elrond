import { cut, label } from '../members/shared.js'
import { redact } from '../redact.js'
import { text } from '../strings.js'
import type { Mode, StringKey } from '../strings.js'

/**
 * The escalation: the question put to the user, and what their answer means.
 * The dialog is the engine's AskUserQuestion: the mod's labelled options plus a
 * free-text "Other", which reaches Claude as an instruction. The engine's own
 * "Chat about this" reads as a dismissal (DESIGN §12.4).
 */

export type MemberOpinion =
  | { who: StringKey; verdict: string; reason: string }
  | { who: StringKey; problem: string }

export type Question = {
  call: string
  ruleReason: string
  /** The reason is a project rule's: text from the repository's rules file, shown after the gutter, cleaned and capped. */
  isProjectReason?: boolean
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
  | { kind: 'talk-first' }
  | { kind: 'instruction'; text: string }

export type Unanswered = 'dismissed' | 'unavailable'

const MAX_QUESTION_CHARS = 2_500

const PREVIEW_LINES = 15

// What a terminal can be made to act on or to hide: C0 and C1 controls, and the Unicode line and paragraph separators.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g

/** One line of the dialog's own, from text the call or a reviewer supplied: no control character, so it cannot start another line. */
const oneLine = (value: string): string => value.replace(CONTROL, ' ').trim()

/**
 * Call-supplied text as the dialog shows it: cut to its start and its end
 * within the limits, every line after the gutter (control characters stripped),
 * and the cut marked by the dialog's own line, which has no gutter.
 */
function excerptOf(raw: string, maxLines: number, maxChars: number, mode: Mode): string {
  const gutter = text('ask.gutter', {}, mode)
  const guttered = (part: string): string[] => part.split('\n').map(line => `${gutter}${line.replace(CONTROL, ' ')}`)
  const shown = cut(raw, maxLines, maxChars)
  if (shown.omitted === undefined) return guttered(shown.text).join('\n')
  const marker = text('ask.omitted', { lines: shown.omitted.lines, chars: shown.omitted.chars }, mode)
  return [...guttered(shown.head), marker, ...(shown.tail === '' ? [] : guttered(shown.tail))].join('\n')
}

/** The dialog's labels; a secrets question adds the allowlist. */
export const optionsOf = (mode: Mode = 'plain', withAllowlist = false): string[] => [
  text('ask.allowOnce', {}, mode),
  ...(withAllowlist ? [text('ask.allowlist', {}, mode)] : []),
  text('ask.keepBlocked', {}, mode),
  text('ask.talkFirst', {}, mode),
]

export function questionText(question: Question, mode: Mode = 'plain'): string {
  const lines = [
    text('ask.title', {}, mode),
    text(question.why, {}, mode),
    text('ask.call', { call: excerptOf(redact(question.call), 12, 600, mode) }, mode),
    ...(question.ruleReason === ''
      ? []
      : question.isProjectReason === true
        ? [text('ask.ruleProject', { reason: `${text('ask.gutter', {}, mode)}${label(oneLine(redact(question.ruleReason)))}` }, mode)]
        : [text('ask.rule', { reason: question.ruleReason }, mode)]),
    ...(question.secrets ?? []).map(secret =>
      text('ask.secret', { label: oneLine(secret.label), snippet: oneLine(redact(secret.snippet)) }, mode),
    ),
    ...question.opinions.map(opinion =>
      'problem' in opinion
        ? text('ask.failed', { who: text(opinion.who, {}, mode), problem: oneLine(opinion.problem) }, mode)
        : text('ask.verdict', { who: text(opinion.who, {}, mode), verdict: oneLine(opinion.verdict), reason: oneLine(redact(opinion.reason)) }, mode),
    ),
    ...(question.preview !== undefined
      ? [text('ask.preview', { preview: excerptOf(redact(question.preview), PREVIEW_LINES, 900, mode) }, mode)]
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
  if (answer === text('ask.talkFirst', {}, mode)) return { kind: 'talk-first' }
  if (withAllowlist && answer === text('ask.allowlist', {}, mode)) return { kind: 'allowlist' }
  return { kind: 'instruction', text: answer.trim() }
}
