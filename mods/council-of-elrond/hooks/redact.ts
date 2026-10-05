/**
 * Secret patterns and redaction. Every reviewer prompt, refusal, escalation
 * and audit line passes through `redact` first. Stage 2's secrets scanner
 * builds on the same table, with each pattern's confidence level.
 */

export type SecretLevel = 'high' | 'low'

export type SecretPattern = {
  id: string
  level: SecretLevel
  label: string
  /** Global regex; `keep` names the leading groups kept verbatim. */
  re: RegExp
  keep?: number
}

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    id: 'private-key',
    level: 'high',
    label: 'private key',
    re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
  },
  { id: 'aws-access-key', level: 'high', label: 'AWS key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'github-token', level: 'high', label: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/g },
  { id: 'anthropic-key', level: 'high', label: 'Anthropic key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { id: 'openai-key', level: 'high', label: 'OpenAI key', re: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/g },
  { id: 'slack-token', level: 'high', label: 'Slack token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { id: 'google-api-key', level: 'high', label: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'stripe-key', level: 'high', label: 'Stripe key', re: /\b(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{20,}\b/g },
  {
    id: 'connection-string-password',
    level: 'high',
    label: 'password',
    re: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/'"]+:)([^\s@/'"$]{3,})(?=@)/gi,
    keep: 1,
  },
  {
    id: 'assignment',
    level: 'low',
    label: 'secret',
    re: /\b((?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|auth[_-]?token|client[_-]?secret)["']?\s*[=:]\s*["']?)([^\s"'&;,]{6,})/gi,
    keep: 1,
  },
]

/** Shannon entropy in bits per character. */
function entropyOf(text: string): number {
  const counts = new Map<string, number>()
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1)
  let bits = 0
  for (const count of counts.values()) {
    const p = count / text.length
    bits -= p * Math.log2(p)
  }
  return bits
}

const LONG_TOKEN = /[A-Za-z0-9+/_-]{40,}={0,2}/g

/** A long, random-looking token that is not hex (a git hash, a checksum). */
export const isRandomLooking = (token: string): boolean =>
  !/^[0-9a-f]+$/i.test(token) &&
  /[a-z]/.test(token) &&
  /[A-Z]/.test(token) &&
  /[0-9]/.test(token) &&
  entropyOf(token) >= 4.2

/** Replaces every secret the table (and long random tokens) finds. */
export function redact(text: string, patterns: readonly SecretPattern[] = SECRET_PATTERNS): string {
  let out = text
  for (const pattern of patterns) {
    out = out.replace(pattern.re, (...match: string[]) => {
      const kept = pattern.keep === undefined ? '' : match.slice(1, pattern.keep + 1).join('')
      return `${kept}[REDACTED ${pattern.label}]`
    })
  }
  return out.replace(LONG_TOKEN, token => (isRandomLooking(token) ? '[REDACTED token]' : token))
}
