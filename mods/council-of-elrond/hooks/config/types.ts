/**
 * The council's configuration: the shipped defaults (defaults.ts) merged with
 * the project overrides file (.claude/council-of-elrond/rules.json).
 */

/** Tiers, least strict first: the strictest across a call's parts wins. */
export const TIERS = ['allow', 'review', 'ask', 'block'] as const
export type Tier = (typeof TIERS)[number]

export const MEMBERS = ['gandalf', 'legolas', 'aragorn'] as const
export type MemberName = (typeof MEMBERS)[number]

export const PROFILES = ['git', 'database'] as const
export type Profile = (typeof PROFILES)[number]

/** Model slots: one per model member, plus the full council's. */
export const MODEL_SLOTS = ['gandalf', 'legolas', 'aragorn', 'council'] as const
export type ModelSlot = (typeof MODEL_SLOTS)[number]

/**
 * Checks written in code, for what a pattern cannot say safely: they read the
 * parsed words of a shell part rather than its text.
 */
export const CHECKS = [
  'rm-outside-repo',
  'force-push-protected',
  'destructive-sql-production',
  'privileged',
  'redirect-write',
  'git-config-write',
  'git-config-injection',
  'dangerous-env-assignment',
] as const
export type CheckName = (typeof CHECKS)[number]

export type Rule = {
  /** Unique id, shown in /council rules and the audit log. */
  id: string
  tier: Tier
  /**
   * The tools the rule covers: an exact name (`Bash`), a glob (`mcp__*`), or a
   * regex written `/source/flags`.
   */
  tools: readonly string[]
  /** Regex matched against each part of a shell command (Bash, Monitor). */
  command?: string
  /** Regex matched against the call's file path, relative to the project root. */
  path?: string
  /** Regex matched against the call's input as JSON. */
  input?: string
  /** A check in code (CHECKS) that must also hold. */
  check?: CheckName
  /** Who reviews a `review` match; Gandalf when absent. */
  member?: MemberName
  profile?: Profile
  /** Plain-English reason, given to Claude and to you. Never the pattern. */
  reason: string
}

export type Config = {
  schemaVersion: 1
  rules: readonly Rule[]
  /** Ids of shipped non-block rules to switch off. */
  disableRules: readonly string[]
  /** Globs, relative to the project root: always the ask tier. */
  protectedPaths: readonly string[]
  /** Branch names or globs: force pushes to them are blocked. */
  protectedBranches: readonly string[]
  /** Regexes (case-insensitive) that make a target look like production. */
  productionPatterns: readonly string[]
  /** Per-slot model: an alias (`sonnet`, `opus`, `fable`) or a full id. */
  models: Readonly<Partial<Record<ModelSlot, string>>>
  /** The secrets scan's extra patterns and its allowlist. */
  gollum: GollumConfig
  /**
   * What goes to the full council instead of one member: a rule id, a command
   * regex written `/source/flags` (matched against each shell part), or a
   * named check (BIG_CHECKS).
   */
  bigOperations: readonly string[]
  /** The project's own checks the full council runs (tests, lint, typecheck). */
  gimli: GimliConfig
}

/** Big-operation entries decided in code: a merge whose target is a protected branch. */
export const BIG_CHECKS = ['merge-to-protected'] as const
export type BigCheck = (typeof BIG_CHECKS)[number]

export type GimliCommand = {
  /** Shown to the user and to Claude (`tests`, `lint`). */
  name: string
  /** The command by its argument vector: no shell. */
  argv: readonly string[]
  /** How long it may run, in milliseconds (default 120 s, at most 600 s). */
  timeoutMs: number
}

export type GimliConfig = {
  commands: readonly GimliCommand[]
}

export const SECRET_LEVELS = ['high', 'low'] as const

export type GollumPattern = {
  id: string
  level: (typeof SECRET_LEVELS)[number]
  /** Regex source, matched globally against what the call would write or run. */
  regex: string
  /** What the finding is called in the dialog and refusal (`deploy key`). */
  label: string
}

export type GollumConfig = {
  patterns: readonly GollumPattern[]
  /** Exact secret strings, or `sha256:` fingerprints the dialog shows. Never regexes. */
  allowlist: readonly string[]
}

/** What the project overrides file may hold: every field optional. */
export type Overrides = Partial<Omit<Config, 'schemaVersion' | 'gollum' | 'gimli'>> & {
  schemaVersion: 1
  gollum?: Partial<GollumConfig>
  gimli?: Partial<GimliConfig>
}

export type RuleSource = 'shipped' | 'project'

export const strictness = (tier: Tier): number => TIERS.indexOf(tier)

export const stricter = (a: Tier, b: Tier): Tier =>
  strictness(a) >= strictness(b) ? a : b
