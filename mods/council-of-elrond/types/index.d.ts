/**
 * Elrond's session record: everything the council keeps for one session,
 * in one place, reset by `resetForPrompt` (hooks/state.ts) on a new prompt.
 */
export type CouncilSession = {
  /** Shape version; a value of another version reads as a fresh session. */
  v: 2
  /** The user's latest prompt, redacted and cut, for reviewer context. */
  latestPrompt: string
  /** Bumped on every prompt the user sends. */
  promptEpoch: number
  /** Tokens every reviewer has spent this session. */
  tokensSpent: number
  /** Session bypass: gated calls pass through, logged. Never persisted. */
  bypass: boolean
  /** Session shadow switch; null follows the `shadowMode` setting. */
  shadow: boolean | null
  /** Session model switches per slot (`/council model`), over every other layer. */
  models: Readonly<Partial<Record<'gandalf' | 'legolas' | 'aragorn' | 'council', string>>>
  /** Absolute paths Claude wrote or edited this session (newest last), for script context. */
  written: readonly string[]
  /** Verdict counts per member, for /council. */
  counts: Readonly<Record<string, CouncilCounts>>
  /** Model review times in ms (newest last, capped), for the median in /council. */
  reviewMs: readonly number[]
  /** Per operation key: review rounds and failed attempts this prompt. */
  ops: Readonly<Record<string, CouncilOp>>
  /** Failed attempts per verb key this prompt, to catch retries that change the target. */
  verbWipes: Readonly<Record<string, number>>
  /** Fingerprints a reviewer approved this prompt: an identical call is not reviewed again. */
  cache: readonly string[]
}

export type CouncilOp = { rounds: number; wipes: number }

export type CouncilCounts = {
  approved: number
  revised: number
  blocked: number
  failed: number
}

/** What the `/council` pane shows: the last command's output. */
export type CouncilPanel = { title: string; lines: readonly string[] }

declare module 'claude-code' {
  interface PluginState {
    'council-of-elrond': { session: CouncilSession; panel: CouncilPanel }
  }
}
