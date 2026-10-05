import type { CouncilSession } from '../../types'
import type { CompiledConfig } from '../config/schema.js'
import { MODEL_SLOTS, TIERS } from '../config/types.js'
import type { ModelSlot } from '../config/types.js'
import type { Classification } from '../rules/classify.js'
import { median } from '../state.js'
import { text } from '../strings.js'
import type { StringKey } from '../strings.js'
import type { ModelChoice } from './models.js'
import type { Operation } from './operations.js'
import { KEY_WIPE_CAP } from './operations.js'

/**
 * `/council`: one command, its subcommands parsed from the raw argument
 * string, and its output built as lines. The output is for the user only:
 * register.ts draws it in a pane or logs it, and never hands it to Claude.
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
  | { kind: 'reload' }
  | { kind: 'report' }
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
    case 'reload':
      return { kind: 'reload' }
    case 'report':
      return { kind: 'report' }
    default:
      return { kind: 'usage', key: 'cmd.unknown', params: { sub } }
  }
}

export const isSlot = (value: string): value is ModelSlot => (MODEL_SLOTS as readonly string[]).includes(value)

export const WHO_OF_SLOT: Readonly<Record<ModelSlot, StringKey>> = {
  gandalf: 'who.gandalf',
  legolas: 'who.legolas',
  aragorn: 'who.aragorn',
  council: 'who.council',
}

export type StatusInput = {
  session: CouncilSession
  mode: 'enforcing' | 'shadow' | 'bypass'
  gandalf: { enabled: boolean; choice: ModelChoice }
  gollumEnabled: boolean
  galadrielEnabled: boolean
  tokenBudget: number
}

const ZERO_COUNTS = { approved: 0, revised: 0, blocked: 0, failed: 0 }

export function statusOutput(input: StatusInput): Output {
  const { session } = input
  const counts = session.counts.gandalf ?? ZERO_COUNTS
  const ops = Object.values(session.ops)
  const wipes = Object.values(session.verbWipes).reduce((sum, n) => sum + n, 0)
  const typical = median(session.reviewMs)
  const onOff = (on: boolean): string => text(on ? 'cmd.on' : 'cmd.off')
  return {
    title: text('cmd.title'),
    lines: [
      text('cmd.mode', { mode: text(`cmd.mode.${input.mode}`) }),
      text('cmd.members'),
      text('cmd.member', {
        who: text('who.gandalf'),
        id: 'gandalf',
        state: onOff(input.gandalf.enabled),
        model: input.gandalf.choice.model,
        source: input.gandalf.choice.source,
        ...counts,
      }),
      text('cmd.memberLater', { who: text('who.legolas'), id: 'legolas' }),
      text('cmd.memberLater', { who: text('who.aragorn'), id: 'aragorn' }),
      text('cmd.memberCode', { who: text('who.gollum'), state: onOff(input.gollumEnabled) }),
      text('cmd.memberCode', { who: text('who.galadriel'), state: onOff(input.galadrielEnabled) }),
      text('cmd.attempts', { count: wipes, ops: ops.length, locked: ops.filter(op => op.wipes >= KEY_WIPE_CAP).length }),
      text('cmd.tokens', { spent: session.tokensSpent, budget: input.tokenBudget }),
      typical === undefined
        ? text('cmd.noReviews')
        : text('cmd.median', { time: `${(typical / 1000).toFixed(1)} s`, reviews: session.reviewMs.length }),
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

export function rulesOutput(compiled: CompiledConfig, origin: string, errors: readonly string[]): Output {
  const rules = [...compiled.rules].sort((a, b) => TIERS.indexOf(b.tier) - TIERS.indexOf(a.tier))
  const list = (key: StringKey, items: readonly string[]): string[] =>
    items.length === 0 ? [] : [text('cmd.listLine', { name: text(key), items: items.join(', ') })]
  return {
    title: text('cmd.rulesTitle', { origin }),
    lines: [
      ...(errors.length > 0 ? [text('cmd.configErrors', { errors: errors.join('; ') })] : []),
      ...rules.map(rule => text('cmd.ruleLine', { tier: rule.tier.padEnd(6), id: rule.id, source: rule.source, reason: rule.reason })),
      ...list('cmd.list.protectedPaths', compiled.config.protectedPaths),
      ...list('cmd.list.protectedBranches', compiled.config.protectedBranches),
      ...list('cmd.list.production', compiled.config.productionPatterns),
      ...list('cmd.list.secretPatterns', compiled.config.gollum.patterns.map(pattern => `${pattern.id} (${pattern.level})`)),
      ...list('cmd.list.allowlist', compiled.config.gollum.allowlist.map(entry => (entry.startsWith('sha256:') ? entry : `${entry.slice(0, 3)}…`))),
    ],
  }
}

export function testOutput(command: string, classification: Classification, operation: Operation | undefined, reviewer: ModelChoice | undefined): Output {
  const decided = classification.decided
  const lines = [text('cmd.testTier', { tier: classification.tier })]
  if (decided === undefined) {
    lines.push(text('cmd.testAllow'))
  } else {
    for (const finding of classification.findings) {
      lines.push(text('cmd.testFinding', { subject: finding.subject, tier: finding.tier, rule: finding.ruleId, source: finding.source, reason: finding.reason }))
    }
    if (classification.tier === 'review' && reviewer !== undefined) {
      // Stage 2 seats the destructive-operations reviewer alone; the rule's own choice is shown beside it.
      const asked = decided.member !== undefined && decided.member !== 'gandalf' ? ` (rule names ${decided.member}${decided.profile !== undefined ? `/${decided.profile}` : ''})` : ''
      lines.push(text('cmd.testReviewer', { who: text('who.gandalf'), id: 'gandalf', profile: asked, model: reviewer.model, source: reviewer.source }))
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
