import { describe, expect, test } from 'claude-code/testing'

import { fingerprintText } from '../hooks/audit.js'
import {
  ALLOW_ONCE,
  APPROVE,
  auditLines,
  BLOCK,
  denyOf,
  FAKE_AWS_KEY,
  FAKE_GITHUB_TOKEN,
  KEEP_BLOCKED,
  REVISE,
  ROOT,
  settled,
  TALK_FIRST,
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
    expect(await auditLines(w)).toEqual([])
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
    const [line] = await auditLines(w)
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
    expect((await auditLines(w))[0]).toMatchObject({ tier: 'review', member: 'gandalf', model: 'sonnet', verdict: 'approve', outcome: 'ran', tokens: 1000 })
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
    expect((await auditLines(w))[0]).toMatchObject({ verdict: 'block', outcome: 'refused' })
  })

  test('file writes, subagent calls and MCP calls are reviewed the same way', async ($, on) => {
    const w = world(on, { replies: [BLOCK] })
    expectRefusal(await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/new.ts`, content: 'x' }))
    expectRefusal(await $.tool.call({ tool: 'Bash', command: 'rm -rf build', agentId: 'agent-1' } as never))
    expectRefusal(await $.tool.call({ tool: 'mcp__github__merge_pull_request', number: 7 } as never))
    expect(w.modelRequests).toHaveLength(3)
    expect((await auditLines(w))[1]).toMatchObject({ agentId: 'agent-1' })
  })

  test("the user's latest prompt and session scripts reach the reviewer, redacted", async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    on('prompt.submit', ($$, e) => ({ text: e.text }))
    await $.prompt.submit({ text: `deploy with token ${FAKE_GITHUB_TOKEN}`, wait: false, origin: { kind: 'composer' } })
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/deploy.sh`, content: 'rm -rf build\n' })
    w.files.set(`${ROOT}/deploy.sh`, 'rm -rf build\n')
    await $.tool.call({ tool: 'Bash', command: 'bash deploy.sh' })
    const prompt = String(w.modelRequests[1]?.prompt)
    expect(prompt).toContain('Script it runs, written in this session (/work/deploy.sh)')
    expect(prompt).toContain('rm -rf build')
    expect(JSON.stringify(w.modelRequests)).not.toContain(FAKE_GITHUB_TOKEN)
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
    expect((await auditLines(w))[0]).toMatchObject({ verdict: 'failed', decision: 'allow-once', outcome: 'ran' })
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
    expect(w.asked[0]).toMatchObject({ options: [ALLOW_ONCE, KEEP_BLOCKED, TALK_FIRST], header: 'Loot roll' })
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
    expect((await auditLines(w))[0]).toMatchObject({ tier: 'ask', decision: 'dismissed', outcome: 'refused' })
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
    expect(await auditLines(w)).toHaveLength(1)
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

  test('a project model choice reaches the request', { options: { trustProjectRules: 'always' } }, async ($, on) => {
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
    const w = world(on, { replies: [verdict('block', `Writes key ${FAKE_AWS_KEY} to disk.`, 'Use the vault.')] })
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/keys.ts`, content: `const k = "${FAKE_AWS_KEY}" // FILE BODY` })
    await settled(w)
    const raw = w.files.get(`${ROOT}/.claude/council-of-elrond/audit/audit.jsonl`) ?? ''
    const [line] = await auditLines(w)
    for (const field of ['ts', 'tool', 'fingerprint', 'opKey', 'tier', 'member', 'profile', 'verdict', 'reason', 'shadow', 'decision', 'latencyMs', 'tokens']) {
      expect(line, field).toHaveProperty(field)
    }
    expect(raw).not.toContain('FILE BODY')
    expect(raw).not.toContain(FAKE_AWS_KEY)
    expect(w.files.get(`${ROOT}/.claude/council-of-elrond/audit/.gitignore`)).toContain('*')
  })

  test('the same call reformatted has a different fingerprint, and an identical one the same', async ($, on) => {
    const w = world(on, { replies: [BLOCK] })
    await $.tool.call({ tool: 'Bash', command: 'rm  -rf   build' })
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    const [a, b, c] = await auditLines(w)
    expect(a?.fingerprint).not.toBe(b?.fingerprint)
    expect(b?.fingerprint).toBe(c?.fingerprint)
  })

  test('a file write reindented is a different fingerprint, so it is not cached unreviewed', () => {
    const a = fingerprintText('Write', { file_path: '/work/x.yml', content: 'a:\n  b: 1\n' })
    const b = fingerprintText('Write', { file_path: '/work/x.yml', content: 'a:\n    b: 1\n' })
    expect(a).not.toBe(b)
    // A shell command is hashed exactly too: its spacing is not collapsed.
    expect(fingerprintText('Bash', { command: 'rm  -rf build' })).not.toBe(fingerprintText('Bash', { command: 'rm -rf build' }))
  })

  test('rotates by size', { options: { auditMaxKb: 16 } }, async ($, on) => {
    const w = world(on)
    for (let i = 0; i < 70; i++) await $.tool.call({ tool: 'Bash', command: `rm -rf /tmp/x${i}` })
    await settled(w)
    const path = `${ROOT}/.claude/council-of-elrond/audit/audit.jsonl`
    expect(w.files.has(`${path}.1`)).toBe(true)
    expect((w.files.get(path) ?? '').length).toBeLessThanOrEqual(16 * 1024)
  })
})

describe('a force push of the current branch (DESIGN §15)', () => {
  const SUB = `${ROOT}/sub`
  /** The git the mod runs for the branch: `rev-parse` answers with `branch`, or fails the way `how` says. */
  const checkedOut = (w: ReturnType<typeof world>, branch: string, how: 'ok' | 'fails' | 'times-out' = 'ok') => {
    w.processReply = argv => {
      if (argv[1] !== 'rev-parse') return { exitCode: 0, stdout: '' }
      if (how === 'times-out') return 'timeout'
      return how === 'fails' ? { exitCode: 128, stdout: '' } : { exitCode: 0, stdout: `${branch}\n` }
    }
  }
  const PUSHES = ['git push --force', 'git push -f', 'git push -f origin', 'git push -f origin HEAD', 'git push origin +HEAD']

  test('with a protected branch checked out, every form is blocked by the rules: no model, no question, nothing runs', async ($, on) => {
    const w = world(on)
    checkedOut(w, 'main')
    for (const command of PUSHES) {
      const deny = expectRefusal(await $.tool.call({ tool: 'Bash', command }))
      expect(deny, command).toContain('Decided by: the rules (block).')
      expect(deny, command).toContain('Force push (or delete) of a protected branch.')
    }
    expect(w.ran).toEqual([])
    expect(w.modelRequests).toEqual([])
    expect(w.asked).toEqual([])
    const lines = await auditLines(w)
    expect(lines).toHaveLength(PUSHES.length)
    for (const line of lines) expect(line).toMatchObject({ tier: 'block', ruleId: 'force-push-protected-branch', outcome: 'refused' })
  })

  test('the branch is read once per call, where the session works, with the mod\'s git protections', async ($, on) => {
    const w = world(on)
    checkedOut(w, 'main')
    await $.tool.call({ tool: 'Bash', command: 'git push -f origin HEAD' })
    expect(w.processes).toEqual([['git', 'rev-parse', '--abbrev-ref', 'HEAD']])
    expect(w.processCwds).toEqual([ROOT])
    expect(w.processEnvs[0]).toMatchObject({ GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'false', GIT_CONFIG_KEY_1: 'log.showSignature', GIT_CONFIG_VALUE_1: 'false', GIT_TERMINAL_PROMPT: '0' })
  })

  test('with another branch checked out they are reviewed, as before', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    checkedOut(w, 'feature')
    for (const command of PUSHES) expect(await $.tool.call({ tool: 'Bash', command }), command).toEqual({ result: 'ran' })
    expect(w.ran).toHaveLength(PUSHES.length)
    expect(w.asked).toEqual([])
    expect(w.modelRequests.length).toBeGreaterThan(0)
    for (const line of await auditLines(w)) expect(line).toMatchObject({ tier: 'review', ruleId: 'git-remote-or-history' })
  })

  const unknown = async (w: ReturnType<typeof world>, call: Promise<unknown>) => {
    const deny = expectRefusal(await call)
    expect(deny).toContain('Decided by: the user (keep blocked).')
    expect(w.asked).toHaveLength(1)
    expect(w.asked[0]?.question).toContain('A rule sends this call straight to you.')
    expect(w.asked[0]?.question).toContain('Force push of the current branch, and the branch it would overwrite could not be determined.')
    expect(w.ran).toEqual([])
    expect(w.modelRequests).toEqual([])
    expect((await auditLines(w))[0]).toMatchObject({ tier: 'ask', ruleId: 'force-push-unknown-branch' })
  }

  test('git failing: the user is asked, the call is not reviewed and not run', async ($, on) => {
    const w = world(on)
    checkedOut(w, 'main', 'fails')
    await unknown(w, $.tool.call({ tool: 'Bash', command: 'git push --force' }))
  })

  test('git timing out: the user is asked', async ($, on) => {
    const w = world(on)
    checkedOut(w, 'main', 'times-out')
    await unknown(w, $.tool.call({ tool: 'Bash', command: 'git push -f origin' }))
  })

  test('a detached HEAD: the user is asked', async ($, on) => {
    const w = world(on)
    checkedOut(w, 'HEAD')
    await unknown(w, $.tool.call({ tool: 'Bash', command: 'git push -f origin HEAD' }))
  })

  test('no output from git: the user is asked', async ($, on) => {
    const w = world(on)
    checkedOut(w, '')
    await unknown(w, $.tool.call({ tool: 'Bash', command: 'git push origin +HEAD' }))
  })

  test('allow once on that question runs the call', async ($, on) => {
    const w = world(on, { answer: ALLOW_ONCE })
    checkedOut(w, 'main', 'fails')
    expect(await $.tool.call({ tool: 'Bash', command: 'git push --force' })).toEqual({ result: 'ran' })
    expect(w.ran).toEqual([{ tool: 'Bash', command: 'git push --force' }])
  })

  test('where nothing draws, an unknown branch is refused, not run', async ($, on) => {
    const w = world(on, { surfaces: [] })
    checkedOut(w, 'main', 'fails')
    expect(expectRefusal(await $.tool.call({ tool: 'Bash', command: 'git push -f' }))).toContain('nobody can be asked')
    expect(w.ran).toEqual([])
  })

  test('a call that is no force push of the current branch starts no branch lookup', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    checkedOut(w, 'main')
    for (const command of ['ls', 'git status', 'git log -n 3', 'npm test', 'echo "git push -f"', 'git commit -m "git push --force"']) {
      expect(await $.tool.call({ tool: 'Bash', command }), command).toEqual({ result: 'ran' })
    }
    expect(await $.tool.call({ tool: 'Write', file_path: `${ROOT}/notes.txt`, content: 'git push -f' })).toEqual({ result: 'ran' })
    expect(w.processes.filter(argv => argv[1] === 'rev-parse')).toEqual([])
    expect(w.processes.filter(argv => argv[1] === 'push')).toEqual([])
  })

  test('only the push\'s own preview reads the branch when it forces no current branch', async ($, on) => {
    const count = async (command: string) => {
      const w = world(on, { replies: [APPROVE] })
      checkedOut(w, 'feature')
      await $.tool.call({ tool: 'Bash', command })
      return w.processes.filter(argv => argv[1] === 'rev-parse').length
    }
    // `git push origin feature` and a forced push of a named branch: the preview's read only.
    expect(await count('git push origin feature')).toBe(1)
  })

  test('the folder a push runs in: after a cd inside the root, its branch decides', async ($, on) => {
    const w = world(on)
    w.dirs.add(SUB)
    checkedOut(w, 'main')
    expectRefusal(await $.tool.call({ tool: 'Bash', command: 'cd sub && git push -f' }))
    expect(w.processCwds).toEqual([SUB])
  })

  test('a push git would run elsewhere has an unknown branch, and no git runs', async ($, on) => {
    const w = world(on, { answer: ALLOW_ONCE })
    checkedOut(w, 'feature')
    w.dirs.add(`${ROOT}/out`)
    w.links.set(`${ROOT}/out`, '/elsewhere')
    for (const command of ['git -C /x push -f', 'GIT_DIR=/x git push -f', 'cd ../other && git push -f', 'cd $WHERE && git push -f origin HEAD', 'cd out && git push -f']) {
      expect(await $.tool.call({ tool: 'Bash', command }), command).toEqual({ result: 'ran' })
    }
    expect(w.processes).toEqual([])
    expect(w.asked.filter(asked => asked.question.includes('A rule sends this call straight to you.'))).toHaveLength(5)
    for (const line of await auditLines(w)) expect(line).toMatchObject({ tier: 'ask', ruleId: 'force-push-unknown-branch' })
  })

  test('two pushes on different branches: the protected one decides; unknown where none is protected', async ($, on) => {
    const w = world(on)
    w.dirs.add(SUB)
    let reads = 0
    w.processReply = argv => (argv[1] === 'rev-parse' ? { exitCode: 0, stdout: `${reads++ === 0 ? 'feature' : 'main'}\n` } : { exitCode: 0, stdout: '' })
    expect(denyOf(await $.tool.call({ tool: 'Bash', command: 'git push -f && cd sub && git push -f' }))).toContain('Force push (or delete) of a protected branch.')
    expect(w.processCwds).toEqual([ROOT, SUB])
    w.processReply = argv => (argv[1] === 'rev-parse' ? { exitCode: 0, stdout: `${reads++ % 2 === 0 ? 'feature' : 'topic'}\n` } : { exitCode: 0, stdout: '' })
    const deny = expectRefusal(await $.tool.call({ tool: 'Bash', command: 'git push -f origin && cd sub && git push -f origin' }))
    expect(deny).toContain('Decided by: the user (keep blocked).')
    expect((await auditLines(w))[1]).toMatchObject({ tier: 'ask', ruleId: 'force-push-unknown-branch' })
  })

  test('pushes in more than three folders are not read: unknown', async ($, on) => {
    const w = world(on)
    for (const dir of ['a', 'b', 'c', 'd']) w.dirs.add(`${ROOT}/${dir}`)
    checkedOut(w, 'main')
    const command = 'cd a && git push -f && cd ../b && git push -f && cd ../c && git push -f && cd ../d && git push -f'
    expect(expectRefusal(await $.tool.call({ tool: 'Bash', command }))).toContain('Decided by: the user (keep blocked).')
    expect(w.processes).toEqual([])
    expect((await auditLines(w))[0]).toMatchObject({ tier: 'ask', ruleId: 'force-push-unknown-branch' })
  })

  test('a push naming a protected branch is blocked with no branch read at all', async ($, on) => {
    const w = world(on)
    checkedOut(w, 'feature')
    for (const command of ['git push --force origin main', 'git push -f origin HEAD:master', 'git push origin +release/2.0']) {
      expect(denyOf(await $.tool.call({ tool: 'Bash', command })), command).toContain('(block)')
    }
    expect(w.processes).toEqual([])
  })
})
