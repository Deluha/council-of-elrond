import { describe, expect, test } from 'claude-code/testing'

import { ALLOW_ONCE, APPROVE, auditLines, BLOCK, denyOf, KEEP_BLOCKED, ROOT, THEME, verdict, world } from './fixtures.js'
import type { World } from './fixtures.js'

/**
 * The debate pane, the council check band, the epic drop: mounted through
 * `$.ui.mount` on the surfaces the types say draw them, and driven by real
 * gated calls through the plugin.
 */

const PLUGIN = 'council-of-elrond'
const RULES = `${ROOT}/.claude/council-of-elrond/rules.json`
const PUSH = { tool: 'Bash', command: 'git push origin feature' } as const
const MIGRATE = { tool: 'Bash', command: 'npx prisma migrate deploy' } as const

const MALFORMED = { isAnswered: true, text: 'looks fine to me', usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } as const

type Surface = 'terminal' | 'desktop' | 'vscode' | 'mobile'
type Drawn = { findAll: (query: { type: 'Text' }) => Promise<{ text?: string }[]> }

const paneProps = (agentId?: string) =>
  ({ title: 'The debate', isFocused: false, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: agentId === undefined ? {} : { agentId } }) as never
const bandProps = (over: Record<string, unknown> = {}) =>
  ({ hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 9 }, view: {}, ...over }) as never

type Mounting = { ui: { mount: (target: never) => Promise<Drawn & { unmount: () => Promise<void> }> } }
const mountPane = ($: unknown, surface: Surface, agentId?: string) =>
  ($ as Mounting).ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'council-debate', props: paneProps(agentId) } as never)
const mountBand = ($: unknown, surface: 'terminal' | 'desktop', over: Record<string, unknown> = {}) =>
  ($ as Mounting).ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(over) } as never)

/** What a pane draws for a view on a surface, mounted and unmounted again (the engine keeps one instance per id). */
const paneLines = async ($: unknown, surface: Surface, agentId?: string): Promise<string[]> => {
  const ui = await mountPane($, surface, agentId)
  try {
    return await linesOf(ui)
  } finally {
    await ui.unmount()
  }
}

/** Every Text of a drawing, in order. */
const linesOf = async (ui: Drawn): Promise<string[]> => (await ui.findAll({ type: 'Text' })).map(found => found.text ?? '')

type Dollar = { command: { run: (e: { command: string; args?: string }) => Promise<unknown> } }
const council = ($: unknown, args = '') => ($ as Dollar).command.run({ command: 'council', args })

const withChecks = (w: World, commands: readonly { name: string; argv: string[] }[]): void => {
  w.files.set(RULES, JSON.stringify({ schemaVersion: 1, gimli: { commands } }))
}

const call = (command: string, extra: Record<string, unknown> = {}) => ({ tool: 'Bash', command, ...extra }) as never

describe('the debate pane', () => {
  test('a single review is drawn on every surface the types say draws a Pane, and a mounted drawing re-reads after a state write', async ($, on) => {
    const w = world(on, { replies: [verdict('block', 'Deletes the whole build cache.', 'Delete build/tmp only.')], answer: KEEP_BLOCKED })
    // Mounted before the call: no remount is needed for what the call writes.
    const early = await mountPane($, 'terminal')
    expect(await linesOf(early)).toContain('No reviews yet in this view.')
    expect(denyOf(await $.tool.call(call('rm -rf build', { tool_use_id: 'tu-1' })))).toContain('(block)')
    expect(await linesOf(early)).toEqual(
      expect.arrayContaining(['Bash: rm -rf build', 'Gandalf: ✗ block', '  You shall not pass.', '  Reason: Deletes the whole build cache.', '  Safer alternative: Delete build/tmp only.']),
    )
    expect(await linesOf(early)).not.toContain('No reviews yet in this view.')
    await early.unmount()
    for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
      const lines = await paneLines($, surface)
      expect(lines, surface).toContain('Gandalf: ✗ block')
      expect(lines, surface).toContain('Gandalf █ 1 block')
      expect(lines, surface).toContain('Wipes since your last prompt: 1 over 1 operations, 0 locked out')
    }
    expect(w.ran).toEqual([])
  })

  test('it draws for the agent in view only: a subagent\'s review is not the main conversation\'s', async ($, on) => {
    world(on, { replies: [APPROVE] })
    await $.tool.call(call('rm -rf build', { tool_use_id: 'tu-sub', agentId: 'sub-1' }))
    await $.tool.call(call('rm -rf dist', { tool_use_id: 'tu-main' }))
    const main = await paneLines($, 'terminal')
    const sub = await paneLines($, 'terminal', 'sub-1')
    const other = await paneLines($, 'terminal', 'sub-2')
    expect(main).toContain('Bash: rm -rf dist')
    expect(main).not.toContain('Bash: rm -rf build')
    expect(sub).toContain('Bash: rm -rf build')
    expect(sub).not.toContain('Bash: rm -rf dist')
    expect(other).toContain('No reviews yet in this view.')
    expect(other).not.toContain('Bash: rm -rf build')
  })

  test('two calls in flight each keep their own debate, keyed by tool_use_id', async ($, on) => {
    const w = world(on, { isClockMocked: true })
    w.replyFor = request => (String(request.prompt).includes('rm -rf dist') ? verdict('block', 'Wipes the dist folder.', 'Delete dist/tmp only.') : verdict('approve', 'Only the build output.'))
    w.modelDelays = [1_000, 1_000]
    w.answer = KEEP_BLOCKED
    const pane = await mountPane($, 'terminal')
    const both = Promise.all([$.tool.call(call('rm -rf build', { tool_use_id: 'tu-a' })), $.tool.call(call('rm -rf dist', { tool_use_id: 'tu-b' }))])
    await w.clock?.settle()
    const waiting = await linesOf(pane)
    expect(waiting.filter(line => line === 'Gandalf: … reviewing')).toHaveLength(2)
    await w.clock?.advance(1_000)
    const [first, second] = await both
    expect(first).toEqual({ result: 'ran' })
    expect(denyOf(second)).toContain('(block)')
    const lines = await linesOf(pane)
    const after = (proposal: string): string[] => lines.slice(lines.indexOf(proposal), lines.indexOf(proposal) + 5)
    expect(after('Bash: rm -rf build')).toEqual(expect.arrayContaining(['Gandalf: ✓ approve', '  Reason: Only the build output.']))
    expect(after('Bash: rm -rf build')).not.toContain('Gandalf: ✗ block')
    expect(after('Bash: rm -rf dist')).toEqual(expect.arrayContaining(['Gandalf: ✗ block', '  Reason: Wipes the dist folder.']))
    expect(after('Bash: rm -rf dist')).not.toContain('Gandalf: ✓ approve')
  })

  test('a full council: every member and check, then the combined verdict', async ($, on) => {
    const w = world(on, { replies: [APPROVE], isClockMocked: true, answer: KEEP_BLOCKED })
    withChecks(w, [{ name: 'tests', argv: ['npm', 'test'] }])
    w.spawnReply = () => ({ code: 1, output: 'FAIL\n' })
    w.replyFor = request => (String(request.system).includes('the commits a git push would send') ? verdict('revise', 'Unrelated files.', 'Drop them.') : undefined)
    expect(denyOf(await $.tool.call(PUSH))).toContain('"tests" failed')
    const lines = await paneLines($, 'terminal')
    expect(lines.slice(0, 6)).toEqual([
      'Bash: git push origin feature',
      'Gandalf: ✓ approve',
      '  The bridge holds. Go on.',
      '  Reason: Proportionate and requested.',
      'Legolas: ✗ revise',
      '  Something stirs in this diff. Trim it.',
    ])
    expect(lines).toEqual(expect.arrayContaining(['Aragorn (git): ✓ approve', 'Check "tests": ✗ failed', '  And my axe says no: the checks failed.', 'Verdict: block', '  The council has spoken: no.']))
  })
})

describe('opening the pane', () => {
  test('the first model review opens it unasked, once; a second review does not', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    await $.tool.call(call('rm -rf build'))
    expect(w.opens).toEqual([{ id: 'council-debate', title: 'The debate', rows: 12 }])
    expect(w.opens[0]).not.toHaveProperty('focus')
    await $.tool.call(call('rm -rf dist'))
    expect(w.opens).toHaveLength(1)
  })

  test('a call that needs no model review opens nothing', async ($, on) => {
    const w = world(on, { answer: KEEP_BLOCKED })
    await $.tool.call(call('ls'))
    await $.tool.call(call('rm -rf /'))
    await $.tool.call(call('sudo ls'))
    expect(w.opens).toEqual([])
  })

  test('a full council opens it too', async ($, on) => {
    const w = world(on, { replies: [APPROVE], isClockMocked: true })
    await $.tool.call(PUSH)
    expect(w.opens.map(open => open.id)).toEqual(['council-debate'])
  })

  test('where nothing draws it is not opened, and the review is unaffected', async ($, on) => {
    const w = world(on, { replies: [APPROVE], surfaces: [] })
    expect(await $.tool.call(call('rm -rf build'))).toEqual({ result: 'ran' })
    expect(w.opens).toEqual([])
  })

  test('a refused open is ignored and not retried', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    w.isOpenRefused = true
    expect(await $.tool.call(call('rm -rf build'))).toEqual({ result: 'ran' })
    expect(await $.tool.call(call('rm -rf dist'))).toEqual({ result: 'ran' })
    // Asked once, refused, and the flag is set all the same.
    expect(w.opens).toHaveLength(1)
    w.isOpenRefused = false
    await $.tool.call(call('rm -rf out'))
    expect(w.opens).toHaveLength(1)
  })

  test('/council debate opens it where a surface draws (it answers the person), even after the unasked open', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    await council($, 'debate')
    expect(w.opens).toEqual([{ id: 'council-debate', title: 'The debate', rows: 12 }])
    expect(w.logs).toEqual([])
    await $.tool.call(call('rm -rf build'))
    await council($, 'debate')
    expect(w.opens.map(open => open.id)).toEqual(['council-debate', 'council-debate', 'council-debate'])
    // The /council output pane is another id.
    await council($, 'rules')
    expect(w.panes.at(-1)).toBe('council')
  })

  test('/council debate with no surface, or one that places nothing, logs the rows', async ($, on) => {
    const none = world(on, { replies: [APPROVE], surfaces: [] })
    await $.tool.call(call('rm -rf build'))
    await council($, 'debate')
    expect(none.opens).toEqual([])
    expect(none.logs.slice(0, 4)).toEqual(['The debate', 'Bash: rm -rf build', 'Gandalf: ✓ approve', '  The bridge holds. Go on.'])
    expect(none.logs).toContain('Threat meter')
    none.logs.length = 0
    none.surfaces.push('terminal')
    none.isPlaced = false
    await council($, 'debate')
    expect(none.opens).toHaveLength(1)
    expect(none.logs[0]).toBe('The debate')
  })

  test('the usage line names it', async ($, on) => {
    const w = world(on, { surfaces: [] })
    await council($, 'frobnicate')
    expect(w.logs.join('\n')).toContain('report | debate]')
  })
})

describe('the council check band', () => {
  test('it passes when idle and while a survey holds the band: nothing of ours', async ($, on) => {
    world(on, { replies: [APPROVE], isBandDrawn: true, isClockMocked: true })
    for (const surface of ['terminal', 'desktop'] as const) {
      expect(await linesOf(await mountBand($, surface)), surface).toEqual(['engine band'])
      expect(await linesOf(await mountBand($, surface, { hasSurvey: true })), surface).toEqual(['engine band'])
    }
  })

  test('during a full council: a row per member and per check on terminal and desktop, a survey wins, and it passes again after', async ($, on) => {
    const w = world(on, { replies: [APPROVE], isClockMocked: true, isBandDrawn: true, answer: KEEP_BLOCKED })
    withChecks(w, [{ name: 'tests', argv: ['npm', 'test'] }])
    w.spawnReply = () => ({ hang: true })
    w.modelDelays = [1_000, 1_000, 1_000]
    const bands = [await mountBand($, 'terminal'), await mountBand($, 'desktop')]
    const survey = await mountBand($, 'terminal', { hasSurvey: true })
    const pending = $.tool.call(PUSH)
    await w.clock?.settle()
    const sitting = [
      'Ready check: Bash: git push origin feature',
      'Gandalf: … reviewing',
      'Legolas: … reviewing',
      'Aragorn (git): … reviewing',
      'Check "tests": … running',
    ]
    for (const band of bands) expect(await linesOf(band)).toEqual(sitting)
    expect(await linesOf(survey)).toEqual(['engine band'])
    // A fresh mount draws it too.
    expect(await linesOf(await mountBand($, 'desktop'))).toEqual(sitting)

    await w.clock?.advance(1_000)
    expect(await linesOf(bands[0] as Drawn)).toEqual([
      'Ready check: Bash: git push origin feature',
      'Gandalf: ✓ approve',
      'Legolas: ✓ approve',
      'Aragorn (git): ✓ approve',
      'Check "tests": … running',
    ])
    // The check outlasts the members, and runs out its own timeout.
    await w.clock?.advance(120_000)
    expect(denyOf(await pending)).toContain('"tests" did not finish within 120 s')
    for (const band of bands) expect(await linesOf(band)).toEqual(['engine band'])
  })

  test('a single-member review never draws in the band', async ($, on) => {
    const w = world(on, { replies: [APPROVE], isClockMocked: true, isBandDrawn: true })
    w.modelDelays = [1_000]
    const band = await mountBand($, 'terminal')
    const pending = $.tool.call(call('rm -rf build'))
    await w.clock?.settle()
    expect(await linesOf(band)).toEqual(['engine band'])
    await w.clock?.advance(1_000)
    await pending
    expect(await linesOf(band)).toEqual(['engine band'])
  })

  test('it draws for the main conversation only when the sitting is the main conversation\'s', async ($, on) => {
    const w = world(on, { replies: [APPROVE], isClockMocked: true, isBandDrawn: true })
    w.modelDelays = [1_000, 1_000, 1_000]
    const main = await mountBand($, 'terminal')
    const sub = await mountBand($, 'terminal', { view: { agentId: 'sub-1' } })
    const other = await mountBand($, 'terminal', { view: { agentId: 'sub-2' } })
    const pending = $.tool.call({ ...PUSH, agentId: 'sub-1', tool_use_id: 'tu-sub' } as never)
    await w.clock?.settle()
    expect(await linesOf(main)).toEqual(['engine band'])
    expect((await linesOf(sub))[0]).toBe('Ready check: Bash: git push origin feature')
    expect(await linesOf(other)).toEqual(['engine band'])
    await w.clock?.advance(1_000)
    await pending
    // The council check is gone; the epic drop belongs to the session, so any view shows it.
    expect(await linesOf(sub)).toEqual(['✦ Legendary commit acquired'])
  })
})

describe('the epic drop', () => {
  test('an approved push in the themed mode: a toast, a band row for eight seconds, and it hides itself', async ($, on) => {
    const w = world(on, { replies: [APPROVE], isClockMocked: true, isBandDrawn: true })
    const band = await mountBand($, 'terminal')
    expect(await linesOf(band)).toEqual(['engine band'])
    expect(await $.tool.call(PUSH)).toEqual({ result: 'ran' })
    expect(w.toasts.filter(toast => toast === 'Legendary commit acquired')).toHaveLength(1)
    expect(await linesOf(band)).toEqual(['✦ Legendary commit acquired'])
    expect(await linesOf(await mountBand($, 'desktop'))).toEqual(['✦ Legendary commit acquired'])

    await w.clock?.advance(7_900)
    expect(await linesOf(band)).toEqual(['✦ Legendary commit acquired'])
    // Past its time a drawing hides it, whatever the timer has done yet: a fresh mount proves it.
    await w.clock?.advance(100)
    expect(await linesOf(await mountBand($, 'terminal'))).toEqual(['engine band'])
    // The timer is only the redraw trigger.
    await w.clock?.advance(100)
    expect(await linesOf(band)).toEqual(['engine band'])
  })

  test('a call the council did not approve gets none: a failed review allowed once, a block in shadow mode', async ($, on) => {
    const w = world(on, { replies: [MALFORMED], isClockMocked: true, isBandDrawn: true, answers: [ALLOW_ONCE, 'Not now'] })
    expect(await $.tool.call(PUSH)).toEqual({ result: 'ran' })
    expect(w.toasts).not.toContain('Legendary commit acquired')
    expect(await linesOf(await mountBand($, 'terminal'))).toEqual(['engine band'])

    await council($, 'shadow on')
    w.replies = [BLOCK]
    expect(await $.tool.call({ tool: 'Bash', command: 'git push origin other' })).toEqual({ result: 'ran' })
    expect(w.toasts).not.toContain('Legendary commit acquired')
    expect(await linesOf(await mountBand($, 'terminal'))).toEqual(['engine band'])
  })

  test('a call that does not run gets none, and neither does an approved council with no push or merge', async ($, on) => {
    const w = world(on, { replies: [BLOCK], isClockMocked: true, answer: KEEP_BLOCKED })
    expect(denyOf(await $.tool.call(PUSH))).toContain('(block)')
    expect(w.toasts).not.toContain('Legendary commit acquired')
    w.replies = [APPROVE]
    expect(await $.tool.call(MIGRATE)).toEqual({ result: 'ran' })
    expect(w.toasts).not.toContain('Legendary commit acquired')
  })

  test('a push that errors gets none; a cached approve gets none', async ($, on) => {
    const w = world(on, { replies: [APPROVE], isClockMocked: true })
    w.toolResult = { result: 'remote rejected', isError: true, text: 'remote rejected' }
    await $.tool.call(PUSH)
    expect(w.toasts).not.toContain('Legendary commit acquired')
    w.toolResult = { result: 'ran' }
    await $.tool.call(PUSH)
    expect(w.toasts.filter(toast => toast === 'Legendary commit acquired')).toHaveLength(0)
  })

  test('in the plain mode there is no epic drop: no toast, no row, no state write', { options: { plainMode: true } }, async ($, on) => {
    const w = world(on, { replies: [APPROVE], isClockMocked: true, isBandDrawn: true })
    const band = await mountBand($, 'terminal')
    expect(await $.tool.call(PUSH)).toEqual({ result: 'ran' })
    expect(w.toasts).toEqual([])
    expect(await linesOf(band)).toEqual(['engine band'])
    await w.clock?.advance(10_000)
    expect(await linesOf(band)).toEqual(['engine band'])
  })
})

describe('plain mode', () => {
  test('the pane and the band hold no theme text, sitting or done', { options: { plainMode: true } }, async ($, on) => {
    const w = world(on, { replies: [BLOCK], isClockMocked: true, isBandDrawn: true, answer: KEEP_BLOCKED })
    withChecks(w, [{ name: 'tests', argv: ['npm', 'test'] }])
    w.spawnReply = () => ({ hang: true })
    w.modelDelays = [1_000, 1_000, 1_000]
    const pane = await mountPane($, 'terminal')
    const band = await mountBand($, 'terminal')
    const pending = $.tool.call(PUSH)
    await w.clock?.settle()
    const sitting = [...(await linesOf(pane)), ...(await linesOf(band))]
    expect(sitting).toContain('Full council review: Bash: git push origin feature')
    expect(sitting).toContain('the destructive-operations reviewer: … reviewing')
    await w.clock?.advance(1_000)
    // A block among the members stops the check: the council is done.
    expect(denyOf(await pending)).toContain('(block)')
    const done = [...(await linesOf(pane)), ...(await linesOf(band))]
    expect(done).toContain('Verdict: block')
    expect(done).toContain('the full council █ 1 block')
    expect(done).toContain('Refusals per reviewer')
    for (const line of [...sitting, ...done]) expect(line, line).not.toMatch(THEME)
    expect(w.opens).toEqual([{ id: 'council-debate', title: 'Council review', rows: 12 }])
  })
})

describe('a debate that cannot be written', () => {
  test('never changes a decision', async ($, on) => {
    const w = world(on, { replies: [BLOCK], answer: KEEP_BLOCKED })
    on('state.set', ($$, e, next) => (JSON.stringify(e.value ?? '').includes('"debates":[{') ? { deny: 'disk full' } : next(e)))
    const deny = denyOf(await $.tool.call(call('rm -rf build')))
    expect(deny).toContain('Decided by: the destructive-operations reviewer (block).')
    expect(w.ran).toEqual([])
    expect(auditLines(w)[0]).toMatchObject({ verdict: 'block', outcome: 'refused' })
    // Nothing was recorded, so there is nothing to draw but the empty view.
    expect(await paneLines($, 'terminal')).toContain('No reviews yet in this view.')
  })

  test('nor does it for a full council: the checks and the members go on, and the push runs', async ($, on) => {
    const w = world(on, { replies: [APPROVE], isClockMocked: true })
    withChecks(w, [{ name: 'tests', argv: ['npm', 'test'] }])
    on('state.set', ($$, e, next) => (JSON.stringify(e.value ?? '').includes('"debates":[{') ? { deny: 'disk full' } : next(e)))
    expect(await $.tool.call(PUSH)).toEqual({ result: 'ran' })
    expect(w.spawned).toEqual([['npm', 'test']])
    expect(w.modelRequests).toHaveLength(3)
    expect(auditLines(w)[0]).toMatchObject({ member: 'council', verdict: 'approve', outcome: 'ran' })
    expect(await paneLines($, 'terminal')).toContain('No reviews yet in this view.')
  })
})

describe('no approval ahead of the permission check', () => {
  test('$.tool.check resolves to exactly what the bottom hook answers, for an allow, a review and a block call', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    const answers: Record<string, { decision: 'allow' | 'ask' | 'deny'; reason?: string; rule?: string }> = {
      ls: { decision: 'allow' },
      'rm -rf build': { decision: 'ask', reason: 'the engine asks' },
      'rm -rf /': { decision: 'deny', reason: 'the engine denies', rule: 'Bash(rm:*)' },
    }
    on('tool.check', (_$, e) => answers[String((e.input as { command?: string }).command)] ?? { decision: 'deny' })
    for (const [command, answer] of Object.entries(answers)) {
      expect(await $.tool.check({ tool: 'Bash', input: { command } }), command).toEqual(answer)
    }
    // The mod took no part: no review, no question, no process.
    expect(w.modelRequests).toEqual([])
    expect(w.asked).toEqual([])
    expect(w.processes).toEqual([])
  })
})
