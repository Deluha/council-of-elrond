import { describe, expect, test } from 'claude-code/testing'

import { fingerprintText } from '../hooks/audit.js'
import {
  ALLOW_ONCE,
  APPROVE,
  auditLines,
  BLOCK,
  denyOf,
  KEEP_BLOCKED,
  REVISE,
  ROOT,
  USAGE,
  verdict,
  world,
} from './fixtures.js'

const REFUSAL_FIELDS = [/^Decided by: .+ \(.+\)\.$/m, /^Reason: .+/m, /^Safer alternative: .+/m, /Do not retry the same call unchanged\./]

const expectRefusal = (result: unknown) => {
  const deny = denyOf(result)
  expect(deny).not.toBe('')
  for (const field of REFUSAL_FIELDS) expect(deny).toMatch(field)
  return deny
}

describe('allow', () => {
  test('passes untouched: no model, no question, no audit line', async ($, on) => {
    const w = world(on)
    const result = await $.tool.call({ tool: 'Bash', command: 'git status', description: 'Show status' })
    expect(result).toEqual({ result: 'ran' })
    expect(w.ran).toEqual([{ tool: 'Bash', command: 'git status', description: 'Show status' }])
    expect(w.modelRequests).toEqual([])
    expect(w.asked).toEqual([])
    expect(auditLines(w)).toEqual([])
  })

  test('the mod adds no permission decision of its own', async ($, on) => {
    world(on)
    on('tool.check', () => ({ decision: 'ask' }))
    expect(await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' } })).toEqual({ decision: 'ask' })
  })
})

describe('block', () => {
  test('refuses with the rule reason, asks no model, and logs it', async ($, on) => {
    const w = world(on)
    const result = await $.tool.call({ tool: 'Bash', command: 'rm -rf /' })
    const deny = expectRefusal(result)
    expect(deny).toContain('Decided by: the rules (block).')
    expect(deny).toContain('Recursive delete of the filesystem root')
    expect(w.ran).toEqual([])
    expect(w.modelRequests).toEqual([])
    const [line] = auditLines(w)
    expect(line).toMatchObject({ tool: 'Bash', tier: 'block', ruleId: 'rm-recursive-outside-repo', outcome: 'refused' })
  })
})

describe('review by Gandalf', () => {
  test('approve: the call goes through next with its arguments unchanged', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    const call = { tool: 'Bash', command: 'rm -rf build', description: 'Clean the build' } as const
    expect(await $.tool.call(call)).toEqual({ result: 'ran' })
    expect(w.ran).toEqual([call])
    expect(w.modelRequests).toHaveLength(1)
    expect(w.modelRequests[0]).toMatchObject({ model: 'sonnet', maxTokens: 2000, effort: 'low', timeoutMs: 30000 })
    expect(auditLines(w)[0]).toMatchObject({ tier: 'review', member: 'gandalf', model: 'sonnet', verdict: 'approve', outcome: 'ran', tokens: 1000 })
  })

  test('revise: refused with the requested change', async ($, on) => {
    const w = world(on, { replies: [REVISE] })
    const deny = expectRefusal(await $.tool.call({ tool: 'Bash', command: 'rm -rf build' }))
    expect(deny).toContain('Decided by: the destructive-operations reviewer (revise).')
    expect(deny).toContain('Safer alternative: Run rm -r build/out instead.')
    expect(w.ran).toEqual([])
  })

  test('block: refused with the reason and the safer alternative', async ($, on) => {
    const w = world(on, { replies: [BLOCK] })
    const deny = expectRefusal(await $.tool.call({ tool: 'Bash', command: 'rm -rf build' }))
    expect(deny).toContain('(block)')
    expect(deny).toContain('Reason: Deletes the whole build cache.')
    expect(w.ran).toEqual([])
    expect(auditLines(w)[0]).toMatchObject({ verdict: 'block', outcome: 'refused' })
  })

  test('file writes, subagent calls and MCP calls are reviewed the same way', async ($, on) => {
    const w = world(on, { replies: [BLOCK] })
    expectRefusal(await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/new.ts`, content: 'x' }))
    expectRefusal(await $.tool.call({ tool: 'Bash', command: 'rm -rf build', agentId: 'agent-1' } as never))
    expectRefusal(await $.tool.call({ tool: 'mcp__github__merge_pull_request', number: 7 } as never))
    expect(w.modelRequests).toHaveLength(3)
    expect(auditLines(w)[1]).toMatchObject({ agentId: 'agent-1' })
  })

  test("the user's latest prompt and session scripts reach the reviewer, redacted", async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    on('prompt.submit', ($$, e) => ({ text: e.text }))
    await $.prompt.submit({ text: 'deploy with token ghp_abcdefghijklmnopqrstuvwxyz0123456789', wait: false, origin: { kind: 'composer' } })
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/deploy.sh`, content: 'rm -rf build\n' })
    w.files.set(`${ROOT}/deploy.sh`, 'rm -rf build\n')
    await $.tool.call({ tool: 'Bash', command: 'bash deploy.sh' })
    const prompt = String(w.modelRequests[1]?.prompt)
    expect(prompt).toContain('Script it runs, written in this session (/work/deploy.sh)')
    expect(prompt).toContain('rm -rf build')
    expect(JSON.stringify(w.modelRequests)).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789')
  })
})

describe('fail closed', () => {
  const failures = [
    ['an API error', { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE }],
    ['a timeout', { isAnswered: false, reason: 'aborted', usage: USAGE }],
    ['an empty reply', { isAnswered: false, reason: 'empty-reply', usage: USAGE }],
    ['a malformed verdict', { isAnswered: true, text: 'I think it is fine', usage: USAGE }],
    ['a refused request', 'refuse-request'],
  ] as const

  for (const [name, reply] of failures) {
    test(`${name} escalates, and keep blocked refuses`, async ($, on) => {
      const w = world(on, { replies: [reply as never], answer: KEEP_BLOCKED })
      const deny = expectRefusal(await $.tool.call({ tool: 'Bash', command: 'rm -rf build' }))
      expect(w.asked).toHaveLength(1)
      expect(w.asked[0]?.question).toContain('no verdict')
      expect(deny).toContain('Decided by: the user (keep blocked).')
      expect(w.ran).toEqual([])
    })
  }

  test('a failed review the user allows once runs', async ($, on) => {
    const w = world(on, { replies: [{ isAnswered: false, reason: 'aborted', usage: USAGE }], answer: ALLOW_ONCE })
    expect(await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })).toEqual({ result: 'ran' })
    expect(w.ran).toHaveLength(1)
    expect(auditLines(w)[0]).toMatchObject({ verdict: 'failed', decision: 'allow-once', outcome: 'ran' })
  })

  test('once the token budget is spent, reviews go to the user', { options: { tokenBudget: 1500 } }, async ($, on) => {
    const w = world(on, { replies: [BLOCK], answer: KEEP_BLOCKED })
    for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: `rm -rf build/${i}` })
    expect(w.modelRequests).toHaveLength(2)
    expect(w.asked).toHaveLength(1)
    expect(w.asked[0]?.question).toContain('token budget is spent')
  })

  test('with Gandalf switched off, review calls go to the user', { options: { gandalfEnabled: false } }, async ($, on) => {
    const w = world(on, { answer: KEEP_BLOCKED })
    expectRefusal(await $.tool.call({ tool: 'Bash', command: 'rm -rf build' }))
    expect(w.modelRequests).toEqual([])
    expect(w.asked[0]?.question).toContain('Its reviewer is switched off.')
    expect(await $.tool.call({ tool: 'Bash', command: 'rm -rf /' })).toMatchObject({ deny: expect.stringContaining('(block)') })
  })

  test('a budget of zero tokens sends every review to the user', { options: { tokenBudget: 0 } }, async ($, on) => {
    const w = world(on, { answer: KEEP_BLOCKED })
    expectRefusal(await $.tool.call({ tool: 'Bash', command: 'rm -rf build' }))
    expect(w.modelRequests).toEqual([])
    expect(w.asked[0]?.question).toContain('token budget is spent')
  })

  test('the hook failing before the call runs refuses it', async ($, on) => {
    const w = world(on, { cwdFails: true })
    const deny = denyOf(await $.tool.call({ tool: 'Bash', command: 'ls' }))
    expect(deny).toContain('fails closed')
    expect(w.ran).toEqual([])
  })
})

describe('escalation', () => {
  test('ask tier: allow once runs the call unchanged', async ($, on) => {
    const w = world(on, { answer: ALLOW_ONCE })
    const call = { tool: 'Bash', command: 'sudo systemctl restart nginx' } as const
    expect(await $.tool.call(call)).toEqual({ result: 'ran' })
    expect(w.ran).toEqual([call])
    expect(w.asked[0]).toMatchObject({ options: [ALLOW_ONCE, KEEP_BLOCKED], header: 'Loot roll' })
    expect(w.asked[0]?.question).toContain('A rule sends this call straight to you.')
  })

  test('typed text reaches Claude as an instruction', async ($, on) => {
    world(on, { answer: 'Restart only the worker, not nginx' })
    const deny = expectRefusal(await $.tool.call({ tool: 'Bash', command: 'sudo systemctl restart nginx' }))
    expect(deny).toContain('"Restart only the worker, not nginx". Follow it.')
  })

  test('a dismissed question refuses', async ($, on) => {
    const w = world(on, { answer: 'dismiss' })
    const deny = expectRefusal(await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/.env`, old_string: 'A=1', new_string: 'A=2' }))
    expect(deny).toContain('dismissed')
    expect(auditLines(w)[0]).toMatchObject({ tier: 'ask', decision: 'dismissed', outcome: 'refused' })
  })

  test('where nothing draws, nobody is asked and the call is refused', async ($, on) => {
    const w = world(on, { surfaces: [] })
    const deny = expectRefusal(await $.tool.call({ tool: 'Bash', command: 'sudo ls' }))
    expect(deny).toContain('nobody can be asked')
    expect(w.asked).toEqual([])
    expect(w.ran).toEqual([])
  })

  test("the mod's own question does not re-enter the gate", async ($, on) => {
    const w = world(on, { answer: ALLOW_ONCE })
    await $.tool.call({ tool: 'Bash', command: 'sudo ls' })
    // The escalation, then the allow-rule offer: neither is gated itself.
    expect(w.asked).toHaveLength(2)
    expect(w.asked[1]?.options).toEqual(['Add the rule', 'Not now'])
    expect(auditLines(w)).toHaveLength(1)
  })
})

describe('config', () => {
  test('a broken overrides file warns and the shipped rules still enforce', async ($, on) => {
    const w = world(on)
    w.files.set(`${ROOT}/.claude/council-of-elrond/rules.json`, '{"schemaVersion": 9}')
    const result = await $.tool.call({ tool: 'Bash', command: 'rm -rf /' })
    expect(denyOf(result)).toContain('(block)')
    expect(w.logs.join('\n')).toContain('schemaVersion: 9 is not a version this build reads')
    expect(w.toasts).toHaveLength(1)
  })

  test('a project model choice reaches the request', async ($, on) => {
    const w = world(on)
    w.files.set(`${ROOT}/.claude/council-of-elrond/rules.json`, JSON.stringify({ schemaVersion: 1, models: { gandalf: 'fable' } }))
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    expect(w.modelRequests[0]).toMatchObject({ model: 'fable', maxTokens: 4000, timeoutMs: 90000 })
  })

  test('the /config row beats the project file', { options: { gandalfModel: 'opus' } }, async ($, on) => {
    const w = world(on)
    w.files.set(`${ROOT}/.claude/council-of-elrond/rules.json`, JSON.stringify({ schemaVersion: 1, models: { gandalf: 'fable' } }))
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    expect(w.modelRequests[0]).toMatchObject({ model: 'opus', timeoutMs: 45000 })
  })
})

describe('audit log', () => {
  test('records every field, and never contents or secrets', async ($, on) => {
    const w = world(on, { replies: [verdict('block', 'Writes key AKIAABCDEFGHIJKLMNOP to disk.', 'Use the vault.')] })
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/keys.ts`, content: 'const k = "AKIAABCDEFGHIJKLMNOP" // FILE BODY' })
    const raw = w.files.get(`${ROOT}/.claude/council-of-elrond/audit/audit.jsonl`) ?? ''
    const [line] = auditLines(w)
    for (const field of ['ts', 'tool', 'fingerprint', 'opKey', 'tier', 'member', 'profile', 'verdict', 'reason', 'shadow', 'decision', 'latencyMs', 'tokens']) {
      expect(line, field).toHaveProperty(field)
    }
    expect(raw).not.toContain('FILE BODY')
    expect(raw).not.toContain('AKIAABCDEFGHIJKLMNOP')
    expect(w.files.get(`${ROOT}/.claude/council-of-elrond/audit/.gitignore`)).toContain('*')
  })

  test('the same call reformatted has the same fingerprint', async ($, on) => {
    const w = world(on, { replies: [BLOCK] })
    await $.tool.call({ tool: 'Bash', command: 'rm  -rf   build' })
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    const [a, b] = auditLines(w)
    expect(a?.fingerprint).toBe(b?.fingerprint)
  })

  test('a file write reindented is a different fingerprint, so it is not cached unreviewed', () => {
    const a = fingerprintText('Write', { file_path: '/work/x.yml', content: 'a:\n  b: 1\n' })
    const b = fingerprintText('Write', { file_path: '/work/x.yml', content: 'a:\n    b: 1\n' })
    expect(a).not.toBe(b)
    // A shell command's insignificant spacing still collapses to one fingerprint.
    expect(fingerprintText('Bash', { command: 'rm  -rf build' })).toBe(fingerprintText('Bash', { command: 'rm -rf build' }))
  })

  test('rotates by size', { options: { auditMaxKb: 16 } }, async ($, on) => {
    const w = world(on)
    for (let i = 0; i < 70; i++) await $.tool.call({ tool: 'Bash', command: `rm -rf /tmp/x${i}` })
    const path = `${ROOT}/.claude/council-of-elrond/audit/audit.jsonl`
    expect(w.files.has(`${path}.1`)).toBe(true)
    expect((w.files.get(path) ?? '').length).toBeLessThanOrEqual(16 * 1024)
  })
})
