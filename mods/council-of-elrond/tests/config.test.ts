import { describe, expect, test } from 'claude-code/testing'

import { SHIPPED } from '../hooks/config/defaults.js'
import { loadConfig } from '../hooks/config/schema.js'
import { resolveModel } from '../hooks/elrond/models.js'
import { classify } from '../hooks/rules/classify.js'
import { CONTEXT } from './fixtures.js'

const blocksRootDelete = (text: string | undefined) =>
  classify({ tool: 'Bash', input: { command: 'rm -rf /' } }, loadConfig(text).compiled, CONTEXT).tier === 'block'

describe('config', () => {
  test('no file: the shipped defaults, no errors', () => {
    const loaded = loadConfig(undefined)
    expect(loaded.origin).toBe('shipped')
    expect(loaded.errors).toEqual([])
    expect(loaded.compiled.rules.length).toBe(SHIPPED.rules.length)
  })

  test('a file that is not JSON falls back to the shipped rules, with the error', () => {
    const loaded = loadConfig('{ not json')
    expect(loaded.origin).toBe('shipped')
    expect(loaded.errors[0]).toContain('not valid JSON')
    expect(blocksRootDelete('{ not json')).toBe(true)
  })

  test('an unknown schema version is a broken config', () => {
    const loaded = loadConfig(JSON.stringify({ schemaVersion: 2, rules: [] }))
    expect(loaded.origin).toBe('shipped')
    expect(loaded.errors).toEqual(['schemaVersion: 2 is not a version this build reads (1)'])
  })

  test('errors are reported by field, and any error ignores the whole file', () => {
    const loaded = loadConfig(
      JSON.stringify({
        schemaVersion: 1,
        rulez: [],
        rules: [
          { id: 'x', tier: 'maybe', tools: ['Bash'], command: '(', reason: 'r' },
          { id: 'shell-move', tier: 'allow', tools: ['Bash'], reason: 'r' },
          { id: 'y', tier: 'allow', tools: ['Bash'], reason: 'r', extra: 1 },
        ],
        disableRules: ['rm-recursive-outside-repo', 'nope'],
        productionPatterns: ['['],
        models: { gimli: 'opus', gandalf: '' },
      }),
    )
    expect(loaded.origin).toBe('shipped')
    expect(loaded.errors).toEqual(
      expect.arrayContaining([
        'rulez: unknown field',
        'rules[0].tier: one of allow, review, ask, block',
        expect.stringContaining('rules[0].command: invalid regex'),
        'rules[2].extra: unknown field',
        expect.stringContaining('rules[1].id: "shell-move" is a shipped rule'),
        'disableRules[0]: "rm-recursive-outside-repo" is a block rule; block rules cannot be disabled',
        'disableRules[1]: "nope" is not a shipped rule',
        expect.stringContaining('productionPatterns[0]: invalid regex'),
        'models.gimli: unknown slot (one of gandalf, legolas, aragorn, council)',
        'models.gandalf: must be a model alias or id',
      ]),
    )
    expect(blocksRootDelete(JSON.stringify({ schemaVersion: 1, rules: 'no' }))).toBe(true)
  })

  test('a valid file merges: project rules first, lists widened, models taken', () => {
    const loaded = loadConfig(
      JSON.stringify({
        schemaVersion: 1,
        rules: [{ id: 'mine', tier: 'block', tools: ['Bash'], command: '^terraform destroy', reason: 'Never here.' }],
        protectedBranches: ['staging'],
        models: { gandalf: 'claude-opus-5-5' },
      }),
    )
    expect(loaded.errors).toEqual([])
    expect(loaded.origin).toBe('shipped+project')
    expect(loaded.compiled.rules[0]?.id).toBe('mine')
    expect(loaded.compiled.rules[0]?.source).toBe('project')
    expect(loaded.compiled.config.protectedBranches).toEqual(expect.arrayContaining(['main', 'staging']))
    expect(loaded.compiled.config.models.gandalf).toBe('claude-opus-5-5')
  })
})

describe('model layers', () => {
  test('session beats settings beats project beats built-in; "default" is unset', () => {
    expect(resolveModel('gandalf', {})).toEqual({ model: 'sonnet', source: 'built-in' })
    expect(resolveModel('aragorn', {})).toEqual({ model: 'opus', source: 'built-in' })
    expect(resolveModel('council', {})).toEqual({ model: 'opus', source: 'built-in' })
    expect(resolveModel('gandalf', { settings: 'default', project: 'fable' })).toEqual({ model: 'fable', source: 'project' })
    expect(resolveModel('gandalf', { settings: 'opus', project: 'fable' })).toEqual({ model: 'opus', source: 'settings' })
    expect(resolveModel('gandalf', { session: 'claude-sonnet-5-5', settings: 'opus' })).toEqual({ model: 'claude-sonnet-5-5', source: 'session' })
  })

  test('no built-in default uses Haiku', () => {
    for (const slot of ['gandalf', 'legolas', 'aragorn', 'council'] as const) {
      expect(resolveModel(slot, {}).model).not.toContain('haiku')
    }
  })
})
