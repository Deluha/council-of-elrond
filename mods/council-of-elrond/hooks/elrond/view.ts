import type { ThemeKey } from 'claude-code'

import type { CouncilDebate, CouncilDebateCheck, CouncilDebateVoice, CouncilSession } from '../../types'
import type { MemberName, Profile } from '../config/types.js'
import { whoOf } from '../members/brief.js'
import type { Voice } from './combine.js'
import { flavourOf, text } from '../strings.js'
import type { Mode, StringKey } from '../strings.js'
import { attemptsOf } from './operations.js'

/**
 * What the debate pane and the council check band draw, as plain data: rows
 * of text with a theme colour. No `$`, no drawing, no state writes; the
 * hooks in register.ts turn a row into a `Text`. Colours are theme keys only,
 * and every symbol comes with a word, so nothing depends on colour.
 */

export type Row = { text: string; color?: ThemeKey; bold?: boolean; dim?: boolean }

/** Debates one view shows at most, newest first. */
const MAX_SHOWN = 3

/** Blocks a threat meter bar shows; the number beside it is exact. */
const MAX_BAR = 10

/** The band's header line: the call, cut to this many characters. */
const BAND_CALL_CHARS = 80

const VOICE_COLOR: Readonly<Record<CouncilDebateVoice['status'], ThemeKey>> = {
  approve: 'success',
  revise: 'warning',
  block: 'error',
  failed: 'error',
  waiting: 'inactive',
  skipped: 'inactive',
}

const CHECK_COLOR: Readonly<Record<CouncilDebateCheck['status'], ThemeKey>> = {
  running: 'inactive',
  passed: 'success',
  failed: 'error',
  'timed-out': 'error',
  error: 'error',
  stopped: 'inactive',
}

const VERDICT_COLOR: Readonly<Record<NonNullable<CouncilDebate['verdict']>, ThemeKey>> = {
  approve: 'success',
  revise: 'warning',
  block: 'error',
  failed: 'error',
  aborted: 'inactive',
}

/** A member's name for the user: the models', the council's, the checks', the secrets scan's. */
export function nameOf(member: string, profile: string | undefined, mode: Mode): string {
  switch (member) {
    case 'council':
      return text('who.fullCouncil', {}, mode)
    case 'gimli':
      return text('who.gimli', {}, mode)
    case 'gollum':
      return text('who.gollum', {}, mode)
    default:
      return text(whoOf(member as MemberName, profile as Profile | undefined), {}, mode)
  }
}

/** A voice's outcome as the debate record keeps it, from what `convene` resolved. */
export function voiceNote(voice: Voice): { status: CouncilDebateVoice['status']; reason?: string; alternative?: string } {
  switch (voice.kind) {
    case 'verdict':
      return { status: voice.verdict.verdict, reason: voice.verdict.reason, alternative: voice.verdict.safer_alternative }
    case 'failed':
      return { status: 'failed', reason: voice.problem }
    case 'skipped':
      return { status: 'skipped', ...(voice.why !== '' && { reason: voice.why }) }
  }
}

const voiceRow = (voice: CouncilDebateVoice, mode: Mode): Row => ({
  text: text('debate.voice', { who: nameOf(voice.member, voice.profile, mode), status: text(`debate.status.${voice.status}` as StringKey, {}, mode) }, mode),
  color: VOICE_COLOR[voice.status],
})

const checkRow = (check: CouncilDebateCheck, mode: Mode): Row => ({
  text: text('debate.check', { name: check.name, status: text(`debate.check.${check.status}` as StringKey, {}, mode) }, mode),
  color: CHECK_COLOR[check.status],
})

function debateRowsOf(debate: CouncilDebate, mode: Mode): Row[] {
  const rows: Row[] = [{ text: text('debate.proposal', { tool: debate.tool, call: debate.call }, mode), bold: true }]
  for (const voice of debate.voices) {
    rows.push(voiceRow(voice, mode))
    const flavour = flavourOf(voice.member, voice.status, mode)
    if (flavour !== undefined) rows.push({ text: text('debate.flavour', { line: flavour }, mode), dim: true })
    if (voice.reason !== undefined) rows.push({ text: text('debate.reason', { reason: voice.reason }, mode) })
    if (voice.alternative !== undefined) rows.push({ text: text('debate.alternative', { alternative: voice.alternative }, mode) })
  }
  for (const check of debate.checks) {
    rows.push(checkRow(check, mode))
    const flavour = check.status === 'failed' || check.status === 'timed-out' || check.status === 'error' ? flavourOf('gimli', 'block', mode) : undefined
    if (flavour !== undefined) rows.push({ text: text('debate.flavour', { line: flavour }, mode), dim: true })
  }
  if (debate.kind === 'council' && debate.verdict !== undefined) {
    rows.push({ text: text('debate.verdict', { verdict: debate.verdict }, mode), bold: true, color: VERDICT_COLOR[debate.verdict] })
    const flavour = flavourOf('council', debate.verdict, mode)
    if (flavour !== undefined) rows.push({ text: text('debate.flavour', { line: flavour }, mode), dim: true })
  }
  return rows
}

/** The debates one view shows: its own agent's (none: the main conversation's), newest first. */
const debatesOf = (session: CouncilSession, agentId: string | undefined): CouncilDebate[] =>
  session.debates.filter(debate => debate.agentId === agentId).reverse()

/** The wipe counter row. */
export function wipeRow(session: CouncilSession, mode: Mode): Row {
  return { text: text('debate.wipes', attemptsOf(session), mode), dim: true }
}

/** The threat meter: a header, then each member that has blocked, most first. */
export function threatRows(session: CouncilSession, mode: Mode): Row[] {
  const blockers = Object.entries(session.counts)
    .filter(([, counts]) => counts.blocked > 0)
    .sort(([, a], [, b]) => b.blocked - a.blocked)
  const rows: Row[] = [{ text: text('debate.threatHeader', {}, mode), bold: true }]
  if (blockers.length === 0) return [...rows, { text: text('debate.threatNone', {}, mode), dim: true }]
  for (const [member, counts] of blockers) {
    const params = { who: nameOf(member, undefined, mode), bar: text('debate.bar', {}, mode).repeat(Math.min(counts.blocked, MAX_BAR)), count: counts.blocked }
    rows.push({ text: text(counts.blocked === 1 ? 'debate.threatOne' : 'debate.threatMany', params, mode), color: 'error' })
  }
  return rows
}

/**
 * The debate pane: the view's newest reviews, then the session's wipe counter
 * and threat meter. With no review for the view, one row saying so.
 */
export function debateRows(session: CouncilSession, agentId: string | undefined, mode: Mode): Row[] {
  const shown = debatesOf(session, agentId).slice(0, MAX_SHOWN)
  const rows: Row[] =
    shown.length === 0 ? [{ text: text('debate.empty', {}, mode), dim: true }] : shown.flatMap((debate, index) => [...(index > 0 ? [{ text: '' }] : []), ...debateRowsOf(debate, mode)])
  return [...rows, { text: '' }, wipeRow(session, mode), { text: '' }, ...threatRows(session, mode)]
}

/**
 * The band above the prompt: the view's full council while it sits (a row
 * for each member and each check), and the epic drop while its time lasts
 * (themed mode only). Undefined when there is nothing to draw, so the hook
 * passes and the band takes no row.
 */
export function bandRows(session: CouncilSession, agentId: string | undefined, now: number, mode: Mode): Row[] | undefined {
  const rows: Row[] = []
  const sitting = debatesOf(session, agentId).find(debate => debate.kind === 'council' && debate.status === 'sitting')
  if (sitting !== undefined) {
    const call = `${sitting.tool}: ${sitting.call}`
    rows.push({
      text: text('band.line', { header: text('band.header', {}, mode), call: call.length > BAND_CALL_CHARS ? `${call.slice(0, BAND_CALL_CHARS - 1)}…` : call }, mode),
      bold: true,
    })
    for (const voice of sitting.voices) rows.push(voiceRow(voice, mode))
    for (const check of sitting.checks) rows.push(checkRow(check, mode))
  }
  if (mode === 'themed' && now < session.epicUntil) rows.push({ text: text('epic.row', {}, mode), color: 'merged', bold: true })
  return rows.length === 0 ? undefined : rows
}
