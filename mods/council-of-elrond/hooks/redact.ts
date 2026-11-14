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
  /** What the secret is: a `password` can be short and guessable from its fingerprint. Absent means `token`. */
  kind?: 'password' | 'token'
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
    kind: 'password',
    level: 'high',
    label: 'password',
    re: /(?<![a-z0-9+.-])([a-z0-9+.-]+:\/\/[^\s:@/'"]+:)([^\s@/'"$]{3,})(?=@)/gi,
    keep: 1,
  },
  {
    id: 'assignment',
    kind: 'password',
    level: 'low',
    label: 'secret',
    // A compound name (`DB_PASSWORD`, `PGPASSWORD`, `dbPassword`) is a name with
    // a word-character prefix, capped at 64 so a long run stays linear. Quotes may be JSON-escaped (`\"`); an already
    // redacted value is left alone. The value is a quoted run (spaces allowed, up to 1000 characters, closed by the
    // same quote) or a bare word of 4 or more characters. The quoted run is tried first, so a passphrase is not
    // cut at its first space. Each branch scans forward from one start and stops at a quote, so it stays linear.
    re: /\b([A-Za-z0-9_]{0,64}(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|auth[_-]?token|client[_-]?secret)\\?["']?\s*[=:]\s*\\?["']?)(?!\[REDACTED)((?<=")[^"\\\n]{4,1000}(?=\\?")|(?<=')[^'\\\n]{4,1000}(?=\\?')|[^\s"'&;,\\]{4,})/gi,
    keep: 1,
  },
  { id: 'jwt', level: 'low', label: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  {
    id: 'authorization-header',
    level: 'low',
    label: 'authorization header',
    // `Authorization: Basic|Bearer|Token|ApiKey <value>` and the `X-Api-Key` and `X-Auth-Token` headers. The two
    // newer schemes allow only a space or tab before the value, so a line break never reaches the next line.
    re: /\b((?:authorization\\?["']?\s*:\s*\\?["']?(?:(?:basic|bearer)\s+|(?:token|apikey)[ \t]+)|x-(?:api-key|auth-token)\\?["']?\s*:\s*\\?["']?))(?!\[REDACTED)([A-Za-z0-9+/._~-]{8,}=*)/gi,
    keep: 1,
  },
  {
    id: 'mysql-password',
    kind: 'password',
    level: 'low',
    label: 'password',
    // Case-sensitive on purpose: `-P3306` is the port, never the password.
    // `-pVALUE` (attached), `--password=VALUE` and `--password VALUE`. A spaced `-p` is not here: in mysql it
    // prompts, and the next word is the database name. A spaced `--password` value never starts with a dash, a
    // redirect or a pipe, and only a space or tab separates it.
    re: /\b((?:mysql|mysqldump|mysqladmin|mariadb)\b[^\n|;&]{0,200}?\s(?:-p|--password=|--password[ \t]+(?=[^\s'"<>|&;-])))(?!\[REDACTED)([^\s'"]{3,})/g,
    keep: 1,
  },
  {
    id: 'curl-user-password',
    kind: 'password',
    level: 'low',
    label: 'password',
    // `curl -u user:PASSWORD`, `--user user:PASSWORD` and `--user=user:PASSWORD`. The user is capped at 64
    // characters and the look back to `curl` at 200, so each start costs a bounded amount.
    re: /\b(curl\b[^\n|;&]{0,200}?\s(?:-u[ \t]*|--user(?:[ \t]+|=))["']?[^\s:'"]{0,64}:)(?!\[REDACTED)([^\s'"]{3,})/g,
    keep: 1,
  },
  {
    id: 'connection-string-empty-user',
    kind: 'password',
    level: 'low',
    label: 'password',
    re: /(?<![a-z0-9+.-])([a-z0-9+.-]+:\/\/:)(?!\[REDACTED)([^\s@/'"$]{3,})(?=@)/gi,
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

const NAME = '[A-Za-z_][A-Za-z0-9_]*'

/** At least 8 letters and digits, once spaces, dashes and underscores are dropped, with both a letter and a digit. */
const looksLiteral = (text: string): boolean => {
  const bare = text.replace(/[ _-]/g, '')
  return bare.length >= 8 && /[A-Za-z]/.test(bare) && /[0-9]/.test(bare)
}

const VARIABLE = new RegExp(`^\\$(?:${NAME}|\\{${NAME}(?::?[-=+?](?:[A-Za-z_./-]*|\\$${NAME}))?\\})$`)
const COMMAND_SUBSTITUTION = /^\$\([^()]*\)$/
const PERCENT_VARIABLE = new RegExp(`^%(?:${NAME}%|\\(${NAME}\\)[sdr])$`)
const ANGLE_WORDS = /^<([A-Za-z0-9 _-]+)>$/
const BRACE_NAME = /^\{([A-Za-z_][A-Za-z0-9_.-]*)\}$/
const TEMPLATE = /^\{\{[^{}]*\}\}$/
const CALL = /^[A-Za-z_$][A-Za-z_$.]*\((?:[A-Za-z_$.]*\)?|[A-Za-z_$][A-Za-z0-9_$.]*\))$/

/**
 * A value that is wholly a reference or a template and nothing else: `$NAME`,
 * `${NAME}` (with a `:-default`), `$(...)`, `%NAME%`, `<your-api-key>`,
 * `{name}`, `{{ secrets.TOKEN }}`, a call such as `getToken()` and a mask of
 * `*`. A value that only starts like one (`$ecret123!`, `Sup3r(Secret)9`,
 * `<realkey12345>`) is not one.
 */
const isWholeReference = (value: string): boolean => {
  if (VARIABLE.test(value) || COMMAND_SUBSTITUTION.test(value) || PERCENT_VARIABLE.test(value) || TEMPLATE.test(value) || /^\*+$/.test(value)) return true
  const words = ANGLE_WORDS.exec(value) ?? BRACE_NAME.exec(value)
  if (words !== null) return !looksLiteral(words[1] ?? '')
  return CALL.test(value) && !looksLiteral(value.slice(value.indexOf('(') + 1))
}

/**
 * The scan's test for a low-confidence value that is plainly not a secret: a
 * whole variable, template or call (`$TOKEN`, `getToken()`), a type
 * (`string`), a keyword, or an identifier without a digit.
 */
export const isPlaceholder = (value: string): boolean =>
  isWholeReference(value) || (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(value) && !/[0-9]/.test(value)) || /^(.)\1+$/.test(value)

const TYPE_WORDS =
  /^(?:string|number|boolean|bigint|symbol|object|any|unknown|never|void|null|undefined|none|str|int|float|bool|bytes|true|false)(?:\[\]|\?)?$/i

/**
 * Redaction's own, narrower test: a value left readable only when it is
 * plainly code (a variable, a call, a dotted path, an indexed lookup, a type
 * word, a mask). An all-letter word such as `correcthorse` is redacted even
 * though the scan does not flag it.
 */
export const isCodeReference = (value: string): boolean =>
  isWholeReference(value) ||
  /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/.test(value) ||
  /^[A-Za-z_][A-Za-z0-9_.]*(?:\[(?:\d{1,4}|[A-Za-z_][A-Za-z0-9_.]*)\])+$/.test(value) ||
  TYPE_WORDS.test(value) ||
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
      // Only after a name: a format with no name (a JWT is dotted words too) is all secret.
      if (pattern.level === 'low' && pattern.keep !== undefined && isCodeReference(whole.slice(kept.length))) return whole
      return `${kept}[REDACTED ${pattern.label}]`
    })
  }
  return out.replace(LONG_TOKEN, token => (isRandomLooking(token) ? '[REDACTED token]' : token))
}
