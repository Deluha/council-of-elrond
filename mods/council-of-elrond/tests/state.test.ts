import { describe, expect, test } from 'claude-code/testing'

import {
  answerChat,
  count,
  forOtherPrompt,
  grantChat,
  holdsChat,
  INITIAL_SESSION,
  isSession,
  noteOffer,
  noteWritten,
  openDebate,
  resetForPrompt,
  sessionOf,
  useChat,
} from '../hooks/state.js'
import type { CouncilDebate, CouncilSession } from '../types'

const DEBATE: CouncilDebate = {
  id: 'toolu_1',
  agentId: 'agent-1',
  tool: 'Bash',
  call: 'rm -rf build',
  kind: 'council',
  status: 'done',
  verdict: 'block',
  voices: [{ member: 'aragorn', profile: 'git', status: 'block', reason: 'No.', alternative: 'Ask.' }, { member: 'gandalf', status: 'skipped' }],
  checks: [{ name: 'tests', status: 'stopped' }],
}

/** A session with every container filled in, so a bad element in any of them can be swapped in. */
const OFFER = { code: 'aaaaaa', callKey: 'aaaaaa0123456789', canSession: true, epoch: 0 }

const FULL: CouncilSession = openDebate(
  noteWritten(
    count(
      {
        ...INITIAL_SESSION,
        models: { gandalf: 'opus' },
        reviewMs: [1200, 800],
        ops: { 'shell:rm build': { rounds: 1, wipes: 2 } },
        verbWipes: { rm: 2 },
        cache: ['abc'],
        declinedRules: ['k'],
        chatOffers: [OFFER],
        chatAllowances: [{ callKey: 'bbbbbb0123456789', scope: 'once' }, { callKey: 'cccccc0123456789', scope: 'session' }],
        chatDenials: [{ callKey: 'dddddd0123456789' }],
      },
      'gandalf',
      'approve',
    ),
    '/work/a.ts',
  ),
  DEBATE,
)

const with_ = (changes: Record<string, unknown>): unknown => ({ ...FULL, ...changes })

describe('the session shape check', () => {
  test('the initial session, and a full one, pass', () => {
    expect(isSession(INITIAL_SESSION)).toBe(true)
    expect(isSession(FULL)).toBe(true)
    expect(sessionOf(FULL)).toBe(FULL)
    expect(isSession(JSON.parse(JSON.stringify(FULL)))).toBe(true)
  })

  test('not an object, or another version, is not a session', () => {
    for (const value of [undefined, null, 4, 'v5', [], [FULL], { ...FULL, v: 3 }, { ...FULL, v: 6 }, { ...FULL, v: '5' }]) {
      expect(isSession(value), JSON.stringify(value)).toBe(false)
      expect(sessionOf(value)).toBe(INITIAL_SESSION)
    }
  })

  test('every top-level field must have its type', () => {
    const bad: Record<string, unknown[]> = {
      latestPrompt: [1, null, undefined],
      promptEpoch: ['1', null, Number.NaN, undefined],
      tokensSpent: ['0', null, undefined],
      bypass: [0, 'false', undefined],
      shadow: [undefined, 'on', 0],
      models: [null, [], 'x', undefined],
      written: [null, 'a', {}, undefined],
      counts: [null, [], undefined],
      reviewMs: [null, '1', {}, undefined],
      ops: [null, [], undefined],
      verbWipes: [null, [], undefined],
      cache: [null, 'abc', {}, undefined],
      declinedRules: [null, 'k', undefined],
      debates: [null, {}, 'x', undefined],
      epicUntil: ['0', null, undefined],
      debateOpened: [0, 'true', undefined],
      chatOffers: [null, {}, 'x', undefined],
      chatAllowances: [null, {}, 'x', undefined],
      chatDenials: [null, {}, 'x', undefined],
    }
    for (const [field, values] of Object.entries(bad)) {
      for (const value of values) expect(isSession(with_({ [field]: value })), `${field} = ${String(value)}`).toBe(false)
    }
    // A field missing altogether is the same as undefined.
    const { cache: _cache, ...without } = FULL
    expect(isSession(without)).toBe(false)
  })

  test('shadow may be true, false or null', () => {
    for (const shadow of [true, false, null]) expect(isSession(with_({ shadow }))).toBe(true)
  })

  test('the elements of every container the pipeline indexes into', () => {
    const bad: [string, unknown][] = [
      ['an op that is not an object', { ops: { k: 3 } }],
      ['an op with no wipes', { ops: { k: { rounds: 1 } } }],
      ['an op with a string count', { ops: { k: { rounds: '1', wipes: 0 } } }],
      ['a null op', { ops: { k: null } }],
      ['a count entry missing a field', { counts: { gandalf: { approved: 1, revised: 0, blocked: 0 } } }],
      ['a count entry that is a number', { counts: { gandalf: 2 } }],
      ['a verb count that is a string', { verbWipes: { rm: '2' } }],
      ['a model that is not a string', { models: { gandalf: 7 } }],
      ['a model that is null', { models: { gandalf: null } }],
      ['a number among the written paths', { written: ['/work/a', 3] }],
      ['a number among the cache fingerprints', { cache: ['abc', 3] }],
      ['a number among the declined rules', { declinedRules: [1] }],
      ['a string among the review times', { reviewMs: [1, '2'] }],
      ['an offer that is a string', { chatOffers: ['aaaaaa'] }],
      ['an offer with no code', { chatOffers: [{ ...OFFER, code: undefined }] }],
      ['an offer with a numeric key', { chatOffers: [{ ...OFFER, callKey: 7 }] }],
      ['an offer with a string flag', { chatOffers: [{ ...OFFER, canSession: 'yes' }] }],
      ['an offer with no epoch', { chatOffers: [{ ...OFFER, epoch: undefined }] }],
      ['an allowance that is a string', { chatAllowances: ['k'] }],
      ['an allowance of an unknown scope', { chatAllowances: [{ callKey: 'k', scope: 'forever' }] }],
      ['an allowance with no key', { chatAllowances: [{ scope: 'once' }] }],
      ['a denial that is a string', { chatDenials: ['k'] }],
      ['a denial with a numeric key', { chatDenials: [{ callKey: 3 }] }],
      ['a debate that is a string', { debates: ['x'] }],
      ['a debate with no id', { debates: [{ ...DEBATE, id: undefined }] }],
      ['a debate of an unknown kind', { debates: [{ ...DEBATE, kind: 'other' }] }],
      ['a debate of an unknown status', { debates: [{ ...DEBATE, status: 'open' }] }],
      ['a debate with an unknown verdict', { debates: [{ ...DEBATE, verdict: 'maybe' }] }],
      ['a debate with no voices list', { debates: [{ ...DEBATE, voices: null }] }],
      ['a voice that is a string', { debates: [{ ...DEBATE, voices: ['x'] }] }],
      ['a voice of an unknown status', { debates: [{ ...DEBATE, voices: [{ member: 'gandalf', status: 'thinking' }] }] }],
      ['a voice with no member', { debates: [{ ...DEBATE, voices: [{ status: 'block' }] }] }],
      ['a voice reason that is a number', { debates: [{ ...DEBATE, voices: [{ member: 'gandalf', status: 'block', reason: 3 }] }] }],
      ['a debate with no checks list', { debates: [{ ...DEBATE, checks: undefined }] }],
      ['a check of an unknown status', { debates: [{ ...DEBATE, checks: [{ name: 'tests', status: 'lost' }] }] }],
      ['a check with no name', { debates: [{ ...DEBATE, checks: [{ status: 'passed' }] }] }],
    ]
    for (const [name, changes] of bad) {
      const value = with_(changes as Record<string, unknown>)
      expect(isSession(value), name).toBe(false)
      expect(sessionOf(value), name).toBe(INITIAL_SESSION)
    }
  })

  test('optional debate fields may be left out', () => {
    const { agentId: _agent, verdict: _verdict, ...bare } = DEBATE
    expect(isSession(with_({ debates: [{ ...bare, status: 'sitting' }] }))).toBe(true)
  })
})

describe('the version 4 record', () => {
  const { v: _v, chatOffers: _offers, chatAllowances: _allowances, chatDenials: _denials, ...rest } = FULL
  const V4 = { ...rest, v: 4, ops: { 'shell:rm build': { rounds: 2, wipes: 3 } }, latestPrompt: 'delete the build' }

  test('reads as version 5 with the chat records empty, rounds and lockouts intact', () => {
    expect(isSession(V4)).toBe(false)
    const read = sessionOf(V4)
    expect(read).toEqual({ ...V4, v: 5, chatOffers: [], chatAllowances: [], chatDenials: [] })
    expect(read.ops).toEqual({ 'shell:rm build': { rounds: 2, wipes: 3 } })
    expect(read).not.toBe(INITIAL_SESSION)
    expect(isSession(read)).toBe(true)
  })

  test('a version 4 record that is not valid otherwise reads as fresh', () => {
    expect(sessionOf({ ...V4, ops: { k: 3 } })).toBe(INITIAL_SESSION)
    expect(sessionOf({ ...V4, cache: 'abc' })).toBe(INITIAL_SESSION)
    // Chat fields that a version 4 record carries are not trusted: they start empty.
    expect(sessionOf({ ...V4, chatOffers: 'x' }).chatOffers).toEqual([])
  })
})

describe('the chat records', () => {
  const KEY_A = 'aaaaaa0123456789'
  const KEY_B = 'bbbbbb0123456789'
  const offered = (...keys: string[]): CouncilSession =>
    keys.reduce((session, callKey) => noteOffer(session, { code: callKey.slice(0, 6), callKey, canSession: callKey === KEY_A }, 0), INITIAL_SESSION)

  test('an offer takes the prompt it was made in; a stale one is dropped; a newer one for the same call replaces the older', () => {
    expect(noteOffer(INITIAL_SESSION, { code: 'aaaaaa', callKey: KEY_A, canSession: true }, 0).chatOffers).toEqual([{ code: 'aaaaaa', callKey: KEY_A, canSession: true, epoch: 0 }])
    expect(noteOffer({ ...INITIAL_SESSION, promptEpoch: 3 }, { code: 'aaaaaa', callKey: KEY_A, canSession: true }, 2)).toEqual({ ...INITIAL_SESSION, promptEpoch: 3 })
    const twice = noteOffer(offered(KEY_A, KEY_B), { code: 'aaaaaa', callKey: KEY_A, canSession: false }, 0)
    expect(twice.chatOffers.map(offer => offer.callKey)).toEqual([KEY_B, KEY_A])
    expect(twice.chatOffers[1]?.canSession).toBe(false)
  })

  test('at most twenty offers: the newest', () => {
    const many = offered(...Array.from({ length: 25 }, (_, n) => `${n.toString(16).padStart(6, '0')}0123456789`))
    expect(many.chatOffers).toHaveLength(20)
    expect(many.chatOffers[0]?.code).toBe('000005')
    expect(many.chatOffers.at(-1)?.code).toBe('000018')
  })

  test('a person\'s prompt clears offers, once-allowances and denials and keeps session allowances; another prompt keeps all but once-allowances and the cache', () => {
    const before: CouncilSession = {
      ...offered(KEY_A),
      cache: ['x'],
      chatAllowances: [{ callKey: KEY_A, scope: 'once' }, { callKey: KEY_B, scope: 'session' }],
      chatDenials: [{ callKey: 'cccccc0123456789' }],
    }
    const person = resetForPrompt(before, 'next')
    expect(person.chatOffers).toEqual([])
    expect(person.chatAllowances).toEqual([{ callKey: KEY_B, scope: 'session' }])
    expect(person.chatDenials).toEqual([])
    const other = forOtherPrompt(before)
    expect(other.cache).toEqual([])
    expect(other.chatOffers).toEqual(before.chatOffers)
    expect(other.chatAllowances).toEqual([{ callKey: KEY_B, scope: 'session' }])
    expect(other.chatDenials).toEqual(before.chatDenials)
    expect(other.promptEpoch).toBe(before.promptEpoch)
  })

  test('using a call\'s answer: a denial first and spent, a once-allowance spent, a session allowance kept', () => {
    const session: CouncilSession = {
      ...INITIAL_SESSION,
      chatAllowances: [{ callKey: KEY_A, scope: 'once' }, { callKey: KEY_B, scope: 'session' }],
      chatDenials: [{ callKey: KEY_A }],
    }
    expect(holdsChat(session, KEY_A)).toBe(true)
    expect(holdsChat(session, 'ffffff0123456789')).toBe(false)
    const denied = useChat(session, KEY_A)
    expect(denied.use).toBe('deny')
    expect(denied.session.chatDenials).toEqual([])
    expect(denied.session.chatAllowances).toHaveLength(2)
    const once = useChat(denied.session, KEY_A)
    expect(once.use).toBe('once')
    expect(once.session.chatAllowances).toEqual([{ callKey: KEY_B, scope: 'session' }])
    // Spent: the same change on the result finds nothing.
    expect(useChat(once.session, KEY_A).use).toBeUndefined()
    const kept = useChat(once.session, KEY_B)
    expect(kept.use).toBe('session')
    expect(kept.session).toBe(once.session)
    expect(useChat(INITIAL_SESSION, KEY_A)).toEqual({ session: INITIAL_SESSION, use: undefined })
  })

  test('answering: only this prompt\'s offers, a shared code is unknown, a session grant needs canSession', () => {
    const session: CouncilSession = { ...offered(KEY_A, KEY_B), chatOffers: [...offered(KEY_A, KEY_B).chatOffers, { code: 'eeeeee', callKey: 'eeeeee0000000001', canSession: true, epoch: 0 }, { code: 'eeeeee', callKey: 'eeeeee0000000002', canSession: true, epoch: 0 }, { code: 'ffffff', callKey: 'ffffff0000000001', canSession: true, epoch: 7 }] }
    const answered = answerChat(session, [
      { kind: 'allow', code: 'aaaaaa', scope: 'once' },
      { kind: 'allow', code: 'bbbbbb', scope: 'session' },
      { kind: 'deny', code: 'bbbbbb', scope: 'once' },
      { kind: 'allow', code: 'eeeeee', scope: 'once' },
      { kind: 'allow', code: 'ffffff', scope: 'once' },
      { kind: 'allow', code: '000000', scope: 'once' },
      { kind: 'malformed' },
    ])
    expect(answered.grants).toEqual([
      { kind: 'allow', callKey: KEY_A, scope: 'once' },
      { kind: 'deny', callKey: KEY_B },
    ])
    expect(answered.acks).toHaveLength(7)
    expect(answered.acks[0]).toContain('The council will let that exact call run once')
    expect(answered.acks[1]).toContain('can only be allowed once')
    expect(answered.acks[2]).toContain('they refuse that call')
    for (const unknown of answered.acks.slice(3, 6)) expect(unknown).toContain('no call refused since their previous message has that code')
    expect(answered.acks[6]).toContain('without a valid six-character code')
  })

  test('granting: a later command for the same call wins, an allowance and a denial replace each other, fifty of each at most', () => {
    const allowed = grantChat(INITIAL_SESSION, [{ kind: 'allow', callKey: KEY_A, scope: 'once' }, { kind: 'allow', callKey: KEY_A, scope: 'session' }])
    expect(allowed.chatAllowances).toEqual([{ callKey: KEY_A, scope: 'session' }])
    const denied = grantChat(allowed, [{ kind: 'deny', callKey: KEY_A }])
    expect(denied.chatAllowances).toEqual([])
    expect(denied.chatDenials).toEqual([{ callKey: KEY_A }])
    const back = grantChat(denied, [{ kind: 'allow', callKey: KEY_A, scope: 'once' }])
    expect(back.chatDenials).toEqual([])
    expect(back.chatAllowances).toEqual([{ callKey: KEY_A, scope: 'once' }])
    const keys = Array.from({ length: 55 }, (_, n) => `${n.toString(16).padStart(6, '0')}0123456789`)
    const many = grantChat(grantChat(INITIAL_SESSION, keys.map(callKey => ({ kind: 'allow', callKey, scope: 'once' }) as const)), keys.map(callKey => ({ kind: 'deny', callKey }) as const))
    expect(many.chatDenials).toHaveLength(50)
    expect(many.chatDenials[0]?.callKey).toBe(keys[5])
    expect(grantChat(INITIAL_SESSION, keys.map(callKey => ({ kind: 'allow', callKey, scope: 'session' }) as const)).chatAllowances).toHaveLength(50)
  })
})
