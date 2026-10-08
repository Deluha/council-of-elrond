import { describe, expect, test } from 'claude-code/testing'

import { SHIPPED } from '../hooks/config/defaults.js'
import { compileConfig, loadConfig, validateOverrides } from '../hooks/config/schema.js'
import type { CompiledConfig } from '../hooks/config/schema.js'
import type { Rule } from '../hooks/config/types.js'
import { withRule } from '../hooks/config/write.js'
import { suggestRule } from '../hooks/elrond/suggest.js'
import type { Suggested } from '../hooks/elrond/suggest.js'
import { classify } from '../hooks/rules/classify.js'
import type { Call } from '../hooks/rules/classify.js'
import { ALLOW_ONCE, auditLines, CONTEXT, denyOf, KEEP_BLOCKED, ROOT, SHIPPED_COMPILED, USAGE, world } from './fixtures.js'

const RULES = `${ROOT}/.claude/council-of-elrond/rules.json`
const NONE = { hadSecret: false, declined: [] as string[] }

const bash = (command: string): Call => ({ tool: 'Bash', input: { command, description: 'x' } })

function suggest(call: Call, compiled: CompiledConfig = SHIPPED_COMPILED, options = NONE): Suggested {
  return suggestRule(call, classify(call, compiled, CONTEXT), compiled, CONTEXT, options)
}

function ruleOf(call: Call, compiled: CompiledConfig = SHIPPED_COMPILED): Rule {
  const suggested = suggest(call, compiled)
  if (suggested.kind !== 'rule') throw new Error(`no rule: ${suggested.why}`)
  return suggested.suggestion.rule
}

/** The shipped config plus `rules` as the project's own. */
const withProject = (...rules: Rule[]): CompiledConfig =>
  compileConfig({ ...SHIPPED, rules: [...rules, ...SHIPPED.rules] }, new Set(rules.map(rule => rule.id)))

const tierWith = (rule: Rule, call: Call): string => classify(call, withProject(rule), CONTEXT).tier

describe('the suggested rule', () => {
  test('a shell rule: the core anchored, the whole command pinned, allow tier, valid', () => {
    const rule = ruleOf(bash('rm -r build'))
    expect(rule).toMatchObject({ id: 'allow-rm-r-build', tier: 'allow', tools: ['Bash'], command: '^rm -r build$' })
    expect(validateOverrides({ schemaVersion: 1, rules: [rule] }).errors).toEqual([])
    expect(tierWith(rule, bash('rm -r build'))).toBe('allow')
    expect(tierWith(rule, bash('rm  -r   build'))).toBe('allow')
  })

  test('nothing rides on it: a wrapper, a redirect, another part or another target is still gated', () => {
    const rule = ruleOf(bash('rm -r build'))
    for (const command of ['sudo rm -r build', 'rm -r build > out.txt', 'rm -r build; rm -r src', 'rm -r build2', 'rm -r build src', 'cd src && rm -r build']) {
      expect(tierWith(rule, bash(command)), command).not.toBe('allow')
    }
    // The same core with sudo stays on the ask tier.
    expect(tierWith(rule, bash('sudo rm -r build'))).toBe('ask')
    // The same command with the sandbox disabled is still reviewed, not allowed.
    expect(classify({ tool: 'Bash', input: { command: 'rm -r build', dangerouslyDisableSandbox: true } }, withProject(rule), CONTEXT).tier).toBe('review')
  })

  test('a gated part inside a compound command: the command is pinned whole', () => {
    const rule = ruleOf(bash('cd src && rm -r old'))
    expect(rule.command).toBe('^rm -r old$')
    expect(tierWith(rule, bash('cd src && rm -r old'))).toBe('allow')
    expect(tierWith(rule, bash('rm -r old'))).not.toBe('allow')
  })

  test('the ask tier, sudo included, gets one for that exact call', () => {
    const rule = ruleOf(bash('sudo apt update'))
    expect(rule.command).toBe('^apt update$')
    expect(tierWith(rule, bash('sudo apt update'))).toBe('allow')
    expect(tierWith(rule, bash('sudo apt upgrade'))).toBe('ask')
  })

  test('a file tool: that tool on that path, nothing wider', () => {
    const edit: Call = { tool: 'Edit', input: { file_path: `${ROOT}/src/app.ts`, old_string: 'a', new_string: 'b' } }
    const rule = ruleOf(edit)
    expect(rule).toMatchObject({ tier: 'allow', tools: ['Edit'], path: '^src\\/app\\.ts$' })
    expect(tierWith(rule, edit)).toBe('allow')
    expect(tierWith(rule, { tool: 'Write', input: { file_path: `${ROOT}/src/app.ts`, content: 'x' } })).toBe('review')
    expect(tierWith(rule, { tool: 'Edit', input: { file_path: `${ROOT}/src/app.tsx`, old_string: 'a', new_string: 'b' } })).toBe('review')
  })

  test('an MCP tool: that tool by its exact name', () => {
    const rule = ruleOf({ tool: 'mcp__tracker__create_issue', input: { title: 'x' } })
    expect(rule).toMatchObject({ tools: ['mcp__tracker__create_issue'] })
    expect(rule.command).toBeUndefined()
  })

  test('an id already in use is numbered past', () => {
    const taken: Rule = { id: 'allow-rm-r-build', tier: 'review', tools: ['Write'], reason: 'x' }
    expect(ruleOf(bash('rm -r build'), withProject(taken)).id).toBe('allow-rm-r-build-2')
  })
})

describe('never offered', () => {
  const why = (call: Call, options = NONE, compiled = SHIPPED_COMPILED): string => {
    const suggested = suggest(call, compiled, options)
    return suggested.kind === 'none' ? suggested.why : 'offered'
  }

  test('for a block-tier match', () => {
    expect(why(bash('rm -rf /'))).toBe('block')
    expect(why(bash('rm -r build && rm -rf ~'))).toBe('block')
  })

  test('for a protected path, by shell mention or file tool', () => {
    expect(why(bash('cat .env'))).toBe('protected')
    expect(why(bash('rm -r build && cat .env'))).toBe('protected')
    expect(why({ tool: 'Edit', input: { file_path: `${ROOT}/.github/workflows/ci.yml`, old_string: 'a', new_string: 'b' } })).toBe('protected')
  })

  test('for a call the secrets scan flagged: an allow rule would skip the scan', () => {
    expect(why(bash('rm -r build'), { hadSecret: true, declined: [] })).toBe('secret')
  })

  test('for script runs, words that expand at run time, multi-line and very long commands', () => {
    expect(why(bash('bash deploy.sh'))).toBe('script')
    expect(why(bash('python -c "import os"'))).toBe('script')
    expect(why(bash('rm -r $DIR'))).toBe('expansion')
    expect(why(bash('rm -r build/$(date +%F)'))).toBe('expansion')
    expect(why(bash('rm -r build\nrm -r out'))).toBe('too-long')
    expect(why(bash(`rm -r ${'x'.repeat(400)}`))).toBe('too-long')
  })

  test('for a pattern the user declined this session', () => {
    const suggested = suggest(bash('rm -r build'))
    if (suggested.kind !== 'rule') throw new Error('expected a rule')
    expect(why(bash('rm -r build'), { hadSecret: false, declined: [suggested.suggestion.key] })).toBe('declined')
  })

  test("when the user's own project rule would still decide first", () => {
    const own: Rule = { id: 'ask-deletes', tier: 'ask', tools: ['Bash'], command: '^rm\\s', reason: 'We ask about deletes.' }
    expect(why(bash('rm -r build'), NONE, withProject(own))).toBe('not-allowed')
  })
})

describe('writing a rule to the rules file', () => {
  const rule = ruleOf(bash('rm -r build'))

  test("appended after the file's own rules, the user's key order kept", () => {
    const own = { id: 'mine', tier: 'review', tools: ['Bash'], command: '^make deploy', reason: 'Ours.' }
    const before = JSON.stringify({ protectedBranches: ['dev'], schemaVersion: 1, rules: [own] }, null, 4)
    const edit = withRule(before, rule)
    expect(edit.ok).toBe(true)
    if (!edit.ok) return
    const after = JSON.parse(edit.text) as Record<string, unknown>
    expect(Object.keys(after)).toEqual(['protectedBranches', 'schemaVersion', 'rules'])
    expect(after.rules).toEqual([own, rule])
    expect(edit.text).toBe(`${JSON.stringify(after, null, 2)}\n`)
    expect(loadConfig(edit.text).errors).toEqual([])
  })

  test('no file yet: a new one; a broken or invalid file is never rewritten; a taken id is refused', () => {
    const fresh = withRule(undefined, rule)
    expect(fresh.ok && JSON.parse(fresh.text)).toEqual({ schemaVersion: 1, rules: [rule] })
    expect(withRule('{ not json', rule)).toMatchObject({ ok: false })
    expect(withRule('{"schemaVersion": 2}', rule)).toMatchObject({ ok: false })
    expect(withRule(JSON.stringify({ schemaVersion: 1, rules: [rule] }), rule)).toMatchObject({ ok: false })
  })
})

describe('the offer after "allow once"', () => {
  test('shows the exact JSON; written only on "Add the rule", then reloaded and honoured', async ($, on) => {
    const w = world(on, { answers: [ALLOW_ONCE, 'Add the rule'], answer: KEEP_BLOCKED })
    expect(await $.tool.call({ tool: 'Bash', command: 'sudo apt update' })).toEqual({ result: 'ran' })
    expect(w.asked).toHaveLength(2)
    expect(w.asked[1]?.options).toEqual(['Add the rule', 'Not now'])
    const rules = JSON.parse(w.files.get(RULES) ?? '{}') as { rules: Rule[] }
    expect(rules.rules).toHaveLength(1)
    // Written to the project's file, so it reads plain in every mode.
    expect(rules.rules[0]?.reason).toBe('You allowed this exact call after the council stopped it, and added this rule.')
    // The dialog showed the rule exactly as written.
    expect(w.asked[1]?.question).toContain(JSON.stringify(rules.rules[0], null, 2))
    expect(auditLines(w)[0]).toMatchObject({ decision: 'allow-once', outcome: 'ran', ruleAdded: 'allow-apt-update' })
    expect(w.logs.join('\n')).toContain('added the allow rule allow-apt-update')

    // Reloaded: the same call now passes without a question; a different one is still asked.
    expect(await $.tool.call({ tool: 'Bash', command: 'sudo apt update' })).toEqual({ result: 'ran' })
    expect(w.asked).toHaveLength(2)
    expect(denyOf(await $.tool.call({ tool: 'Bash', command: 'sudo apt upgrade' }))).toContain('(keep blocked)')
    expect(w.asked).toHaveLength(3)
  })

  test('"Not now" writes nothing, and the same pattern is not offered again this session', async ($, on) => {
    const w = world(on, { answers: [ALLOW_ONCE, 'Not now', ALLOW_ONCE], answer: KEEP_BLOCKED })
    await $.tool.call({ tool: 'Bash', command: 'sudo apt update' })
    expect(w.files.has(RULES)).toBe(false)
    await $.tool.call({ tool: 'Bash', command: 'sudo apt update' })
    expect(w.asked.map(asked => asked.options[0])).toEqual([ALLOW_ONCE, 'Add the rule', ALLOW_ONCE])
    expect(w.files.has(RULES)).toBe(false)
    expect(auditLines(w)[0]?.ruleAdded).toBeUndefined()
  })

  test('dismissing the offer writes nothing and the call still ran', async ($, on) => {
    const w = world(on, { answers: [ALLOW_ONCE, 'dismiss'] })
    expect(await $.tool.call({ tool: 'Bash', command: 'sudo apt update' })).toEqual({ result: 'ran' })
    expect(w.files.has(RULES)).toBe(false)
  })

  test('after a reviewer failure and "allow once", the offer comes too', async ($, on) => {
    const w = world(on, { answers: [ALLOW_ONCE, 'Add the rule'], replies: [{ isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE }] })
    await $.tool.call({ tool: 'Bash', command: 'rm -r build' })
    const rules = JSON.parse(w.files.get(RULES) ?? '{}') as { rules: Rule[] }
    expect(rules.rules[0]).toMatchObject({ id: 'allow-rm-r-build', command: '^rm -r build$' })
  })

  test('never for a protected path', async ($, on) => {
    const w = world(on, { answer: ALLOW_ONCE })
    expect(await $.tool.call({ tool: 'Bash', command: 'cat .env' })).toEqual({ result: 'ran' })
    expect(w.asked).toHaveLength(1)
    expect(w.files.has(RULES)).toBe(false)
  })

  test('never for a call with a secrets finding, even a low one allowed once', async ($, on) => {
    const w = world(on, { answer: ALLOW_ONCE })
    await $.tool.call({ tool: 'Bash', command: 'sudo deploy --password="hunter2xyz"' })
    expect(w.asked).toHaveLength(1)
    expect(w.files.has(RULES)).toBe(false)
  })

  test('never for a block-tier match: nothing is asked at all', async ($, on) => {
    const w = world(on, { answer: ALLOW_ONCE })
    expect(denyOf(await $.tool.call({ tool: 'Bash', command: 'rm -rf ~' }))).toContain('(block)')
    expect(w.asked).toEqual([])
    expect(w.files.has(RULES)).toBe(false)
  })

  test('never when the person refused the call at Claude Code\'s own prompt', async ($, on) => {
    const w = world(on, { answer: ALLOW_ONCE })
    w.toolResult = { result: 'refused', isError: true, text: "The user doesn't want to proceed with this tool use. The tool use was rejected." }
    await $.tool.call({ tool: 'Bash', command: 'sudo apt update' })
    expect(w.asked).toHaveLength(1)
  })

  test('a broken rules file is left alone: nothing written, the user told', async ($, on) => {
    const w = world(on, { answers: [ALLOW_ONCE, 'Add the rule'] })
    w.files.set(RULES, '{ "schemaVersion": 1, ')
    expect(await $.tool.call({ tool: 'Bash', command: 'sudo apt update' })).toEqual({ result: 'ran' })
    expect(w.files.get(RULES)).toBe('{ "schemaVersion": 1, ')
    expect(w.logs.join('\n')).toContain('the allow rule was not written (the rules file is not valid JSON)')
    expect(auditLines(w)[0]?.ruleAdded).toBeUndefined()
  })
})
