import type { MemberName, Profile } from '../config/types.js'
import type { StringKey } from '../strings.js'
import { ARAGORN_LIMITS, aragornDatabasePrompt, aragornDatabaseSystem, aragornGitPrompt, aragornGitSystem } from './aragorn.js'
import type { AragornDatabaseContext, AragornGitContext } from './aragorn.js'
import { GANDALF_LIMITS, gandalfPrompt, gandalfSystem } from './gandalf.js'
import type { GandalfContext } from './gandalf.js'
import { LEGOLAS_LIMITS, legolasPrompt, legolasSystem } from './legolas.js'
import type { LegolasContext } from './legolas.js'
import { cut } from './shared.js'
import { SHELL_TOOLS } from '../rules/classify.js'

/**
 * A brief: one member (and profile) with the context it reviews. Members
 * supply only `system(nonce)` and `prompt(context, nonce)`; the request,
 * its deadline and the verdict's parsing are the same for all of them.
 */
export type Brief =
  | { member: 'gandalf'; profile?: undefined; context: GandalfContext }
  | { member: 'legolas'; profile?: undefined; context: LegolasContext }
  | { member: 'aragorn'; profile: 'git'; context: AragornGitContext }
  | { member: 'aragorn'; profile: 'database'; context: AragornDatabaseContext }

export function requestOf(brief: Brief, nonce: string): { system: string; prompt: string } {
  switch (brief.member) {
    case 'gandalf':
      return { system: gandalfSystem(nonce), prompt: gandalfPrompt(brief.context, nonce) }
    case 'legolas':
      return { system: legolasSystem(nonce), prompt: legolasPrompt(brief.context, nonce) }
    case 'aragorn':
      return brief.profile === 'git'
        ? { system: aragornGitSystem(nonce), prompt: aragornGitPrompt(brief.context, nonce) }
        : { system: aragornDatabaseSystem(nonce), prompt: aragornDatabasePrompt(brief.context, nonce) }
  }
}

const isOver = (text: string, lines: number, chars: number): boolean => cut(text, lines, chars).omitted !== undefined

/**
 * Whether the command text of a shell call was cut before the reviewer saw it.
 * A file's content or a diff that is cut is not this: its reviewer is told, and
 * judges what it sees. A command that is cut hides code that will run, so no
 * model's approve stands for it (the caller sends it to the person).
 */
export function isCommandCut(brief: Brief): boolean {
  if (brief.member === 'legolas') {
    const range = brief.context.range
    return range !== undefined && isOver(range.call, LEGOLAS_LIMITS.rangeCallLines, LEGOLAS_LIMITS.rangeCallChars)
  }
  if (!SHELL_TOOLS.has(brief.context.tool)) return false
  if (brief.member === 'gandalf') return isOver(brief.context.call, GANDALF_LIMITS.callLines, GANDALF_LIMITS.callChars)
  if (brief.profile === 'database' && brief.context.diff !== undefined) return false
  return isOver(brief.context.call, ARAGORN_LIMITS.callLines, ARAGORN_LIMITS.callChars)
}

/** Who a member (and profile) is, in refusals, questions and notices. */
export function whoOf(member: MemberName, profile?: Profile): StringKey {
  if (member === 'aragorn') return profile === 'git' ? 'who.aragorn.git' : profile === 'database' ? 'who.aragorn.database' : 'who.aragorn'
  return member === 'legolas' ? 'who.legolas' : 'who.gandalf'
}
