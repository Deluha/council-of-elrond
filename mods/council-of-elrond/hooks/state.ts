import type { CouncilCounts, CouncilSession } from '../types'

/**
 * The session record's shape and every change to it, as pure functions over
 * plain data. register.ts holds the one `$.state` value and applies these.
 */

export const INITIAL_SESSION: CouncilSession = {
  v: 1,
  latestPrompt: '',
  promptEpoch: 0,
  tokensSpent: 0,
  bypass: false,
  written: [],
  counts: {},
}

const MAX_WRITTEN = 100

const MAX_PROMPT_CHARS = 4_000

/** A value of another shape version reads as a fresh session. */
export const sessionOf = (value: CouncilSession | undefined): CouncilSession =>
  value !== undefined && value.v === 1 ? value : INITIAL_SESSION

/** A new prompt from the user: what resets per prompt resets here. */
export function resetForPrompt(session: CouncilSession, prompt: string): CouncilSession {
  return {
    ...session,
    latestPrompt: prompt.length > MAX_PROMPT_CHARS ? `${prompt.slice(0, MAX_PROMPT_CHARS)}…` : prompt,
    promptEpoch: session.promptEpoch + 1,
  }
}

export const addTokens = (session: CouncilSession, tokens: number): CouncilSession => ({
  ...session,
  tokensSpent: session.tokensSpent + Math.max(0, tokens),
})

const ZERO: CouncilCounts = { approved: 0, revised: 0, blocked: 0, failed: 0 }

export type CountedOutcome = 'approve' | 'revise' | 'block' | 'failed'

export function count(session: CouncilSession, member: string, outcome: CountedOutcome): CouncilSession {
  const before = session.counts[member] ?? ZERO
  const field = outcome === 'approve' ? 'approved' : outcome === 'revise' ? 'revised' : outcome === 'block' ? 'blocked' : 'failed'
  return { ...session, counts: { ...session.counts, [member]: { ...before, [field]: before[field] + 1 } } }
}

export const withBypass = (session: CouncilSession, bypass: boolean): CouncilSession => ({ ...session, bypass })

/** Notes a file Claude wrote, so a later script run can show the reviewer its content. */
export const noteWritten = (session: CouncilSession, path: string): CouncilSession => ({
  ...session,
  written: [...session.written.filter(known => known !== path), path].slice(-MAX_WRITTEN),
})
