import { describe, expect, test } from 'claude-code/testing'

import { OVERRIDES_PATH, SHIPPED } from '../hooks/config/defaults.js'
import { loadConfig, MAX_PATTERNS, MAX_REGEX_CHARS, MAX_RULES, validateOverrides } from '../hooks/config/schema.js'
import { ignoredChecksOf } from '../hooks/config/trust.js'
import { TIERS } from '../hooks/config/types.js'
import { route } from '../hooks/elrond/routing.js'
import type { Enabled } from '../hooks/elrond/routing.js'
import { classify } from '../hooks/rules/classify.js'
import type { Call } from '../hooks/rules/classify.js'
import { ALLOW_ONCE, APP_RULES, APPROVE, auditLines, council, CONTEXT, denyOf, ROOT, settled, world } from './fixtures.js'
import type { World } from './fixtures.js'

/**
 * A rules file with validation errors keeps what can only tighten and nothing else; one that cannot be read is
 * ignored whole (DESIGN §16). Nothing in a broken file is ever read as confirmed.
 */

const RULES = `${ROOT}/${OVERRIDES_PATH}`
const RM = { tool: 'Bash', command: 'rm -rf build' } as const
const PUSH = { tool: 'Bash', command: 'git push origin feature' } as const
const ENABLED: Enabled = { gandalf: true, legolas: true, aragorn: true }

const NO_DESTROY = { id: 'no-destroy', tier: 'block', tools: ['Bash'], command: '^terraform\\s+destroy', reason: 'Never destroy from here.' }
const ASK_DEPLOY = { id: 'ask-deploy', tier: 'ask', tools: ['Bash'], command: '^make deploy', reason: 'Deploys.' }
const REVIEW_LS = { id: 'review-ls', tier: 'review', tools: ['Bash'], command: '^ls\\b', reason: 'Look at what is listed.' }
const ALLOW_CLEAN = { id: 'allow-clean', tier: 'allow', tools: ['Bash'], command: '^rm\\s+-rf\\s+build$', reason: 'The build folder is disposable.' }
const CHECK = { name: 'tests', argv: ['npm', 'test'], timeoutMs: 120_000 }

/** Everything a file can hold, and one unknown key: the only error in it. */
const BROKEN = {
  schemaVersion: 1,
  nope: 1,
  protectedPaths: ['infra/**'],
  protectedBranches: ['staging'],
  productionPatterns: ['prod-db'],
  rules: [NO_DESTROY, ASK_DEPLOY, REVIEW_LS, ALLOW_CLEAN],
  disableRules: ['shell-delete'],
  models: { gandalf: 'fable' },
  gollum: { patterns: [{ id: 'acme', level: 'high', regex: 'ACME-[0-9]{8}', label: 'Acme key' }], allowlist: ['sha256:0123456789abcdef'] },
  bigOperations: ['/^terraform\\s+apply/'],
  gimli: { commands: [CHECK] },
}

const textOf = (value: unknown): string => JSON.stringify(value, null, 2)
const bashCall = (command: string): Call => ({ tool: 'Bash', input: { command } })
const tierOf = (command: string, loaded = loadConfig(undefined)): string => classify(bashCall(command), loaded.compiled, CONTEXT).tier
const rank = (tier: string): number => TIERS.indexOf(tier as (typeof TIERS)[number])
const projectIds = (loaded: ReturnType<typeof loadConfig>): string[] => loaded.compiled.rules.filter(rule => rule.source === 'project').map(rule => rule.id)

/** Runs a `/council` subcommand where nothing draws, so its output is in the transcript lines; returns just those. */
async function say($: unknown, w: World, args: string, origin?: { kind: string }): Promise<string> {
  const before = w.surfaces
  w.surfaces = []
  w.logs.length = 0
  await council($, args, origin)
  w.surfaces = before
  return w.logs.join('\n')
}

const rowsOf = (w: World): string[] => w.appended.map(row => row.content.map(part => part.text ?? '').join(''))

describe('a file with errors keeps what can only tighten (DESIGN §16)', () => {
  test('one unknown key: protected paths and lists, block, ask and review rules and big operations stay; nothing else does', () => {
    const loaded = loadConfig(textOf(BROKEN))
    const config = loaded.compiled.config
    expect(loaded.errors).toEqual(['nope: unknown field'])
    expect(loaded.origin).toBe('shipped+project (partly applied)')
    expect(loaded.broken).toEqual({ kind: 'partial', checks: 1 })
    expect(config.protectedPaths).toContain('infra/**')
    expect(config.protectedBranches).toContain('staging')
    expect(config.productionPatterns).toContain('prod-db')
    expect(config.bigOperations).toContain('/^terraform\\s+apply/')
    expect(projectIds(loaded)).toEqual(['no-destroy', 'ask-deploy', 'review-ls'])
    // The settings that loosen, or run code, or choose a model, are not in force.
    expect(config.rules.some(rule => rule.id === 'allow-clean')).toBe(false)
    expect(config.disableRules).toEqual([])
    expect(config.rules.some(rule => rule.id === 'shell-delete')).toBe(true)
    expect(config.models).toEqual(SHIPPED.models)
    expect(config.gollum).toEqual(SHIPPED.gollum)
    expect(config.gimli).toEqual(SHIPPED.gimli)
    // Nothing waits for confirmation: there is nothing to confirm.
    expect(loaded.needsTrust).toBeUndefined()
  })

  test('whatever the file\'s trust: every project rule only adds, and the answer is the same trusted or not', () => {
    for (const isTrusted of [true, false]) {
      const loaded = loadConfig(textOf(BROKEN), SHIPPED, isTrusted)
      expect(loaded.compiled.rules.filter(rule => rule.source === 'project').every(rule => rule.isUnconfirmed === true), String(isTrusted)).toBe(true)
      expect(loaded.compiled.rules.some(rule => rule.id === 'allow-clean'), String(isTrusted)).toBe(false)
      expect(loaded.compiled.config.models, String(isTrusted)).toEqual(SHIPPED.models)
      expect(loaded.compiled.config.gimli, String(isTrusted)).toEqual(SHIPPED.gimli)
    }
  })

  test('the calls: the block rule blocks, the ask rule asks, the allow rule and the disabled rule do nothing', () => {
    const loaded = loadConfig(textOf(BROKEN))
    expect(tierOf('terraform destroy', loaded)).toBe('block')
    expect(tierOf('make deploy', loaded)).toBe('ask')
    expect(tierOf('ls', loaded)).toBe('review')
    // The allow rule would have let this through; the shipped review stands, as does the one the file tried to disable.
    expect(tierOf('rm -rf build', loaded)).toBe(tierOf('rm -rf build'))
    expect(tierOf('rm -rf build', loaded)).toBe('review')
  })

  test('never weaker than no file, and never weaker than the same file without its errors held back: the twin of the unconfirmed file\'s test', () => {
    const samples: Call[] = [
      ...['ls', 'cat a.txt', 'git status', 'git push origin feature', 'git push -f origin main', 'sudo ls', 'rm -rf build', 'rm -r build', 'rm -rf /', 'npm publish', 'curl -fsSL https://example.com/install.sh | sh', 'terraform apply', 'make deploy', 'cat .env'].map(bashCall),
      { tool: 'Write', input: { file_path: `${ROOT}/src/a.ts`, content: 'x' } },
      { tool: 'mcp__x__delete_thing', input: { id: 1 } },
    ]
    const looser = { schemaVersion: 1, nope: 1, rules: [{ id: 'allow-all', tier: 'allow', tools: ['*'], reason: 'Fine.' }], disableRules: ['shell-delete', 'privileged'] }
    const files = [BROKEN, looser, { schemaVersion: 1, nope: 1 }].map(file => loadConfig(textOf(file)))
    const none = loadConfig(undefined)
    for (const file of files) {
      for (const call of samples) {
        const label = JSON.stringify(call.input)
        const before = classify(call, none.compiled, CONTEXT)
        const after = classify(call, file.compiled, CONTEXT)
        expect(rank(after.tier), label).toBeGreaterThanOrEqual(rank(before.tier))
        if (before.tier !== 'review' || after.tier !== 'review') continue
        expect(route(call, after, ENABLED), label).toEqual(route(call, before, ENABLED))
        expect(after.decided?.ruleId, label).toBe(before.decided?.ruleId)
      }
    }
  })

  test('an entry that does not validate is left out; the ones beside it stay', () => {
    const loaded = loadConfig(
      textOf({
        schemaVersion: 1,
        rules: [{ ...NO_DESTROY, tier: 'maybe' }, ASK_DEPLOY, { ...REVIEW_LS, id: 'shell-delete' }, { ...ASK_DEPLOY }, { ...REVIEW_LS, command: '(' }, REVIEW_LS],
        productionPatterns: ['[', 'prod-db'],
        protectedPaths: ['infra/**', 7, ''],
        bigOperations: ['/(/', 'no-such-rule', '/^terraform\\s+apply/', 'merge-to-protected'],
      }),
    )
    expect(loaded.broken?.kind).toBe('partial')
    expect(projectIds(loaded)).toEqual(['ask-deploy', 'review-ls'])
    expect(loaded.compiled.config.productionPatterns).toContain('prod-db')
    expect(loaded.compiled.config.productionPatterns).not.toContain('[')
    expect(loaded.compiled.config.protectedPaths).toContain('infra/**')
    expect(loaded.compiled.config.bigOperations).toEqual(expect.arrayContaining(['/^terraform\\s+apply/', 'merge-to-protected']))
    expect(loaded.compiled.config.bigOperations).not.toContain('no-such-rule')
    expect(loaded.errors.length).toBeGreaterThanOrEqual(6)
  })

  test('what cannot be read at all is ignored whole: not JSON, not an object, another schema version, or nothing', () => {
    for (const fileText of ['{ not json', '[]', '"text"', '7', 'null', textOf({ schemaVersion: 2, rules: [NO_DESTROY], protectedPaths: ['infra/**'] }), textOf({ rules: [NO_DESTROY] })]) {
      const loaded = loadConfig(fileText)
      expect(loaded.origin, fileText).toBe('shipped')
      expect(loaded.broken?.kind, fileText).toBe('ignored')
      expect(loaded.errors, fileText).not.toEqual([])
      expect(loaded.compiled.config, fileText).toEqual(SHIPPED)
      expect(loaded.compiled.rules.length, fileText).toBe(SHIPPED.rules.length)
    }
  })

  test('a broken file\'s project checks are counted as held back, whatever else is wrong with them; a readable file with none holds none', () => {
    expect(loadConfig(textOf(BROKEN)).broken).toMatchObject({ checks: 1 })
    expect(loadConfig(textOf({ schemaVersion: 1, nope: 1, gimli: { commands: [CHECK, { name: 'bad name', argv: [] }] } })).broken).toMatchObject({ checks: 2 })
    expect(loadConfig(textOf({ schemaVersion: 1, nope: 1, gimli: { commands: 'npm test' } })).broken).toMatchObject({ checks: 1 })
    expect(loadConfig(textOf({ schemaVersion: 1, nope: 1, gimli: { commands: [] } })).broken).toMatchObject({ checks: 0 })
    expect(loadConfig(textOf({ schemaVersion: 1, nope: 1 })).broken).toMatchObject({ checks: 0 })
    const counted = loadConfig(textOf(BROKEN))
    expect(ignoredChecksOf([counted, loadConfig(undefined)])).toBe(1)
    expect(ignoredChecksOf([loadConfig(textOf({ schemaVersion: 1, gimli: { commands: [CHECK] } }), SHIPPED, false)])).toBe(1)
  })

  test('a file without errors is as before: no broken mark', () => {
    const loaded = loadConfig(textOf({ schemaVersion: 1, rules: [ASK_DEPLOY] }))
    expect(loaded.broken).toBeUndefined()
    expect(loaded.origin).toBe('shipped+project')
    expect(loaded.errors).toEqual([])
  })
})

describe('validation caps (denial of service only)', () => {
  const rule = (extra: Record<string, unknown>) => ({ schemaVersion: 1, rules: [{ id: 'r', tier: 'ask', tools: ['Bash'], reason: 'Why.', ...extra }] })
  const regex = (length: number) => `^${'a'.repeat(length - 1)}`

  test('a regex source is at most 1,000 characters: 1,000 passes, 1,001 is an error, in every place a rules file holds a regex', () => {
    expect(MAX_REGEX_CHARS).toBe(1000)
    const places = (length: number) => [
      rule({ command: regex(length) }),
      rule({ path: regex(length) }),
      rule({ input: regex(length) }),
      rule({ tools: [`/${regex(length)}/`] }),
      { schemaVersion: 1, productionPatterns: [regex(length)] },
      { schemaVersion: 1, bigOperations: [`/${regex(length)}/i`] },
      { schemaVersion: 1, gollum: { patterns: [{ id: 'p', level: 'high', regex: regex(length), label: 'A key' }] } },
    ]
    for (const file of places(1000)) expect(validateOverrides(file).errors, JSON.stringify(file).slice(0, 60)).toEqual([])
    for (const file of places(1001)) {
      const { errors } = validateOverrides(file)
      expect(errors.join(' '), JSON.stringify(file).slice(0, 60)).toContain('at most 1000 characters')
    }
  })

  test('over the cap the entry is an error and the rest of the file still applies', () => {
    const loaded = loadConfig(textOf({ schemaVersion: 1, protectedPaths: ['infra/**'], rules: [{ ...ASK_DEPLOY, command: regex(1001) }, NO_DESTROY] }))
    expect(loaded.broken?.kind).toBe('partial')
    expect(loaded.errors.join(' ')).toContain('rules[0].command: a regex of at most 1000 characters')
    expect(projectIds(loaded)).toEqual(['no-destroy'])
    expect(loaded.compiled.config.protectedPaths).toContain('infra/**')
    expect(tierOf('terraform destroy', loaded)).toBe('block')
  })

  test('at most 200 rules and 200 patterns: 200 pass, 201 is an error, the first 200 are read and the rest of the file applies', () => {
    expect([MAX_RULES, MAX_PATTERNS]).toEqual([200, 200])
    const rules = (n: number) => Array.from({ length: n }, (_, index) => ({ id: `r${index}`, tier: 'review', tools: ['Bash'], command: `^never-run-${index}$`, reason: 'Why.' }))
    const patterns = (n: number) => Array.from({ length: n }, (_, index) => ({ id: `p${index}`, level: 'high', regex: `NEVER-${index}-[0-9]{4}`, label: 'A key' }))
    expect(validateOverrides({ schemaVersion: 1, rules: rules(200) }).errors).toEqual([])
    expect(validateOverrides({ schemaVersion: 1, gollum: { patterns: patterns(200) } }).errors).toEqual([])
    const tooMany = loadConfig(textOf({ schemaVersion: 1, protectedPaths: ['infra/**'], rules: [...rules(200), NO_DESTROY], gollum: { patterns: patterns(201) } }))
    expect(tooMany.errors).toEqual(expect.arrayContaining([expect.stringContaining('rules: at most 200 rules (201 given)'), expect.stringContaining('gollum.patterns: at most 200 patterns (201 given)')]))
    expect(tooMany.broken?.kind).toBe('partial')
    expect(projectIds(tooMany)).toHaveLength(200)
    expect(projectIds(tooMany)).not.toContain('no-destroy')
    expect(tooMany.compiled.config.protectedPaths).toContain('infra/**')
    // Patterns wait for trust at any size: none of them is in force.
    expect(tooMany.compiled.config.gollum).toEqual(SHIPPED.gollum)
  })
})

describe('a broken file in a session', () => {
  const write = (w: World, file: unknown): void => void w.files.set(RULES, typeof file === 'string' ? file : textOf(file))
  const ONLY = (extra: Record<string, unknown>) => ({ schemaVersion: 1, nope: 1, ...extra })

  test('the protected path asks, the block rule blocks, the ask rule asks; the allow rule is not applied and the model choice is ignored', async ($, on) => {
    const w = world(on, { replies: [APPROVE], answer: ALLOW_ONCE })
    write(w, BROKEN)
    expect(denyOf(await $.tool.call({ tool: 'Bash', command: 'terraform destroy' }))).toContain('Never destroy from here.')
    expect(w.asked).toEqual([])
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/infra/main.tf`, content: 'x' })
    expect(w.asked).toHaveLength(1)
    await $.tool.call({ tool: 'Bash', command: 'make deploy' })
    expect(w.asked).toHaveLength(2)
    expect(w.asked[1]?.question).toContain("Why it was gated (the project's own words):")
    // The allow rule would pass this unreviewed; the shipped review runs, on the built-in model.
    w.modelRequests.length = 0
    await $.tool.call(RM)
    expect(w.modelRequests).toHaveLength(1)
    expect(w.modelRequests[0]).toMatchObject({ model: 'sonnet' })
  })

  test('with the option at always the file is still not confirmed: the allow rule does nothing', { options: { trustProjectRules: 'always' } }, async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    write(w, BROKEN)
    await $.tool.call(RM)
    expect(w.modelRequests).toHaveLength(1)
    expect(w.modelRequests[0]).toMatchObject({ model: 'sonnet' })
  })

  test('its project check is not spawned: a big operation\'s council blocks with the check-not-run reason', async ($, on) => {
    const w = world(on, { replies: [APPROVE], isClockMocked: true })
    write(w, ONLY({ gimli: { commands: [CHECK] } }))
    const deny = denyOf(await $.tool.call(PUSH))
    expect(w.spawned).toEqual([])
    expect(deny).toContain('Decided by: the full council (block).')
    expect(deny).toContain('"project checks" could not be started. The error: not run: the project rules file has errors')
    expect(w.ran).toEqual([])
    const [line] = await auditLines(w)
    expect(line?.council).toMatchObject({ checks: [{ name: 'project checks', status: 'error' }] })
    expect(JSON.stringify(line)).not.toContain('npm')
  })

  test('without checks in the file the council is as without a file', async ($, on) => {
    const w = world(on, { replies: [APPROVE], isClockMocked: true })
    write(w, ONLY({ models: { gandalf: 'fable' } }))
    expect(await $.tool.call(PUSH)).toEqual({ result: 'ran' })
  })

  test('a file that is not JSON gives the shipped defaults: no protected path of its own, the shipped block still blocks', async ($, on) => {
    const w = world(on, { replies: [APPROVE], answer: ALLOW_ONCE })
    write(w, '{ "schemaVersion": 1, "protectedPaths": ["infra/**"], ')
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/infra/main.tf`, content: 'x' })
    expect(w.asked).toEqual([])
    expect(denyOf(await $.tool.call({ tool: 'Bash', command: 'rm -rf /' }))).toContain('(block)')
  })

  test('the person is told once: a transcript line and a toast, saying what applies; where something draws nothing enters the conversation', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    write(w, BROKEN)
    await $.tool.call(RM)
    await $.tool.call(RM)
    const lines = w.logs.filter(line => line.includes('has errors and is only partly applied'))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('nope: unknown field')
    expect(lines[0]).toContain('its project checks are not run')
    expect(w.toasts.filter(toast => toast.includes('partly applied'))).toHaveLength(1)
    expect(w.appended).toEqual([])
  })

  test('a file that cannot be read says so in the old words: ignored, the shipped rules in force', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    write(w, '{ not json')
    await $.tool.call(RM)
    expect(w.logs.filter(line => line.includes('was ignored and the shipped rules are in force'))).toHaveLength(1)
    expect(w.toasts.filter(toast => toast.includes('project rules ignored'))).toHaveLength(1)
  })

  test('where nothing draws one row reaches Claude through the relay, once per file content: the error count, nothing from the file', async ($, on) => {
    const w = world(on, { surfaces: [], replies: [APPROVE] })
    write(w, BROKEN)
    await $.tool.call(RM)
    await $.tool.call(RM)
    const rows = rowsOf(w).filter(row => row.includes('project rules file with 1 error(s)'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('Only what can make the gate stricter in it is applied')
    expect(rows[0]).not.toMatch(/nope|no-destroy|terraform|Never destroy|infra|fable|acme|npm|allow-clean|shell-delete|staging|prod-db/)
    // Reading the rules again does not repeat it for the same content; other content says it again.
    await council($, 'reload')
    await $.tool.call(RM)
    expect(rowsOf(w).filter(row => row.includes('project rules file with'))).toHaveLength(1)
    write(w, ONLY({ alsoNope: 1 }))
    await council($, 'reload')
    await $.tool.call(RM)
    expect(rowsOf(w).filter(row => row.includes('project rules file with'))).toHaveLength(2)
  })

  test('the row for a file that cannot be read says so, with a count and none of its text', async ($, on) => {
    const w = world(on, { surfaces: [], replies: [APPROVE] })
    write(w, '{ "secretish-key": "sk-never-shown", ')
    await $.tool.call(RM)
    await $.tool.call(RM)
    const rows = rowsOf(w).filter(row => row.includes('could not read'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('(1 error(s))')
    expect(rows[0]).not.toMatch(/secretish|sk-never|JSON|Unexpected/)
  })

  test('/council status and rules say how far a broken file applies', async ($, on) => {
    const w = world(on)
    write(w, ONLY({ protectedPaths: ['infra/**'] }))
    for (const sub of ['status', 'rules']) {
      const shown = await say($, w, sub)
      expect(shown, sub).toContain('Project rules file: partly applied: 1 error(s).')
      expect(shown, sub).toContain('/council rules lists the errors')
    }
    const rules = await say($, w, 'rules')
    expect(rules).toContain('Effective rules (shipped+project (partly applied))')
    expect(rules).toContain('The project rules file has errors and is partly applied')
    expect(rules).toContain('nope: unknown field')
    expect(rules).toContain('infra/**')

    write(w, '{ not json')
    await council($, 'reload')
    for (const sub of ['status', 'rules']) {
      const shown = await say($, w, sub)
      expect(shown, sub).toContain('Project rules file: ignored: not readable (1 error(s)).')
    }
    expect(await say($, w, 'rules')).toContain('The project rules file was ignored:')
  })

  test('where nothing draws, the relayed status carries the state as a count', async ($, on) => {
    const w = world(on, { surfaces: [] })
    write(w, ONLY({ protectedPaths: ['infra/**'] }))
    const result = (await council($, 'status')) as { context?: string[] }
    expect(result.context?.[0]).toContain('partly applied: 1 error(s)')
    expect(result.context?.[0]).not.toContain('nope')
  })

  test('/council test names the broken file as the reason the project checks would not run', async ($, on) => {
    const w = world(on, { surfaces: [] })
    write(w, ONLY({ gimli: { commands: [CHECK] } }))
    const shown = await say($, w, 'test "git push origin feature"')
    expect(shown).toContain('the rules file has errors, so the council would block until it is fixed')
    expect(shown).not.toContain('the rules file is not trusted')
  })

  test('mending the file and reloading puts it back in full', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    write(w, BROKEN)
    await $.tool.call(RM)
    expect(w.modelRequests).toHaveLength(1)
    write(w, { ...BROKEN, nope: undefined })
    await council($, 'reload')
    w.modelRequests.length = 0
    await $.tool.call(RM)
    // Now an ordinary unconfirmed file: its allow rule waits for confirmation, so the review still runs.
    expect(w.modelRequests).toHaveLength(1)
    expect(await say($, w, 'status')).not.toContain('partly applied')
  })

  test('a broken file in one repository does not touch another', async ($, on) => {
    const w = world(on, { multiRepo: true })
    w.files.set(APP_RULES, textOf({ schemaVersion: 1, nope: 1, protectedPaths: ['config/other/**'] }))
    await $.tool.call({ tool: 'Write', file_path: '/work/lib/src/a.ts', content: 'x' })
    await settled(w)
    expect(w.logs.filter(line => line.includes('has errors and is only partly applied'))).toHaveLength(0)
    await $.tool.call({ tool: 'Write', file_path: '/work/app/src/a.ts', content: 'x' })
    expect(w.logs.filter(line => line.includes('has errors and is only partly applied'))).toHaveLength(1)
  })
})
