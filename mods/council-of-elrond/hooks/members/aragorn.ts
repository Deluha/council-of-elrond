import { ANSWER_FORMAT, truncate, untrusted, untrustedRules } from './shared.js'
import type { CallDiff } from './legolas.js'
import { seatOf } from '../elrond/routing.js'
import type { Classification } from '../rules/classify.js'

/**
 * Aragorn: git and databases, as two profiles. Each profile has its own
 * system prompt and checklist, so neither carries the other's.
 */

export type AragornGitContext = {
  tool: string
  /** The command, redacted already. */
  call: string
  ruleReasons: readonly string[]
  /** The read-only preview: branch, remote and the commits a push would send, or recent history. */
  preview?: string
  /** The configured protected branches (names or globs). */
  protectedBranches: readonly string[]
  latestPrompt: string
}

export type SqlPiece = { label: string; text: string }

export type AragornDatabaseContext = {
  tool: string
  /** The command or the call's arguments, redacted already. */
  call: string
  ruleReasons: readonly string[]
  /** SQL the call runs or writes: inline (`-c`, heredoc), files it names, or a file tool's diff. Redacted already. */
  sql: readonly SqlPiece[]
  /** For a file tool: the diff of the SQL file. */
  diff?: CallDiff
  /** What in the call looks like production, by the configured patterns. */
  production: readonly string[]
  latestPrompt: string
}

export const ARAGORN_LIMITS = {
  callLines: 200,
  callChars: 12_000,
  previewLines: 60,
  previewChars: 6_000,
  sqlLines: 150,
  sqlChars: 8_000,
  promptChars: 4_000,
  maxSqlFiles: 3,
} as const

/** Per SQL client: the options that take SQL inline, and those that take a file of it. */
const CLIENT_OPTIONS: Readonly<Record<string, { inline: readonly string[]; file: readonly string[] }>> = {
  psql: { inline: ['-c', '--command'], file: ['-f', '--file'] },
  mysql: { inline: ['-e', '--execute'], file: [] },
  mariadb: { inline: ['-e', '--execute'], file: [] },
  mongo: { inline: ['--eval'], file: [] },
  mongosh: { inline: ['--eval'], file: ['-f', '--file'] },
  clickhouse: { inline: ['-q', '--query'], file: ['--queries-file'] },
  'clickhouse-client': { inline: ['-q', '--query'], file: ['--queries-file'] },
  sqlcmd: { inline: ['-Q', '-q'], file: ['-i'] },
  cqlsh: { inline: ['-e', '--execute'], file: ['-f', '--file'] },
}

const isSqlFile = (word: string): boolean => /\.sql$/i.test(word)

/**
 * SQL a shell call carries: inline arguments and heredocs of the parts the
 * database rules flagged, and the `.sql` files those parts name (as `-f`,
 * an input redirect or an argument). Files are only named here; register.ts
 * reads them.
 */
export function sqlOf(classification: Classification): { inline: SqlPiece[]; files: { word: string; cwd?: string }[] } {
  const inline: SqlPiece[] = []
  const files: { word: string; cwd?: string }[] = []
  for (const finding of classification.findings) {
    const part = finding.part
    const seat = finding.tier === 'review' ? seatOf(finding) : undefined
    if (part === undefined || seat?.member !== 'aragorn' || seat.profile !== 'database') continue
    const words = part.coreWords
    const program = words[0] ?? ''
    const options = CLIENT_OPTIONS[program.slice(program.lastIndexOf('/') + 1)] ?? { inline: [], file: [] }
    const named = (word: string): void => {
      if (!/[$`*?]/.test(word)) files.push({ word, ...(finding.cwd !== undefined && { cwd: finding.cwd }) })
    }
    for (let i = 1; i < words.length; i++) {
      const word = words[i] as string
      const eq = word.startsWith('--') ? word.indexOf('=') : -1
      const option = eq > 0 ? word.slice(0, eq) : word
      const value = eq > 0 ? word.slice(eq + 1) : words[i + 1]
      if (options.inline.includes(option) && value !== undefined) {
        inline.push({ label: `${program} ${option}`, text: value })
        if (eq < 0) i++
      } else if (options.file.includes(option) && value !== undefined) {
        named(value)
        if (eq < 0) i++
      } else if (isSqlFile(word)) {
        named(word)
      }
    }
    for (const redirect of part.redirects) {
      if (redirect.op === '<' && isSqlFile(redirect.target)) named(redirect.target)
    }
    if (part.input.trim() !== '') inline.push({ label: `${program} input (heredoc)`, text: part.input })
  }
  const unique = new Map(files.map(file => [`${file.cwd ?? ''}\u0000${file.word}`, file]))
  return { inline, files: [...unique.values()].slice(0, ARAGORN_LIMITS.maxSqlFiles) }
}

/** The text in `text` each production pattern matches, once each. */
export function productionHits(text: string, patterns: readonly RegExp[]): string[] {
  const hits = new Set<string>()
  for (const pattern of patterns) {
    const match = new RegExp(pattern.source, pattern.flags.replace('g', '')).exec(text)
    if (match !== null) hits.add(match[0].trim())
  }
  return [...hits].filter(hit => hit !== '')
}

export function aragornGitSystem(nonce: string): string {
  return [
    'You review one proposed git operation from a coding assistant before it runs: pushes, merges, rebases, resets, tags and other history changes.',
    'Check, in order:',
    '1. Target: does it push to, merge into, reset or rewrite a protected branch (listed in the prompt)?',
    '2. Force: does it force (--force, -f, a +refspec, --force-with-lease) or delete remote branches or tags?',
    '3. Published history: does it rewrite commits that are already pushed (reset, rebase, amend, filter-branch over commits a remote branch holds)? The preview decorates commits with the remote branches that point at them.',
    '4. Unrelated commits: would it send or bring in commits that have nothing to do with what the user asked for (the preview lists them)?',
    '5. Intent: does it match what the user asked for in their latest message?',
    'A rule already flagged this call; that alone is not a reason to block. Block what is clearly dangerous or unrequested, revise what has a safer form (a feature branch, --force-with-lease, a revert instead of a rewrite), approve what is proportionate.',
    untrustedRules(nonce),
    ANSWER_FORMAT,
  ].join('\n')
}

export function aragornGitPrompt(context: AragornGitContext, nonce: string): string {
  const limits = ARAGORN_LIMITS
  const sections = [
    `Tool: ${context.tool}`,
    `Flagged because: ${context.ruleReasons.join(' ') || 'it matched a review rule.'}`,
    `Protected branches: ${context.protectedBranches.join(', ') || '(none configured)'}`,
    'Proposed command:',
    untrusted('call', truncate(context.call, limits.callLines, limits.callChars), nonce),
    context.preview !== undefined
      ? `The repository (read-only preview):\n${untrusted('preview', truncate(context.preview, limits.previewLines, limits.previewChars), nonce)}`
      : 'No preview is available.',
    "The user's latest message:",
    untrusted('user-request', truncate(context.latestPrompt || '(none recorded)', 60, limits.promptChars), nonce),
    'Your verdict, as JSON only:',
  ]
  return sections.join('\n\n')
}

export function aragornDatabaseSystem(nonce: string): string {
  return [
    'You review one proposed database operation from a coding assistant before it runs: SQL clients, migrations, and SQL or schema files.',
    'Check, in order:',
    '1. Rollback: is there a way back (a down migration, a backup, a transaction that can roll back)?',
    '2. Destructive DDL: DROP, TRUNCATE, dropping or retyping columns, or anything else that loses data.',
    '3. Unbounded writes: an UPDATE or DELETE without a WHERE clause, or with one that matches everything.',
    '4. Target: does the target look like production (host, database name, connection string, environment)? Matches of the configured production patterns are listed in the prompt.',
    '5. Transactions: are statements that must succeed together wrapped in a transaction?',
    '6. Locks: would it hold long locks on large tables (indexes built without CONCURRENTLY, table rewrites, full-table updates)?',
    '7. Intent: does it match what the user asked for in their latest message?',
    'A rule already flagged this call; that alone is not a reason to block. Block what is clearly dangerous or unrequested, revise what has a safer form (a WHERE clause, a transaction, a staging target), approve what is proportionate.',
    untrustedRules(nonce),
    ANSWER_FORMAT,
  ].join('\n')
}

export function aragornDatabasePrompt(context: AragornDatabaseContext, nonce: string): string {
  const limits = ARAGORN_LIMITS
  const sections = [
    `Tool: ${context.tool}`,
    `Flagged because: ${context.ruleReasons.join(' ') || 'it matched a review rule.'}`,
    `Looks like production: ${context.production.length > 0 ? context.production.map(hit => JSON.stringify(hit)).join(', ') : 'nothing matched the configured patterns'}`,
    context.diff !== undefined ? `Proposed change${context.diff.isNew ? ' (new file)' : ''}:` : 'Proposed call:',
    context.diff !== undefined
      ? untrusted('diff', context.diff.diff, nonce)
      : untrusted('call', truncate(context.call, limits.callLines, limits.callChars), nonce),
    ...context.sql.map(piece => `SQL (${piece.label}):\n${untrusted('sql', truncate(piece.text, limits.sqlLines, limits.sqlChars), nonce)}`),
    "The user's latest message:",
    untrusted('user-request', truncate(context.latestPrompt || '(none recorded)', 60, limits.promptChars), nonce),
    'Your verdict, as JSON only:',
  ]
  return sections.join('\n\n')
}
