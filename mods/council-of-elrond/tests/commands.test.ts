import { describe, expect, test } from 'claude-code/testing'

import { parseCouncil, words } from '../hooks/elrond/commands.js'
import { APPROVE, auditLines, BLOCK, denyOf, ROOT, USAGE, world } from './fixtures.js'

const PLUGIN = 'council-of-elrond'

type Dollar = { command: { run: (e: { command: string; args?: string }) => Promise<unknown> } }
const council = ($: unknown, args = '') => ($ as Dollar).command.run({ command: 'council', args })

describe('parsing', () => {
  test('subcommands and their arguments', () => {
    expect(parseCouncil('')).toEqual({ kind: 'status' })
    expect(parseCouncil('off')).toEqual({ kind: 'bypass', on: true })
    expect(parseCouncil('on')).toEqual({ kind: 'bypass', on: false })
    expect(parseCouncil('shadow on')).toEqual({ kind: 'shadow', on: true })
    expect(parseCouncil('shadow')).toMatchObject({ kind: 'usage' })
    expect(parseCouncil('log 5')).toEqual({ kind: 'log', count: 5 })
    expect(parseCouncil('test "rm -rf \'my dir\'"')).toEqual({ kind: 'test', command: "rm -rf 'my dir'" })
    expect(parseCouncil('test rm -rf build')).toEqual({ kind: 'test', command: 'rm -rf build' })
    expect(parseCouncil('model gandalf opus --save')).toEqual({ kind: 'model', slot: 'gandalf', model: 'opus', save: true })
    expect(parseCouncil('model')).toEqual({ kind: 'models' })
    expect(parseCouncil('frobnicate')).toMatchObject({ kind: 'usage', key: 'cmd.unknown' })
    expect(words('a "b c" \'d e\'')).toEqual(['a', 'b c', 'd e'])
  })
})

describe('/council', () => {
  test('its output never reaches Claude: no text in the result, lines to the transcript where nothing draws', async ($, on) => {
    const w = world(on, { surfaces: [] })
    const result = (await council($)) as { text?: string; context?: unknown }
    expect(result.text).toBeUndefined()
    expect(result.context).toBeUndefined()
    expect(w.logs.join('\n')).toContain('Mode: enforcing')
    expect(w.logs.join('\n')).toContain('Review tokens this session: 0 of 1500000')
  })

  test('where a surface draws, it opens the pane and draws the lines there', async ($, on) => {
    const w = world(on, { surfaces: ['terminal'] })
    await council($, 'rules')
    expect(w.panes).toEqual(['council'])
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: PLUGIN,
        surface,
        component: 'Pane',
        requestId: 'council',
        props: {
          title: 'Council',
          isFocused: false,
          bodyColumns: 80,
          placement: 'inline',
          scroll: { top: 0, bodyRows: 20 },
          view: {},
        } as never,
      })
      expect(await ui.find({ text: /rm-recursive-outside-repo/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('test classifies only: no process, no model, nothing runs', async ($, on) => {
    const w = world(on, { surfaces: [] })
    await council($, 'test "git push --force origin main && rm -rf /"')
    expect(w.processes).toEqual([])
    expect(w.modelRequests).toEqual([])
    expect(w.ran).toEqual([])
    const shown = w.logs.join('\n')
    expect(shown).toContain('Tier: block')
    expect(shown).toContain('force-push-protected-branch')
    expect(shown).toContain('Operation key:')

    w.logs.length = 0
    await council($, 'test "rm -rf build"')
    expect(w.logs.join('\n')).toMatch(/Reviewer: .+ \[gandalf\], model sonnet \(built-in\)/)
    w.logs.length = 0
    await council($, 'test "git rebase main"')
    expect(w.logs.join('\n')).toContain('Reviewer: the git reviewer [aragorn/git], model opus (built-in)')
    w.logs.length = 0
    await council($, 'test "git rebase main && rm -rf build"')
    expect(w.logs.join('\n')).toContain('Reviewer: the destructive-operations reviewer [gandalf], model sonnet (built-in)')
    expect(w.logs.join('\n')).toContain('The rule names the git reviewer [aragorn/git], but the parts of the command name different reviewers')
    w.logs.length = 0
    await council($, 'test "git push origin feature && rm -rf build"')
    expect(w.logs.join('\n')).toContain('Reviewer: the full council (a big operation: /^git\\s+push(\\s|$)/), model opus (built-in).')
    expect(w.logs.join('\n')).toContain('Seats: the destructive-operations reviewer [gandalf]; the diff reviewer [legolas], on what the push would change; the git reviewer [aragorn/git].')
    expect(w.logs.join('\n')).toContain('No project checks are configured')
    w.logs.length = 0
    await council($, 'test "ls -la"')
    expect(w.logs.join('\n')).toContain('No rule matches above allow')
  })

  test('test names the fallback when the rule\'s member is off, and nobody when Gandalf is off too', { options: { aragornEnabled: false } }, async ($, on) => {
    const w = world(on, { surfaces: [] })
    await council($, 'test "psql -c \'DELETE FROM t\'"')
    const shown = w.logs.join('\n')
    expect(shown).toContain('Reviewer: the destructive-operations reviewer [gandalf]')
    expect(shown).toContain('The rule names the database reviewer [aragorn/database], but it is switched off')
  })

  test('status lists every model member with its state, model and counts', { options: { legolasEnabled: false } }, async ($, on) => {
    const w = world(on, { surfaces: [], replies: [BLOCK] })
    await $.tool.call({ tool: 'Bash', command: 'git push origin feature' })
    await council($)
    const shown = w.logs.join('\n')
    expect(shown).toMatch(/\[gandalf\]: on, model sonnet \(built-in\); approved 0/)
    expect(shown).toMatch(/\[legolas\]: off, model sonnet/)
    expect(shown).toMatch(/\[aragorn\]: on, model opus \(built-in\); approved 0, revised 0, blocked 1/)
    expect(shown).not.toContain('later version')
  })

  test('rules shows each rule with its source', async ($, on) => {
    const w = world(on, { surfaces: [] })
    w.files.set(`${ROOT}/.claude/council-of-elrond/rules.json`, JSON.stringify({ schemaVersion: 1, rules: [{ id: 'mine', tier: 'ask', tools: ['Bash'], command: '^make deploy', reason: 'Deploys.' }] }))
    await council($, 'rules')
    const shown = w.logs.join('\n')
    expect(shown).toMatch(/ask\s+mine\s+\[project\]/)
    expect(shown).toMatch(/block\s+rm-recursive-outside-repo\s+\[shipped\]/)
  })

  test('log shows the last verdicts from the audit log', async ($, on) => {
    const w = world(on, { surfaces: [], replies: [BLOCK] })
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    await council($, 'log')
    expect(w.logs.join('\n')).toMatch(/Bash\s+review\s+gandalf: block\s+→ refused/)
  })

  test('reload picks up an edited rules file', async ($, on) => {
    const w = world(on, { surfaces: [], answer: 'Keep blocked' })
    expect(await $.tool.call({ tool: 'Bash', command: 'make deploy' })).toEqual({ result: 'ran' })
    w.files.set(`${ROOT}/.claude/council-of-elrond/rules.json`, JSON.stringify({ schemaVersion: 1, rules: [{ id: 'deploy', tier: 'ask', tools: ['Bash'], command: '^make deploy', reason: 'Deploys.' }] }))
    expect(await $.tool.call({ tool: 'Bash', command: 'make deploy' })).toEqual({ result: 'ran' })
    await council($, 'reload')
    expect(w.logs.join('\n')).toContain('Rules reloaded')
    expect(denyOf(await $.tool.call({ tool: 'Bash', command: 'make deploy' }))).toContain('(not allowed)')
  })

  test('session start registers the command and suggests shadow mode once while nothing is logged', async ($, on) => {
    const w = world(on)
    on('session.start', ($$, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    expect(w.commands).toEqual(['council'])
    expect(w.toasts.join('\n')).toContain('/council shadow on')
  })
})

describe('models', () => {
  test('a session switch is probed, then used by the reviewer', async ($, on) => {
    const w = world(on, { surfaces: [], replies: [APPROVE] })
    await council($, 'model gandalf opus')
    expect(w.modelRequests[0]).toMatchObject({ model: 'opus', maxTokens: 16 })
    expect(w.logs.join('\n')).toContain('gandalf uses opus for this session.')
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    expect(w.modelRequests[1]).toMatchObject({ model: 'opus', timeoutMs: 45000 })
  })

  test('a model that fails the probe is not switched to', async ($, on) => {
    const w = world(on, { surfaces: [], replies: [{ isAnswered: false, reason: 'api-error', status: 404, error: 'model_not_found', usage: USAGE }, APPROVE] })
    await council($, 'model gandalf claude-nonexistent-1')
    expect(w.logs.join('\n')).toContain('did not answer a test request (model_not_found)')
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    expect(w.modelRequests[1]).toMatchObject({ model: 'sonnet' })
  })

  test('--save writes the /config row for a picker value, and only then', async ($, on) => {
    const w = world(on, { surfaces: [] })
    await council($, 'model gandalf fable --save')
    expect(w.configSets).toEqual([{ key: 'council-of-elrond.gandalfModel', value: 'fable' }])
    await council($, 'model gandalf claude-opus-5-5 --save')
    expect(w.configSets).toHaveLength(1)
    expect(w.logs.join('\n')).toContain('Not saved')
    await council($, 'model')
    expect(w.logs.join('\n')).toContain('gandalf: claude-opus-5-5 (session)')
  })

  test('--save writes the diff, git-and-database and full council rows', async ($, on) => {
    const w = world(on, { surfaces: [], replies: [APPROVE] })
    await council($, 'model legolas opus --save')
    await council($, 'model aragorn sonnet --save')
    await council($, 'model council fable --save')
    expect(w.configSets).toEqual([
      { key: 'council-of-elrond.legolasModel', value: 'opus' },
      { key: 'council-of-elrond.aragornModel', value: 'sonnet' },
      { key: 'council-of-elrond.councilModel', value: 'fable' },
    ])
    expect(w.logs.join('\n')).not.toContain('no /config row')
    // A push is a big operation: every member sits on the council's model, not its own.
    const before = w.modelRequests.length
    await $.tool.call({ tool: 'Bash', command: 'git push origin feature' })
    expect(w.modelRequests.slice(before).map(request => request.model)).toEqual(['fable', 'fable', 'fable'])
  })

  test('default clears the session switch; unknown members and ids are refused', async ($, on) => {
    const w = world(on, { surfaces: [] })
    await council($, 'model gandalf opus')
    await council($, 'model gandalf default')
    expect(w.logs.join('\n')).toContain('gandalf no longer has a session switch; it uses sonnet (built-in).')
    await council($, 'model gimli opus')
    await council($, 'model gandalf "rm -rf /"')
    expect(w.logs.join('\n')).toContain('Unknown member "gimli"')
    expect(w.logs.join('\n')).toContain('is not a model alias or id')
  })
})

describe('bypass', () => {
  test('/council off passes gated calls unreviewed and logged; /council on ends it', async ($, on) => {
    const w = world(on, { surfaces: [], replies: [BLOCK] })
    await council($, 'off')
    expect(await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })).toEqual({ result: 'ran' })
    expect(w.modelRequests).toEqual([])
    expect(auditLines(w)[0]).toMatchObject({ bypass: true, outcome: 'ran' })
    await council($, 'on')
    expect(denyOf(await $.tool.call({ tool: 'Bash', command: 'rm -rf build' }))).toContain('(block)')
  })
})

describe('shadow mode', () => {
  test('reviewer verdicts are logged and never refuse', async ($, on) => {
    const w = world(on, { surfaces: [], replies: [BLOCK] })
    await council($, 'shadow on')
    expect(await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })).toEqual({ result: 'ran' })
    expect(auditLines(w)[0]).toMatchObject({ verdict: 'block', shadow: true, outcome: 'ran' })
    // Not a round, not a failed attempt: it keeps being reviewed.
    for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    expect(w.modelRequests).toHaveLength(4)
  })

  test('a failed review passes too, logged', { options: { shadowMode: true } }, async ($, on) => {
    const w = world(on, { replies: [{ isAnswered: false, reason: 'aborted', usage: USAGE }] })
    expect(await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })).toEqual({ result: 'ran' })
    expect(w.asked).toEqual([])
    expect(auditLines(w)[0]).toMatchObject({ verdict: 'failed', shadow: true })
  })

  test('block rules, the ask tier and protected paths still enforce', { options: { shadowMode: true } }, async ($, on) => {
    const w = world(on, { answer: 'Keep blocked' })
    expect(denyOf(await $.tool.call({ tool: 'Bash', command: 'rm -rf /' }))).toContain('(block)')
    expect(denyOf(await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/.env`, old_string: 'A=1', new_string: 'A=2' }))).toContain('(keep blocked)')
    expect(w.asked).toHaveLength(1)
    expect(w.ran).toEqual([])
  })

  test('the session switch overrides the setting', { options: { shadowMode: true } }, async ($, on) => {
    world(on, { surfaces: [], replies: [BLOCK] })
    await council($, 'shadow off')
    expect(denyOf(await $.tool.call({ tool: 'Bash', command: 'rm -rf build' }))).toContain('(block)')
  })
})

describe('the mode label', () => {
  test('shows by the prompt while shadow or bypass is on, on terminal and desktop', async ($, on) => {
    world(on, { surfaces: [] })
    // The engine's own drawing of the labels, beneath the plugin.
    on('ui.render', { component: 'SessionMode' }, ($$, e) => {
      const { Text } = $$.ui.resolve(e)
      return h(Text, null, e.props.modes.join(' & ')) as never
    })
    for (const surface of ['terminal', 'desktop'] as const) {
      const quiet = await $.ui.mount({ plugin: PLUGIN, surface, component: 'SessionMode', props: { modes: [] } })
      expect(await quiet.find({ text: /council:/ })).toBeUndefined()
      await quiet.unmount()
    }
    await council($, 'shadow on')
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'SessionMode', props: { modes: ['focus'] } })
      expect(await ui.find({ text: /council: shadow/ })).toBeDefined()
      await ui.unmount()
    }
    await council($, 'off')
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
    expect(await ui.find({ text: /council: bypass/ })).toBeDefined()
  })

  test('on a surface with no mode labels, it goes to the status line', async ($, on) => {
    const w = world(on, { surfaces: ['vscode'] })
    await council($, 'shadow on')
    expect(w.statuses).toContain('council: shadow')
  })
})

describe('allow once', () => {
  test('labels Claude Code\'s own permission dialog', async ($, on) => {
    const w = world(on, { answer: 'Allow once' })
    await $.tool.call({ tool: 'Bash', command: 'sudo ls', tool_use_id: 'tu-1' } as never)
    expect(w.notices).toEqual([{ id: 'tu-1', text: 'Council: you allowed this once' }])
  })
})
