import { fingerprintOf } from '../audit.js'
import { SHELL_TOOLS } from '../rules/classify.js'
import type { Call, Classification } from '../rules/classify.js'

/**
 * The chat approval route (ROADMAP C4, DESIGN §14.4): where nothing draws, a
 * person approves or refuses a refused call by typing a line in their next
 * message. Everything here is pure; register.ts reads the origin and wires it,
 * and state.ts holds the offers, allowances and denials.
 */

export type ChatCommand = { kind: 'allow' | 'deny'; code: string; scope: 'once' | 'session' } | { kind: 'malformed' }

/** More chat lines than this in one message are removed and answered as malformed, not acted on. */
export const MAX_CHAT_LINES = 10

/** The characters of a call's key that the person types. */
export const CODE_LENGTH = 6

const CHAT_LINE = /^council\s+(?:allow|deny)\b/i

const VALID_LINE = /^council\s+(allow|deny)\s+(?:council:)?([0-9a-f]{6})(?:\s+(session))?$/i

function commandOf(line: string): ChatCommand {
  const match = VALID_LINE.exec(line)
  const kind = match?.[1]?.toLowerCase()
  const code = match?.[2]
  if (match === null || code === undefined || (kind !== 'allow' && kind !== 'deny')) return { kind: 'malformed' }
  const isSession = match[3] !== undefined
  // A refusal is never "for the session".
  if (kind === 'deny' && isSession) return { kind: 'malformed' }
  return { kind, code: code.toLowerCase(), scope: isSession ? 'session' : 'once' }
}

/**
 * The chat lines of a person's message, in order, and the message without them.
 * A chat line is a whole line that begins `council allow` or `council deny`;
 * only the three exact forms are valid, anything else on such a line is malformed.
 */
export function parseChatLines(message: string): { commands: ChatCommand[]; rest: string } {
  const commands: ChatCommand[] = []
  const kept: string[] = []
  for (const line of message.split('\n')) {
    if (!CHAT_LINE.test(line.trim())) {
      kept.push(line)
      continue
    }
    commands.push(commands.length < MAX_CHAT_LINES ? commandOf(line.trim()) : { kind: 'malformed' })
  }
  return { commands, rest: kept.join('\n').replace(/[\r\n]+$/, '') }
}

/**
 * The key of a call: its fingerprint without a shell tool's `description`,
 * which only labels the call, so a retry with new wording keeps its key. Every
 * other field stays (`dangerouslyDisableSandbox`, `timeout`, `run_in_background`).
 * A `scope` tag (C5) keeps a repository's allowance out of another one.
 */
export function callKeyOf(call: Call, scope = ''): Promise<string> {
  if (!SHELL_TOOLS.has(call.tool)) return fingerprintOf(call.tool, call.input, scope)
  const { description: _label, ...input } = call.input
  return fingerprintOf(call.tool, input, scope)
}

/** What the person types: the first characters of the key. */
export const codeOf = (callKey: string): string => callKey.slice(0, CODE_LENGTH)

/**
 * Whether a refused call may be approved in chat: never a protected path or a
 * block rule, the same opening as `suggestRule`. (A high-confidence secret is
 * refused before any of this.)
 */
export const isOfferable = (classification: Classification): boolean =>
  !classification.isProtected && classification.tier !== 'block' && !classification.findings.some(finding => finding.tier === 'block')
