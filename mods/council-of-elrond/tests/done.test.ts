import { describe, expect, test } from 'claude-code/testing'

import { ALLOW_ONCE, APPROVE, auditLines, denyOf, KEEP_BLOCKED, ROOT, USAGE, world } from './fixtures.js'
import type { ModelReply, World } from './fixtures.js'

/**
 * Owner tests for two SPEC §19 bullets and the evidence for two definition-of-done
 * items (SPEC §22). They document behaviour the other files build; none changes it.
 */

const RULES = `${ROOT}/.claude/council-of-elrond/rules.json`
const AWS = 'AKIAABCDEFGHIJKLMNOP'
const PUSH = { tool: 'Bash', command: 'git push origin feature' } as const
const REVIEWED = { tool: 'Bash', command: 'rm -rf build' } as const

type Command = { command: { run: (e: { command: string; args: string }) => Promise<unknown> } }
const council = ($: unknown, args = ''): Promise<unknown> => ($ as Command).command.run({ command: 'council', args })

const FAILURES = [
  ['an API error', { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE }],
  ['a timeout', { isAnswered: false, reason: 'aborted', usage: USAGE }],
  ['an empty reply', { isAnswered: false, reason: 'empty-reply', usage: USAGE }],
  ['a malformed verdict', { isAnswered: true, text: 'I think it is fine', usage: USAGE }],
  ['a refused request', 'refuse-request'],
] as const satisfies readonly (readonly [string, ModelReply])[]

/** Every answer that is not "allow once". `chat` is the engine's "Chat about this" (the question rejects). */
const NOT_ALLOWED = [
  ['keep blocked', { answer: KEEP_BLOCKED }],
  ['dismissed', { answer: 'dismiss' }],
  ['Chat about this', { answer: 'chat' }],
  ['a typed instruction', { answer: 'Use rm -r build/out instead' }],
  ['nobody to ask', { surfaces: [] as string[] }],
] as const

const rulesWith = (w: World, overrides: Record<string, unknown>): void => {
  w.files.set(RULES, JSON.stringify({ schemaVersion: 1, ...overrides }))
}

describe('fallback where nothing draws', () => {
  test('fallback where nothing draws: nobody is asked, a reviewed call is decided as before, and no pane opens', async ($, on) => {
    const w = world(on, { surfaces: [], replies: [APPROVE] })
    const deny = denyOf(await $.tool.call({ tool: 'Bash', command: 'sudo ls' }))
    expect(deny).toContain('nobody can be asked')
    expect(w.asked).toEqual([])
    expect(w.ran).toEqual([])
    // The decision does not depend on a surface: the reviewer approves, the call runs.
    expect(await $.tool.call(REVIEWED)).toEqual({ result: 'ran' })
    expect(w.ran).toEqual([REVIEWED])
    expect(w.asked).toEqual([])
    expect(w.opens).toEqual([])
    expect(w.panes).toEqual([])
  })

  test('fallback where nothing draws: /council logs its lines, returns no text for Claude, and opens no pane', async ($, on) => {
    const w = world(on, { surfaces: [] })
    const result = (await council($)) as { text?: string; context?: unknown }
    expect(result.text).toBeUndefined()
    expect(result.context).toBeUndefined()
    expect(w.logs.join('\n')).toContain('Mode: enforcing')
    expect(w.opens).toEqual([])
    expect(w.panes).toEqual([])
  })

  test('fallback where nothing draws: /council debate logs the rows, returns no text for Claude, and opens no pane', async ($, on) => {
    const w = world(on, { surfaces: [], replies: [APPROVE] })
    await $.tool.call(REVIEWED)
    const result = (await council($, 'debate')) as { text?: string; context?: unknown }
    expect(result.text).toBeUndefined()
    expect(result.context).toBeUndefined()
    expect(w.logs.slice(0, 2)).toEqual(['The debate', 'Bash: rm -rf build'])
    expect(w.opens).toEqual([])
    expect(w.panes).toEqual([])
  })
})

describe("no re-entry from the mod's own calls", () => {
  // A project rule that blocks AskUserQuestion: were the mod's own $.ui.ask gated, it would be refused.
  const blockAsking = { rules: [{ id: 'block-ask', tier: 'block', tools: ['AskUserQuestion'], reason: 'test' }] }

  test("no re-entry from the mod's own calls: its questions never reach the gate", async ($, on) => {
    const w = world(on, { answer: ALLOW_ONCE })
    rulesWith(w, blockAsking)
    const call = { tool: 'Bash', command: 'sudo ls' } as const
    // The block rule is live: the same tool, called by a caller, is refused.
    expect(denyOf(await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never))).toContain('test')
    expect(await $.tool.call(call)).toEqual({ result: 'ran' })
    expect(w.ran).toEqual([call])
    // The escalation, then the allow-rule offer: both asked, neither gated.
    expect(w.asked).toHaveLength(2)
    expect(w.asked[1]?.options).toEqual(['Add the rule', 'Not now'])
    // Only the control call above is gated; the mod's two questions left no line.
    expect(auditLines(w).filter(line => line.tool === 'AskUserQuestion')).toHaveLength(1)
    expect(auditLines(w).filter(line => line.tool === 'Bash')).toHaveLength(1)
  })

  test("no re-entry from the mod's own calls: its previews and model requests never reach the gate", async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    rulesWith(w, blockAsking)
    expect(await $.tool.call(PUSH)).toEqual({ result: 'ran' })
    expect(w.ran).toEqual([PUSH])
    expect(w.processes.length).toBeGreaterThan(0)
    expect(w.modelRequests.length).toBeGreaterThan(0)
    expect(auditLines(w).filter(line => line.tool === 'Bash')).toHaveLength(1)
    expect(auditLines(w).filter(line => line.tool !== 'Bash')).toEqual([])
  })

  test("no re-entry from the mod's own calls: its project checks and writes never reach the gate", async ($, on) => {
    const w = world(on, { replies: [APPROVE], isClockMocked: true })
    rulesWith(w, { ...blockAsking, gimli: { commands: [{ name: 'tests', argv: ['npm', 'test'] }] } })
    expect(await $.tool.call(PUSH)).toEqual({ result: 'ran' })
    expect(w.spawned).toEqual([['npm', 'test']])
    // Neither the check's argv nor anything else of the mod's reached the tool.
    expect(w.ran).toEqual([PUSH])
    // The audit log is written by the mod ($.fs.write): not a gated call, and one line for the push.
    expect(w.files.has(`${ROOT}/.claude/council-of-elrond/audit/audit.jsonl`)).toBe(true)
    expect(auditLines(w)).toHaveLength(1)
  })
})

describe('in enforcing mode, a reviewer failure never runs a gated call without your answer', () => {
  for (const [failure, reply] of FAILURES) {
    for (const [name, setup] of NOT_ALLOWED) {
      test(`${failure}, then ${name}: refused, nothing ran`, async ($, on) => {
        const w = world(on, { replies: [reply], ...setup })
        const deny = denyOf(await $.tool.call(REVIEWED))
        expect(deny).not.toBe('')
        expect(w.ran).toEqual([])
        expect(auditLines(w)[0]).toMatchObject({ outcome: 'refused' })
      })
    }
  }

  test('a failed review, then only allow once: the call runs (positive control)', async ($, on) => {
    const w = world(on, { replies: [{ isAnswered: false, reason: 'aborted', usage: USAGE }], answer: ALLOW_ONCE })
    expect(await $.tool.call(REVIEWED)).toEqual({ result: 'ran' })
    expect(w.ran).toEqual([REVIEWED])
  })

  for (const [failure, reply] of FAILURES) {
    for (const [name, setup] of NOT_ALLOWED) {
      test(`the full council, every member failing (${failure}), then ${name}: refused, nothing ran`, async ($, on) => {
        const w = world(on, { replies: [reply], isClockMocked: true, ...setup })
        const deny = denyOf(await $.tool.call(PUSH))
        expect(deny).not.toBe('')
        expect(w.ran).toEqual([])
      })
    }
  }

  test('the full council blocked only for want of verdicts, then only allow once: the call runs (positive control)', async ($, on) => {
    const w = world(on, { replies: [{ isAnswered: false, reason: 'aborted', usage: USAGE }], isClockMocked: true, answer: ALLOW_ONCE })
    expect(await $.tool.call(PUSH)).toEqual({ result: 'ran' })
    expect(w.ran).toEqual([PUSH])
  })

  test('the token budget spent and nobody to ask: refused, nothing ran', { options: { tokenBudget: 0 } }, async ($, on) => {
    const w = world(on, { surfaces: [] })
    expect(denyOf(await $.tool.call(REVIEWED))).toContain('nobody can be asked')
    expect(w.modelRequests).toEqual([])
    expect(w.ran).toEqual([])
  })

  test('the reviewer switched off and nobody to ask: refused, nothing ran', { options: { gandalfEnabled: false } }, async ($, on) => {
    const w = world(on, { surfaces: [] })
    expect(denyOf(await $.tool.call(REVIEWED))).toContain('nobody can be asked')
    expect(w.modelRequests).toEqual([])
    expect(w.ran).toEqual([])
  })
})

describe('with every model member disabled, the rules, the secrets scan and escalation still work', () => {
  const off = { options: { gandalfEnabled: false, legolasEnabled: false, aragornEnabled: false } }

  test('a block-tier call is refused with the rule reason, nobody asked', off, async ($, on) => {
    const w = world(on, { answer: ALLOW_ONCE })
    const deny = denyOf(await $.tool.call({ tool: 'Bash', command: 'rm -rf /' }))
    expect(deny).toContain('Decided by: the rules (block).')
    expect(deny).toContain('Recursive delete of the filesystem root')
    expect(w.asked).toEqual([])
    expect(w.ran).toEqual([])
    expect(w.modelRequests).toEqual([])
  })

  test('an allow-tier call runs untouched', off, async ($, on) => {
    const w = world(on)
    const call = { tool: 'Bash', command: 'ls' } as const
    expect(await $.tool.call(call)).toEqual({ result: 'ran' })
    expect(w.ran).toEqual([call])
    expect(w.asked).toEqual([])
    expect(w.modelRequests).toEqual([])
  })

  const toUser: readonly (readonly [string, Record<string, unknown>])[] = [
    ['an ask-tier call', { tool: 'Bash', command: 'sudo ls' }],
    ['a protected-path call', { tool: 'Edit', file_path: `${ROOT}/.env`, old_string: 'A=1', new_string: 'A=2' }],
    ['a review-tier shell call', REVIEWED],
    ['a file edit', { tool: 'Edit', file_path: `${ROOT}/src/app.ts`, old_string: 'app = 1', new_string: 'app = 2' }],
    ['a psql call', { tool: 'Bash', command: 'psql -c "DELETE FROM t WHERE id = 1"' }],
    ['a big operation (git push)', PUSH],
  ]

  for (const [name, call] of toUser) {
    test(`${name} comes to the user: keep blocked refuses`, off, async ($, on) => {
      const w = world(on, { answer: KEEP_BLOCKED })
      const deny = denyOf(await $.tool.call(call as never))
      expect(deny).toContain('Decided by: the user (keep blocked).')
      expect(w.asked).toHaveLength(1)
      expect(w.ran).toEqual([])
      expect(w.modelRequests).toEqual([])
    })

    test(`${name} comes to the user: allow once runs`, off, async ($, on) => {
      const w = world(on, { answer: ALLOW_ONCE })
      expect(await $.tool.call(call as never)).toEqual({ result: 'ran' })
      expect(w.asked.length).toBeGreaterThanOrEqual(1)
      expect(w.ran).toEqual([call])
      expect(w.modelRequests).toEqual([])
    })
  }

  test('a high-confidence secret is refused without asking', off, async ($, on) => {
    const w = world(on, { answer: ALLOW_ONCE })
    const deny = denyOf(await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/keys.ts`, content: `export const key = "${AWS}"` }))
    expect(deny).toContain('Decided by: the secrets scan (block).')
    expect(deny).not.toContain(AWS)
    expect(w.asked).toEqual([])
    expect(w.ran).toEqual([])
    expect(w.modelRequests).toEqual([])
  })

  test('a low-confidence secret asks with a redacted snippet', off, async ($, on) => {
    const w = world(on, { answer: KEEP_BLOCKED })
    const deny = denyOf(await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/db.ts`, content: 'const password = "hunter2xyz"' }))
    expect(deny).toContain('(keep blocked)')
    expect(w.asked).toHaveLength(1)
    expect(w.asked[0]?.question).toContain('Possible secret')
    expect(w.asked[0]?.question).not.toContain('hunter2xyz')
    expect(w.ran).toEqual([])
    expect(w.modelRequests).toEqual([])
  })
})

describe('"Chat about this"', () => {
  test('"Chat about this" refuses, tells Claude to stop and ask, and is not a failed attempt', async ($, on) => {
    const w = world(on, { answer: 'chat' })
    const call = { tool: 'Bash', command: 'sudo ls' } as const
    const deny = denyOf(await $.tool.call(call))
    expect(deny).toContain('Stop and talk the call through with the user')
    expect(w.ran).toEqual([])
    expect(auditLines(w)[0]).toMatchObject({ decision: 'chat', outcome: 'refused' })
    // Unlike a dismissal, three chats in a row do not lock the operation out.
    await $.tool.call(call)
    await $.tool.call(call)
    const fourth = denyOf(await $.tool.call(call))
    expect(fourth).not.toContain('locked out')
    expect(fourth).toContain('Stop and talk the call through with the user')
    expect(w.asked).toHaveLength(4)
    expect(w.ran).toEqual([])
  })
})
