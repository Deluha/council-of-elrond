import { describe, expect, test } from 'claude-code/testing'

import {
  isOutOfRounds,
  isWipeOutcome,
  lockoutOf,
  noteRound,
  noteWipe,
  operationOf,
  outcomeOf,
  resetOperation,
  resetRounds,
  roundsLeft,
} from '../hooks/elrond/operations.js'
import type { OpsState } from '../hooks/elrond/operations.js'
import { classify } from '../hooks/rules/classify.js'
import type { Call } from '../hooks/rules/classify.js'
import { INITIAL_SESSION, resetForPrompt } from '../hooks/state.js'
import { CONTEXT, FAKE_GITHUB_TOKEN, ROOT, SHIPPED_COMPILED } from './fixtures.js'

const opOf = (call: Call, cwd = ROOT) => {
  const where = { ...CONTEXT, cwd }
  return operationOf(call, classify(call, SHIPPED_COMPILED, where), where)
}
const bash = (command: string, cwd?: string) => opOf({ tool: 'Bash', input: { command } }, cwd)

describe('operation keys', () => {
  test('a rephrased delete of the same target shares a key', () => {
    expect(bash('rm -rf ./build').key).toBe(bash('rm -r build/').key)
    expect(bash('rm -r -f build').key).toBe(bash('rm -rf build').key)
    expect(bash('cd src && rm -rf ../build').key).toBe(bash('rm -rf build').key)
    expect(bash('rm -rf /work/build').key).toBe('shell:rm build')
  })

  test('targets are sorted, so order does not matter', () => {
    expect(bash('rm -rf a b').key).toBe(bash('rm -rf b a').key)
  })

  test('different targets are different operations of the same verb', () => {
    const a = bash('rm -rf build')
    const b = bash('rm -rf dist')
    expect(a.key).not.toBe(b.key)
    expect(a.verbKey).toBe(b.verbKey)
  })

  test('git push keys on remote and branch, with flags and force markers dropped', () => {
    expect(bash('git push origin main').key).toBe('shell:git push main origin')
    expect(bash('git push --force origin +main').key).toBe(bash('git push origin main').key)
    expect(bash('git push origin HEAD:refs/heads/main').key).toBe(bash('git push origin main').key)
    expect(bash('git push origin feature').key).not.toBe(bash('git push origin main').key)
    expect(bash('git push origin feature').verbKey).toBe('shell:git push')
  })

  test('SQL keys on the target database, password redacted', () => {
    const key = bash('psql postgres://app:hunter22@db.prod:5432/app -c "DELETE FROM users"').key
    expect(key).toContain('psql')
    expect(key).not.toContain('hunter22')
    expect(bash('psql -d staging -c "select 1"').key).toBe('shell:psql staging')
  })

  test('a secret in a target never reaches the key (it is written to the audit log)', () => {
    const token = FAKE_GITHUB_TOKEN // the established fixture token
    const key = bash(`git push https://user:${token}@github.com/o/r main`).key
    expect(key).not.toContain(token)
  })

  test('Edit and Write on one file share a key; their verbs differ', () => {
    const edit = opOf({ tool: 'Edit', input: { file_path: `${ROOT}/src/app.ts`, old_string: 'a', new_string: 'b' } })
    const write = opOf({ tool: 'Write', input: { file_path: 'src/app.ts', content: 'x' } })
    expect(edit.key).toBe('file:src/app.ts')
    expect(write.key).toBe(edit.key)
    expect(write.verbKey).not.toBe(edit.verbKey)
  })

  test('MCP tools key on the tool', () => {
    expect(opOf({ tool: 'mcp__github__merge_pull_request', input: { number: 7 } }).key).toBe('tool:mcp__github__merge_pull_request')
  })
})

describe('rounds and failed attempts', () => {
  const op = { key: 'shell:rm build', verbKey: 'shell:rm' }
  const empty: OpsState = { ops: {}, verbWipes: {} }

  test('two non-approve verdicts use up the rounds; approve uses none', () => {
    let state = noteRound(empty, op.key, true)
    expect(roundsLeft(state, op.key)).toBe(2)
    state = noteRound(noteRound(state, op.key, false), op.key, false)
    expect(roundsLeft(state, op.key)).toBe(0)
    expect(isOutOfRounds(state, op.key)).toBe(true)
    expect(isOutOfRounds(resetRounds(state, op.key), op.key)).toBe(false)
  })

  test('three failed attempts lock the key; five lock the verb', () => {
    let state = empty
    for (let i = 0; i < 2; i++) state = noteWipe(state, op)
    expect(lockoutOf(state, op)).toBeUndefined()
    state = noteWipe(state, op)
    expect(lockoutOf(state, op)).toEqual({ kind: 'key', wipes: 3 })

    let verbs = empty
    for (const target of ['a', 'b', 'c', 'd', 'e']) verbs = noteWipe(verbs, { key: `shell:rm ${target}`, verbKey: 'shell:rm' })
    expect(lockoutOf(verbs, { key: 'shell:rm f', verbKey: 'shell:rm' })).toEqual({ kind: 'verb', wipes: 5 })
  })

  test('success clears its own operation, and a new prompt clears them all', () => {
    const state = noteWipe(noteWipe(empty, op), op)
    expect(resetOperation(state, op.key).ops[op.key]).toBeUndefined()
    const session = { ...INITIAL_SESSION, ...noteWipe(noteRound(empty, op.key, false), op), cache: ['f1'] }
    const fresh = resetForPrompt(session, 'next')
    expect(fresh.ops).toEqual({})
    expect(fresh.verbWipes).toEqual({})
    expect(fresh.cache).toEqual([])
  })
})

describe('outcomes', () => {
  const USER = "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed."
  const AUTO = "rm in '/work/build' needs approval. The path is inside the working directories for this session ('/work'), and Claude Code asks before a shell command creates, changes or removes files there."

  test('the person refusing at the prompt is told apart from an automatic denial and a tool error', () => {
    expect(outcomeOf({ result: 'x' } as never)).toBe('ran')
    expect(outcomeOf({ deny: 'no' })).toBe('refused')
    expect(outcomeOf({ isError: true, text: 'exit code 1' })).toBe('error')
    expect(outcomeOf({ isError: true, text: USER })).toBe('refused-by-user')
    expect(outcomeOf({ isError: true, text: "The user doesn't want to take this action right now. STOP what you are doing." })).toBe('refused-by-user')
    expect(outcomeOf({ isError: true, text: AUTO })).toBe('denied-by-permission')
    expect(outcomeOf({ isError: true, text: 'Permission to use Bash has been denied.' })).toBe('denied-by-permission')
    expect(outcomeOf({ isError: true, text: 'This command requires approval' })).toBe('denied-by-permission')
    expect(outcomeOf({ isError: true, text: 'The build requires a newer compiler' })).toBe('error')
  })

  test('the person refusing counts; an automatic denial never does', () => {
    for (const toolErrors of [true, false]) {
      expect(isWipeOutcome('refused-by-user', { toolErrors })).toBe(true)
      expect(isWipeOutcome('denied-by-permission', { toolErrors })).toBe(false)
      expect(isWipeOutcome('ran', { toolErrors })).toBe(false)
      expect(isWipeOutcome('error', { toolErrors })).toBe(toolErrors)
    }
  })
})
