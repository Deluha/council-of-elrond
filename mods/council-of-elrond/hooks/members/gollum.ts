import { isRandomLooking, redact, SECRET_PATTERNS } from '../redact.js'
import type { SecretLevel, SecretPattern } from '../redact.js'
import { FILE_PATH_FIELDS, SHELL_TOOLS } from '../rules/classify.js'
import type { Call } from '../rules/classify.js'

/**
 * Gollum: the secrets scan, in code. It reads what a call would write or run
 * (a command and its heredocs, Write content, an Edit's new text, a notebook
 * cell, an MCP call's input), never what is already on disk. A high finding
 * is refused outright; a low one goes to the user with a redacted snippet.
 */

export type GollumFinding = {
  patternId: string
  level: SecretLevel
  label: string
  /** The line holding it, redacted and cut: safe to show anywhere. */
  snippet: string
  /** `sha256:` and 16 hex digits of the secret: what an allowlist entry holds. */
  fingerprint: string
}

export type GollumScan = { high: GollumFinding[]; low: GollumFinding[] }

/** The text a call would write or run, by tool. */
export function scannedText(call: Call): string {
  const input = call.input
  if (SHELL_TOOLS.has(call.tool)) return typeof input.command === 'string' ? input.command : ''
  if (call.tool === 'Write') return typeof input.content === 'string' ? input.content : ''
  if (call.tool === 'Edit') {
    const edits = Array.isArray(input.edits) ? input.edits : []
    return [input.new_string, ...edits.map(edit => (edit as { new_string?: unknown } | null)?.new_string)]
      .filter((value): value is string => typeof value === 'string')
      .join('\n')
  }
  if (call.tool === 'NotebookEdit') return typeof input.new_source === 'string' ? input.new_source : ''
  if (FILE_PATH_FIELDS[call.tool] !== undefined) return ''
  if (call.tool.startsWith('mcp__')) return JSON.stringify(input)
  return ''
}

const MAX_SCAN_CHARS = 500_000
const MAX_FINDINGS = 10
const SNIPPET_CHARS = 160

/**
 * A low-confidence value that is plainly not a secret: a variable or
 * expression (`$TOKEN`, `process.env.X`, `getToken()`), a type (`string`),
 * a keyword, or an identifier without a digit.
 */
const isPlaceholder = (value: string): boolean =>
  /^[$%<{(*[]/.test(value) ||
  value.includes('(') ||
  (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(value) && !/[0-9]/.test(value)) ||
  /^(.)\1+$/.test(value)

const LONG_TOKEN = /[A-Za-z0-9+/_-]{40,}={0,2}/g

/** Subresource-integrity and checksum prefixes: a hash, not a secret. */
const HASH_PREFIX = /(sha(1|224|256|384|512)[-:=]|integrity["':\s=]+|sum["':\s=]+|[0-9a-f]{7,}\s+)$/i

function lineAround(text: string, index: number, length: number, patterns: readonly SecretPattern[]): string {
  const start = text.lastIndexOf('\n', index) + 1
  const endAt = text.indexOf('\n', index + length)
  const line = text.slice(start, endAt === -1 ? undefined : endAt).trim()
  const clean = redact(line, patterns)
  return clean.length > SNIPPET_CHARS ? `${clean.slice(0, SNIPPET_CHARS - 1)}…` : clean
}

async function fingerprintOfSecret(secret: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)))
  return `sha256:${Array.from(digest.slice(0, 8), byte => byte.toString(16).padStart(2, '0')).join('')}`
}

const isAllowed = (allowlist: readonly string[], secret: string, fingerprint: string): boolean =>
  allowlist.includes(fingerprint) || allowlist.includes(secret)

/**
 * Every secret in the text, by the shipped and configured patterns, then
 * long random-looking tokens (low). Allowlisted secrets (exact string or
 * fingerprint) are left out. Pure but for hashing.
 */
export async function scanText(
  text: string,
  patterns: readonly SecretPattern[] = SECRET_PATTERNS,
  allowlist: readonly string[] = [],
): Promise<GollumScan> {
  const scan: GollumScan = { high: [], low: [] }
  const body = text.length > MAX_SCAN_CHARS ? text.slice(0, MAX_SCAN_CHARS) : text
  const covered: [number, number][] = []
  const seen = new Set<string>()

  const add = async (pattern: { id: string; level: SecretLevel; label: string }, secret: string, index: number, length: number) => {
    const fingerprint = await fingerprintOfSecret(secret)
    if (seen.has(fingerprint) || isAllowed(allowlist, secret, fingerprint)) return
    seen.add(fingerprint)
    const list = pattern.level === 'high' ? scan.high : scan.low
    if (list.length >= MAX_FINDINGS) return
    list.push({ patternId: pattern.id, level: pattern.level, label: pattern.label, snippet: lineAround(body, index, length, patterns), fingerprint })
  }

  for (const pattern of patterns) {
    const re = new RegExp(pattern.re.source, pattern.re.flags.includes('g') ? pattern.re.flags : `${pattern.re.flags}g`)
    for (const match of body.matchAll(re)) {
      const whole = match[0]
      if (whole === '') continue
      const kept = pattern.keep === undefined ? '' : match.slice(1, pattern.keep + 1).join('')
      const secret = whole.slice(kept.length)
      const index = (match.index ?? 0) + kept.length
      covered.push([match.index ?? 0, (match.index ?? 0) + whole.length])
      if (pattern.level === 'low' && isPlaceholder(secret)) continue
      await add(pattern, secret, index, secret.length)
    }
  }

  for (const match of body.matchAll(LONG_TOKEN)) {
    const index = match.index ?? 0
    const token = match[0]
    if (covered.some(([from, to]) => index < to && index + token.length > from)) continue
    if (!isRandomLooking(token) || HASH_PREFIX.test(body.slice(Math.max(0, index - 20), index))) continue
    await add({ id: 'random-token', level: 'low', label: 'random-looking token' }, token, index, token.length)
  }
  return scan
}

export const scanCall = (call: Call, patterns?: readonly SecretPattern[], allowlist?: readonly string[]): Promise<GollumScan> =>
  scanText(scannedText(call), patterns, allowlist)

/** Configured patterns (rules.json `gollum.patterns`) as scanner patterns, after the shipped ones. */
export const patternsWith = (configured: readonly { id: string; level: SecretLevel; regex: string; label: string }[]): SecretPattern[] => [
  ...SECRET_PATTERNS,
  ...configured.map(pattern => ({ id: pattern.id, level: pattern.level, label: pattern.label, re: new RegExp(pattern.regex, 'g') })),
]
