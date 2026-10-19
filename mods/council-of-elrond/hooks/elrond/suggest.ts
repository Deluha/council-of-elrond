import { compileConfig, validateOverrides } from '../config/schema.js'
import type { CompiledConfig } from '../config/schema.js'
import { BIG_CHECKS } from '../config/types.js'
import type { Rule } from '../config/types.js'
import { classify, FILE_PATH_FIELDS, SHELL_TOOLS } from '../rules/classify.js'
import type { Call, Classification, ClassifyContext } from '../rules/classify.js'
import { text } from '../strings.js'

/**
 * After "allow once": the allow rule the user may add for that call, shown
 * as the exact JSON and written only on their confirm (register.ts).
 *
 * The rule is as narrow as the call. A shell rule anchors `command` on the
 * gated part's core and pins the whole command text through `input`, so a
 * wrapper (`sudo`), a redirect or another part the core does not show can't
 * ride on it. Before it is offered, the call is classified again with the
 * rule in place: it is offered only if it would make this call allow.
 */

export type Suggestion = {
  rule: Rule
  /** What identifies the pattern, whatever its id: a declined one is not offered again. */
  key: string
}

export type NoSuggestion =
  | 'block'
  | 'protected'
  | 'secret'
  | 'script'
  | 'unparsed'
  | 'expansion'
  | 'too-long'
  | 'declined'
  | 'not-allowed'

export type Suggested = { kind: 'rule'; suggestion: Suggestion } | { kind: 'none'; why: NoSuggestion }

/** Longer commands are not offered a rule: the dialog shows the rule whole. */
const MAX_COMMAND_CHARS = 300

const MAX_ID_CHARS = 40

/** Words whose meaning is decided only when the command runs: the text does not pin the target. */
const EXPANDS = /[$`]/

const SCRIPT_RULES = /^script-/

const UNPARSED_RULES = new Set(['command-too-long', 'command-too-complex'])

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/** One word as it appears inside the call's JSON text: escaped as JSON, then as a regex. */
const jsonWord = (word: string): string => escapeRegex(JSON.stringify(word).slice(1, -1))

function slug(value: string): string {
  const cut = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ID_CHARS)
    .replace(/-+$/, '')
  return cut === '' ? 'call' : cut
}

/** `allow-<slug>`, numbered past any id the config (or a check) already uses. */
function idFor(base: string, taken: ReadonlySet<string>): string {
  const id = `allow-${slug(base)}`
  if (!taken.has(id)) return id
  for (let n = 2; ; n++) if (!taken.has(`${id}-${n}`)) return `${id}-${n}`
}

type Pattern = Omit<Rule, 'id' | 'tier' | 'reason'>

function shellPattern(call: Call, classification: Classification): Pattern | NoSuggestion {
  const command = typeof call.input.command === 'string' ? call.input.command.trim() : ''
  if (command.length > MAX_COMMAND_CHARS) return 'too-long'
  // Newlines and tabs (heredocs, scripts) are not pinned word by word: no rule.
  if (/[\u0000-\u001f]/.test(command)) return 'too-long'
  const parts = classification.findings.flatMap(finding => (finding.part !== undefined ? [finding.part] : []))
  if (parts.length === 0) return 'unparsed'
  if (parts.some(part => part.coreWords.some(word => word === '' || EXPANDS.test(word) || /\s/.test(word)))) return 'expansion'
  if (EXPANDS.test(command)) return 'expansion'
  const cores = [...new Set(parts.map(part => part.core))]
  const anchored = cores.map(escapeRegex)
  const words = command.split(/ +/)
  const commandPin = `"command":" *${words.map(jsonWord).join(' +')} *"`
  // The sandbox flag is a separate input field the command pin does not see,
  // so an allow rule for `rm -r build` would also allow it with the sandbox
  // off. Forbid that: the rule matches only when the flag is absent.
  const input = call.tool === 'Bash' ? String.raw`^(?!.*"dangerouslyDisableSandbox":true).*${commandPin}` : commandPin
  return {
    tools: [call.tool],
    command: anchored.length === 1 ? `^${anchored[0]}$` : `^(?:${anchored.join('|')})$`,
    input,
  }
}

function filePattern(classification: Classification, tool: string): Pattern | NoSuggestion {
  const subjects = [...new Set(classification.findings.map(finding => finding.subject))]
  const [path] = subjects
  if (subjects.length !== 1 || path === undefined) return 'unparsed'
  return { tools: [tool], path: `^${escapeRegex(path)}$` }
}

/** The config with `rule` as the last project rule: project rules decide in file order. */
function withRule(compiled: CompiledConfig, rule: Rule): CompiledConfig {
  const projectIds = new Set(compiled.rules.filter(known => known.source === 'project').map(known => known.id))
  const rules = compiled.config.rules
  const lastProject = rules.reduce((last, known, index) => (projectIds.has(known.id) ? index : last), -1)
  return compileConfig(
    { ...compiled.config, rules: [...rules.slice(0, lastProject + 1), rule, ...rules.slice(lastProject + 1)] },
    new Set([...projectIds, rule.id]),
  )
}

/**
 * The allow rule for a call the user just allowed once, or why there is none.
 * Never for a block-tier match, a protected path, a call with a secrets
 * finding (an allow rule skips the scan), a script run (what runs is not in
 * the text) or a command whose words expand when it runs.
 */
export function suggestRule(
  call: Call,
  classification: Classification,
  compiled: CompiledConfig,
  where: ClassifyContext,
  options: { hadSecret: boolean; declined: readonly string[] },
): Suggested {
  const none = (why: NoSuggestion): Suggested => ({ kind: 'none', why })
  if (classification.tier === 'block' || classification.findings.some(finding => finding.tier === 'block')) return none('block')
  if (classification.isProtected) return none('protected')
  if (options.hadSecret) return none('secret')
  if (classification.findings.length === 0) return none('not-allowed')
  if (classification.findings.some(finding => UNPARSED_RULES.has(finding.ruleId))) return none('unparsed')
  if (classification.findings.some(finding => SCRIPT_RULES.test(finding.ruleId))) return none('script')

  const pattern: Pattern | NoSuggestion = SHELL_TOOLS.has(call.tool)
    ? shellPattern(call, classification)
    : FILE_PATH_FIELDS[call.tool] !== undefined
      ? filePattern(classification, call.tool)
      : { tools: [call.tool] }
  if (typeof pattern === 'string') return none(pattern)
  // A tool name with glob or regex syntax would match more than this tool.
  if (/[*?]|^\//.test(call.tool)) return none('unparsed')

  const key = JSON.stringify([pattern.tools, pattern.command ?? null, pattern.path ?? null, pattern.input ?? null])
  if (options.declined.includes(key)) return none('declined')

  const taken = new Set<string>([...compiled.rules.map(rule => rule.id), ...BIG_CHECKS])
  const first = classification.findings.find(finding => finding.part !== undefined)?.part?.core
  const rule: Rule = {
    id: idFor(first ?? (FILE_PATH_FIELDS[call.tool] !== undefined ? `${call.tool}-${classification.findings[0]?.subject ?? ''}` : call.tool), taken),
    tier: 'allow',
    ...pattern,
    reason: text('suggest.reason', {}, 'plain'),
  }
  if (validateOverrides({ schemaVersion: 1, rules: [rule] }).overrides === undefined) return none('not-allowed')
  const applied = withRule(compiled, rule)
  if (classify(call, applied, where).tier !== 'allow') return none('not-allowed')
  // The rule must not also allow the same command with the sandbox disabled.
  if (SHELL_TOOLS.has(call.tool)) {
    const sandboxed = { ...call, input: { ...call.input, dangerouslyDisableSandbox: true } }
    if (classify(sandboxed, applied, where).tier === 'allow') return none('not-allowed')
  }
  return { kind: 'rule', suggestion: { rule, key } }
}

/** The rule as the dialog shows it, and as it is written: the same pretty-printed JSON. */
export const ruleJson = (rule: Rule): string => JSON.stringify(rule, null, 2)
