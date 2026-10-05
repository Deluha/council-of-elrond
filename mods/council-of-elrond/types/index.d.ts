/**
 * Elrond's session record: everything the council keeps for one session,
 * in one place, reset by `resetForPrompt` (hooks/state.ts) on a new prompt.
 */
export type CouncilSession = {
  /** Shape version; a value of another version reads as a fresh session. */
  v: 1
  /** The user's latest prompt, redacted and cut, for reviewer context. */
  latestPrompt: string
  /** Bumped on every prompt the user sends. */
  promptEpoch: number
  /** Tokens every reviewer has spent this session. */
  tokensSpent: number
  /** Session bypass: gated calls pass through, logged. Never persisted. */
  bypass: boolean
  /** Absolute paths Claude wrote or edited this session (newest last), for script context. */
  written: readonly string[]
  /** Verdict counts per member, for /council. */
  counts: Readonly<Record<string, CouncilCounts>>
}

export type CouncilCounts = {
  approved: number
  revised: number
  blocked: number
  failed: number
}

declare module 'claude-code' {
  interface PluginState {
    'council-of-elrond': { session: CouncilSession }
  }
}
