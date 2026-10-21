import { describe, expect, test } from 'claude-code/testing'

import { APPROVE, auditLines, ROOT, world } from './fixtures.js'

/**
 * Where the mod's own git runs (DESIGN §13.4 item 5): in the folder a call's
 * `cd` leads to, if that really lies inside the root; nowhere if git would
 * run elsewhere (a location variable, a folder outside the root).
 */

const SUB = `${ROOT}/sub`

describe('git in the folder the call works in', () => {
  test('a cd inside the root: the previews and the range diff run in that folder', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    w.dirs.add(SUB)
    expect(await $.tool.call({ tool: 'Bash', command: 'cd sub && git push origin feature' })).toEqual({ result: 'ran' })
    expect(w.processes.map(argv => argv[1])).toEqual(['rev-parse', 'remote', 'log', 'diff'])
    expect(w.processCwds).toEqual([SUB, SUB, SUB, SUB])
  })

  test('no cd: git runs where it always did, in the deciding scope', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    await $.tool.call({ tool: 'Bash', command: 'git push origin feature' })
    expect(w.processes).toHaveLength(4)
    expect(new Set(w.processCwds)).toEqual(new Set([ROOT]))
  })

  test('a cd into a link that lands outside the root: no git runs, and the diff reviewer sits out', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    w.dirs.add(`${ROOT}/out`)
    w.links.set(`${ROOT}/out`, '/elsewhere')
    expect(await $.tool.call({ tool: 'Bash', command: 'cd out && git push origin feature' })).toEqual({ result: 'ran' })
    expect(w.processes).toEqual([])
    expect((await auditLines(w))[0]).toMatchObject({ council: { voices: [{ member: 'gandalf' }, { member: 'legolas', verdict: 'skipped' }, { member: 'aragorn' }] } })
  })

  test('a cd into a link that stays inside the root runs git at its real folder', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    w.dirs.add(SUB)
    w.dirs.add(`${ROOT}/alias`)
    w.links.set(`${ROOT}/alias`, SUB)
    await $.tool.call({ tool: 'Bash', command: 'cd alias && git push origin feature' })
    expect(w.processes).toHaveLength(4)
    expect(new Set(w.processCwds)).toEqual(new Set([SUB]))
  })

  test('a cd outside the root, or to an unknowable place: the diff reviewer sits out, no git runs', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    for (const command of ['cd ../other && git push origin feature', 'cd $WHERE && git push origin feature']) {
      expect(await $.tool.call({ tool: 'Bash', command }), command).toEqual({ result: 'ran' })
    }
    expect(w.processes).toEqual([])
    const lines = await auditLines(w)
    expect(lines).toHaveLength(2)
    for (const line of lines) {
      expect(line).toMatchObject({ council: { voices: [{ member: 'gandalf' }, { member: 'legolas', verdict: 'skipped' }, { member: 'aragorn' }] } })
    }
    expect(w.processes.filter(argv => argv[1] === 'diff')).toEqual([])
  })

  test('a location variable: no git runs, and the diff reviewer sits out', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    await $.tool.call({ tool: 'Bash', command: 'GIT_DIR=/x git push origin feature' })
    await $.tool.call({ tool: 'Bash', command: 'export GIT_WORK_TREE=/x; git push origin other' })
    expect(w.processes).toEqual([])
    for (const line of await auditLines(w)) {
      expect(line).toMatchObject({ council: { voices: [{ member: 'gandalf' }, { member: 'legolas', verdict: 'skipped' }, { member: 'aragorn' }] } })
    }
  })
})

describe('the current branch of a merge', () => {
  test('read in the first merge part\'s folder, so a merge into a topic branch there is not a big operation', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    w.dirs.add(SUB)
    w.processReply = argv => (argv[1] === 'rev-parse' ? { exitCode: 0, stdout: 'topic\n' } : { exitCode: 0, stdout: '' })
    await $.tool.call({ tool: 'Bash', command: 'cd sub && git merge feature' })
    // The preview's read and the branch read, both there.
    expect(w.processes.filter(argv => argv[1] === 'rev-parse')).toHaveLength(2)
    expect(new Set(w.processCwds)).toEqual(new Set([SUB]))
    expect((await auditLines(w))[0]).toMatchObject({ member: 'aragorn', profile: 'git' })
  })

  test('a merge git would run elsewhere has an unknown branch: it counts as into a protected one, and nothing is read', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    w.processReply = argv => (argv[1] === 'rev-parse' ? { exitCode: 0, stdout: 'topic\n' } : { exitCode: 0, stdout: '' })
    await $.tool.call({ tool: 'Bash', command: 'GIT_DIR=/x git merge feature' })
    await $.tool.call({ tool: 'Bash', command: 'cd ../other && git merge other' })
    expect(w.processes).toEqual([])
    const lines = await auditLines(w)
    expect(lines[0]).toMatchObject({ member: 'council', council: { entry: 'merge-to-protected' } })
    expect(lines[1]).toMatchObject({ member: 'council', council: { entry: 'merge-to-protected' } })
  })

  test('one merge part that would run elsewhere is enough: the branch is not read', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    w.processReply = argv => (argv[1] === 'rev-parse' ? { exitCode: 0, stdout: 'topic\n' } : { exitCode: 0, stdout: '' })
    await $.tool.call({ tool: 'Bash', command: 'git merge a && git -C /x merge b' })
    // Only the first part's preview reads a branch (the second runs elsewhere); the branch read for the decision is skipped.
    expect(w.processes.filter(argv => argv[1] === 'rev-parse')).toHaveLength(1)
    expect((await auditLines(w))[0]).toMatchObject({ member: 'council', council: { entry: 'merge-to-protected' } })
  })

  test('a cd into a link that lands outside the root: the branch is unknown', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    w.dirs.add(`${ROOT}/out`)
    w.links.set(`${ROOT}/out`, '/elsewhere')
    w.processReply = argv => (argv[1] === 'rev-parse' ? { exitCode: 0, stdout: 'topic\n' } : { exitCode: 0, stdout: '' })
    await $.tool.call({ tool: 'Bash', command: 'cd out && git merge feature' })
    expect(w.processes.filter(argv => argv[1] === 'rev-parse')).toEqual([])
    expect((await auditLines(w))[0]).toMatchObject({ member: 'council', council: { entry: 'merge-to-protected' } })
  })
})

describe('no configured program starts in an inspection', () => {
  test('every git process the mod runs carries the config overrides', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    w.dirs.add(SUB)
    w.processReply = argv => (argv[1] === 'rev-parse' ? { exitCode: 0, stdout: 'main\n' } : { exitCode: 0, stdout: '' })
    await $.tool.call({ tool: 'Bash', command: 'git push origin feature' })
    await $.tool.call({ tool: 'Bash', command: 'git merge feature' })
    await $.tool.call({ tool: 'Bash', command: 'git reset --hard HEAD~1' })
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/app.ts`, content: 'x' })
    expect(w.processes.length).toBeGreaterThan(8)
    expect(new Set(w.processes.map(argv => argv[1]))).toEqual(new Set(['rev-parse', 'remote', 'log', 'diff', 'status', 'ls-files']))
    expect(w.processEnvs).toHaveLength(w.processes.length)
    for (const env of w.processEnvs) {
      expect(env).toMatchObject({
        GIT_CONFIG_COUNT: '2',
        GIT_CONFIG_KEY_0: 'core.fsmonitor',
        GIT_CONFIG_VALUE_0: 'false',
        GIT_CONFIG_KEY_1: 'log.showSignature',
        GIT_CONFIG_VALUE_1: 'false',
      })
    }
  })
})
