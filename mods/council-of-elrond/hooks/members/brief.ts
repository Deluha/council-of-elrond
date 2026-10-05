import type { MemberName, Profile } from '../config/types.js'
import type { StringKey } from '../strings.js'
import { aragornDatabasePrompt, aragornDatabaseSystem, aragornGitPrompt, aragornGitSystem } from './aragorn.js'
import type { AragornDatabaseContext, AragornGitContext } from './aragorn.js'
import { gandalfPrompt, gandalfSystem } from './gandalf.js'
import type { GandalfContext } from './gandalf.js'
import { legolasPrompt, legolasSystem } from './legolas.js'
import type { LegolasContext } from './legolas.js'

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

/** Who a member (and profile) is, in refusals, questions and notices. */
export function whoOf(member: MemberName, profile?: Profile): StringKey {
  if (member === 'aragorn') return profile === 'git' ? 'who.aragorn.git' : profile === 'database' ? 'who.aragorn.database' : 'who.aragorn'
  return member === 'legolas' ? 'who.legolas' : 'who.gandalf'
}
