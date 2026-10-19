import { describe, expect, test } from 'claude-code/testing'

import { count, INITIAL_SESSION, isSession, noteWritten, openDebate, sessionOf } from '../hooks/state.js'
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
const FULL: CouncilSession = openDebate(
  noteWritten(count({ ...INITIAL_SESSION, models: { gandalf: 'opus' }, reviewMs: [1200, 800], ops: { 'shell:rm build': { rounds: 1, wipes: 2 } }, verbWipes: { rm: 2 }, cache: ['abc'], declinedRules: ['k'] }, 'gandalf', 'approve'), '/work/a.ts'),
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
    for (const value of [undefined, null, 4, 'v4', [], [FULL], { ...FULL, v: 3 }, { ...FULL, v: 5 }, { ...FULL, v: '4' }]) {
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
