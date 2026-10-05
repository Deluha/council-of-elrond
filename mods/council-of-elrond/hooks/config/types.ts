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
}

/** What the project overrides file may hold: every field optional. */
export type Overrides = Partial<Omit<Config, 'schemaVersion'>> & { schemaVersion: 1 }

export type RuleSource = 'shipped' | 'project'

export const strictness = (tier: Tier): number => TIERS.indexOf(tier)

export const stricter = (a: Tier, b: Tier): Tier =>
  strictness(a) >= strictness(b) ? a : b
