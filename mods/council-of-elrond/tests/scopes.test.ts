import { describe, expect, test } from 'claude-code/testing'

import { fingerprintOf } from '../hooks/audit.js'
import { callKeyOf } from '../hooks/elrond/chat.js'
import { MAX_GIMLI_COMMANDS } from '../hooks/config/schema.js'
import { classify, cwdAfter, targetsOf } from '../hooks/rules/classify.js'
import type { Call, ClassifyContext, Target } from '../hooks/rules/classify.js'
import { splitShell } from '../hooks/rules/shell.js'
import { auditDirsOf, candidateChildren, checksOf, combineClassifications, intersection, scopesTouched, scopeTagOf, unionById, writeDirOf } from '../hooks/rules/scopes.js'
import type { CouncilSession } from '../types'
import { ALLOW_ONCE, ALLOWLIST, APP_RULES, APPROVE, auditLines, BLOCK, council, CONTEXT, denyOf, FAKE_AWS_KEY, KEEP_BLOCKED, ROOT, SHIPPED_COMPILED, watchState, world } from './fixtures.js'
import type { World } from './fixtures.js'

/**
 * ROADMAP C5 (DESIGN §14.5): rules per repository when the session root is the
 * parent of several. `world(on, { multiRepo: true })` is `/work` with no `.git`
 * and no rules file, `/work/app` (a repository with a rules file) and `/work/lib`
 * (a repository without).
 */

const APP = `${ROOT}/app`
const LIB = `${ROOT}/lib`
const RULES = '.claude/council-of-elrond/rules.json'
const LOG = '.claude/council-of-elrond/audit/audit.jsonl'
const logOf = (dir: string): string => `${dir}/${LOG}`

const bash = (command: string): Call => ({ tool: 'Bash', input: { command } })
const target = (path: string, isWorkingDir = false): Target => ({ path, isWorkingDir })
const where = (cwd: string, extra: Partial<ClassifyContext> = {}): ClassifyContext => ({ root: ROOT, cwd, home: '/home/me', ...extra })

const REPOS = new Set([APP, LIB])

describe('the targets of a call', () => {
  test('a shell part runs where the cd before it left it; the cd itself runs where it started', () => {
    const targets = targetsOf(bash('cd app && ls src; cd ../lib && ls'), where(ROOT))
    expect(targets.filter(t => t.isWorkingDir).map(t => t.path)).toEqual([ROOT, APP, APP, LIB])
    // `cd app` names /work/app (against the directory it ran in), `ls src` names /work/app/src.
    expect(targets.map(t => t.path)).toContain(APP)
    expect(targets.map(t => t.path)).toContain(`${APP}/src`)
    expect(targets.map(t => t.path)).toContain(LIB)
  })

  test('the first target is where the call starts', () => {
    expect(targetsOf(bash('ls'), where(APP))[0]).toEqual(target(APP, true))
  })

  test('an unknowable cd target lands at / for the parts after it', () => {
    const dirs = targetsOf(bash('cd $X && rm -rf y'), where(APP)).filter(t => t.isWorkingDir)
    expect(dirs.map(t => t.path)).toEqual([APP, '/'])
  })

  test('a nested cd does not move the parts after it', () => {
    const dirs = targetsOf(bash('(cd lib; ls) && ls'), where(APP)).filter(t => t.isWorkingDir)
    expect(new Set(dirs.map(t => t.path))).toEqual(new Set([APP]))
  })

  test('the words a part names are resolved against its own directory; ~ and quotes are expanded', () => {
    const targets = targetsOf(bash('cat ../lib/a "../lib/b" ~/c > /dev/null'), where(APP))
    expect(targets.filter(t => !t.isWorkingDir).map(t => t.path)).toEqual([`${LIB}/a`, `${LIB}/b`, '/home/me/c', '/dev/null'])
  })

  test('a file tool: its path and its real path are working directories', () => {
    const call: Call = { tool: 'Edit', input: { file_path: 'src/a.ts' } }
    expect(targetsOf(call, where(APP))).toEqual([target(`${APP}/src/a.ts`, true)])
    expect(targetsOf(call, where(APP, { realPath: `${LIB}/a.ts` }))).toEqual([target(`${APP}/src/a.ts`, true), target(`${LIB}/a.ts`, true)])
  })

  test('any other tool: the session cwd alone; a command that parses to nothing too', () => {
    expect(targetsOf({ tool: 'mcp__x__y', input: {} }, where(LIB))).toEqual([target(LIB, true)])
    expect(targetsOf(bash(''), where(LIB))).toEqual([target(LIB, true)])
  })

  test('cwdAfter is the one cd logic: classify and the targets agree on it', () => {
    const [part] = splitShell('cd ../lib').parts
    expect(cwdAfter(part, APP, '/home/me')).toBe(LIB)
    expect(cwdAfter(part, APP)).toBe(LIB)
    const [bare] = splitShell('cd').parts
    expect(cwdAfter(bare, APP, '/home/me')).toBe('/home/me')
    expect(cwdAfter(undefined, APP)).toBe(APP)
    // classify moves a later part's paths the same way: `rm -rf y` after `cd ../lib` is inside lib, outside app.
    const inLib = classify(bash('cd ../lib && rm -rf y'), SHIPPED_COMPILED, { ...CONTEXT, root: LIB, cwd: APP })
    expect(inLib.findings.map(f => f.ruleId)).not.toContain('rm-recursive-outside-repo')
    const outsideApp = classify(bash('cd ../lib && rm -rf y'), SHIPPED_COMPILED, { ...CONTEXT, root: APP, cwd: APP })
    expect(outsideApp.findings.map(f => f.ruleId)).toContain('rm-recursive-outside-repo')
  })
})

describe('the scopes a call touches', () => {
  test('candidate children: the first segment below the root of each target, once', () => {
    expect(candidateChildren([target(`${APP}/src/a`), target(`${APP}/b`), target(LIB, true), target(ROOT, true), target('/etc/hosts')], ROOT)).toEqual([APP, LIB])
    expect(candidateChildren([target('/a/b')], '/')).toEqual(['/a'])
  })

  test('a target in a repository, or the repository itself, brings it in', () => {
    expect(scopesTouched([target(`${APP}/src/a`, true)], ROOT, REPOS)).toEqual([APP])
    expect(scopesTouched([target(APP, true)], ROOT, REPOS)).toEqual([APP])
    expect(scopesTouched([target(`${LIB}/x`)], ROOT, REPOS)).toEqual([LIB])
  })

  test('a working directory in no repository brings in the root scope; a named path in none brings in nothing', () => {
    for (const path of [ROOT, `${ROOT}/plain`, `${ROOT}/plain/x`, '/', '/etc', '/home/me']) {
      expect(scopesTouched([target(path, true)], ROOT, REPOS), path).toEqual([ROOT])
    }
    expect(scopesTouched([target(APP, true), target('/dev/null'), target(`${ROOT}/plain/x`)], ROOT, REPOS)).toEqual([APP])
    // Nothing at all brought in: the root scope.
    expect(scopesTouched([target('/dev/null')], ROOT, REPOS)).toEqual([ROOT])
    expect(scopesTouched([], ROOT, REPOS)).toEqual([ROOT])
  })

  test('the first target first, then in the order met, each once', () => {
    expect(scopesTouched([target(LIB, true), target(`${APP}/x`), target(`${LIB}/y`), target(ROOT, true)], ROOT, REPOS)).toEqual([LIB, APP, ROOT])
    expect(scopesTouched([target(ROOT, true), target(`${APP}/x`)], ROOT, REPOS)).toEqual([ROOT, APP])
  })

  test('a child that is not a known repository is a plain folder', () => {
    expect(scopesTouched([target(`${ROOT}/plain/x`, true)], ROOT, REPOS)).toEqual([ROOT])
    // Nothing below the root is a repository when the set is empty.
    expect(scopesTouched([target(`${APP}/x`, true)], ROOT, new Set())).toEqual([ROOT])
  })

  test('the scope tag is empty for the root scope alone, else the sorted directories', () => {
    expect(scopeTagOf([ROOT], ROOT)).toBe('')
    expect(scopeTagOf([APP], ROOT)).toBe(APP)
    expect(scopeTagOf([LIB, APP], ROOT)).toBe(`${APP}\n${LIB}`)
    expect(scopeTagOf([APP, ROOT], ROOT)).toBe(`${ROOT}\n${APP}`)
  })

  test('the keys with an empty tag are byte-identical to the keys without one', async () => {
    const call: Call = { tool: 'Bash', input: { command: 'sudo ls', description: 'x' } }
    expect(await fingerprintOf(call.tool, call.input, '')).toBe(await fingerprintOf(call.tool, call.input))
    expect(await callKeyOf(call, '')).toBe(await callKeyOf(call))
    expect(await fingerprintOf(call.tool, call.input, APP)).not.toBe(await fingerprintOf(call.tool, call.input))
    expect(await fingerprintOf(call.tool, call.input, APP)).not.toBe(await fingerprintOf(call.tool, call.input, LIB))
    expect(await callKeyOf(call, APP)).not.toBe(await callKeyOf(call, LIB))
    expect(await callKeyOf(call, APP)).toBe(await callKeyOf({ tool: 'Bash', input: { command: 'sudo ls' } }, APP))
  })
})

describe('combining the classifications', () => {
  const classified = (command: string, root: string, cwd = root) => classify(bash(command), SHIPPED_COMPILED, { ...CONTEXT, root, cwd })

  test('one scope: that classification, unchanged', () => {
    const only = classified('rm -rf build', ROOT)
    const { classification, index } = combineClassifications([only])
    expect(classification).toBe(only)
    expect(index).toBe(0)
  })

  test('the strictest tier wins, and its scope decides', () => {
    const allow = classified('ls', APP)
    const review = classified('rm -rf build', LIB)
    const ask = classified('sudo ls', ROOT)
    expect(combineClassifications([allow, review]).index).toBe(1)
    expect(combineClassifications([review, allow]).index).toBe(0)
    expect(combineClassifications([review, ask, allow]).index).toBe(1)
    expect(combineClassifications([allow, review]).classification.tier).toBe('review')
  })

  test('on a tie, the earliest scope', () => {
    const a = classified('rm -rf build', APP)
    const b = classified('rm -rf build', LIB)
    const { classification, index } = combineClassifications([a, b])
    expect(index).toBe(0)
    expect(classification.decided).toBe(a.decided)
  })

  test('protection is any scope\'s, the scripts are all of them', () => {
    const plain = classified('ls', APP)
    const protectedOne = classified('cat .env', LIB)
    expect(protectedOne.isProtected).toBe(true)
    expect(combineClassifications([plain, protectedOne]).classification.isProtected).toBe(true)
    const scripted = classified('bash a.sh', APP)
    const other = classified('bash b.sh', LIB)
    expect(combineClassifications([scripted, other]).classification.scriptPaths).toEqual([...new Set([...scripted.scriptPaths, ...other.scriptPaths])])
    expect(combineClassifications([scripted, other]).classification.scriptPaths).toEqual(expect.arrayContaining(['a.sh', 'b.sh']))
  })

  test('no classification at all is an error, never an allow', () => {
    expect(() => combineClassifications([])).toThrow()
  })
})

describe('what the touched scopes share', () => {
  test('patterns: each id once, the first kept', () => {
    expect(unionById([[{ id: 'a', n: 1 }, { id: 'b', n: 1 }], [{ id: 'b', n: 2 }, { id: 'c', n: 2 }]])).toEqual([{ id: 'a', n: 1 }, { id: 'b', n: 1 }, { id: 'c', n: 2 }])
  })

  test('the allowlist: only what every scope lists', () => {
    expect(intersection([['x', 'y'], ['y', 'z']])).toEqual(['y'])
    expect(intersection([['x', 'y']])).toEqual(['x', 'y'])
    expect(intersection([['x'], []])).toEqual([])
    expect(intersection([])).toEqual([])
  })

  test('checks: in scope order, each in its own directory, eight in all', () => {
    const named = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => ({ name: `${prefix}${i}`, argv: [prefix], timeoutMs: 1000 }))
    const checks = checksOf([{ dir: APP, commands: named('a', 5) }, { dir: LIB, commands: named('l', 5) }])
    expect(checks).toHaveLength(MAX_GIMLI_COMMANDS)
    expect(checks.map(c => c.command.name)).toEqual(['a0', 'a1', 'a2', 'a3', 'a4', 'l0', 'l1', 'l2'])
    expect(checks.map(c => c.dir)).toEqual([APP, APP, APP, APP, APP, LIB, LIB, LIB])
    expect(checksOf([{ dir: ROOT, commands: [] }])).toEqual([])
  })

  test('audit logs: every repository touched, else the root; one file once', () => {
    expect(auditDirsOf([ROOT], ROOT, LOG)).toEqual([ROOT])
    expect(auditDirsOf([APP], ROOT, LOG)).toEqual([APP])
    expect(auditDirsOf([APP, LIB], ROOT, LOG)).toEqual([APP, LIB])
    expect(auditDirsOf([ROOT, APP], ROOT, LOG)).toEqual([APP])
    expect(auditDirsOf([APP, LIB], ROOT, '/var/log/council.jsonl')).toEqual([APP])
  })

  test('a rules entry may be written to one repository, or to the root only when the lookup is off', () => {
    expect(writeDirOf([ROOT], ROOT, false)).toBe(ROOT)
    expect(writeDirOf([APP, LIB], ROOT, false)).toBe(ROOT)
    expect(writeDirOf([APP], ROOT, true)).toBe(APP)
    expect(writeDirOf([ROOT], ROOT, true)).toBeUndefined()
    expect(writeDirOf([APP, LIB], ROOT, true)).toBeUndefined()
    expect(writeDirOf([ROOT, APP], ROOT, true)).toBeUndefined()
  })
})

const lines = (w: World, dir: string) => auditLines(w, logOf(dir))

describe('rules per repository', () => {
  test('a file edit in app resolves app\'s rules; in lib the shipped defaults; a command run in lib gets the defaults', async ($, on) => {
    const w = world(on, { multiRepo: true, answer: KEEP_BLOCKED, replies: [APPROVE] })
    // app: its project protected path applies.
    await $.tool.call({ tool: 'Edit', file_path: `${APP}/config/secret/x`, old_string: 'a', new_string: 'b' })
    expect(w.asked).toHaveLength(1)
    expect(await lines(w, APP)).toMatchObject([{ tier: 'ask', ruleId: 'protected-path' }])
    // lib: the same path is an ordinary edit, reviewed by the diff reviewer.
    expect(await $.tool.call({ tool: 'Edit', file_path: `${LIB}/config/secret/x`, old_string: 'a', new_string: 'b' })).toEqual({ result: 'ran' })
    expect(w.asked).toHaveLength(1)
    expect(await lines(w, LIB)).toMatchObject([{ tier: 'review', ruleId: 'file-write', member: 'legolas' }])
    // A command in lib: app's allow rule for `npm publish` does not apply.
    w.cwd = LIB
    await $.tool.call({ tool: 'Bash', command: 'npm publish' })
    expect(w.modelRequests).toHaveLength(2)
    expect((await lines(w, LIB))[1]).toMatchObject({ tier: 'review', ruleId: 'publish' })
    // The same command in app: allowed by its own rule, nothing asked, nothing logged.
    w.cwd = APP
    expect(await $.tool.call({ tool: 'Bash', command: 'npm publish' })).toEqual({ result: 'ran' })
    expect(w.modelRequests).toHaveLength(2)
    expect(await lines(w, APP)).toHaveLength(1)
  })

  test('a rules file in a plain folder, or deeper than a repository\'s top, is ignored', async ($, on) => {
    const w = world(on, { multiRepo: true, replies: [APPROVE] })
    const allowDelete = JSON.stringify({ schemaVersion: 1, rules: [{ id: 'allow-everything', tier: 'allow', tools: ['Bash'], command: '^rm\\s', reason: 'planted' }] })
    // A folder with a rules file and no .git.
    for (const dir of ['plain', 'plain/.claude', 'plain/.claude/council-of-elrond']) w.dirs.add(`${ROOT}/${dir}`)
    w.files.set(`${ROOT}/plain/${RULES}`, allowDelete)
    // A repository inside a repository.
    for (const dir of ['app/sub', 'app/sub/.git', 'app/sub/.claude', 'app/sub/.claude/council-of-elrond']) w.dirs.add(`${ROOT}/${dir}`)
    w.files.set(`${APP}/sub/${RULES}`, allowDelete)

    w.cwd = `${ROOT}/plain`
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    expect(w.modelRequests).toHaveLength(1)
    // It is the root scope's: the line is in the root's log.
    expect(await auditLines(w)).toMatchObject([{ ruleId: 'shell-delete' }])

    w.cwd = `${APP}/sub`
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    expect(w.modelRequests).toHaveLength(2)
    // app's scope: sub is just a folder in it.
    expect(await lines(w, APP)).toMatchObject([{ ruleId: 'shell-delete' }])
    expect(w.files.has(logOf(`${APP}/sub`))).toBe(false)
    expect(w.files.has(logOf(`${ROOT}/plain`))).toBe(false)
  })

  test('a link to a repository is not one; a folder whose .git is a file (a worktree) is', async ($, on) => {
    const w = world(on, { multiRepo: true, replies: [APPROVE] })
    w.dirs.add(`${ROOT}/linked`)
    w.dirs.add(`${ROOT}/linked/.git`)
    w.links.set(`${ROOT}/linked`, LIB)
    w.dirs.add(`${ROOT}/wt`)
    w.files.set(`${ROOT}/wt/.git`, 'gitdir: /home/me/elsewhere\n')
    w.cwd = `${ROOT}/linked`
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    expect(await auditLines(w)).toHaveLength(1)
    expect(w.files.has(logOf(`${ROOT}/linked`))).toBe(false)
    w.cwd = `${ROOT}/wt`
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build2' })
    expect(await lines(w, `${ROOT}/wt`)).toHaveLength(1)
  })

  test('a file edit through a link into another repository touches both', async ($, on) => {
    const w = world(on, { multiRepo: true, replies: [APPROVE] })
    w.links.set(`${APP}/src/linked.ts`, `${LIB}/src/lib.ts`)
    await $.tool.call({ tool: 'Edit', file_path: `${APP}/src/linked.ts`, old_string: 'a', new_string: 'b' })
    expect(await lines(w, APP)).toHaveLength(1)
    expect(await lines(w, LIB)).toHaveLength(1)
  })

  for (const how of ['a rules file at the root', 'a root that is itself a repository'] as const) {
    test(`${how} turns the lookup off: app's file is not read`, async ($, on) => {
      const w = world(on, { multiRepo: true, replies: [APPROVE] })
      if (how === 'a rules file at the root') w.files.set(`${ROOT}/${RULES}`, JSON.stringify({ schemaVersion: 1 }))
      else w.dirs.add(`${ROOT}/.git`)
      w.cwd = APP
      await $.tool.call({ tool: 'Bash', command: 'npm publish' })
      // app's allow rule is not there, and the line is in the root's log.
      expect(w.modelRequests).toHaveLength(1)
      expect(await auditLines(w)).toMatchObject([{ ruleId: 'publish' }])
      expect(w.files.has(logOf(APP))).toBe(false)
    })
  }

  test('shell targets: cd into a repository keeps the root scope for the part before it; an unknowable cd brings in the root', async ($, on) => {
    const w = world(on, { multiRepo: true, replies: [APPROVE] })
    // From the root: `cd app && npm publish` is app's allow rule AND the root's defaults: the stricter.
    await $.tool.call({ tool: 'Bash', command: 'cd app && npm publish' })
    expect(w.modelRequests).toHaveLength(1)
    expect(await lines(w, APP)).toMatchObject([{ ruleId: 'publish' }])
    // From app: a cd to a variable lands at /, outside every repository: the root scope comes in.
    w.cwd = APP
    await $.tool.call({ tool: 'Bash', command: 'cd $X && npm publish --tag y' })
    expect(w.modelRequests).toHaveLength(2)
    // Without the cd it is app's alone.
    expect(await $.tool.call({ tool: 'Bash', command: 'npm publish --tag z' })).toEqual({ result: 'ran' })
    expect(w.modelRequests).toHaveLength(2)
  })

  test('shell targets: a path in another repository brings it in; a path in none does not bring in the root', async ($, on) => {
    const w = world(on, { multiRepo: true, answer: KEEP_BLOCKED, replies: [APPROVE] })
    // From lib, naming app's protected path: app's scope sees it.
    w.cwd = LIB
    await $.tool.call({ tool: 'Bash', command: 'cat ../app/config/secret/x' })
    expect(w.asked).toHaveLength(1)
    expect(await lines(w, APP)).toMatchObject([{ ruleId: 'protected-path' }])
    expect(await lines(w, LIB)).toMatchObject([{ ruleId: 'protected-path' }])
    // /dev/null is in no repository and a path, not a working directory: no root scope.
    w.cwd = APP
    expect(await $.tool.call({ tool: 'Bash', command: 'npm publish > /dev/null' })).toEqual({ result: 'ran' })
    expect(w.modelRequests).toHaveLength(0)
  })

  test('two repositories: the strictest decides', async ($, on) => {
    const w = world(on, { multiRepo: true, replies: [BLOCK] })
    w.cwd = APP
    // app allows `npm publish`; lib's defaults review it. Named together, it is reviewed.
    const deny = denyOf(await $.tool.call({ tool: 'Bash', command: 'npm publish ../lib' }))
    expect(deny).toContain('(block)')
    expect(w.modelRequests).toHaveLength(1)
    expect(w.ran).toEqual([])
    expect(await lines(w, LIB)).toMatchObject([{ tier: 'review', ruleId: 'publish' }])
    // App alone: allowed.
    expect(await $.tool.call({ tool: 'Bash', command: 'npm publish' })).toEqual({ result: 'ran' })
  })

  test('rm -rf of another repository is blocked: the root of the check is the repository', async ($, on) => {
    const w = world(on, { multiRepo: true, replies: [APPROVE] })
    w.cwd = APP
    for (const command of ['rm -rf ../lib', `rm -rf ${LIB}`, 'rm -rf ../lib/src']) {
      const deny = denyOf(await $.tool.call({ tool: 'Bash', command }))
      expect(deny, command).toContain('Recursive delete of the filesystem root, the home directory or a path outside the project.')
    }
    expect(w.modelRequests).toEqual([])
    expect((await lines(w, APP)).map(line => line.ruleId)).toEqual(['rm-recursive-outside-repo', 'rm-recursive-outside-repo', 'rm-recursive-outside-repo'])
    // Inside its own repository it is only reviewed.
    expect(await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })).toEqual({ result: 'ran' })
    expect(w.modelRequests).toHaveLength(1)
  })

  test('a project protected path is anchored at its repository', async ($, on) => {
    const w = world(on, { multiRepo: true, answer: KEEP_BLOCKED, replies: [APPROVE] })
    const edit = (file_path: string) => $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b' })
    await edit(`${APP}/config/secret/x`)
    await edit(`${ROOT}/config/secret/x`)
    await edit(`${LIB}/config/secret/x`)
    expect(w.asked).toHaveLength(1)
    expect((await lines(w, APP)).map(line => line.ruleId)).toEqual(['protected-path'])
    expect((await auditLines(w)).map(line => line.ruleId)).toEqual(['file-write'])
    expect((await lines(w, LIB)).map(line => line.ruleId)).toEqual(['file-write'])
  })
})

const PUSH = 'git push origin feature'

const withChecks = (w: World, path: string, names: readonly string[]): void => {
  w.files.set(path, JSON.stringify({ schemaVersion: 1, gimli: { commands: names.map(name => ({ name, argv: ['run', name] })) } }))
}

describe('the project checks and git, per repository', () => {
  test('a council call in app runs app\'s checks in app', async ($, on) => {
    const w = world(on, { multiRepo: true, isClockMocked: true, replies: [APPROVE] })
    w.cwd = APP
    expect(await $.tool.call({ tool: 'Bash', command: PUSH })).toEqual({ result: 'ran' })
    expect(w.spawned).toEqual([['npm', 'test']])
    expect(w.spawnCwds).toEqual([APP])
    expect((await lines(w, APP))[0]?.council).toMatchObject({ checks: [{ name: 'app-tests', status: 'passed' }] })
  })

  test('two repositories: each check runs in its own directory, eight at most', async ($, on) => {
    const w = world(on, { multiRepo: true, surfaces: [], isClockMocked: true, replies: [APPROVE] })
    withChecks(w, APP_RULES, ['a1', 'a2', 'a3', 'a4', 'a5'])
    withChecks(w, `${LIB}/${RULES}`, ['l1', 'l2', 'l3', 'l4', 'l5'])
    w.cwd = APP
    expect(await $.tool.call({ tool: 'Bash', command: `cd ../lib && ${PUSH}` })).toEqual({ result: 'ran' })
    expect(w.spawned.map(argv => argv[1])).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'l1', 'l2', 'l3'])
    expect(w.spawnCwds).toEqual([APP, APP, APP, APP, APP, LIB, LIB, LIB])
    // /council test lists the same checks.
    await council($, `test "cd ../lib && ${PUSH}"`)
    expect(w.logs.join('\n')).toContain('Gimli would run alongside: "a1", "a2", "a3", "a4", "a5", "l1", "l2", "l3".')
  })

  test('switched off, none runs; the root scope alone keeps today\'s checks', async ($, on) => {
    const w = world(on, { multiRepo: true, isClockMocked: true, replies: [APPROVE] })
    withChecks(w, `${ROOT}/${RULES}`, ['root-check'])
    // A root rules file turns the lookup off: the one scope is the root's, run in the root.
    expect(await $.tool.call({ tool: 'Bash', command: PUSH })).toEqual({ result: 'ran' })
    expect(w.spawned).toEqual([['run', 'root-check']])
    expect(w.spawnCwds).toEqual([ROOT])
  })

  test('git runs in the deciding repository: the previews, the range, the current branch', async ($, on) => {
    const w = world(on, { multiRepo: true, isClockMocked: true, replies: [APPROVE] })
    w.cwd = APP
    await $.tool.call({ tool: 'Bash', command: PUSH })
    expect(w.processes.length).toBeGreaterThan(0)
    expect(new Set(w.processCwds)).toEqual(new Set([APP]))
    w.processes.length = 0
    w.processCwds.length = 0
    await $.tool.call({ tool: 'Bash', command: 'git merge feature' })
    expect(w.processes[0]).toEqual(['git', 'rev-parse', '--abbrev-ref', 'HEAD'])
    expect(new Set(w.processCwds)).toEqual(new Set([APP]))
    // In lib, and at the root, the same.
    for (const dir of [LIB, ROOT]) {
      w.cwd = dir
      w.processes.length = 0
      w.processCwds.length = 0
      await $.tool.call({ tool: 'Bash', command: `git merge feature-${dir.length}` })
      expect(w.processes[0], dir).toEqual(['git', 'rev-parse', '--abbrev-ref', 'HEAD'])
      expect(new Set(w.processCwds), dir).toEqual(new Set([dir]))
    }
  })
})

describe('the audit log, per repository', () => {
  test('a call in app is logged in app, with its .gitignore, and not at the root', async ($, on) => {
    const w = world(on, { multiRepo: true, replies: [APPROVE] })
    w.cwd = APP
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    expect(await lines(w, APP)).toMatchObject([{ tool: 'Bash', ruleId: 'shell-delete', outcome: 'ran' }])
    expect(w.files.get(`${APP}/.claude/council-of-elrond/audit/.gitignore`)).toContain('*')
    expect(w.files.has(logOf(ROOT))).toBe(false)
    expect(w.files.has(`${ROOT}/.claude/council-of-elrond/audit/.gitignore`)).toBe(false)
  })

  test('a call touching two repositories writes one line to each, the same line', async ($, on) => {
    const w = world(on, { multiRepo: true, replies: [APPROVE] })
    w.cwd = APP
    await $.tool.call({ tool: 'Bash', command: 'npm publish ../lib' })
    const inApp = await lines(w, APP)
    const inLib = await lines(w, LIB)
    expect(inApp).toHaveLength(1)
    expect(inLib).toEqual(inApp)
    expect(w.files.get(`${LIB}/.claude/council-of-elrond/audit/.gitignore`)).toContain('*')
    expect(w.files.has(logOf(ROOT))).toBe(false)
  })

  test('a call outside every repository is logged at the root, as before', async ($, on) => {
    const w = world(on, { multiRepo: true, replies: [APPROVE] })
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    expect(await auditLines(w)).toMatchObject([{ ruleId: 'shell-delete' }])
    expect(w.files.has(logOf(APP))).toBe(false)
    expect(w.files.has(logOf(LIB))).toBe(false)
    // The secrets refusal of an allowed call is logged in the same place.
    w.cwd = APP
    await $.tool.call({ tool: 'Bash', command: `echo ${FAKE_AWS_KEY}` })
    expect((await lines(w, APP)).map(line => line.member)).toEqual(['gollum'])
  })

  test('one file named by an absolute path is written once', { options: { auditLogPath: '/var/council.jsonl' } }, async ($, on) => {
    const w = world(on, { multiRepo: true, replies: [APPROVE] })
    w.cwd = APP
    await $.tool.call({ tool: 'Bash', command: 'npm publish ../lib' })
    expect(await auditLines(w, '/var/council.jsonl')).toHaveLength(1)
  })

  test('/council log and report read the log of the working directory\'s repository', async ($, on) => {
    const w = world(on, { multiRepo: true, surfaces: [], replies: [APPROVE] })
    w.cwd = APP
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    await auditLines(w, logOf(APP))
    await council($, 'log')
    expect(w.logs.join('\n')).toContain('Last 1 gated calls')
    w.logs.length = 0
    w.cwd = LIB
    await council($, 'log')
    expect(w.logs.join('\n')).not.toContain('Last 1 gated calls')
  })
})

const SECRET_COMMAND = { tool: 'Bash', command: 'sudo ls' } as const

describe('offers and the allowlist', () => {
  test('no allow-rule offer for a call touching two repositories, or the root scope alone', async ($, on) => {
    const w = world(on, { multiRepo: true, answer: ALLOW_ONCE })
    w.cwd = APP
    expect(await $.tool.call({ tool: 'Bash', command: 'sudo ls ../lib' })).toEqual({ result: 'ran' })
    expect(w.asked).toHaveLength(1)
    w.cwd = ROOT
    expect(await $.tool.call(SECRET_COMMAND)).toEqual({ result: 'ran' })
    expect(w.asked).toHaveLength(2)
    expect([...w.files.keys()].filter(path => path.endsWith(RULES)).sort()).toEqual([APP_RULES])
    expect(JSON.parse(w.files.get(APP_RULES) ?? '{}').rules).toHaveLength(1)
    expect((await auditLines(w)).map(line => line.ruleAdded)).toEqual([undefined])
  })

  test('a call in one repository: the rule is written to that repository\'s file, and the next call sees it', async ($, on) => {
    const w = world(on, { multiRepo: true, answers: [ALLOW_ONCE, 'Add the rule'], answer: KEEP_BLOCKED })
    w.cwd = APP
    expect(await $.tool.call(SECRET_COMMAND)).toEqual({ result: 'ran' })
    expect(w.asked.map(asked => asked.options[0])).toEqual([ALLOW_ONCE, 'Add the rule'])
    const written = JSON.parse(w.files.get(APP_RULES) ?? '{}') as { rules: { id: string }[]; gimli: unknown }
    expect(written.rules.map(rule => rule.id)).toEqual(['app-allow-publish', 'allow-ls'])
    expect(written.gimli).toBeDefined()
    expect(w.files.has(`${ROOT}/${RULES}`)).toBe(false)
    expect((await lines(w, APP))[0]).toMatchObject({ ruleAdded: 'allow-ls' })
    expect(w.logs.join('\n')).toContain('added the allow rule allow-ls')
    // Reloaded: app passes it without a question; lib, whose file is not written, still asks.
    expect(await $.tool.call(SECRET_COMMAND)).toEqual({ result: 'ran' })
    expect(w.asked).toHaveLength(2)
    w.cwd = LIB
    expect(denyOf(await $.tool.call(SECRET_COMMAND))).toContain('(keep blocked)')
    expect(w.asked).toHaveLength(3)
  })

  test('the allowlist option only where one repository\'s file can take the entry', async ($, on) => {
    const secret = { tool: 'Write', content: 'const password = "hunter2xyz"' } as const
    const w = world(on, { multiRepo: true, answer: KEEP_BLOCKED })
    await $.tool.call({ ...secret, file_path: `${APP}/src/db.ts` })
    expect(w.asked[0]?.options).toContain(ALLOWLIST)
    // Outside every repository: the root scope alone, in a root with no rules file.
    await $.tool.call({ ...secret, file_path: `${ROOT}/src/db.ts` })
    expect(w.asked[1]?.options).not.toContain(ALLOWLIST)
    // Two repositories.
    w.cwd = APP
    await $.tool.call({ tool: 'Bash', command: 'echo "password = hunter2xyz" > ../lib/db.txt' })
    expect(w.asked[2]?.options).not.toContain(ALLOWLIST)
    expect(w.asked[2]?.question).toContain('may be a secret')
  })

  test('the allowlist entry goes to that repository\'s file and is honoured there', async ($, on) => {
    const w = world(on, { multiRepo: true, answers: [ALLOWLIST, 'Add it'], answer: KEEP_BLOCKED, replies: [APPROVE] })
    const call = { tool: 'Write', file_path: `${APP}/src/db.ts`, content: 'const password = "hunter2xyz"' } as const
    expect(await $.tool.call(call)).toEqual({ result: 'ran' })
    const written = JSON.parse(w.files.get(APP_RULES) ?? '{}') as { rules: unknown[]; gollum?: { allowlist?: string[] } }
    expect(written.gollum?.allowlist).toHaveLength(1)
    expect(written.rules).toHaveLength(1)
    expect(w.files.has(`${ROOT}/${RULES}`)).toBe(false)
    await $.tool.call(call)
    expect(w.asked).toHaveLength(2)
  })

  test('the secrets allowlist is the intersection of the touched repositories\'', async ($, on) => {
    const acme = 'ACME-12345678'
    const w = world(on, { multiRepo: true, replies: [APPROVE] })
    w.files.set(
      APP_RULES,
      JSON.stringify({ schemaVersion: 1, gollum: { patterns: [{ id: 'acme', level: 'high', regex: 'ACME-[0-9]{8}', label: 'Acme key' }], allowlist: [acme] } }),
    )
    w.cwd = APP
    // App allows its own key: reviewed, not refused as a secret.
    expect(await $.tool.call({ tool: 'Bash', command: `echo ${acme} > k.txt` })).toEqual({ result: 'ran' })
    // Touching lib too, whose list does not hold it: refused by the scan (app's pattern still applies).
    const deny = denyOf(await $.tool.call({ tool: 'Bash', command: `echo ${acme} > ../lib/k.txt` }))
    expect(deny).toContain('the secrets scan (block)')
    expect(deny).toContain('Acme key')
    // The key is not redacted into the refusal, and lib alone does not know the pattern.
    expect(deny).not.toContain(acme)
    w.cwd = LIB
    expect(await $.tool.call({ tool: 'Bash', command: `echo ${acme} > k.txt` })).toEqual({ result: 'ran' })
  })
})

describe('the verdict cache and the chat key', () => {
  test('an approval in app does not carry over to the same command in lib', async ($, on) => {
    const w = world(on, { multiRepo: true, replies: [APPROVE] })
    w.cwd = APP
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    expect(w.modelRequests).toHaveLength(1)
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    expect(w.modelRequests).toHaveLength(1)
    w.cwd = LIB
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    expect(w.modelRequests).toHaveLength(2)
  })

  test('the root scope alone keeps today\'s keys; a repository\'s are tagged with its directory', async ($, on) => {
    const w = world(on, { multiRepo: true, replies: [APPROVE] })
    const state = watchState(on)
    const input = { command: 'rm -rf build' }
    await $.tool.call({ tool: 'Bash', ...input })
    expect((state.written.at(-1) as CouncilSession).cache).toEqual([await fingerprintOf('Bash', input)])
    w.cwd = APP
    await $.tool.call({ tool: 'Bash', ...input })
    expect((state.written.at(-1) as CouncilSession).cache).toEqual([await fingerprintOf('Bash', input), await fingerprintOf('Bash', input, APP)])
    // The audit line keeps the plain fingerprint, in either place.
    expect((await lines(w, APP))[0]?.fingerprint).toBe(await fingerprintOf('Bash', input))
    expect((await auditLines(w))[0]?.fingerprint).toBe(await fingerprintOf('Bash', input))
  })

  test('the code a person types is the repository\'s: the same call has two codes', async ($, on) => {
    const w = world(on, { multiRepo: true, surfaces: [] })
    const state = watchState(on)
    const call = { tool: 'Bash', command: 'sudo ls' } as const
    await $.tool.call(call)
    w.cwd = APP
    await $.tool.call(call)
    w.cwd = LIB
    await $.tool.call(call)
    const offers = (state.written.at(-1) as CouncilSession).chatOffers
    const input = { command: 'sudo ls' }
    expect(offers.map(offer => offer.callKey)).toEqual([
      await callKeyOf({ tool: 'Bash', input }),
      await callKeyOf({ tool: 'Bash', input }, APP),
      await callKeyOf({ tool: 'Bash', input }, LIB),
    ])
    expect(new Set(offers.map(offer => offer.code)).size).toBe(3)
  })
})

describe('reloading', () => {
  test('a repository\'s file is read once; /council reload reads it again, and sees a repository made since', async ($, on) => {
    const w = world(on, { multiRepo: true, replies: [APPROVE] })
    w.cwd = APP
    expect(await $.tool.call({ tool: 'Bash', command: 'npm publish' })).toEqual({ result: 'ran' })
    // The file changes on disk: not seen until reload.
    w.files.set(APP_RULES, JSON.stringify({ schemaVersion: 1 }))
    expect(await $.tool.call({ tool: 'Bash', command: 'npm publish --tag a' })).toEqual({ result: 'ran' })
    expect(w.modelRequests).toHaveLength(0)
    await council($, 'reload')
    await $.tool.call({ tool: 'Bash', command: 'npm publish --tag b' })
    expect(w.modelRequests).toHaveLength(1)

    // A folder that was not a repository is remembered as not one, until reload.
    for (const dir of ['fresh', 'fresh/.claude', 'fresh/.claude/council-of-elrond']) w.dirs.add(`${ROOT}/${dir}`)
    w.cwd = `${ROOT}/fresh`
    await $.tool.call({ tool: 'Bash', command: 'npm publish' })
    expect(w.modelRequests).toHaveLength(2)
    w.dirs.add(`${ROOT}/fresh/.git`)
    w.files.set(`${ROOT}/fresh/${RULES}`, JSON.stringify({ schemaVersion: 1, rules: [{ id: 'fresh-publish', tier: 'allow', tools: ['Bash'], command: '^npm\\s+publish', reason: 'ok' }] }))
    await $.tool.call({ tool: 'Bash', command: 'npm publish --tag c' })
    expect(w.modelRequests).toHaveLength(3)
    await council($, 'reload')
    expect(await $.tool.call({ tool: 'Bash', command: 'npm publish --tag d' })).toEqual({ result: 'ran' })
    expect(w.modelRequests).toHaveLength(3)
  })

  test('a broken file warns once, naming the repository-relative path, and the defaults stand', async ($, on) => {
    const w = world(on, { multiRepo: true, replies: [APPROVE] })
    w.files.set(APP_RULES, '{ not json')
    w.cwd = APP
    await $.tool.call({ tool: 'Bash', command: 'npm publish' })
    await $.tool.call({ tool: 'Bash', command: 'npm publish --tag a' })
    const warnings = w.logs.filter(line => line.includes(RULES))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).not.toContain(ROOT)
    // The defaults stand: `npm publish` is reviewed, not allowed.
    expect(w.modelRequests).toHaveLength(2)
  })
})

describe('/council in a repository', () => {
  test('rules and models read the working directory\'s repository; test classifies like a real call', async ($, on) => {
    const w = world(on, { multiRepo: true, surfaces: [] })
    w.cwd = APP
    await council($, 'rules')
    expect(w.logs.join('\n')).toContain('app-allow-publish')
    w.logs.length = 0
    w.cwd = LIB
    await council($, 'rules')
    expect(w.logs.join('\n')).not.toContain('app-allow-publish')
    w.logs.length = 0
    w.cwd = APP
    await council($, 'test "npm publish"')
    expect(w.logs.join('\n')).toContain('Tier: allow')
    w.logs.length = 0
    await council($, 'test "npm publish ../lib"')
    expect(w.logs.join('\n')).toContain('Tier: review')
  })
})
