import { describe, expect, test } from 'claude-code/testing'

import { rangeOf } from '../hooks/elrond/council.js'
import { broadPushNote, formatPreview, MAX_INSPECTIONS, planPreview, rangeDiffInspections, unseenPushNote } from '../hooks/members/galadriel.js'
import { classify } from '../hooks/rules/classify.js'
import type { Call } from '../hooks/rules/classify.js'
import { APPROVE, auditLines, CONTEXT, FAKE_GITHUB_TOKEN, KEEP_BLOCKED, ROOT, SHIPPED_COMPILED, world } from './fixtures.js'

const plan = (call: Call) => planPreview(call, classify(call, SHIPPED_COMPILED, CONTEXT), CONTEXT)
const bash = (command: string) => plan({ tool: 'Bash', input: { command } })
const rangeDiffs = (command: string, kind: 'push' | 'merge') => {
  const call: Call = { tool: 'Bash', input: { command } }
  const classification = classify(call, SHIPPED_COMPILED, CONTEXT)
  const range = rangeOf(classification)
  return range === undefined ? undefined : rangeDiffInspections(kind, range.part, call, CONTEXT, classification.findings.find(finding => finding.part === range.part)?.cwd)
}
/** The first range's diff inspection (a push with one refspec has just that one). */
const rangeDiff = (command: string, kind: 'push' | 'merge') => rangeDiffs(command, kind)?.inspections[0]

describe('the plan comes from the table alone', () => {
  test('a delete lists its targets with no process', () => {
    expect(bash('rm -rf build dist')).toEqual([
      { kind: 'path', label: 'rm target build', path: `${ROOT}/build` },
      { kind: 'path', label: 'rm target dist', path: `${ROOT}/dist` },
    ])
    expect(bash('rm -rf build/*')).toEqual([])
    expect(bash('find build -name "*.o" -delete')).toEqual([{ kind: 'path', label: 'find target build', path: `${ROOT}/build` }])
  })

  test('a push shows the branch, the remote and the commits it would send', () => {
    expect(bash('git push origin main').map(step => (step.kind === 'git' ? step.argv : []))).toEqual([
      ['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
      ['git', 'remote', 'get-url', 'origin'],
      ['git', 'log', '--oneline', '-n', '30', 'origin/main..main', '--'],
    ])
    const bare = bash('git push')
    expect(bare.at(-1)).toMatchObject({ argv: ['git', 'log', '--oneline', '-n', '30', '@{upstream}..HEAD', '--'] })
  })

  test('a push naming a remote carries a fixed fallback against the remote default branch; nothing else does', () => {
    const log = bash('git push origin feature').at(-1)
    expect(log).toMatchObject({
      argv: ['git', 'log', '--oneline', '-n', '30', 'origin/feature..feature', '--'],
      orElse: {
        label: 'commits it would send (origin/HEAD..feature: the remote has no such branch yet, so against its default branch)',
        argv: ['git', 'log', '--oneline', '-n', '30', 'origin/HEAD..feature', '--'],
      },
    })
    expect(rangeDiff('git push origin feature', 'push')).toMatchObject({
      label: 'origin/feature..feature',
      argv: ['git', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', 'origin/feature..feature', '--'],
      orElse: { label: 'origin/HEAD...feature', argv: ['git', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', 'origin/HEAD...feature', '--'] },
    })
    // No remote named: no known remote, no fallback.
    expect(bash('git push').at(-1)).not.toHaveProperty('orElse')
    expect(rangeDiff('git push', 'push')).not.toHaveProperty('orElse')
    // A merge has none.
    expect(bash('git merge feature').at(-1)).not.toHaveProperty('orElse')
    expect(rangeDiff('git merge feature', 'merge')).not.toHaveProperty('orElse')
    // An option never becomes the remote, and a remote git could read as anything but a name gets no fallback.
    for (const command of ['git push --upload-pack=x', 'git push -o', 'git push a..b feature', 'git push a:b feature']) {
      for (const step of bash(command)) expect(step, command).not.toHaveProperty('orElse')
      expect(rangeDiff(command, 'push'), command).not.toHaveProperty('orElse')
    }
    for (const step of bash('git push --upload-pack=x origin feature')) {
      if (step.kind === 'git') for (const argv of [step.argv, ...(step.kind === 'git' && step.orElse !== undefined ? [step.orElse.argv] : [])]) expect(argv.slice(1).filter(word => word.startsWith('--upload'))).toEqual([])
    }
    // The fallback is an alternative inside a step, never a step of its own, so the cap holds.
    const steps = bash('git push origin feature && git push upstream topic')
    expect(steps.length).toBeLessThanOrEqual(MAX_INSPECTIONS)
    for (const step of steps) if (step.kind === 'git') expect(step.argv).not.toContain('origin/HEAD..feature')
    expect(bash('git push origin feature')).toHaveLength(3)
  })

  test('a merge shows the branch and the commits it would bring in', () => {
    expect(bash('git merge --no-ff feature').map(step => (step.kind === 'git' ? step.argv : []))).toEqual([
      ['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
      ['git', 'log', '--oneline', '-n', '30', 'HEAD..feature', '--'],
    ])
    expect(bash('git merge --abort')).toHaveLength(1)
    expect(bash('git merge -m fix -s ort feature').at(1)).toMatchObject({ argv: ['git', 'log', '--oneline', '-n', '30', 'HEAD..feature', '--'] })
  })

  test('names that would read as options never reach git', () => {
    for (const command of ['git push --upload-pack=evil origin main', 'git push -- --output=x main', 'git push origin --exec=x']) {
      for (const step of bash(command)) {
        if (step.kind !== 'git') continue
        expect(step.argv.slice(1).filter(word => /^--?(upload|output|exec)/.test(word)), command).toEqual([])
      }
    }
    expect(bash('git -C /elsewhere push origin main')).toEqual([])
  })

  test('reset and rebase show recent history; file writes show the diff and tracking', () => {
    expect(bash('git reset --hard HEAD~3').map(step => (step.kind === 'git' ? step.argv[1] : ''))).toEqual(['log', 'status'])
    expect(bash('git commit --amend -m x').at(0)).toMatchObject({ argv: ['git', 'log', '--oneline', '--decorate=short', '-n', '20', '--'] })
    const write = plan({ tool: 'Write', input: { file_path: `${ROOT}/src/app.ts`, content: 'x' } })
    expect(write.map(step => (step.kind === 'git' ? step.argv : []))).toEqual([
      ['git', 'diff', '--stat', '--no-ext-diff', '--no-textconv', 'HEAD', '--', 'src/app.ts'],
      ['git', 'ls-files', '--error-unmatch', '--', 'src/app.ts'],
    ])
    expect(plan({ tool: 'Write', input: { file_path: '/etc/hosts', content: 'x' } })).toEqual([])
  })

  test('nothing without a table entry gets a preview, and at most three steps', () => {
    expect(bash('curl -X POST https://example.com')).toEqual([])
    expect(bash('rm -rf a b c d e')).toHaveLength(3)
  })

  test('the preview is cut to the line limit', () => {
    const preview = formatPreview([{ kind: 'git', label: 'recent commits', exitCode: 0, stdout: Array.from({ length: 50 }, (_, i) => `c${i}`).join('\n') }], 10)
    expect(preview?.split('\n').length).toBeLessThanOrEqual(11)
    expect(preview).toMatch(/\[\.\.\. \d+ lines, \d+ characters omitted \.\.\.\]/)
    expect(formatPreview([{ kind: 'failed', label: 'x' }], 10)).toBeUndefined()
  })
})

const gitSteps = (command: string) => bash(command).filter(step => step.kind === 'git')

describe('where git would run', () => {
  test('a part git would run elsewhere gets no git inspection and no range diff', () => {
    for (const command of [
      'cd ../other && git push origin main',
      'cd $X && git push origin main',
      'cd "$(mktemp -d)" && git push origin main',
      'GIT_DIR=/x git push origin main',
      'GIT_WORK_TREE=/x git push origin main',
      'env GIT_WORK_TREE=/x git push',
      // Quoted, so the raw text has no word boundary before the name: the parsed words catch it.
      "env 'GIT_DIR=/x' git push origin main",
      'env "GIT_WORK_TREE=/x" git push origin main',
      'export GIT_DIR=/x; git push origin main',
      'export GIT_DIR=/x && git push origin main',
      'GIT_INDEX_FILE=/x git push origin main',
      'GIT_NAMESPACE=x git push origin main',
      'git --namespace=x push origin main',
      'git --namespace x push origin main',
      'git -C /x push origin main',
      'git push origin main; GIT_COMMON_DIR=/x git status',
    ]) {
      expect(gitSteps(command), command).toEqual([])
      expect(rangeDiff(command, 'push'), command).toBeUndefined()
    }
    expect(gitSteps('GIT_DIR=/x git merge feature')).toEqual([])
    expect(rangeDiff('GIT_DIR=/x git merge feature', 'merge')).toBeUndefined()
    expect(gitSteps('GIT_DIR=/x git reset --hard HEAD~1')).toEqual([])
    // Unrelated variables, and git in the root, are as before.
    expect(gitSteps('GIT_TRACE=1 git push origin main')).toHaveLength(3)
    expect(gitSteps('cd . && git push origin main')).toHaveLength(3)
  })

  test('a cd inside the root tags the git inspections with that folder; none leaves them untagged', () => {
    const inside = gitSteps('cd sub && git push origin main')
    expect(inside.map(step => (step.kind === 'git' ? step.argv[1] : ''))).toEqual(['rev-parse', 'remote', 'log'])
    for (const step of inside) expect(step).toMatchObject({ cwd: `${ROOT}/sub` })
    expect(gitSteps('cd sub && git merge feature').at(-1)).toMatchObject({ cwd: `${ROOT}/sub` })
    expect(gitSteps('cd sub && git reset --hard HEAD~1').at(0)).toMatchObject({ cwd: `${ROOT}/sub` })
    expect(rangeDiff('cd sub && git push origin main', 'push')).toMatchObject({ cwd: `${ROOT}/sub` })
    for (const step of gitSteps('git push origin main')) expect(step).not.toHaveProperty('cwd')
    expect(rangeDiff('git push origin main', 'push')).not.toHaveProperty('cwd')
    // Back at the session's folder after a cd there and back: no tag.
    for (const step of gitSteps('cd sub && cd .. && git push origin main')) expect(step).not.toHaveProperty('cwd')
    // The same command in two folders is two inspections, not one.
    const two = bash('cd a && git reset --hard HEAD~1 && cd ../b && git reset --hard HEAD~1')
    expect(two.map(step => (step.kind === 'git' ? step.cwd : undefined))).toEqual([`${ROOT}/a`, `${ROOT}/a`, `${ROOT}/b`])
    // Path inspections are unchanged by a cd.
    expect(bash('cd sub && rm -rf build')).toEqual([{ kind: 'path', label: 'rm target build', path: `${ROOT}/sub/build` }])
  })

  test('the value of a push option is not the remote or the branch', () => {
    for (const command of ['git push -o ci.skip origin main', 'git push --push-option x origin main', 'git push --receive-pack x origin main', 'git push origin main -o ci.skip']) {
      expect(gitSteps(command).map(step => (step.kind === 'git' ? step.argv : [])), command).toEqual([
        ['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
        ['git', 'remote', 'get-url', 'origin'],
        ['git', 'log', '--oneline', '-n', '30', 'origin/main..main', '--'],
      ])
      expect(rangeDiff(command, 'push'), command).toMatchObject({ label: 'origin/main..main' })
    }
  })

  test('a quoted delete target is the same as an unquoted one', () => {
    expect(bash('rm -r "build dir"')).toEqual([{ kind: 'path', label: 'rm target build dir', path: `${ROOT}/build dir` }])
    expect(bash("rm -r 'x'")).toEqual(bash('rm -r x'))
    expect(bash("rm -r 'x'")).toEqual([{ kind: 'path', label: 'rm target x', path: `${ROOT}/x` }])
  })

  test('no configured program starts: the write diff turns off external diff and textconv', () => {
    const write = plan({ tool: 'Write', input: { file_path: `${ROOT}/src/app.ts`, content: 'x' } })
    const diff = write[0]
    expect(diff?.kind === 'git' ? diff.argv.slice(0, 5) : []).toEqual(['git', 'diff', '--stat', '--no-ext-diff', '--no-textconv'])
  })
})

/** The range each refspec's commit list (and its diff) reads, in order. */
const logRanges = (command: string) => gitSteps(command).flatMap(step => (step.kind === 'git' && step.argv[1] === 'log' ? [step.argv.at(-2)] : []))
const diffRanges = (command: string) => rangeDiffs(command, 'push')?.inspections.flatMap(step => (step.kind === 'git' ? [step.argv.at(-2)] : []))
const noteLabels = (command: string) => bash(command).flatMap(step => (step.kind === 'note' ? [step.label] : []))

describe('what a push shows is what it pushes (DESIGN §15)', () => {
  test('a refspec is read from its own source, never from HEAD unless it names HEAD', () => {
    for (const [command, range] of [
      ['git push origin other:main', 'origin/main..other'],
      ['git push origin other', 'origin/other..other'],
      ['git push origin +other:refs/heads/staging', 'origin/staging..other'],
      ['git push -f origin other-branch', 'origin/other-branch..other-branch'],
      ['git push origin HEAD:main', 'origin/main..HEAD'],
      ['git push origin refs/heads/a:refs/heads/b', 'origin/b..refs/heads/a'],
      ['git push origin v1.0', 'origin/v1.0..v1.0'],
      ['git push origin HEAD~2:main', 'origin/main..HEAD~2'],
    ] as const) {
      expect(logRanges(command), command).toEqual([range])
      expect(diffRanges(command), command).toEqual([range])
      expect(bash(command).filter(step => step.kind === 'note'), command).toEqual([])
    }
    // The label says the range that was computed.
    expect(bash('git push origin other:main').at(-1)).toMatchObject({ label: 'commits it would send (origin/main..other)' })
  })

  test('several refspecs each get their own range, in the preview and in the diff', () => {
    expect(logRanges('git push origin a b')).toEqual(['origin/a..a', 'origin/b..b'])
    expect(diffRanges('git push origin a b')).toEqual(['origin/a..a', 'origin/b..b'])
    expect(logRanges('git push origin a:x b:y c')).toEqual(['origin/x..a', 'origin/y..b', 'origin/c..c'])
    // The same range twice is one.
    expect(logRanges('git push origin a a')).toEqual(['origin/a..a'])
    // Each carries its own default-branch fallback, for a branch the remote lacks.
    const steps = gitSteps('git push origin a:x b')
    expect(steps.at(-2)).toMatchObject({ orElse: { argv: ['git', 'log', '--oneline', '-n', '30', 'origin/HEAD..a', '--'] } })
    expect(steps.at(-1)).toMatchObject({ orElse: { argv: ['git', 'log', '--oneline', '-n', '30', 'origin/HEAD..b', '--'] } })
    expect(rangeDiffs('git push origin a:x b', 'push')?.inspections.at(1)).toMatchObject({ orElse: { label: 'origin/HEAD...b' } })
    // Three refspecs: the branch, the remote and three lists, all there (the cap rises by the extra lists).
    expect(bash('git push origin a b c')).toHaveLength(5)
    expect(bash('git push origin a b c').filter(step => step.kind === 'git' && step.isCommits === true)).toHaveLength(3)
    // Other inspections are held to the usual cap.
    expect(bash('rm -rf a b c d e')).toHaveLength(MAX_INSPECTIONS)
  })

  test('a push that names no refspec sends the current branch: as before', () => {
    expect(logRanges('git push')).toEqual(['@{upstream}..HEAD'])
    expect(logRanges('git push origin')).toEqual(['@{upstream}..HEAD'])
    expect(diffRanges('git push origin')).toEqual(['@{upstream}..HEAD'])
    expect(rangeDiff('git push origin', 'push')).toMatchObject({ orElse: { label: 'origin/HEAD...HEAD' } })
    expect(bash('git push -u origin').filter(step => step.kind === 'note')).toEqual([])
  })

  test('--all, --mirror and --tags with no refspec: the current branch is listed, and the preview says the push sends more', () => {
    for (const command of ['git push --all origin', 'git push --mirror origin', 'git push --tags origin', 'git push origin --tags', 'git push --all', 'git push -u --tags']) {
      expect(logRanges(command), command).toEqual(['@{upstream}..HEAD'])
      expect(noteLabels(command), command).toEqual([broadPushNote])
    }
    // The council's diff of a push carries it too. (The shipped rules block `--all` and `--mirror`, so only `--tags` is a review.)
    for (const command of ['git push --tags origin', 'git push origin --tags', 'git push -u --tags']) {
      expect(diffRanges(command), command).toEqual(['@{upstream}..HEAD'])
      expect(rangeDiffs(command, 'push')?.notes, command).toEqual([broadPushNote])
    }
    expect(broadPushNote).toBe('This push sends more branches or tags than the commits shown: only the current branch is listed, so what the others would send is unknown.')
    // A note is not a step against the cap.
    expect(bash('git push --tags origin')).toHaveLength(4)
    // Named refspecs are each read, as before; and an ordinary push has no such note.
    for (const command of ['git push --tags origin v1.0', 'git push origin main', 'git push origin', 'git push -u origin']) expect(noteLabels(command), command).toEqual([])
  })

  test('a delete sends no commits: no range, and none of the current branch', () => {
    for (const command of ['git push origin :old', 'git push origin --delete old', 'git push -d origin old', 'git push origin +:old']) {
      expect(logRanges(command), command).toEqual([])
      expect(diffRanges(command), command).toEqual([])
      expect(rangeDiffs(command, 'push')?.notes, command).toEqual([])
      expect(bash(command).map(step => (step.kind === 'git' ? step.argv[1] : step.kind)), command).toEqual(['rev-parse', 'remote'])
    }
    // Next to a real refspec, the delete is skipped and the rest shown.
    expect(logRanges('git push origin :old feature')).toEqual(['origin/feature..feature'])
  })

  test('a source or destination that is not a safe ref has no range, and the preview says so', () => {
    const one = unseenPushNote(1)
    for (const command of ['git push origin "a b":main', 'git push origin a..b:main', 'git push origin "main*":main', 'git push origin a:"b c"', 'git push origin "$X":main', 'git push origin "a;b"']) {
      expect(logRanges(command), command).toEqual([])
      expect(diffRanges(command), command).toEqual([])
      expect(noteLabels(command), command).toEqual([one])
      expect(rangeDiffs(command, 'push')?.notes, command).toEqual([one])
      // Never the current branch's commits as the push's.
      for (const range of logRanges(command)) expect(range).not.toMatch(/HEAD$/)
    }
    // A push of several refspecs, some unreadable: the readable ones stay, the note counts the rest.
    expect(logRanges('git push origin "a b":x c "d e":y')).toEqual(['origin/c..c'])
    expect(noteLabels('git push origin "a b":x c "d e":y')).toEqual([unseenPushNote(2)])
    expect(unseenPushNote(2)).toBe('The commits 2 refspecs of this push would send could not be shown, so what they send is unknown.')
    expect(one).toBe('The commits one refspec of this push would send could not be shown, so what it sends is unknown.')
  })

  test('with no remote that is a plain name, a named refspec has no range to compare against', () => {
    for (const command of ['git push https://example.com/r.git feature', 'git push git@example.com:r.git feature:main', 'git push a..b feature']) {
      expect(logRanges(command), command).toEqual([])
      expect(noteLabels(command), command).toEqual([unseenPushNote(1)])
    }
    // No remote and no refspec is the current branch to its upstream, as before.
    expect(logRanges('git push --upload-pack=x')).toEqual(['@{upstream}..HEAD'])
  })

  test('more than three refspecs: the first three, and the preview says there are more', () => {
    const command = 'git push origin a b c d e'
    expect(logRanges(command)).toEqual(['origin/a..a', 'origin/b..b', 'origin/c..c'])
    expect(diffRanges(command)).toEqual(['origin/a..a', 'origin/b..b', 'origin/c..c'])
    const note = 'This push names 5 refspecs and commits are shown for the first 3 only, so what the others would send is unknown.'
    expect(noteLabels(command)).toEqual([note])
    expect(rangeDiffs(command, 'push')?.notes).toEqual([note])
    // Exactly three is not more.
    expect(noteLabels('git push origin a b c')).toEqual([])
    // Past the cap, an unreadable one is not counted as unreadable: it was not looked at.
    expect(noteLabels('git push origin a b c "d e":x')).toEqual(['This push names 4 refspecs and commits are shown for the first 3 only, so what the others would send is unknown.'])
  })

  test('the range diff of a merge is as it was', () => {
    expect(rangeDiffs('git merge feature', 'merge')).toMatchObject({ inspections: [{ label: 'HEAD...feature' }], notes: [] })
    expect(rangeDiffs('git merge --abort', 'merge')).toBeUndefined()
    expect(rangeDiffs('git -C /x push origin other:main', 'push')).toBeUndefined()
  })

  test('refs reach git only after the safe-ref check, and the push itself is never an argument', () => {
    for (const command of ['git push origin --upload-pack=x:main', 'git push origin "-x":main', 'git push origin a:"-b"', 'git push origin "a b" c']) {
      for (const step of [...gitSteps(command), ...(rangeDiffs(command, 'push')?.inspections ?? [])]) {
        if (step.kind !== 'git' || !['log', 'diff'].includes(step.argv[1] ?? '')) continue
        expect(step.argv.slice(1).filter(word => /^--?(upload|output|exec|x$|b$)/.test(word)), command).toEqual([])
        expect(step.argv.at(-1)).toBe('--')
      }
    }
  })
})

describe('in the pipeline', () => {
  test('a push of another branch shows that branch\'s commits, never the checked-out branch\'s', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    w.processReply = argv => {
      if (argv[1] === 'log') return { exitCode: 0, stdout: argv.at(-2) === 'origin/main..other' ? 'aaa111 Work on other\n' : 'bbb222 The checked-out branch\n' }
      return { exitCode: 0, stdout: 'feature\n' }
    }
    await $.tool.call({ tool: 'Bash', command: 'git push origin other:main' })
    expect(w.processes.filter(argv => argv[1] === 'log')).toEqual([['git', 'log', '--oneline', '-n', '30', 'origin/main..other', '--']])
    for (const argv of w.processes) expect(argv.at(-2)).not.toMatch(/\.\.HEAD$/)
    const prompt = String(w.modelRequests.at(-1)?.prompt)
    expect(prompt).toContain('commits it would send (origin/main..other)')
    expect(prompt).toContain('aaa111 Work on other')
    expect(prompt).not.toContain('bbb222')
    expect(prompt).not.toContain('Note: ')
  })

  test('an unreadable source: no commits of HEAD, and a trusted note after the preview, outside any data block', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    w.processReply = argv => (argv[1] === 'log' ? { exitCode: 0, stdout: 'bbb222 The checked-out branch\n' } : { exitCode: 0, stdout: 'feature\n' })
    await $.tool.call({ tool: 'Bash', command: 'git push origin "a b":main' })
    expect(w.processes.filter(argv => argv[1] === 'log' || argv[1] === 'diff')).toEqual([])
    const prompt = String(w.modelRequests.at(-1)?.prompt)
    expect(prompt).not.toContain('bbb222')
    const note = `Note: ${unseenPushNote(1)}`
    expect(prompt).toContain(note)
    // Said by the mod: after a closing tag, not inside a data block.
    const before = prompt.slice(0, prompt.indexOf(`\n\n${note}`))
    expect(before.match(/<data-\w+ /g)?.length).toBe(before.match(/<\/data-\w+>/g)?.length)
  })

  test('a push of every tag: the trusted note reaches the reviewer after the preview, outside any data block', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    w.processReply = argv => (argv[1] === 'log' ? { exitCode: 0, stdout: 'bbb222 The checked-out branch\n' } : { exitCode: 0, stdout: 'feature\n' })
    await $.tool.call({ tool: 'Bash', command: 'git push --tags origin' })
    const prompt = String(w.modelRequests.at(-1)?.prompt)
    expect(prompt).toContain('bbb222 The checked-out branch')
    const note = `Note: ${broadPushNote}`
    expect(prompt).toContain(note)
    const before = prompt.slice(0, prompt.indexOf(`\n\n${note}`))
    expect(before.match(/<data-\w+ /g)?.length).toBe(before.match(/<\/data-\w+>/g)?.length)
  })

  test('git failing on a range says so, as an unreadable ref does, and the review goes on', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    w.processReply = argv => (argv[1] === 'log' ? { exitCode: 128, stdout: '' } : { exitCode: 0, stdout: 'feature\n' })
    expect(await $.tool.call({ tool: 'Bash', command: 'git push origin feature' })).toEqual({ result: 'ran' })
    const prompt = String(w.modelRequests.at(-1)?.prompt)
    expect(prompt).toContain(`Note: ${unseenPushNote(1)}`)
    // The preview itself carries it too, where the user reads it.
    expect(prompt).toContain('current branch:')
  })

  test('more than three refspecs: the note is in the preview the user is shown', async ($, on) => {
    const w = world(on, { replies: [{ isAnswered: false, reason: 'aborted', usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }], answer: KEEP_BLOCKED })
    w.processReply = () => ({ exitCode: 0, stdout: 'x\n' })
    await $.tool.call({ tool: 'Bash', command: 'git push origin a b c d e' })
    expect(w.asked[0]?.question).toContain('This push names 5 refspecs and commits are shown for the first 3 only')
    expect(w.processes.filter(argv => argv[1] === 'log')).toHaveLength(3)
  })

  test('the full council: each refspec is read, the diff reviewer sees them under their own labels', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    w.processReply = argv => (argv[1] === 'diff' ? { exitCode: 0, stdout: `+changes of ${argv.at(-2)}\n` } : { exitCode: 0, stdout: 'feature\n' })
    await $.tool.call({ tool: 'Bash', command: 'git push origin a b' })
    expect(w.processes.filter(argv => argv[1] === 'diff').map(argv => argv.at(-2))).toEqual(['origin/a..a', 'origin/b..b'])
    const prompt = String(w.modelRequests.find(request => String(request.system).includes('the commits a git push would send'))?.prompt)
    expect(prompt).toContain('The changes the push would send: origin/a..a, origin/b..b')
    expect(prompt).toContain('# origin/a..a\n+changes of origin/a..a')
    expect(prompt).toContain('# origin/b..b\n+changes of origin/b..b')
    expect(prompt).not.toContain('Note: ')
  })

  test('the full council: a range git cannot read is said to the diff reviewer; none readable, it sits out', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    w.processReply = argv => {
      if (argv[1] !== 'diff') return { exitCode: 0, stdout: 'feature\n' }
      return argv.at(-2)?.includes('b') ? { exitCode: 128, stdout: '' } : { exitCode: 0, stdout: '+only a\n' }
    }
    await $.tool.call({ tool: 'Bash', command: 'git push origin a b' })
    const prompt = String(w.modelRequests.find(request => String(request.system).includes('the commits a git push would send'))?.prompt)
    expect(prompt).toContain('The changes the push would send: origin/a..a')
    expect(prompt).toContain('+only a')
    expect(prompt).toContain(`Note: ${unseenPushNote(1)}`)
  })

  test('the full council: a delete has nothing to read, so the diff reviewer sits out and no HEAD diff is read', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    await $.tool.call({ tool: 'Bash', command: 'git push origin :old' })
    expect(w.processes.filter(argv => argv[1] === 'diff' || argv[1] === 'log')).toEqual([])
    expect((await auditLines(w))[0]).toMatchObject({ council: { voices: [{ member: 'gandalf' }, { member: 'legolas', verdict: 'skipped' }, { member: 'aragorn' }] } })
  })

  test('never runs the proposed command; the preview reaches the reviewer', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    w.processReply = argv => (argv[1] === 'log' ? { exitCode: 0, stdout: 'abc123 Fix the thing\n' } : { exitCode: 0, stdout: 'main\n' })
    await $.tool.call({ tool: 'Bash', command: 'git push --force origin feature' })
    for (const argv of w.processes) {
      expect(argv[0]).toBe('git')
      // The preview's table, and the full council's diff of what the push would send.
      expect(['rev-parse', 'remote', 'log', 'diff']).toContain(argv[1])
      expect(argv).not.toContain('push')
      expect(argv).not.toContain('--force')
    }
    expect(String(w.modelRequests[0]?.prompt)).toContain('abc123 Fix the thing')
  })

  test('a new branch: the preview falls back to the remote default branch, in that order, and never runs the push', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    w.processReply = argv => {
      const range = argv.at(-2)
      if (argv[1] === 'log') return range === 'origin/feature..feature' ? { exitCode: 128, stdout: '' } : { exitCode: 0, stdout: 'def456 Start the feature\n' }
      return { exitCode: 0, stdout: 'feature\n' }
    }
    await $.tool.call({ tool: 'Bash', command: 'git push origin feature' })
    const logs = w.processes.filter(argv => argv[1] === 'log')
    expect(logs).toEqual([
      ['git', 'log', '--oneline', '-n', '30', 'origin/feature..feature', '--'],
      ['git', 'log', '--oneline', '-n', '30', 'origin/HEAD..feature', '--'],
    ])
    expect(w.processes.filter(argv => argv[1] === 'push')).toEqual([])
    const prompt = String(w.modelRequests.find(request => String(request.prompt).includes('def456'))?.prompt)
    expect(prompt).toContain('commits it would send (origin/HEAD..feature: the remote has no such branch yet, so against its default branch)')
    expect(prompt).toContain('def456 Start the feature')
    expect(prompt).not.toContain('commits it would send (origin/feature..feature)')
  })

  test('when the fallback fails too, there is no commits step and the review goes on', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    w.processReply = argv => (argv[1] === 'log' ? { exitCode: 128, stdout: '' } : { exitCode: 0, stdout: 'feature\n' })
    expect(await $.tool.call({ tool: 'Bash', command: 'git push origin feature' })).toEqual({ result: 'ran' })
    expect(w.processes.filter(argv => argv[1] === 'log')).toHaveLength(2)
    expect(String(w.modelRequests[0]?.prompt)).not.toContain('commits it would send')
  })

  test('a delete preview lists the folder without starting any process', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    w.files.set(`${ROOT}/build/out.js`, 'x')
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    expect(w.processes).toEqual([])
    expect(String(w.modelRequests[0]?.prompt)).toContain('rm target build: a folder with 1 entries')
  })

  test('a timeout gives no preview, and the review goes on', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    w.processReply = () => 'timeout'
    expect(await $.tool.call({ tool: 'Bash', command: 'git push origin main' })).toEqual({ result: 'ran' })
    expect(String(w.modelRequests[0]?.prompt)).toContain('No preview is available.')
  })

  test('the preview is shown in an escalation, redacted', async ($, on) => {
    const w = world(on, { replies: [{ isAnswered: false, reason: 'aborted', usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }], answer: KEEP_BLOCKED })
    w.processReply = argv => (argv[1] === 'remote' ? { exitCode: 0, stdout: `https://me:${FAKE_GITHUB_TOKEN}@github.com/a/b\n` } : { exitCode: 0, stdout: 'main\n' })
    await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
    expect(w.asked[0]?.question).toContain('What it would touch:')
    expect(w.asked[0]?.question).not.toContain(FAKE_GITHUB_TOKEN)
  })

  test('switched off, no inspection runs', { options: { galadrielEnabled: false } }, async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
    expect(w.processes).toEqual([])
  })
})
