import { globToRegExp, toolMatcher } from '../rules/globs.js'
import { SHIPPED } from './defaults.js'
import {
  CHECKS,
  MEMBERS,
  MODEL_SLOTS,
  PROFILES,
  SECRET_LEVELS,
  TIERS,
} from './types.js'
import type {
  CheckName,
  Config,
  GollumPattern,
  MemberName,
  ModelSlot,
  Overrides,
  Profile,
  Rule,
  RuleSource,
  Tier,
} from './types.js'

export const SCHEMA_VERSION = 1

export type CompiledRule = Rule & {
  source: RuleSource
  matchesTool: (tool: string) => boolean
  commandRe?: RegExp
  pathRe?: RegExp
  inputRe?: RegExp
}

export type CompiledConfig = {
  config: Config
  /** Project rules first, in file order, then the enabled shipped rules. */
  rules: readonly CompiledRule[]
  protectedPaths: readonly { glob: string; re: RegExp }[]
  protectedBranches: readonly RegExp[]
  production: readonly RegExp[]
}

export type LoadedConfig = {
  compiled: CompiledConfig
  /** Where the effective config came from. */
  origin: 'shipped' | 'shipped+project'
  /** Problems with the overrides file, by field; non-empty means it was ignored. */
  errors: readonly string[]
}

const TOP_KEYS = [
  'schemaVersion',
  'rules',
  'disableRules',
  'protectedPaths',
  'protectedBranches',
  'productionPatterns',
  'models',
  'gollum',
] as const

const GOLLUM_KEYS = ['patterns', 'allowlist'] as const
const GOLLUM_PATTERN_KEYS = ['id', 'level', 'regex', 'label'] as const

/** A fingerprint as the dialog shows it; anything else in the allowlist is an exact string. */
export const SECRET_FINGERPRINT = /^sha256:[0-9a-f]{16}$/

const MAX_ALLOWLIST_ENTRY = 500

const RULE_KEYS = [
  'id',
  'tier',
  'tools',
  'command',
  'path',
  'input',
  'check',
  'member',
  'profile',
  'reason',
] as const

export const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._\-[\]@:/]{0,99}$/

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const includes = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value)

function regexError(source: unknown, flags = ''): string | undefined {
  if (typeof source !== 'string' || source === '') return 'must be a non-empty regex string'
  try {
    new RegExp(source, flags)
    return undefined
  } catch (error) {
    return `invalid regex: ${error instanceof Error ? error.message : String(error)}`
  }
}

function stringList(value: unknown, field: string, errors: string[]): string[] {
  if (!Array.isArray(value)) {
    errors.push(`${field}: must be a list of strings`)
    return []
  }
  value.forEach((item, index) => {
    if (typeof item !== 'string' || item === '') {
      errors.push(`${field}[${index}]: must be a non-empty string`)
    }
  })
  return value.filter((item): item is string => typeof item === 'string' && item !== '')
}

function validateRule(raw: unknown, field: string, errors: string[]): Rule | undefined {
  if (!isObject(raw)) {
    errors.push(`${field}: must be an object`)
    return undefined
  }
  const before = errors.length
  for (const key of Object.keys(raw)) {
    if (!includes(RULE_KEYS, key)) errors.push(`${field}.${key}: unknown field`)
  }
  if (typeof raw.id !== 'string' || raw.id === '') errors.push(`${field}.id: required string`)
  if (!includes(TIERS, raw.tier)) errors.push(`${field}.tier: one of ${TIERS.join(', ')}`)
  const tools = stringList(raw.tools, `${field}.tools`, errors)
  if (Array.isArray(raw.tools) && raw.tools.length === 0) {
    errors.push(`${field}.tools: name at least one tool`)
  }
  tools.forEach((pattern, index) => {
    try {
      toolMatcher(pattern)
    } catch (error) {
      errors.push(`${field}.tools[${index}]: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
  for (const key of ['command', 'path', 'input'] as const) {
    if (raw[key] !== undefined) {
      const problem = regexError(raw[key])
      if (problem !== undefined) errors.push(`${field}.${key}: ${problem}`)
    }
  }
  if (raw.check !== undefined && !includes(CHECKS, raw.check)) {
    errors.push(`${field}.check: one of ${CHECKS.join(', ')}`)
  }
  if (raw.member !== undefined && !includes(MEMBERS, raw.member)) {
    errors.push(`${field}.member: one of ${MEMBERS.join(', ')}`)
  }
  if (raw.profile !== undefined) {
    if (!includes(PROFILES, raw.profile)) {
      errors.push(`${field}.profile: one of ${PROFILES.join(', ')}`)
    } else if (raw.member !== 'aragorn') {
      errors.push(`${field}.profile: only Aragorn (member "aragorn") has profiles`)
    }
  }
  if (typeof raw.reason !== 'string' || raw.reason.trim() === '') {
    errors.push(`${field}.reason: required string`)
  }
  if (errors.length > before) return undefined
  return {
    id: raw.id as string,
    tier: raw.tier as Tier,
    tools,
    ...(raw.command !== undefined && { command: raw.command as string }),
    ...(raw.path !== undefined && { path: raw.path as string }),
    ...(raw.input !== undefined && { input: raw.input as string }),
    ...(raw.check !== undefined && { check: raw.check as CheckName }),
    ...(raw.member !== undefined && { member: raw.member as MemberName }),
    ...(raw.profile !== undefined && { profile: raw.profile as Profile }),
    reason: (raw.reason as string).trim(),
  }
}

function validateGollum(raw: unknown, errors: string[]): Overrides['gollum'] {
  if (!isObject(raw)) {
    errors.push('gollum: must be an object')
    return undefined
  }
  for (const key of Object.keys(raw)) {
    if (!includes(GOLLUM_KEYS, key)) errors.push(`gollum.${key}: unknown field`)
  }
  const out: { patterns?: GollumPattern[]; allowlist?: string[] } = {}
  if (raw.patterns !== undefined) {
    if (!Array.isArray(raw.patterns)) {
      errors.push('gollum.patterns: must be a list')
    } else {
      const seen = new Set<string>()
      out.patterns = []
      raw.patterns.forEach((item, index) => {
        const field = `gollum.patterns[${index}]`
        if (!isObject(item)) {
          errors.push(`${field}: must be an object`)
          return
        }
        const before = errors.length
        for (const key of Object.keys(item)) {
          if (!includes(GOLLUM_PATTERN_KEYS, key)) errors.push(`${field}.${key}: unknown field`)
        }
        if (typeof item.id !== 'string' || item.id === '') errors.push(`${field}.id: required string`)
        else if (seen.has(item.id)) errors.push(`${field}.id: "${item.id}" is used twice`)
        if (!includes(SECRET_LEVELS, item.level)) errors.push(`${field}.level: one of ${SECRET_LEVELS.join(', ')}`)
        const problem = regexError(item.regex, 'g')
        if (problem !== undefined) errors.push(`${field}.regex: ${problem}`)
        else if (new RegExp(item.regex as string).test('')) errors.push(`${field}.regex: must not match empty text`)
        if (typeof item.label !== 'string' || item.label.trim() === '') errors.push(`${field}.label: required string`)
        if (errors.length > before) return
        seen.add(item.id as string)
        out.patterns?.push({
          id: item.id as string,
          level: item.level as GollumPattern['level'],
          regex: item.regex as string,
          label: (item.label as string).trim(),
        })
      })
    }
  }
  if (raw.allowlist !== undefined) {
    const entries = stringList(raw.allowlist, 'gollum.allowlist', errors)
    entries.forEach((entry, index) => {
      if (entry.length > MAX_ALLOWLIST_ENTRY) errors.push(`gollum.allowlist[${index}]: longer than ${MAX_ALLOWLIST_ENTRY} characters`)
      else if (!SECRET_FINGERPRINT.test(entry) && entry.length < 6) {
        errors.push(`gollum.allowlist[${index}]: an exact secret of at least 6 characters, or a sha256: fingerprint`)
      }
    })
    out.allowlist = entries
  }
  return out
}

/**
 * Validates the parsed overrides file against this build's schema, reporting
 * every problem by field. Any problem means the whole file is ignored.
 */
export function validateOverrides(
  raw: unknown,
  shipped: Config = SHIPPED,
): { overrides: Overrides; errors: [] } | { overrides: undefined; errors: string[] } {
  const errors: string[] = []
  if (!isObject(raw)) {
    return { overrides: undefined, errors: ['(file): must be a JSON object'] }
  }
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    return {
      overrides: undefined,
      errors: [
        `schemaVersion: ${JSON.stringify(raw.schemaVersion)} is not a version this build reads (${SCHEMA_VERSION})`,
      ],
    }
  }
  for (const key of Object.keys(raw)) {
    if (!includes(TOP_KEYS, key)) errors.push(`${key}: unknown field`)
  }

  const shippedIds = new Map(shipped.rules.map(rule => [rule.id, rule]))
  const overrides: Overrides = { schemaVersion: 1 }

  if (raw.rules !== undefined) {
    if (!Array.isArray(raw.rules)) {
      errors.push('rules: must be a list')
    } else {
      const seen = new Set<string>()
      const rules: Rule[] = []
      raw.rules.forEach((item, index) => {
        const rule = validateRule(item, `rules[${index}]`, errors)
        if (rule === undefined) return
        if (seen.has(rule.id)) errors.push(`rules[${index}].id: "${rule.id}" is used twice`)
        if (shippedIds.has(rule.id)) {
          errors.push(
            `rules[${index}].id: "${rule.id}" is a shipped rule's id; disable it with disableRules and give yours another id`,
          )
        }
        seen.add(rule.id)
        rules.push(rule)
      })
      overrides.rules = rules
    }
  }

  if (raw.disableRules !== undefined) {
    const ids = stringList(raw.disableRules, 'disableRules', errors)
    ids.forEach((id, index) => {
      const rule = shippedIds.get(id)
      if (rule === undefined) {
        errors.push(`disableRules[${index}]: "${id}" is not a shipped rule`)
      } else if (rule.tier === 'block') {
        errors.push(`disableRules[${index}]: "${id}" is a block rule; block rules cannot be disabled`)
      }
    })
    overrides.disableRules = ids
  }

  if (raw.protectedPaths !== undefined) {
    overrides.protectedPaths = stringList(raw.protectedPaths, 'protectedPaths', errors)
  }
  if (raw.protectedBranches !== undefined) {
    overrides.protectedBranches = stringList(raw.protectedBranches, 'protectedBranches', errors)
  }
  if (raw.productionPatterns !== undefined) {
    const patterns = stringList(raw.productionPatterns, 'productionPatterns', errors)
    patterns.forEach((pattern, index) => {
      const problem = regexError(pattern, 'i')
      if (problem !== undefined) errors.push(`productionPatterns[${index}]: ${problem}`)
    })
    overrides.productionPatterns = patterns
  }

  if (raw.models !== undefined) {
    if (!isObject(raw.models)) {
      errors.push('models: must be an object')
    } else {
      const models: Partial<Record<ModelSlot, string>> = {}
      for (const [slot, model] of Object.entries(raw.models)) {
        if (!includes(MODEL_SLOTS, slot)) {
          errors.push(`models.${slot}: unknown slot (one of ${MODEL_SLOTS.join(', ')})`)
        } else if (typeof model !== 'string' || !MODEL_ID.test(model)) {
          errors.push(`models.${slot}: must be a model alias or id`)
        } else {
          models[slot] = model
        }
      }
      overrides.models = models
    }
  }

  if (raw.gollum !== undefined) {
    const gollum = validateGollum(raw.gollum, errors)
    if (gollum !== undefined) overrides.gollum = gollum
  }

  return errors.length > 0
    ? { overrides: undefined, errors }
    : { overrides, errors: [] }
}

const union = (a: readonly string[], b: readonly string[] = []): string[] => [
  ...new Set([...a, ...b]),
]

/**
 * Overrides win: project rules are tried before shipped ones, and project
 * models stand. Lists only add to the shipped ones, so a project can widen
 * the protection but never narrow it; block rules cannot be disabled.
 */
export function mergeConfig(shipped: Config, overrides: Overrides): Config {
  const disabled = new Set(overrides.disableRules ?? [])
  return {
    schemaVersion: 1,
    rules: [
      ...(overrides.rules ?? []),
      ...shipped.rules.filter(rule => rule.tier === 'block' || !disabled.has(rule.id)),
    ],
    disableRules: [...disabled],
    protectedPaths: union(shipped.protectedPaths, overrides.protectedPaths),
    protectedBranches: union(shipped.protectedBranches, overrides.protectedBranches),
    productionPatterns: union(shipped.productionPatterns, overrides.productionPatterns),
    models: { ...shipped.models, ...overrides.models },
    gollum: {
      patterns: [...shipped.gollum.patterns, ...(overrides.gollum?.patterns ?? [])],
      allowlist: union(shipped.gollum.allowlist, overrides.gollum?.allowlist),
    },
  }
}

const branchToRegExp = (branch: string): RegExp => globToRegExp(branch)

export function compileConfig(config: Config, projectRuleIds: ReadonlySet<string>): CompiledConfig {
  const rules = config.rules.map((rule): CompiledRule => {
    const matchers = rule.tools.map(toolMatcher)
    return {
      ...rule,
      source: projectRuleIds.has(rule.id) ? 'project' : 'shipped',
      matchesTool: tool => matchers.some(matches => matches(tool)),
      ...(rule.command !== undefined && { commandRe: new RegExp(rule.command) }),
      ...(rule.path !== undefined && { pathRe: new RegExp(rule.path) }),
      ...(rule.input !== undefined && { inputRe: new RegExp(rule.input) }),
    }
  })
  return {
    config,
    rules,
    protectedPaths: config.protectedPaths.map(glob => ({ glob, re: globToRegExp(glob) })),
    protectedBranches: config.protectedBranches.map(branchToRegExp),
    production: config.productionPatterns.map(pattern => new RegExp(pattern, 'i')),
  }
}

/**
 * The effective config from the overrides file's text (undefined: no file).
 * A file that does not parse or validate is ignored whole, and the shipped
 * defaults stand, with the errors reported. It never turns the gate off.
 */
export function loadConfig(fileText: string | undefined, shipped: Config = SHIPPED): LoadedConfig {
  const shippedOnly = (errors: readonly string[]): LoadedConfig => ({
    compiled: compileConfig(shipped, new Set()),
    origin: 'shipped',
    errors,
  })
  if (fileText === undefined) return shippedOnly([])

  let raw: unknown
  try {
    raw = JSON.parse(fileText)
  } catch (error) {
    return shippedOnly([`(file): not valid JSON: ${error instanceof Error ? error.message : String(error)}`])
  }
  const result = validateOverrides(raw, shipped)
  if (result.overrides === undefined) return shippedOnly(result.errors)

  const merged = mergeConfig(shipped, result.overrides)
  const projectIds = new Set((result.overrides.rules ?? []).map(rule => rule.id))
  try {
    return { compiled: compileConfig(merged, projectIds), origin: 'shipped+project', errors: [] }
  } catch (error) {
    return shippedOnly([`(file): ${error instanceof Error ? error.message : String(error)}`])
  }
}
