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

/** Over the cap, a reviewer's reason is cut to at most this many characters, and every reason together to the budget. */
const REASON_CHARS = 240
const REASONS_BUDGET = 1_200

/** Over the cap, the call keeps at least its first and its last this many lines, whatever else goes. */
const CALL_KEPT_LINES = 4

/**
 * A row of the dialog, the gutter included, is at most this many display columns: a longer line wraps onto rows that carry the
 * gutter too. Narrower than a typical pane, so the dialog is less likely to re-wrap a row on its own, without the gutter.
 */
const MAX_ROW_COLUMNS = 72

/** East Asian Wide and Fullwidth characters (and emoji), which a terminal draws two columns wide. */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1b000, 0x1b16f],
  [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff],
  [0x1f900, 0x1f9ff],
  [0x1fa70, 0x1faff],
  [0x20000, 0x3fffd],
]

/** Display columns of one character: a combining mark 0, a wide or fullwidth one 2, any other 1. */
function columnsOf(char: string): number {
  if (/^[\p{Mn}\p{Me}]$/u.test(char)) return 0
  const code = char.codePointAt(0) ?? 0
  return WIDE_RANGES.some(([from, to]) => code >= from && code <= to) ? 2 : 1
}

const widthOf = (value: string): number => Array.from(value).reduce((sum, char) => sum + columnsOf(char), 0)

/**
 * One line of the dialog's own, from text the call or a reviewer supplied: no control character, so it cannot start another
 * line, and no invisible or direction-changing one, so it reads as it is written (`cleanText`, as for a rules file's text).
 */
const oneLine = (value: string): string => cleanText(value).trim()

/**
 * A cleaned line after the gutter, wrapped into rows of at most MAX_ROW_COLUMNS display columns, gutter included; every row
 * starts with the gutter. A character that does not fit goes to the next row, and a combining mark stays with its base.
 */
function wrapRows(gutter: string, line: string): string[] {
  const room = Math.max(2, MAX_ROW_COLUMNS - widthOf(gutter))
  const rows: string[] = []
  let row = ''
  let used = 0
  for (const char of line) {
    const columns = columnsOf(char)
    if (used + columns > room && row !== '') {
      rows.push(`${gutter}${row}`)
      row = ''
      used = 0
    }
    row += char
    used += columns
  }
  if (row !== '' || rows.length === 0) rows.push(`${gutter}${row}`)
  return rows
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

/** The cost of the marker line that says what was dropped, worked out for the widest numbers. */
const markerCostOf = (mode: Mode): number => entryText({ kind: 'marker', lines: 99_999, chars: 99_999 }, mode).length + 1

/**
 * The entries between the first `head` and the last `tail` lines of text, as `[from, to)`: what may be dropped. Empty (`[0, 0]`)
 * when the excerpt has no more than `head + tail` lines. The dialog's own marker line sits inside, or beside, what is kept.
 */
function middleOf(entries: readonly Entry[], head: number, tail: number): [number, number] {
  const at = entries.flatMap((entry, index) => (entry.kind === 'text' ? [index] : []))
  if (at.length <= head + tail) return [0, 0]
  return [(at[head - 1] ?? 0) + 1, at[at.length - tail] ?? 0]
}

/** `entries[from..to)` replaced by one marker line that says how much that was; a marker next to it is joined to it. */
function dropRange(entries: readonly Entry[], from: number, to: number): Entry[] {
  const before = entries.slice(0, from)
  const after = entries.slice(to)
  const dropped = { lines: 0, chars: 0 }
  const take = (entry: Entry): void => {
    dropped.lines += entry.kind === 'text' ? 1 : entry.lines
    dropped.chars += entry.chars
  }
  entries.slice(from, to).forEach(take)
  const previous = before.at(-1)
  if (previous?.kind === 'marker') take(before.pop() as Entry)
  const next = after[0]
  if (next?.kind === 'marker') take(after.shift() as Entry)
  return [...before, { kind: 'marker', ...dropped }, ...after]
}

/** The excerpt cut to its first and last line, one marker line between them. */
const firstAndLast = (entries: readonly Entry[]): Entry[] => {
  const [from, to] = middleOf(entries, 1, 1)
  return from >= to ? [...entries] : dropRange(entries, from, to)
}

/**
 * The excerpt with lines dropped from its middle until `excess` characters are saved: the first `head` and the last `tail`
 * lines are never dropped, and the dropping starts next to the end that is kept (the marker line says how much went).
 */
function dropMiddle(entries: readonly Entry[], excess: number, head: number, tail: number, mode: Mode): Entry[] {
  const [from, to] = middleOf(entries, head, tail)
  if (from >= to) return [...entries]
  const markerCost = markerCostOf(mode)
  let saved = 0
  let at = to
  while (at > from && saved - markerCost < excess) {
    at--
    saved += entryText(entries[at] as Entry, mode).length + 1
  }
  return dropRange(entries, at, to)
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
 * size cap, in this order: each reviewer's reason is cut to its share of a fixed budget (at most REASON_CHARS), the preview to
 * its first and last line, the middle of the call excerpt (its first and last CALL_KEPT_LINES lines stay), then what is
 * still over comes out of the reasons and each secret's snippet. The dialog's own lines and every reviewer's verdict line stay.
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
  // Over the cap, in this order: what a reviewer wrote (model prose) is cut first, each reason to its share of a fixed budget; then
  // the preview to its first and last line; then the middle of the call, never its first and last lines.
  if (joined.length > MAX_QUESTION_CHARS) {
    const limit = Math.min(REASON_CHARS, Math.floor(REASONS_BUDGET / Math.max(1, reasons.length)))
    reasons = reasons.map(reason => cutShares([reason], limit, mode)[0] as string)
    joined = build(reasons, snippets)
  }
  if (joined.length > MAX_QUESTION_CHARS && preview !== undefined) {
    preview = firstAndLast(preview)
    joined = build(reasons, snippets)
  }
  if (joined.length > MAX_QUESTION_CHARS) {
    call = dropMiddle(call, joined.length - MAX_QUESTION_CHARS, CALL_KEPT_LINES, CALL_KEPT_LINES, mode)
    joined = build(reasons, snippets)
  }
  if (joined.length > MAX_QUESTION_CHARS) {
    // What is left is the dialog's own lines, the call's ends and what reviewers said: each reason gives up its share of the excess.
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
