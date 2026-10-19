/**
 * Elrond's session record: everything the council keeps for one session,
 * in one place, reset by `resetForPrompt` (hooks/state.ts) on a new prompt.
 */
export type CouncilSession = {
  /** Shape version; a value of another version reads as a fresh session. */
  v: 4
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
  /** Allow-rule patterns the user declined after "allow once": not offered again this session. */
  declinedRules: readonly string[]
  /** The newest reviews for the debate pane and the council check band (newest last, capped at 8). */
  debates: readonly CouncilDebate[]
  /** The `$.clock.now()` time the epic drop row hides at; 0 means none. */
  epicUntil: number
  /** Whether the debate pane was opened unasked this session: it is not opened that way twice. */
  debateOpened: boolean
}

/** One gated call's review, as the debate pane and the band show it. */
export type CouncilDebate = {
  /** The call's `tool_use_id`. */
  id: string
  /** The subagent the call ran in; absent in the main conversation. */
  agentId?: string
  tool: string
  /** The call as shown: redacted, on one line, cut to 300 characters. */
  call: string
  kind: 'review' | 'council'
  status: 'sitting' | 'done'
  verdict?: 'approve' | 'revise' | 'block' | 'failed' | 'aborted'
  voices: readonly CouncilDebateVoice[]
  checks: readonly CouncilDebateCheck[]
}

export type CouncilDebateVoice = {
  member: string
  profile?: string
  status: 'waiting' | 'approve' | 'revise' | 'block' | 'failed' | 'skipped'
  /** Redacted, cut to 400 characters. */
  reason?: string
  alternative?: string
}

export type CouncilDebateCheck = {
  name: string
  status: 'running' | 'passed' | 'failed' | 'timed-out' | 'error' | 'stopped'
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
