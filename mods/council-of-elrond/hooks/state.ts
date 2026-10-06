import type { CouncilCounts, CouncilSession } from '../types'

/**
 * The session record's shape and every change to it, as pure functions over
 * plain data. register.ts holds the one `$.state` value and applies these.
 * The operation counters themselves live in elrond/operations.ts.
 */

export const INITIAL_SESSION: CouncilSession = {
  v: 3,
  latestPrompt: '',
  promptEpoch: 0,
  tokensSpent: 0,
  bypass: false,
  shadow: null,
  models: {},
  written: [],
  counts: {},
  reviewMs: [],
  ops: {},
  verbWipes: {},
  cache: [],
  declinedRules: [],
}

const MAX_WRITTEN = 100

const MAX_PROMPT_CHARS = 4_000

const MAX_REVIEW_TIMES = 200

/** A value of another shape version reads as a fresh session. */
export const sessionOf = (value: CouncilSession | undefined): CouncilSession =>
  value !== undefined && value.v === 3 ? value : INITIAL_SESSION

/**
 * A new prompt from the user: what resets per prompt resets here. Rounds,
 * failed attempts, lockouts and the approve cache start over.
 */
export function resetForPrompt(session: CouncilSession, prompt: string): CouncilSession {
  return {
    ...session,
    latestPrompt: prompt.length > MAX_PROMPT_CHARS ? `${prompt.slice(0, MAX_PROMPT_CHARS)}…` : prompt,
    promptEpoch: session.promptEpoch + 1,
    ops: {},
    verbWipes: {},
    cache: [],
  }
}

export const addTokens = (session: CouncilSession, tokens: number): CouncilSession => ({
  ...session,
  tokensSpent: session.tokensSpent + Math.max(0, tokens),
})

export const addReviewTime = (session: CouncilSession, ms: number): CouncilSession => ({
  ...session,
  reviewMs: [...session.reviewMs, Math.max(0, Math.round(ms))].slice(-MAX_REVIEW_TIMES),
})

const ZERO: CouncilCounts = { approved: 0, revised: 0, blocked: 0, failed: 0 }

export type CountedOutcome = 'approve' | 'revise' | 'block' | 'failed'

export function count(session: CouncilSession, member: string, outcome: CountedOutcome): CouncilSession {
  const before = session.counts[member] ?? ZERO
  const field = outcome === 'approve' ? 'approved' : outcome === 'revise' ? 'revised' : outcome === 'block' ? 'blocked' : 'failed'
  return { ...session, counts: { ...session.counts, [member]: { ...before, [field]: before[field] + 1 } } }
}

export const withBypass = (session: CouncilSession, bypass: boolean): CouncilSession => ({ ...session, bypass })

export const withShadow = (session: CouncilSession, shadow: boolean | null): CouncilSession => ({ ...session, shadow })

/** Shadow is on when the session says so, else when the setting does. */
export const isShadow = (session: CouncilSession, setting: boolean): boolean => session.shadow ?? setting

export const withSessionModel = (session: CouncilSession, slot: keyof CouncilSession['models'], model: string | undefined): CouncilSession => {
  const { [slot]: _old, ...rest } = session.models
  return { ...session, models: model === undefined ? rest : { ...rest, [slot]: model } }
}

/** The approve cache is the operation counters' too: a config reload clears it. */
export const clearCache = (session: CouncilSession): CouncilSession => ({ ...session, cache: [] })

/** Notes a file Claude wrote, so a later script run can show the reviewer its content. */
export const noteWritten = (session: CouncilSession, path: string): CouncilSession => ({
  ...session,
  written: [...session.written.filter(known => known !== path), path].slice(-MAX_WRITTEN),
})

const MAX_DECLINED = 50

/** A suggested allow rule the user turned down: not offered again this session. */
export const declineRule = (session: CouncilSession, key: string): CouncilSession => ({
  ...session,
  declinedRules: [...session.declinedRules.filter(known => known !== key), key].slice(-MAX_DECLINED),
})

/** The median of the recorded review times, or undefined with none. */
export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2)
}
