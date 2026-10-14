import { describe, expect, test } from 'claude-code/testing'

import { appendPlan, byteLength, isRotation } from '../hooks/audit.js'

const PATH = '/work/audit.jsonl'

describe('audit rotation is measured in bytes', () => {
  test('byteLength counts UTF-8 bytes, not characters', () => {
    expect(byteLength('abc')).toBe(3)
    expect(byteLength('é')).toBe(2)
    expect(byteLength('日本')).toBe(6)
    expect(byteLength('😀')).toBe(4)
  })

  test('multibyte text under the limit in characters but over it in bytes rotates', () => {
    const current = `${'é'.repeat(450)}\n`
    const line = `${'日'.repeat(60)}\n`
    expect(current.length + line.length).toBeLessThan(1_000)
    expect(byteLength(current) + byteLength(line)).toBeGreaterThan(1_000)
    expect(isRotation(current, line, 1_000)).toBe(true)
    expect(isRotation(current, line, 2_000)).toBe(false)
  })

  test('an empty file never rotates, however long the line; the limit itself still fits', () => {
    expect(isRotation('', 'é'.repeat(5_000), 100)).toBe(false)
    expect(isRotation('aaaa', 'bbbb', 8)).toBe(false)
    expect(isRotation('aaaa', 'bbbb', 7)).toBe(true)
  })

  test('the plan agrees with the check: .1 moves to .2, the current file to .1, and the line starts a new file', () => {
    const current = `${'é'.repeat(450)}\n`
    const line = `${'日'.repeat(60)}\n`
    expect(appendPlan(PATH, current, line, 1_000, ['older\n'])).toEqual([
      { path: `${PATH}.2`, text: 'older\n' },
      { path: `${PATH}.1`, text: current },
      { path: PATH, text: line },
    ])
    expect(appendPlan(PATH, current, line, 2_000, ['older\n'])).toEqual([{ path: PATH, text: current + line }])
  })
})
