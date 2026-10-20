import type { GimliCommand } from '../config/types.js'

/**
 * Gimli: the project's own checks (tests, lint, typecheck), run for the full
 * council. Only the commands in the rules file run, by argument vector with
 * no shell; nothing comes from Claude or the call. Pass or fail is the exit
 * code; the last lines of output are kept to show why.
 */

export const TAIL_LINES = 20

/** Output kept while a command runs: enough for the tail, bounded. */
export const KEEP_CHARS = 16_000

const TAIL_CHARS = 2_400

/** The engine's message about a check that could not start: one line, a few hundred characters. */
export const PROBLEM_CHARS = 400

export type GimliStatus =
  /** Exited 0. */
  | 'passed'
  /** Exited non-zero, or was ended by a signal it didn't get from the council. */
  | 'failed'
  /** Ran past its own timeout and was ended. */
  | 'timed-out'
  /** Could not start (no such program, a bad folder). */
  | 'error'
  /** Ended early: the council had already blocked, so its result could not matter. */
  | 'stopped'

export type GimliRun = {
  name: string
  status: GimliStatus
  /** The exit code, when it exited; the signal, when one ended it. */
  code?: number | null
  signal?: string | null
  /** The last lines of what it wrote, both pipes interleaved as they came (redact before showing). */
  tail: string
  /** Why it could not start or its stream broke, as the engine said; only for status `error` (redact before showing). */
  problem?: string
  ms: number
}

/** Appends a piece of output, keeping only the end once it grows past KEEP_CHARS. */
export const keepTail = (kept: string, piece: string): string => {
  const joined = kept + piece
  return joined.length > KEEP_CHARS ? joined.slice(joined.length - KEEP_CHARS) : joined
}

/** The last `lines` non-blank-trailing lines of the output, cut to a few kilobytes. */
export function tailOf(output: string, lines = TAIL_LINES): string {
  const all = output.replace(/\s+$/, '').split('\n')
  const kept = all.slice(-lines).join('\n')
  return kept.length > TAIL_CHARS ? `…${kept.slice(kept.length - TAIL_CHARS + 1)}` : kept
}

/** An engine message on one line, cut to PROBLEM_CHARS. Redact first: a cut could split a secret. */
export function problemOf(message: string): string {
  const line = message.replace(/\s+/g, ' ').trim()
  return line.length > PROBLEM_CHARS ? `${line.slice(0, PROBLEM_CHARS - 1)}…` : line
}

/** How one run ended, from what the runner saw: why it was ended, if it was, and how it exited. */
export function statusOf(ended: 'timeout' | 'stopped' | undefined, exit: { code: number | null; signal: string | null } | undefined): GimliStatus {
  if (ended === 'timeout') return 'timed-out'
  if (ended === 'stopped') return 'stopped'
  if (exit === undefined) return 'error'
  return exit.code === 0 ? 'passed' : 'failed'
}

/** A run that blocks: it failed, timed out, or could not start. */
export const isGimliBlock = (run: GimliRun): boolean => run.status === 'failed' || run.status === 'timed-out' || run.status === 'error'

/** The longest any configured command may run: with the model deadline, how long a council can take. */
export const longestTimeout = (commands: readonly GimliCommand[]): number => commands.reduce((most, command) => Math.max(most, command.timeoutMs), 0)
