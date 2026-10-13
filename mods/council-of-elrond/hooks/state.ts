import type { CouncilCounts, CouncilDebate, CouncilDebateCheck, CouncilDebateVoice, CouncilSession } from '../types'

/**
 * The session record's shape and every change to it, as pure functions over
 * plain data. register.ts holds the one `$.state` value and applies these.
 * The operation counters themselves live in elrond/operations.ts.
 */

export const INITIAL_SESSION: CouncilSession = {
  v: 4,
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
  debates: [],
  epicUntil: 0,
  debateOpened: false,
}

const MAX_WRITTEN = 100

const MAX_PROMPT_CHARS = 4_000

const MAX_REVIEW_TIMES = 200

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')

const isOptionalString = (value: unknown): boolean => value === undefined || typeof value === 'string'

const DEBATE_KINDS: readonly unknown[] = ['review', 'council']
const DEBATE_STATUSES: readonly unknown[] = ['sitting', 'done']
const DEBATE_VERDICTS: readonly unknown[] = ['approve', 'revise', 'block', 'failed', 'aborted']
const VOICE_STATUSES: readonly unknown[] = ['waiting', 'approve', 'revise', 'block', 'failed', 'skipped']
const CHECK_STATUSES: readonly unknown[] = ['running', 'passed', 'failed', 'timed-out', 'error', 'stopped']

const isVoice = (value: unknown): boolean =>
  isRecord(value) && typeof value.member === 'string' && VOICE_STATUSES.includes(value.status) && isOptionalString(value.profile) && isOptionalString(value.reason) && isOptionalString(value.alternative)

const isCheck = (value: unknown): boolean => isRecord(value) && typeof value.name === 'string' && CHECK_STATUSES.includes(value.status)

const isDebate = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  isOptionalString(value.agentId) &&
  typeof value.tool === 'string' &&
  typeof value.call === 'string' &&
  DEBATE_KINDS.includes(value.kind) &&
  DEBATE_STATUSES.includes(value.status) &&
  (value.verdict === undefined || DEBATE_VERDICTS.includes(value.verdict)) &&
  Array.isArray(value.voices) &&
  value.voices.every(isVoice) &&
  Array.isArray(value.checks) &&
  value.checks.every(isCheck)

const isOp = (value: unknown): boolean => isRecord(value) && isNumber(value.rounds) && isNumber(value.wipes)

const isCounts = (value: unknown): boolean =>
  isRecord(value) && isNumber(value.approved) && isNumber(value.revised) && isNumber(value.blocked) && isNumber(value.failed)

/**
 * Whether a stored value has the session's shape: every field, and the
 * elements of every container the pipeline indexes into. The version alone
 * says nothing about a value another writer or an older build left behind.
 */
export function isSession(value: unknown): value is CouncilSession {
  return (
    isRecord(value) &&
    value.v === 4 &&
    typeof value.latestPrompt === 'string' &&
    isNumber(value.promptEpoch) &&
    isNumber(value.tokensSpent) &&
    typeof value.bypass === 'boolean' &&
    (value.shadow === null || typeof value.shadow === 'boolean') &&
    isRecord(value.models) &&
    Object.values(value.models).every(model => typeof model === 'string') &&
    isStringArray(value.written) &&
    isRecord(value.counts) &&
    Object.values(value.counts).every(isCounts) &&
    Array.isArray(value.reviewMs) &&
    value.reviewMs.every(isNumber) &&
    isRecord(value.ops) &&
    Object.values(value.ops).every(isOp) &&
    isRecord(value.verbWipes) &&
    Object.values(value.verbWipes).every(isNumber) &&
    isStringArray(value.cache) &&
    isStringArray(value.declinedRules) &&
    Array.isArray(value.debates) &&
    value.debates.every(isDebate) &&
    isNumber(value.epicUntil) &&
    typeof value.debateOpened === 'boolean'
  )
}

/** A value of another shape version, or of no valid shape, reads as a fresh session. */
export const sessionOf = (value: unknown): CouncilSession => (isSession(value) ? value : INITIAL_SESSION)

/**
 * A new prompt from the user: what resets per prompt resets here. Rounds,
 * failed attempts, lockouts and the approve cache start over.
 */
export function resetForPrompt(session: CouncilSession, prompt: string): CouncilSession {
  return {
    ...session,
    // A dispatch that threw leaves its debate sitting; none outlives the next prompt.
    debates: session.debates.map(debate => (debate.status === 'sitting' ? settled(debate, 'aborted') : debate)),
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

// ── The debate: what the pane and the band show ─────────────────────────────

const MAX_DEBATES = 8

const MAX_CALL_CHARS = 300

const MAX_REASON_CHARS = 400

/** Text for the debate record: on one line, cut with an ellipsis. Redact before calling. */
export const tidy = (shown: string, max: number): string => {
  const line = shown.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

export const tidyCall = (shown: string): string => tidy(shown, MAX_CALL_CHARS)

export const tidyReason = (shown: string): string => tidy(shown, MAX_REASON_CHARS)

/** A debate over: nobody still waits and no check still runs. */
function settled(debate: CouncilDebate, verdict: NonNullable<CouncilDebate['verdict']>): CouncilDebate {
  return {
    ...debate,
    status: 'done',
    verdict,
    voices: debate.voices.map((voice): CouncilDebateVoice => (voice.status === 'waiting' ? { ...voice, status: 'failed' } : voice)),
    checks: debate.checks.map((check): CouncilDebateCheck => (check.status === 'running' ? { ...check, status: 'stopped' } : check)),
  }
}

const withDebate = (session: CouncilSession, id: string, change: (debate: CouncilDebate) => CouncilDebate): CouncilSession =>
  session.debates.some(debate => debate.id === id)
    ? { ...session, debates: session.debates.map(debate => (debate.id === id ? change(debate) : debate)) }
    : session

/** A review begins: kept newest last, the oldest dropped past the cap. A repeated id replaces its debate. */
export const openDebate = (session: CouncilSession, debate: CouncilDebate): CouncilSession => ({
  ...session,
  debates: [...session.debates.filter(known => known.id !== debate.id), debate].slice(-MAX_DEBATES),
})

/** One voice's outcome, by debate id and the voice's place in it. Reasons are cut; redact before calling. */
export const noteVoice = (
  session: CouncilSession,
  id: string,
  index: number,
  status: CouncilDebateVoice['status'],
  detail: { reason?: string; alternative?: string } = {},
): CouncilSession =>
  withDebate(session, id, debate => ({
    ...debate,
    voices: debate.voices.map((voice, at) =>
      at !== index
        ? voice
        : {
            ...voice,
            status,
            ...(detail.reason !== undefined && detail.reason !== '' && { reason: tidyReason(detail.reason) }),
            ...(detail.alternative !== undefined && detail.alternative !== '' && { alternative: tidyReason(detail.alternative) }),
          },
    ),
  }))

/** One check's outcome, by debate id and the check's name. */
export const noteCheck = (session: CouncilSession, id: string, name: string, status: CouncilDebateCheck['status']): CouncilSession =>
  withDebate(session, id, debate => ({ ...debate, checks: debate.checks.map(check => (check.name === name ? { ...check, status } : check)) }))

/** The review is over: a voice still waiting counts as having given no verdict, a check still running as stopped. */
export const closeDebate = (session: CouncilSession, id: string, verdict: NonNullable<CouncilDebate['verdict']>): CouncilSession =>
  withDebate(session, id, debate => settled(debate, verdict))

export const markDebateOpened = (session: CouncilSession): CouncilSession => (session.debateOpened ? session : { ...session, debateOpened: true })

/** The epic drop row shows until this clock reading. */
export const withEpic = (session: CouncilSession, until: number): CouncilSession => ({ ...session, epicUntil: until })

/** The timer's redraw trigger: clears the epic only once its time has passed. */
export const clearEpic = (session: CouncilSession, now: number): CouncilSession =>
  session.epicUntil !== 0 && now >= session.epicUntil ? { ...session, epicUntil: 0 } : session

/** The median of the recorded review times, or undefined with none. */
export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2)
}
