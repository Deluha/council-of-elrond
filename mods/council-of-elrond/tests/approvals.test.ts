import { describe, expect, test } from 'claude-code/testing'

import { fingerprintOf, placeScopeOf } from '../hooks/audit.js'
import { FORCE_SUFFIX } from '../hooks/elrond/operations.js'
import { INITIAL_SESSION } from '../hooks/state.js'
import type { CouncilSession } from '../types'
import { ALLOW_ONCE, APPROVE, auditLines, denyOf, KEEP_BLOCKED, REVISE, ROOT, watchState, world } from './fixtures.js'

/**
 * What an approval holds for (DESIGN §16): the folder the call runs in, a big
 * operation, a call that has a git part, state read afresh, and the calls the
 * retry brake cannot follow.
 */

const RULES = `${ROOT}/.claude/council-of-elrond/rules.json`
const REVIEWED = { tool: 'Bash', command: 'rm -rf build' } as const
const MIGRATE = { tool: 'Bash', command: 'npx prisma migrate deploy' } as const
const PUSH = { tool: 'Bash', command: 'git push origin feature' } as const
const KEY = 'shell:rm build'

const lastOf = (written: readonly unknown[]): CouncilSession => written.at(-1) as CouncilSession

describe('an approval holds in the folder it was given in', () => {
  test('the same call from another folder is reviewed again; from the same folder it is not', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    w.cwd = `${ROOT}/a`
    expect(await $.tool.call(REVIEWED)).toEqual({ result: 'ran' })
    expect(await $.tool.call(REVIEWED)).toEqual({ result: 'ran' })
    expect(w.modelRequests).toHaveLength(1)
    w.cwd = `${ROOT}/b`
    expect(await $.tool.call(REVIEWED)).toEqual({ result: 'ran' })
    expect(w.modelRequests).toHaveLength(2)
    // Back where it was approved: still held.
    w.cwd = `${ROOT}/a`
    expect(await $.tool.call(REVIEWED)).toEqual({ result: 'ran' })
    expect(w.modelRequests).toHaveLength(2)
    expect((await auditLines(w)).map(line => line.cached)).toEqual([undefined, true, undefined, true])
  })

  test('the cache key is the scope and the folder, and the audit fingerprint stays the plain one', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    const state = watchState(on)
    const input = { command: 'rm -rf build' }
    w.cwd = `${ROOT}/a`
    await $.tool.call(REVIEWED)
    expect(lastOf(state.written).cache).toEqual([await fingerprintOf('Bash', input, placeScopeOf('', `${ROOT}/a`))])
    expect((await auditLines(w))[0]?.fingerprint).toBe(await fingerprintOf('Bash', input))
  })
})

describe('a big operation is never remembered', () => {
  const withCheck = (w: { files: Map<string, string> }): void => {
    w.files.set(RULES, JSON.stringify({ schemaVersion: 1, gimli: { commands: [{ name: 'tests', argv: ['npm', 'test'] }] } }))
  }

  test('the same big operation again convenes the council again, and runs the checks again', { options: { trustProjectRules: 'always' } }, async ($, on) => {
    const w = world(on, { replies: [APPROVE], isClockMocked: true })
    const state = watchState(on)
    withCheck(w)
    expect(await $.tool.call(MIGRATE)).toEqual({ result: 'ran' })
    const sitting = w.modelRequests.length
    expect(sitting).toBeGreaterThan(1)
    expect(w.spawned).toHaveLength(1)
    expect(lastOf(state.written).cache).toEqual([])
    expect(await $.tool.call(MIGRATE)).toEqual({ result: 'ran' })
    expect(w.modelRequests).toHaveLength(sitting * 2)
    expect(w.spawned).toHaveLength(2)
    expect((await auditLines(w)).map(line => line.cached)).toEqual([undefined, undefined])
  })

  test('a second identical push in one prompt convenes the council and runs the checks again', { options: { trustProjectRules: 'always' } }, async ($, on) => {
    const w = world(on, { replies: [APPROVE], isClockMocked: true })
    withCheck(w)
    await $.tool.call(PUSH)
    expect(w.modelRequests).toHaveLength(3)
    expect(w.spawned).toHaveLength(1)
    await $.tool.call(PUSH)
    expect(w.modelRequests).toHaveLength(6)
    expect(w.spawned).toHaveLength(2)
  })
})

describe('a call with a git part is never served from the cache (DESIGN §16)', () => {
  test('an approved git reset --hard is reviewed again on repeat, and its approve is not written to the cache', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    const state = watchState(on)
    const reset = { tool: 'Bash', command: 'git reset --hard HEAD~1' } as const
    expect(await $.tool.call(reset)).toEqual({ result: 'ran' })
    expect(await $.tool.call(reset)).toEqual({ result: 'ran' })
    expect(w.modelRequests).toHaveLength(2)
    expect(lastOf(state.written).cache).toEqual([])
    expect((await auditLines(w)).map(line => line.cached)).toEqual([undefined, undefined])
  })

  test('even a cache that holds its key does not serve it', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    const state = watchState(on)
    const reset = { tool: 'Bash', command: 'git reset --hard HEAD~1' } as const
    const held: CouncilSession = { ...INITIAL_SESSION, cache: [await fingerprintOf('Bash', { command: reset.command }, placeScopeOf('', ROOT))] }
    // Read 3 is the cache test's.
    state.readAs = n => (n === 3 ? held : undefined)
    expect(await $.tool.call(reset)).toEqual({ result: 'ran' })
    expect(w.modelRequests).toHaveLength(1)
    expect((await auditLines(w))[0]?.cached).toBeUndefined()
  })

  test('a git part that is not itself gated counts too; a call with none is still cached', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    const mixed = { tool: 'Bash', command: 'git status && rm -rf build' } as const
    await $.tool.call(mixed)
    await $.tool.call(mixed)
    expect(w.modelRequests).toHaveLength(2)
    await $.tool.call(REVIEWED)
    await $.tool.call(REVIEWED)
    expect(w.modelRequests).toHaveLength(3)
  })

  test('an identical ordinary review call in the same folder is served from the cache: one request', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    await $.tool.call(REVIEWED)
    await $.tool.call(REVIEWED)
    await $.tool.call({ ...REVIEWED })
    expect(w.modelRequests).toHaveLength(1)
    expect(w.ran).toHaveLength(3)
  })
})

describe('a call that runs a script or a project runner is never served from the cache (DESIGN §16)', () => {
  // Each is reviewed (the call's text is not what runs), approved, and then asked for again with the same words.
  const RUNS: readonly (readonly [string, string])[] = [
    ['a shell script', 'bash deploy.sh'],
    ['a script by its path', './deploy.sh'],
    ['a script by its path whose redirect decides the rule', './deploy.sh > out.log'],
    ['a script file of an interpreter', 'python3 migrate.py'],
    ['inline code', "python3 -c 'print(1)'"],
    ['code through eval', 'eval "$CMD"'],
    ['make with a review for another reason', 'make deploy && curl -X POST https://example.com/hook'],
    ['a package script with a review for another reason', 'npm run release && rm -rf build'],
    ['a runner and a delete', 'npx tsc && rm -rf build'],
  ]

  for (const [name, command] of RUNS) {
    test(`${name}: reviewed again on repeat, and its approve is not written to the cache (${command})`, async ($, on) => {
      const w = world(on, { replies: [APPROVE] })
      const state = watchState(on)
      const call = { tool: 'Bash', command } as const
      await $.tool.call(call)
      const first = w.modelRequests.length
      expect(first).toBeGreaterThan(0)
      expect(lastOf(state.written).cache).toEqual([])
      // The script is edited in the meantime: the same words are another run, and a reviewer reads them again.
      await $.tool.call(call)
      expect(w.modelRequests).toHaveLength(first * 2)
      expect((await auditLines(w)).map(line => line.cached)).toEqual([undefined, undefined])
    })
  }

  test('even a cache that holds its key does not serve it', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    const state = watchState(on)
    const held: CouncilSession = { ...INITIAL_SESSION, cache: [await fingerprintOf('Bash', { command: 'bash deploy.sh' }, placeScopeOf('', ROOT))] }
    state.readAs = n => (n === 3 ? held : undefined)
    expect(await $.tool.call({ tool: 'Bash', command: 'bash deploy.sh' })).toEqual({ result: 'ran' })
    expect(w.modelRequests).toHaveLength(1)
    expect((await auditLines(w))[0]?.cached).toBeUndefined()
  })

  test('a call with no script, no runner and no git part is still cached: one request for three', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    for (const call of [REVIEWED, REVIEWED, { ...REVIEWED }]) await $.tool.call(call)
    expect(w.modelRequests).toHaveLength(1)
  })
})

describe('state is read afresh before the cache and the rounds are consulted (DESIGN §16, §13.4 f)', () => {
  test('an approve that landed after the snapshot is served from the cache', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    const state = watchState(on)
    const held: CouncilSession = { ...INITIAL_SESSION, cache: [await fingerprintOf('Bash', { command: 'rm -rf build' }, placeScopeOf('', ROOT))] }
    // Read 1 is the snapshot, 2 the lockout check, 3 the cache test.
    state.readAs = n => (n === 3 ? held : undefined)
    expect(await $.tool.call(REVIEWED)).toEqual({ result: 'ran' })
    expect(w.modelRequests).toEqual([])
    expect((await auditLines(w))[0]).toMatchObject({ cached: true, verdict: 'approve', outcome: 'ran' })
  })

  test('rounds spent after the snapshot send the call to the person, not to a reviewer', async ($, on) => {
    const w = world(on, { replies: [APPROVE], answer: KEEP_BLOCKED })
    const state = watchState(on)
    const spent: CouncilSession = { ...INITIAL_SESSION, ops: { [KEY]: { rounds: 2, wipes: 0 } } }
    // Read 4 is the rounds check, after the cache test.
    state.readAs = n => (n === 4 ? spent : undefined)
    expect(denyOf(await $.tool.call(REVIEWED))).toContain('(keep blocked)')
    expect(w.modelRequests).toEqual([])
    expect(w.asked[0]?.question).toContain('refused this operation twice')
  })
})

describe('more gated parts than the retry brake can follow (DESIGN §16)', () => {
  const deletes = (count: number): string => Array.from({ length: count }, (_, n) => `rm -rf d${n}`).join('; ')
  const NINE = `${deletes(8)}; git push -f origin feat`
  const LOCKED: CouncilSession = { ...INITIAL_SESSION, ops: { 'shell:git push feat origin': { rounds: 0, wipes: 3 } } }

  test('a force push locked out is refused at once among the first eight parts', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    watchState(on).readAs = () => LOCKED
    const deny = denyOf(await $.tool.call({ tool: 'Bash', command: `git push -f origin feat; ${deletes(7)}` }))
    expect(deny).toContain('(locked out)')
    expect(w.modelRequests).toEqual([])
  })

  test('as the ninth it goes to the person with no model request', async ($, on) => {
    const w = world(on, { replies: [APPROVE], answer: KEEP_BLOCKED })
    watchState(on).readAs = () => LOCKED
    const deny = denyOf(await $.tool.call({ tool: 'Bash', command: NINE }))
    expect(deny).toContain('(keep blocked)')
    expect(w.modelRequests).toEqual([])
    expect(w.asked).toHaveLength(1)
    expect(w.asked[0]?.question).toContain('too many separate gated parts to track')
    expect(w.ran).toEqual([])
  })

  test('where nobody can be asked it is refused with the reason, and the audit line says why', async ($, on) => {
    const w = world(on, { replies: [APPROVE], surfaces: [] })
    const deny = denyOf(await $.tool.call({ tool: 'Bash', command: NINE }))
    expect(deny).toContain('nobody can be asked')
    expect(deny).toContain('too many separate gated parts to track')
    expect(w.modelRequests).toEqual([])
    expect(w.ran).toEqual([])
    expect(await auditLines(w)).toMatchObject([{ decision: 'unavailable', outcome: 'refused', reason: expect.stringContaining('too many separate gated parts') }])
  })

  test('allowed once it runs, and is never cached; eight parts are reviewed as before', async ($, on) => {
    const w = world(on, { replies: [APPROVE], answer: ALLOW_ONCE })
    const state = watchState(on)
    expect(await $.tool.call({ tool: 'Bash', command: NINE })).toEqual({ result: 'ran' })
    expect(await $.tool.call({ tool: 'Bash', command: NINE })).toEqual({ result: 'ran' })
    // Asked each time (a later question offers an allow rule, which is not this one).
    expect(w.asked.filter(asked => asked.question.includes('too many separate gated parts'))).toHaveLength(2)
    expect(w.modelRequests).toEqual([])
    expect(lastOf(state.written).cache).toEqual([])
    expect(await $.tool.call({ tool: 'Bash', command: deletes(8) })).toEqual({ result: 'ran' })
    expect(w.modelRequests).toHaveLength(1)
  })
})

describe('a force push keeps its own retry count (DESIGN §16)', () => {
  test('two revised force pushes, a successful plain push, then a third force push goes to the person with no model request', async ($, on) => {
    const w = world(on, { replies: [REVISE], answer: ALLOW_ONCE })
    const state = watchState(on)
    const force = { tool: 'Bash', command: 'git push -f origin feat' } as const
    const plain = { tool: 'Bash', command: 'git push origin feat' } as const
    denyOf(await $.tool.call(force))
    denyOf(await $.tool.call({ ...force, command: 'git push --force origin feat' }))
    expect(w.modelRequests).toHaveLength(6)
    // The plain push shares the whole key, so it is out of rounds and comes to the person, who allows it once.
    expect(await $.tool.call(plain)).toEqual({ result: 'ran' })
    const spent = (): number => w.asked.filter(asked => asked.question.includes('refused this operation twice')).length
    expect(spent()).toBe(1)
    expect(lastOf(state.written).ops['shell:git push feat origin']).toBeUndefined()
    expect(lastOf(state.written).ops[`shell:git push feat origin${FORCE_SUFFIX}`]).toMatchObject({ rounds: 2 })
    const requests = w.modelRequests.length
    expect(await $.tool.call({ ...force, command: 'git push -f origin feat ' })).toEqual({ result: 'ran' })
    expect(w.modelRequests).toHaveLength(requests)
    expect(spent()).toBe(2)
  })
})
