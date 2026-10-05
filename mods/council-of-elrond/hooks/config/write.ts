import { validateOverrides } from './schema.js'

/**
 * Edits to the project overrides file the mod makes itself, only after the
 * user confirmed the exact entry. Pure: the file's text in, the new text out.
 * A file that does not read as a valid overrides file is never rewritten.
 */

export type FileEdit = { ok: true; text: string } | { ok: false; problem: string }

/** Adds one entry to `gollum.allowlist`, keeping the rest of the file and its key order. */
export function withAllowlistEntry(fileText: string | undefined, entry: string): FileEdit {
  let raw: Record<string, unknown>
  if (fileText === undefined || fileText.trim() === '') {
    raw = { schemaVersion: 1 }
  } else {
    let parsed: unknown
    try {
      parsed = JSON.parse(fileText)
    } catch {
      return { ok: false, problem: 'the rules file is not valid JSON' }
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, problem: 'the rules file is not a JSON object' }
    }
    raw = parsed as Record<string, unknown>
  }
  const before = validateOverrides(raw)
  if (before.overrides === undefined) return { ok: false, problem: `the rules file has errors (${before.errors.join('; ')})` }

  const gollum = typeof raw.gollum === 'object' && raw.gollum !== null ? (raw.gollum as Record<string, unknown>) : {}
  const allowlist = Array.isArray(gollum.allowlist) ? (gollum.allowlist as unknown[]) : []
  const next = {
    ...raw,
    gollum: { ...gollum, allowlist: allowlist.includes(entry) ? allowlist : [...allowlist, entry] },
  }
  const after = validateOverrides(next)
  if (after.overrides === undefined) return { ok: false, problem: `the entry does not validate (${after.errors.join('; ')})` }
  return { ok: true, text: `${JSON.stringify(next, null, 2)}\n` }
}
