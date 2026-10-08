import { describe, expect, test } from 'claude-code/testing'

import { SHIPPED } from '../hooks/config/defaults.js'
import { compileConfig, loadConfig } from '../hooks/config/schema.js'
import { combine } from '../hooks/elrond/combine.js'
import type { Voice } from '../hooks/elrond/combine.js'
import { bigOperationOf, councilSeats } from '../hooks/elrond/council.js'
import type { Enabled } from '../hooks/elrond/routing.js'
import { statusOf, tailOf } from '../hooks/members/gimli.js'
import type { GimliRun } from '../hooks/members/gimli.js'
import { classify } from '../hooks/rules/classify.js'
import type { Call } from '../hooks/rules/classify.js'
import { APPROVE, auditLines, BLOCK, CONTEXT, denyOf, KEEP_BLOCKED, REVISE, ROOT, SHIPPED_COMPILED, verdict, world } from './fixtures.js'
import type { World } from './fixtures.js'

const RULES = `${ROOT}/.claude/council-of-elrond/rules.json`
const ALL: Enabled = { gandalf: true, legolas: true, aragorn: true }
const PUSH = { tool: 'Bash', command: 'git push origin feature' } as const

const bashCall = (command: string): Call => ({ tool: 'Bash', input: { command } })
const classified = (command: string, compiled = SHIPPED_COMPILED) => classify(bashCall(command), compiled, CONTEXT)
const bigOf = (command: string, currentBranch?: string, compiled = SHIPPED_COMPILED) =>
  bigOperationOf(classified(command, compiled), compiled, currentBranch !== undefined ? { currentBranch } : {})

const MALFORMED = { isAnswered: true, text: 'looks fine to me', usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } as const

const withChecks = (w: World, commands: readonly { name: string; argv: string[]; timeoutMs?: number }[]): void => {
  w.files.set(RULES, JSON.stringify({ schemaVersion: 1, gimli: { commands } }))
}

describe('big operations', () => {
  test('by default: a push, a merge into a protected branch, a migration', () => {
    expect(bigOf('git push origin feature')).toMatchObject({ entry: '/^git\\s+push(\\s|$)/' })
    expect(bigOf('npx prisma migrate deploy')).toMatchObject({ entry: 'database-migration' })
    expect(bigOf('git merge feature', 'main')).toMatchObject({ entry: 'merge-to-protected' })
    expect(bigOf('git merge feature', 'release/2.0')).toMatchObject({ entry: 'merge-to-protected' })
    expect(bigOf('gh pr merge 12 --squash')).toMatchObject({ entry: 'merge-to-protected' })
    // An unknown branch may be a protected one.
    expect(bigOf('git merge feature')).toMatchObject({ entry: 'merge-to-protected' })
  })

  test('anything else stays with one member', () => {
    expect(bigOf('git merge main', 'feature')).toBeUndefined()
    expect(bigOf('git merge --abort', 'main')).toBeUndefined()
    for (const command of ['rm -rf build', 'git rebase main', 'psql -c "DELETE FROM t WHERE id = 1"', 'ls']) expect(bigOf(command), command).toBeUndefined()
    // Only the review tier goes to the council: a blocked push is refused by the rules.
    expect(bigOf('git push --force origin main')).toBeUndefined()
  })

  test('a project adds rule ids and command regexes; bad entries are refused by field', () => {
    const loaded = loadConfig(JSON.stringify({ schemaVersion: 1, bigOperations: ['infrastructure', '/^make\\s+release/i'] }))
    expect(loaded.errors).toEqual([])
    expect(bigOf('terraform apply', undefined, loaded.compiled)).toMatchObject({ entry: 'infrastructure' })
    expect(bigOf('MAKE release', undefined, loaded.compiled)).toBeUndefined() // `make release` is not gated at all
    expect(bigOf('git push origin x', undefined, loaded.compiled)).toBeDefined() // the shipped entries stay
    expect(loadConfig(JSON.stringify({ schemaVersion: 1, bigOperations: ['nope', '/(/', '/x/g'] })).errors).toEqual([
      'bigOperations[0]: "nope" is not a rule id, a /regex/ or one of merge-to-protected',
      expect.stringContaining('bigOperations[1]: invalid regex'),
      'bigOperations[2]: invalid regex: the g and y flags are not allowed',
    ])
  })
})

describe('project checks config', () => {
  test('commands are validated by field, with a 120 s default and a 600 s ceiling', () => {
    const good = loadConfig(JSON.stringify({ schemaVersion: 1, gimli: { commands: [{ name: 'tests', argv: ['npm', 'test'] }, { name: 'lint', argv: ['npx', 'eslint', '.'], timeoutMs: 600_000 }] } }))
    expect(good.compiled.config.gimli.commands).toEqual([
      { name: 'tests', argv: ['npm', 'test'], timeoutMs: 120_000 },
      { name: 'lint', argv: ['npx', 'eslint', '.'], timeoutMs: 600_000 },
    ])
    const bad = loadConfig(
      JSON.stringify({
        schemaVersion: 1,
        gimli: { commands: [{ name: 'a', argv: ['x'] }, { name: 'b', argv: [] }, { name: 'c', argv: 'npm test' }, { name: 'd', argv: ['x'], timeoutMs: 600_001 }, { name: 'a', argv: ['y'], shell: true }] },
      }),
    )
    expect(bad.errors).toEqual([
      'gimli.commands[1].argv: a non-empty list of strings (the command and its arguments; no shell)',
      'gimli.commands[2].argv: a non-empty list of strings (the command and its arguments; no shell)',
      'gimli.commands[3].timeoutMs: a whole number of milliseconds from 1000 to 600000',
      'gimli.commands[4].shell: unknown field',
      'gimli.commands[4].name: "a" is used twice',
    ])
    // A broken file is ignored whole: no command from it runs.
    expect(bad.compiled.config.gimli.commands).toEqual([])
  })
})

describe('who sits', () => {
  test('a push: the general reviewer, the diff reviewer on what it sends, the git reviewer', () => {
    const call = bashCall('git push origin feature')
    expect(councilSeats(call, classified('git push origin feature'), ALL, { ranges: true })).toEqual([
      { member: 'gandalf' },
      { member: 'legolas', range: 'push' },
      { member: 'aragorn', profile: 'git' },
    ])
    // Without the read-only preview, nothing reads the range: the diff reviewer sits out.
    expect(councilSeats(call, classified('git push origin feature'), ALL, { ranges: false })).toEqual([{ member: 'gandalf' }, { member: 'aragorn', profile: 'git' }])
  })

  test('a migration has no diff; a push and a database call seat both profiles; switched-off members sit out', () => {
    expect(councilSeats(bashCall('npx prisma migrate deploy'), classified('npx prisma migrate deploy'), ALL, { ranges: true })).toEqual([{ member: 'gandalf' }, { member: 'aragorn', profile: 'database' }])
    const mixed = 'git push origin feature && psql -c "UPDATE t SET x = 1"'
    expect(councilSeats(bashCall(mixed), classified(mixed), ALL, { ranges: true })).toEqual([
      { member: 'gandalf' },
      { member: 'legolas', range: 'push' },
      { member: 'aragorn', profile: 'git' },
      { member: 'aragorn', profile: 'database' },
    ])
    expect(councilSeats(bashCall('git push'), classified('git push'), { gandalf: false, legolas: false, aragorn: true }, { ranges: true })).toEqual([{ member: 'aragorn', profile: 'git' }])
    expect(councilSeats(bashCall('git push'), classified('git push'), { gandalf: false, legolas: false, aragorn: false }, { ranges: true })).toEqual([])
  })
})

describe('combining verdicts', () => {
  const voice = (member: 'gandalf' | 'legolas', who: 'who.gandalf' | 'who.legolas', value: 'approve' | 'revise' | 'block', reason: string, alternative = 'Do less.'): Voice => ({
    kind: 'verdict',
    who,
    member,
    verdict: { verdict: value, reason, safer_alternative: value === 'approve' ? '' : alternative },
  })
  const git = (value: 'approve' | 'revise' | 'block', reason: string): Voice => ({ kind: 'verdict', who: 'who.aragorn.git', member: 'aragorn', profile: 'git', verdict: { verdict: value, reason, safer_alternative: value === 'approve' ? '' : 'Push to a branch.' } })
  const run = (status: GimliRun['status'], tail = ''): GimliRun => ({ name: 'tests', status, ...(status === 'failed' && { code: 1, signal: null }), tail, ms: 1000 })

  test('strictest wins, and each reason is labelled with who gave it', () => {
    expect(combine([voice('gandalf', 'who.gandalf', 'approve', 'Fine.'), git('approve', 'Fine.')], [run('passed')]).verdict).toBe('approve')
    const revised = combine([voice('gandalf', 'who.gandalf', 'approve', 'Fine.'), voice('legolas', 'who.legolas', 'revise', 'Drops a test.', 'Keep the test.')], [])
    expect(revised).toMatchObject({ verdict: 'revise', isFailureOnly: false, alternative: 'the diff reviewer (revise): Keep the test.' })
    const blocked = combine([voice('legolas', 'who.legolas', 'revise', 'Drops a test.'), git('block', 'Pushes to main.')], [])
    expect(blocked.verdict).toBe('block')
    expect(blocked.reason).toBe('\n- the diff reviewer (revise): Drops a test.\n- the git reviewer (block): Pushes to main.')
    expect(blocked.reason).not.toContain('Fine.')
  })

  test('a member without a verdict counts as its block; blocked by failures alone says so', () => {
    const failed: Voice = { kind: 'failed', who: 'who.gandalf', member: 'gandalf', problem: 'it ran out of time or was interrupted' }
    const onlyFailed = combine([failed, git('approve', 'Fine.')], [])
    expect(onlyFailed).toMatchObject({ verdict: 'block', isFailureOnly: true, reviewed: 2 })
    expect(onlyFailed.reason).toContain('the destructive-operations reviewer (block): no verdict (it ran out of time or was interrupted)')
    // With a real objection beside it, the council has decided.
    expect(combine([failed, git('revise', 'Wrong remote.')], [])).toMatchObject({ verdict: 'block', isFailureOnly: false })
    const skipped: Voice = { kind: 'skipped', who: 'who.legolas', member: 'legolas', why: 'not asked' }
    expect(combine([skipped], [])).toMatchObject({ verdict: 'approve', reviewed: 0 })
  })

  test('a failing check is a block, with its last lines; a check stopped early is not', () => {
    const combined = combine([voice('gandalf', 'who.gandalf', 'approve', 'Fine.')], [run('failed', 'FAIL src/a.test.ts\n1 failed')])
    expect(combined).toMatchObject({ verdict: 'block', isFailureOnly: false })
    expect(combined.reason).toContain('the project checks (block): "tests" failed with exit code 1. Its last lines:\nFAIL src/a.test.ts\n1 failed')
    expect(combined.alternative).toBe('Make the failing project checks ("tests") pass, then try again.')
    expect(combine([voice('gandalf', 'who.gandalf', 'approve', 'Fine.')], [run('timed-out')]).verdict).toBe('block')
    expect(combine([voice('gandalf', 'who.gandalf', 'approve', 'Fine.')], [run('error')]).verdict).toBe('block')
    expect(combine([voice('gandalf', 'who.gandalf', 'approve', 'Fine.')], [run('stopped')]).verdict).toBe('approve')
  })

  test('a check keeps the last 20 lines, and passes on exit code 0 only', () => {
    const output = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n')
    expect(tailOf(`${output}\n\n`).split('\n')).toEqual(Array.from({ length: 20 }, (_, i) => `line ${i + 30}`))
    expect(statusOf(undefined, { code: 0, signal: null })).toBe('passed')
    expect(statusOf(undefined, { code: 2, signal: null })).toBe('failed')
    expect(statusOf(undefined, { code: null, signal: 'SIGKILL' })).toBe('failed')
    expect(statusOf(undefined, undefined)).toBe('error')
    expect(statusOf('timeout', undefined)).toBe('timed-out')
  })
})

describe('the full council in the pipeline', () => {
  test('every member sits on the council model, in parallel, and approve runs the call unchanged', async ($, on) => {
    const w = world(on, { replies: [APPROVE], isClockMocked: true })
    expect(await $.tool.call(PUSH)).toEqual({ result: 'ran' })
    expect(w.ran).toEqual([PUSH])
    expect(w.modelRequests.map(request => [request.model, request.timeoutMs])).toEqual([
      ['opus', 45_000],
      ['opus', 45_000],
      ['opus', 45_000],
    ])
    const systems = w.modelRequests.map(request => String(request.system))
    expect(systems[1]).toContain('the commits a git push would send')
    expect(String(w.modelRequests[1]?.prompt)).toContain('The changes the push would send: origin/feature..HEAD')
    expect(w.processes).toContainEqual(['git', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', 'origin/feature..HEAD', '--'])
    expect(auditLines(w)[0]).toMatchObject({
      member: 'council',
      model: 'opus',
      verdict: 'approve',
      tokens: 3000,
      outcome: 'ran',
      council: {
        entry: '/^git\\s+push(\\s|$)/',
        voices: [
          { member: 'gandalf', profile: null, verdict: 'approve', tokens: 1000 },
          { member: 'legolas', profile: null, verdict: 'approve', tokens: 1000 },
          { member: 'aragorn', profile: 'git', verdict: 'approve', tokens: 1000 },
        ],
        checks: [],
      },
    })
    // An identical call approved this prompt is not reviewed again.
    await $.tool.call(PUSH)
    expect(w.modelRequests).toHaveLength(3)
  })

  test('a new branch: the diff reviewer reads the remote default branch when its range is unreadable', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    w.processReply = argv => {
      if (argv[1] !== 'diff') return { exitCode: 0, stdout: '' }
      return argv.at(-2) === 'origin/feature..HEAD' ? { exitCode: 128, stdout: '' } : { exitCode: 0, stdout: '+export const started = true\n' }
    }
    expect(await $.tool.call(PUSH)).toEqual({ result: 'ran' })
    expect(w.processes.filter(argv => argv[1] === 'diff').map(argv => argv.at(-2))).toEqual(['origin/feature..HEAD', 'origin/HEAD...HEAD'])
    const prompt = String(w.modelRequests.find(request => String(request.system).includes('the commits a git push would send'))?.prompt)
    expect(prompt).toContain('The changes the push would send: origin/HEAD...HEAD')
    expect(prompt).toContain('+export const started = true')
    expect(auditLines(w)[0]).toMatchObject({ council: { voices: [{ member: 'gandalf' }, { member: 'legolas', verdict: 'approve' }, { member: 'aragorn' }] } })
    expect(w.processes.filter(argv => argv[1] === 'push')).toEqual([])
  })

  test('when both ranges are unreadable, the diff reviewer sits out', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    w.processReply = argv => (argv[1] === 'diff' ? { exitCode: 128, stdout: '' } : { exitCode: 0, stdout: '' })
    expect(await $.tool.call(PUSH)).toEqual({ result: 'ran' })
    expect(w.processes.filter(argv => argv[1] === 'diff')).toHaveLength(2)
    expect(w.modelRequests).toHaveLength(2)
    expect(w.modelRequests.map(request => String(request.system)).join('\n')).not.toContain('the commits a git push would send')
    expect(auditLines(w)[0]).toMatchObject({ council: { voices: [{ member: 'gandalf' }, { member: 'legolas', verdict: 'skipped' }, { member: 'aragorn' }] } })
  })

  test('strictest wins: one block among approvals refuses, every objection labelled', async ($, on) => {
    const w = world(on, { replies: [APPROVE, REVISE, verdict('block', 'Sends unrelated commits.', 'Push only the fix commit.')] })
    const deny = denyOf(await $.tool.call(PUSH))
    expect(w.ran).toEqual([])
    expect(deny).toContain('Decided by: the full council (block).')
    expect(deny).toContain('- the diff reviewer (revise): Too wide.')
    expect(deny).toContain('- the git reviewer (block): Sends unrelated commits.')
    expect(deny).toContain('- the git reviewer (block): Push only the fix commit.')
    expect(deny).not.toContain('Proportionate and requested.')
    expect(deny).toContain('Review rounds left on this operation: 1.')
    expect(auditLines(w)[0]).toMatchObject({ member: 'council', verdict: 'block', outcome: 'refused' })
  })

  test('members never see each other: no verdict reaches another prompt', async ($, on) => {
    const w = world(on, { replies: [verdict('approve', 'SECRET-OPINION-ONE'), APPROVE] })
    await $.tool.call(PUSH)
    for (const request of w.modelRequests) expect(String(request.prompt) + String(request.system)).not.toContain('SECRET-OPINION-ONE')
  })

  test('one member failing blocks; with no real objection the call comes to the user', async ($, on) => {
    const w = world(on, { replies: [APPROVE, MALFORMED, APPROVE], answer: KEEP_BLOCKED })
    expect(denyOf(await $.tool.call(PUSH))).toContain('(keep blocked)')
    const question = w.asked[0]?.question ?? ''
    expect(question).toContain('members of it could not give a verdict')
    expect(question).toContain('Legolas: no verdict (malformed verdict')
    expect(question).toContain('Aragorn (git): approve.')
    expect(auditLines(w)[0]).toMatchObject({ member: 'council', verdict: 'failed', decision: 'keep-blocked' })
  })

  test('one member failing beside a real block refuses, and with nobody to ask it refuses too', async ($, on) => {
    const w = world(on, { replies: [MALFORMED, APPROVE, BLOCK], surfaces: [] })
    expect(denyOf(await $.tool.call(PUSH))).toContain('Decided by: the full council (block).')
    expect(w.asked).toEqual([])
    w.replies = [MALFORMED, APPROVE, APPROVE]
    expect(denyOf(await $.tool.call({ tool: 'Bash', command: 'git push origin other' }))).toContain('nobody can be asked')
    expect(w.ran).toEqual([])
  })

  test('switched off, a big operation goes to its one member', { options: { councilEnabled: false } }, async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    await $.tool.call(PUSH)
    expect(w.modelRequests).toHaveLength(1)
    expect(auditLines(w)[0]).toMatchObject({ member: 'aragorn', profile: 'git' })
  })

  test('a merge goes to the council only into a protected branch', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    let branch = 'main'
    w.processReply = argv => (argv[1] === 'rev-parse' ? { exitCode: 0, stdout: `${branch}\n` } : { exitCode: 0, stdout: '' })
    await $.tool.call({ tool: 'Bash', command: 'git merge feature' })
    expect(auditLines(w)[0]).toMatchObject({ member: 'council', council: { entry: 'merge-to-protected' } })
    expect(w.processes).toContainEqual(['git', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', 'HEAD...feature', '--'])
    branch = 'topic'
    await $.tool.call({ tool: 'Bash', command: 'git merge other' })
    expect(auditLines(w)[1]).toMatchObject({ member: 'aragorn', profile: 'git' })
  })

  test('in shadow mode the council logs its block and the call runs', { options: { shadowMode: true } }, async ($, on) => {
    const w = world(on, { replies: [BLOCK] })
    expect(await $.tool.call(PUSH)).toEqual({ result: 'ran' })
    expect(auditLines(w)[0]).toMatchObject({ member: 'council', verdict: 'block', shadow: true, outcome: 'ran' })
  })

  test('with every model member off, a big operation comes to the user', { options: { gandalfEnabled: false, legolasEnabled: false, aragornEnabled: false } }, async ($, on) => {
    const w = world(on, { answer: KEEP_BLOCKED })
    expect(denyOf(await $.tool.call(PUSH))).toContain('(keep blocked)')
    expect(w.modelRequests).toEqual([])
    expect(w.spawned).toEqual([])
  })
})

describe('the shared deadline', () => {
  test('in parallel every member gets the whole deadline; one slower than it counts as its block', { options: { reviewDeadlineSeconds: 10 } }, async ($, on) => {
    const w = world(on, { replies: [APPROVE], isClockMocked: true, answer: KEEP_BLOCKED })
    w.modelDelays = [1_000, 12_000, 2_000]
    const pending = $.tool.call(PUSH)
    await w.clock?.settle()
    await w.clock?.advance(12_000)
    expect(denyOf(await pending)).toContain('(keep blocked)')
    expect(w.modelRequests.map(request => request.timeoutMs)).toEqual([10_000, 10_000, 10_000])
    expect(w.asked[0]?.question).toContain('Legolas: no verdict (it ran out of time or was interrupted)')
  })

  test('one at a time, each member gets what is left of the one deadline, and the first block stops the rest', { options: { councilSequential: true } }, async ($, on) => {
    const w = world(on, { replies: [APPROVE, APPROVE, APPROVE], isClockMocked: true, answer: KEEP_BLOCKED })
    w.modelDelays = [20_000, 24_000, 0]
    const pending = $.tool.call(PUSH)
    await w.clock?.settle()
    await w.clock?.advance(20_000)
    await w.clock?.advance(24_000)
    expect(await pending).toEqual({ result: 'ran' })
    // Opus: 45 s for the whole council, not per member.
    expect(w.modelRequests.map(request => request.timeoutMs)).toEqual([45_000, 25_000, 1_000])

    w.replies = [BLOCK]
    w.modelDelays = []
    expect(denyOf(await $.tool.call({ tool: 'Bash', command: 'git push origin other' }))).toContain('the destructive-operations reviewer (block)')
    expect(w.modelRequests).toHaveLength(4)
    expect(auditLines(w)[1]?.council).toMatchObject({ voices: [{ verdict: 'block' }, { verdict: 'skipped' }, { verdict: 'skipped' }] })
  })

  test('a member asked after the deadline has passed gives no verdict, and makes no request', { options: { councilSequential: true } }, async ($, on) => {
    const w = world(on, { replies: [APPROVE], isClockMocked: true, answer: KEEP_BLOCKED })
    w.modelDelays = [44_000, 1_000]
    const pending = $.tool.call(PUSH)
    await w.clock?.settle()
    await w.clock?.advance(44_000)
    await w.clock?.advance(1_000)
    expect(denyOf(await pending)).toContain('(keep blocked)')
    expect(w.modelRequests.map(request => request.timeoutMs)).toEqual([45_000, 1_000])
    expect(w.asked[0]?.question).toContain('Legolas: no verdict')
  })
})

describe('the project checks', () => {
  test('only the configured commands run, by argv, in the project root, and only for big operations', async ($, on) => {
    const w = world(on, { replies: [APPROVE], isClockMocked: true })
    withChecks(w, [
      { name: 'tests', argv: ['npm', 'test'] },
      { name: 'lint', argv: ['npx', 'eslint', '.'] },
    ])
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    expect(w.spawned).toEqual([])
    expect(await $.tool.call({ tool: 'Bash', command: 'git push origin feature && npm run deploy' })).toEqual({ result: 'ran' })
    expect(w.spawned).toEqual([
      ['npm', 'test'],
      ['npx', 'eslint', '.'],
    ])
    // Nothing of the call is ever run by the mod: only the table's read-only git.
    for (const argv of w.processes) expect(argv[0]).toBe('git')
    expect(auditLines(w)[1]?.council).toMatchObject({ checks: [{ name: 'tests', status: 'passed' }, { name: 'lint', status: 'passed' }] })
  })

  test('a failing check blocks, with its last lines for Claude; none of its output reaches the audit log', async ($, on) => {
    const w = world(on, { replies: [APPROVE], isClockMocked: true })
    withChecks(w, [{ name: 'tests', argv: ['npm', 'test'] }])
    w.spawnReply = () => ({ code: 1, output: 'PASS a.test.ts\nFAIL b.test.ts\n  expected 2, got 3\napi_key = "hunter2hunter2"\n' })
    const deny = denyOf(await $.tool.call(PUSH))
    expect(deny).toContain('Decided by: the full council (block).')
    expect(deny).toContain('- the project checks (block): "tests" failed with exit code 1. Its last lines:\nPASS a.test.ts\nFAIL b.test.ts\n  expected 2, got 3')
    expect(deny).not.toContain('hunter2hunter2')
    expect(deny).toContain('Make the failing project checks ("tests") pass, then try again.')
    const line = JSON.stringify(auditLines(w)[0])
    expect(line).not.toContain('FAIL b.test.ts')
    expect(auditLines(w)[0]?.reason).toBe('the project checks (block): "tests" failed with exit code 1.')
    expect(auditLines(w)[0]).toMatchObject({ verdict: 'block', council: { checks: [{ name: 'tests', status: 'failed' }] } })
  })

  test('a check that cannot start blocks', async ($, on) => {
    const w = world(on, { replies: [APPROVE], isClockMocked: true })
    withChecks(w, [{ name: 'tests', argv: ['no-such-runner'] }])
    w.spawnReply = () => 'no-start'
    expect(denyOf(await $.tool.call(PUSH))).toContain('"tests" could not be started.')
  })

  test('a check past its own timeout is ended and blocks; the timeout is its own, outside the model deadline', async ($, on) => {
    const w = world(on, { replies: [APPROVE], isClockMocked: true })
    withChecks(w, [
      { name: 'tests', argv: ['npm', 'test'], timeoutMs: 90_000 },
      { name: 'lint', argv: ['npm', 'run', 'lint'] },
    ])
    w.spawnReply = argv => (argv[1] === 'test' ? { hang: true, output: 'still running\n' } : { code: 0 })
    const pending = $.tool.call(PUSH)
    await w.clock?.settle()
    await w.clock?.advance(60_000)
    // Past the 45 s model deadline, the check still runs.
    expect(w.ended).toBe(0)
    await w.clock?.advance(30_000)
    const deny = denyOf(await pending)
    expect(deny).toContain('"tests" did not finish within 90 s and was ended.')
    expect(deny).toContain('still running')
    // Leaving the loop is what ends the child.
    await w.clock?.advance(1_000)
    expect(w.ended).toBe(1)
    expect(w.ran).toEqual([])
  })

  test('a member that blocks stops a check still running: its result can no longer matter', async ($, on) => {
    const w = world(on, { replies: [BLOCK, APPROVE, APPROVE], isClockMocked: true })
    withChecks(w, [{ name: 'tests', argv: ['npm', 'test'] }])
    w.spawnReply = () => ({ hang: true })
    const deny = denyOf(await $.tool.call(PUSH))
    expect(deny).toContain('the destructive-operations reviewer (block)')
    expect(deny).not.toContain('"tests"')
    await w.clock?.advance(1_000)
    expect(w.ended).toBe(1)
    expect(auditLines(w)[0]?.council).toMatchObject({ checks: [{ name: 'tests', status: 'stopped' }] })
  })

  test('switched off, no check runs', { options: { gimliEnabled: false } }, async ($, on) => {
    const w = world(on, { replies: [APPROVE], isClockMocked: true })
    withChecks(w, [{ name: 'tests', argv: ['npm', 'test'] }])
    expect(await $.tool.call(PUSH)).toEqual({ result: 'ran' })
    expect(w.spawned).toEqual([])
  })
})

describe('commands', () => {
  const council = ($: unknown, args = ''): Promise<unknown> => ($ as { command: { run: (e: { command: string; args: string }) => Promise<unknown> } }).command.run({ command: 'council', args })

  test('/council test names the full council, its seats and checks, and runs nothing', async ($, on) => {
    const w = world(on, { surfaces: [], isClockMocked: true })
    withChecks(w, [{ name: 'tests', argv: ['npm', 'test'] }])
    await council($, 'test "git merge feature"')
    const shown = w.logs.join('\n')
    expect(shown).toContain('Reviewer: the Council of Elrond (a big operation: merge-to-protected), model opus (built-in).')
    expect(shown).toContain('Gimli would run alongside: "tests".')
    expect(shown).toContain('it assumed so')
    expect(w.processes).toEqual([])
    expect(w.spawned).toEqual([])
    expect(w.modelRequests).toEqual([])
  })

  test('/council test says when the council is off; status shows it and the checks', { options: { councilEnabled: false, councilSequential: true } }, async ($, on) => {
    const w = world(on, { surfaces: [] })
    await council($, 'test "git push origin feature"')
    expect(w.logs.join('\n')).toContain('Reviewer: Aragorn (git) [aragorn/git]')
    expect(w.logs.join('\n')).toContain('It is a big operation (/^git\\s+push(\\s|$)/), but the Council of Elrond is switched off in /config')
    w.logs.length = 0
    await council($)
    expect(w.logs.join('\n')).toContain('the Council of Elrond [council], for big operations: off, model opus (built-in), members one at a time, stopping at the first block')
    expect(w.logs.join('\n')).toContain('Gimli, for big operations: on, 0 commands configured')
  })
})

test('the shipped defaults compile', () => {
  expect(compileConfig(SHIPPED, new Set()).bigOperations.map(big => big.kind)).toEqual(['command', 'check', 'rule'])
})
