import { describe, expect, test } from 'claude-code/testing'

import {
  isOutOfRounds,
  isWipeOutcome,
  lockoutOf,
  noteRound,
  noteWipe,
  operationOf,
  outcomeOf,
  partOperation,
  resetOperation,
  resetRounds,
  roundsLeft,
} from '../hooks/elrond/operations.js'
import type { OpsState } from '../hooks/elrond/operations.js'
import { classify } from '../hooks/rules/classify.js'
import type { Call } from '../hooks/rules/classify.js'
import { splitShell } from '../hooks/rules/shell.js'
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
