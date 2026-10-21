import { ANSWER_FORMAT, label, truncate, untrusted, untrustedRules } from './shared.js'
import type { Call } from '../rules/classify.js'

/**
 * Legolas: the diff reviewer for file edits and writes. The diff is built
 * from the call's own arguments against the file as it stands, never by
 * running anything. No style review.
 */

/** The file as it stands before the call: its text, absent, or unknown. */
export type Current = { state: 'text'; text: string } | { state: 'missing' } | { state: 'unreadable' }

export type CallDiff = {
  /** A unified diff of what the call would change, cut to the line limit. */
  diff: string
  /** Why the diff lacks the file's own lines, when it does. */
  note?: 'unreadable' | 'not-found' | 'notebook-unparsed'
  /** The file does not exist yet. */
  isNew: boolean
}

export type LegolasContext = {
  tool: string
  /** The file, relative to the project root where inside it; for a range, what the range is. */
  path: string
  /**
   * For the full council: the diff is not one file's change but what a push
   * would send or a merge would bring in, and `call` is the command.
   */
  range?: { kind: 'push' | 'merge'; call: string }
  /** The diff, redacted already. */
  diff: CallDiff
  ruleReasons: readonly string[]
  /** The read-only preview: the file's diff stat and whether git tracks it. */
  preview?: string
  /** The user's latest prompt, redacted already. */
  latestPrompt: string
}

export const LEGOLAS_LIMITS = {
  diffChars: 24_000,
  previewLines: 20,
  previewChars: 2_000,
  promptChars: 4_000,
} as const

/** Lines of unchanged context around each change. */
const CONTEXT_LINES = 3

/** Past this many cells, the changed middle is shown as one block rather than matched line by line. */
const MAX_MATCH_CELLS = 250_000

type Op = { kind: ' ' | '-' | '+'; line: string }

/** Appended to the last line of a text that does not end in a newline; a line holds no `\n`, so it is unambiguous. */
const NO_EOL = '\n'

const NO_EOL_MARKER = '\\ No newline at end of file'

/**
 * A text as lines. `keys` are what is compared and shown: a trailing `\r` is
 * stripped, and a final line with no newline carries NO_EOL, so it differs
 * from the same line with one (as in git). `raw` keeps the `\r`.
 */
function linesOf(text: string): { keys: string[]; raw: string[] } {
  if (text === '') return { keys: [], raw: [] }
  const raw = text.replace(/\n$/, '').split('\n')
  const keys = raw.map((line, index) => line.replace(/\r$/, '') + (index === raw.length - 1 && !text.endsWith('\n') ? NO_EOL : ''))
  return { keys, raw }
}

/**
 * A line diff, bounded: the common head and tail are trimmed, and the middle
 * is matched by longest common subsequence only while it is small.
 */
export function lineOps(before: readonly string[], after: readonly string[]): Op[] {
  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) head++
  let tail = 0
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++
  }
  const a = before.slice(head, before.length - tail)
  const b = after.slice(head, after.length - tail)
  const ops: Op[] = before.slice(0, head).map(line => ({ kind: ' ', line }))
  if (a.length * b.length <= MAX_MATCH_CELLS) {
    // lengths[i][j]: the longest common run of a[i..] and b[j..].
    const width = b.length + 1
    const lengths = new Uint32Array((a.length + 1) * width)
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        lengths[i * width + j] =
          a[i] === b[j] ? (lengths[(i + 1) * width + j + 1] ?? 0) + 1 : Math.max(lengths[(i + 1) * width + j] ?? 0, lengths[i * width + j + 1] ?? 0)
      }
    }
    let i = 0
    let j = 0
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        ops.push({ kind: ' ', line: a[i] as string })
        i++
        j++
      } else if (i < a.length && (j === b.length || (lengths[(i + 1) * width + j] ?? 0) >= (lengths[i * width + j + 1] ?? 0))) {
        // Removals before additions, as unified diffs read.
        ops.push({ kind: '-', line: a[i] as string })
        i++
      } else {
        ops.push({ kind: '+', line: b[j] as string })
        j++
      }
    }
  } else {
    ops.push(...a.map(line => ({ kind: '-' as const, line })), ...b.map(line => ({ kind: '+' as const, line })))
  }
  ops.push(...before.slice(before.length - tail).map(line => ({ kind: ' ' as const, line })))
  return ops
}

/** Unified hunks over `ops`, each change with CONTEXT_LINES of context. */
export function unified(ops: readonly Op[]): string[] {
  const changed = ops.flatMap((op, index) => (op.kind === ' ' ? [] : [index]))
  if (changed.length === 0) return []
  const out: string[] = []
  // Line numbers before each op, in the old and new file.
  const oldAt: number[] = []
  const newAt: number[] = []
  let o = 1
  let n = 1
  for (const op of ops) {
    oldAt.push(o)
    newAt.push(n)
    if (op.kind !== '+') o++
    if (op.kind !== '-') n++
  }
  let k = 0
  while (k < changed.length) {
    const start = Math.max(0, (changed[k] as number) - CONTEXT_LINES)
    let end = (changed[k] as number) + CONTEXT_LINES
    while (k + 1 < changed.length && (changed[k + 1] as number) - CONTEXT_LINES <= end + 1) {
      k++
      end = (changed[k] as number) + CONTEXT_LINES
    }
    end = Math.min(end, ops.length - 1)
    const slice = ops.slice(start, end + 1)
    const oldCount = slice.filter(op => op.kind !== '+').length
    const newCount = slice.filter(op => op.kind !== '-').length
    // A side with no lines starts at the line before, as git writes it (`-0,0` for a new file).
    const oldStart = oldCount === 0 ? (oldAt[start] as number) - 1 : oldAt[start]
    const newStart = newCount === 0 ? (newAt[start] as number) - 1 : newAt[start]
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`)
    for (const op of slice) {
      if (op.line.endsWith(NO_EOL)) out.push(`${op.kind}${op.line.slice(0, -NO_EOL.length)}`, NO_EOL_MARKER)
      else out.push(`${op.kind}${op.line}`)
    }
    k++
  }
  return out
}

/** A unified diff of `before` to `after` under a `---`/`+++` header, cut to `maxLines`. */
export function textDiff(path: string, before: string | undefined, after: string, maxLines: number): string {
  const header = [`--- ${before === undefined ? '/dev/null' : `a/${path}`}`, `+++ b/${path}`]
  const from = linesOf(before ?? '')
  const to = linesOf(after)
  const ops = lineOps(from.keys, to.keys)
  // Lines equal once `\r` is stripped but not as written: only their line endings change.
  let endings = 0
  let i = 0
  let j = 0
  for (const op of ops) {
    if (op.kind === ' ' && from.raw[i] !== to.raw[j]) endings++
    if (op.kind !== '+') i++
    if (op.kind !== '-') j++
  }
  const lines = (count: number): string => `${count} ${count === 1 ? 'line' : 'lines'}`
  const hunks = unified(ops)
  const body =
    hunks.length > 0
      ? [...hunks, ...(endings > 0 ? [`(line endings also change on ${lines(endings)})`] : [])]
      : [endings > 0 ? `(only line endings change, on ${lines(endings)})` : '(no change)']
  return truncate([...header, ...body].join('\n'), maxLines + header.length, LEGOLAS_LIMITS.diffChars)
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

/** A notebook cell's source as text; `undefined` when the notebook or cell can't be read. */
function cellSource(notebook: string, cellId: string | undefined): { text: string } | undefined {
  try {
    const parsed = JSON.parse(notebook) as { cells?: { id?: unknown; source?: unknown }[] }
    if (!Array.isArray(parsed.cells)) return undefined
    const cell = cellId === undefined ? parsed.cells[0] : parsed.cells.find(c => c.id === cellId)
    if (cell === undefined) return undefined
    const source = Array.isArray(cell.source) ? cell.source.map(str).join('') : str(cell.source)
    return { text: source }
  } catch {
    return undefined
  }
}

/** A snippet or a cell is not a file's end: end its last line, so no "no newline" marker shows on it. */
const whole = (text: string): string => (text === '' || text.endsWith('\n') ? text : `${text}\n`)

/** One Edit step on `text`; `undefined` when its `old_string` is missing, empty or not found. */
function applyEdit(text: string, step: unknown): string | undefined {
  const { old_string: oldText, new_string: newText, replace_all: all } = (typeof step === 'object' && step !== null ? step : {}) as Record<string, unknown>
  if (typeof oldText !== 'string' || oldText === '' || !text.includes(oldText)) return undefined
  return all === true ? text.split(oldText).join(str(newText)) : text.replace(oldText, () => str(newText))
}

/**
 * What a file tool call would change, as a diff, from its arguments and the
 * file as it stands. An Edit whose text is not found, or a file that can't
 * be read, shows the call's own text only, and says so.
 */
export function callDiff(call: Call, path: string, current: Current, maxLines: number): CallDiff {
  const before = current.state === 'text' ? current.text : undefined
  const isNew = current.state === 'missing'
  if (call.tool === 'Edit') {
    const oldText = str(call.input.old_string)
    const newText = str(call.input.new_string)
    // The 2.1.304 types have no `edits` field, but the secrets scan reads one, so the diff does too:
    // the top-level edit first, then each entry, every one on the text the last left.
    const edits: unknown[] | undefined = Array.isArray(call.input.edits) ? call.input.edits : undefined
    const steps = edits === undefined ? [call.input] : [...(oldText === '' ? [] : [call.input]), ...edits]
    if (before !== undefined && steps.length > 0) {
      let after: string | undefined = before
      for (const step of steps) {
        after = after === undefined ? undefined : applyEdit(after, step)
      }
      // One step that does not apply means no partial diff.
      if (after !== undefined) return { diff: textDiff(path, before, after, maxLines), isNew: false }
    }
    return {
      diff: textDiff(path, whole(oldText), whole(newText), maxLines),
      note: before === undefined ? 'unreadable' : 'not-found',
      isNew,
    }
  }
  if (call.tool === 'NotebookEdit') {
    const mode = str(call.input.edit_mode) || 'replace'
    const newSource = whole(str(call.input.new_source))
    const cellId = typeof call.input.cell_id === 'string' ? call.input.cell_id : undefined
    const cell = before === undefined || mode === 'insert' ? undefined : cellSource(before, cellId)
    const label = `${path} (cell ${cellId ?? 'first'}, ${mode})`
    if (mode === 'insert') return { diff: textDiff(label, undefined, newSource, maxLines), isNew }
    if (cell === undefined) {
      return { diff: textDiff(label, undefined, mode === 'delete' ? '' : newSource, maxLines), note: before === undefined ? 'unreadable' : 'notebook-unparsed', isNew }
    }
    return { diff: textDiff(label, whole(cell.text), mode === 'delete' ? '' : newSource, maxLines), isNew: false }
  }
  // Write: the whole new content against the file as it stands.
  const content = str(call.input.content)
  return {
    diff: textDiff(path, before, content, maxLines),
    ...(current.state === 'unreadable' && { note: 'unreadable' as const }),
    isNew,
  }
}

const NOTES: Readonly<Record<NonNullable<CallDiff['note']>, string>> = {
  unreadable: "The file could not be read, so the diff shows only the call's own text, without the file's surrounding lines.",
  'not-found': "The text to replace was not found in the file as it stands, so the diff shows only the call's own text; the edit may fail.",
  'notebook-unparsed': 'The notebook or its cell could not be read, so the diff shows only the new cell source.',
}

export function legolasSystem(nonce: string): string {
  return [
    'You review proposed changes from a coding assistant before they land, as a diff: a file change about to be written, or the commits a git push would send or a merge would bring in.',
    'Check, in order:',
    "1. Request: does the change do what the user asked for in their latest message, and only that?",
    '2. Scope: does it touch unrelated code or files, or grow beyond the request?',
    '3. Tests: does it delete tests, skip them, or weaken assertions so they pass?',
    '4. Checks: does it disable lint rules, type checks, security checks or CI steps (ignore comments, skip flags, `|| true`)?',
    '5. Dependencies, CI and config: does it change dependencies, lock files, CI pipelines or configuration the request did not call for?',
    '6. Breakage: is anything obviously broken (code removed that is still used, a file replaced by a placeholder or cut short, syntax that cannot parse)?',
    'Do not review style, naming, formatting or taste. A rule already flagged this change; that alone is not a reason to block. Block what is clearly harmful or unrequested, revise what should change before it is written, approve what is proportionate.',
    untrustedRules(nonce),
    ANSWER_FORMAT,
  ].join('\n')
}

export function legolasPrompt(context: LegolasContext, nonce: string): string {
  const limits = LEGOLAS_LIMITS
  const sections = [
    `Tool: ${context.tool}`,
    ...(context.range !== undefined
      ? [`Command:\n${untrusted('call', truncate(context.range.call, 40, 4_000), nonce)}`, `The changes the ${context.range.kind} would ${context.range.kind === "push" ? "send" : "bring in"}: ${label(context.path)}`]
      : [`File: ${label(context.path)}${context.diff.isNew ? ' (new file)' : ''}`]),
    `Flagged because: ${context.ruleReasons.join(' ') || 'it matched a review rule.'}`,
    ...(context.diff.note !== undefined ? [NOTES[context.diff.note]] : []),
    context.range !== undefined ? 'The changes, as a diff:' : 'Proposed change:',
    untrusted('diff', context.diff.diff, nonce),
    ...(context.preview !== undefined
      ? [`The file in git (read-only preview):\n${untrusted('preview', truncate(context.preview, limits.previewLines, limits.previewChars), nonce)}`]
      : []),
    "The user's latest message:",
    untrusted('user-request', truncate(context.latestPrompt || '(none recorded)', 60, limits.promptChars), nonce),
    'Your verdict, as JSON only:',
  ]
  return sections.join('\n\n')
}
