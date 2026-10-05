import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, RenderElement, ToolCallResult } from 'claude-code'

import type { CouncilPanel } from '../types'
import { appendPlan, AUDIT_GITIGNORE, auditLine, fingerprintOf, ROTATED_FILES } from './audit.js'
import type { AuditRecord, Decision } from './audit.js'
import { OVERRIDES_PATH } from './config/defaults.js'
import { loadConfig, MODEL_ID } from './config/schema.js'
import type { LoadedConfig } from './config/schema.js'
import { MODEL_SLOTS } from './config/types.js'
import type { ModelSlot } from './config/types.js'
import { withAllowlistEntry } from './config/write.js'
import type { FileEdit } from './config/write.js'
import { isSlot, logOutput, modelsOutput, parseCouncil, rulesOutput, statusOutput, testOutput } from './elrond/commands.js'
import type { CouncilCommand, Output } from './elrond/commands.js'
import { interpretAnswer, interpretRejection, optionsOf, questionText } from './elrond/escalation.js'
import type { Answer, MemberOpinion, Unanswered } from './elrond/escalation.js'
import { deadlineFor, profileOf, resolveModel } from './elrond/models.js'
import type { ModelChoice } from './elrond/models.js'
import {
  cacheApprove,
  isOutOfRounds,
  isWipeOutcome,
  lockoutOf,
  noteRound,
  noteWipe,
  operationOf,
  outcomeOf,
  resetOperation,
  resetRounds,
  roundsLeft,
} from './elrond/operations.js'
import type { WipePolicy } from './elrond/operations.js'
import { refusalText } from './elrond/refusal.js'
import type { Refusal } from './elrond/refusal.js'
import { formatPreview, INSPECTION_TIMEOUT_MS, MAX_LISTED, planPreview } from './members/galadriel.js'
import type { Inspection, InspectionResult } from './members/galadriel.js'
import { GANDALF_LIMITS, gandalfPrompt, gandalfSystem } from './members/gandalf.js'
import type { GandalfContext } from './members/gandalf.js'
import { patternsWith, scanCall } from './members/gollum.js'
import type { GollumFinding } from './members/gollum.js'
import { newNonce, parseVerdict, truncate } from './members/shared.js'
import type { Verdict } from './members/shared.js'
import { redact } from './redact.js'
import type { SecretPattern } from './redact.js'
import { classify, FILE_PATH_FIELDS, SHELL_TOOLS } from './rules/classify.js'
import type { Call, Classification } from './rules/classify.js'
import { isInside, resolve } from './rules/paths.js'
import {
  addReviewTime,
  addTokens,
  clearCache,
  count,
  INITIAL_SESSION,
  isShadow,
  noteWritten,
  resetForPrompt,
  sessionOf,
  withBypass,
  withSessionModel,
  withShadow,
} from './state.js'
import { text } from './strings.js'
import type { StringKey } from './strings.js'

/**
 * Elrond, the chair: the one `tool.call` hook every call passes through.
 * Rules classify it; allow passes untouched; block refuses; a locked-out
 * operation refuses; the secrets scan refuses or asks; ask goes to the user;
 * review gets a read-only preview and goes to a model member. Every failure
 * refuses or asks: the hook never lets a gated call through on an error.
 *
 * Also `/council`, and the mode label by the prompt. The only file that
 * touches `$`; everything it decides with is a pure function in a sibling.
 */

const session = atom({ plugin: 'council-of-elrond', key: 'session' } as const, INITIAL_SESSION)

const panel = atom({ plugin: 'council-of-elrond', key: 'panel' } as const, { title: '', lines: [] } as CouncilPanel)

/** Margin kept on the hook's own 10 s budget before any pass-through. */
const BUDGET_GUARD_MS = 1_000

/** Prompt origins that are the user's own and reset the per-prompt state. */
const HUMAN_ORIGINS: ReadonlySet<string> = new Set(['composer', 'bridge', 'sdk'])

const MAX_SCRIPTS = 3

const COMMAND = 'council'
const PANE_ID = 'council'

/** The `/config` row a `--save` writes, per slot that has one. */
const CONFIG_ROWS: Readonly<Partial<Record<ModelSlot, string>>> = { gandalf: 'council-of-elrond.gandalfModel' }

/** What the `/config` model picker offers; anything else is session-only. */
const PICKER_OPTIONS: readonly string[] = ['default', 'sonnet', 'opus', 'fable', 'haiku']

/** Git for previews: no locks taken, no prompts, plain output. */
const GIT_ENV: Record<string, string> = { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', LC_ALL: 'C' }

const PROBE_TIMEOUT_MS = 20_000

type Settings = {
  gandalfEnabled: boolean
  gandalfModel: string
  reviewDeadlineSeconds: number
  tokenBudget: number
  auditLogPath: string
  auditMaxKb: number
  shadowMode: boolean
  toolErrorsAreWipes: boolean
  previewLines: number
  gollumEnabled: boolean
  galadrielEnabled: boolean
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
  shadowMode: options.shadowMode === true,
  toolErrorsAreWipes: options.toolErrorsAreWipes !== false,
  previewLines: typeof options.previewLines === 'number' ? options.previewLines : 80,
  gollumEnabled: options.gollumEnabled !== false,
  galadrielEnabled: options.galadrielEnabled !== false,
})

type Context = {
  loaded: LoadedConfig
  root: string
  /** The root with symbolic links resolved, to map resolved paths back under `root`. */
  realRoot: string
  home?: string
  /** Shipped and configured secret patterns: the scan's, and every redaction's. */
  patterns: readonly SecretPattern[]
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

const wipePolicy = (): WipePolicy => ({ toolErrors: settings.toolErrorsAreWipes })

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
  const patterns = patternsWith(loaded.compiled.config.gollum.patterns)
  return { loaded, root, realRoot, patterns, ...(home !== undefined && { home }) }
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

/** Reads the rules again (decision 9: after the mod's own writes, and on `/council reload`). */
async function reloadContext($: EngineInterface): Promise<Context> {
  context = undefined
  warned.delete('config')
  const fresh = await contextOf($)
  await update($, session, value => clearCache(sessionOf(value)))
  return fresh
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
  ctx: Context,
): Promise<{ path: string; content: string }[]> {
  const scripts: { path: string; content: string }[] = []
  for (const word of classification.scriptPaths) {
    if (scripts.length >= MAX_SCRIPTS) break
    const path = resolve(word, cwd, ctx.home)
    if (!written.includes(path)) continue
    const content = await $.fs.read(path).catch(() => undefined)
    if (typeof content === 'string') {
      scripts.push({ path, content: redact(truncate(content, GANDALF_LIMITS.scriptLines, GANDALF_LIMITS.scriptChars), ctx.patterns) })
    }
  }
  return scripts
}

/**
 * Runs Galadriel's inspections: only what the table planned, read-only, each
 * on its own timeout. A failure is no preview, never a decision.
 */
async function previewOf($: EngineInterface, plan: readonly Inspection[], ctx: Context): Promise<string | undefined> {
  const results: InspectionResult[] = []
  for (const step of plan) {
    try {
      if (step.kind === 'path') {
        const stat = await $.fs.stat(step.path).catch(() => undefined)
        if (stat === undefined) {
          results.push({ kind: 'path', label: step.label, state: 'missing' })
        } else if (stat.kind === 'dir') {
          const entries = await $.fs.list(step.path)
          const names = entries.slice(0, MAX_LISTED).map(entry => (entry.kind === 'dir' ? `${entry.name}/` : entry.name))
          results.push({ kind: 'path', label: step.label, state: 'dir', entries: names, total: entries.length })
        } else {
          results.push({ kind: 'path', label: step.label, state: 'file', size: stat.size })
        }
      } else {
        const run = await $.process.run(step.argv, { cwd: ctx.root, env: GIT_ENV, timeoutMs: INSPECTION_TIMEOUT_MS })
        results.push({ kind: 'git', label: step.label, exitCode: run.exitCode, stdout: run.stdout.slice(0, 50_000) })
      }
    } catch {
      results.push({ kind: 'failed', label: step.label })
    }
  }
  const preview = formatPreview(results, settings.previewLines)
  return preview === undefined ? undefined : redact(preview, ctx.patterns)
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
async function escalate($: EngineInterface, question: string, withAllowlist: boolean): Promise<Answer | Unanswered> {
  const surfaces = await $.session.surfaces().catch(() => [])
  if (surfaces.length === 0) return 'unavailable'
  try {
    const answer = await $.ui.ask(question, { options: optionsOf('plain', withAllowlist), header: text('ask.header') })
    return interpretAnswer(answer, 'plain', withAllowlist)
  } catch (error) {
    return interpretRejection(error)
  }
}

/** The second confirm before an allowlist entry is written: only "Add it" adds. */
async function confirmAllowlist($: EngineInterface, finding: GollumFinding): Promise<boolean> {
  const question = text('ask.confirmAllowlist', { label: finding.label, entry: finding.fingerprint, path: OVERRIDES_PATH, field: 'gollum.allowlist' })
  try {
    const answer = await $.ui.ask(question, { options: [text('ask.confirmAdd'), text('ask.confirmCancel')], header: text('ask.header') })
    return answer === text('ask.confirmAdd')
  } catch {
    return false
  }
}

/** Adds an allowlist entry to the project rules file; a broken file is left alone. */
async function writeAllowlist($: EngineInterface, root: string, entry: string): Promise<FileEdit> {
  const path = `${root}/${OVERRIDES_PATH}`
  try {
    const current = (await $.fs.exists(path)) ? await $.fs.read(path) : undefined
    const edit = withAllowlistEntry(current, entry)
    if (edit.ok) await $.fs.write(path, edit.text)
    return edit
  } catch (error) {
    return { ok: false, problem: error instanceof Error ? error.message : String(error) }
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

/** The label by the prompt where SessionMode is not drawn (other surfaces): the status line. */
async function syncIndicator($: EngineInterface): Promise<void> {
  const state = sessionOf(await read($, session))
  const label = state.bypass ? text('mode.bypass') : isShadow(state, settings.shadowMode) ? text('mode.shadow') : undefined
  const surfaces = await $.session.surfaces().catch(() => [])
  if (surfaces.some(surface => surface !== 'terminal' && surface !== 'desktop')) $.ui.status(label)
}

/** Shows `/council` output to the user: in its pane where one draws, else as transcript lines. Never to Claude. */
async function show($: EngineInterface, output: Output): Promise<void> {
  const surfaces = await $.session.surfaces().catch(() => [])
  if (surfaces.length > 0) {
    await update($, panel, () => output)
    const opened = await $.ui.open({ id: PANE_ID, title: output.title }).catch(() => undefined)
    if (opened?.isPlaced === true) return
  }
  $.ui.log(output.title)
  for (const line of output.lines) $.ui.log(line)
}

/** A one-request check that a model answers: an API error is a no, a timeout unsure. */
async function probeModel($: EngineInterface, model: string): Promise<{ ok: true } | { ok: false; isCertain: boolean; problem: string }> {
  try {
    const reply = await $.model.complete({ model, prompt: 'Reply with the single word OK.', maxTokens: 16, timeoutMs: PROBE_TIMEOUT_MS })
    const usage = reply.usage
    await update($, session, value => addTokens(sessionOf(value), usage.input_tokens + usage.output_tokens))
    if (reply.isAnswered || reply.reason === 'empty-reply') return { ok: true }
    if (reply.reason === 'api-error') return { ok: false, isCertain: true, problem: reply.error }
    return { ok: false, isCertain: false, problem: 'no answer in time' }
  } catch (error) {
    return { ok: false, isCertain: true, problem: error instanceof Error ? error.message : String(error) }
  }
}

function modelChoice(slot: ModelSlot, ctx: Context, sessionModels: Readonly<Partial<Record<ModelSlot, string>>>): ModelChoice {
  const project = ctx.loaded.compiled.config.models[slot]
  const sessionModel = sessionModels[slot]
  return resolveModel(slot, {
    ...(slot === 'gandalf' && { settings: settings.gandalfModel }),
    ...(project !== undefined && { project }),
    ...(sessionModel !== undefined && { session: sessionModel }),
  })
}

async function councilModel($: EngineInterface, command: Extract<CouncilCommand, { kind: 'model' }>): Promise<Output> {
  const title = text('cmd.title')
  if (!isSlot(command.slot)) return { title, lines: [text('cmd.modelBadSlot', { slot: command.slot, slots: MODEL_SLOTS.join(', ') })] }
  const slot = command.slot
  const ctx = await contextOf($)
  const before = sessionOf(await read($, session))
  if (command.model === 'default') {
    const after = await update($, session, value => withSessionModel(sessionOf(value), slot, undefined))
    const now = modelChoice(slot, ctx, after.models)
    return { title, lines: [text('cmd.modelCleared', { id: slot, model: now.model, source: now.source })] }
  }
  if (!MODEL_ID.test(command.model)) return { title, lines: [text('cmd.modelBadId', { model: command.model })] }

  const lines: string[] = []
  const probe = await probeModel($, command.model)
  if (!probe.ok && probe.isCertain) {
    const previous = modelChoice(slot, ctx, before.models)
    return { title, lines: [text('cmd.modelProbeFailed', { model: command.model, problem: probe.problem, id: slot, previous: previous.model })] }
  }
  await update($, session, value => withSessionModel(sessionOf(value), slot, command.model))
  lines.push(text('cmd.modelSet', { id: slot, model: command.model }))
  if (!probe.ok) lines.push(text('cmd.modelProbeUnsure', { model: command.model, problem: probe.problem }))
  if (command.save) {
    const row = CONFIG_ROWS[slot]
    if (row === undefined) {
      lines.push(text('cmd.modelNotSaved', { problem: text('cmd.modelNoRow', { id: slot }) }))
    } else if (!PICKER_OPTIONS.includes(command.model)) {
      lines.push(text('cmd.modelNotSaved', { problem: text('cmd.modelNotOption', { options: PICKER_OPTIONS.join(', ') }) }))
    } else {
      const saved = await $.config.set({ key: row, value: command.model }).catch((error: unknown) => ({
        deny: error instanceof Error ? error.message : String(error),
      }))
      lines.push(saved.deny === undefined ? text('cmd.modelSaved') : text('cmd.modelNotSaved', { problem: saved.deny }))
    }
  }
  return { title, lines }
}

async function councilOutput($: EngineInterface, command: CouncilCommand): Promise<Output> {
  const title = text('cmd.title')
  switch (command.kind) {
    case 'status': {
      const ctx = await contextOf($)
      const state = sessionOf(await read($, session))
      const mode = state.bypass ? 'bypass' : isShadow(state, settings.shadowMode) ? 'shadow' : 'enforcing'
      return statusOutput({
        session: state,
        mode,
        gandalf: { enabled: settings.gandalfEnabled, choice: modelChoice('gandalf', ctx, state.models) },
        gollumEnabled: settings.gollumEnabled,
        galadrielEnabled: settings.galadrielEnabled,
        tokenBudget: settings.tokenBudget,
      })
    }
    case 'bypass':
      await update($, session, value => withBypass(sessionOf(value), command.on))
      await syncIndicator($)
      return { title, lines: [text(command.on ? 'cmd.bypassOn' : 'cmd.bypassOff')] }
    case 'shadow':
      await update($, session, value => withShadow(sessionOf(value), command.on))
      await syncIndicator($)
      return { title, lines: [text(command.on ? 'cmd.shadowOn' : 'cmd.shadowOff')] }
    case 'log': {
      const ctx = await contextOf($)
      const path = resolve(settings.auditLogPath, ctx.root)
      try {
        const logText = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
        return logOutput(logText, command.count)
      } catch (error) {
        return { title, lines: [text('cmd.logUnreadable', { problem: error instanceof Error ? error.message : String(error) })] }
      }
    }
    case 'rules': {
      const ctx = await contextOf($)
      return rulesOutput(ctx.loaded.compiled, ctx.loaded.origin, ctx.loaded.errors)
    }
    case 'test': {
      // Classification only: nothing the command names is run, read or stat'ed.
      const ctx = await contextOf($)
      const cwd = await $.session.cwd()
      const call: Call = { tool: 'Bash', input: { command: command.command } }
      const where = { root: ctx.root, cwd, ...(ctx.home !== undefined && { home: ctx.home }) }
      const classification = classify(call, ctx.loaded.compiled, where)
      const operation = classification.tier === 'allow' ? undefined : operationOf(call, classification, where)
      const state = sessionOf(await read($, session))
      return testOutput(redact(command.command, ctx.patterns), classification, operation, modelChoice('gandalf', ctx, state.models))
    }
    case 'models': {
      const ctx = await contextOf($)
      const state = sessionOf(await read($, session))
      const choices = Object.fromEntries(MODEL_SLOTS.map(slot => [slot, modelChoice(slot, ctx, state.models)])) as Record<ModelSlot, ModelChoice>
      return modelsOutput(choices)
    }
    case 'model':
      return councilModel($, command)
    case 'reload': {
      const ctx = await reloadContext($)
      const lines = [text('cmd.reloaded', { count: ctx.loaded.compiled.rules.length, origin: ctx.loaded.origin })]
      if (ctx.loaded.errors.length > 0) lines.push(text('cmd.configErrors', { errors: ctx.loaded.errors.join('; ') }))
      return { title, lines }
    }
    case 'report':
      return { title, lines: [text('cmd.reportLater')] }
    case 'usage':
      return { title, lines: [text(command.key, command.params ?? {}), ...(command.key === 'cmd.unknown' ? [text('cmd.help')] : [])] }
  }
}

/** The call's arguments as text for a reviewer or the user: redacted, never whole files. */
function callText(call: Call, patterns: readonly SecretPattern[]): string {
  if (SHELL_TOOLS.has(call.tool) && typeof call.input.command === 'string') return redact(call.input.command, patterns)
  const field = FILE_PATH_FIELDS[call.tool]
  if (field !== undefined) {
    const { [field]: path, ...rest } = call.input
    return redact(`${String(path)}\n${JSON.stringify(rest, null, 1)}`, patterns)
  }
  return redact(JSON.stringify(call.input, null, 1), patterns)
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
    const ctx = await contextOf($).catch(() => undefined)
    await $.command
      .register({
        name: COMMAND,
        description: 'The council: status, bypass, shadow mode, log, rules, test a command, models, reload',
        argumentHint: '[on|off|shadow on|off|log [n]|rules|test "<cmd>"|model [<member> <model> [--save]]|reload]',
      })
      .catch((error: unknown) => {
        $.ui.log(text('notice.commandFailed', { problem: error instanceof Error ? error.message : String(error) }))
      })
    // Decision 6: suggest shadow mode once, while the council has logged nothing.
    if (ctx !== undefined && !isShadow(sessionOf(await read($, session)), settings.shadowMode)) {
      const isEmpty = !(await $.fs.exists(resolve(settings.auditLogPath, ctx.root)).catch(() => true))
      if (isEmpty) warnOnce($, 'shadow-suggest', text('notice.shadowSuggest'), text('notice.shadowSuggest'))
    }
    await syncIndicator($).catch(() => undefined)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (HUMAN_ORIGINS.has(e.origin.kind)) {
      const patterns = (await contextOf($).catch(() => undefined))?.patterns
      await update($, session, value => resetForPrompt(sessionOf(value), redact(e.text, patterns)))
    }
    return next(e)
  })

  // Output goes to the user only (decision 1): no text for Claude to read.
  on('command.run', { command: COMMAND }, async ($, e) => {
    await show($, await councilOutput($, parseCouncil(e.args)))
    return {}
  }).catch(($, e) => {
    $.ui.log(text('cmd.help'))
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const shown = await read($, panel)
    // Called directly rather than as JSX, so this module stays a .ts file.
    return h(Box, { flexDirection: 'column' }, ...shown.lines.map(line => h(Text, { wrap: 'wrap' }, line))) as RenderElement
  })

  // The mode label by the prompt while bypass or shadow is on (terminal and desktop).
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const state = sessionOf(await read($, session))
    const label = state.bypass ? text('mode.bypass') : isShadow(state, settings.shadowMode) ? text('mode.shadow') : undefined
    return label === undefined ? next(e) : next({ ...e, props: { ...e.props, modes: [...e.props.modes, label] } })
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
    const where = {
      root: ctx.root,
      cwd,
      ...(ctx.home !== undefined && { home: ctx.home }),
      ...(realPath !== undefined && { realPath }),
    }
    const classification = classify(call, ctx.loaded.compiled, where)

    if (classification.tier === 'allow') {
      const result = await proceed()
      await noteWrite($, call, cwd, ctx.home, result).catch(() => undefined)
      return result
    }

    // A gated call: everything from here is audited.
    const state = sessionOf(await read($, session))
    const fingerprint = await fingerprintOf(call.tool, call.input)
    const operation = operationOf(call, classification, where)
    const decided = classification.decided
    const shadow = isShadow(state, settings.shadowMode)
    const shownCall = `${call.tool}: ${callText(call, ctx.patterns)}`
    let member: string | null = classification.tier === 'review' ? 'gandalf' : null
    let model: string | null = null
    let tokens = 0
    let verdictText: string | null = null
    let reasonText: string | null = decided?.reason ?? null
    let decision: Decision | null = null
    let isCached = false
    let isShadowed = false
    let preview: string | undefined

    /** Audits the call, then counts it: a failed attempt, or a success that clears its operation. */
    const finish = async (result: ToolCallResult, isWipe = false): Promise<ToolCallResult> => {
      const outcome = outcomeOf(result)
      const record: AuditRecord = {
        ts: new Date().toISOString(),
        tool: call.tool,
        fingerprint,
        opKey: operation.key,
        tier: classification.tier,
        ruleId: decided?.ruleId ?? null,
        member,
        profile: decided?.profile ?? null,
        model,
        verdict: verdictText,
        reason: reasonText,
        shadow: isShadowed,
        bypass: state.bypass,
        decision,
        outcome,
        latencyMs: Date.now() - started,
        tokens,
        ...(isCached && { cached: true as const }),
        ...(e.agentId !== undefined && { agentId: e.agentId }),
      }
      await audit($, record, ctx.root)
      const counts = result.deny !== undefined ? isWipe : isWipeOutcome(outcome, wipePolicy())
      if (counts || outcome === 'ran') {
        await update($, session, value => (counts ? noteWipe(sessionOf(value), operation) : resetOperation(sessionOf(value), operation.key)))
      }
      if (result.deny === undefined) await noteWrite($, call, cwd, ctx.home, result).catch(() => undefined)
      return result
    }

    /** Refuses with the rounds left on the operation; `isWipe` counts it as a failed attempt. */
    const refuse = async (refusal: Refusal, isWipe: boolean): Promise<ToolCallResult> => {
      const left = roundsLeft(sessionOf(await read($, session)), operation.key)
      return finish({ deny: refusalText({ ...refusal, roundsLeft: left }) }, isWipe)
    }

    /** Lets the call through after the user allowed it, labelling Claude Code's own dialog (decision 10). */
    const allowOnce = async (): Promise<ToolCallResult> => {
      try {
        $.ui.notice(e.tool_use_id, text('notice.allowedOnce'))
      } catch {
        // No dialog to label: nothing lost.
      }
      return finish(await proceed())
    }

    /**
     * The user decides. Returns 'allowed' for allow once (or a confirmed
     * allowlist entry); any other answer refuses here.
     */
    const putToUser = async (
      why: StringKey,
      opinions: readonly MemberOpinion[],
      secrets: readonly GollumFinding[] = [],
    ): Promise<'allowed' | ToolCallResult> => {
      const question = questionText({
        call: shownCall,
        ruleReason: decided?.reason ?? '',
        why,
        opinions,
        ...(preview !== undefined && { preview }),
        ...(secrets.length > 0 && { secrets: secrets.map(finding => ({ label: finding.label, snippet: finding.snippet })) }),
        canAllowlist: secrets.length === 1,
      })
      // One entry per confirm: the allowlist is offered for a single finding only.
      const answer = await escalate($, question, secrets.length === 1)
      if (answer === 'unavailable' || answer === 'dismissed' || answer === 'chat') {
        decision = answer
        const reason =
          answer === 'unavailable'
            ? text('reason.nobodyToAsk', { why: text(why) })
            : answer === 'chat'
              ? text('reason.userWantsChat')
              : text('reason.userDismissed')
        // Decision 4: chatting is not a failed attempt; dismissing and nobody to ask are.
        return refuse({ who: 'who.user', verdict: 'not allowed', reason, alternative: text(answer === 'chat' ? 'alternative.chat' : 'alternative.ask') }, answer !== 'chat')
      }
      if (answer.kind === 'allow-once') {
        decision = 'allow-once'
        return 'allowed'
      }
      if (answer.kind === 'allowlist') {
        const finding = secrets[0]
        if (finding !== undefined && (await confirmAllowlist($, finding))) {
          const written = await writeAllowlist($, ctx.root, finding.fingerprint)
          if (written.ok) {
            decision = 'allowlist'
            $.ui.log(text('notice.allowlistWritten', { entry: finding.fingerprint, path: OVERRIDES_PATH }))
            await reloadContext($)
            return 'allowed'
          }
          $.ui.log(text('notice.allowlistFailed', { problem: written.problem }))
        }
        decision = 'keep-blocked'
        return refuse({ who: 'who.user', verdict: 'keep blocked', reason: text('reason.userKeptBlocked'), alternative: text('alternative.removeSecret') }, true)
      }
      if (answer.kind === 'keep-blocked') {
        decision = 'keep-blocked'
        return refuse({ who: 'who.user', verdict: 'keep blocked', reason: text('reason.userKeptBlocked'), alternative: text('alternative.ask') }, true)
      }
      decision = 'instruction'
      await update($, session, value => resetRounds(sessionOf(value), operation.key))
      return refuse(
        { who: 'who.user', verdict: 'instruction', reason: text('reason.userKeptBlocked'), alternative: text('alternative.ask'), instruction: answer.text },
        false,
      )
    }

    const askUser = async (why: StringKey, opinions: readonly MemberOpinion[]): Promise<ToolCallResult> => {
      const answer = await putToUser(why, opinions)
      return answer === 'allowed' ? allowOnce() : answer
    }

    /** Shadow mode: the second opinion is logged, never enforced. */
    const passInShadow = async (): Promise<ToolCallResult> => {
      isShadowed = true
      return finish(await proceed())
    }

    // 1. Bypass: every gated call passes, logged.
    if (state.bypass) {
      $.ui.log(text('notice.bypass', { tool: call.tool }), { to: 'debug' })
      return finish(await proceed())
    }

    // 4. Block tier.
    if (classification.tier === 'block') {
      return refuse({ who: 'who.rules', verdict: 'block', reason: decided?.reason ?? '', alternative: text('alternative.narrower') }, true)
    }

    // 5. Lockout: too many failed attempts on this operation since the user last wrote.
    const lockout = lockoutOf(state, operation)
    if (lockout !== undefined) {
      member = null
      verdictText = 'locked out'
      const reason =
        lockout.kind === 'key'
          ? text('reason.lockoutKey', { count: lockout.wipes })
          : text('reason.lockoutVerb', { count: lockout.wipes, verb: operation.verbKey.replace(/^\w+:/, '') })
      reasonText = reason
      return refuse({ who: 'who.council', verdict: 'locked out', reason: `${text('refusal.lockout', { count: lockout.wipes })} ${reason}`, alternative: text('alternative.lockout') }, false)
    }

    // 6. The secrets scan: high refuses without asking; low asks.
    let isAllowedByUser = false
    if (settings.gollumEnabled) {
      const scan = await scanCall(call, ctx.patterns, ctx.loaded.compiled.config.gollum.allowlist)
      if (scan.high.length > 0) {
        member = 'gollum'
        verdictText = 'block'
        reasonText = scan.high.map(finding => finding.label).join(', ')
        const first = scan.high[0] as GollumFinding
        return refuse({ who: 'who.gollum', verdict: 'block', reason: text('reason.secretHigh', { label: first.label, snippet: first.snippet }), alternative: text('alternative.removeSecret') }, true)
      }
      if (scan.low.length > 0) {
        member = 'gollum'
        verdictText = 'ask'
        reasonText = scan.low.map(finding => finding.label).join(', ')
        const answer = await putToUser('escalate.secretLow', [], scan.low)
        if (answer !== 'allowed') return answer
        isAllowedByUser = true
        member = classification.tier === 'review' ? 'gandalf' : null
      }
    }

    // 7. Ask tier: straight to the user (once: a secrets answer already put the call to them).
    if (classification.tier === 'ask') {
      if (isAllowedByUser) return allowOnce()
      return askUser('escalate.askTier', [])
    }

    // Review. An identical call approved this prompt is not reviewed again.
    if (state.cache.includes(fingerprint)) {
      isCached = true
      verdictText = 'approve'
      reasonText = null
      return finish(await proceed())
    }

    // 8. The read-only preview, for the reviewer and the user.
    if (settings.galadrielEnabled) preview = await previewOf($, planPreview(call, classification, where), ctx)

    // 9-10. Stage 2 seats Gandalf alone: every review goes to him.
    if (isOutOfRounds(state, operation.key) && !shadow) return askUser('escalate.rounds', [])
    if (!settings.gandalfEnabled) return shadow ? passInShadow() : askUser('escalate.memberOff', [])
    if (state.tokensSpent >= settings.tokenBudget) return shadow ? passInShadow() : askUser('escalate.budget', [])

    const choice = modelChoice('gandalf', ctx, state.models)
    model = choice.model
    const scripts = await scriptsOf($, classification, cwd, state.written, ctx)
    const reviewStarted = Date.now()
    const review = await reviewByGandalf(
      $,
      {
        tool: call.tool,
        call: callText(call, ctx.patterns),
        ruleReasons: [...new Set(classification.findings.map(finding => finding.reason))],
        latestPrompt: state.latestPrompt,
        scripts,
        ...(preview !== undefined && { preview }),
      },
      choice.model,
      deadlineFor(choice.model, settings.reviewDeadlineSeconds),
      next.signal,
    )
    const reviewMs = Date.now() - reviewStarted
    tokens = review.tokens
    isShadowed = shadow
    await update($, session, value => {
      const spent = addReviewTime(addTokens(sessionOf(value), review.tokens), reviewMs)
      const counted = count(spent, 'gandalf', review.ok ? review.verdict.verdict : 'failed')
      // A round is a verdict that enforces: in shadow, verdicts only log.
      return review.ok && !shadow ? noteRound(counted, operation.key, review.verdict.verdict === 'approve') : counted
    })

    if (!review.ok) {
      verdictText = 'failed'
      reasonText = review.problem
      return shadow ? passInShadow() : askUser('escalate.failed', [{ who: 'who.gandalf', problem: review.problem }])
    }

    verdictText = review.verdict.verdict
    reasonText = review.verdict.reason
    if (review.verdict.verdict === 'approve') {
      await update($, session, value => {
        const current = sessionOf(value)
        return { ...current, cache: cacheApprove(current.cache, fingerprint) }
      })
      return finish(await proceed())
    }
    if (shadow) {
      $.ui.log(text('notice.shadowVerdict', { who: text('who.gandalf'), verdict: review.verdict.verdict, tool: call.tool }), { to: 'debug' })
      return passInShadow()
    }
    return refuse(
      {
        who: MEMBER_WHO.gandalf ?? 'who.gandalf',
        verdict: review.verdict.verdict,
        reason: review.verdict.reason,
        alternative: review.verdict.safer_alternative,
      },
      true,
    )
  }).catch(($, e, next) =>
    // A failure after the call ran replays its result; one before it refuses.
    next.called
      ? next(e)
      : { deny: refusalText({ who: 'who.council', verdict: 'error', reason: text('reason.internal'), alternative: text('alternative.ask') }) },
  )
}
