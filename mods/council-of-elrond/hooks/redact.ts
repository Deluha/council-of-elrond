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
  /** A match the pattern's own reading says is not a secret (given the kept groups and the value): neither redacted nor flagged. */
  isNoise?: (kept: string, value: string) => boolean
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
    // `isNoise` then drops what is plainly not a secret: a plain word under 6 letters, a small number, a short path,
    // the shell's own `PWD` and `OLDPWD` when the value is a path.
    re: /\b([A-Za-z0-9_]{0,64}(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|auth[_-]?token|client[_-]?secret)\\?["']?\s*[=:]\s*\\?["']?)(?!\[REDACTED)((?<=")[^"\\\n]{4,1000}(?=\\?")|(?<=')[^'\\\n]{4,1000}(?=\\?')|[^\s"'&;,\\]{4,})/gi,
    keep: 1,
    isNoise: (kept, value) => isAssignmentNoise(kept, value),
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

/** A run of 8 or more letters, digits, dashes and underscores with both a letter and a digit in it: a literal, not a name. */
const hasLiteralRun = (text: string): boolean =>
  (text.match(/[A-Za-z0-9_-]{8,}/g) ?? []).some(run => /[A-Za-z]/.test(run) && /[0-9]/.test(run))

// `${1:-default}`: a positional parameter with a default, as a named one.
const VARIABLE = new RegExp(`^\\$(?:${NAME}|\\{(?:${NAME}|[0-9]{1,2})(?::?[-=+?](?:[A-Za-z_./-]*|\\$${NAME}))?\\})$`)
const COMMAND_SUBSTITUTION = /^\$\([^()]*\)$/
const PERCENT_VARIABLE = new RegExp(`^%(?:${NAME}%|\\(${NAME}\\)[sdr])$`)
const ANGLE_WORDS = /^<([A-Za-z0-9 _-]+)>$/
const BRACE_NAME = /^\{([A-Za-z_][A-Za-z0-9_.-]*)\}$/
const TEMPLATE = /^\{\{[^{}]*\}\}$/
const SUBSCRIPTS = /^[A-Za-z_][A-Za-z0-9_.]*(?:\[(?:\d{1,4}|[A-Za-z_][A-Za-z0-9_.]*)\])+$/
const IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]*/y
/**
 * Type and constructor names that take a size or a number and are code, not a word someone chose: `String(128)`,
 * `Numeric(10)`, `BigInt(10)`, `Uint8Array(32)`, `VARCHAR(64)`. A short, closed list: any other name that starts with an
 * upper-case letter and is called with a number is read as a literal (`isImplausibleCallee`).
 */
const KNOWN_TYPE_CALLEE =
  /^(?:String|Number|Boolean|BigInt|Symbol|Object|Array|Date|Integer|Float|Decimal|Numeric|Int|Char|Varchar|Text|Bytes|(?:Big)?(?:Int|Uint|Float)(?:8|16|32|64)(?:Clamped)?Array|VARCHAR|NVARCHAR|CHAR|NUMERIC|DECIMAL|INTEGER|FLOAT|BINARY|VARBINARY)$/

/**
 * A name called in a way that is not a plausible function reference. The rule: the name starts with an upper-case ASCII
 * letter (a function is camelCase or snake_case; a capital start is a constructor or a type), is not a known type name,
 * and either holds a digit (`Passw0rd()`) or its first argument starts with a digit (`Winter(2024)`, `Monkey(1)`,
 * `Zx(9)`). Such a value is a word with a number dressed as a call. Constructors with a name argument (`Token(options)`,
 * `CharField(widget=x)`), empty calls (`Config()`) and every lower-case callee (`uuid4()`, `min(8)`, `randomBytes(32)`)
 * are unaffected. `rest` is the text after the opening parenthesis.
 */
const isImplausibleCallee = (name: string, rest: string): boolean =>
  /^[A-Z]/.test(name) && !KNOWN_TYPE_CALLEE.test(name) && (/[0-9]/.test(name) || /^\s*[0-9]/.test(rest))

/** The index of the `)` that closes the `(` at `open`, or -1 when the text ends first. Nesting is counted; one pass. */
function closingParen(value: string, open: number): number {
  let depth = 0
  for (let at = open; at < value.length; at++) {
    if (value[at] === '(') depth++
    else if (value[at] === ')' && --depth === 0) return at
  }
  return -1
}

/**
 * What a call cut at a space or a comma may hold after its opening parenthesis: names, dots and underscores, and inside
 * a nested parenthesis also digits, commas and spaces (`Column(String(128)`). Anything else (`Summer(2024!`, `aec([e`)
 * reads as the middle of a literal, not as code.
 */
function isCutCallRest(rest: string): boolean {
  let depth = 0
  for (const char of rest) {
    if (char === '(') depth++
    else if (char === ')') depth--
    else if (!(depth > 0 ? /[A-Za-z0-9_$., -]/ : /[A-Za-z_$.]/).test(char)) return false
  }
  return depth >= 0
}

/**
 * A call expression: `name(.name)*( ... )`, then any chain of `.name`, `.name( ... )` and `[ ... ]`, with `await` or
 * `new` in front: `getToken()`, `z.string().min(8)`, `crypto.randomBytes(32)`, `uuid4()`, `response.json()["token"]`,
 * `await getToken(user)`. The arguments hold no quoted string and no letter-and-digit literal of 8 or more
 * characters, so `Secret(abcd1234)` and `Sup3r(Secret)9` are not one. A value cut at a space or a comma leaves the call
 * open (`getToken(user`, `getSecret(`) or its last subscript open (`...()[`): that reads as one only when its names have
 * no digit and its rest is names (`isCutCallRest`). Each parenthesis group is looked at once, so the cost is linear in the text.
 */
function isCallExpression(value: string): boolean {
  let at = /^(?:await|new)\s+/.exec(value)?.[0].length ?? 0
  let calls = 0
  let hasDigitName = false
  for (;;) {
    IDENTIFIER.lastIndex = at
    const name = IDENTIFIER.exec(value)?.[0]
    if (name === undefined) return false
    at += name.length
    if (/[0-9]/.test(name)) hasDigitName = true
    if (value[at] === '(') {
      if (isImplausibleCallee(name, value.slice(at + 1, at + 1 + 64))) return false
      const close = closingParen(value, at)
      if (close === -1) {
        const rest = value.slice(at + 1)
        return !hasDigitName && isCutCallRest(rest) && !hasLiteralRun(rest)
      }
      const args = value.slice(at + 1, close)
      if (/["'`]/.test(args) || hasLiteralRun(args)) return false
      calls++
      at = close + 1
    }
    while (value[at] === '[') {
      const end = value.indexOf(']', at)
      if (end === -1) return calls > 0 && at + 1 === value.length && !hasDigitName
      if (hasLiteralRun(value.slice(at + 1, end))) return false
      at = end + 1
    }
    if (at === value.length) return calls > 0
    if (value[at] !== '.') return false
    at++
  }
}

/**
 * A value that is wholly a reference or a template and nothing else: `$NAME`,
 * `${NAME}` (with a `:-default`; a positional parameter too), `$(...)`, `%NAME%`,
 * `<your-api-key>`, `{name}`, `{{ secrets.TOKEN }}`, a call expression such as
 * `getToken()` or `z.string().min(8)`, a subscript chain (`tokens[0]`) and a
 * mask of `*`. A value that only starts like one (`$ecret123!`, `Sup3r(Secret)9`,
 * `<realkey12345>`) is not one.
 */
const isWholeReference = (value: string): boolean => {
  if (VARIABLE.test(value) || COMMAND_SUBSTITUTION.test(value) || PERCENT_VARIABLE.test(value) || TEMPLATE.test(value) || /^\*+$/.test(value)) return true
  const words = ANGLE_WORDS.exec(value) ?? BRACE_NAME.exec(value)
  if (words !== null) return !looksLiteral(words[1] ?? '')
  return SUBSCRIPTS.test(value) || isCallExpression(value)
}

/**
 * The scan's test for a low-confidence value that is plainly not a secret: a
 * whole variable, template, call or subscript (`$TOKEN`, `getToken()`,
 * `tokens[0]`), a type (`string`), a keyword, or an identifier without a digit.
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
  TYPE_WORDS.test(value) ||
  /^(.)\1+$/.test(value)

// The shell's own variables hold a directory, not a secret; `pwd` stays a keyword in any other name.
const SHELL_OWN_VARIABLES = /^(?:PWD|OLDPWD)$/
const PLAIN_WORD = /^[A-Za-z_.]+$/
const SMALL_NUMBER = /^[0-9]{1,5}$/
const PATH = /^(?:\/|~\/)[A-Za-z0-9._/-]*$/
const BACKTICKS = /^`[^`]*`$/
// What a directory variable's value starts like: an absolute or home path, `.` and `..` (alone or as a path start), an expansion.
const DIRECTORY_START = /^(?:[/~$]|\.\.?(?:\/|$))/
// A subscript cut at its quote by the bare value: `ENV[` of `ENV["TOKEN"]`.
const OPEN_SUBSCRIPT = /^[A-Za-z_][A-Za-z0-9_.]*\[$/
/** The shortest value the pattern read before the 4-character minimum. A path or a backtick substitution under it is no secret; a longer one is redacted as it always was. */
const SHORT_VALUE = 6

/**
 * A value `PWD` or `OLDPWD` may hold without being a password: a path, `.` or `..`, an expansion (`$NAME`, `${NAME}`, `$(...)`)
 * or a backtick substitution, with no `;` in it. Anything else after `PWD=` is the password keyword of an ODBC-style
 * connection string and is read as any other password.
 */
const isDirectoryValue = (value: string): boolean => !value.includes(';') && (DIRECTORY_START.test(value) || BACKTICKS.test(value))

/**
 * An assignment match that is plainly not a secret, by its name and its value: the shell's `PWD` and `OLDPWD` with a directory value; a
 * plain word of letters, `_` and `.` under 6 characters (the 4-character minimum is for a value with a digit or any
 * other character); a bare number under 6 digits; a path (`/tmp`, `~/x`), a backtick substitution or the cut start of a
 * subscript (`ENV[`) under 6 characters.
 */
function isAssignmentNoise(kept: string, value: string): boolean {
  if (SHELL_OWN_VARIABLES.test(/^[A-Za-z0-9_]*/.exec(kept)?.[0] ?? '') && isDirectoryValue(value)) return true
  if (PLAIN_WORD.test(value)) return value.length < SHORT_VALUE
  // A bare number (`"token": 1234`); a quoted one is a string, which a person may have chosen as a password.
  if (SMALL_NUMBER.test(value)) return !/["']$/.test(kept)
  return value.length < SHORT_VALUE && (PATH.test(value) || BACKTICKS.test(value) || OPEN_SUBSCRIPT.test(value))
}

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
      const value = whole.slice(kept.length)
      if (pattern.level === 'low' && pattern.keep !== undefined && (isCodeReference(value) || pattern.isNoise?.(kept, value) === true)) return whole
      return `${kept}[REDACTED ${pattern.label}]`
    })
  }
  return out.replace(LONG_TOKEN, token => (isRandomLooking(token) ? '[REDACTED token]' : token))
}
