import { redact, SECRET_PATTERNS } from '../redact.js'
import type { SecretPattern } from '../redact.js'
import type { GIMLI_KEYS, GOLLUM_KEYS, TOP_KEYS } from './schema.js'
import type { GimliCommand, GollumPattern, ModelSlot, Overrides, Rule, Tier } from './types.js'

/**
 * Which settings of a project's rules file take effect before anyone has
 * confirmed that file, and which wait for it (ROADMAP M1.3, DESIGN §15). The
 * file arrives with a cloned repository, so nothing in it may run code, widen
 * what passes, or choose a model on its author's say-so alone.
 *
 * The rule of thumb: a setting is "always" only when it can make the gate
 * stricter and never looser than having no file at all. Anything that cannot
 * be shown to be so waits for trust. Everything here is pure; register.ts reads
 * the trust record and hands the answer in.
 */

type TopKey = (typeof TOP_KEYS)[number]

/** Every field of the overrides schema, nested ones as `parent.child`. */
export type FieldName = Exclude<TopKey, 'gollum' | 'gimli'> | `gollum.${(typeof GOLLUM_KEYS)[number]}` | `gimli.${(typeof GIMLI_KEYS)[number]}`

/**
 * `always`: applied whatever the file's trust. `needs-trust`: ignored until the
 * file is confirmed. `by-tier`: decided per rule by `TIER_TRUST`. `meta`: not a
 * setting. A field added to the schema without an entry here fails the typecheck,
 * and the trust test fails as well.
 */
export type FieldTrust = 'always' | 'needs-trust' | 'by-tier' | 'meta'

export const FIELD_TRUST: Readonly<Record<FieldName, FieldTrust>> = {
  schemaVersion: 'meta',
  rules: 'by-tier',
  // Switches a shipped review or ask rule off: fewer calls are gated.
  disableRules: 'needs-trust',
  // Lists that only add to the shipped ones: more is protected, never less.
  protectedPaths: 'always',
  protectedBranches: 'always',
  productionPatterns: 'always',
  // Names a model the mod would send the call to.
  models: 'needs-trust',
  // More calls go to the full council; the council's project checks wait for trust (see below).
  bigOperations: 'always',
  // Extra patterns blank what reviewers see and are run on call text.
  'gollum.patterns': 'needs-trust',
  // Lets a secret through the scan.
  'gollum.allowlist': 'needs-trust',
  // Starts processes outside Claude Code's permission check.
  'gimli.commands': 'needs-trust',
}

/**
 * A project rule decides before the shipped non-block rules do, so an `allow`
 * rule lets a call through and a `review` rule can lower a shipped `ask` to a
 * review: both wait for trust. `ask` and `block` rules sit at or above every
 * shipped tier a project rule can displace (block rules are a floor), so they
 * never loosen.
 */
export const TIER_TRUST: Readonly<Record<Tier, 'always' | 'needs-trust'>> = {
  allow: 'needs-trust',
  review: 'needs-trust',
  ask: 'always',
  block: 'always',
}

/**
 * What confirming a file would switch on, by kind, each item whole (every field the schema allows on it, so
 * the listing cannot leave one out). Every value is from the file: shown only cleaned, never cut or redacted.
 */
export type TrustSummary = {
  rules: Rule[]
  disabledRules: string[]
  /** How many entries; never the entries, which may be exact secrets. */
  allowlist: number
  models: { slot: ModelSlot; model: string }[]
  checks: GimliCommand[]
  patterns: GollumPattern[]
}

export type TrustCounts = { rules: number; disabled: number; allowlist: number; models: number; checks: number; patterns: number; total: number }

export type Split = {
  /** The tightening part: applied whatever the trust. */
  always: Overrides
  /** What waits for trust. */
  needsTrust: Overrides
  summary: TrustSummary
  counts: TrustCounts
}

export const countsOf = (summary: TrustSummary): TrustCounts => {
  const parts = {
    rules: summary.rules.length,
    disabled: summary.disabledRules.length,
    allowlist: summary.allowlist,
    models: summary.models.length,
    checks: summary.checks.length,
    patterns: summary.patterns.length,
  }
  return { ...parts, total: Object.values(parts).reduce((sum, n) => sum + n, 0) }
}

type Raw = Record<string, unknown>

const isRaw = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Splits validated overrides by `FIELD_TRUST` and `TIER_TRUST`. */
export function splitByTrust(overrides: Overrides): Split {
  const always: Raw = { schemaVersion: 1 }
  const needs: Raw = { schemaVersion: 1 }
  const source = overrides as unknown as Raw
  const place = (target: Raw, field: string, value: unknown): void => {
    const [head = '', sub] = field.split('.')
    if (sub === undefined) target[head] = value
    else target[head] = { ...(isRaw(target[head]) ? (target[head] as Raw) : {}), [sub]: value }
  }
  for (const field of Object.keys(FIELD_TRUST) as FieldName[]) {
    const kind = FIELD_TRUST[field]
    if (kind === 'meta') continue
    const [head = '', sub] = field.split('.')
    const parent = source[head]
    const value = sub === undefined ? parent : isRaw(parent) ? parent[sub] : undefined
    if (value === undefined) continue
    if (kind === 'by-tier') {
      const rules = value as readonly Rule[]
      place(always, field, rules.filter(rule => TIER_TRUST[rule.tier] === 'always'))
      const loose = rules.filter(rule => TIER_TRUST[rule.tier] === 'needs-trust')
      if (loose.length > 0) place(needs, field, loose)
    } else {
      place(kind === 'always' ? always : needs, field, value)
    }
  }
  const held = needs as unknown as Overrides
  const summary: TrustSummary = {
    rules: (held.rules ?? []).map(rule => ({ ...rule })),
    disabledRules: [...(held.disableRules ?? [])],
    allowlist: held.gollum?.allowlist?.length ?? 0,
    models: Object.entries(held.models ?? {}).map(([slot, model]) => ({ slot: slot as ModelSlot, model: model as string })),
    checks: (held.gimli?.commands ?? []).map(command => ({ ...command })),
    patterns: (held.gollum?.patterns ?? []).map(pattern => ({ ...pattern })),
  }
  return { always: always as unknown as Overrides, needsTrust: held, summary, counts: countsOf(summary) }
}

/** How a rules file stands: it holds nothing that waits, or the option trusts it, or a person confirmed this content, or it waits. */
export type RulesFile = {
  /** The file's real path (the key of the trust record). */
  path: string
  state: 'nothing' | 'option' | 'confirmed' | 'untrusted'
  /** SHA-256 of the exact text read, in hex; set once it was worked out (not for `nothing` or `option`). */
  hash?: string
}

/** The project checks of the files whose settings are being held back: they are not run, and the council says so. */
export const ignoredChecksOf = (loaded: readonly { needsTrust?: { isIgnored: boolean; counts: TrustCounts } | undefined }[]): number =>
  loaded.reduce((sum, one) => sum + (one.needsTrust?.isIgnored === true ? one.needsTrust.counts.checks : 0), 0)

/** Whether a file is held back: its needs-trust settings are ignored. */
export const isHeldBack = (loaded: { file?: RulesFile | undefined }): boolean => loaded.file?.state === 'untrusted'

// The trust record: the plugin's own store holds one value, the files a person confirmed, each by path and content hash.

export const TRUST_KEY = 'trustedRules'

/** At most this many files are remembered; the oldest confirmation is dropped first. */
export const TRUST_CAP = 200

export type TrustEntry = { path: string; hash: string }

/** Oldest first. */
export type TrustRecord = readonly TrustEntry[]

const HEX64 = /^[0-9a-f]{64}$/

/** Reads the stored value; anything that is not the expected shape holds nothing, so nothing is trusted by it. */
export function parseRecord(raw: unknown): TrustRecord {
  if (!isRaw(raw) || raw.v !== 1 || !Array.isArray(raw.files)) return []
  return raw.files.flatMap((entry: unknown): TrustEntry[] =>
    isRaw(entry) && typeof entry.path === 'string' && typeof entry.hash === 'string' && HEX64.test(entry.hash) ? [{ path: entry.path, hash: entry.hash }] : [],
  )
}

export const recordValue = (record: TrustRecord): { v: 1; files: TrustEntry[] } => ({ v: 1, files: record.map(entry => ({ ...entry })) })

/** Trusted only when the file's current content hash is the one confirmed for that very path. */
export const isTrusted = (record: TrustRecord, path: string, hash: string): boolean => record.some(entry => entry.path === path && entry.hash === hash)

/** The path's entry set to `hash` (newest), the oldest dropped past the cap. */
export const withTrusted = (record: TrustRecord, path: string, hash: string, cap = TRUST_CAP): TrustRecord =>
  [...record.filter(entry => entry.path !== path), { path, hash }].slice(-cap)

export const withoutTrusted = (record: TrustRecord, paths: readonly string[]): TrustRecord => record.filter(entry => !paths.includes(entry.path))

/** SHA-256 of the text as UTF-8, in hex. */
export async function hashOf(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
}

/** What a person types to confirm a file: 8 hex characters, derived from a per-session secret and the file's hash. */
export const CODE_CHARS = 8

/**
 * The code shown for a file's content: the start of SHA-256 over the session's nonce and the content hash. The
 * nonce is never shown or written, so the code cannot be worked out from the file alone (DESIGN §16).
 */
export const codeOf = async (nonce: string, hash: string): Promise<string> => (await hashOf(`${nonce}${hash}`)).slice(0, CODE_CHARS)

/** A typed code: exactly CODE_CHARS hex characters. */
export const isCode = (value: string): boolean => /^[0-9a-f]{8}$/.test(value)

export type CodeMatch<T> = { kind: 'none' } | { kind: 'ambiguous' } | { kind: 'match'; files: T[] }

/**
 * The files whose code is the one typed. Several files with the very same
 * content share a code and are confirmed together (the person saw that
 * content); matches with different content confirm nothing.
 */
export function matchCode<T extends { hash: string; code: string }>(files: readonly T[], code: string): CodeMatch<T> {
  const found = files.filter(file => file.code === code)
  const [first] = found
  if (first === undefined) return { kind: 'none' }
  return found.every(file => file.hash === first.hash) ? { kind: 'match', files: found } : { kind: 'ambiguous' }
}

// What the listing shows of the file's own text, and what makes a file impossible to confirm from the session
// (DESIGN §16): a value is shown whole and as it is, or the file is not confirmed on the strength of the listing.

/** At most this many held-back settings in one file can be confirmed from the session. */
export const MAX_ITEMS = 40

/** The longest a value may be, after cleaning, to be confirmed from the session. */
export const MAX_VALUE_CHARS = 400

// What a terminal can be made to act on or to hide: C0 and C1 controls, DEL, and the Unicode line and paragraph separators.
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g

// What changes how text reads without showing: direction marks and overrides, isolates, zero-width and joining characters, the byte order mark.
const HIDDEN = /[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g

/** A value from a file with controls replaced by a space and invisible or direction-changing characters removed. */
export const cleanText = (value: string): string => value.replace(CONTROLS, ' ').replace(HIDDEN, '')

export type Inspected = {
  /** The value cleaned: whole, not cut and not redacted. */
  text: string
  /** The value, or its cleaned form, is one `redact()` would change: it may hold a secret. */
  isSecret: boolean
  /** The cleaned value is over MAX_VALUE_CHARS. */
  isLong: boolean
  /** Cleaning removed or replaced something: the value held a character the person could not see or that a terminal acts on. */
  isUnclean: boolean
}

/** One value of a held-back setting, looked at once: what the listing may show of it and what it does to the file's confirmability. */
export function inspectValue(value: string, patterns: readonly SecretPattern[]): Inspected {
  const text = cleanText(value)
  const changes = (candidate: string): boolean => redact(candidate, SECRET_PATTERNS) !== candidate || redact(candidate, patterns) !== candidate
  return { text, isSecret: changes(value) || changes(text), isLong: text.length > MAX_VALUE_CHARS, isUnclean: text !== value }
}

/** The `trustProjectRules` option: `always` or anything else (`confirm`). */
export const trustMode = (value: unknown): 'confirm' | 'always' => (value === 'always' ? 'always' : 'confirm')
