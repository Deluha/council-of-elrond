import type { CouncilChatAllowance, CouncilCounts, CouncilDebate, CouncilDebateCheck, CouncilDebateVoice, CouncilSession } from '../types'
import type { ChatCommand } from './elrond/chat.js'
import { text } from './strings.js'

/**
 * The session record's shape and every change to it, as pure functions over
 * plain data. register.ts holds the one `$.state` value and applies these.
 * The operation counters themselves live in elrond/operations.ts.
 */

export const INITIAL_SESSION: CouncilSession = {
  v: 5,
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
  chatOffers: [],
  chatAllowances: [],
  chatDenials: [],
}

const MAX_WRITTEN = 100

const MAX_PROMPT_CHARS = 4_000

const MAX_REVIEW_TIMES = 200

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')

const isOptionalString = (value: unknown): boolean => value === undefined || typeof value === 'string'

// Copied from types/index.d.ts, and checked against it in both directions at compile time: a member
// missing here would make every stored record fail the shape check, and `sessionOf` would reset
// the session (lockouts included) on each read.
const DEBATE_KINDS = ['review', 'council'] as const satisfies readonly CouncilDebate['kind'][]
const DEBATE_STATUSES = ['sitting', 'done'] as const satisfies readonly CouncilDebate['status'][]
const DEBATE_VERDICTS = ['approve', 'revise', 'block', 'failed', 'aborted'] as const satisfies readonly NonNullable<CouncilDebate['verdict']>[]
const VOICE_STATUSES = ['waiting', 'approve', 'revise', 'block', 'failed', 'skipped'] as const satisfies readonly CouncilDebateVoice['status'][]
const CHECK_STATUSES = ['running', 'passed', 'failed', 'timed-out', 'error', 'stopped'] as const satisfies readonly CouncilDebateCheck['status'][]
const CHAT_SCOPES = ['once', 'session'] as const satisfies readonly CouncilChatAllowance['scope'][]

/** Resolves to the members of a union that a list leaves out; only `never` compiles (see `Complete`). */
type Missing<Union, List extends readonly unknown[]> = Exclude<Union, List[number]>
type Complete<_Check extends never> = true
type _ListsAreComplete = [
  Complete<Missing<CouncilDebate['kind'], typeof DEBATE_KINDS>>,
  Complete<Missing<CouncilDebate['status'], typeof DEBATE_STATUSES>>,
  Complete<Missing<NonNullable<CouncilDebate['verdict']>, typeof DEBATE_VERDICTS>>,
  Complete<Missing<CouncilDebateVoice['status'], typeof VOICE_STATUSES>>,
  Complete<Missing<CouncilDebateCheck['status'], typeof CHECK_STATUSES>>,
  Complete<Missing<CouncilChatAllowance['scope'], typeof CHAT_SCOPES>>,
]

const isOneOf = (list: readonly unknown[], value: unknown): boolean => list.includes(value)

const isVoice = (value: unknown): boolean =>
  isRecord(value) && typeof value.member === 'string' && isOneOf(VOICE_STATUSES, value.status) && isOptionalString(value.profile) && isOptionalString(value.reason) && isOptionalString(value.alternative)

const isCheck = (value: unknown): boolean => isRecord(value) && typeof value.name === 'string' && isOneOf(CHECK_STATUSES, value.status)

const isDebate = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  isOptionalString(value.agentId) &&
  typeof value.tool === 'string' &&
  typeof value.call === 'string' &&
  isOneOf(DEBATE_KINDS, value.kind) &&
  isOneOf(DEBATE_STATUSES, value.status) &&
  (value.verdict === undefined || isOneOf(DEBATE_VERDICTS, value.verdict)) &&
  Array.isArray(value.voices) &&
  value.voices.every(isVoice) &&
  Array.isArray(value.checks) &&
  value.checks.every(isCheck)

const isOffer = (value: unknown): boolean =>
  isRecord(value) && typeof value.code === 'string' && typeof value.callKey === 'string' && typeof value.canSession === 'boolean' && isNumber(value.epoch)

const isAllowance = (value: unknown): boolean => isRecord(value) && typeof value.callKey === 'string' && isOneOf(CHAT_SCOPES, value.scope)

const isDenial = (value: unknown): boolean => isRecord(value) && typeof value.callKey === 'string'

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
    value.v === 5 &&
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
    typeof value.debateOpened === 'boolean' &&
    Array.isArray(value.chatOffers) &&
    value.chatOffers.every(isOffer) &&
    Array.isArray(value.chatAllowances) &&
    value.chatAllowances.every(isAllowance) &&
    Array.isArray(value.chatDenials) &&
    value.chatDenials.every(isDenial)
  )
}

/** A valid version 4 value as version 5, with no chat records; undefined for anything else. */
function migrated(value: unknown): CouncilSession | undefined {
  if (!isRecord(value) || value.v !== 4) return undefined
  const upgraded = { ...value, v: 5, chatOffers: [], chatAllowances: [], chatDenials: [] }
  return isSession(upgraded) ? upgraded : undefined
}

/**
 * A value of another shape version, or of no valid shape, reads as a fresh
 * session. The one exception is a valid v4 value, which reads as v5 with no chat
 * records: an upgrade mid-session must not clear its rounds and lockouts.
 */
export const sessionOf = (value: unknown): CouncilSession => (isSession(value) ? value : (migrated(value) ?? INITIAL_SESSION))

/** Whether `sessionOf` keeps what is stored, rather than starting a fresh session. */
export const isReadable = (value: unknown): boolean => isSession(value) || migrated(value) !== undefined

/**
 * A new prompt from the user: what resets per prompt resets here. Rounds,
 * failed attempts, lockouts and the approve cache start over, and so do the chat
 * offers, the once-allowances and the denials; session allowances stay.
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
    chatOffers: [],
    chatAllowances: session.chatAllowances.filter(allowance => allowance.scope === 'session'),
    chatDenials: [],
  }
}

/**
 * A prompt that is not a person's: no new task, so rounds, lockouts, offers,
 * denials and session allowances stay. An approval must not outlive a prompt,
 * though: the cache and every once-allowance end here (DESIGN §14.3, §14.4).
 */
export const forOtherPrompt = (session: CouncilSession): CouncilSession => ({
  ...session,
  cache: [],
  chatAllowances: session.chatAllowances.filter(allowance => allowance.scope === 'session'),
})

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

// ── Chat approval (ROADMAP C4, DESIGN §14.4) ────────────────────────────────

const MAX_OFFERS = 20

const MAX_GRANTS = 50

/**
 * A refusal that carried a code is recorded, newest last. A newer offer for the
 * same call replaces the older one. It is kept only if the session is still in
 * the prompt the call began in: an offer made after a new prompt is stale.
 */
export const noteOffer = (session: CouncilSession, offer: { code: string; callKey: string; canSession: boolean }, epoch: number): CouncilSession =>
  session.promptEpoch !== epoch
    ? session
    : { ...session, chatOffers: [...session.chatOffers.filter(known => known.callKey !== offer.callKey), { ...offer, epoch }].slice(-MAX_OFFERS) }

/** Whether the person has answered for this call, so that spending it is worth a write. */
export const holdsChat = (session: CouncilSession, callKey: string): boolean =>
  session.chatDenials.some(denial => denial.callKey === callKey) || session.chatAllowances.some(allowance => allowance.callKey === callKey)

/** What a call found among the person's chat answers; a denial is checked first. */
export type ChatUse = 'deny' | 'once' | 'session' | undefined

/**
 * Looks for the call's denial, then its allowance, and spends what it finds: a
 * denial and a once-allowance are removed, a session allowance stays. `use` says
 * what this very change removed or found, so of two identical calls running
 * together only the one whose write took a once-allowance may use it.
 */
export function useChat(session: CouncilSession, callKey: string): { session: CouncilSession; use: ChatUse } {
  if (session.chatDenials.some(denial => denial.callKey === callKey)) {
    return { session: { ...session, chatDenials: session.chatDenials.filter(denial => denial.callKey !== callKey) }, use: 'deny' }
  }
  const allowance = session.chatAllowances.find(known => known.callKey === callKey)
  if (allowance === undefined) return { session, use: undefined }
  if (allowance.scope === 'session') return { session, use: 'session' }
  return { session: { ...session, chatAllowances: session.chatAllowances.filter(known => known !== allowance) }, use: 'once' }
}

/** What a person's chat line asks to record. */
export type ChatGrant = { kind: 'allow'; callKey: string; scope: 'once' | 'session' } | { kind: 'deny'; callKey: string }

/**
 * Answers a person's chat lines against the offers of the prompt now ending:
 * a grant per line that names one of them, and one acknowledgement per line for
 * Claude. A code no offer has (or that two offers share) records nothing; neither
 * does a malformed line, or `session` for a call that can only be allowed once.
 * An acknowledgement holds only the validated code, never the person's line.
 */
export function answerChat(session: CouncilSession, commands: readonly ChatCommand[]): { grants: ChatGrant[]; acks: string[] } {
  const grants: ChatGrant[] = []
  const acks: string[] = []
  for (const command of commands) {
    if (command.kind === 'malformed') {
      acks.push(text('chat.malformed', {}, 'plain'))
      continue
    }
    const { code } = command
    const matches = session.chatOffers.filter(offer => offer.epoch === session.promptEpoch && offer.code === code)
    const offer = matches.length === 1 ? matches[0] : undefined
    if (offer === undefined) {
      acks.push(text('chat.unknown', { verb: command.kind, code }, 'plain'))
    } else if (command.kind === 'deny') {
      grants.push({ kind: 'deny', callKey: offer.callKey })
      acks.push(text('chat.denied', { code }, 'plain'))
    } else if (command.scope === 'session' && !offer.canSession) {
      acks.push(text('chat.noSession', { code }, 'plain'))
    } else {
      grants.push({ kind: 'allow', callKey: offer.callKey, scope: command.scope })
      acks.push(text(command.scope === 'session' ? 'chat.allowedSession' : 'chat.allowed', { code }, 'plain'))
    }
  }
  return { grants, acks }
}

/** Records the grants in order; a later one for the same call replaces an earlier one, an allowance and a denial included. */
export const grantChat = (session: CouncilSession, grants: readonly ChatGrant[]): CouncilSession =>
  grants.reduce<CouncilSession>(
    (current, grant) =>
      grant.kind === 'deny'
        ? {
            ...current,
            chatAllowances: current.chatAllowances.filter(known => known.callKey !== grant.callKey),
            chatDenials: [...current.chatDenials.filter(known => known.callKey !== grant.callKey), { callKey: grant.callKey }].slice(-MAX_GRANTS),
          }
        : {
            ...current,
            chatAllowances: [...current.chatAllowances.filter(known => known.callKey !== grant.callKey), { callKey: grant.callKey, scope: grant.scope }].slice(-MAX_GRANTS),
            chatDenials: current.chatDenials.filter(known => known.callKey !== grant.callKey),
          },
    session,
  )

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
