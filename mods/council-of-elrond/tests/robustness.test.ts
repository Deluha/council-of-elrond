import { describe, expect, test } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'

import { INITIAL_SESSION } from '../hooks/state.js'
import type { CouncilSession } from '../types'
import {
  ALLOWLIST,
  APPROVE,
  auditLines,
  BLOCK,
  council,
  denyOf,
  KEEP_BLOCKED,
  ROOT,
  watchState,
  world,
} from './fixtures.js'

/**
 * H2, pipeline robustness (DESIGN §13.4): what the pipeline does when its inputs
 * are stale, malformed, interrupted or late, and when its own writes fail.
 */

const AUDIT = `${ROOT}/.claude/council-of-elrond/audit/audit.jsonl`
const RULES = `${ROOT}/.claude/council-of-elrond/rules.json`
const PUSH = { tool: 'Bash', command: 'git push origin feature' } as const
const REVIEWED = { tool: 'Bash', command: 'rm -rf build' } as const
const KEY = 'shell:rm build'

const lastOf = (written: readonly unknown[]): CouncilSession => written.at(-1) as CouncilSession

const withChecks = (w: { files: Map<string, string> }, commands: readonly { name: string; argv: string[]; timeoutMs?: number }[]): void => {
  w.files.set(RULES, JSON.stringify({ schemaVersion: 1, gimli: { commands } }))
}

/**
 * The person pressing Esc, as far as the kit can make it: a plugin above the
 * mod answers after five seconds without waiting for the mod, and the engine
 * aborts the dispatch beneath it (`next.signal`). Its own answer is what the
 * call returns; the test reads what the mod did meanwhile.
 */
const ESC: Plugin = {
  name: 'esc',
  tier: 'prepend',
  register(on) {
    on('tool.call', async ($, e, next) => {
      void next(e).catch(() => undefined)
      await $.clock.sleep(5_000)
      return { deny: 'Interrupted.' }
    })
  },
}

describe('one state snapshot per call (DESIGN §13.4 f)', () => {
  const LOCKED: CouncilSession = { ...INITIAL_SESSION, ops: { [KEY]: { rounds: 0, wipes: 3 } } }
  const SPENT: CouncilSession = { ...INITIAL_SESSION, tokensSpent: 1_500 }

  test('failed attempts that land after the first read still lock the call out', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    const state = watchState(on)
    // Read 1 is the call's snapshot, clean; read 2 is the one the lockout is decided on.
    state.readAs = n => (n === 2 ? LOCKED : undefined)
    const deny = denyOf(await $.tool.call(REVIEWED))
    expect(deny).toContain('Decided by: the council (locked out).')
    expect(w.modelRequests).toEqual([])
    expect(w.asked).toEqual([])
    expect(w.ran).toEqual([])
  })

  test('tokens spent by reviews that finished after the first read stop the next single review', { options: { tokenBudget: 1_500 } }, async ($, on) => {
    const w = world(on, { replies: [APPROVE], answer: KEEP_BLOCKED })
    const state = watchState(on)
    // Reads 1 and 2 are the snapshot and the lockout check; read 3 is the budget's.
    state.readAs = n => (n === 3 ? SPENT : undefined)
    expect(denyOf(await $.tool.call(REVIEWED))).toContain('(keep blocked)')
    expect(w.modelRequests).toEqual([])
    expect(w.asked[0]?.question).toContain('token budget is spent')
  })

  test('and the full council', { options: { tokenBudget: 1_500 } }, async ($, on) => {
    const w = world(on, { replies: [APPROVE], answer: KEEP_BLOCKED, isClockMocked: true })
    const state = watchState(on)
    state.readAs = n => (n === 3 ? SPENT : undefined)
    expect(denyOf(await $.tool.call(PUSH))).toContain('(keep blocked)')
    expect(w.modelRequests).toEqual([])
    expect(w.asked[0]?.question).toContain('token budget is spent')
  })

  test('a quiet session is decided as before: the same reads change nothing', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    watchState(on)
    expect(await $.tool.call(REVIEWED)).toEqual({ result: 'ran' })
    expect(w.modelRequests).toHaveLength(1)
  })
})

describe('a stored session of the wrong shape (DESIGN §13.4 g)', () => {
  const MALFORMED = { ...INITIAL_SESSION, ops: null, cache: 'abc', counts: { gandalf: 3 }, debates: [null] }

  test('is read as a fresh session: the call is reviewed and decided, not denied, and the cause is logged once', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    const state = watchState(on)
    // Malformed until the mod writes: its first update replaces it.
    state.readAs = () => (state.written.length === 0 ? MALFORMED : undefined)
    expect(await $.tool.call(REVIEWED)).toEqual({ result: 'ran' })
    expect(w.modelRequests).toHaveLength(1)
    expect(auditLines(w)[0]).toMatchObject({ verdict: 'approve', outcome: 'ran' })
    expect(w.logs.filter(line => line.includes('unexpected shape'))).toHaveLength(1)
    // Healed by the mod's own write: the next call says nothing.
    expect(lastOf(state.written).ops).toEqual({})
    await $.tool.call(REVIEWED)
    expect(w.logs.filter(line => line.includes('unexpected shape'))).toHaveLength(1)
  })

  test('a blocked call is still blocked', async ($, on) => {
    const w = world(on, { replies: [BLOCK] })
    const state = watchState(on)
    state.readAs = () => (state.written.length === 0 ? MALFORMED : undefined)
    expect(denyOf(await $.tool.call(REVIEWED))).toContain('(block)')
    expect(w.ran).toEqual([])
  })

  test('a session nobody has written yet is not malformed', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    await $.tool.call(REVIEWED)
    expect(w.logs.filter(line => line.includes('unexpected shape'))).toEqual([])
  })
})

describe('a failure after the call ran (the .catch replay)', () => {
  test('the real result is returned and the call is not run again', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    const state = watchState(on)
    // Everything up to the tool is fine; counting the success then fails.
    state.refuseWrite = () => w.ran.length > 0
    expect(await $.tool.call(REVIEWED)).toEqual({ result: 'ran' })
    expect(w.ran).toHaveLength(1)
    expect(auditLines(w)[0]).toMatchObject({ verdict: 'approve', outcome: 'ran' })
  })

  test('while one before it refuses', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    const state = watchState(on)
    state.refuseWrite = () => w.ran.length === 0
    expect(denyOf(await $.tool.call(REVIEWED))).toContain('fails closed')
    expect(w.ran).toEqual([])
  })
})

describe('a prompt sent while a review is in flight (DESIGN §10.9)', () => {
  const submit = ($: unknown, text: string) =>
    ($ as { prompt: { submit: (e: unknown) => Promise<unknown> } }).prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

  test('a round and a failed attempt are not written into the new prompt', async ($, on) => {
    const w = world(on, { replies: [BLOCK], isClockMocked: true })
    const state = watchState(on)
    on('prompt.submit', ($$, e) => ({ text: e.text }))
    w.modelDelays = [10_000]
    const pending = $.tool.call(REVIEWED)
    await w.clock?.settle()
    await submit($, 'a new request')
    await w.clock?.advance(10_000)
    expect(denyOf(await pending)).toContain('(block)')
    const after = lastOf(state.written)
    expect(after.latestPrompt).toBe('a new request')
    expect(after.ops).toEqual({})
    expect(after.verbWipes).toEqual({})
    // The old prompt's refusal is still in the log.
    expect(auditLines(w)[0]).toMatchObject({ verdict: 'block', outcome: 'refused' })
  })

  test('an approve is not cached into it', async ($, on) => {
    const w = world(on, { replies: [APPROVE], isClockMocked: true })
    const state = watchState(on)
    on('prompt.submit', ($$, e) => ({ text: e.text }))
    w.modelDelays = [10_000]
    const pending = $.tool.call(REVIEWED)
    await w.clock?.settle()
    await submit($, 'a new request')
    await w.clock?.advance(10_000)
    expect(await pending).toEqual({ result: 'ran' })
    expect(lastOf(state.written).cache).toEqual([])
    // The identical call in the new prompt is reviewed afresh.
    expect(await $.tool.call(REVIEWED)).toEqual({ result: 'ran' })
    expect(w.modelRequests).toHaveLength(2)
  })
})

describe('Esc during a review (DESIGN §10.9)', () => {
  test('mid-review: no dialog, no round, no failed attempt; audited as refused, the debate closed aborted', { plugins: [ESC] }, async ($, on) => {
    const w = world(on, { replies: [APPROVE], isClockMocked: true, answer: KEEP_BLOCKED })
    const state = watchState(on)
    w.modelDelays = [60_000]
    const pending = $.tool.call(REVIEWED)
    await w.clock?.settle()
    await w.clock?.advance(5_000)
    expect(denyOf(await pending)).toBe('Interrupted.')
    await w.clock?.settle()
    expect(w.asked).toEqual([])
    expect(w.ran).toEqual([])
    expect(auditLines(w)).toHaveLength(1)
    expect(auditLines(w)[0]).toMatchObject({ tier: 'review', member: 'gandalf', verdict: 'aborted', decision: null, outcome: 'refused', tokens: 0 })
    const after = lastOf(state.written)
    expect(after.ops).toEqual({})
    expect(after.verbWipes).toEqual({})
    expect(after.counts).toEqual({})
    expect(after.tokensSpent).toBe(0)
    expect(after.debates).toMatchObject([{ id: expect.any(String), status: 'done', verdict: 'aborted' }])
  })

  test('mid-council: the same, and the running check is ended', { plugins: [ESC] }, async ($, on) => {
    const w = world(on, { replies: [APPROVE], isClockMocked: true, answer: KEEP_BLOCKED })
    const state = watchState(on)
    withChecks(w, [{ name: 'tests', argv: ['npm', 'test'] }])
    w.spawnReply = () => ({ hang: true })
    w.modelDelays = [60_000, 60_000, 60_000]
    const pending = $.tool.call(PUSH)
    await w.clock?.settle()
    await w.clock?.advance(5_000)
    expect(denyOf(await pending)).toBe('Interrupted.')
    await w.clock?.advance(1_000)
    expect(w.asked).toEqual([])
    expect(w.ran).toEqual([])
    expect(w.ended).toBe(1)
    expect(auditLines(w)).toHaveLength(1)
    expect(auditLines(w)[0]).toMatchObject({ member: 'council', verdict: 'aborted', decision: null, outcome: 'refused', tokens: 0 })
    const after = lastOf(state.written)
    expect(after.ops).toEqual({})
    expect(after.verbWipes).toEqual({})
    expect(after.counts).toEqual({})
    expect(after.debates).toMatchObject([{ status: 'done', verdict: 'aborted', checks: [{ name: 'tests', status: 'stopped' }] }])
  })
})

describe('the checks do not outlive the council (DESIGN §13.4 b)', () => {
  test('a council that throws ends the check it started, not at its own timeout', { options: { councilSequential: true } }, async ($, on) => {
    const w = world(on, { replies: [APPROVE], isClockMocked: true })
    withChecks(w, [{ name: 'tests', argv: ['npm', 'test'] }])
    w.spawnReply = () => ({ hang: true })
    w.modelDelays = [1_000]
    // The first member answers; the clock read before the second is asked fails, once.
    let isFailed = false
    w.clockFails = () => {
      if (w.modelRequests.length !== 1 || isFailed) return false
      isFailed = true
      return true
    }
    const pending = $.tool.call({ ...PUSH })
    await w.clock?.settle()
    await w.clock?.advance(1_000)
    expect(denyOf(await pending)).toContain('fails closed')
    expect(isFailed).toBe(true)
    // Two seconds in; the check's own timeout is two minutes away.
    await w.clock?.advance(1_000)
    expect(w.ended).toBe(1)
    expect(w.ran).toEqual([])
  })

  test('without a throw, a passing check ends by itself and nothing is stopped', async ($, on) => {
    const w = world(on, { replies: [APPROVE], isClockMocked: true })
    withChecks(w, [{ name: 'tests', argv: ['npm', 'test'] }])
    expect(await $.tool.call(PUSH)).toEqual({ result: 'ran' })
    expect(w.ended).toBe(0)
    expect(auditLines(w)[0]?.council).toMatchObject({ checks: [{ name: 'tests', status: 'passed' }] })
  })
})

describe('a failed allowlist write (DESIGN §13.4 h)', () => {
  const CALL = { tool: 'Write', file_path: `${ROOT}/src/db.ts`, content: 'const password = "hunter2xyz"' } as const

  test('keeps the call blocked, says why, and is not a failed attempt: it can be asked again and again', async ($, on) => {
    const w = world(on, { answer: KEEP_BLOCKED })
    w.writeFails = path => path === RULES
    for (let attempt = 1; attempt <= 4; attempt++) {
      w.answers.push(ALLOWLIST, 'Add it')
      const deny = denyOf(await $.tool.call(CALL))
      expect(deny, `attempt ${attempt}`).toContain('(keep blocked)')
      expect(deny, `attempt ${attempt}`).not.toContain('locked out')
    }
    // Every attempt reached the dialog and its confirm: none was locked out.
    expect(w.asked).toHaveLength(8)
    expect(w.logs.filter(line => line.includes('was not written'))).toHaveLength(4)
    expect(w.files.has(RULES)).toBe(false)
    expect(w.ran).toEqual([])
    expect(auditLines(w)[0]).toMatchObject({ decision: 'keep-blocked', outcome: 'refused' })
  })

  test('cancelling the confirm is still a failed attempt: the fourth is locked out', async ($, on) => {
    const w = world(on, { answer: KEEP_BLOCKED })
    for (let attempt = 1; attempt <= 3; attempt++) {
      w.answers.push(ALLOWLIST, 'Cancel')
      expect(denyOf(await $.tool.call(CALL))).toContain('(keep blocked)')
    }
    expect(denyOf(await $.tool.call(CALL))).toContain('locked out')
  })
})

describe('the audit log (DESIGN §13.4 c, d)', () => {
  test('a failed write is logged to debug and changes no decision', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    w.writeFails = path => path.endsWith('audit.jsonl')
    expect(await $.tool.call(REVIEWED)).toEqual({ result: 'ran' })
    expect(w.ran).toHaveLength(1)
    expect(w.logs.filter(line => line.startsWith('Council: audit write failed:') && line.includes('EIO'))).toHaveLength(1)
    // The queue goes on: a later line is attempted too.
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build/out' })
    expect(w.logs.filter(line => line.startsWith('Council: audit write failed'))).toHaveLength(2)
  })

  test('multibyte text rotates by bytes: .1 moves to .2 first, twice over', { options: { auditMaxKb: 16 } }, async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    // 8,101 characters but 16,201 bytes: with the line, over 16 KB in bytes, under it in characters.
    const first = `${'é'.repeat(8_100)}\n`
    const second = `${'ü'.repeat(8_100)}\n`
    expect(first.length + 600).toBeLessThan(16 * 1024)
    w.files.set(AUDIT, first)
    w.files.set(`${AUDIT}.1`, 'oldest\n')
    await $.tool.call(REVIEWED)
    expect(w.files.get(`${AUDIT}.2`)).toBe('oldest\n')
    expect(w.files.get(`${AUDIT}.1`) === first).toBe(true)
    expect(auditLines(w)).toHaveLength(1)

    w.files.set(AUDIT, second)
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build/out' })
    expect(w.files.get(`${AUDIT}.2`) === first).toBe(true)
    expect(w.files.get(`${AUDIT}.1`) === second).toBe(true)
    expect(auditLines(w)).toHaveLength(1)
  })
})

describe('the clock (DESIGN §13.4 i)', () => {
  test('times in the log come from $.clock.now: the mocked clock sets the line, the latency and the review time', async ($, on) => {
    const w = world(on, { replies: [APPROVE], isClockMocked: true })
    w.modelDelays = [3_000]
    const pending = $.tool.call(REVIEWED)
    await w.clock?.settle()
    await w.clock?.advance(3_000)
    await pending
    expect(auditLines(w)[0]).toMatchObject({ ts: '1970-01-01T00:00:03.000Z', latencyMs: 3_000, reviewMs: 3_000 })
  })
})

describe('/council reload (DESIGN §13.4 m)', () => {
  test('clears the approve cache: an approved call is reviewed again afterwards', async ($, on) => {
    const w = world(on, { replies: [APPROVE], surfaces: [] })
    await $.tool.call(REVIEWED)
    await $.tool.call(REVIEWED)
    expect(w.modelRequests).toHaveLength(1)
    await council($, 'reload')
    expect(w.logs.join('\n')).toContain('Rules reloaded')
    await $.tool.call(REVIEWED)
    expect(w.modelRequests).toHaveLength(2)
  })
})
