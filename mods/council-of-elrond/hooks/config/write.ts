import { validateOverrides } from './schema.js'
import type { Rule } from './types.js'

/**
 * Edits to the project overrides file the mod makes itself, only after the
 * user confirmed the exact entry. Pure: the file's text in, the new text out.
 * A file that does not read as a valid overrides file is never rewritten, and
 * an edit whose result does not validate is not made.
 */

export type FileEdit = { ok: true; text: string } | { ok: false; problem: string }

type Raw = Record<string, unknown>

const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Reads the file (none, or blank: a new one), applies `change` to the parsed
 * object, validates the result and writes it back pretty-printed. Spreading
 * the parsed object keeps the user's key order; new keys go last.
 */
export function editOverrides(fileText: string | undefined, change: (raw: Raw) => Raw): FileEdit {
  let raw: Raw
  if (fileText === undefined || fileText.trim() === '') {
    raw = { schemaVersion: 1 }
  } else {
    let parsed: unknown
    try {
      parsed = JSON.parse(fileText)
    } catch {
      return { ok: false, problem: 'the rules file is not valid JSON' }
    }
    if (!isObject(parsed)) return { ok: false, problem: 'the rules file is not a JSON object' }
    raw = parsed
  }
  const before = validateOverrides(raw)
  if (before.overrides === undefined) return { ok: false, problem: `the rules file has errors (${before.errors.join('; ')})` }
  const next = change(raw)
  const after = validateOverrides(next)
  if (after.overrides === undefined) return { ok: false, problem: `the entry does not validate (${after.errors.join('; ')})` }
  return { ok: true, text: `${JSON.stringify(next, null, 2)}\n` }
}

/** Adds one entry to `gollum.allowlist`, keeping the rest of the file and its key order. */
export const withAllowlistEntry = (fileText: string | undefined, entry: string): FileEdit =>
  editOverrides(fileText, raw => {
    const gollum = isObject(raw.gollum) ? raw.gollum : {}
    const allowlist = Array.isArray(gollum.allowlist) ? (gollum.allowlist as unknown[]) : []
    return { ...raw, gollum: { ...gollum, allowlist: allowlist.includes(entry) ? allowlist : [...allowlist, entry] } }
  })

/**
 * Adds one rule after the file's own rules: rules the user wrote decide
 * first. An id already taken (the file changed since the rule was offered)
 * fails validation, and nothing is written.
 */
export const withRule = (fileText: string | undefined, rule: Rule): FileEdit =>
  editOverrides(fileText, raw => ({ ...raw, rules: [...(Array.isArray(raw.rules) ? (raw.rules as unknown[]) : []), rule] }))
