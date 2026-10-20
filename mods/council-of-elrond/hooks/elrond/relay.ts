import { OVERRIDES_PATH } from '../config/defaults.js'
import { untrusted } from '../members/shared.js'
import { redact } from '../redact.js'
import type { SecretPattern } from '../redact.js'
import { text } from '../strings.js'
import type { CouncilCommand, Output } from './commands.js'
import type { MemberOpinion } from './escalation.js'

/**
 * Where nothing draws (`$.session.surfaces()` empty), the model is the only
 * channel to the person (ROADMAP C2, DESIGN §13.5): a few `/council` outputs,
 * the start notice and the nobody-to-ask refusal reach them through Claude.
 * Everything here is pure; register.ts reads the surfaces and the origin.
 * Text Claude reads has no themed variant, so every string is asked for plain.
 */

export type RelayedCommand = Extract<CouncilCommand, { kind: 'status' | 'report' | 'rules' | 'test' }>

/** Only these four: they answer a question about the council, and each is redacted line by line. */
export const isRelayed = (command: CouncilCommand): command is RelayedCommand =>
  command.kind === 'status' || command.kind === 'report' || command.kind === 'rules' || command.kind === 'test'

/**
 * The one context entry for a command's output: an instruction to relay it, then
 * the output as untrusted data. Every line, the title too (`/council test` echoes
 * the typed command), is redacted, and the fence is closed by a nonce.
 */
export function relayContext(command: RelayedCommand, output: Output, patterns: readonly SecretPattern[], nonce: string): string {
  const body = [output.title, ...output.lines].map(line => redact(line, patterns)).join('\n')
  const head = text('relay.head', { sub: text('relay.sub', { kind: command.kind }, 'plain'), nonce }, 'plain')
  return `${head}\n${untrusted('council-output', body, nonce)}`
}

/** How a person can let a refused call run, for a session that cannot ask. */
export const routeText = (): string => text('relay.route', { path: OVERRIDES_PATH }, 'plain')

/** The session-start notice appended as a row the model reads. */
export const noticeText = (): string => text('notice.noSurface', { chatRoute: text('relay.chatRoute', {}, 'plain'), route: routeText() }, 'plain')

/** The nobody-to-ask refusal: what was refused, what is behind it (names only) and the way forward. */
export type NobodyToAsk = {
  /** Why the call came to the user, a plain string. */
  why: string
  /** The operation key, redacted and capped. */
  operation: string
  ruleId?: string
  opinions: readonly MemberOpinion[]
  /** The call's chat code (six hex characters), when it may be approved in chat (ROADMAP C4). */
  code?: string
  /** Whether `council allow <code> session` is accepted for it. */
  canSession?: boolean
}

/**
 * The reviewers' names only, never their reasons or problems, and the rule id;
 * never the call, its preview, a secrets finding or a diff. With a code, the
 * way forward is the chat route: the code and the lines the person types.
 */
export function nobodyToAsk(input: NobodyToAsk): { reason: string; alternative: string } {
  const names = [...new Set(input.opinions.map(opinion => text(opinion.who, {}, 'plain')))]
  const pieces = [
    ...(input.ruleId !== undefined ? [text('relay.behindRule', { id: input.ruleId }, 'plain')] : []),
    ...(names.length > 0 ? [text('relay.behindReviewers', { names: names.join(text('relay.join', {}, 'plain')) }, 'plain')] : []),
  ]
  const behind = pieces.length > 0 ? pieces.join(text('relay.join', {}, 'plain')) : text('who.council', {}, 'plain')
  return {
    reason: text('reason.nobodyToAsk', { why: input.why, operation: input.operation, behind }, 'plain'),
    alternative:
      input.code === undefined
        ? text('alternative.noSurface', { route: routeText() }, 'plain')
        : text(
            'alternative.noSurfaceChat',
            { code: input.code, session: input.canSession === true ? text('relay.chatSession', { code: input.code }, 'plain') : '', route: routeText() },
            'plain',
          ),
  }
}
