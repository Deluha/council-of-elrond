import { describe, expect, test } from 'claude-code/testing'

import { APPROVE, auditLines, BLOCK, denyOf, REVISE, world } from './fixtures.js'

const submit = ($: { prompt: { submit: (e: never) => Promise<unknown> } }, text: string) =>
  $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } } as never)

describe('rounds', () => {
  test('two refusals use the rounds; a rephrased retry then goes to the user, not the model', async ($, on) => {
    const w = world(on, { replies: [REVISE, BLOCK], answer: 'Keep blocked' })
    on('prompt.submit', ($$, e) => ({ text: e.text }))
    expect(denyOf(await $.tool.call({ tool: 'Bash', command: 'rm -rf ./build' }))).toContain('Review rounds left on this operation: 1.')
    expect(denyOf(await $.tool.call({ tool: 'Bash', command: 'rm -r build/' }))).toContain('Review rounds left on this operation: 0.')
    const third = denyOf(await $.tool.call({ tool: 'Bash', command: 'rm -rf build' }))
    expect(w.modelRequests).toHaveLength(2)
    expect(w.asked).toHaveLength(1)
    expect(w.asked[0]?.question).toContain('refused this operation twice')
    expect(third).toContain('(keep blocked)')
    const lines = auditLines(w)
    expect(new Set(lines.map(line => line.opKey))).toEqual(new Set(['shell:rm build']))
  })

  test('a typed instruction resets the rounds', async ($, on) => {
    const w = world(on, { replies: [REVISE, REVISE, APPROVE], answer: 'Only delete build/tmp' })
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    await $.tool.call({ tool: 'Bash', command: 'rm -r build' })
    expect(denyOf(await $.tool.call({ tool: 'Bash', command: 'rm -rf build/' }))).toContain('"Only delete build/tmp". Follow it.')
    // Rounds are back: the next attempt is reviewed again.
    expect(await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })).toEqual({ result: 'ran' })
    expect(w.modelRequests).toHaveLength(3)
  })
})

describe('failed attempts and lockout', () => {
  test('three failed attempts lock the operation out, with no model call or question', async ($, on) => {
    const w = world(on, { replies: [BLOCK, BLOCK], answer: 'Keep blocked' })
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' }) // block: 1
    await $.tool.call({ tool: 'Bash', command: 'rm -r build' }) // block: 2
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build/' }) // out of rounds, keep blocked: 3
    const asked = w.asked.length
    const deny = denyOf(await $.tool.call({ tool: 'Bash', command: 'rm -rf ./build' }))
    expect(deny).toContain('Decided by: the council (locked out).')
    expect(deny).toContain('Stop retrying this.')
    expect(deny).toContain('propose a different approach')
    expect(w.modelRequests).toHaveLength(2)
    expect(w.asked).toHaveLength(asked)
    expect(auditLines(w).at(-1)).toMatchObject({ verdict: 'locked out', outcome: 'refused' })
  })

  test('a new prompt clears the lockout', async ($, on) => {
    const w = world(on, { replies: [BLOCK, BLOCK, APPROVE], answer: 'dismiss' })
    on('prompt.submit', ($$, e) => ({ text: e.text }))
    for (const command of ['rm -rf build', 'rm -r build', 'rm -rf build/']) await $.tool.call({ tool: 'Bash', command })
    expect(denyOf(await $.tool.call({ tool: 'Bash', command: 'rm -rf build' }))).toContain('locked out')
    await submit($ as never, 'ok, delete only the build output')
    expect(await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })).not.toHaveProperty('deny')
    expect(w.ran).toHaveLength(1)
  })

  test('five failed attempts on one kind lock retries that change the target', async ($, on) => {
    const w = world(on, { replies: [BLOCK] })
    for (const target of ['a', 'b', 'c', 'd', 'e']) await $.tool.call({ tool: 'Bash', command: `rm -rf ${target}` })
    const requests = w.modelRequests.length
    const deny = denyOf(await $.tool.call({ tool: 'Bash', command: 'rm -rf f' }))
    expect(deny).toContain('Operations of this kind (rm)')
    expect(w.modelRequests).toHaveLength(requests)
  })

  test('a gated call that runs and errors counts; a success clears its operation', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    w.toolResult = { result: 'failed', isError: true, text: 'rm: cannot remove: Permission denied' }
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    w.toolResult = { result: 'ran' }
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    // Two errors, then a success: had it counted on, a third error would not lock it.
    w.toolResult = { result: 'failed', isError: true, text: 'boom' }
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    expect(denyOf(await $.tool.call({ tool: 'Bash', command: 'rm -rf build' }))).not.toContain('locked out')
    expect(auditLines(w)[0]).toMatchObject({ outcome: 'error' })
  })

  test('with tool errors not counted, errors never lock out', { options: { toolErrorsAreWipes: false } }, async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    w.toolResult = { result: 'failed', isError: true, text: 'boom' }
    for (let i = 0; i < 4; i++) await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    expect(w.ran).toHaveLength(4)
  })

  test('a refusal at the permission prompt is recorded apart from a tool error', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    w.toolResult = { result: 'failed', isError: true, text: "Claude requested permissions to use Bash, but you haven't granted it yet." }
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    expect(auditLines(w)[0]).toMatchObject({ outcome: 'denied-by-permission' })
  })

  test('a dismissed question is a failed attempt', async ($, on) => {
    world(on, { answer: 'dismiss' })
    for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'sudo ls' })
    expect(denyOf(await $.tool.call({ tool: 'Bash', command: 'sudo ls' }))).toContain('locked out')
  })
})

describe('cache', () => {
  test('an approve is reused for the identical call this prompt; a new prompt reviews again', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    on('prompt.submit', ($$, e) => ({ text: e.text }))
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    await $.tool.call({ tool: 'Bash', command: 'rm  -rf   build' })
    expect(w.modelRequests).toHaveLength(1)
    expect(w.ran).toHaveLength(2)
    expect(auditLines(w)[1]).toMatchObject({ cached: true, verdict: 'approve', outcome: 'ran' })
    await submit($ as never, 'again')
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    expect(w.modelRequests).toHaveLength(2)
  })

  test('a block or revise is never reused', async ($, on) => {
    const w = world(on, { replies: [BLOCK, APPROVE] })
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    expect(await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })).toEqual({ result: 'ran' })
    expect(w.modelRequests).toHaveLength(2)
  })
})
