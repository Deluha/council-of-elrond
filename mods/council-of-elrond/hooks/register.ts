import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, ToolCallResult } from 'claude-code'

import { appendPlan, AUDIT_GITIGNORE, auditLine, fingerprintOf, ROTATED_FILES } from './audit.js'
import type { AuditRecord, Decision } from './audit.js'
import { OVERRIDES_PATH } from './config/defaults.js'
import { loadConfig } from './config/schema.js'
import type { LoadedConfig } from './config/schema.js'
import { interpretAnswer, interpretRejection, optionsOf, questionText } from './elrond/escalation.js'
import type { Answer, MemberOpinion, Unanswered } from './elrond/escalation.js'
import { deadlineFor, profileOf, resolveModel } from './elrond/models.js'
import { refusalText } from './elrond/refusal.js'
import type { Refusal } from './elrond/refusal.js'
import { GANDALF_LIMITS, gandalfPrompt, gandalfSystem } from './members/gandalf.js'
import type { GandalfContext } from './members/gandalf.js'
import { newNonce, parseVerdict, truncate } from './members/shared.js'
import type { Verdict } from './members/shared.js'
import { redact } from './redact.js'
import { classify, FILE_PATH_FIELDS, SHELL_TOOLS } from './rules/classify.js'
import type { Call, Classification } from './rules/classify.js'
import { isInside, resolve } from './rules/paths.js'
import { addTokens, count, INITIAL_SESSION, noteWritten, resetForPrompt, sessionOf } from './state.js'
import { text } from './strings.js'
import type { StringKey } from './strings.js'

/**
 * Elrond, the chair: the one `tool.call` hook every call passes through.
 * Rules classify it; allow passes untouched; block refuses; ask goes to the
 * user; review goes to a model member. Every failure refuses or asks: the
 * hook never lets a gated call through on an error.
 *
 * The only file that touches `$`. Everything it decides with is a pure
 * function in a sibling file.
 */

const session = atom({ plugin: 'council-of-elrond', key: 'session' } as const, INITIAL_SESSION)

/** Margin kept on the hook's own 10 s budget before any pass-through. */
const BUDGET_GUARD_MS = 1_000

/** Prompt origins that are the user's own and reset the per-prompt state. */
const HUMAN_ORIGINS: ReadonlySet<string> = new Set(['composer', 'bridge', 'sdk'])

const MAX_SCRIPTS = 3

type Settings = {
  gandalfEnabled: boolean
  gandalfModel: string
  reviewDeadlineSeconds: number
  tokenBudget: number
  auditLogPath: string
  auditMaxKb: number
}

const settingsOf = (options: PluginOptions): Settings => ({
  gandalfEnabled: options.gandalfEnabled !== false,
  gandalfModel: typeof options.gandalfModel === 'string' ? options.gandalfModel : 'default',
  reviewDeadlineSeconds: typeof options.reviewDeadlineSeconds === 'number' ? options.reviewDeadlineSeconds : 0,
  tokenBudget: typeof options.tokenBudget === 'number' ? options.tokenBudget : 1_500_000,
  auditLogPath:
    typeof options.auditLogPath === 'string' && options.auditLogPath !== ''
      ? options.auditLogPath
      : '.claude/council-of-elrond/audit/audit.jsonl',
  auditMaxKb: typeof options.auditMaxKb === 'number' ? options.auditMaxKb : 1024,
})

type Context = {
  loaded: LoadedConfig
  root: string
  /** The root with symbolic links resolved, to map resolved paths back under `root`. */
  realRoot: string
  home?: string
}

type Review =
  | { ok: true; verdict: Verdict; model: string; tokens: number }
  | { ok: false; problem: string; model: string; tokens: number }

// Module state: starts over on every load, as the module does.
let settings: Settings = settingsOf({})
let context: Promise<Context> | undefined
let auditQueue: Promise<void> = Promise.resolve()
let isGitignoreChecked = false
const warned = new Set<string>()

function warnOnce($: EngineInterface, key: string, line: string, toast?: string): void {
  if (warned.has(key)) return
  warned.add(key)
  $.ui.log(line)
  if (toast !== undefined) $.ui.toast(toast, { timeoutMs: 8_000 })
}

async function loadContext($: EngineInterface): Promise<Context> {
  const root = await $.session.root()
  const realRoot = (await $.fs.stat(root, { resolve: true }).catch(() => undefined))?.realPath ?? root
  const home = await $.env.get('HOME')
  const path = `${root}/${OVERRIDES_PATH}`
  let fileText: string | undefined
  let readProblem: string | undefined
  if (await $.fs.exists(path)) {
    fileText = await $.fs.read(path).catch((error: unknown) => {
      readProblem = `(file): could not be read: ${error instanceof Error ? error.message : String(error)}`
      return undefined
    })
  }
  const loaded = readProblem !== undefined ? { ...loadConfig(undefined), errors: [readProblem] } : loadConfig(fileText)
  if (loaded.errors.length > 0) {
    warnOnce(
      $,
      'config',
      text('notice.configBroken', { path: OVERRIDES_PATH, errors: loaded.errors.join('; ') }),
      text('notice.configBrokenShort'),
    )
  }
  return { loaded, root, realRoot, ...(home !== undefined && { home }) }
}

async function contextOf($: EngineInterface): Promise<Context> {
  if (context === undefined) {
    context = loadContext($).catch((error: unknown) => {
      context = undefined
      throw error
    })
  }
  return context
}

/** Where a file tool's path really lands, symbolic links resolved, mapped under the root. */
async function realPathOf($: EngineInterface, call: Call, cwd: string, ctx: Context): Promise<string | undefined> {
  const field = FILE_PATH_FIELDS[call.tool]
  const given = field === undefined ? undefined : call.input[field]
  if (typeof given !== 'string') return undefined
  const absolute = resolve(given, cwd, ctx.home)
  const cut = absolute.lastIndexOf('/')
  const own = await $.fs.stat(absolute, { resolve: true }).catch(() => undefined)
  let real = own?.realPath
  if (real === undefined) {
    const folder = await $.fs.stat(absolute.slice(0, cut) || '/', { resolve: true }).catch(() => undefined)
    if (folder?.realPath !== undefined) real = `${folder.realPath.replace(/\/$/, '')}/${absolute.slice(cut + 1)}`
  }
  if (real === undefined) return undefined
  return ctx.realRoot !== ctx.root && (real === ctx.realRoot || isInside(real, ctx.realRoot))
    ? `${ctx.root}${real.slice(ctx.realRoot.length)}`
    : real
}

/** Content of scripts the call runs that Claude wrote this session, redacted. */
async function scriptsOf(
  $: EngineInterface,
  classification: Classification,
  cwd: string,
  written: readonly string[],
  home: string | undefined,
): Promise<{ path: string; content: string }[]> {
  const scripts: { path: string; content: string }[] = []
  for (const word of classification.scriptPaths) {
    if (scripts.length >= MAX_SCRIPTS) break
    const path = resolve(word, cwd, home)
    if (!written.includes(path)) continue
    const content = await $.fs.read(path).catch(() => undefined)
    if (typeof content === 'string') {
      scripts.push({ path, content: redact(truncate(content, GANDALF_LIMITS.scriptLines, GANDALF_LIMITS.scriptChars)) })
    }
  }
  return scripts
}

async function reviewByGandalf(
  $: EngineInterface,
  gandalf: GandalfContext,
  model: string,
  deadlineMs: number,
  signal: AbortSignal,
): Promise<Review> {
  const nonce = newNonce()
  const profile = profileOf(model)
  try {
    const reply = await $.model.complete(
      {
        model,
        system: gandalfSystem(nonce),
        prompt: gandalfPrompt(gandalf, nonce),
        maxTokens: profile.maxTokens,
        ...(profile.effort !== undefined && { effort: profile.effort }),
        timeoutMs: deadlineMs,
      },
      { signal },
    )
    const usage = reply.usage
    const tokens =
      usage.input_tokens + usage.output_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens
    if (!reply.isAnswered) {
      const problem =
        reply.reason === 'aborted'
          ? 'it ran out of time or was interrupted'
          : reply.reason === 'api-error'
            ? `the API answered with an error (${reply.error})`
            : 'it gave an empty reply'
      if (reply.reason === 'api-error' && ['model_not_found', 'invalid_request', 'authentication_failed'].includes(reply.error)) {
        warnOnce($, `model:${model}`, text('notice.modelFailed', { who: text('who.gandalf'), model, problem }))
      }
      return { ok: false, problem, model, tokens }
    }
    const parsed = parseVerdict(reply.text)
    return parsed.ok
      ? { ok: true, verdict: parsed.verdict, model, tokens }
      : { ok: false, problem: `malformed verdict: ${parsed.problem}`, model, tokens }
  } catch (error) {
    const problem = `the request was refused: ${error instanceof Error ? error.message : String(error)}`
    warnOnce($, `model:${model}`, text('notice.modelFailed', { who: text('who.gandalf'), model, problem }))
    return { ok: false, problem, model, tokens: 0 }
  }
}

/** Puts the call to the user; where nobody can be asked, says so. */
async function escalate($: EngineInterface, question: string): Promise<Answer | Unanswered> {
  const surfaces = await $.session.surfaces().catch(() => [])
  if (surfaces.length === 0) return 'unavailable'
  try {
    const answer = await $.ui.ask(question, { options: optionsOf(), header: text('ask.header') })
    return interpretAnswer(answer)
  } catch (error) {
    return interpretRejection(error)
  }
}

async function appendAudit($: EngineInterface, record: AuditRecord, root: string): Promise<void> {
  const path = resolve(settings.auditLogPath, root)
  const folder = path.slice(0, path.lastIndexOf('/'))
  if (!isGitignoreChecked) {
    isGitignoreChecked = true
    const ignore = `${folder}/.gitignore`
    if (isInside(path, root) && !(await $.fs.exists(ignore))) await $.fs.write(ignore, AUDIT_GITIGNORE)
  }
  const line = auditLine(record)
  const current = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
  const maxBytes = settings.auditMaxKb * 1024
  const older: (string | undefined)[] = []
  if (current !== '' && current.length + line.length > maxBytes) {
    for (let n = 1; n < ROTATED_FILES - 1; n++) {
      const rotated = `${path}.${n}`
      older.push((await $.fs.exists(rotated)) ? await $.fs.read(rotated) : undefined)
    }
  }
  for (const write of appendPlan(path, current, line, maxBytes, older)) await $.fs.write(write.path, write.text)
}

/** Appends one audit line; writes are serialized, and a failed write never changes a decision. */
async function audit($: EngineInterface, record: AuditRecord, root: string): Promise<void> {
  const queued = auditQueue.then(() => appendAudit($, record, root))
  auditQueue = queued.catch((error: unknown) => {
    $.ui.log(`Council: audit write failed: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
  })
  await auditQueue
}

/** Notes a file Claude wrote, once the write has run. */
async function noteWrite($: EngineInterface, call: Call, cwd: string, home: string | undefined, result: ToolCallResult): Promise<void> {
  const field = FILE_PATH_FIELDS[call.tool]
  const given = field === undefined ? undefined : call.input[field]
  const isWritten = typeof given === 'string' && result.deny === undefined && result.isError !== true
  if (isWritten) await update($, session, value => noteWritten(sessionOf(value), resolve(given, cwd, home)))
}

/** The call's arguments as text for a reviewer or the user: redacted, never whole files. */
function callText(call: Call): string {
  if (SHELL_TOOLS.has(call.tool) && typeof call.input.command === 'string') return redact(call.input.command)
  const field = FILE_PATH_FIELDS[call.tool]
  if (field !== undefined) {
    const { [field]: path, ...rest } = call.input
    return redact(`${String(path)}\n${JSON.stringify(rest, null, 1)}`)
  }
  return redact(JSON.stringify(call.input, null, 1))
}

function callOf(e: Readonly<Record<string, unknown>>): Call {
  const { tool, tool_use_id: _id, agentId: _agent, consent: _consent, ...input } = e
  return { tool: String(tool), input }
}

const MEMBER_WHO: Readonly<Record<string, StringKey>> = {
  gandalf: 'who.gandalf',
  legolas: 'who.legolas',
  aragorn: 'who.aragorn',
}

export const register: Register = (on, options) => {
  settings = settingsOf(options)

  on('session.start', async ($, e, next) => {
    await contextOf($).catch(() => undefined)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (HUMAN_ORIGINS.has(e.origin.kind)) {
      await update($, session, value => resetForPrompt(sessionOf(value), redact(e.text)))
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const started = Date.now()
    const call = callOf(e as unknown as Readonly<Record<string, unknown>>)

    /** The one way a call passes: never with the hook's own budget spent. */
    const proceed = async (): Promise<ToolCallResult> =>
      next.budget.remainingMs < BUDGET_GUARD_MS
        ? { deny: refusalText({ who: 'who.council', verdict: 'error', reason: text('reason.internal'), alternative: text('alternative.ask') }) }
        : next(e)

    const ctx = await contextOf($)
    const cwd = await $.session.cwd()
    const realPath = await realPathOf($, call, cwd, ctx)
    const classification = classify(call, ctx.loaded.compiled, {
      root: ctx.root,
      cwd,
      ...(ctx.home !== undefined && { home: ctx.home }),
      ...(realPath !== undefined && { realPath }),
    })

    if (classification.tier === 'allow') {
      const result = await proceed()
      await noteWrite($, call, cwd, ctx.home, result).catch(() => undefined)
      return result
    }

    // A gated call: everything from here is audited.
    const state = sessionOf(await read($, session))
    const fingerprint = await fingerprintOf(call.tool, call.input)
    const decided = classification.decided
    let model: string | null = null
    let tokens = 0
    let verdictText: string | null = null
    let reasonText: string | null = decided?.reason ?? null
    let decision: Decision | null = null

    const finish = async (result: ToolCallResult): Promise<ToolCallResult> => {
      const record: AuditRecord = {
        ts: new Date().toISOString(),
        tool: call.tool,
        fingerprint,
        opKey: null,
        tier: classification.tier,
        ruleId: decided?.ruleId ?? null,
        member: classification.tier === 'review' ? 'gandalf' : null,
        profile: decided?.profile ?? null,
        model,
        verdict: verdictText,
        reason: reasonText,
        shadow: false,
        bypass: state.bypass,
        decision,
        outcome: result.deny !== undefined ? 'refused' : result.isError === true ? 'error' : 'ran',
        latencyMs: Date.now() - started,
        tokens,
        ...(e.agentId !== undefined && { agentId: e.agentId }),
      }
      await audit($, record, ctx.root)
      if (result.deny === undefined) await noteWrite($, call, cwd, ctx.home, result).catch(() => undefined)
      return result
    }

    const refuse = (refusal: Refusal): Promise<ToolCallResult> => finish({ deny: refusalText(refusal) })

    /** The user decides; any answer but "allow once" refuses. */
    const askUser = async (why: StringKey, opinions: readonly MemberOpinion[]): Promise<ToolCallResult> => {
      const question = questionText({ call: `${call.tool}: ${callText(call)}`, ruleReason: decided?.reason ?? '', why, opinions })
      const answer = await escalate($, question)
      if (answer === 'unavailable' || answer === 'dismissed' || answer === 'chat') {
        decision = answer
        const reason =
          answer === 'unavailable'
            ? text('reason.nobodyToAsk', { why: text(why) })
            : answer === 'chat'
              ? text('reason.userWantsChat')
              : text('reason.userDismissed')
        return refuse({ who: 'who.user', verdict: 'not allowed', reason, alternative: text(answer === 'chat' ? 'alternative.chat' : 'alternative.ask') })
      }
      if (answer.kind === 'allow-once') {
        decision = 'allow-once'
        return finish(await proceed())
      }
      if (answer.kind === 'keep-blocked') {
        decision = 'keep-blocked'
        return refuse({ who: 'who.user', verdict: 'keep blocked', reason: text('reason.userKeptBlocked'), alternative: text('alternative.ask') })
      }
      decision = 'instruction'
      return refuse({
        who: 'who.user',
        verdict: 'instruction',
        reason: text('reason.userKeptBlocked'),
        alternative: text('alternative.ask'),
        instruction: answer.text,
      })
    }

    if (state.bypass) {
      $.ui.log(text('notice.bypass', { tool: call.tool }), { to: 'debug' })
      return finish(await proceed())
    }

    if (classification.tier === 'block') {
      return refuse({ who: 'who.rules', verdict: 'block', reason: decided?.reason ?? '', alternative: text('alternative.narrower') })
    }

    if (classification.tier === 'ask') return askUser('escalate.askTier', [])

    // Review. Stage 1 seats Gandalf alone: every review goes to him.
    if (!settings.gandalfEnabled) return askUser('escalate.memberOff', [])
    if (state.tokensSpent >= settings.tokenBudget) return askUser('escalate.budget', [])

    const choice = resolveModel('gandalf', {
      settings: settings.gandalfModel,
      ...(ctx.loaded.compiled.config.models.gandalf !== undefined && { project: ctx.loaded.compiled.config.models.gandalf }),
    })
    model = choice.model
    const scripts = await scriptsOf($, classification, cwd, state.written, ctx.home)
    const review = await reviewByGandalf(
      $,
      {
        tool: call.tool,
        call: callText(call),
        ruleReasons: [...new Set(classification.findings.map(finding => finding.reason))],
        latestPrompt: state.latestPrompt,
        scripts,
      },
      choice.model,
      deadlineFor(choice.model, settings.reviewDeadlineSeconds),
      next.signal,
    )
    tokens = review.tokens
    await update($, session, value => {
      const spent = addTokens(sessionOf(value), review.tokens)
      return count(spent, 'gandalf', review.ok ? review.verdict.verdict : 'failed')
    })

    if (!review.ok) {
      verdictText = 'failed'
      reasonText = review.problem
      return askUser('escalate.failed', [{ who: 'who.gandalf', problem: review.problem }])
    }

    verdictText = review.verdict.verdict
    reasonText = review.verdict.reason
    if (review.verdict.verdict === 'approve') return finish(await proceed())
    return refuse({
      who: MEMBER_WHO.gandalf ?? 'who.gandalf',
      verdict: review.verdict.verdict,
      reason: review.verdict.reason,
      alternative: review.verdict.safer_alternative,
    })
  }).catch(($, e, next) =>
    // A failure after the call ran replays its result; one before it refuses.
    next.called
      ? next(e)
      : { deny: refusalText({ who: 'who.council', verdict: 'error', reason: text('reason.internal'), alternative: text('alternative.ask') }) },
  )
}
