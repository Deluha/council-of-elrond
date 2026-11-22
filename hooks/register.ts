import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CouncilEntry } from '../types'
import {
  denyBlocked,
  denyBroken,
  denyLockout,
  denyNobody,
  denyPerson,
  denyReviewed,
  denySecret,
  forPrompt,
  GREED,
  INITIAL,
  labelOf,
  logged,
  lootFor,
  NEED,
  PASS,
  questionOf,
  reviewOf,
  statusText,
  subjectOf,
  testText,
  TEXT,
  verdictOf,
  wiped,
} from './council.js'
import type { Verdict } from './council.js'
import { callOf, classify, customRule, matchesOf, secretIn } from './rules.js'
import type { Call, Rule } from './rules.js'

/**
 * Elrond, the chair: one `tool.call` hook. A call no rule matches passes
 * untouched. A secret or a block rule refuses. Anything else a rule matches
 * goes to that rule's member (one model call), and what the member cannot
 * settle comes to the person as a loot roll. Whatever fails, the call does
 * not run.
 */

const session = atom({ plugin: 'council-of-elrond', key: 'session' } as const, INITIAL, { shape: 'council-1' })

/** Origins that are the person's own hand: only they may loosen the gate. */
const PEOPLE: ReadonlySet<string> = new Set(['composer', 'bridge'])

const REVIEW_TIMEOUT_MS = 45_000
const COMMIT = /\bgit\s+(-\S+\s+)*commit\b/

const keyOf = async (call: Call): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subjectOf(call)))
  return [...new Uint8Array(digest).slice(0, 8)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** One model call. No verdict (an error, a timeout, a reply that is not the JSON asked for) is the same as unsure. */
const review = async ($: EngineInterface, model: string, rule: Rule, call: Call, prompt: string): Promise<Verdict | undefined> => {
  $.ui.status(TEXT.reviewing(rule.member))
  try {
    const fence = `-----${Math.random().toString(36).slice(2)}-----`
    const reply = await $.model.complete({ model, ...reviewOf(rule, call, prompt, fence), maxTokens: 200, timeoutMs: REVIEW_TIMEOUT_MS })
    await update($, session, state => ({ ...state, tokens: state.tokens + reply.usage.input_tokens + reply.usage.output_tokens }))
    return reply.isAnswered ? verdictOf(reply.text) : undefined
  } catch {
    return undefined
  } finally {
    $.ui.status(undefined)
  }
}

export const register: Register = (on, options) => {
  const model = typeof options.model === 'string' ? options.model : 'sonnet'
  const isShadow = options.shadowMode === true
  const patterns = [
    ['block', 'extra block pattern', options.blockPattern],
    ['council', 'extra council pattern', options.councilPattern],
  ] as const
  const extra = patterns.map(([tier, , source]) => customRule(tier, source)).filter(rule => rule !== undefined)
  /** Patterns that were set and did not compile: /council says so. */
  const broken = patterns.filter(([tier, , source]) => typeof source === 'string' && source.trim() !== '' && customRule(tier, source) === undefined).map(([, name]) => name)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'council', description: 'The Council of Elrond: status, meter and combat log', argumentHint: '[test <command> | allow | leeroy]' })
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const isMessage = e.command === undefined && (PEOPLE.has(e.origin.kind) || e.origin.kind === 'sdk')
    if (isMessage) await update($, session, state => forPrompt(state, e.text))
    return next(e)
  })

  on('command.run', { command: 'council' }, async ($, e) => {
    const args = e.args.trim()
    const [verb = '', ...rest] = args.split(/\s+/)
    const state = await read($, session)

    if (verb === '') return { text: statusText(state, model, isShadow, broken) }

    if (verb === 'test') {
      const subject = rest.join(' ')
      const call: Call = { tool: 'Bash', command: subject, path: subject }
      return { text: testText(subject, classify(call, extra), secretIn(call)) }
    }

    if (verb !== 'allow' && verb !== 'leeroy') return { text: TEXT.unknown(args) }
    if (!PEOPLE.has(e.origin.kind)) return { text: TEXT.notYou }

    if (verb === 'allow') {
      const { refused } = state
      if (refused === undefined) return { text: TEXT.nothingRefused }
      await update($, session, now => ({ ...now, once: [...now.once, refused.key], wipes: { ...now.wipes, [refused.key]: 0 } }))
      return { text: TEXT.allowed(refused.label) }
    }

    await update($, session, now => ({ ...now, isLeeroy: !state.isLeeroy }))
    $.ui.status(state.isLeeroy ? undefined : TEXT.leeroyStatus)
    return { text: state.isLeeroy ? TEXT.leeroyOff : TEXT.leeroyOn }
  })

  on('tool.call', async ($, e, next) => {
    const call = callOf(e as unknown as Record<string, unknown>)
    const secret = secretIn(call)
    const matches = matchesOf(call, extra)
    const label = labelOf(call)

    const run = async () => {
      const ran = await next(e)
      const isLanded = ran.deny === undefined && ran.isError !== true
      const item = isLanded && call.command !== undefined && COMMIT.test(call.command) ? lootFor(Math.random()) : undefined
      if (item !== undefined) $.ui.toast(TEXT.loot(item), { timeoutMs: 8_000 })
      return ran
    }
    const note = (who: string, outcome: CouncilEntry['outcome'], reason = '') => update($, session, state => logged(state, { who, outcome, label, reason }))

    if (secret !== undefined) {
      // The label would repeat the secret, so the log keeps only the tool.
      await update($, session, state => logged(state, { who: 'gollum', outcome: 'blocked', label: `${call.tool} (redacted)`, reason: secret }))
      return { deny: denySecret(secret) }
    }
    const [first] = matches
    if (first === undefined) return run()
    if (first.tier === 'block') {
      await note(first.member, 'blocked', first.why)
      return { deny: denyBlocked(first) }
    }

    const state = await read($, session)
    const key = await keyOf(call)
    // Greed covers a call only when it covers every rule the call matches; else the first uncovered rule's member reviews.
    const rule = matches.find(one => !state.greed.includes(one.id))
    if (rule === undefined) {
      await note(first.member, 'allowed', GREED)
      return run()
    }
    const refuse = async (reason: string, deny: string) => {
      await update($, session, now => wiped(logged(now, { who: rule.member, outcome: 'refused', label, reason }), key, label))
      return { deny }
    }
    if (state.isLeeroy) {
      await note(rule.member, 'leeroy')
      return run()
    }
    // A grant from /council allow is spent in the same write that finds it, so two calls cannot share one.
    let isGranted = false
    await update($, session, now => {
      isGranted = now.once.includes(key)
      return isGranted ? logged({ ...now, once: now.once.filter(one => one !== key) }, { who: rule.member, outcome: 'allowed', label, reason: '/council allow' }) : now
    })
    if (isGranted) return run()

    // The retry brake: first the member, then the person, then nobody until the person writes again.
    const wipes = state.wipes[key] ?? 0
    if (wipes >= 2) return { deny: denyLockout(rule) }

    let reason = ''
    if (wipes === 0) {
      const verdict = await review($, model, rule, call, state.prompt)
      reason = verdict?.reason ?? ''
      if (verdict?.verdict === 'approve') {
        await note(rule.member, 'approved', reason)
        return run()
      }
      if (isShadow) {
        await note(rule.member, 'shadow', reason)
        $.ui.toast(TEXT.shadow(rule.member, label))
        return run()
      }
      if (verdict?.verdict === 'block') return refuse(reason, denyReviewed(rule, reason))
    }

    const answer = await $.ui.ask(questionOf(rule, call, reason), { options: [NEED, GREED, PASS], header: TEXT.rollHeader }).catch(() => undefined)
    if (answer === NEED || answer === GREED) {
      await update($, session, now => logged({ ...now, greed: answer === GREED ? [...now.greed, rule.id] : now.greed }, { who: rule.member, outcome: 'allowed', label, reason: answer }))
      return run()
    }
    return refuse(answer ?? 'nobody to ask', answer === undefined ? denyNobody(rule) : denyPerson(rule, answer))
  }).catch(($, e, next) => (next.called ? next(e) : { deny: denyBroken }))
}
