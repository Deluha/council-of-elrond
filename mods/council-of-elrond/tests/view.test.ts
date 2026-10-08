import { describe, expect, test } from 'claude-code/testing'

import type { CouncilDebate, CouncilSession } from '../types'
import { bandRows, debateRows, nameOf, threatRows, voiceNote, wipeRow } from '../hooks/elrond/view.js'
import type { Row } from '../hooks/elrond/view.js'
import {
  clearEpic,
  closeDebate,
  INITIAL_SESSION,
  markDebateOpened,
  noteCheck,
  noteVoice,
  openDebate,
  resetForPrompt,
  sessionOf,
  withEpic,
} from '../hooks/state.js'
import { THEME, withoutIds } from './fixtures.js'

const debate = (over: Partial<CouncilDebate> & { id: string }): CouncilDebate => ({
  tool: 'Bash',
  call: 'rm -rf build',
  kind: 'review',
  status: 'sitting',
  voices: [],
  checks: [],
  ...over,
})

const single = (id: string, status: CouncilDebate['voices'][number]['status'], extra: Partial<CouncilDebate> = {}): CouncilDebate =>
  debate({ id, status: status === 'waiting' ? 'sitting' : 'done', ...(status !== 'waiting' && { verdict: status === 'skipped' ? 'failed' : status }), voices: [{ member: 'gandalf', status }], ...extra })

const council = (id: string, extra: Partial<CouncilDebate> = {}): CouncilDebate =>
  debate({
    id,
    kind: 'council',
    call: 'git push origin feature',
    voices: [
      { member: 'gandalf', status: 'waiting' },
      { member: 'legolas', status: 'waiting' },
      { member: 'aragorn', profile: 'git', status: 'waiting' },
    ],
    checks: [{ name: 'tests', status: 'running' }],
    ...extra,
  })

const withDebates = (...debates: CouncilDebate[]): CouncilSession => debates.reduce(openDebate, INITIAL_SESSION)

const texts = (rows: readonly Row[]): string[] => rows.map(row => row.text)

describe('the debate record', () => {
  test('a session of another shape version reads as fresh; this one is version 4', () => {
    expect(INITIAL_SESSION.v).toBe(4)
    const old = { ...INITIAL_SESSION, v: 3, latestPrompt: 'kept?' } as unknown as CouncilSession
    expect(sessionOf(old)).toBe(INITIAL_SESSION)
    expect(sessionOf(undefined)).toBe(INITIAL_SESSION)
    const now = { ...INITIAL_SESSION, latestPrompt: 'kept' }
    expect(sessionOf(now)).toBe(now)
  })

  test('openDebate keeps the newest eight, newest last, and a repeated id replaces its debate', () => {
    let session = INITIAL_SESSION
    for (let n = 1; n <= 10; n++) session = openDebate(session, debate({ id: `tu-${n}` }))
    expect(session.debates.map(known => known.id)).toEqual(['tu-3', 'tu-4', 'tu-5', 'tu-6', 'tu-7', 'tu-8', 'tu-9', 'tu-10'])
    const again = openDebate(session, debate({ id: 'tu-5', call: 'ls' }))
    expect(again.debates.map(known => known.id)).toEqual(['tu-3', 'tu-4', 'tu-6', 'tu-7', 'tu-8', 'tu-9', 'tu-10', 'tu-5'])
    expect(again.debates.at(-1)?.call).toBe('ls')
  })

  test('noteVoice sets one voice by debate id and place, with its reason cut to 400 characters on one line', () => {
    const session = withDebates(council('a'), council('b'))
    const long = `${'x'.repeat(300)}\n${'y'.repeat(300)}`
    const noted = noteVoice(session, 'a', 1, 'block', { reason: long, alternative: 'Use a branch.' })
    const voices = noted.debates[0]?.voices
    expect(voices?.map(voice => voice.status)).toEqual(['waiting', 'block', 'waiting'])
    expect(voices?.[1]?.reason).toHaveLength(400)
    expect(voices?.[1]?.reason).not.toContain('\n')
    expect(voices?.[1]?.reason?.endsWith('…')).toBe(true)
    expect(voices?.[1]?.alternative).toBe('Use a branch.')
    // The other debate is untouched, and so is a debate that is not there.
    expect(noted.debates[1]).toBe(session.debates[1])
    expect(noteVoice(session, 'missing', 0, 'approve')).toBe(session)
    // An empty reason is no reason.
    expect(noteVoice(session, 'a', 0, 'approve', { reason: '', alternative: '' }).debates[0]?.voices[0]).toEqual({ member: 'gandalf', status: 'approve' })
  })

  test('noteCheck sets one check by debate id and name', () => {
    const session = withDebates(council('a', { checks: [{ name: 'tests', status: 'running' }, { name: 'lint', status: 'running' }] }))
    const noted = noteCheck(session, 'a', 'lint', 'failed')
    expect(noted.debates[0]?.checks).toEqual([{ name: 'tests', status: 'running' }, { name: 'lint', status: 'failed' }])
    expect(noteCheck(session, 'missing', 'lint', 'failed')).toBe(session)
  })

  test('closeDebate ends it: a voice still waiting gave no verdict, a check still running was stopped', () => {
    let session = withDebates(council('a', { checks: [{ name: 'tests', status: 'running' }, { name: 'lint', status: 'running' }] }))
    session = noteVoice(session, 'a', 0, 'approve')
    session = noteVoice(session, 'a', 2, 'skipped')
    session = noteCheck(session, 'a', 'lint', 'passed')
    const closed = closeDebate(session, 'a', 'block')
    expect(closed.debates[0]).toMatchObject({
      status: 'done',
      verdict: 'block',
      voices: [{ status: 'approve' }, { status: 'failed' }, { status: 'skipped' }],
      checks: [{ name: 'tests', status: 'stopped' }, { name: 'lint', status: 'passed' }],
    })
    expect(closeDebate(session, 'missing', 'block')).toBe(session)
  })

  test('markDebateOpened, withEpic and clearEpic', () => {
    expect(INITIAL_SESSION.debateOpened).toBe(false)
    expect(markDebateOpened(INITIAL_SESSION).debateOpened).toBe(true)
    const epic = withEpic(INITIAL_SESSION, 9_000)
    expect(epic.epicUntil).toBe(9_000)
    // Only once its time has come: an early timer leaves a newer drop alone.
    expect(clearEpic(epic, 8_999)).toBe(epic)
    expect(clearEpic(epic, 9_000).epicUntil).toBe(0)
    expect(clearEpic(epic, 12_000).epicUntil).toBe(0)
    expect(clearEpic(INITIAL_SESSION, 12_000)).toBe(INITIAL_SESSION)
  })

  test('a new prompt settles every sitting debate as aborted, keeps the history, and leaves the epic alone', () => {
    let session = withDebates(single('done', 'approve'), council('open'))
    session = withEpic(markDebateOpened(session), 5_000)
    const next = resetForPrompt(session, 'next')
    expect(next.debates.map(known => [known.id, known.status, known.verdict])).toEqual([
      ['done', 'done', 'approve'],
      ['open', 'done', 'aborted'],
    ])
    expect(next.debates[1]?.voices.map(voice => voice.status)).toEqual(['failed', 'failed', 'failed'])
    expect(next.debates[1]?.checks.map(check => check.status)).toEqual(['stopped'])
    expect(next.debates[0]).toBe(session.debates[0])
    expect(next.epicUntil).toBe(5_000)
    expect(next.debateOpened).toBe(true)
  })
})

describe('the debate pane rows', () => {
  test('with no debate for the view: one row saying so, then the wipe counter and the threat meter', () => {
    const rows = debateRows(INITIAL_SESSION, undefined, 'plain')
    expect(texts(rows)).toEqual([
      'No reviews yet in this view.',
      '',
      'Refused or failed attempts since your last prompt: 0 over 0 operations, 0 locked out',
      '',
      'Refusals per reviewer',
      'No blocks yet.',
    ])
    expect(debateRows(INITIAL_SESSION, undefined, 'themed').map(row => row.text)).toContain('Threat meter')
  })

  test('a single review in each status: a bold proposal, the member, the status word and a theme colour key', () => {
    const cases = [
      ['approve', '✓ approve', 'success'],
      ['revise', '✗ revise', 'warning'],
      ['block', '✗ block', 'error'],
      ['failed', '✗ no verdict', 'error'],
      ['waiting', '… reviewing', 'inactive'],
      ['skipped', '– sat out', 'inactive'],
    ] as const
    for (const [status, word, color] of cases) {
      const rows = debateRows(withDebates(single('a', status)), undefined, 'plain')
      expect(rows[0], status).toEqual({ text: 'Bash: rm -rf build', bold: true })
      expect(rows[1], status).toEqual({ text: `the destructive-operations reviewer: ${word}`, color })
    }
  })

  test('the reason and the safer alternative follow their voice', () => {
    const shown = single('a', 'block', { voices: [{ member: 'gandalf', status: 'block', reason: 'Deletes the cache.', alternative: 'Delete build/tmp only.' }] })
    expect(texts(debateRows(withDebates(shown), undefined, 'plain')).slice(0, 4)).toEqual([
      'Bash: rm -rf build',
      'the destructive-operations reviewer: ✗ block',
      '  Reason: Deletes the cache.',
      '  Safer alternative: Delete build/tmp only.',
    ])
  })

  test('themed, a member says its line after its status; plain has none', () => {
    const session = withDebates(single('a', 'block'))
    const themed = texts(debateRows(session, undefined, 'themed'))
    expect(themed.slice(0, 3)).toEqual(['Bash: rm -rf build', 'Gandalf: ✗ block', '  You shall not pass.'])
    expect(texts(debateRows(session, undefined, 'plain'))).not.toContain('  You shall not pass.')
    // No line for a verdict the member has none for.
    expect(texts(debateRows(withDebates(single('b', 'failed')), undefined, 'themed')).slice(0, 2)).toEqual(['Bash: rm -rf build', 'Gandalf: ✗ no verdict'])
  })

  test('a council mid-sitting: every voice and check, no verdict yet; done: the verdict row and its line', () => {
    const sitting = debateRows(withDebates(council('a')), undefined, 'plain')
    expect(texts(sitting).slice(0, 5)).toEqual([
      'Bash: git push origin feature',
      'the destructive-operations reviewer: … reviewing',
      'the diff reviewer: … reviewing',
      'the git reviewer: … reviewing',
      'Check "tests": … running',
    ])
    expect(texts(sitting).some(line => line.startsWith('Verdict'))).toBe(false)

    let session = withDebates(council('a'))
    session = noteVoice(session, 'a', 0, 'approve', { reason: 'Fine.' })
    session = noteVoice(session, 'a', 1, 'revise', { reason: 'Trim it.', alternative: 'Drop the extra file.' })
    session = noteVoice(session, 'a', 2, 'skipped', { reason: 'not asked: an earlier member had already blocked' })
    session = noteCheck(session, 'a', 'tests', 'failed')
    session = closeDebate(session, 'a', 'block')
    expect(texts(debateRows(session, undefined, 'plain')).slice(0, 13)).toEqual([
      'Bash: git push origin feature',
      'the destructive-operations reviewer: ✓ approve',
      '  Reason: Fine.',
      'the diff reviewer: ✗ revise',
      '  Reason: Trim it.',
      '  Safer alternative: Drop the extra file.',
      'the git reviewer: – sat out',
      '  Reason: not asked: an earlier member had already blocked',
      'Check "tests": ✗ failed',
      'Verdict: block',
      '',
      'Refused or failed attempts since your last prompt: 0 over 0 operations, 0 locked out',
      '',
    ])
    const themed = texts(debateRows(session, undefined, 'themed'))
    expect(themed).toContain('  And my axe says no: the checks failed.')
    expect(themed).toContain('  The council has spoken: no.')
  })

  test('a view shows its own agent\'s debates, newest first, three at most', () => {
    const session = withDebates(
      single('main-1', 'approve', { call: 'main one' }),
      single('agent-1', 'block', { agentId: 'sub-1', call: 'agent one' }),
      single('main-2', 'revise', { call: 'main two' }),
      single('main-3', 'approve', { call: 'main three' }),
      single('main-4', 'approve', { call: 'main four' }),
      single('agent-2', 'approve', { agentId: 'sub-2', call: 'agent two' }),
    )
    const proposals = (agentId: string | undefined): string[] =>
      texts(debateRows(session, agentId, 'plain')).filter(line => line.startsWith('Bash:'))
    expect(proposals(undefined)).toEqual(['Bash: main four', 'Bash: main three', 'Bash: main two'])
    expect(proposals('sub-1')).toEqual(['Bash: agent one'])
    expect(proposals('sub-2')).toEqual(['Bash: agent two'])
    expect(texts(debateRows(session, 'sub-9', 'plain'))[0]).toBe('No reviews yet in this view.')
  })

  test('the wipe counter reads the counters since your last prompt, as /council status does', () => {
    const session: CouncilSession = {
      ...INITIAL_SESSION,
      ops: { a: { rounds: 0, wipes: 3 }, b: { rounds: 1, wipes: 1 }, c: { rounds: 0, wipes: 0 } },
      verbWipes: { 'git push': 2, 'rm': 2 },
    }
    expect(wipeRow(session, 'plain').text).toBe('Refused or failed attempts since your last prompt: 4 over 3 operations, 1 locked out')
    expect(wipeRow(session, 'themed').text).toBe('Wipes since your last prompt: 4 over 3 operations, 1 locked out')
  })

  test('the threat meter: blockers by block count, a bar of up to ten blocks, and the number as text', () => {
    const counts = (blocked: number) => ({ approved: 1, revised: 0, blocked, failed: 0 })
    const session: CouncilSession = {
      ...INITIAL_SESSION,
      counts: { legolas: counts(1), gandalf: counts(3), council: counts(14), aragorn: counts(0), gimli: counts(2) },
    }
    expect(texts(threatRows(session, 'themed'))).toEqual([
      'Threat meter',
      'the Council of Elrond ██████████ 14 blocks',
      'Gandalf ███ 3 blocks',
      'Gimli ██ 2 blocks',
      'Legolas █ 1 block',
    ])
    expect(texts(threatRows(session, 'plain'))).toEqual([
      'Refusals per reviewer',
      'the full council ██████████ 14 blocks',
      'the destructive-operations reviewer ███ 3 blocks',
      'the project checks ██ 2 blocks',
      'the diff reviewer █ 1 block',
    ])
    expect(threatRows(session, 'plain').slice(1).every(row => row.color === 'error')).toBe(true)
  })

  test('names follow the mode, for every member the counts can hold', () => {
    expect([nameOf('gollum', undefined, 'themed'), nameOf('gollum', undefined, 'plain')]).toEqual(['Gollum', 'the secrets scan'])
    expect([nameOf('aragorn', 'git', 'themed'), nameOf('aragorn', 'database', 'plain')]).toEqual(['Aragorn (git)', 'the database reviewer'])
  })

  test('voiceNote maps what the council resolved to what the record keeps', () => {
    const base = { who: 'who.gandalf', member: 'gandalf' } as const
    expect(voiceNote({ kind: 'verdict', ...base, verdict: { verdict: 'revise', reason: 'Too wide.', safer_alternative: 'Narrow it.' } })).toEqual({ status: 'revise', reason: 'Too wide.', alternative: 'Narrow it.' })
    expect(voiceNote({ kind: 'failed', ...base, problem: 'timed out' })).toEqual({ status: 'failed', reason: 'timed out' })
    expect(voiceNote({ kind: 'skipped', ...base, why: '' })).toEqual({ status: 'skipped' })
    expect(voiceNote({ kind: 'skipped', ...base, why: 'not asked' })).toEqual({ status: 'skipped', reason: 'not asked' })
  })

  test('plain rows carry no theme text, and every colour is a theme key', () => {
    let session = withDebates(
      single('a', 'block', { voices: [{ member: 'gandalf', status: 'block', reason: 'Too wide.', alternative: 'Do less.' }] }),
      council('b'),
    )
    session = noteVoice(session, 'b', 0, 'approve')
    session = noteVoice(session, 'b', 1, 'block', { reason: 'Unrelated files.' })
    session = noteCheck(session, 'b', 'tests', 'timed-out')
    session = closeDebate(session, 'b', 'block')
    const counts = { approved: 0, revised: 0, blocked: 2, failed: 0 }
    session = withEpic({ ...session, counts: { gandalf: counts, council: counts, gimli: counts, gollum: counts, legolas: counts, aragorn: counts } }, 9_000)
    const plain = [...debateRows(session, undefined, 'plain'), ...(bandRows(withDebates(council('c')), undefined, 0, 'plain') ?? []), ...(bandRows(session, undefined, 0, 'plain') ?? [])]
    for (const row of plain) expect(withoutIds(row.text), row.text).not.toMatch(THEME)
    const themed = [...debateRows(session, undefined, 'themed'), ...(bandRows(withDebates(council('c')), undefined, 0, 'themed') ?? []), ...(bandRows(session, undefined, 0, 'themed') ?? [])]
    const keys = new Set(['success', 'warning', 'error', 'inactive', 'merged'])
    for (const row of [...plain, ...themed]) if (row.color !== undefined) expect(keys.has(row.color), row.text).toBe(true)
    // The themed pane does use the theme.
    expect(themed.some(row => THEME.test(row.text))).toBe(true)
  })
})

describe('the band rows', () => {
  test('nothing to draw: undefined, so the hook passes and the band takes no row', () => {
    expect(bandRows(INITIAL_SESSION, undefined, 0, 'themed')).toBeUndefined()
    expect(bandRows(INITIAL_SESSION, undefined, 0, 'plain')).toBeUndefined()
    // Single-member reviews never draw in the band, sitting or not; nor does a finished council.
    expect(bandRows(withDebates(single('a', 'waiting'), single('b', 'approve'), council('c', { status: 'done', verdict: 'approve' })), undefined, 0, 'themed')).toBeUndefined()
  })

  test('a sitting council: a header, then a row for each member and each check', () => {
    let session = withDebates(council('a'))
    session = noteVoice(session, 'a', 0, 'approve')
    session = noteVoice(session, 'a', 1, 'block')
    expect(bandRows(session, undefined, 0, 'plain')).toEqual([
      { text: 'Full council review: Bash: git push origin feature', bold: true },
      { text: 'the destructive-operations reviewer: ✓ approve', color: 'success' },
      { text: 'the diff reviewer: ✗ block', color: 'error' },
      { text: 'the git reviewer: … reviewing', color: 'inactive' },
      { text: 'Check "tests": … running', color: 'inactive' },
    ])
    const themed = texts(bandRows(session, undefined, 0, 'themed') ?? [])
    expect(themed.slice(0, 3)).toEqual(['Ready check: Bash: git push origin feature', 'Gandalf: ✓ approve', 'Legolas: ✗ block'])
  })

  test('the band is the newest sitting council of the view in question', () => {
    const session = withDebates(
      council('main', { call: 'main push' }),
      council('agent', { agentId: 'sub-1', call: 'agent push' }),
      council('newer', { agentId: 'sub-1', call: 'newer agent push' }),
    )
    expect(bandRows(session, undefined, 0, 'plain')?.[0]?.text).toBe('Full council review: Bash: main push')
    expect(bandRows(session, 'sub-1', 0, 'plain')?.[0]?.text).toBe('Full council review: Bash: newer agent push')
    expect(bandRows(session, 'sub-2', 0, 'plain')).toBeUndefined()
  })

  test('a long call is cut to one row', () => {
    const rows = bandRows(withDebates(council('a', { call: 'x'.repeat(300) })), undefined, 0, 'plain')
    expect(rows?.[0]?.text.length).toBeLessThan(120)
    expect(rows?.[0]?.text.endsWith('…')).toBe(true)
  })

  test('the epic drop row: themed only, and only while the time lasts', () => {
    const session = withEpic(INITIAL_SESSION, 8_000)
    expect(bandRows(session, undefined, 7_999, 'themed')).toEqual([{ text: '✦ Legendary commit acquired', color: 'merged', bold: true }])
    expect(bandRows(session, undefined, 8_000, 'themed')).toBeUndefined()
    expect(bandRows(session, undefined, 100_000, 'themed')).toBeUndefined()
    expect(bandRows(session, undefined, 0, 'plain')).toBeUndefined()
    // It is the session's, so either view shows it, under a council check when one sits.
    expect(bandRows(session, 'sub-1', 0, 'themed')).toHaveLength(1)
    expect(bandRows({ ...withDebates(council('a')), epicUntil: 8_000 }, undefined, 0, 'themed')?.at(-1)?.text).toBe('✦ Legendary commit acquired')
  })
})
