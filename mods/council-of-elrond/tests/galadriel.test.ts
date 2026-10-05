import { describe, expect, test } from 'claude-code/testing'

import { formatPreview, planPreview } from '../hooks/members/galadriel.js'
import { classify } from '../hooks/rules/classify.js'
import type { Call } from '../hooks/rules/classify.js'
import { APPROVE, CONTEXT, ROOT, SHIPPED_COMPILED, world } from './fixtures.js'

const plan = (call: Call) => planPreview(call, classify(call, SHIPPED_COMPILED, CONTEXT), CONTEXT)
const bash = (command: string) => plan({ tool: 'Bash', input: { command } })

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
      expect(['rev-parse', 'remote', 'log']).toContain(argv[1])
      expect(argv).not.toContain('push')
      expect(argv).not.toContain('--force')
    }
    expect(String(w.modelRequests[0]?.prompt)).toContain('abc123 Fix the thing')
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
    const w = world(on, { replies: [{ isAnswered: false, reason: 'aborted', usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }], answer: 'Keep blocked' })
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
