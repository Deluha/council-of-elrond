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
    re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/g,
  },
  { id: 'aws-access-key', level: 'high', label: 'AWS key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'github-token', level: 'high', label: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/g },
  { id: 'anthropic-key', level: 'high', label: 'Anthropic key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { id: 'openai-key', level: 'high', label: 'OpenAI key', re: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/g },
  { id: 'slack-token', level: 'high', label: 'Slack token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { id: 'google-api-key', level: 'high', label: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'stripe-key', level: 'high', label: 'Stripe key', re: /\b(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{20,}\b/g },
  { id: 'gitlab-token', level: 'high', label: 'GitLab token', re: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { id: 'npm-token', level: 'high', label: 'npm token', re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { id: 'google-oauth-secret', level: 'high', label: 'Google OAuth client secret', re: /\bGOCSPX-[A-Za-z0-9_-]{28}\b/g },
  {
    id: 'slack-webhook',
    level: 'high',
    label: 'Slack webhook URL',
    re: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{8,}\/B[A-Z0-9]{8,}\/[A-Za-z0-9]{24}\b/g,
  },
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
    // A compound name (`DB_PASSWORD`, `PGPASSWORD`, `dbPassword`) is a name with
    // a word-character prefix. Quotes may be JSON-escaped (`\"`); an already
    // redacted value is left alone.
    re: /\b([A-Za-z0-9_]*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|auth[_-]?token|client[_-]?secret)\\?["']?\s*[=:]\s*\\?["']?)(?!\[REDACTED)([^\s"'&;,\\]{6,})/gi,
    keep: 1,
  },
  { id: 'jwt', level: 'low', label: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  {
    id: 'authorization-header',
    level: 'low',
    label: 'authorization header',
    re: /\b(authorization\\?["']?\s*:\s*\\?["']?(?:basic|bearer)\s+)(?!\[REDACTED)([A-Za-z0-9+/._~-]{8,}=*)/gi,
    keep: 1,
  },
  {
    id: 'mysql-password',
    level: 'low',
    label: 'password',
    // Case-sensitive on purpose: `-P3306` is the port, never the password.
    re: /\b((?:mysql|mysqldump|mysqladmin|mariadb)\b[^\n|;&]{0,200}?\s-p)(?!\[REDACTED)([^\s'"]{3,})/g,
    keep: 1,
  },
  {
    id: 'connection-string-empty-user',
    level: 'low',
    label: 'password',
    re: /\b([a-z][a-z0-9+.-]*:\/\/:)(?!\[REDACTED)([^\s@/'"$]{3,})(?=@)/gi,
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

export const LONG_TOKEN = /[A-Za-z0-9+/_-]{40,}={0,2}/g

/**
 * A low-confidence value that is plainly not a secret: a variable or
 * expression (`$TOKEN`, `process.env.X`, `getToken()`), a type (`string`),
 * a keyword, an indexed lookup (`tokens[0]`), or an identifier without a digit.
 */
export const isPlaceholder = (value: string): boolean =>
  /^[$%<{(*[]/.test(value) ||
  value.includes('(') ||
  (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(value) && !/[0-9]/.test(value)) ||
  /^[A-Za-z_][A-Za-z0-9_.]*(?:\[(?:\d{1,4}|[A-Za-z_][A-Za-z0-9_.]*)\])+$/.test(value) ||
  /^(.)\1+$/.test(value)

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
    out = out.replace(pattern.re, (whole: string, ...match: string[]) => {
      const kept = pattern.keep === undefined ? '' : match.slice(0, pattern.keep).join('')
      // Code that only names a secret (`process.env.X`, `password: string`) stays as written.
      if (pattern.level === 'low' && isPlaceholder(whole.slice(kept.length))) return whole
      return `${kept}[REDACTED ${pattern.label}]`
    })
  }
  return out.replace(LONG_TOKEN, token => (isRandomLooking(token) ? '[REDACTED token]' : token))
}
