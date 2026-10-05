import { redact } from './redact.js'

/**
 * The audit log: one JSONL line per gated call. It holds no file contents,
 * diffs or secrets: the call itself appears only as its fingerprint, and the
 * reasons are redacted and cut.
 */

export type Decision = 'allow-once' | 'allowlist' | 'keep-blocked' | 'instruction' | 'dismissed' | 'chat' | 'unavailable'

export type AuditRecord = {
  ts: string
  tool: string
  /** SHA-256 of the tool and its whitespace-collapsed arguments, cut to 16 hex digits. */
  fingerprint: string
  /** The operation key: what the call attempts, so rephrased retries share it. */
  opKey: string | null
  tier: string
  ruleId: string | null
  member: string | null
  profile: string | null
  model: string | null
  verdict: string | null
  reason: string | null
  shadow: boolean
  bypass: boolean
  /** The user's answer, when the call was escalated. */
  decision: Decision | null
  /**
   * What happened to the call: it ran, ran and errored, was refused by the
   * council, was refused by the person at Claude Code's own permission
   * prompt, or was denied by that check with nobody asked.
   */
  outcome: 'ran' | 'error' | 'refused' | 'refused-by-user' | 'denied-by-permission'
  /** An identical call was approved earlier this prompt, so no reviewer ran. */
  cached?: true
  latencyMs: number
  tokens: number
  /** Present for a subagent's call. */
  agentId?: string
}

const MAX_REASON_CHARS = 300

/** The one line written for a record, newline included. */
export function auditLine(record: AuditRecord): string {
  const reason =
    record.reason === null
      ? null
      : (() => {
          const clean = redact(record.reason).replace(/\s+/g, ' ').trim()
          return clean.length > MAX_REASON_CHARS ? `${clean.slice(0, MAX_REASON_CHARS - 1)}…` : clean
        })()
  return `${JSON.stringify({ ...record, reason })}\n`
}

/** Collapses whitespace in every string, sorting keys, so a reformatted call matches. */
function canonical(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim()
  if (Array.isArray(value)) return value.map(canonical)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonical((value as Record<string, unknown>)[key])]),
    )
  }
  return value
}

/** The text a fingerprint hashes: tool name plus arguments, whitespace collapsed. */
export const fingerprintText = (tool: string, input: unknown): string => `${tool}\u0000${JSON.stringify(canonical(input))}`

export async function fingerprintOf(tool: string, input: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(fingerprintText(tool, input))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest.slice(0, 8), byte => byte.toString(16).padStart(2, '0')).join('')
}

export const ROTATED_FILES = 3

/**
 * The writes that append `line` to a log holding `current`: the new current
 * file, plus the rotated files when the line would take it past `maxBytes`.
 * `older` holds `<path>.1` .. `<path>.N-1` as read (undefined when absent).
 */
export function appendPlan(
  path: string,
  current: string,
  line: string,
  maxBytes: number,
  older: readonly (string | undefined)[],
): { path: string; text: string }[] {
  const size = new TextEncoder().encode(current).length + new TextEncoder().encode(line).length
  if (current === '' || size <= maxBytes) return [{ path, text: current + line }]
  const writes: { path: string; text: string }[] = []
  for (let n = ROTATED_FILES - 1; n >= 1; n--) {
    const source = n === 1 ? current : older[n - 2]
    if (source !== undefined) writes.push({ path: `${path}.${n}`, text: source })
  }
  writes.push({ path, text: line })
  return writes
}

/** The `.gitignore` written beside the log, so it is never committed. */
export const AUDIT_GITIGNORE = '# Written by the council mod: the audit log stays local.\n*\n'
