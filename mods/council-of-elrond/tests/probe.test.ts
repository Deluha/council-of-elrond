import { describe, expect, test } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'

import { cap, capped, probeLine } from '../hooks/probe.js'
import { ALLOW_ONCE, auditLines, council, denyOf, FAKE_GITHUB_TOKEN, ROOT, settled, world } from './fixtures.js'
import type { World } from './fixtures.js'

/**
 * The C3 probe (ROADMAP C3, a branch that is never merged): with no surface the
 * ask is attempted, and what the maintainer needs to see is logged.
 */

const PROBE = `${ROOT}/council-c3-probe.jsonl`
const SUDO = { tool: 'Bash', command: 'sudo -n true' } as const

const probeLines = async (w: World): Promise<Record<string, unknown>[]> => {
  await settled(w)
  return (w.files.get(PROBE) ?? '')
    .split('\n')
    .filter(line => line !== '')
    .map(line => JSON.parse(line) as Record<string, unknown>)
}

const eventsOf = (lines: readonly Record<string, unknown>[]): unknown[] => lines.map(line => line.event)

/** The person pressing Esc, as in robustness.test.ts: a plugin above answers after five seconds and the engine aborts beneath it. */
const ESC: Plugin = {
  name: 'esc',
  tier: 'prepend',
  register(on) {
    on('tool.call', async ($, e, next) => {
      if (e.tool === 'AskUserQuestion') return next(e)
      void next(e).catch(() => undefined)
      await $.clock.sleep(5_000)
      return { deny: 'Interrupted.' }
    })
  },
}

describe('the log format', () => {
  test('one JSON object, no newline; elapsedMs only with a start; cap marks a cut', () => {
    const line = probeLine(3, 'x', 1_000, { a: 1 })
    expect(line).not.toContain('\n')
    expect(JSON.parse(line)).toEqual({ probe: 'c3', seq: 3, event: 'x', at: '1970-01-01T00:00:01.000Z', a: 1 })
    expect(JSON.parse(probeLine(4, 'y', 1_500, {}, 1_000))).toMatchObject({ elapsedMs: 500 })
    expect(cap('abcdef', 3)).toBe('abc…')
    expect(cap('abc', 3)).toBe('abc')
    // A cut never comes before the redaction: half a token would escape every pattern.
    const long = JSON.parse(probeLine(5, 'z', 0, { a: capped(`${'x'.repeat(160)} ${FAKE_GITHUB_TOKEN}`, 200) })) as { a: string }
    expect(long.a).not.toContain('ghp_')
    expect(long.a).toContain('[REDACTED GitHub token]')
  })
})

describe('the ask with no surface', () => {
  test('1. an answer is honoured: allow once runs the call, and start then answered are logged', async ($, on) => {
    const w = world(on, { surfaces: [], askWithoutSurface: true, answer: ALLOW_ONCE })
    expect(await $.tool.call(SUDO)).toEqual({ result: 'ran' })
    expect(w.ran).toHaveLength(1)
    const lines = await probeLines(w)
    expect(eventsOf(lines.filter(line => String(line.event).startsWith('ask.')))).toEqual(['ask.start', 'ask.answered'])
    const asks = lines.filter(line => String(line.event).startsWith('ask.'))
    expect(asks[0]).toMatchObject({ probe: 'c3', surfaces: [], questionLength: expect.any(Number), options: expect.any(Array), header: expect.any(String) })
    expect(asks[1]).toMatchObject({ answer: ALLOW_ONCE, interpreted: { kind: 'allow-once' }, elapsedMs: expect.any(Number) })
    // The question's text is never logged.
    expect(w.files.get(PROBE)).not.toContain('sudo')
    // Every line also went to the debug log, tagged.
    expect(w.probeLogs.length).toBeGreaterThanOrEqual(2)
    expect(w.logs.some(entry => entry.startsWith('council-c3-probe '))).toBe(false)
  })

  test('2. a rejected ask is the nobody-to-ask refusal: the call does not run, and start then rejected are logged', async ($, on) => {
    const w = world(on, { surfaces: [] })
    const deny = denyOf(await $.tool.call(SUDO))
    expect(deny).toContain('The call needs the user, and nobody can be asked in this session. A rule sends this call straight to you.')
    expect(deny).toContain('Decided by: the user (not allowed).')
    expect(w.ran).toEqual([])
    expect(w.asked).toEqual([])
    expect((await auditLines(w))[0]).toMatchObject({ tier: 'ask', ruleId: 'privileged', decision: 'unavailable', outcome: 'refused' })
    const asks = (await probeLines(w)).filter(line => String(line.event).startsWith('ask.'))
    expect(eventsOf(asks)).toEqual(['ask.start', 'ask.rejected'])
    expect(String(asks[1]?.message)).toContain('no tool named "AskUserQuestion"')
    expect(asks[1]).toHaveProperty('elapsedMs')
  })

  test('3. with a surface the call runs as before and no ask line is written', async ($, on) => {
    const w = world(on, { surfaces: ['terminal'], answer: ALLOW_ONCE })
    expect(await $.tool.call(SUDO)).toEqual({ result: 'ran' })
    // The gate's own question first; the rule offer after the run is a second one.
    expect(w.asked[0]?.options).toContain(ALLOW_ONCE)
    const lines = await probeLines(w)
    expect(lines.filter(line => String(line.event).startsWith('ask.'))).toEqual([])
  })

  test('5. an ask that never answers is ended by Esc, and the abort is logged', { plugins: [ESC] }, async ($, on) => {
    const w = world(on, { surfaces: [], askWithoutSurface: true, answer: 'hang', isClockMocked: true })
    const pending = $.tool.call(SUDO)
    await w.clock?.settle()
    await w.clock?.advance(5_000)
    expect(denyOf(await pending)).toBe('Interrupted.')
    await w.clock?.settle()
    expect(w.ran).toEqual([])
    const events = eventsOf(await probeLines(w))
    expect(events).toContain('ask.start')
    expect(events).toContain('ask.aborted')
  })
})

describe('origin and roster', () => {
  test('4. a prompt and a command each write their origin, never their text', async ($, on) => {
    const w = world(on)
    on('prompt.submit', ($$, e) => ({ text: e.text }))
    await $.prompt.submit({ text: 'SECRET-PROMPT-TEXT', wait: false, origin: { kind: 'composer' } } as never)
    await council($, 'status', { kind: 'sdk' })
    const lines = await probeLines(w)
    expect(lines.find(line => line.event === 'prompt.submit')).toMatchObject({ origin: { kind: 'composer' }, isMeta: false, command: null, textLength: 'SECRET-PROMPT-TEXT'.length })
    expect(lines.find(line => line.event === 'command.run')).toMatchObject({ origin: { kind: 'sdk' }, args: 'status', presentation: { isFullscreen: false, columns: 80 } })
    expect(w.files.get(PROBE)).not.toContain('SECRET-PROMPT-TEXT')
  })

  test('a secret in a command or a prompt\'s command is in neither the probe file nor the debug log', async ($, on) => {
    const w = world(on, { surfaces: [] })
    on('prompt.submit', ($$, e) => ({ text: e.text }))
    await council($, `test "echo ${FAKE_GITHUB_TOKEN}"`)
    await $.prompt.submit({
      text: `/review ${FAKE_GITHUB_TOKEN}`,
      command: { name: 'review', args: `--token ${FAKE_GITHUB_TOKEN}` },
      wait: false,
      origin: { kind: 'composer' },
    } as never)
    // A denied call's error text (`.catch` message) and an answer are strings too.
    await settled(w)
    const file = w.files.get(PROBE) ?? ''
    expect(file).toContain('"event":"command.run"')
    expect(file).toContain('"event":"prompt.submit"')
    expect(file).toContain('[REDACTED GitHub token]')
    for (const [where, shown] of [['file', file], ['debug log', w.probeLogs.join('\n')]] as const) {
      expect(shown, where).not.toContain(FAKE_GITHUB_TOKEN)
      expect(shown, where).not.toContain('ghp_')
    }
    for (const line of file.split('\n').filter(entry => entry !== '')) expect(() => JSON.parse(line)).not.toThrow()
    expect((await probeLines(w)).find(line => line.event === 'prompt.submit')).toMatchObject({ command: { name: 'review' } })
  })

  test('session start, attach and detach write the roster', async ($, on) => {
    const w = world(on, { surfaces: ['mobile'] })
    on('session.start', ($$, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    await $.session.attach({ surface: 'mobile', clientId: 'mobile:default' } as never)
    await $.session.detach({ surface: 'mobile', clientId: 'mobile:default', reason: 'detach' } as never)
    const lines = await probeLines(w)
    expect(lines.find(line => line.event === 'session.start')).toMatchObject({ surfaces: ['mobile'], surface: 'terminal', isInteractive: true })
    expect(lines.find(line => line.event === 'session.attach')).toMatchObject({ surfaces: ['mobile'], surface: 'mobile' })
    expect(lines.find(line => line.event === 'session.detach')).toMatchObject({ surfaces: ['mobile'], surface: 'mobile', reason: 'detach' })
  })
})
