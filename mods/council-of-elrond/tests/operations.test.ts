import { describe, expect, test } from 'claude-code/testing'

import {
  attemptsOf,
  isOutOfRounds,
  isWipeOutcome,
  lockedVerbOf,
  lockoutOf,
  MAX_PART_KEYS,
  noteRound,
  noteWipe,
  operationOf,
  outcomeOf,
  partOperation,
  resetOperation,
  resetRounds,
  roundsLeft,
} from '../hooks/elrond/operations.js'
import type { Operation, OpsState } from '../hooks/elrond/operations.js'
import { classify } from '../hooks/rules/classify.js'
import type { Call } from '../hooks/rules/classify.js'
import { splitShell } from '../hooks/rules/shell.js'
import { INITIAL_SESSION, resetForPrompt, sessionOf } from '../hooks/state.js'
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

/** The key text of the first part of a command, gated or not: verb, then its sorted targets. */
const partKey = (command: string): string => {
  const part = splitShell(command).parts[0]
  if (part === undefined) throw new Error('no part')
  const op = partOperation(part, ROOT, { ...CONTEXT, cwd: ROOT })
  return `${op.verb} ${[...new Set(op.targets)].sort().join(' ')}`.trim()
}

describe('operation keys: accuracy (H3)', () => {
  test('inline SQL is not a target: every rephrase of a statement shares one key', () => {
    expect(bash('psql -c "DELETE FROM users"').key).toBe('shell:psql')
    expect(bash('psql -c "delete from users where 1=1"').key).toBe(bash('psql -c "DELETE FROM users"').key)
    expect(partKey('psql --command="DROP TABLE t"')).toBe('psql')
    expect(partKey('psql --command "DROP TABLE t"')).toBe('psql')
    expect(partKey('mysql -e "drop table t"')).toBe('mysql')
    expect(partKey('mysql --execute="drop table t" appdb')).toBe('mysql appdb')
    expect(partKey('mysql -h prod-db -e "drop table t"')).toBe('mysql prod-db')
    // The database is still the target, and a file option is not skipped.
    expect(bash('psql -d staging -c "select 1"').key).toBe('shell:psql staging')
    expect(partKey('psql -f drop.sql')).toBe('psql drop.sql')
    // sqlite3: its inline option is skipped, so the database file is the target.
    expect(partKey('sqlite3 -cmd "select 1" app.db')).toBe('sqlite3 app.db')
    expect(partKey('sqlite3 app.db "DROP TABLE x"')).toBe('sqlite3 app.db')
    expect(partKey('sqlite3 --cmd "DROP TABLE x" app.db')).toBe('sqlite3 app.db')
  })

  test('psql -n takes no value, so the database after it is still read', () => {
    expect(partKey('psql -n -d prod -c x')).toBe('psql prod')
    expect(bash('psql -n -d prod -c x').key).toBe('shell:psql prod')
  })

  test('a redirect write keys on the written file, not on what the program was given', () => {
    expect(partKey('echo x > out.txt')).toBe('echo out.txt')
    expect(partKey('echo y > out.txt')).toBe(partKey('echo x > out.txt'))
    expect(partKey('echo x >> ./out.txt')).toBe('echo out.txt')
    expect(partKey('cat a b > out.txt')).toBe('cat out.txt')
    // No redirect write: unchanged. A copy of stderr onto stdout is not a write.
    expect(partKey('echo x')).toBe('echo x')
    expect(partKey('echo x 2>&1')).toBe('echo x')
    expect(partKey('echo x > /dev/null')).toBe('echo x')
    // The special sets are unchanged: path programs keep their positionals.
    expect(partKey('rm -r build > log.txt')).toBe('rm build log.txt')
    expect(partKey('tee a.txt > b.txt')).toBe('tee a.txt b.txt')
  })

  test('git push reads HEAD as the current branch, and skips the value of a push option', () => {
    expect(partKey('git push origin HEAD')).toBe(partKey('git push origin'))
    expect(partKey('git push origin @')).toBe(partKey('git push origin'))
    expect(partKey('git push origin HEAD')).toBe('git push (current branch) origin')
    expect(partKey('git push origin +HEAD')).toBe('git push (current branch) origin')
    expect(partKey('git push origin HEAD:main')).toBe('git push main origin')
    expect(partKey('git push origin HEAD:refs/heads/main')).toBe(partKey('git push origin main'))
    expect(partKey('git push -o ci.skip origin main')).toBe(partKey('git push origin main'))
    expect(partKey('git push --push-option ci.skip origin main')).toBe(partKey('git push origin main'))
    expect(partKey('git push --push-option=ci.skip origin main')).toBe(partKey('git push origin main'))
    expect(bash('git push origin HEAD').key).toBe(bash('git push origin').key)
    // A named branch is still a different operation.
    expect(partKey('git push origin feature')).not.toBe(partKey('git push origin HEAD'))
  })

  test('git push keys are what they were, under the one shared reading of its arguments (DESIGN §15.19)', () => {
    // Pinned against the loop each of these once had of its own; every form below keyed so before.
    expect(partKey('git push')).toBe('git push (current branch) (default remote)')
    expect(partKey('git push -f')).toBe('git push (current branch) (default remote)')
    expect(partKey('git push --force-if-includes origin')).toBe('git push (current branch) origin')
    expect(partKey('git push origin other:main')).toBe('git push main origin')
    expect(partKey('git push origin +other:refs/heads/main')).toBe('git push main origin')
    expect(partKey('git push origin :old')).toBe('git push old origin')
    expect(partKey('git push origin --delete old')).toBe('git push old origin')
    expect(partKey('git push origin a b')).toBe('git push a b origin')
    expect(partKey('git push origin refs/heads/a')).toBe('git push a origin')
    expect(partKey('git push --repo x origin a')).toBe('git push a origin')
    expect(partKey('git push origin a --receive-pack x')).toBe('git push a origin')
  })

  test('quoted words key as they did: the parser already removes the quotes', () => {
    expect(partKey('rm -r "build dir"')).toBe('rm build dir')
    expect(partKey("rm -r 'build dir'")).toBe('rm build dir')
    expect(bash('rm -r "build dir"').key).toBe('shell:rm build dir')
    expect(partKey("psql -d 'staging' -c \"select 1\"")).toBe('psql staging')
    expect(partKey('psql -d "staging"')).toBe('psql staging')
    expect(partKey('git push \'origin\' "main"')).toBe('git push main origin')
    expect(bash('git push \'origin\' "main"').key).toBe('shell:git push main origin')
    expect(partKey('rm -r build > "log file.txt"')).toBe('rm build log file.txt')
    expect(partKey('echo x > "out.txt"')).toBe(partKey('echo x > out.txt'))
    expect(partKey('npm run "build"')).toBe('npm run build')
    expect(partKey('git add "a b"')).toBe('git add a b')
    expect(partKey('echo "a b"')).toBe('echo a b')
    expect(partKey('psql "postgres://u@db.example.com/app"')).toBe('psql postgres://u@db.example.com/app')
  })
})

/** The operation of a call of one part, a file tool or another tool: its part lists hold just its own keys. */
const single = (key: string, verbKey: string): Operation => ({ key, verbKey, partKeys: [key], partVerbKeys: [verbKey] })

describe('rounds and failed attempts', () => {
  const op = single('shell:rm build', 'shell:rm')
  const empty: OpsState = { ops: {}, verbWipes: {} }

  test('two non-approve verdicts use up the rounds; approve uses none', () => {
    let state = noteRound(empty, op, true)
    expect(roundsLeft(state, op)).toBe(2)
    state = noteRound(noteRound(state, op, false), op, false)
    expect(roundsLeft(state, op)).toBe(0)
    expect(isOutOfRounds(state, op)).toBe(true)
    expect(isOutOfRounds(resetRounds(state, op), op)).toBe(false)
  })

  test('three failed attempts lock the key; five lock the verb', () => {
    let state = empty
    for (let i = 0; i < 2; i++) state = noteWipe(state, op)
    expect(lockoutOf(state, op)).toBeUndefined()
    state = noteWipe(state, op)
    expect(lockoutOf(state, op)).toEqual({ kind: 'key', wipes: 3 })

    let verbs = empty
    for (const target of ['a', 'b', 'c', 'd', 'e']) verbs = noteWipe(verbs, single(`shell:rm ${target}`, 'shell:rm'))
    expect(lockoutOf(verbs, single('shell:rm f', 'shell:rm'))).toEqual({ kind: 'verb', wipes: 5 })
  })

  test('success clears its own operation, and a new prompt clears them all', () => {
    const state = noteWipe(noteWipe(empty, op), op)
    expect(resetOperation(state, op).ops[op.key]).toBeUndefined()
    const session = { ...INITIAL_SESSION, ...noteWipe(noteRound(empty, op, false), op), cache: ['f1'] }
    const fresh = resetForPrompt(session, 'next')
    expect(fresh.ops).toEqual({})
    expect(fresh.verbWipes).toEqual({})
    expect(fresh.cache).toEqual([])
  })
})

describe('part keys', () => {
  test('a call of one part, a file tool or another tool: the lists hold just its own key and verb key', () => {
    expect(bash('rm -rf build')).toEqual({ key: 'shell:rm build', verbKey: 'shell:rm', partKeys: ['shell:rm build'], partVerbKeys: ['shell:rm'] })
    expect(bash('git push origin main')).toEqual({
      key: 'shell:git push main origin',
      verbKey: 'shell:git push',
      partKeys: ['shell:git push main origin'],
      partVerbKeys: ['shell:git push'],
    })
    expect(opOf({ tool: 'Edit', input: { file_path: `${ROOT}/src/app.ts`, old_string: 'a', new_string: 'b' } })).toEqual({
      key: 'file:src/app.ts',
      verbKey: 'file:Edit',
      partKeys: ['file:src/app.ts'],
      partVerbKeys: ['file:Edit'],
    })
    expect(opOf({ tool: 'mcp__github__merge_pull_request', input: { number: 7 } })).toEqual({
      key: 'tool:mcp__github__merge_pull_request',
      verbKey: 'tool:mcp__github__merge_pull_request',
      partKeys: ['tool:mcp__github__merge_pull_request'],
      partVerbKeys: ['tool:mcp__github__merge_pull_request'],
    })
  })

  test('a compound keeps its whole keys, and each gated part has the key a call of that part alone has', () => {
    const compound = bash('rm -rf build; rmdir /work/tmp/zz')
    expect(compound.key).toBe('shell:rm build ; rmdir tmp/zz')
    expect(compound.verbKey).toBe('shell:rm ; rmdir')
    expect(compound.partKeys).toEqual(['shell:rm build', 'shell:rmdir tmp/zz'])
    expect(compound.partVerbKeys).toEqual(['shell:rm', 'shell:rmdir'])
    expect(compound.partKeys).toContain(bash('rm -rf build').key)
    expect(compound.partKeys).toContain(bash('rmdir /work/tmp/zz').key)
    // Order and repetition do not matter.
    expect(bash('rmdir /work/tmp/zz && rm -rf build; rm -r build/').partKeys).toEqual(compound.partKeys)
  })

  test('a secret in a target never reaches a part key either', () => {
    const token = FAKE_GITHUB_TOKEN
    const compound = bash(`rm -rf build; git push https://user:${token}@github.com/o/r main`)
    for (const key of [compound.key, ...compound.partKeys]) expect(key).not.toContain(token)
  })

  test('at most the first MAX_PART_KEYS gated parts get a part key, so the state stays bounded', () => {
    const names = Array.from({ length: 12 }, (_, n) => `d${n}`)
    const compound = bash(names.map(name => `rm -rf ${name}`).join('; '))
    expect(compound.partKeys).toHaveLength(MAX_PART_KEYS)
    expect(compound.partKeys).toEqual(names.slice(0, MAX_PART_KEYS).map(name => `shell:rm ${name}`).sort())
    expect(compound.partVerbKeys).toEqual(['shell:rm'])
    // The whole key still names every part.
    expect(compound.key).toContain('rm d11')
  })
})

describe('retries of one part inside a compound', () => {
  const empty: OpsState = { ops: {}, verbWipes: {} }
  const wipes = (state: OpsState, operation: Operation, times: number): OpsState => {
    let current = state
    for (let i = 0; i < times; i++) current = noteWipe(current, operation)
    return current
  }
  const rmBuild = bash('rm -rf build')
  const rmdirZz = bash('rmdir /work/tmp/zz')

  test('after three failed attempts on a delete, the same delete with another gated part is locked out, in either order', () => {
    const state = wipes(empty, rmBuild, 3)
    expect(lockoutOf(state, rmBuild)).toEqual({ kind: 'key', wipes: 3 })
    expect(lockoutOf(state, bash('rm -rf build; rmdir /work/tmp/zz'))).toEqual({ kind: 'key', wipes: 3 })
    expect(lockoutOf(state, bash('rmdir /work/tmp/zz && rm -rf build'))).toEqual({ kind: 'key', wipes: 3 })
    // A different part alone is another operation: not locked, and not locked as a kind.
    expect(lockoutOf(state, rmdirZz)).toBeUndefined()
    expect(lockoutOf(state, bash('rm -rf dist'))).toBeUndefined()
  })

  test('failed attempts of a compound count on its parts, so a part alone is locked too', () => {
    const state = wipes(empty, bash('rm -rf build; rmdir /work/tmp/zz'), 3)
    expect(state.ops).toEqual({
      'shell:rm build': { rounds: 0, wipes: 3 },
      'shell:rmdir tmp/zz': { rounds: 0, wipes: 3 },
      'shell:rm build ; rmdir tmp/zz': { rounds: 0, wipes: 3 },
    })
    // Each distinct part verb once; the joined verb key is not counted.
    expect(state.verbWipes).toEqual({ 'shell:rm': 3, 'shell:rmdir': 3 })
    expect(lockoutOf(state, rmBuild)).toEqual({ kind: 'key', wipes: 3 })
    expect(lockoutOf(state, rmdirZz)).toEqual({ kind: 'key', wipes: 3 })
    expect(lockoutOf(state, bash('rm -rf build; rmdir /work/tmp/other'))).toEqual({ kind: 'key', wipes: 3 })
  })

  test('after the per-verb cap of failed deletes on different targets, a compound with a delete part is locked out', () => {
    let state = empty
    for (const target of ['a', 'b', 'c', 'd', 'e']) state = noteWipe(state, bash(`rm -rf ${target}`))
    const compound = bash('rm -rf fresh; rmdir /work/tmp/zz')
    expect(lockoutOf(state, compound)).toEqual({ kind: 'verb', wipes: 5 })
    expect(lockedVerbOf(state, compound)).toBe('shell:rm')
    expect(lockoutOf(state, bash('rmdir /work/tmp/zz; rm -rf fresh'))).toEqual({ kind: 'verb', wipes: 5 })
    // No delete part: not locked.
    expect(lockoutOf(state, rmdirZz)).toBeUndefined()
    expect(lockedVerbOf(state, rmdirZz)).toBeUndefined()
  })

  test('a lockout stored with the joined verb key keeps counting for a call with that joined verb key', () => {
    const stored = sessionOf({ ...INITIAL_SESSION, verbWipes: { 'shell:rm ; rmdir': 5 } })
    expect(stored.verbWipes).toEqual({ 'shell:rm ; rmdir': 5 })
    const compound = bash('rm -rf build; rmdir /work/tmp/zz')
    expect(lockoutOf(stored, compound)).toEqual({ kind: 'verb', wipes: 5 })
    expect(lockedVerbOf(stored, compound)).toBe('shell:rm ; rmdir')
    // Another set of verbs is not that kind.
    expect(lockoutOf(stored, rmBuild)).toBeUndefined()
    expect(bash('rm -rf build; git push origin main').verbKey).toBe('shell:git push ; rm')
    expect(lockoutOf(stored, bash('rm -rf build; git push origin main'))).toBeUndefined()
  })

  test('after two review rounds on a delete, the compound is out of rounds; a part alone that was not reviewed is not', () => {
    const state = noteRound(noteRound(empty, rmBuild, false), rmBuild, false)
    expect(isOutOfRounds(state, rmBuild)).toBe(true)
    expect(isOutOfRounds(state, bash('rm -rf build; rmdir /work/tmp/zz'))).toBe(true)
    expect(isOutOfRounds(state, bash('rmdir /work/tmp/zz && rm -rf build'))).toBe(true)
    expect(roundsLeft(state, bash('rm -rf build; rmdir /work/tmp/zz'))).toBe(0)
    expect(isOutOfRounds(state, rmdirZz)).toBe(false)
    expect(roundsLeft(state, rmdirZz)).toBe(2)
  })

  test('a compound\'s review rounds count on its parts, and an approve uses none', () => {
    const compound = bash('rm -rf build; rmdir /work/tmp/zz')
    const once = noteRound(empty, compound, false)
    expect(once.ops).toEqual({
      'shell:rm build': { rounds: 1, wipes: 0 },
      'shell:rmdir tmp/zz': { rounds: 1, wipes: 0 },
      'shell:rm build ; rmdir tmp/zz': { rounds: 1, wipes: 0 },
    })
    expect(roundsLeft(once, rmBuild)).toBe(1)
    expect(noteRound(empty, compound, true)).toBe(empty)
  })

  test('the person\'s instruction resets the rounds of the whole key only: a part keeps the rounds it has used', () => {
    const compound = bash('rm -rf build; rmdir /work/tmp/zz')
    const state = noteRound(noteRound(empty, compound, false), compound, false)
    expect(isOutOfRounds(state, rmBuild)).toBe(true)
    const reset = resetRounds(state, compound)
    expect(reset.ops).toEqual({
      'shell:rm build': { rounds: 2, wipes: 0 },
      'shell:rmdir tmp/zz': { rounds: 2, wipes: 0 },
      'shell:rm build ; rmdir tmp/zz': { rounds: 0, wipes: 0 },
    })
    // The compound is still out of rounds through its parts, and so is each part alone.
    expect(isOutOfRounds(reset, compound)).toBe(true)
    expect(isOutOfRounds(reset, rmBuild)).toBe(true)
    expect(isOutOfRounds(reset, rmdirZz)).toBe(true)
    // Resetting where the whole key holds nothing writes nothing.
    expect(resetRounds(empty, compound)).toBe(empty)
  })

  test('a success resets only the whole key of that call: its parts and the verb counters keep their counts', () => {
    const compound = bash('rm -rf build; rmdir /work/tmp/zz')
    // A part that failed twice on its own, and the compound that failed once: the compound then ran.
    const state: OpsState = {
      ops: {
        'shell:rm build': { rounds: 1, wipes: 2 },
        'shell:rm build ; rmdir tmp/zz': { rounds: 0, wipes: 1 },
        'shell:rm dist': { rounds: 0, wipes: 1 },
      },
      verbWipes: { 'shell:rm': 3 },
    }
    const done = resetOperation(state, compound)
    expect(done.ops).toEqual({ 'shell:rm build': { rounds: 1, wipes: 2 }, 'shell:rm dist': { rounds: 0, wipes: 1 } })
    expect(done.verbWipes).toEqual({ 'shell:rm': 3 })
    expect(lockoutOf(noteWipe(done, rmBuild), rmBuild)).toEqual({ kind: 'key', wipes: 3 })
    // Nothing held under the whole key: the same state back.
    expect(resetOperation(done, compound)).toBe(done)
  })

  test('the status counts a locked verb as locked out', () => {
    let state = empty
    for (const target of ['a', 'b', 'c', 'd', 'e']) state = noteWipe(state, bash(`rm -rf ${target}`))
    // Five keys with one failed attempt each: none locked by key, the verb is.
    expect(attemptsOf(state)).toEqual({ count: 5, ops: 5, locked: 1 })
    expect(attemptsOf(wipes(empty, rmBuild, 3))).toEqual({ count: 3, ops: 1, locked: 1 })
    expect(attemptsOf(empty)).toEqual({ count: 0, ops: 0, locked: 0 })
  })

  test('a call of one part, a file tool or another tool: counts and resets are what they always were', () => {
    const edit = opOf({ tool: 'Edit', input: { file_path: `${ROOT}/src/app.ts`, old_string: 'a', new_string: 'b' } })
    const mcp = opOf({ tool: 'mcp__github__merge_pull_request', input: { number: 7 } })
    for (const [operation, key, verbKey] of [
      [rmBuild, 'shell:rm build', 'shell:rm'],
      [edit, 'file:src/app.ts', 'file:Edit'],
      [mcp, 'tool:mcp__github__merge_pull_request', 'tool:mcp__github__merge_pull_request'],
    ] as const) {
      const counted = wipes(empty, operation, 2)
      expect(counted, key).toEqual({ ops: { [key]: { rounds: 0, wipes: 2 } }, verbWipes: { [verbKey]: 2 } })
      expect(lockoutOf(counted, operation)).toBeUndefined()
      expect(lockoutOf(noteWipe(counted, operation), operation)).toEqual({ kind: 'key', wipes: 3 })
      const rounded = noteRound(noteRound(empty, operation, false), operation, false)
      expect(rounded.ops, key).toEqual({ [key]: { rounds: 2, wipes: 0 } })
      expect(isOutOfRounds(rounded, operation)).toBe(true)
      expect(resetRounds(rounded, operation).ops, key).toEqual({ [key]: { rounds: 0, wipes: 0 } })
      expect(resetOperation(counted, operation), key).toEqual({ ops: {}, verbWipes: { [verbKey]: 2 } })
    }
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

  test('a deny rule on a file reads as an automatic denial', () => {
    for (const text of [
      'Permission to edit /work/src/app.ts has been denied.',
      'Permission to read /work/.env has been denied.',
      'Permission to read /work/link has been denied (it resolves, through a symbolic link, to a path a Read rule denies).',
    ]) {
      expect(outcomeOf({ isError: true, text })).toBe('denied-by-permission')
    }
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
