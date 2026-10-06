import { MEMBERS, PROFILES } from '../config/types.js'
import type { MemberName, Profile } from '../config/types.js'
import { whoOf } from '../members/brief.js'
import { median } from '../state.js'
import { text } from '../strings.js'
import type { StringKey } from '../strings.js'
import type { Output } from './commands.js'

/**
 * `/council report`: a summary of the audit log, the rotated files included.
 * Pure over the files' text; register.ts reads them, oldest first. Lines that
 * don't parse, or come from another shape, are counted and skipped.
 */

/** One audit line as read back: only the fields the report uses, each checked. */
export type Entry = {
  ts: string
  tool: string
  opKey: string | null
  ruleId: string | null
  member: string | null
  profile: string | null
  model: string | null
  verdict: string | null
  shadow: boolean
  decision: string | null
  outcome: string
  tokens: number
  cached: boolean
  reviewMs?: number
  ruleAdded?: string
  council?: { voices: { member: string; profile: string | null; tokens: number }[] }
}

const TOP = 5

const VERDICTS_THAT_REFUSE: ReadonlySet<string> = new Set(['block', 'revise'])

const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0)

function entryOf(value: unknown): Entry | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const ts = str(raw.ts)
  const tool = str(raw.tool)
  const outcome = str(raw.outcome)
  if (ts === null || tool === null || outcome === null) return undefined
  const council = raw.council as { voices?: unknown } | undefined
  const voices = Array.isArray(council?.voices)
    ? council.voices.flatMap(voice => {
        const v = voice as Record<string, unknown>
        const member = str(v?.member)
        return member === null ? [] : [{ member, profile: str(v.profile), tokens: num(v.tokens) }]
      })
    : undefined
  return {
    ts,
    tool,
    opKey: str(raw.opKey),
    ruleId: str(raw.ruleId),
    member: str(raw.member),
    profile: str(raw.profile),
    model: str(raw.model),
    verdict: str(raw.verdict),
    shadow: raw.shadow === true,
    decision: str(raw.decision),
    outcome,
    tokens: num(raw.tokens),
    cached: raw.cached === true,
    ...(typeof raw.reviewMs === 'number' && { reviewMs: num(raw.reviewMs) }),
    ...(str(raw.ruleAdded) !== null && { ruleAdded: str(raw.ruleAdded) as string }),
    ...(voices !== undefined && { council: { voices } }),
  }
}

/** Every line of every file, oldest file first; what doesn't read as an audit line is counted. */
export function parseAudit(files: readonly string[]): { entries: Entry[]; skipped: number } {
  const entries: Entry[] = []
  let skipped = 0
  for (const file of files) {
    for (const line of file.split('\n')) {
      if (line.trim() === '') continue
      let entry: Entry | undefined
      try {
        entry = entryOf(JSON.parse(line))
      } catch {
        entry = undefined
      }
      if (entry === undefined) skipped++
      else entries.push(entry)
    }
  }
  return { entries, skipped }
}

/** Counts by key, most first (ties by key), cut to the top few. */
function tally<T>(items: readonly T[], keyOf: (item: T) => string | null): { key: string; count: number; items: T[] }[] {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    if (key === null) continue
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return [...groups]
    .map(([key, grouped]) => ({ key, count: grouped.length, items: grouped }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, TOP)
}

/** A reviewer as the report names it: its plain name, and its id as you type it. */
function reviewerLabel(id: string): string {
  const [member, profile] = id.split('/')
  if (!(MEMBERS as readonly string[]).includes(member ?? '')) return id
  const known = (PROFILES as readonly string[]).includes(profile ?? '') ? (profile as Profile) : undefined
  return `${text(whoOf(member as MemberName, known))} [${id}]`
}

const reviewerId = (member: string, profile: string | null): string => (profile !== null && member === 'aragorn' ? `${member}/${profile}` : member)

const seconds = (ms: number | undefined): string => (ms === undefined ? '-' : `${(ms / 1000).toFixed(1)} s`)

/** Who refused a call, for the most-refused lines. */
function refusedBy(entry: Entry): StringKey {
  if (entry.decision === 'unavailable') return 'report.by.nobody'
  if (entry.decision !== null) return 'report.by.user'
  if (entry.verdict === 'locked out') return 'report.by.lockout'
  if (entry.member === 'gollum') return 'report.by.secrets'
  return entry.member === null || entry.model === null ? 'report.by.rules' : 'report.by.reviewer'
}

type Cost = { reviews: number; tokens: number; councilTokens: number; times: number[] }

/**
 * The report: most-refused rules and operations; calls the user allowed once
 * after the council stopped them (false-positive candidates); shadow verdicts
 * that would have refused; tokens and median review time per reviewer.
 */
export function reportOutput(files: readonly string[], unreadable: readonly string[] = []): Output {
  const { entries, skipped } = parseAudit(files)
  const lines: string[] = []
  for (const problem of unreadable) lines.push(text('report.unreadable', { problem }))
  if (entries.length === 0) {
    return { title: text('report.title'), lines: [...lines, text('report.empty')] }
  }
  const first = entries[0] as Entry
  const last = entries[entries.length - 1] as Entry
  lines.push(
    text('report.span', {
      count: entries.length,
      from: first.ts.slice(0, 10),
      to: last.ts.slice(0, 10),
      files: files.length,
    }),
  )
  if (skipped > 0) lines.push(text('report.skipped', { count: skipped }))

  // Most refused: by the rule that gated the call, and by the operation.
  const refused = entries.filter(entry => entry.outcome === 'refused')
  lines.push('', text('report.refusedTitle', { count: refused.length }))
  if (refused.length === 0) lines.push(text('report.none'))
  for (const group of tally(refused, entry => entry.ruleId ?? '(no rule)')) {
    const by = tally(group.items, refusedBy).map(sub => `${text(sub.key as StringKey)} ${sub.count}`)
    lines.push(text('report.refusedRule', { rule: group.key, count: group.count, by: by.join(', ') }))
  }
  const ops = tally(refused, entry => entry.opKey)
  if (ops.length > 0) lines.push(text('report.refusedOpsTitle'))
  for (const group of ops) lines.push(text('report.refusedOp', { op: group.key, count: group.count }))

  // Overridden: the user allowed once (or allowlisted) what the council stopped.
  const overridden = entries.filter(entry => entry.decision === 'allow-once' || entry.decision === 'allowlist')
  lines.push('', text('report.overriddenTitle', { count: overridden.length }))
  if (overridden.length === 0) lines.push(text('report.none'))
  for (const group of tally(overridden, entry => entry.ruleId ?? entry.member ?? '(no rule)')) {
    const examples = tally(group.items, entry => entry.opKey).map(sub => sub.key)
    lines.push(text('report.overriddenRule', { rule: group.key, count: group.count, ops: examples.slice(0, 3).join('; ') || '-' }))
  }
  const added = entries.flatMap(entry => (entry.ruleAdded !== undefined ? [entry.ruleAdded] : []))
  if (added.length > 0) lines.push(text('report.rulesAdded', { count: added.length, ids: added.join(', ') }))

  // Shadow: verdicts that were logged and would have refused the call.
  const shadowed = entries.filter(entry => entry.shadow && entry.verdict !== null && VERDICTS_THAT_REFUSE.has(entry.verdict))
  lines.push('', text('report.shadowTitle', { count: shadowed.length }))
  if (shadowed.length === 0) lines.push(text('report.none'))
  for (const group of tally(shadowed, entry => (entry.member === null ? null : reviewerId(entry.member, entry.profile)))) {
    const rules = tally(group.items, entry => entry.ruleId).map(sub => `${sub.key} ${sub.count}`)
    const blocks = group.items.filter(entry => entry.verdict === 'block').length
    lines.push(
      text('report.shadowLine', {
        who: reviewerLabel(group.key),
        count: group.count,
        blocks,
        revises: group.count - blocks,
        rules: rules.join(', ') || '-',
      }),
    )
  }

  // Cost: a model review ran when a model was chosen and the verdict was not reused.
  const costs = new Map<string, Cost>()
  const costOf = (id: string): Cost => {
    const known = costs.get(id)
    if (known !== undefined) return known
    const fresh: Cost = { reviews: 0, tokens: 0, councilTokens: 0, times: [] }
    costs.set(id, fresh)
    return fresh
  }
  let total = 0
  for (const entry of entries) {
    if (entry.model === null || entry.cached || entry.member === null) continue
    total += entry.tokens
    if (entry.council !== undefined) {
      const sitting = costOf('council')
      sitting.reviews++
      sitting.tokens += entry.tokens
      if (entry.reviewMs !== undefined) sitting.times.push(entry.reviewMs)
      for (const voice of entry.council.voices) {
        const cost = costOf(reviewerId(voice.member, voice.profile))
        cost.tokens += voice.tokens
        cost.councilTokens += voice.tokens
      }
      continue
    }
    const cost = costOf(reviewerId(entry.member, entry.profile))
    cost.reviews++
    cost.tokens += entry.tokens
    if (entry.reviewMs !== undefined) cost.times.push(entry.reviewMs)
  }
  lines.push('', text('report.costTitle', { tokens: total }))
  if (costs.size === 0) lines.push(text('report.none'))
  for (const [id, cost] of [...costs].sort((a, b) => b[1].tokens - a[1].tokens || a[0].localeCompare(b[0]))) {
    lines.push(
      id === 'council'
        ? text('report.costCouncil', { who: text('who.fullCouncil'), sittings: cost.reviews, tokens: cost.tokens, time: seconds(median(cost.times)) })
        : text('report.costMember', {
            who: reviewerLabel(id),
            reviews: cost.reviews,
            tokens: cost.tokens,
            inCouncil: cost.councilTokens,
            time: seconds(median(cost.times)),
          }),
    )
  }
  if (costs.size > 0 && [...costs.values()].every(cost => cost.times.length === 0)) lines.push(text('report.noTimes'))
  return { title: text('report.title'), lines }
}
