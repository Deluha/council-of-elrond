import type { CompiledConfig, CompiledRule } from '../config/schema.js'
import { strictness } from '../config/types.js'
import type { MemberName, Profile, RuleSource, Tier } from '../config/types.js'
import { runCheck } from './checks.js'
import type { CheckContext } from './checks.js'
import { relativeTo, resolve } from './paths.js'
import { splitShell } from './shell.js'
import type { ShellPart } from './shell.js'

/** Tools whose `command` is a shell command line. */
export const SHELL_TOOLS: ReadonlySet<string> = new Set(['Bash', 'Monitor'])

/** File tools and the input field holding their path. */
export const FILE_PATH_FIELDS: Readonly<Record<string, string>> = {
  Write: 'file_path',
  Edit: 'file_path',
  NotebookEdit: 'notebook_path',
}

export type Call = {
  tool: string
  /** The tool's arguments, without the envelope (`tool`, `tool_use_id`, `agentId`). */
  input: Readonly<Record<string, unknown>>
}

export type ClassifyContext = Omit<CheckContext, 'protectedBranches' | 'production'> & {
  /** Where a file tool's path really lands (symbolic links resolved), when known. */
  realPath?: string
}

export type Finding = {
  tier: Tier
  /** The rule's id, or `protected-path`. */
  ruleId: string
  source: RuleSource | 'protected'
  reason: string
  member?: MemberName
  profile?: Profile
  /** The part of the call it is about: one shell command, or the file path. */
  subject: string
}

export type Classification = {
  tier: Tier
  /** The finding that set the tier; absent when nothing matched (allow). */
  decided?: Finding
  /** Every subject's deciding finding above allow. */
  findings: readonly Finding[]
  /** A protected path is involved: never offer an allow rule for this call. */
  isProtected: boolean
  /** Files a script-running part names, for reviewer context. */
  scriptPaths: readonly string[]
}

type Subject = {
  label: string
  part?: ShellPart
  /** Relative to the root when inside it, else absolute. */
  path?: string
  /** Candidate paths to test against the protected globs. */
  candidates: readonly string[]
}

const toFinding = (rule: CompiledRule, subject: string): Finding => ({
  tier: rule.tier,
  ruleId: rule.id,
  source: rule.source,
  reason: rule.reason,
  ...(rule.member !== undefined && { member: rule.member }),
  ...(rule.profile !== undefined && { profile: rule.profile }),
  subject,
})

const strictest = (findings: readonly Finding[]): Finding | undefined =>
  findings.reduce<Finding | undefined>(
    (best, finding) => (best === undefined || strictness(finding.tier) > strictness(best.tier) ? finding : best),
    undefined,
  )

function ruleMatches(
  rule: CompiledRule,
  call: Call,
  subject: Subject,
  inputJson: string,
  context: CheckContext,
): boolean {
  if (!rule.matchesTool(call.tool)) return false
  if (rule.commandRe !== undefined && (subject.part === undefined || !rule.commandRe.test(subject.part.core))) return false
  if (rule.check !== undefined && (subject.part === undefined || !runCheck(rule.check, subject.part, context))) return false
  if (rule.pathRe !== undefined && (subject.path === undefined || !rule.pathRe.test(subject.path))) return false
  if (rule.inputRe !== undefined && !rule.inputRe.test(inputJson)) return false
  return true
}

/** The words of a shell part that could name a file. */
function pathWordsOf(part: ShellPart): string[] {
  const out: string[] = []
  for (const word of [...part.coreWords.slice(1), ...part.redirects.map(r => r.target)]) {
    if (word === '' || word.includes('$(')) continue
    const value = word.startsWith('-') ? (word.includes('=') ? word.slice(word.indexOf('=') + 1) : '') : word
    if (value !== '') out.push(value)
  }
  if (part.coreWords[0] !== undefined && part.coreWords[0].includes('/')) out.push(part.coreWords[0])
  return out
}

function isProtectedPath(candidate: string, config: CompiledConfig, context: ClassifyContext, cwd: string): boolean {
  const absolute = resolve(candidate.replace(/^['"]|['"]$/g, ''), cwd, context.home)
  const relative = relativeTo(absolute, context.root)
  const forms = relative !== undefined ? [relative] : [absolute.slice(1)]
  return config.protectedPaths.some(({ re }) => forms.some(form => re.test(form)))
}

function subjectsOf(call: Call, context: ClassifyContext): { subjects: Subject[]; tooLong: boolean; cut: boolean } {
  if (SHELL_TOOLS.has(call.tool)) {
    const command = typeof call.input.command === 'string' ? call.input.command : ''
    const split = splitShell(command)
    return {
      subjects: split.parts.map(part => ({ label: part.text, part, candidates: pathWordsOf(part) })),
      tooLong: split.isTooLong,
      cut: split.isCut,
    }
  }
  const field = FILE_PATH_FIELDS[call.tool]
  const given = field !== undefined ? call.input[field] : undefined
  if (typeof given === 'string') {
    const absolute = resolve(given, context.cwd, context.home)
    const path = relativeTo(absolute, context.root) ?? absolute
    const candidates = context.realPath !== undefined ? [given, context.realPath] : [given]
    return { subjects: [{ label: path, path, candidates }], tooLong: false, cut: false }
  }
  return { subjects: [{ label: call.tool, candidates: [] }], tooLong: false, cut: false }
}

const SCRIPT_RULES = /^script-/

/**
 * The tier of a call, by the rules alone: pure, no I/O.
 *
 * Per subject (each shell part, or the file path): a project rule that
 * matches decides first, else the strictest shipped rule that matches;
 * shipped block rules and protected paths are a floor no project rule
 * lowers. The call takes its strictest subject. Nothing matching is allow.
 */
export function classify(call: Call, config: CompiledConfig, context: ClassifyContext): Classification {
  const checkContext: CheckContext = {
    ...context,
    protectedBranches: config.protectedBranches,
    production: config.production,
  }
  const inputJson = JSON.stringify(call.input)
  const { subjects, tooLong, cut } = subjectsOf(call, context)
  const findings: Finding[] = []
  const scriptPaths: string[] = []
  let isProtected = false

  if (tooLong || cut) {
    findings.push({
      tier: 'review',
      ruleId: tooLong ? 'command-too-long' : 'command-too-complex',
      source: 'shipped',
      reason: tooLong ? 'The command is too long to classify.' : 'The command is too complex to classify fully.',
      subject: call.tool,
    })
  }

  // `cd` earlier in a compound command moves where later parts' paths land.
  // A target the parser cannot know (a variable, `-`) lands anywhere: `/`.
  let cwd = context.cwd
  for (const subject of subjects) {
    const part = subject.part
    if (part !== undefined && !part.isNested && (part.coreWords[0] === 'cd' || part.coreWords[0] === 'pushd')) {
      const target = part.coreWords.find((word, index) => index > 0 && !word.startsWith('-')) ?? context.home ?? '/'
      cwd = /[$`]|^-$/.test(target) ? '/' : resolve(target, cwd, context.home)
    }
    const partContext = { ...checkContext, cwd }
    const matches = config.rules.filter(rule => ruleMatches(rule, call, subject, inputJson, partContext))
    const project = matches.find(rule => rule.source === 'project')
    const shipped = matches.filter(rule => rule.source === 'shipped')
    const floor: Finding[] = shipped.filter(rule => rule.tier === 'block').map(rule => toFinding(rule, subject.label))

    const protectedHit = subject.candidates.some(candidate => isProtectedPath(candidate, config, context, cwd))
    if (protectedHit) {
      isProtected = true
      floor.push({
        tier: 'ask',
        ruleId: 'protected-path',
        source: 'protected',
        reason: 'Touches a protected path.',
        subject: subject.label,
      })
    }

    const decision =
      project !== undefined
        ? toFinding(project, subject.label)
        : strictest(shipped.map(rule => toFinding(rule, subject.label)))
    const deciding = strictest([...(decision !== undefined ? [decision] : []), ...floor])
    if (deciding === undefined || deciding.tier === 'allow') continue
    findings.push(deciding)
    if (SCRIPT_RULES.test(deciding.ruleId) && subject.part !== undefined) {
      scriptPaths.push(...pathWordsOf(subject.part).filter(word => /[./]/.test(word)))
    }
  }

  const decided = strictest(findings)
  return {
    tier: decided?.tier ?? 'allow',
    ...(decided !== undefined && { decided }),
    findings,
    isProtected,
    scriptPaths: [...new Set(scriptPaths)],
  }
}
