import { describe, expect, test } from 'claude-code/testing'

import { combine } from '../hooks/elrond/combine.js'
import type { Voice } from '../hooks/elrond/combine.js'
import { refusalText } from '../hooks/elrond/refusal.js'
import type { GimliRun } from '../hooks/members/gimli.js'
import { allStrings, currentMode, flavourOf, setMode, text, themedKeys } from '../hooks/strings.js'
import { ALLOW_ONCE, auditLines, BLOCK, denyOf, KEEP_BLOCKED, THEME, withoutIds, world } from './fixtures.js'

/** What Claude reads: these families, and these single keys, never get a themed variant. */
const CLAUDE_FACING_FAMILIES = ['refusal.', 'reason.', 'alternative.', 'council.', 'gimli.', 'escalate.', 'route.', 'suggest.', 'notice.', 'report.']
const CLAUDE_FACING_KEYS = [
  'ask.header',
  'ask.confirmAllowlist',
  'ask.confirmAdd',
  'ask.confirmCancel',
  'ask.suggestRule',
  'ask.suggestAdd',
  'ask.suggestDecline',
  'ask.preview',
  'ask.secret',
  'ask.call',
  'ask.rule',
  'ask.verdict',
  'ask.failed',
]

type Dollar = { command: { run: (e: { command: string; args?: string }) => Promise<unknown> } }
const council = ($: unknown, args = '') => ($ as Dollar).command.run({ command: 'council', args })

describe('the strings table', () => {
  test('plain mode carries no theme text', () => {
    for (const line of allStrings('plain')) expect(line, line).not.toMatch(THEME)
  })

  test('nothing Claude reads has a themed variant', () => {
    const themed = themedKeys()
    // The check means something only if the themed keys are really listed.
    expect(themed).toEqual(expect.arrayContaining(['who.gandalf', 'who.fullCouncil', 'ask.rollHeader', 'ask.allowOnce', 'mode.bypass']))
    const claudeFacing = themed.filter(key => CLAUDE_FACING_FAMILIES.some(family => key.startsWith(family)) || CLAUDE_FACING_KEYS.includes(key))
    expect(claudeFacing).toEqual([])
  })

  test('the themed text follows the mode set at registration, plain until then', () => {
    expect(currentMode()).toBe('plain')
    expect(text('who.gandalf')).toBe('the destructive-operations reviewer')
    try {
      setMode('themed')
      expect(text('who.gandalf')).toBe('Gandalf')
      expect(text('who.gandalf', {}, 'plain')).toBe('the destructive-operations reviewer')
      expect(text('refusal.head')).toBe('This call was refused before it ran.')
    } finally {
      setMode('plain')
    }
  })

  test('flavour lines: themed only, and nothing for an unknown member or verdict', () => {
    expect(flavourOf('gandalf', 'block', 'themed')).toBe('You shall not pass.')
    expect(flavourOf('gimli', 'block', 'themed')).toBe('And my axe says no: the checks failed.')
    expect(flavourOf('council', 'approve', 'themed')).toBe('The council is agreed. Ready check passed.')
    expect(flavourOf('gandalf', 'block', 'plain')).toBeUndefined()
    expect(flavourOf('gandalf', 'block')).toBeUndefined()
    for (const [member, verdict] of [['gimli', 'approve'], ['gollum', 'revise'], ['sauron', 'block'], ['gandalf', 'maybe'], ['', ''], ['__proto__', 'x'], ['constructor', 'block']] as const) {
      expect(flavourOf(member, verdict, 'themed'), `${member}.${verdict}`).toBeUndefined()
    }
    try {
      setMode('themed')
      expect(flavourOf('legolas', 'revise')).toBe('Something stirs in this diff. Trim it.')
    } finally {
      setMode('plain')
    }
  })
})

describe('what Claude reads stays plain in the themed mode', () => {
  const voice = (member: 'gandalf' | 'legolas', who: 'who.gandalf' | 'who.legolas', value: 'revise' | 'block'): Voice => ({
    kind: 'verdict',
    who,
    member,
    verdict: { verdict: value, reason: 'Too wide.', safer_alternative: 'Do less.' },
  })
  const git: Voice = { kind: 'verdict', who: 'who.aragorn.git', member: 'aragorn', profile: 'git', verdict: { verdict: 'block', reason: 'Pushes to main.', safer_alternative: 'Push a branch.' } }
  const failed: Voice = { kind: 'failed', who: 'who.legolas', member: 'legolas', problem: 'it ran out of time or was interrupted' }
  const check: GimliRun = { name: 'tests', status: 'failed', code: 1, signal: null, tail: 'FAIL src/a.test.ts', ms: 1000 }

  test('refusalText names the role, never the character', () => {
    try {
      setMode('themed')
      for (const who of ['who.gandalf', 'who.legolas', 'who.aragorn.git', 'who.aragorn.database', 'who.gimli', 'who.gollum', 'who.galadriel', 'who.fullCouncil', 'who.council', 'who.rules'] as const) {
        const refusal = refusalText({ who, verdict: 'block', reason: 'Too wide.', alternative: 'Do less.', roundsLeft: 1, instruction: 'Use a branch.' })
        expect(refusal, who).not.toMatch(THEME)
        expect(refusal, who).toContain(`Decided by: ${text(who, {}, 'plain')} (block).`)
      }
    } finally {
      setMode('plain')
    }
  })

  test('the full council\'s reason, alternative and summary name roles and checks, never characters', () => {
    try {
      setMode('themed')
      const combined = combine([voice('gandalf', 'who.gandalf', 'block'), voice('legolas', 'who.legolas', 'revise'), git, failed], [check])
      expect(combined.verdict).toBe('block')
      expect(combined.reason).toContain('the destructive-operations reviewer (block): Too wide.')
      expect(combined.reason).toContain('the project checks (block): "tests" failed with exit code 1.')
      expect(combined.reason).toContain('the diff reviewer (block): no verdict')
      for (const field of [combined.reason, combined.alternative, combined.summary]) expect(field).not.toMatch(THEME)
      // The question the user reads is built from the keys, so it can still be themed.
      expect(combined.opinions.map(opinion => opinion.who)).toContain('who.gimli')
      const quiet = combine([], [{ ...check, status: 'timed-out' }])
      expect(quiet.alternative).not.toMatch(THEME)
      expect(combine([voice('gandalf', 'who.gandalf', 'revise')], []).alternative).toBe('the destructive-operations reviewer (revise): Do less.')
    } finally {
      setMode('plain')
    }
  })
})

describe('the loot roll (themed, the default)', () => {
  test('the dialog is headed "Loot roll" and offers Need and Pass', async ($, on) => {
    const w = world(on, { answer: ALLOW_ONCE })
    await $.tool.call({ tool: 'Bash', command: 'sudo systemctl restart nginx' })
    expect(w.asked[0]).toMatchObject({ header: 'Loot roll', options: ['Need: allow once', 'Pass: keep blocked'] })
    expect(w.asked[0]?.question).toContain('Loot roll: a gated call needs your decision.')
    expect(w.asked[0]?.question).toContain('Need allows it once, Pass keeps it blocked, or type an instruction for Claude.')
  })

  test('Need: allow once runs the call', async ($, on) => {
    const w = world(on, { answer: 'Need: allow once' })
    const call = { tool: 'Bash', command: 'sudo systemctl restart nginx' } as const
    expect(await $.tool.call(call)).toEqual({ result: 'ran' })
    expect(w.ran).toEqual([call])
    expect(auditLines(w)[0]).toMatchObject({ decision: 'allow-once', outcome: 'ran' })
  })

  test('Pass: keep blocked refuses the call, and the refusal Claude reads has no theme text', async ($, on) => {
    const w = world(on, { answer: 'Pass: keep blocked' })
    const deny = denyOf(await $.tool.call({ tool: 'Bash', command: 'sudo systemctl restart nginx' }))
    expect(deny).toContain('Decided by: the user (keep blocked).')
    expect(deny).not.toMatch(THEME)
    expect(w.ran).toEqual([])
    expect(auditLines(w)[0]).toMatchObject({ decision: 'keep-blocked', outcome: 'refused' })
  })

  test('the plain labels are not the answer here: they reach Claude as an instruction', async ($, on) => {
    const w = world(on, { answer: 'Allow once' })
    const deny = denyOf(await $.tool.call({ tool: 'Bash', command: 'sudo systemctl restart nginx' }))
    expect(deny).toContain('"Allow once". Follow it.')
    expect(w.ran).toEqual([])
  })

  test('a reviewer\'s block reads as a role to Claude and as a character to the user', async ($, on) => {
    const w = world(on, { replies: [BLOCK], answer: KEEP_BLOCKED })
    const deny = denyOf(await $.tool.call({ tool: 'Bash', command: 'rm -rf build' }))
    expect(deny).toContain('Decided by: the destructive-operations reviewer (block).')
    expect(deny).not.toMatch(THEME)
    const line = auditLines(w)[0]
    expect(JSON.stringify(line?.reason ?? '')).not.toMatch(THEME)
  })

  test('with nobody to ask, the refusal still reads plain', async ($, on) => {
    world(on, { surfaces: [] })
    const deny = denyOf(await $.tool.call({ tool: 'Bash', command: 'sudo systemctl restart nginx' }))
    expect(deny).toContain('nobody can be asked')
    expect(deny).not.toMatch(THEME)
  })

  test('the user sees the characters: the status, the bypass and the wipes', async ($, on) => {
    const w = world(on, { surfaces: [] })
    await council($)
    const status = w.logs.join('\n')
    expect(status).toContain('Gandalf [gandalf]: on')
    expect(status).toContain('0 wipes over 0 operations, 0 locked out')
    w.logs.length = 0
    await council($, 'off')
    expect(w.logs.join('\n')).toContain('Leeroy mode is on for this session')
    w.logs.length = 0
    await council($)
    expect(w.logs.join('\n')).toContain('Mode: Leeroy mode (gated calls pass without review)')
  })
})

describe('plain mode (the plainMode option)', () => {
  test('the dialog is headed "Council" with the plain labels, which are the ones compared', { options: { plainMode: true } }, async ($, on) => {
    const w = world(on, { answers: ['Allow once', 'Not now'], answer: 'Keep blocked' })
    const call = { tool: 'Bash', command: 'sudo systemctl restart nginx' } as const
    expect(await $.tool.call(call)).toEqual({ result: 'ran' })
    expect(w.asked[0]).toMatchObject({ header: 'Council', options: ['Allow once', 'Keep blocked'] })
    expect(withoutIds(w.asked[0]?.question ?? '')).not.toMatch(THEME)
    expect(w.asked[0]?.question).toContain('A gated call needs your decision.')
    expect(denyOf(await $.tool.call({ tool: 'Bash', command: 'sudo systemctl restart nginx' }))).toContain('(keep blocked)')
    // The themed labels are plain text to this mode: an instruction, not a decision.
    w.answers.push('Need: allow once')
    expect(denyOf(await $.tool.call({ tool: 'Bash', command: 'sudo systemctl restart nginx' }))).toContain('"Need: allow once". Follow it.')
  })

  test('the question names roles, for a reviewer that failed', { options: { plainMode: true } }, async ($, on) => {
    const w = world(on, { replies: [{ isAnswered: true, text: 'nope', usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }], answer: KEEP_BLOCKED })
    await $.tool.call({ tool: 'Bash', command: 'git rebase main' })
    const question = w.asked[0]?.question ?? ''
    expect(question).toContain('the git reviewer: no verdict')
    expect(withoutIds(question)).not.toMatch(THEME)
  })

  test('/council status, test, bypass and the mode label have no theme text', { options: { plainMode: true } }, async ($, on) => {
    const w = world(on, { surfaces: [] })
    await council($)
    await council($, 'test "git push origin feature && rm -rf build"')
    await council($, 'test "git rebase main"')
    await council($, 'test "git merge feature"')
    await council($, 'off')
    await council($)
    const shown = w.logs.join('\n')
    expect(shown).toContain('the destructive-operations reviewer [gandalf]')
    expect(shown).toContain('the full council [council]')
    expect(shown).toContain('0 refused or failed attempts over 0 operations')
    expect(shown).toContain('Bypass is on for this session')
    expect(shown).toContain('Mode: bypass (gated calls pass without review)')
    expect(withoutIds(shown)).not.toMatch(THEME)
  })
})
