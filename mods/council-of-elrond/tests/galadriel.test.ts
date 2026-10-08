import { describe, expect, test } from 'claude-code/testing'

import { rangeOf } from '../hooks/elrond/council.js'
import { formatPreview, MAX_INSPECTIONS, planPreview, rangeDiffInspection } from '../hooks/members/galadriel.js'
import { classify } from '../hooks/rules/classify.js'
import type { Call } from '../hooks/rules/classify.js'
import { APPROVE, CONTEXT, KEEP_BLOCKED, ROOT, SHIPPED_COMPILED, world } from './fixtures.js'

const plan = (call: Call) => planPreview(call, classify(call, SHIPPED_COMPILED, CONTEXT), CONTEXT)
const bash = (command: string) => plan({ tool: 'Bash', input: { command } })
const rangeDiff = (command: string, kind: 'push' | 'merge') => {
  const call: Call = { tool: 'Bash', input: { command } }
  const range = rangeOf(classify(call, SHIPPED_COMPILED, CONTEXT))
  return range === undefined ? undefined : rangeDiffInspection(kind, range.part)
}

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
      ['git', 'log', '--oneline', '-n', '30', 'origin/main..HEAD', '--'],
    ])
    const bare = bash('git push')
    expect(bare.at(-1)).toMatchObject({ argv: ['git', 'log', '--oneline', '-n', '30', '@{upstream}..HEAD', '--'] })
  })

  test('a push naming a remote carries a fixed fallback against the remote default branch; nothing else does', () => {
    const log = bash('git push origin feature').at(-1)
    expect(log).toMatchObject({
      argv: ['git', 'log', '--oneline', '-n', '30', 'origin/feature..HEAD', '--'],
      orElse: {
        label: 'commits it would send (origin/HEAD..HEAD: the remote has no such branch yet, so against its default branch)',
        argv: ['git', 'log', '--oneline', '-n', '30', 'origin/HEAD..HEAD', '--'],
      },
    })
    expect(rangeDiff('git push origin feature', 'push')).toMatchObject({
      label: 'origin/feature..HEAD',
      argv: ['git', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', 'origin/feature..HEAD', '--'],
      orElse: { label: 'origin/HEAD...HEAD', argv: ['git', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', 'origin/HEAD...HEAD', '--'] },
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
    for (const step of steps) if (step.kind === 'git') expect(step.argv).not.toContain('origin/HEAD..HEAD')
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
      ['git', 'diff', '--stat', 'HEAD', '--', 'src/app.ts'],
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
    expect(preview).toContain('[... truncated]')
    expect(formatPreview([{ kind: 'failed', label: 'x' }], 10)).toBeUndefined()
  })
})

describe('in the pipeline', () => {
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
      if (argv[1] === 'log') return range === 'origin/feature..HEAD' ? { exitCode: 128, stdout: '' } : { exitCode: 0, stdout: 'def456 Start the feature\n' }
      return { exitCode: 0, stdout: 'feature\n' }
    }
    await $.tool.call({ tool: 'Bash', command: 'git push origin feature' })
    const logs = w.processes.filter(argv => argv[1] === 'log')
    expect(logs).toEqual([
      ['git', 'log', '--oneline', '-n', '30', 'origin/feature..HEAD', '--'],
      ['git', 'log', '--oneline', '-n', '30', 'origin/HEAD..HEAD', '--'],
    ])
    expect(w.processes.filter(argv => argv[1] === 'push')).toEqual([])
    const prompt = String(w.modelRequests.find(request => String(request.prompt).includes('def456'))?.prompt)
    expect(prompt).toContain('commits it would send (origin/HEAD..HEAD: the remote has no such branch yet, so against its default branch)')
    expect(prompt).toContain('def456 Start the feature')
    expect(prompt).not.toContain('commits it would send (origin/feature..HEAD)')
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
    w.processReply = argv => (argv[1] === 'remote' ? { exitCode: 0, stdout: 'https://me:ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/a/b\n' } : { exitCode: 0, stdout: 'main\n' })
    await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
    expect(w.asked[0]?.question).toContain('What it would touch:')
    expect(w.asked[0]?.question).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789')
  })

  test('switched off, no inspection runs', { options: { galadrielEnabled: false } }, async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
    expect(w.processes).toEqual([])
  })
})
