import type { CouncilSession } from '../../types'
import type { CompiledConfig, LoadedConfig } from '../config/schema.js'
import { GIMLI_COMMAND_KEYS, GOLLUM_PATTERN_KEYS, RULE_KEYS } from '../config/schema.js'
import { cleanText, heldCount, inspectValue, isCode, MAX_ITEMS, MAX_VALUE_CHARS } from '../config/trust.js'
import type { TrustCounts, TrustSummary } from '../config/trust.js'
import type { Rule } from '../config/types.js'
import { toolMatcher } from '../rules/globs.js'
import { MEMBERS, MODEL_SLOTS, TIERS } from '../config/types.js'
import type { MemberName, ModelSlot } from '../config/types.js'
import { whoOf } from '../members/brief.js'
import { redact } from '../redact.js'
import type { SecretPattern } from '../redact.js'
import type { Classification } from '../rules/classify.js'
import type { Big, CouncilSeat } from './council.js'
import { councilSeatId } from './council.js'
import { median } from '../state.js'
import { text } from '../strings.js'
import type { Mode, StringKey } from '../strings.js'
import type { ModelChoice } from './models.js'
import type { Operation } from './operations.js'
import { attemptsOf } from './operations.js'
import type { Route, Seat } from './routing.js'

/**
 * `/council`: one command, its subcommands parsed from the raw argument
 * string, and its output built as lines. The output is for the user: register.ts
 * draws it in a pane or logs it. Where nothing draws, four subcommands also reach
 * Claude, redacted (relay.ts, ROADMAP C2).
 */

export type CouncilCommand =
  | { kind: 'status' }
  | { kind: 'bypass'; on: boolean }
  | { kind: 'shadow'; on: boolean }
  | { kind: 'log'; count: number }
  | { kind: 'rules' }
  | { kind: 'test'; command: string }
  | { kind: 'models' }
  | { kind: 'model'; slot: string; model: string; save: boolean }
  | { kind: 'trust'; code?: string }
  | { kind: 'untrust' }
  | { kind: 'reload' }
  | { kind: 'report' }
  | { kind: 'debate' }
  | { kind: 'usage'; key: StringKey; params?: Record<string, string> }

export type Output = { title: string; lines: string[] }

const DEFAULT_LOG = 10
const MAX_LOG = 50

/** Splits on spaces, keeping single- or double-quoted runs whole. */
export function words(args: string): string[] {
  const out: string[] = []
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g
  for (const match of args.matchAll(re)) out.push(match[1] !== undefined ? match[1].replace(/\\(.)/g, '$1') : (match[2] ?? match[3] ?? ''))
  return out
}

export function parseCouncil(args: string): CouncilCommand {
  const trimmed = args.trim()
  const [sub = '', ...rest] = words(trimmed)
  switch (sub.toLowerCase()) {
    case '':
    case 'status':
      return { kind: 'status' }
    case 'on':
      return { kind: 'bypass', on: false }
    case 'off':
      return { kind: 'bypass', on: true }
    case 'shadow': {
      const value = (rest[0] ?? '').toLowerCase()
      return value === 'on' || value === 'off' ? { kind: 'shadow', on: value === 'on' } : { kind: 'usage', key: 'cmd.shadowUsage' }
    }
    case 'log': {
      const n = Number(rest[0] ?? DEFAULT_LOG)
      return { kind: 'log', count: Number.isInteger(n) && n > 0 ? Math.min(n, MAX_LOG) : DEFAULT_LOG }
    }
    case 'rules':
      return { kind: 'rules' }
    case 'test': {
      // Everything after `test`, one layer of quotes removed: the command as typed.
      const raw = trimmed.slice(trimmed.indexOf(sub) + sub.length).trim()
      const command = /^(["'])([\s\S]*)\1$/.exec(raw)?.[2] ?? raw
      return command === '' ? { kind: 'usage', key: 'cmd.testUsage' } : { kind: 'test', command }
    }
    case 'model':
    case 'models': {
      if (rest.length === 0) return { kind: 'models' }
      const save = rest.includes('--save')
      const [slot, model] = rest.filter(word => word !== '--save')
      if (slot === undefined || model === undefined) return { kind: 'usage', key: 'cmd.modelUsage', params: { slots: MODEL_SLOTS.join(', ') } }
      return { kind: 'model', slot: slot.toLowerCase(), model, save }
    }
    case 'trust': {
      const code = rest[0]?.toLowerCase()
      if (code === undefined) return { kind: 'trust' }
      return rest.length === 1 && isCode(code) ? { kind: 'trust', code } : { kind: 'usage', key: 'trust.usage' }
    }
    case 'untrust':
      return rest.length === 0 ? { kind: 'untrust' } : { kind: 'usage', key: 'trust.usage' }
    case 'reload':
      return { kind: 'reload' }
    case 'report':
      return { kind: 'report' }
    case 'debate':
      return { kind: 'debate' }
    default:
      return { kind: 'usage', key: 'cmd.unknown', params: { sub } }
  }
}

/**
 * Whether a subcommand loosens the gate (bypass on, shadow on, a model switch,
 * confirming a rules file or listing what confirming would enable), so only a
 * person typing it may run it. `reload` is one too: it reads the rules file
 * again, so a file changed since the session began (and, where the option
 * trusts files, every setting in it) takes effect, and only a person may ask
 * for that (DESIGN §16). `models` (the listing), `on`, `shadow off`, `untrust`
 * and the rest change nothing that lets more through.
 */
export const needsPerson = (command: CouncilCommand): boolean =>
  (command.kind === 'bypass' && command.on) ||
  (command.kind === 'shadow' && command.on) ||
  command.kind === 'model' ||
  command.kind === 'trust' ||
  command.kind === 'reload'

/**
 * Whether a prompt submission runs the `/council` command (`name`): it never asks
 * the model, so unlike a skill or prompt command it does not start a new task.
 */
export const isCouncilCommand = (command: { name: string } | undefined, name: string): boolean => command?.name === name

export const isSlot = (value: string): value is ModelSlot => (MODEL_SLOTS as readonly string[]).includes(value)

export type StatusInput = {
  session: CouncilSession
  mode: 'enforcing' | 'shadow' | 'bypass'
  members: Readonly<Record<MemberName, { enabled: boolean; choice: ModelChoice }>>
  council: { enabled: boolean; choice: ModelChoice; sequential: boolean }
  gimli: { enabled: boolean; commands: number }
  gollumEnabled: boolean
  galadrielEnabled: boolean
  tokenBudget: number
  /** How the project rules file stands (`trustLines`); counts only. */
  trust?: readonly string[]
  /** Audit lines that could not be written since the session began. */
  auditFailures?: number
}

const ZERO_COUNTS = { approved: 0, revised: 0, blocked: 0, failed: 0 }

export function statusOutput(input: StatusInput): Output {
  const { session } = input
  const attempts = attemptsOf(session)
  const typical = median(session.reviewMs)
  const onOff = (on: boolean): string => text(on ? 'cmd.on' : 'cmd.off')
  return {
    title: text('cmd.title'),
    lines: [
      text('cmd.mode', { mode: text(`cmd.mode.${input.mode}`) }),
      text('cmd.members'),
      ...MEMBERS.map(member =>
        text('cmd.member', {
          who: text(whoOf(member)),
          id: member,
          state: onOff(input.members[member].enabled),
          model: input.members[member].choice.model,
          source: input.members[member].choice.source,
          ...(session.counts[member] ?? ZERO_COUNTS),
        }),
      ),
      text('cmd.council', {
        who: text('who.fullCouncil'),
        state: onOff(input.council.enabled),
        model: input.council.choice.model,
        source: input.council.choice.source,
        order: text(input.council.sequential ? 'cmd.council.sequential' : 'cmd.council.parallel'),
        ...(session.counts.council ?? ZERO_COUNTS),
      }),
      text('cmd.gimli', {
        who: text('who.gimli'),
        state: onOff(input.gimli.enabled),
        count: input.gimli.commands,
        ...(session.counts.gimli ?? ZERO_COUNTS),
      }),
      text('cmd.memberCode', { who: text('who.gollum'), state: onOff(input.gollumEnabled) }),
      text('cmd.memberCode', { who: text('who.galadriel'), state: onOff(input.galadrielEnabled) }),
      text('cmd.attempts', attempts),
      text('cmd.tokens', { spent: session.tokensSpent, budget: input.tokenBudget }),
      typical === undefined
        ? text('cmd.noReviews')
        : text('cmd.median', { time: `${(typical / 1000).toFixed(1)} s`, reviews: session.reviewMs.length }),
      ...(input.trust ?? []),
      ...((input.auditFailures ?? 0) > 0 ? [text('cmd.auditFailures', { n: input.auditFailures ?? 0 })] : []),
    ],
  }
}

/** The last `count` audit lines, newest last. Unparseable lines are skipped. */
export function logOutput(logText: string, count: number): Output {
  const records = logText
    .split('\n')
    .filter(line => line.trim() !== '')
    .flatMap(line => {
      try {
        return [JSON.parse(line) as Record<string, unknown>]
      } catch {
        return []
      }
    })
    .slice(-count)
  if (records.length === 0) return { title: text('cmd.title'), lines: [text('cmd.logEmpty')] }
  const str = (value: unknown, fallback = '-'): string => (typeof value === 'string' && value !== '' ? value : fallback)
  return {
    title: text('cmd.logTitle', { n: records.length }),
    lines: records.map(record =>
      text('cmd.logLine', {
        ts: str(record.ts).replace('T', ' ').slice(0, 19),
        tool: str(record.tool),
        tier: str(record.tier),
        who: str(record.member, record.tier === 'block' ? 'rules' : '-'),
        verdict: str(record.verdict, '-') + (record.shadow === true ? ' (shadow)' : '') + (record.cached === true ? ' (cached)' : ''),
        decision: typeof record.decision === 'string' ? `, you: ${record.decision}` : '',
        outcome: str(record.outcome),
        reason: str(record.reason, ''),
      }),
    ),
  }
}

/** The rules file's problems as one line: whether the file is partly applied or ignored whole. */
export const errorsLine = (errors: readonly string[], isPartial: boolean): string =>
  text(isPartial ? 'cmd.configPartial' : 'cmd.configErrors', { errors: errors.join('; ') })

/**
 * An exact-string allowlist entry shows no character of itself, in the person's copy as in the one relayed through
 * Claude (relay.ts): it may be a secret. A fingerprint (`sha256:`) is shown.
 */
export function rulesOutput(compiled: CompiledConfig, origin: string, errors: readonly string[], trust: readonly string[] = [], isPartial = false): Output {
  const rules = [...compiled.rules].sort((a, b) => TIERS.indexOf(b.tier) - TIERS.indexOf(a.tier))
  const list = (key: StringKey, items: readonly string[]): string[] =>
    items.length === 0 ? [] : [text('cmd.listLine', { name: text(key), items: items.join(', ') })]
  return {
    title: text('cmd.rulesTitle', { origin }),
    lines: [
      ...(errors.length > 0 ? [errorsLine(errors, isPartial)] : []),
      ...trust,
      ...rules.map(rule => text('cmd.ruleLine', { tier: rule.tier.padEnd(6), id: rule.id, source: rule.source, reason: rule.reason })),
      ...list('cmd.list.protectedPaths', compiled.config.protectedPaths),
      ...list('cmd.list.writeProtected', compiled.writeProtectedPaths.map(matcher => matcher.glob)),
      ...list('cmd.list.protectedBranches', compiled.config.protectedBranches),
      ...list('cmd.list.production', compiled.config.productionPatterns),
      ...list('cmd.list.secretPatterns', compiled.config.gollum.patterns.map(pattern => `${pattern.id} (${pattern.level})`)),
      ...list(
        'cmd.list.allowlist',
        compiled.config.gollum.allowlist.map(entry => (entry.startsWith('sha256:') ? entry : text('cmd.allowlistHidden'))),
      ),
    ],
  }
}

/** A seat as typed in config: `aragorn/git`, `gandalf`. */
const seatId = (seat: Seat): string => (seat.profile !== undefined ? `${seat.member}/${seat.profile}` : seat.member)

/** Who would review, for `/council test`: the route, and the model of the member it seats. */
export type Reviewer = { route: Route; choice?: ModelChoice }

/** A big operation, for `/council test`: who would sit, on which model, and the checks that would run. */
export type CouncilPreview = {
  big: Big
  enabled: boolean
  seats: readonly CouncilSeat[]
  choice: ModelChoice
  checks: readonly string[]
  /** A merge counted as big without the current branch being checked. */
  isBranchAssumed: boolean
  /** Project checks held back because their rules file is not trusted: they would not run, and the council would block. */
  ignoredChecks?: number
  /** Of those, the checks of a rules file with errors. */
  brokenChecks?: number
}

const seatLine = (seat: CouncilSeat): string =>
  seat.member === 'legolas' && seat.range !== undefined
    ? text('cmd.seatRange', { who: text(whoOf(seat.member)), id: seat.member, kind: seat.range })
    : text('cmd.seat', { who: text(whoOf(seat.member, seat.member === 'aragorn' ? seat.profile : undefined)), id: councilSeatId(seat) })

function councilLines(council: CouncilPreview): string[] {
  const who = text('who.fullCouncil')
  if (council.seats.length === 0) return [text('cmd.testCouncilNobody', { entry: council.big.entry, who })]
  return [
    text('cmd.testCouncil', { who, entry: council.big.entry, model: council.choice.model, source: council.choice.source, seats: council.seats.map(seatLine).join('; ') }),
    ...(council.checks.length > 0
      ? [text('cmd.testCouncilChecks', { who: text('who.gimli'), names: council.checks.map(name => `"${name}"`).join(', ') })]
      : (council.ignoredChecks ?? 0) === 0
        ? [text('cmd.testCouncilNoChecks')]
        : []),
    ...((council.ignoredChecks ?? 0) > (council.brokenChecks ?? 0) ? [text('cmd.testCouncilChecksUntrusted', { who: text('who.gimli') })] : []),
    ...((council.brokenChecks ?? 0) > 0 ? [text('cmd.testCouncilChecksBroken', { who: text('who.gimli') })] : []),
    ...(council.isBranchAssumed ? [text('cmd.testCouncilBranch', { who })] : []),
  ]
}

export function testOutput(
  command: string,
  classification: Classification,
  operation: Operation | undefined,
  reviewer: Reviewer | undefined,
  council?: CouncilPreview,
): Output {
  const decided = classification.decided
  const lines = [text('cmd.testTier', { tier: classification.tier })]
  if (decided === undefined) {
    lines.push(text('cmd.testAllow'))
  } else {
    for (const finding of classification.findings) {
      lines.push(text('cmd.testFinding', { subject: finding.subject, tier: finding.tier, rule: finding.ruleId, source: finding.source, reason: finding.reason }))
    }
    if (council?.enabled === true) {
      lines.push(...councilLines(council))
    } else if (classification.tier === 'review' && reviewer !== undefined) {
      const { route } = reviewer
      const wanted = route.wanted !== undefined ? `${text(whoOf(route.wanted.member, route.wanted.profile))} [${seatId(route.wanted)}]` : ''
      if (route.kind === 'none') {
        lines.push(text('cmd.testNoReviewer', { wanted }))
      } else {
        lines.push(
          text('cmd.testReviewer', {
            who: text(whoOf(route.member, route.profile)),
            id: route.member,
            profile: route.profile !== undefined ? `/${route.profile}` : '',
            model: reviewer.choice?.model ?? '-',
            source: reviewer.choice?.source ?? '-',
          }),
        )
        if (route.fallback !== undefined) lines.push(text('cmd.testFallback', { wanted, why: text(`route.${route.fallback}`) }))
      }
      if (council !== undefined) lines.push(text('cmd.testCouncilOff', { entry: council.big.entry, who: text('who.fullCouncil') }))
    }
    if (operation !== undefined) lines.push(text('cmd.testOperation', { key: operation.key }))
  }
  return { title: text('cmd.testTitle', { command: command.length > 60 ? `${command.slice(0, 59)}…` : command }), lines }
}

export function modelsOutput(choices: Readonly<Record<ModelSlot, ModelChoice>>): Output {
  return {
    title: text('cmd.modelTitle'),
    lines: MODEL_SLOTS.map(slot => text('cmd.modelLine', { id: slot, model: choices[slot].model, source: choices[slot].source })),
  }
}

// Trusting a project's rules file (DESIGN §15): what confirming would enable, and where a file stands.

/** The counts as one phrase: `2 allow rule(s), 1 project check(s)`. */
export function countsText(counts: TrustCounts, mode?: Mode): string {
  const kinds = [
    ['rules', 'trust.count.rules'],
    ['disabled', 'trust.count.disabled'],
    ['allowlist', 'trust.count.allowlist'],
    ['models', 'trust.count.models'],
    ['checks', 'trust.count.checks'],
    ['patterns', 'trust.count.patterns'],
  ] as const
  return kinds
    .filter(([kind]) => counts[kind] > 0)
    .map(([kind, key]) => text(key, { n: counts[kind] }, mode))
    .join(', ')
}

/** What applies now and only adds, as one phrase: `3 block, ask or review rule(s), 2 protected path, ...`. */
export function appliedText(counts: TrustCounts, mode?: Mode): string {
  return ([['appliedRules', 'trust.count.appliedRules'], ['appliedLists', 'trust.count.appliedLists']] as const)
    .filter(([kind]) => counts[kind] > 0)
    .map(([kind, key]) => text(key, { n: counts[kind] }, mode))
    .join(', ')
}

/** The line and the toast for a file nobody confirmed, by what is wrong with leaving it so: counts only, never text from the file. */
export function unconfirmedNotice(counts: TrustCounts): { line: string; toast: string } {
  return heldCount(counts) > 0
    ? { line: text('notice.rulesUntrusted', { summary: countsText(counts) }), toast: text('notice.rulesUntrustedShort') }
    : { line: text('notice.rulesUnconfirmed', { summary: appliedText(counts) }), toast: text('notice.rulesUnconfirmedShort') }
}

/** How a loaded file stands, for `/council rules` and `status`: counts only, never text from the file. */
export function trustLines(loaded: Pick<LoadedConfig, 'file' | 'needsTrust' | 'broken' | 'errors'>, mode?: Mode): string[] {
  // A broken file is never confirmed and has nothing to confirm: only how far it applies is said.
  if (loaded.broken !== undefined) return [text(loaded.broken.kind === 'partial' ? 'config.state.partial' : 'config.state.ignored', { n: loaded.errors.length }, mode)]
  const state = loaded.file?.state
  if (state === 'confirmed') return [text('trust.state.confirmed', {}, mode)]
  if (state === 'option') return [text('trust.state.option', {}, mode)]
  if (state === 'untrusted' && loaded.needsTrust !== undefined) {
    const { counts } = loaded.needsTrust
    return [
      heldCount(counts) > 0
        ? text('trust.state.untrusted', { summary: countsText(counts, mode) }, mode)
        : text('trust.state.unconfirmed', { summary: appliedText(counts, mode) }, mode),
    ]
  }
  return []
}

/** One file's settings that wait for confirmation, as `/council trust` lists them. `code` is the one shown for its content (register.ts derives it). */
export type TrustFileView = { where: string; hash: string; code: string; summary: TrustSummary; counts: TrustCounts }

const MAX_FILES = 20
const MAX_WHERE_CHARS = 300

/** The folder of a file as the first line shows it: cleaned, redacted and cut. It is the person's own path, not a setting, so cutting it hides nothing that is confirmed. */
function whereShown(value: string, patterns: readonly SecretPattern[]): string {
  const line = cleanText(redact(value, patterns)).trim()
  return line.length > MAX_WHERE_CHARS ? `${line.slice(0, MAX_WHERE_CHARS)}…` : line
}

/** How many values of a file each reason makes impossible to confirm from the session. */
type Tally = { secret: number; long: number; unclean: number }

/** One value taken from the file, shown whole, or not at all; what is wrong with it is added to the tally and said beside it. */
function shownValue(raw: string, tally: Tally, patterns: readonly SecretPattern[]): string {
  const seen = inspectValue(raw, patterns)
  if (seen.isUnclean) tally.unclean++
  if (seen.isLong) tally.long++
  if (seen.isSecret) {
    tally.secret++
    return text('trust.secretHidden') + (seen.isUnclean ? text('trust.markUnclean') : '')
  }
  return (
    (seen.isLong ? `${seen.text.slice(0, MAX_VALUE_CHARS)}…${text('trust.markLong', { max: MAX_VALUE_CHARS, n: seen.text.length })}` : seen.text) +
    (seen.isUnclean ? text('trust.markUnclean') : '')
  )
}

/** After the gutter, so no line of it can pass for a line of the mod's own. */
const guttered = (line: string): string => `${text('ask.gutter')}${line}`

/** A value of any type the schema may give a field, as the text the listing inspects. */
const valueText = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value))

/**
 * One field: its name, then its value; a list has a line for each element, quoted so that where one ends and
 * the next begins cannot be mistaken (an argument with a space in it is one argument).
 */
function fieldLines(name: string, value: unknown, tally: Tally, patterns: readonly SecretPattern[]): string[] {
  if (value === undefined) return []
  if (Array.isArray(value)) {
    return value.map((element, index) =>
      guttered(text('trust.fieldItem', { name, index, value: text('trust.quoted', { value: shownValue(valueText(element), tally, patterns) }) })),
    )
  }
  return [guttered(text('trust.field', { name, value: shownValue(valueText(value), tally, patterns) }))]
}

/** An item that has a line for every field the schema allows on it: the keys come from the schema, so a new field cannot be left out. */
const itemLines = (head: string, keys: readonly string[], item: object, tally: Tally, patterns: readonly SecretPattern[]): string[] => [
  head,
  ...keys.flatMap(key => fieldLines(key, (item as Record<string, unknown>)[key], tally, patterns)),
]

/** Probes for "matches every tool": plain names a tool may have. */
const TOOL_PROBES = ['Bash', 'Read', 'Write', 'Edit', 'NotebookEdit', 'Monitor', 'Task', 'WebFetch', 'WebSearch', 'Glob', 'Grep', 'AskUserQuestion', 'mcp__server__tool', 'x', 'Z9']

/** Whether one entry of a rule's `tools` stands for every tool: a lone `*`, a regular expression that matches any name. */
const matchesEveryTool = (entry: string): boolean => {
  try {
    const matches = toolMatcher(entry)
    return TOOL_PROBES.every(tool => matches(tool))
  } catch {
    return false
  }
}

/** What a rule's listing says about how much it matches, in the mod's own words (not the file's): no pattern at all, or every tool. */
function ruleNotes(rule: Rule): string[] {
  const hasMatcher = rule.command !== undefined || rule.path !== undefined || rule.input !== undefined || rule.check !== undefined
  return [...(hasMatcher ? [] : [text('trust.matchesAll')]), ...(rule.tools.some(matchesEveryTool) ? [text('trust.allTools')] : [])]
}

/** One list entry of the file, after its label and the gutter. */
const entryLines = (label: string, entries: readonly string[], tally: Tally, patterns: readonly SecretPattern[]): string[][] =>
  entries.map(entry => [label, guttered(shownValue(entry, tally, patterns))])

/** What one file's listing comes to: its lines, and why the file cannot be confirmed from the session, if it cannot. */
function fileListing(file: TrustFileView, patterns: readonly SecretPattern[]): { lines: string[]; why: string | undefined } {
  const { summary } = file
  const { applied } = summary
  const tally: Tally = { secret: 0, long: 0, unclean: 0 }
  // Rules are numbered through both groups, in the order listed.
  let ruleNumber = 0
  const ruleItem = (rule: Rule): string[] => [
    ...itemLines(text('trust.rule', { n: ++ruleNumber }), RULE_KEYS, rule, tally, patterns),
    ...ruleNotes(rule),
  ]
  // What applies now and only adds: every rule that is not an allow rule, and the lists. What confirming switches on follows.
  const appliedItems: string[][] = [
    ...applied.rules.map(ruleItem),
    ...entryLines(text('trust.protectedPath'), applied.protectedPaths, tally, patterns),
    ...entryLines(text('trust.protectedBranch'), applied.protectedBranches, tally, patterns),
    ...entryLines(text('trust.productionPattern'), applied.productionPatterns, tally, patterns),
    ...entryLines(text('trust.bigOperation'), applied.bigOperations, tally, patterns),
  ]
  const heldItems: string[][] = [
    ...summary.rules.map(ruleItem),
    ...summary.disabledRules.map(id => [text('trust.disabled'), guttered(shownValue(id, tally, patterns))]),
    ...summary.models.map(entry => [text('trust.model', { slot: entry.slot }), guttered(shownValue(entry.model, tally, patterns))]),
    ...summary.checks.map((check, index) => itemLines(text('trust.check', { n: index + 1 }), GIMLI_COMMAND_KEYS, check, tally, patterns)),
    ...summary.patterns.map((pattern, index) => itemLines(text('trust.pattern', { n: index + 1 }), GOLLUM_PATTERN_KEYS, pattern, tally, patterns)),
  ]
  const reasons = [
    ...(file.counts.total > MAX_ITEMS ? [text('trust.why.items', { n: file.counts.total, max: MAX_ITEMS })] : []),
    ...(tally.secret > 0 ? [text('trust.why.secret', { n: tally.secret })] : []),
    ...(tally.long > 0 ? [text('trust.why.long', { n: tally.long, max: MAX_VALUE_CHARS })] : []),
    ...(tally.unclean > 0 ? [text('trust.why.unclean', { n: tally.unclean })] : []),
  ]
  // At most MAX_ITEMS items are printed across both groups; a file past it cannot be confirmed from the session.
  const shownApplied = appliedItems.slice(0, MAX_ITEMS)
  const shownHeld = heldItems.slice(0, MAX_ITEMS - shownApplied.length)
  const notShown = appliedItems.length + heldItems.length - shownApplied.length - shownHeld.length
  const held = heldCount(file.counts)
  return {
    lines: [
      held > 0 ? text('trust.file', { where: whereShown(file.where, patterns), summary: countsText(file.counts) }) : text('trust.fileApplied', { where: whereShown(file.where, patterns) }),
      ...(shownApplied.length > 0 ? [text('trust.group.applied'), ...shownApplied.flat()] : []),
      ...(applied.rules.length > 0 ? [text('trust.decideFirst')] : []),
      ...(shownHeld.length > 0 || summary.allowlist > 0 ? [text('trust.group.held')] : []),
      ...shownHeld.flat(),
      ...(notShown > 0 ? [text('trust.moreItems', { n: notShown })] : []),
      ...(summary.allowlist > 0 ? [text('trust.allowlist', { n: summary.allowlist })] : []),
      reasons.length === 0 ? text('trust.code', { code: file.code }) : text('trust.unconfirmable', { why: reasons.join('; ') }),
    ],
    why: reasons.length === 0 ? undefined : reasons.join('; '),
  }
}

/** The listing `/council trust` prints, and which content it shows in full (`listed`: confirmable by code) or cannot confirm (`blocked`, with why). */
export type TrustListing = { output: Output; listed: string[]; blocked: { hash: string; why: string }[] }

/**
 * `/council trust`: for each file, every setting that waits, each in full, and the code to type; or, where the
 * listing cannot be complete or safe to read, why the file cannot be confirmed from the session (DESIGN §16).
 */
export function trustListing(files: readonly TrustFileView[], patterns: readonly SecretPattern[]): TrustListing {
  const title = text('cmd.title')
  if (files.length === 0) return { output: { title, lines: [text('trust.none')] }, listed: [], blocked: [] }
  const shown = files.slice(0, MAX_FILES)
  const lines: string[] = []
  const listed: string[] = []
  const blocked: { hash: string; why: string }[] = []
  for (const file of shown) {
    const listing = fileListing(file, patterns)
    lines.push(...listing.lines)
    if (listing.why === undefined) listed.push(file.hash)
    else blocked.push({ hash: file.hash, why: listing.why })
  }
  // A file past the cap is not listed; unless its content is the very content of one that was, it cannot be confirmed.
  for (const file of files.slice(MAX_FILES)) if (!listed.includes(file.hash)) blocked.push({ hash: file.hash, why: text('trust.why.files') })
  if (files.length > MAX_FILES) lines.push(text('trust.moreFiles', { n: files.length - MAX_FILES }))
  return { output: { title, lines }, listed, blocked }
}

/** `trustListing`'s output alone. */
export const trustOutput = (files: readonly TrustFileView[], patterns: readonly SecretPattern[]): Output => trustListing(files, patterns).output

/** `/council trust <code>`, done: which files were confirmed and what is now in force. */
export function trustedOutput(files: readonly { where: string; counts: TrustCounts }[]): Output {
  return {
    title: text('cmd.title'),
    lines: files.map(file =>
      heldCount(file.counts) > 0
        ? text('trust.confirmedFile', { where: cleanText(file.where), summary: countsText(file.counts) })
        : text('trust.confirmedRules', { where: cleanText(file.where), summary: appliedText(file.counts) }),
    ),
  }
}
