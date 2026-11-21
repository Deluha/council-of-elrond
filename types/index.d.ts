/** One gated call, as the combat log keeps it. */
export type CouncilEntry = {
  /** A member's id, or `gollum`. */
  who: string
  outcome: 'approved' | 'refused' | 'blocked' | 'allowed' | 'shadow' | 'leeroy'
  label: string
  reason: string
}

export type CouncilState = {
  /** Leeroy mode: council-tier calls run unreviewed. */
  isLeeroy: boolean
  /** The person's last message, which the reviewer judges a call against. */
  prompt: string
  /** Refusals per call since the person's last message. */
  wipes: Record<string, number>
  /** Calls the person allowed once. */
  once: string[]
  /** Rule ids the person allowed for the session. */
  greed: string[]
  /** The last refused call: what `/council allow` lets through. */
  refused?: { key: string; label: string }
  log: CouncilEntry[]
  meter: Record<string, { approved: number; refused: number }>
  tokens: number
}

declare module 'claude-code' {
  interface PluginState {
    'council-of-elrond': { session: Shaped<CouncilState> }
  }
}
