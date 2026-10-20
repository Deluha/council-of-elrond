import { describe, expect, test } from 'claude-code/testing'

import { fingerprintOf } from '../hooks/audit.js'
import { callKeyOf, codeOf, parseChatLines } from '../hooks/elrond/chat.js'
import { INITIAL_SESSION } from '../hooks/state.js'
import type { CouncilSession } from '../types'
import { ALLOW_ONCE, auditLines, council, denyOf, FAKE_GITHUB_TOKEN, FAKE_JWT, KEEP_BLOCKED, ROOT, settled, watchState, world } from './fixtures.js'
import type { World } from './fixtures.js'

/**
 * ROADMAP C4 (DESIGN §14.4): where nothing draws, a person approves or refuses a
 * refused call by typing `council allow <code>` / `council deny <code>` on a line
 * of their own. Only a person's prompt counts; the fixtures' `surfaces: []` world.
 */

type Origin = { kind: string; name?: string }
type Seen = { text: string; context?: readonly string[] }
type Submit = { prompt: { submit: (e: never) => Promise<unknown> } }
type Result = { text: string; context?: string[] }

const COMPOSER: Origin = { kind: 'composer' }
const SUDO = { tool: 'Bash', command: 'sudo ls' } as const
/** A call a project rule could never be written for: it spans lines, so only "once" is accepted. */
const MULTI = { tool: 'Bash', command: 'sudo ls\nid' } as const
const BLOCKED = { tool: 'Bash', command: 'rm -rf /' } as const
const PROTECTED = { tool: 'Bash', command: 'cat .env' } as const
const WRITE_LOW = { tool: 'Write', file_path: `${ROOT}/src/b.ts`, content: 'const password = "hunter2xyz"' } as const

const say = ($: unknown, text: string, origin: Origin = COMPOSER): Promise<Result> =>
  ($ as Submit).prompt.submit({ text, wait: false, origin } as never) as Promise<Result>

/** The bottom of the prompt chain: records what reached the model. */
function sink(on: Parameters<typeof world>[0]): Seen[] {
  const seen: Seen[] = []
  on('prompt.submit', ($$, e) => {
    seen.push({ text: e.text, ...(e.context !== undefined && { context: e.context }) })
    return { text: e.text, ...(e.context !== undefined && { context: e.context }) }
  })
  return seen
}

const codeIn = (deny: string): string => /council:([0-9a-f]{6})/.exec(deny)?.[1] ?? ''

const lastOf = (written: readonly unknown[]): CouncilSession => written.at(-1) as CouncilSession

/** A refused call's code, from its refusal. */
async function refusedCode($: unknown, call: Record<string, unknown>): Promise<string> {
  const code = codeIn(denyOf(await ($ as { tool: { call: (e: never) => Promise<unknown> } }).tool.call(call as never)))
  expect(code).toMatch(/^[0-9a-f]{6}$/)
  return code
}

const run = ($: unknown, call: Record<string, unknown>): Promise<unknown> => ($ as { tool: { call: (e: never) => Promise<unknown> } }).tool.call(call as never)

describe('the refusal carries a code', () => {
  test('an ask-tier call: council:<six hex>, the first six characters of the key without its description; one offer', async ($, on) => {
    const w = world(on, { surfaces: [] })
    const state = watchState(on)
    const deny = denyOf(await run($, { ...SUDO, description: 'List the files' }))
    const code = codeIn(deny)
    expect(code).toMatch(/^[0-9a-f]{6}$/)
    const key = await fingerprintOf('Bash', { command: 'sudo ls' })
    expect(code).toBe(key.slice(0, 6))
    expect(deny).toContain(`give them its code, council:${code}.`)
    expect(deny).toContain(`they type council allow ${code} on its own line in their next message (or council allow ${code} session to allow it for the rest of this session); council deny ${code} refuses it.`)
    expect(deny).toContain('Do not retry it before they answer; if they allow it, make the same call again with the same arguments, the one exception to not retrying it unchanged.')
    // The reason and the failed attempt are as before.
    expect(deny).toContain('nobody can be asked in this session')
    expect(deny).toContain('Decided by: the user (not allowed).')
    expect(lastOf(state.written).chatOffers).toEqual([{ code, callKey: key, canSession: true, epoch: 0 }])
    expect(w.ran).toEqual([])
  })

  test('the key keeps every other field, so the sandbox flag is a different call', async () => {
    const plain = await callKeyOf({ tool: 'Bash', input: { command: 'sudo ls', description: 'a' } })
    expect(plain).toBe(await callKeyOf({ tool: 'Bash', input: { command: 'sudo ls', description: 'other wording' } }))
    expect(plain).toBe(await callKeyOf({ tool: 'Bash', input: { command: 'sudo ls' } }))
    expect(plain).not.toBe(await callKeyOf({ tool: 'Bash', input: { command: 'sudo ls', dangerouslyDisableSandbox: true } }))
    expect(plain).not.toBe(await callKeyOf({ tool: 'Bash', input: { command: 'sudo ls', timeout: 5 } }))
    expect(plain).not.toBe(await callKeyOf({ tool: 'Bash', input: { command: 'sudo ls', run_in_background: true } }))
    // A file tool's own `description`-named field is part of the call.
    expect(await callKeyOf({ tool: 'Write', input: { file_path: '/work/a', content: 'x', description: 'a' } })).not.toBe(
      await callKeyOf({ tool: 'Write', input: { file_path: '/work/a', content: 'x' } }),
    )
    expect(codeOf(plain)).toBe(plain.slice(0, 6))
  })

  test('a protected path and a block rule: today\'s refusal, no code, no offer', async ($, on) => {
    world(on, { surfaces: [] })
    const state = watchState(on)
    const protectedDeny = denyOf(await run($, PROTECTED))
    expect(protectedDeny).toContain('nobody can be asked in this session')
    expect(protectedDeny).toContain('Safer alternative: Tell the user that this call was refused and why. The user can let such a call run')
    expect(protectedDeny).not.toContain('council:')
    expect(lastOf(state.written).chatOffers).toEqual([])
    const blockedDeny = denyOf(await run($, BLOCKED))
    expect(blockedDeny).toContain('(block)')
    expect(blockedDeny).not.toContain('council:')
    expect(lastOf(state.written).chatOffers).toEqual([])
  })

  test('a call that can only be allowed once is offered without the session form', async ($, on) => {
    world(on, { surfaces: [] })
    const state = watchState(on)
    const deny = denyOf(await run($, MULTI))
    const code = codeIn(deny)
    expect(deny).toContain(`they type council allow ${code} on its own line in their next message; council deny ${code} refuses it.`)
    expect(deny).not.toContain('session to allow it')
    expect(lastOf(state.written).chatOffers).toMatchObject([{ code, canSession: false }])
  })
})

describe('council allow <code>', () => {
  test('lets the same call run once; the audit line says chat-allow; the next identical call is refused again, with a new offer', async ($, on) => {
    const w = world(on, { surfaces: [] })
    const seen = sink(on)
    const state = watchState(on)
    const code = await refusedCode($, SUDO)
    const reply = await say($, `council allow ${code}`)
    expect(reply.text).toBe('')
    expect(reply.context).toEqual([`The user typed council allow ${code} (removed from their message). The council will let that exact call run once, if you make it before the user writes again: make it again with the same arguments if it is still wanted.`])
    expect(seen).toEqual([{ text: '', context: reply.context }])
    expect(await run($, SUDO)).toEqual({ result: 'ran' })
    expect(w.ran).toHaveLength(1)
    // Spent on use.
    expect(lastOf(state.written).chatAllowances).toEqual([])
    const again = denyOf(await run($, SUDO))
    expect(again).toContain('nobody can be asked in this session')
    expect(codeIn(again)).toBe(code)
    expect(lastOf(state.written).chatOffers).toMatchObject([{ code }])
    expect(w.ran).toHaveLength(1)
    const lines = await auditLines(w)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatchObject({ decision: 'unavailable', outcome: 'refused' })
    expect(lines[1]).toMatchObject({ decision: 'chat-allow', outcome: 'ran', tier: 'ask', ruleId: 'privileged' })
    expect(lines[2]).toMatchObject({ decision: 'unavailable', outcome: 'refused' })
  })

  test('a new description on the retry is still the same call', async ($, on) => {
    const w = world(on, { surfaces: [] })
    sink(on)
    const code = await refusedCode($, { ...SUDO, description: 'List the files' })
    await say($, `council allow ${code}`)
    expect(await run($, { ...SUDO, description: 'Show what is in the folder' })).toEqual({ result: 'ran' })
    expect(w.ran).toHaveLength(1)
    expect((await auditLines(w))[1]).toMatchObject({ decision: 'chat-allow', outcome: 'ran' })
  })

  test('a different call is not covered', async ($, on) => {
    const w = world(on, { surfaces: [] })
    sink(on)
    const code = await refusedCode($, SUDO)
    await say($, `council allow ${code}`)
    expect(denyOf(await run($, { tool: 'Bash', command: 'sudo ls -a' }))).toContain('nobody can be asked')
    expect(denyOf(await run($, { ...SUDO, dangerouslyDisableSandbox: true }))).toContain('nobody can be asked')
    expect(w.ran).toEqual([])
  })

  test('the allowance is gone after the next person\'s prompt, and after a prompt that is not a person\'s', async ($, on) => {
    const w = world(on, { surfaces: [] })
    sink(on)
    const code = await refusedCode($, SUDO)
    await say($, `council allow ${code}`)
    await say($, 'ok, carry on')
    expect(denyOf(await run($, SUDO))).toContain('nobody can be asked')
    // Allowed again, then a task finishes: the allowance does not carry across that prompt either.
    const second = await refusedCode($, SUDO)
    await say($, `council allow ${second}`)
    await say($, 'a task finished', { kind: 'task-notification' })
    expect(denyOf(await run($, SUDO))).toContain('nobody can be asked')
    expect(w.ran).toEqual([])
  })

  test('two identical calls after one once-allowance, running together: one runs, one is refused', async ($, on) => {
    const w = world(on, { surfaces: [] })
    sink(on)
    const code = await refusedCode($, SUDO)
    await say($, `council allow ${code}`)
    const results = await Promise.all([run($, SUDO), run($, SUDO)])
    expect(results.filter(result => (result as { deny?: unknown }).deny === undefined)).toHaveLength(1)
    expect(results.filter(result => denyOf(result) !== '')).toHaveLength(1)
    expect(w.ran).toHaveLength(1)
  })

  test('a once-allowance for a call with a low secrets finding lets it carry on to its tier', async ($, on) => {
    const w = world(on, { surfaces: [] })
    sink(on)
    const code = await refusedCode($, WRITE_LOW)
    await say($, `council allow ${code}`)
    expect(await run($, WRITE_LOW)).toEqual({ result: 'ran' })
    expect(w.ran).toHaveLength(1)
    expect((await auditLines(w))[1]).toMatchObject({ decision: 'chat-allow', outcome: 'ran' })
  })
})

describe('council allow <code> session', () => {
  test('the call runs, and again after more of the person\'s prompts; the audit line says chat-session', async ($, on) => {
    const w = world(on, { surfaces: [] })
    const seen = sink(on)
    const code = await refusedCode($, SUDO)
    const reply = await say($, `council allow ${code} session`)
    expect(reply.context?.[0]).toContain(`The user typed council allow ${code} session (removed from their message). The council will let that exact call run whenever you make it, for the rest of this session.`)
    expect(seen).toHaveLength(1)
    expect(await run($, SUDO)).toEqual({ result: 'ran' })
    await say($, 'next thing')
    await say($, 'and another')
    expect(await run($, SUDO)).toEqual({ result: 'ran' })
    expect(await run($, SUDO)).toEqual({ result: 'ran' })
    expect(w.ran).toHaveLength(3)
    const lines = await auditLines(w)
    expect(lines.slice(1).map(line => line.decision)).toEqual(['chat-session', 'chat-session', 'chat-session'])
  })

  test('survives a prompt that is not a person\'s', async ($, on) => {
    const w = world(on, { surfaces: [] })
    sink(on)
    const code = await refusedCode($, SUDO)
    await say($, `council allow ${code} session`)
    await say($, 'a task finished', { kind: 'task-notification' })
    expect(await run($, SUDO)).toEqual({ result: 'ran' })
    expect(w.ran).toHaveLength(1)
  })

  test('for a call that can only be allowed once, nothing is recorded and Claude is told', async ($, on) => {
    const w = world(on, { surfaces: [] })
    sink(on)
    const state = watchState(on)
    for (const call of [MULTI, WRITE_LOW]) {
      const code = await refusedCode($, call)
      const reply = await say($, `council allow ${code} session`)
      expect(reply.context).toEqual([`The user typed council allow ${code} session (removed from their message), but this call can only be allowed once (for example a script, a long or multi-line command, or a possible secret in it), so nothing was recorded. Tell them to type council allow ${code} to allow it once.`])
      expect(lastOf(state.written).chatAllowances).toEqual([])
      expect(denyOf(await run($, call))).toContain('nobody can be asked')
    }
    expect(w.ran).toEqual([])
  })
})

describe('council deny <code>', () => {
  test('the next identical call is refused with the user\'s reason; it is not a failed attempt; the audit decision is chat-deny', async ($, on) => {
    const w = world(on, { surfaces: [] })
    sink(on)
    const state = watchState(on)
    const code = await refusedCode($, SUDO)
    const reply = await say($, `council deny ${code}`)
    expect(reply.context).toEqual([`The user typed council deny ${code} (removed from their message): they refuse that call. Do not make it again; ask them how they want to proceed.`])
    const deny = denyOf(await run($, SUDO))
    expect(deny).toContain('Reason: The user refused this call in chat (council deny).')
    expect(deny).toContain('Decided by: the user (not allowed).')
    expect(deny).toContain('Safer alternative: Stop and ask the user how they want to proceed.')
    // No failed attempt: the prompt cleared the counters and this refusal added none.
    expect(lastOf(state.written).ops).toEqual({})
    expect(lastOf(state.written).chatDenials).toEqual([])
    const lines = await auditLines(w)
    expect(lines[1]).toMatchObject({ decision: 'chat-deny', outcome: 'refused' })
    // Spent on use: the call after that is refused for want of anyone to ask, and counts.
    expect(denyOf(await run($, SUDO))).toContain('nobody can be asked')
    expect(Object.values(lastOf(state.written).ops)).toMatchObject([{ wipes: 1 }])
    expect(w.ran).toEqual([])
  })

  test('a denial wins over an allowance for the same call typed before it in one message', async ($, on) => {
    const w = world(on, { surfaces: [] })
    sink(on)
    const code = await refusedCode($, SUDO)
    await say($, `council allow ${code}\ncouncil deny ${code}`)
    expect(denyOf(await run($, SUDO))).toContain('council deny')
    expect(w.ran).toEqual([])
  })
})

describe('parsing the prompt line (pure)', () => {
  const only = (message: string) => parseChatLines(message).commands

  test('the three valid forms, in any case, with the council: prefix and any spacing', () => {
    expect(only('council allow 1a2b3c')).toEqual([{ kind: 'allow', code: '1a2b3c', scope: 'once' }])
    expect(only('council allow 1a2b3c session')).toEqual([{ kind: 'allow', code: '1a2b3c', scope: 'session' }])
    expect(only('council deny 1a2b3c')).toEqual([{ kind: 'deny', code: '1a2b3c', scope: 'once' }])
    expect(only('COUNCIL ALLOW 1A2B3C SESSION')).toEqual([{ kind: 'allow', code: '1a2b3c', scope: 'session' }])
    expect(only('Council Deny 1A2b3C')).toEqual([{ kind: 'deny', code: '1a2b3c', scope: 'once' }])
    expect(only('council allow council:1a2b3c')).toEqual([{ kind: 'allow', code: '1a2b3c', scope: 'once' }])
    expect(only('  council \t allow    council:1a2b3c   session  ')).toEqual([{ kind: 'allow', code: '1a2b3c', scope: 'session' }])
    expect(only('council allow 1a2b3c\r')).toEqual([{ kind: 'allow', code: '1a2b3c', scope: 'once' }])
  })

  test('anything else on such a line is malformed', () => {
    for (const line of [
      'council allow',
      'council deny',
      'council allow xyz',
      'council allow 1a2b3g',
      'council allow 1a2b3',
      'council allow 1a2b3c4',
      'council deny 1a2b3c session',
      'council allow 1a2b3c now',
      'council allow 1a2b3c session now',
      'council allow council:',
      'council allow council: 1a2b3c',
      'council allow-all',
      'council allow, please 1a2b3c',
    ]) {
      expect(only(line), line).toEqual([{ kind: 'malformed' }])
    }
  })

  test('a chat line is removed wherever it is and the other lines are kept as typed', () => {
    expect(parseChatLines('fix the build\ncouncil allow 1a2b3c\nthanks')).toEqual({
      commands: [{ kind: 'allow', code: '1a2b3c', scope: 'once' }],
      rest: 'fix the build\nthanks',
    })
    expect(parseChatLines('council allow 1a2b3c\n\n  indented\n').rest).toBe('\n  indented')
    expect(parseChatLines('go\n\ncouncil deny 1a2b3c\ncouncil allow nonsense\n')).toEqual({
      commands: [{ kind: 'deny', code: '1a2b3c', scope: 'once' }, { kind: 'malformed' }],
      rest: 'go',
    })
    expect(parseChatLines('council allow 1a2b3c').rest).toBe('')
  })

  test('text that merely contains the words is not a chat line', () => {
    for (const message of [
      'please council allow 1a2b3c',
      'I typed council allow 1a2b3c earlier',
      '> council allow 1a2b3c',
      '`council allow 1a2b3c`',
      'the council allowed it',
      'council allowance 1a2b3c',
      'council',
      'council  members allow 1a2b3c',
      '',
    ]) {
      expect(parseChatLines(message), message).toEqual({ commands: [], rest: message })
    }
  })

  test('at most ten lines are acted on; the rest are removed and answered as malformed', () => {
    const lines = Array.from({ length: 12 }, (_, n) => `council allow ${n.toString(16).padStart(6, '0')}`)
    const { commands, rest } = parseChatLines(['keep', ...lines, 'me'].join('\n'))
    expect(commands).toHaveLength(12)
    expect(commands.slice(0, 10).every(command => command.kind === 'allow')).toBe(true)
    expect(commands.slice(10)).toEqual([{ kind: 'malformed' }, { kind: 'malformed' }])
    expect(rest).toBe('keep\nme')
  })
})

describe('through the prompt hook', () => {
  test('a malformed line and an unknown code are answered, stripped, and record nothing', async ($, on) => {
    world(on, { surfaces: [] })
    const seen = sink(on)
    const state = watchState(on)
    const reply = await say($, 'please look at it\ncouncil allow\ncouncil allow abcdef\ncouncil deny 123456 session\nthen carry on')
    expect(reply.text).toBe('please look at it\nthen carry on')
    expect(reply.context).toHaveLength(3)
    expect(reply.context?.[0]).toBe(
      "The user's message had a council allow or council deny line without a valid six-character code (removed from their message), so nothing was recorded. Tell them the line is council allow <code> or council deny <code>, with the code from the refusal.",
    )
    expect(reply.context?.[1]).toBe(
      'The user typed council allow abcdef (removed from their message), but no call refused since their previous message has that code, so nothing was recorded. Tell them, and that the code comes from the latest refusal.',
    )
    // `deny … session` is malformed, whatever the code.
    expect(reply.context?.[2]).toContain('without a valid six-character code')
    expect(seen).toEqual([{ text: reply.text, context: reply.context }])
    const after = lastOf(state.written)
    expect(after.chatAllowances).toEqual([])
    expect(after.chatDenials).toEqual([])
    // Never the person's raw line.
    expect(JSON.stringify(reply.context)).not.toContain('please look')
    expect(JSON.stringify(reply.context)).not.toContain('session\nthen')
  })

  test('the latest prompt a reviewer sees is the message without its chat lines', async ($, on) => {
    world(on, { surfaces: [] })
    sink(on)
    const state = watchState(on)
    await say($, 'delete the build\ncouncil allow abcdef')
    expect(lastOf(state.written).latestPrompt).toBe('delete the build')
  })

  test('a prompt without a chat line passes unchanged: the same text, no context added', async ($, on) => {
    world(on, { surfaces: [] })
    const seen = sink(on)
    const reply = await say($, 'just a message\nwith two lines, and the word council allow mid-line')
    expect(reply).toEqual({ text: 'just a message\nwith two lines, and the word council allow mid-line' })
    expect(seen).toEqual([{ text: 'just a message\nwith two lines, and the word council allow mid-line' }])
  })

  test('an existing context is kept and the acknowledgements follow it', async ($, on) => {
    world(on, { surfaces: [] })
    sink(on)
    const reply = (await ($ as Submit).prompt.submit({ text: 'council allow abcdef', context: ['earlier'], wait: false, origin: COMPOSER } as never)) as Result
    expect(reply.context?.[0]).toBe('earlier')
    expect(reply.context).toHaveLength(2)
  })

  test('the bridge is a person too', async ($, on) => {
    const w = world(on, { surfaces: [] })
    sink(on)
    const code = await refusedCode($, SUDO)
    await say($, `council allow ${code}`, { kind: 'bridge' })
    expect(await run($, SUDO)).toEqual({ result: 'ran' })
    expect(w.ran).toHaveLength(1)
  })

  test('a slash command is never parsed: its text cannot be rewritten, so nothing is recorded and the call is still refused', async ($, on) => {
    const w = world(on, { surfaces: [] })
    const seen = sink(on)
    const state = watchState(on)
    const code = await refusedCode($, SUDO)
    const text = `/review the diff\ncouncil allow ${code}`
    await ($ as Submit).prompt.submit({ text, command: { name: 'review', args: `the diff\ncouncil allow ${code}` }, wait: false, origin: COMPOSER } as never)
    expect(seen.at(-1)).toEqual({ text })
    expect(lastOf(state.written).chatAllowances).toEqual([])
    expect(denyOf(await run($, SUDO))).toContain('nobody can be asked')
    expect(w.ran).toEqual([])
  })

  test('a /council command is not a prompt to answer', async ($, on) => {
    world(on, { surfaces: [] })
    const seen = sink(on)
    const code = await refusedCode($, SUDO)
    await ($ as Submit).prompt.submit({ text: `/council status\ncouncil allow ${code}`, command: { name: 'council', args: 'status' }, wait: false, origin: COMPOSER } as never)
    expect(seen.at(-1)?.text).toContain(`council allow ${code}`)
    expect(denyOf(await run($, SUDO))).toContain('nobody can be asked')
  })
})

describe('only a person\'s prompt counts', () => {
  test('the same line from sdk, peer, plugin and task-notification records nothing and is left as text', async ($, on) => {
    const w = world(on, { surfaces: [] })
    const seen = sink(on)
    const state = watchState(on)
    const code = await refusedCode($, SUDO)
    const message = `do it\ncouncil allow ${code}\ncouncil allow ${code} session`
    const origins: Origin[] = [{ kind: 'sdk' }, { kind: 'peer' }, { kind: 'plugin', name: 'x' }, { kind: 'task-notification' }]
    for (const origin of origins) {
      const reply = await say($, message, origin)
      expect(reply, origin.kind).toEqual({ text: message })
      expect(seen.at(-1), origin.kind).toEqual({ text: message })
      expect(lastOf(state.written).chatAllowances, origin.kind).toEqual([])
    }
    expect(denyOf(await run($, SUDO))).toContain('nobody can be asked')
    expect(w.ran).toEqual([])
  })

  test('so too the other origins that no person typed', async ($, on) => {
    const w = world(on, { surfaces: [] })
    sink(on)
    const code = await refusedCode($, SUDO)
    for (const kind of ['channel', 'scheduled-trigger', 'coordinator', 'observer', 'auto-continuation', 'unclassified', 'peer-send-message']) {
      const reply = await say($, `council allow ${code}`, { kind })
      expect(reply, kind).toEqual({ text: `council allow ${code}` })
    }
    expect(denyOf(await run($, SUDO))).toContain('nobody can be asked')
    expect(w.ran).toEqual([])
  })

  test('an offer from an earlier person\'s prompt is not accepted', async ($, on) => {
    const w = world(on, { surfaces: [] })
    sink(on)
    const code = await refusedCode($, SUDO)
    await say($, 'ok')
    const reply = await say($, `council allow ${code}`)
    expect(reply.context).toEqual([`The user typed council allow ${code} (removed from their message), but no call refused since their previous message has that code, so nothing was recorded. Tell them, and that the code comes from the latest refusal.`])
    expect(denyOf(await run($, SUDO))).toContain('nobody can be asked')
    expect(w.ran).toEqual([])
  })

  test('an offer survives a prompt that is not a person\'s', async ($, on) => {
    const w = world(on, { surfaces: [] })
    sink(on)
    const code = await refusedCode($, SUDO)
    await say($, 'a task finished', { kind: 'task-notification' })
    await say($, `council allow ${code}`)
    expect(await run($, SUDO)).toEqual({ result: 'ran' })
    expect(w.ran).toHaveLength(1)
  })
})

describe('never for what the dialog could not allow either', () => {
  test('a block rule and a protected path are refused after any allow: nothing to allow', async ($, on) => {
    const w = world(on, { surfaces: [] })
    sink(on)
    const state = watchState(on)
    const known = await refusedCode($, SUDO)
    for (const call of [BLOCKED, PROTECTED]) {
      expect(denyOf(await run($, call))).not.toContain('council:')
      const code = codeOf(await callKeyOf({ tool: call.tool, input: { command: call.command } }))
      const reply = await say($, `council allow ${code}\ncouncil allow ${known}\ncouncil allow ${code} session`)
      expect(reply.context?.[0], call.command).toContain('no call refused since their previous message has that code')
      expect(lastOf(state.written).chatAllowances.map(allowance => allowance.callKey), call.command).not.toContain(await callKeyOf({ tool: call.tool, input: { command: call.command } }))
      expect(denyOf(await run($, call)), call.command).toContain(call === BLOCKED ? '(block)' : 'nobody can be asked')
    }
    expect(w.ran).toEqual([])
  })

  test('a high-confidence secret is refused whatever was allowed: it has no code', async ($, on) => {
    const w = world(on, { surfaces: [] })
    sink(on)
    const state = watchState(on)
    const call = { tool: 'Bash', command: `echo ${FAKE_GITHUB_TOKEN}` } as const
    const deny = denyOf(await run($, call))
    expect(deny).toContain('high confidence')
    expect(deny).not.toContain('council:')
    const code = codeOf(await callKeyOf({ tool: 'Bash', input: { command: call.command } }))
    const reply = await say($, `council allow ${code}`)
    expect(reply.context?.[0]).toContain('no call refused since their previous message has that code')
    expect(denyOf(await run($, call))).toContain('high confidence')
    expect(lastOf(state.written).chatOffers).toEqual([])
    expect(w.ran).toEqual([])
  })

  test('a low-confidence finding is offered, but only once', async ($, on) => {
    world(on, { surfaces: [] })
    const state = watchState(on)
    const deny = denyOf(await run($, { tool: 'Write', file_path: `${ROOT}/src/a.ts`, content: `export const t = "${FAKE_JWT}"` }))
    expect(deny).toContain('may be a secret')
    expect(lastOf(state.written).chatOffers).toMatchObject([{ canSession: false }])
    expect(deny).not.toContain('session to allow it')
  })
})

describe('where a surface draws, the person is asked as before', () => {
  test('an allowance does not skip the dialog', async ($, on) => {
    const w = world(on, { surfaces: [], answer: KEEP_BLOCKED })
    sink(on)
    const code = await refusedCode($, SUDO)
    await say($, `council allow ${code} session`)
    w.surfaces = ['terminal']
    const deny = denyOf(await run($, SUDO))
    expect(w.asked).toHaveLength(1)
    expect(deny).toContain('(keep blocked)')
    expect(w.ran).toEqual([])
    // And a denial does not refuse without asking either.
    w.surfaces = []
    const second = await refusedCode($, MULTI)
    await say($, `council deny ${second}`)
    w.surfaces = ['terminal']
    w.answer = ALLOW_ONCE
    expect(await run($, MULTI)).toEqual({ result: 'ran' })
    expect(w.asked).toHaveLength(2)
  })
})

describe('the audit and the reports', () => {
  test('the new decisions are counted with the user\'s own, and the log lists them', async ($, on) => {
    const w: World = world(on, { surfaces: [] })
    sink(on)
    const code = await refusedCode($, SUDO)
    await say($, `council allow ${code}`)
    await run($, SUDO)
    await settled(w)
    await council($, 'log')
    expect(w.logs.join('\n')).toContain('you: chat-allow')
    await council($, 'report')
    expect(w.logs.join('\n')).toContain('Stopped, then allowed by you (false-positive candidates; 1 in all):')
  })
})

describe('a stored version 4 session', () => {
  test('is migrated, not reset: its lockout still holds, and nothing is logged as malformed', async ($, on) => {
    const w = world(on, { surfaces: [] })
    const state = watchState(on)
    const { chatOffers: _offers, chatAllowances: _allowances, chatDenials: _denials, ...rest } = INITIAL_SESSION
    const v4 = { ...rest, v: 4, ops: { 'shell:rm build': { rounds: 0, wipes: 3 } } }
    state.readAs = () => v4
    expect(denyOf(await run($, { tool: 'Bash', command: 'rm -rf build' }))).toContain('locked out')
    expect(w.logs.join('\n')).not.toContain('unexpected shape')
    // A value that is not readable still is said once.
    state.readAs = () => ({ ...v4, ops: 'x' })
    await run($, { tool: 'Bash', command: 'rm -rf build' })
    expect(w.logs.join('\n')).toContain('unexpected shape')
  })
})
