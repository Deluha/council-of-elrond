import { cleanText } from '../config/trust.js'
import { cut, label } from '../members/shared.js'
import { redact, SECRET_PATTERNS } from '../redact.js'
import type { SecretPattern } from '../redact.js'
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

/** A row of the dialog, the gutter included, is at most this many characters: a longer line wraps onto rows that carry the gutter too. */
const MAX_ROW_CHARS = 100

/**
 * One line of the dialog's own, from text the call or a reviewer supplied: no control character, so it cannot start another
 * line, and no invisible or direction-changing one, so it reads as it is written (`cleanText`, as for a rules file's text).
 */
const oneLine = (value: string): string => cleanText(value).trim()

/** A cleaned line after the gutter, wrapped into rows of at most MAX_ROW_CHARS characters; every row starts with the gutter. */
function wrapRows(gutter: string, line: string): string[] {
  const width = Math.max(1, MAX_ROW_CHARS - gutter.length)
  const chars = Array.from(line)
  const rows: string[] = []
  for (let at = 0; at < chars.length; at += width) rows.push(`${gutter}${chars.slice(at, at + width).join('')}`)
  return rows.length === 0 ? [gutter] : rows
}

/** A line of an excerpt (its wrapped rows and the characters it holds), or the dialog's own marker for what was left out. */
type Entry = { kind: 'text'; rows: string[]; chars: number } | { kind: 'marker'; lines: number; chars: number }

/**
 * Call-supplied text as the dialog shows it: cut to its start and its end within the limits first, then every line
 * after the gutter (control and invisible characters gone) and wrapped; the cut is marked by the dialog's own line,
 * which has no gutter.
 */
function excerptOf(raw: string, maxLines: number, maxChars: number, gutter: string): Entry[] {
  const shown = cut(raw, maxLines, maxChars)
  const entries = (part: string): Entry[] =>
    part.split('\n').map((line): Entry => {
      const clean = cleanText(line)
      return { kind: 'text', rows: wrapRows(gutter, clean), chars: clean.length }
    })
  if (shown.omitted === undefined) return entries(shown.text)
  return [...entries(shown.head), { kind: 'marker', ...shown.omitted }, ...(shown.tail === '' ? [] : entries(shown.tail))]
}

const entryText = (entry: Entry, mode: Mode): string => (entry.kind === 'text' ? entry.rows.join('\n') : text('ask.omitted', { lines: entry.lines, chars: entry.chars }, mode))

const excerptText = (entries: readonly Entry[], mode: Mode): string => entries.map(entry => entryText(entry, mode)).join('\n')

/**
 * The excerpt with lines dropped from its end until `excess` characters are saved, the first line always kept; what was dropped
 * is said by one marker line at the end (joined to the marker already there, if the dropping reached it).
 */
function dropFromEnd(entries: readonly Entry[], excess: number, mode: Mode): Entry[] {
  const kept = [...entries]
  // The marker that will say so costs its own length: worked out for the widest numbers.
  const markerCost = entryText({ kind: 'marker', lines: 99_999, chars: 99_999 }, mode).length + 1
  const dropped = { lines: 0, chars: 0 }
  let saved = 0
  while (kept.length > 1 && saved - markerCost < excess) {
    const last = kept.pop() as Entry
    saved += entryText(last, mode).length + 1
    dropped.lines += last.kind === 'text' ? 1 : last.lines
    dropped.chars += last.chars
  }
  if (dropped.lines === 0 && dropped.chars === 0) return kept
  const end = kept.at(-1)
  if (end?.kind === 'marker') kept[kept.length - 1] = { kind: 'marker', lines: end.lines + dropped.lines, chars: end.chars + dropped.chars }
  else kept.push({ kind: 'marker', ...dropped })
  return kept
}

/** Each value cut to its share of `room` characters, in proportion to its length, ending in the dialog's marker for what was left out. */
function cutShares(values: readonly string[], room: number, mode: Mode): string[] {
  const total = values.reduce((sum, value) => sum + value.length, 0)
  if (total <= room) return [...values]
  return values.map(value => {
    const share = Math.floor((Math.max(0, room) * value.length) / total)
    // Worked out for the widest number: the real one is no longer.
    const keep = Math.max(0, share - text('ask.reasonCut', { chars: value.length }, mode).length)
    return keep >= value.length ? value : `${value.slice(0, keep)}${text('ask.reasonCut', { chars: value.length - keep }, mode)}`
  })
}

/** The dialog's labels; a secrets question adds the allowlist. */
export const optionsOf = (mode: Mode = 'plain', withAllowlist = false): string[] => [
  text('ask.allowOnce', {}, mode),
  ...(withAllowlist ? [text('ask.allowlist', {}, mode)] : []),
  text('ask.keepBlocked', {}, mode),
  text('ask.talkFirst', {}, mode),
]

/**
 * The question as the dialog shows it. `patterns`: the call's (the shipped ones and a confirmed project file's). Over the
 * size cap, the end of the call excerpt goes first, then the end of the preview's, then each reviewer's reason and each
 * secret's snippet is cut to its share: the dialog's own lines and every reviewer's verdict line stay.
 */
export function questionText(question: Question, mode: Mode = 'plain', patterns: readonly SecretPattern[] = SECRET_PATTERNS): string {
  const gutter = text('ask.gutter', {}, mode)
  let call = excerptOf(redact(question.call, patterns), 12, 600, gutter)
  let preview = question.preview === undefined ? undefined : excerptOf(redact(question.preview, patterns), PREVIEW_LINES, 900, gutter)
  const secrets = (question.secrets ?? []).map(secret => ({ label: oneLine(secret.label), snippet: oneLine(redact(secret.snippet, patterns)) }))
  const opinions = question.opinions.map(
    (opinion): MemberOpinion =>
      'problem' in opinion
        ? { who: opinion.who, problem: oneLine(opinion.problem) }
        : { who: opinion.who, verdict: oneLine(opinion.verdict), reason: oneLine(redact(opinion.reason, patterns)) },
  )
  const ruleLine =
    question.ruleReason === ''
      ? []
      : question.isProjectReason === true
        ? [text('ask.ruleProject', { reason: wrapRows(gutter, label(oneLine(redact(question.ruleReason, patterns)))).join('\n') }, mode)]
        : [text('ask.rule', { reason: question.ruleReason }, mode)]

  const build = (reasons: readonly string[], snippets: readonly string[]): string =>
    [
      text('ask.title', {}, mode),
      text(question.why, {}, mode),
      text('ask.call', { call: excerptText(call, mode) }, mode),
      ...ruleLine,
      ...secrets.map((secret, index) => text('ask.secret', { label: secret.label, snippet: snippets[index] ?? '' }, mode)),
      ...opinions.map((opinion, index) =>
        'problem' in opinion
          ? text('ask.failed', { who: text(opinion.who, {}, mode), problem: reasons[index] ?? '' }, mode)
          : text('ask.verdict', { who: text(opinion.who, {}, mode), verdict: opinion.verdict, reason: reasons[index] ?? '' }, mode),
      ),
      ...(preview !== undefined ? [text('ask.preview', { preview: excerptText(preview, mode) }, mode)] : []),
      text(question.canAllowlist === true ? 'ask.closeSecret' : 'ask.close', {}, mode),
    ].join('\n')

  let reasons = opinions.map(opinion => ('problem' in opinion ? opinion.problem : opinion.reason))
  let snippets = secrets.map(secret => secret.snippet)
  let joined = build(reasons, snippets)
  if (joined.length > MAX_QUESTION_CHARS) {
    call = dropFromEnd(call, joined.length - MAX_QUESTION_CHARS, mode)
    joined = build(reasons, snippets)
  }
  if (joined.length > MAX_QUESTION_CHARS && preview !== undefined) {
    preview = dropFromEnd(preview, joined.length - MAX_QUESTION_CHARS, mode)
    joined = build(reasons, snippets)
  }
  if (joined.length > MAX_QUESTION_CHARS) {
    // What is left is the dialog's own lines and what reviewers said: each reason gives up its share of the excess.
    const total = reasons.reduce((sum, reason) => sum + reason.length, 0)
    reasons = cutShares(reasons, total - (joined.length - MAX_QUESTION_CHARS), mode)
    joined = build(reasons, snippets)
  }
  if (joined.length > MAX_QUESTION_CHARS) {
    const total = snippets.reduce((sum, snippet) => sum + snippet.length, 0)
    snippets = cutShares(snippets, total - (joined.length - MAX_QUESTION_CHARS), mode)
    joined = build(reasons, snippets)
  }
  return joined
}

/** Labels compare exactly; anything else the user typed is an instruction. */
export function interpretAnswer(answer: string, mode: Mode = 'plain', withAllowlist = false): Answer {
  if (answer === text('ask.allowOnce', {}, mode)) return { kind: 'allow-once' }
  if (answer === text('ask.keepBlocked', {}, mode)) return { kind: 'keep-blocked' }
  if (answer === text('ask.talkFirst', {}, mode)) return { kind: 'talk-first' }
  if (withAllowlist && answer === text('ask.allowlist', {}, mode)) return { kind: 'allowlist' }
  return { kind: 'instruction', text: answer.trim() }
}
