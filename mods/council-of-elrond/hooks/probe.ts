/**
 * The C3 probe's log format (ROADMAP C3): one JSON object per line, written to
 * `council-c3-probe.jsonl` in the session root and to the debug log. This file
 * exists only on a probe branch that is never merged and never released.
 * Pure: no `$`, nothing from register.ts.
 */

import { redact } from './redact.js'
import type { SecretPattern } from './redact.js'

export const PROBE_FILE = 'council-c3-probe.jsonl'
export const PROBE_TAG = 'council-c3-probe'

/** Cuts `text` to `max` characters and marks the cut with an ellipsis. */
export function cap(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/**
 * A string field to be cut to `max` characters, but only after redaction: cutting
 * first could leave half a secret that no pattern matches.
 */
export class Capped {
  constructor(
    readonly text: string,
    readonly max: number,
  ) {}
}

export const capped = (text: string, max: number): Capped => new Capped(text, max)

/** Every string leaf redacted (then cut, if capped); the structure around it is kept, so the line stays valid JSON. */
function clean(value: unknown, patterns: readonly SecretPattern[] | undefined): unknown {
  if (typeof value === 'string') return redact(value, patterns)
  if (value instanceof Capped) return cap(redact(value.text, patterns), value.max)
  if (Array.isArray(value)) return value.map(item => clean(item, patterns))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item, patterns)]))
  }
  return value
}

/** One probe line as a JSON string, without a trailing newline. Nothing a field holds is written unredacted. */
export function probeLine(
  seq: number,
  event: string,
  atMs: number,
  fields: Readonly<Record<string, unknown>>,
  since?: number,
  patterns?: readonly SecretPattern[],
): string {
  return JSON.stringify({
    probe: 'c3',
    seq,
    event,
    at: new Date(atMs).toISOString(),
    ...(since !== undefined && { elapsedMs: atMs - since }),
    ...(clean(fields, patterns) as Record<string, unknown>),
  })
}
