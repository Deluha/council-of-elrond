/**
 * Every user-facing string, in one table: a plain variant and, from stage 6,
 * a themed one. Logic picks an entry by key; no text lives in logic.
 * Until an entry has a themed variant, both modes read the plain one.
 */

export type Mode = 'plain' | 'themed'

type Entry = { plain: string; themed?: string }

const TABLE = {
  // Who decided
  'who.rules': { plain: 'the rules' },
  'who.gandalf': { plain: 'the destructive-operations reviewer' },
  'who.legolas': { plain: 'the diff reviewer' },
  'who.aragorn': { plain: 'the git and database reviewer' },
  'who.user': { plain: 'the user' },
  'who.council': { plain: 'the council' },

  // Refusals Claude reads
  'refusal.head': { plain: 'This call was refused before it ran.' },
  'refusal.decided': { plain: 'Decided by: {who} ({verdict}).' },
  'refusal.reason': { plain: 'Reason: {reason}' },
  'refusal.alternative': { plain: 'Safer alternative: {alternative}' },
  'refusal.rounds': { plain: 'Review rounds left on this operation: {rounds}.' },
  'refusal.noRetry': { plain: 'Do not retry the same call unchanged.' },
  'refusal.instruction': { plain: 'The user answered with an instruction instead of allowing the call: "{text}". Follow it.' },

  // Reasons and alternatives the council supplies itself
  'reason.userKeptBlocked': { plain: 'The user chose to keep this call blocked.' },
  'reason.userDismissed': { plain: 'The user dismissed the question without allowing the call.' },
  'reason.userWantsChat': { plain: 'The user wants to discuss this call before anything runs.' },
  'reason.nobodyToAsk': { plain: 'The call needs the user, and nobody can be asked in this session. {why}' },
  'reason.failure': { plain: 'The council could not complete its review ({problem}), and it fails closed.' },
  'reason.internal': { plain: 'The council failed while checking this call, and it fails closed.' },
  'alternative.ask': { plain: 'Stop and ask the user how they want to proceed.' },
  'alternative.narrower': { plain: 'Ask the user first, or use a narrower command that does not match this rule.' },
  'alternative.chat': { plain: 'Stop and talk the call through with the user before doing anything else.' },

  // Escalation (the question the user answers)
  'ask.header': { plain: 'Council' },
  'ask.title': { plain: 'A gated call needs your decision.' },
  'ask.call': { plain: 'Call: {call}' },
  'ask.rule': { plain: 'Why it was gated: {reason}' },
  'ask.verdict': { plain: '{who}: {verdict}. {reason}' },
  'ask.failed': { plain: '{who}: no verdict ({problem}).' },
  'ask.close': { plain: 'Allow it once, keep it blocked, or type an instruction for Claude.' },
  'ask.allowOnce': { plain: 'Allow once' },
  'ask.keepBlocked': { plain: 'Keep blocked' },

  // Why a call went to the user
  'escalate.askTier': { plain: 'A rule sends this call straight to you.' },
  'escalate.memberOff': { plain: 'Its reviewer is switched off.' },
  'escalate.budget': { plain: "The session's review token budget is spent." },
  'escalate.failed': { plain: 'The reviewer could not give a verdict.' },

  // Notices for the user (not Claude). The engine labels toasts with the
  // plugin's name itself; that label is outside the mod's reach.
  'notice.configBroken': {
    plain: 'Council: {path} was ignored and the shipped rules are in force: {errors}',
  },
  'notice.configBrokenShort': { plain: 'Council: project rules ignored (see transcript); shipped rules in force' },
  'notice.bypass': { plain: 'Council: bypass is on; {tool} passed without review' },
  'notice.modelFailed': { plain: 'Council: {who} could not use model "{model}" ({problem}); set its model in /config' },
} as const satisfies Record<string, Entry>

export type StringKey = keyof typeof TABLE

export function text(key: StringKey, params: Readonly<Record<string, string | number>> = {}, mode: Mode = 'plain'): string {
  const entry: Entry = TABLE[key]
  const template = mode === 'themed' ? (entry.themed ?? entry.plain) : entry.plain
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    params[name] === undefined ? whole : String(params[name]),
  )
}

/** Every string in a mode, for the plain-mode test. */
export const allStrings = (mode: Mode): string[] =>
  Object.values(TABLE).map((entry: Entry) => (mode === 'themed' ? (entry.themed ?? entry.plain) : entry.plain))
