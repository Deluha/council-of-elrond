import { describe, expect, test } from 'claude-code/testing'

import { compileConfig } from '../hooks/config/schema.js'
import { SHIPPED } from '../hooks/config/defaults.js'
import { route } from '../hooks/elrond/routing.js'
import type { Enabled } from '../hooks/elrond/routing.js'
import { classify } from '../hooks/rules/classify.js'
import type { Call } from '../hooks/rules/classify.js'
import { APPROVE, auditLines, BLOCK, CONTEXT, denyOf, REVISE, ROOT, SHIPPED_COMPILED, world } from './fixtures.js'

const ALL: Enabled = { gandalf: true, legolas: true, aragorn: true }

const routeOf = (call: Call, enabled: Enabled = ALL, compiled = SHIPPED_COMPILED) => route(call, classify(call, compiled, CONTEXT), enabled)
const bash = (command: string, enabled?: Enabled) => routeOf({ tool: 'Bash', input: { command } }, enabled)

describe('each member gets its own triggers', () => {
  test('deletes, overwrites and anything unnamed go to Gandalf', () => {
    for (const command of ['rm -rf build', 'mv a b', 'curl -X POST https://example.com', 'bash deploy.sh', 'git clean -fdx']) {
      expect(bash(command), command).toEqual({ kind: 'member', member: 'gandalf' })
    }
    expect(routeOf({ tool: 'mcp__github__merge_pull_request', input: {} })).toEqual({ kind: 'member', member: 'gandalf' })
  })

  test('file edits and writes go to Legolas; SQL files to Aragorn, database profile', () => {
    for (const tool of ['Write', 'Edit', 'NotebookEdit']) {
      const field = tool === 'NotebookEdit' ? 'notebook_path' : 'file_path'
      expect(routeOf({ tool, input: { [field]: `${ROOT}/src/app.ts` } }), tool).toEqual({ kind: 'member', member: 'legolas' })
    }
    expect(routeOf({ tool: 'Write', input: { file_path: `${ROOT}/db/schema.sql`, content: '' } })).toEqual({ kind: 'member', member: 'aragorn', profile: 'database' })
  })

  test('history and remote changes go to Aragorn, git profile', () => {
    for (const command of ['git push origin feature', 'git rebase main', 'git reset --hard HEAD~1', 'git merge feature', 'git commit --amend', 'git tag v1']) {
      expect(bash(command), command).toEqual({ kind: 'member', member: 'aragorn', profile: 'git' })
    }
  })

  test('SQL clients and migrations go to Aragorn, database profile', () => {
    for (const command of ['psql -c "DELETE FROM users"', 'npx prisma migrate deploy', 'rails db:migrate', 'sqlite3 app.db "DROP TABLE x"']) {
      expect(bash(command), command).toEqual({ kind: 'member', member: 'aragorn', profile: 'database' })
    }
  })
})

describe('Gandalf is the fallback', () => {
  test('a switched-off member falls back to Gandalf, saying so', () => {
    expect(bash('git push origin feature', { ...ALL, aragorn: false })).toEqual({
      kind: 'member',
      member: 'gandalf',
      fallback: 'disabled',
      wanted: { member: 'aragorn', profile: 'git' },
    })
    expect(routeOf({ tool: 'Edit', input: { file_path: `${ROOT}/src/app.ts` } }, { ...ALL, legolas: false })).toMatchObject({ member: 'gandalf', fallback: 'disabled' })
  })

  test('with Gandalf off too, nobody reviews', () => {
    expect(bash('git push origin feature', { gandalf: false, legolas: true, aragorn: false })).toEqual({ kind: 'none', wanted: { member: 'aragorn', profile: 'git' } })
    expect(bash('rm -rf build', { gandalf: false, legolas: true, aragorn: true })).toEqual({ kind: 'none', wanted: { member: 'gandalf' } })
  })

  test('Gandalf off does not stop an enabled specialist', () => {
    expect(bash('git push origin feature', { ...ALL, gandalf: false })).toEqual({ kind: 'member', member: 'aragorn', profile: 'git' })
  })

  test('parts naming different reviewers go to Gandalf whole', () => {
    expect(bash('git push origin feature && rm -rf build')).toMatchObject({ member: 'gandalf', fallback: 'mixed' })
    expect(bash('git push origin feature && psql -c "select 1"')).toMatchObject({ member: 'gandalf', fallback: 'mixed' })
    expect(bash('git fetch && git push origin feature')).toEqual({ kind: 'member', member: 'aragorn', profile: 'git' })
  })

  test('the diff reviewer named for a shell command falls back: there is no file to diff', () => {
    const compiled = compileConfig(
      { ...SHIPPED, rules: [{ id: 'deploy', tier: 'review', tools: ['Bash'], command: '^make deploy', member: 'legolas', reason: 'Deploys.' }, ...SHIPPED.rules] },
      new Set(),
    )
    expect(routeOf({ tool: 'Bash', input: { command: 'make deploy' } }, ALL, compiled)).toMatchObject({ member: 'gandalf', fallback: 'no-diff' })
  })

  test("Aragorn named without a profile takes git for git, else the database's", () => {
    const compiled = compileConfig(
      {
        ...SHIPPED,
        rules: [
          { id: 'g', tier: 'review', tools: ['Bash'], command: '^git stash', member: 'aragorn', reason: 'Stash.' },
          { id: 'd', tier: 'review', tools: ['Bash'], command: '^mydb', member: 'aragorn', reason: 'DB.' },
          ...SHIPPED.rules,
        ],
      },
      new Set(),
    )
    expect(routeOf({ tool: 'Bash', input: { command: 'git stash' } }, ALL, compiled)).toEqual({ kind: 'member', member: 'aragorn', profile: 'git' })
    expect(routeOf({ tool: 'Bash', input: { command: 'mydb wipe' } }, ALL, compiled)).toEqual({ kind: 'member', member: 'aragorn', profile: 'database' })
  })
})

describe('in the pipeline', () => {
  const cases = [
    { name: 'Gandalf', call: { tool: 'Bash', command: 'rm -rf build' }, member: 'gandalf', profile: null, who: 'the destructive-operations reviewer', model: 'sonnet' },
    { name: 'Legolas', call: { tool: 'Edit', file_path: `${ROOT}/src/app.ts`, old_string: '1', new_string: '2' }, member: 'legolas', profile: null, who: 'the diff reviewer', model: 'sonnet' },
    { name: 'Aragorn (git)', call: { tool: 'Bash', command: 'git rebase main' }, member: 'aragorn', profile: 'git', who: 'the git reviewer', model: 'opus' },
    { name: 'Aragorn (database)', call: { tool: 'Bash', command: 'psql -c "DELETE FROM users WHERE id = 1"' }, member: 'aragorn', profile: 'database', who: 'the database reviewer', model: 'opus' },
  ] as const

  for (const c of cases) {
    test(`${c.name}: approve runs the call unchanged`, async ($, on) => {
      const w = world(on, { replies: [APPROVE] })
      expect(await $.tool.call(c.call as never)).toEqual({ result: 'ran' })
      expect(w.ran).toEqual([c.call])
      expect(w.modelRequests[0]).toMatchObject({ model: c.model })
      expect(auditLines(w)[0]).toMatchObject({ member: c.member, profile: c.profile, verdict: 'approve', outcome: 'ran' })
    })

    test(`${c.name}: revise and block refuse, naming the member`, async ($, on) => {
      const w = world(on, { replies: [REVISE, BLOCK] })
      expect(denyOf(await $.tool.call(c.call as never))).toContain(`Decided by: ${c.who} (revise).`)
      expect(denyOf(await $.tool.call(c.call as never))).toContain(`Decided by: ${c.who} (block).`)
      expect(w.ran).toEqual([])
      expect(auditLines(w).map(line => [line.member, line.verdict])).toEqual([
        [c.member, 'revise'],
        [c.member, 'block'],
      ])
    })
  }

  test('each member has its own system prompt', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    for (const c of cases) await $.tool.call(c.call as never)
    const systems = w.modelRequests.map(request => String(request.system))
    expect(new Set(systems).size).toBe(4)
    expect(systems[1]).toContain('diff')
    expect(systems[2]).toContain('Published history')
    expect(systems[3]).toContain('WHERE')
    expect(systems[2]).not.toContain('WHERE')
    expect(systems[3]).not.toContain('Published history')
  })

  test('a switched-off member falls back to Gandalf', { options: { legolasEnabled: false } }, async ($, on) => {
    const w = world(on, { replies: [BLOCK] })
    const deny = denyOf(await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/new.ts`, content: 'x' }))
    expect(deny).toContain('Decided by: the destructive-operations reviewer (block).')
    expect(auditLines(w)[0]).toMatchObject({ member: 'gandalf' })
  })

  test('with the member and Gandalf off, the call comes to the user', { options: { aragornEnabled: false, gandalfEnabled: false } }, async ($, on) => {
    const w = world(on, { answer: 'Keep blocked' })
    expect(denyOf(await $.tool.call({ tool: 'Bash', command: 'git rebase main' }))).toContain('(keep blocked)')
    expect(w.modelRequests).toEqual([])
    expect(w.asked[0]?.question).toContain('Its reviewer is switched off.')
  })

  test("each member's model follows its own /config row", { options: { legolasModel: 'opus', aragornModel: 'fable' } }, async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/new.ts`, content: 'x' })
    await $.tool.call({ tool: 'Bash', command: 'git rebase main' })
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    expect(w.modelRequests.map(request => request.model)).toEqual(['opus', 'fable', 'sonnet'])
    expect(w.modelRequests[1]).toMatchObject({ timeoutMs: 90000 })
  })

  test('a failed review names the member in the question', async ($, on) => {
    const w = world(on, { replies: [{ isAnswered: true, text: 'nope', usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }], answer: 'Keep blocked' })
    await $.tool.call({ tool: 'Bash', command: 'git rebase main' })
    expect(w.asked[0]?.question).toContain('the git reviewer: no verdict (malformed verdict')
  })
})
