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
  'who.aragorn.git': { plain: 'the git reviewer' },
  'who.aragorn.database': { plain: 'the database reviewer' },
  'who.user': { plain: 'the user' },
  'who.council': { plain: 'the council' },
  'who.gollum': { plain: 'the secrets scan' },
  'who.galadriel': { plain: 'the read-only preview' },
  'who.gimli': { plain: 'the project checks' },
  'who.fullCouncil': { plain: 'the full council' },

  // The full council's combined verdict, each voice labelled
  'council.voice': { plain: '{who} ({verdict}): {reason}' },
  'council.noVerdict': { plain: '{who} (block): no verdict ({problem})' },
  'council.deadline': { plain: "the full council's deadline passed before it was asked" },
  'council.stopped': { plain: 'not asked: an earlier member had already blocked' },
  'council.noRange': { plain: 'not asked: the changes could not be read' },
  'gimli.passed': { plain: '"{name}" passed.' },
  'gimli.failed': { plain: '"{name}" failed with exit code {code}.' },
  'gimli.killed': { plain: '"{name}" was ended by {signal}.' },
  'gimli.timedOut': { plain: '"{name}" did not finish within {seconds} s and was ended.' },
  'gimli.error': { plain: '"{name}" could not be started.' },
  'gimli.stopped': { plain: '"{name}" was stopped: the council had already blocked.' },
  'gimli.tail': { plain: 'Its last lines:\n{tail}' },

  // Refusals Claude reads
  'refusal.head': { plain: 'This call was refused before it ran.' },
  'refusal.decided': { plain: 'Decided by: {who} ({verdict}).' },
  'refusal.reason': { plain: 'Reason: {reason}' },
  'refusal.alternative': { plain: 'Safer alternative: {alternative}' },
  'refusal.rounds': { plain: 'Review rounds left on this operation: {rounds}.' },
  'refusal.noRetry': { plain: 'Do not retry the same call unchanged.' },
  'refusal.lockout': { plain: 'This operation is locked out: it failed {count} times since the user last wrote.' },
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
  'reason.secretHigh': { plain: 'The call contains a {label} (high confidence): {snippet}' },
  'reason.lockoutKey': { plain: 'The same operation was refused or failed {count} times since the user last wrote.' },
  'reason.lockoutVerb': { plain: 'Operations of this kind ({verb}) were refused or failed {count} times since the user last wrote.' },
  'alternative.removeSecret': {
    plain: 'Remove the secret from the call: read it from an environment variable or a secrets manager instead of writing it out.',
  },
  'alternative.lockout': {
    plain: 'Stop retrying this. Tell the user what failed and why, and propose a different approach for them to approve.',
  },
  'alternative.gimli': { plain: 'Make the failing project checks ({names}) pass, then try again.' },
  'alternative.chat': { plain: 'Stop and talk the call through with the user before doing anything else.' },

  // Escalation (the question the user answers)
  'ask.header': { plain: 'Council' },
  'ask.title': { plain: 'A gated call needs your decision.' },
  'ask.call': { plain: 'Call: {call}' },
  'ask.rule': { plain: 'Why it was gated: {reason}' },
  'ask.verdict': { plain: '{who}: {verdict}. {reason}' },
  'ask.failed': { plain: '{who}: no verdict ({problem}).' },
  'ask.preview': { plain: 'What it would touch:\n{preview}' },
  'ask.secret': { plain: 'Possible {label}: {snippet}' },
  'ask.close': { plain: 'Allow it once, keep it blocked, or type an instruction for Claude.' },
  'ask.closeSecret': { plain: 'Allow it once, add the secret to the allowlist, keep it blocked, or type an instruction for Claude.' },
  'ask.allowOnce': { plain: 'Allow once' },
  'ask.keepBlocked': { plain: 'Keep blocked' },
  'ask.allowlist': { plain: 'Add to allowlist' },
  'ask.confirmAllowlist': {
    plain: 'The allowlist entry for this {label} is {entry}. It is written to {path} under {field}, and the scan then allows that secret in every later call in this project. Add it and allow this call?',
  },
  'ask.confirmAdd': { plain: 'Add it' },
  'ask.confirmCancel': { plain: 'Cancel' },

  // Why a call went to the user
  'escalate.askTier': { plain: 'A rule sends this call straight to you.' },
  'escalate.memberOff': { plain: 'Its reviewer is switched off.' },
  'escalate.budget': { plain: "The session's review token budget is spent." },
  'escalate.failed': { plain: 'The reviewer could not give a verdict.' },
  'escalate.councilFailed': { plain: 'A big operation went to the full council, and members of it could not give a verdict.' },
  'escalate.rounds': { plain: 'The reviewer refused this operation twice since you last wrote; it comes to you before any further review.' },
  'escalate.secretLow': { plain: 'The secrets scan found something that may be a secret.' },

  // Notices for the user (not Claude). The engine labels toasts with the
  // plugin's name itself; that label is outside the mod's reach.
  'notice.configBroken': {
    plain: 'Council: {path} was ignored and the shipped rules are in force: {errors}',
  },
  'notice.configBrokenShort': { plain: 'Council: project rules ignored (see transcript); shipped rules in force' },
  'notice.bypass': { plain: 'Council: bypass is on; {tool} passed without review' },
  'notice.modelFailed': { plain: 'Council: {who} could not use model "{model}" ({problem}); set its model in /config' },
  'notice.allowedOnce': { plain: 'Council: you allowed this once' },
  'notice.allowlistWritten': { plain: 'Council: added {entry} to the allowlist in {path}' },
  'notice.allowlistFailed': { plain: 'Council: the allowlist entry was not written ({problem}); the call stays blocked' },
  'notice.shadowVerdict': { plain: 'Council (shadow): {who} said {verdict} on {tool}; it ran anyway' },
  'notice.shadowSuggest': {
    plain: 'Council: new here? Try /council shadow on for the first days. Reviewers then log verdicts without refusing; rules, protected paths and the secrets scan still enforce.',
  },
  'notice.commandFailed': { plain: 'Council: /council could not be registered ({problem})' },

  // Mode labels by the prompt
  'mode.bypass': { plain: 'council: bypass' },
  'mode.shadow': { plain: 'council: shadow' },

  // /council output (shown to the user, never to Claude)
  'cmd.title': { plain: 'Council' },
  'cmd.help': {
    plain: 'Usage: /council [on | off | shadow on|off | log [n] | rules | test "<command>" | model [<member> <model> [--save]] | reload]',
  },
  'cmd.unknown': { plain: 'Unknown subcommand "{sub}".' },
  'cmd.mode': { plain: 'Mode: {mode}' },
  'cmd.mode.enforcing': { plain: 'enforcing' },
  'cmd.mode.shadow': { plain: 'shadow (reviewers log verdicts and never refuse)' },
  'cmd.mode.bypass': { plain: 'bypass (gated calls pass without review)' },
  'cmd.members': { plain: 'Members:' },
  'cmd.member': { plain: '  {who} [{id}]: {state}, model {model} ({source}); approved {approved}, revised {revised}, blocked {blocked}, no verdict {failed}' },
  'cmd.memberCode': { plain: '  {who}: {state}' },
  'cmd.council': {
    plain: '  {who} [council], for big operations: {state}, model {model} ({source}), {order}; approved {approved}, revised {revised}, blocked {blocked}',
  },
  'cmd.council.parallel': { plain: 'members in parallel' },
  'cmd.council.sequential': { plain: 'members one at a time, stopping at the first block' },
  'cmd.gimli': { plain: '  {who}, for big operations: {state}, {count} commands configured; passed {approved}, failed {blocked}' },
  'cmd.on': { plain: 'on' },
  'cmd.off': { plain: 'off' },
  'cmd.attempts': { plain: 'Since your last prompt: {count} refused or failed attempts over {ops} operations, {locked} locked out' },
  'cmd.tokens': { plain: 'Review tokens this session: {spent} of {budget}' },
  'cmd.median': { plain: 'Median review time: {time} over {reviews} reviews' },
  'cmd.noReviews': { plain: 'No model reviews yet this session' },
  'cmd.bypassOn': { plain: 'Bypass is on for this session: gated calls pass without review, and are logged. /council on ends it.' },
  'cmd.bypassOff': { plain: 'The council is on: gated calls are reviewed again.' },
  'cmd.shadowOn': { plain: 'Shadow mode is on for this session: reviewers log verdicts and never refuse. Rules, protected paths and the secrets scan still enforce.' },
  'cmd.shadowOff': { plain: 'Shadow mode is off for this session: reviewer verdicts enforce.' },
  'cmd.shadowUsage': { plain: 'Usage: /council shadow on | off' },
  'cmd.logTitle': { plain: 'Last {n} gated calls (newest last)' },
  'cmd.logLine': { plain: '{ts}  {tool}  {tier}  {who}: {verdict}{decision}  → {outcome}  {reason}' },
  'cmd.logEmpty': { plain: 'No gated calls are logged yet.' },
  'cmd.logUnreadable': { plain: 'The audit log could not be read ({problem}).' },
  'cmd.rulesTitle': { plain: 'Effective rules ({origin}), strictest first' },
  'cmd.ruleLine': { plain: '  {tier}  {id}  [{source}]  {reason}' },
  'cmd.listLine': { plain: '{name}: {items}' },
  'cmd.list.protectedPaths': { plain: 'Protected paths' },
  'cmd.list.protectedBranches': { plain: 'Protected branches' },
  'cmd.list.production': { plain: 'Production-looking patterns' },
  'cmd.list.secretPatterns': { plain: 'Extra secret patterns' },
  'cmd.list.allowlist': { plain: 'Secret allowlist entries' },
  'cmd.configErrors': { plain: 'The project rules file was ignored: {errors}' },
  'cmd.testTitle': { plain: 'Test of {command} (nothing runs)' },
  'cmd.testUsage': { plain: 'Usage: /council test "<command>". The command is classified only; nothing runs.' },
  'cmd.testTier': { plain: 'Tier: {tier}' },
  'cmd.testAllow': { plain: 'No rule matches above allow: it would pass untouched.' },
  'cmd.testFinding': { plain: '  {subject}: {tier} by {rule} [{source}]: {reason}' },
  'cmd.testReviewer': { plain: 'Reviewer: {who} [{id}{profile}], model {model} ({source})' },
  'cmd.testNoReviewer': { plain: 'Reviewer: none is switched on (the rule names {wanted}, and the fallback reviewer is off); it would come to you.' },
  'cmd.testFallback': { plain: '  The rule names {wanted}, but {why}.' },
  'route.disabled': { plain: 'it is switched off, so the fallback reviewer takes it' },
  'route.mixed': { plain: 'the parts of the command name different reviewers, so the fallback reviewer takes all of it' },
  'route.no-diff': { plain: 'there is no file to diff, so the fallback reviewer takes it' },
  'cmd.testCouncil': { plain: 'Reviewer: {who} (a big operation: {entry}), model {model} ({source}). Seats: {seats}.' },
  'cmd.seat': { plain: '{who} [{id}]' },
  'cmd.seatRange': { plain: '{who} [{id}], on what the {kind} would change' },
  'cmd.testCouncilNobody': { plain: 'Reviewer: none: it is a big operation ({entry}), but no member of {who} is switched on; it would come to you.' },
  'cmd.testCouncilOff': { plain: '  It is a big operation ({entry}), but {who} is switched off in /config, so one reviewer takes it.' },
  'cmd.testCouncilChecks': { plain: '  {who} would run alongside: {names}.' },
  'cmd.testCouncilNoChecks': { plain: '  No project checks are configured in the rules file.' },
  'cmd.testCouncilBranch': { plain: '  A merge goes to {who} when the current branch is protected; /council test runs nothing, so it assumed so.' },
  'cmd.testOperation': { plain: 'Operation key: {key}' },
  'cmd.modelTitle': { plain: 'Models (session switch, then /config, then the project file, then built-in)' },
  'cmd.modelLine': { plain: '  {id}: {model} ({source})' },
  'cmd.modelUsage': { plain: 'Usage: /council model <member> <model> [--save]; members: {slots}; "default" clears the session switch.' },
  'cmd.modelBadSlot': { plain: 'Unknown member "{slot}"; one of {slots}.' },
  'cmd.modelBadId': { plain: '"{model}" is not a model alias or id.' },
  'cmd.modelSet': { plain: '{id} uses {model} for this session.' },
  'cmd.modelCleared': { plain: '{id} no longer has a session switch; it uses {model} ({source}).' },
  'cmd.modelProbeFailed': { plain: '{model} did not answer a test request ({problem}); {id} keeps {previous}.' },
  'cmd.modelProbeUnsure': { plain: '{model} could not be checked ({problem}); switched anyway, and a failing review comes to you.' },
  'cmd.modelSaved': { plain: 'Saved to /config.' },
  'cmd.modelNotSaved': { plain: 'Not saved ({problem}); the switch holds for this session only.' },
  'cmd.modelNoRow': { plain: '{id} has no /config row yet' },
  'cmd.modelNotOption': { plain: '/config offers only {options} for it' },
  'cmd.reloaded': { plain: 'Rules reloaded: {count} rules ({origin}).' },
  'cmd.reportLater': { plain: '/council report arrives in a later version.' },
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
