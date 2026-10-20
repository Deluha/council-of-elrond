import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, ProcessRunResult, ProcessSpawnResult, Register, RenderElement, ToolCallResult } from 'claude-code'

import type { CouncilPanel } from '../types'
import { appendPlan, AUDIT_GITIGNORE, auditLine, fingerprintOf, isRotation, ROTATED_FILES } from './audit.js'
import type { AuditRecord, Decision } from './audit.js'
import { OVERRIDES_PATH } from './config/defaults.js'
import { loadConfig, MODEL_ID } from './config/schema.js'
import type { LoadedConfig } from './config/schema.js'
import { MODEL_SLOTS } from './config/types.js'
import type { GimliCommand, MemberName, ModelSlot } from './config/types.js'
import { withAllowlistEntry, withRule } from './config/write.js'
import type { FileEdit } from './config/write.js'
import { isCouncilCommand, isSlot, logOutput, modelsOutput, needsPerson, parseCouncil, rulesOutput, statusOutput, testOutput } from './elrond/commands.js'
import { callKeyOf, codeOf, isOfferable, parseChatLines } from './elrond/chat.js'
import { combine, hasRealBlock } from './elrond/combine.js'
import type { Voice } from './elrond/combine.js'
import { bigOperationOf, councilSeats, needsCurrentBranch, rangeOf } from './elrond/council.js'
import type { Big, CouncilSeat } from './elrond/council.js'
import type { CouncilCommand, Output, StatusInput } from './elrond/commands.js'
import { interpretAnswer, optionsOf, questionText } from './elrond/escalation.js'
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
import { isRelayed, noticeText, nobodyToAsk, relayContext } from './elrond/relay.js'
import { reportOutput } from './elrond/report.js'
import { bandRows, debateRows, voiceNote } from './elrond/view.js'
import type { Row } from './elrond/view.js'
import { ruleJson, suggestRule } from './elrond/suggest.js'
import type { Refusal } from './elrond/refusal.js'
import { route } from './elrond/routing.js'
import type { Enabled, Seat } from './elrond/routing.js'
import { ARAGORN_LIMITS, productionHits, sqlOf } from './members/aragorn.js'
import type { SqlPiece } from './members/aragorn.js'
import { requestOf, whoOf } from './members/brief.js'
import type { Brief } from './members/brief.js'
import { formatPreview, INSPECTION_TIMEOUT_MS, MAX_LISTED, planPreview, rangeDiffInspection } from './members/galadriel.js'
import type { Inspection, InspectionResult } from './members/galadriel.js'
import { GANDALF_LIMITS } from './members/gandalf.js'
import { isGimliBlock, keepTail, statusOf, tailOf } from './members/gimli.js'
import type { GimliRun } from './members/gimli.js'
import { patternsWith, scanCall, warnsPasswordFingerprint } from './members/gollum.js'
import { callDiff, LEGOLAS_LIMITS } from './members/legolas.js'
import type { CallDiff, Current } from './members/legolas.js'
import type { GollumFinding } from './members/gollum.js'
import { newNonce, parseVerdict, truncate } from './members/shared.js'
import type { Verdict } from './members/shared.js'
import { redact } from './redact.js'
import type { SecretPattern } from './redact.js'
import { classify, FILE_PATH_FIELDS, SHELL_TOOLS, targetsOf } from './rules/classify.js'
import type { Call, Classification, ClassifyContext, Target } from './rules/classify.js'
import { isInside, relativeTo, resolve } from './rules/paths.js'
import { auditDirsOf, candidateChildren, checksOf, combineClassifications, intersection, scopesTouched, scopeTagOf, unionById, writeDirOf } from './rules/scopes.js'
import {
  addReviewTime,
  addTokens,
  answerChat,
  clearCache,
  clearEpic,
  closeDebate,
  count,
  declineRule,
  forOtherPrompt,
  grantChat,
  holdsChat,
  INITIAL_SESSION,
  isReadable,
  isShadow,
  markDebateOpened,
  noteCheck,
  noteOffer,
  noteVoice,
  noteWritten,
  openDebate,
  resetForPrompt,
  sessionOf,
  tidyCall,
  tidyReason,
  useChat,
  withBypass,
  withEpic,
  withSessionModel,
  withShadow,
} from './state.js'
import type { ChatUse } from './state.js'
import type { CouncilDebate, CouncilSession } from '../types'
import { currentMode, setMode, text, withMode } from './strings.js'
import type { Mode, StringKey } from './strings.js'

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

/**
 * Prompt origins that are a person's own: they reset the per-prompt state, and
 * only they may run the `/council` subcommands that loosen the gate. `sdk` is the
 * host's own turn (`claude -p`, the Agent SDK), not typed at a terminal; the cloud
 * web client arrives as `composer` (DESIGN §14.3).
 */
const HUMAN_ORIGINS: ReadonlySet<string> = new Set(['composer', 'bridge'])

const MAX_SCRIPTS = 3

const COMMAND = 'council'
const PANE_ID = 'council'

/** The debate pane: its own id, so it sits beside the `/council` output as a tab. */
const DEBATE_PANE_ID = 'council-debate'

/** Rows the debate pane asks for where it is placed inline. */
const DEBATE_PANE_ROWS = 12

/** How long the epic drop row and toast last. */
const EPIC_MS = 8_000

/** The `/config` row a `--save` writes, per slot that has one. */
const CONFIG_ROWS: Readonly<Partial<Record<ModelSlot, string>>> = {
  gandalf: 'council-of-elrond.gandalfModel',
  legolas: 'council-of-elrond.legolasModel',
  aragorn: 'council-of-elrond.aragornModel',
  council: 'council-of-elrond.councilModel',
}

/** What the `/config` model picker offers; anything else is session-only. */
const PICKER_OPTIONS: readonly string[] = ['default', 'sonnet', 'opus', 'fable', 'haiku']

/** Git for previews: no locks taken, no prompts, plain output. */
const GIT_ENV: Record<string, string> = { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', LC_ALL: 'C' }

const PROBE_TIMEOUT_MS = 20_000

type Settings = {
  gandalfEnabled: boolean
  gandalfModel: string
  legolasEnabled: boolean
  legolasModel: string
  aragornEnabled: boolean
  aragornModel: string
  councilEnabled: boolean
  councilModel: string
  councilSequential: boolean
  gimliEnabled: boolean
  diffLines: number
  reviewDeadlineSeconds: number
  tokenBudget: number
  auditLogPath: string
  auditMaxKb: number
  shadowMode: boolean
  toolErrorsAreWipes: boolean
  previewLines: number
  gollumEnabled: boolean
  galadrielEnabled: boolean
  plainMode: boolean
}

const modelSetting = (value: unknown): string => (typeof value === 'string' ? value : 'default')

const settingsOf = (options: PluginOptions): Settings => ({
  gandalfEnabled: options.gandalfEnabled !== false,
  gandalfModel: modelSetting(options.gandalfModel),
  legolasEnabled: options.legolasEnabled !== false,
  legolasModel: modelSetting(options.legolasModel),
  aragornEnabled: options.aragornEnabled !== false,
  aragornModel: modelSetting(options.aragornModel),
  councilEnabled: options.councilEnabled !== false,
  councilModel: modelSetting(options.councilModel),
  councilSequential: options.councilSequential === true,
  gimliEnabled: options.gimliEnabled !== false,
  diffLines: typeof options.diffLines === 'number' ? options.diffLines : 200,
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
  plainMode: options.plainMode === true,
})

type Context = {
  loaded: LoadedConfig
  root: string
  /** The root with symbolic links resolved, to map resolved paths back under `root`. */
  realRoot: string
  home?: string
  /** Shipped and configured secret patterns: the scan's, and every redaction's. */
  patterns: readonly SecretPattern[]
  /** C5: the root holds no rules file and no `.git`, so each call looks up the repositories below it. */
  isMulti: boolean
}

/** A rules scope: the session root, or a repository directly below it (C5). */
type Scope = { dir: string; loaded: LoadedConfig; patterns: readonly SecretPattern[] }

/**
 * The context one call is decided in: `root` stays the session root, `loaded` is
 * the deciding scope's, and the rest is what the touched scopes share.
 */
type CallContext = Context & {
  scopes: readonly Scope[]
  /** Where git runs: the deciding scope's directory. */
  gitDir: string
  /** Secrets allowed in every touched scope. */
  allowlist: readonly string[]
  /** Where a rules entry may be written for this call; none when it touched more than one scope or the root alone in a multi-repository root. */
  writeDir: string | undefined
}

type Review =
  | { ok: true; verdict: Verdict; model: string; tokens: number }
  | { ok: false; problem: string; model: string; tokens: number }

// Module state: starts over on every load, as the module does.
let settings: Settings = settingsOf({})
let context: Promise<Context> | undefined
/** C5: one entry per child of the root, a repository's scope or undefined for a plain folder. */
const children = new Map<string, Promise<Scope | undefined>>()
let auditQueue: Promise<void> = Promise.resolve()
/** The folders whose audit `.gitignore` was looked at since the module loaded. */
const gitignoreChecked = new Set<string>()
const warned = new Set<string>()

const wipePolicy = (): WipePolicy => ({ toolErrors: settings.toolErrorsAreWipes })

const enabledMembers = (): Enabled => ({
  gandalf: settings.gandalfEnabled,
  legolas: settings.legolasEnabled,
  aragorn: settings.aragornEnabled,
})

/** The /config row's model for a slot. */
const settingsModel = (slot: ModelSlot): string => {
  switch (slot) {
    case 'gandalf':
      return settings.gandalfModel
    case 'legolas':
      return settings.legolasModel
    case 'aragorn':
      return settings.aragornModel
    case 'council':
      return settings.councilModel
  }
}

function warnOnce($: EngineInterface, key: string, line: string, toast?: string): void {
  if (warned.has(key)) return
  warned.add(key)
  $.ui.log(line)
  if (toast !== undefined) $.ui.toast(toast, { timeoutMs: 8_000 })
}

/** Reads and validates the rules file of one directory; a broken one warns once under `key`. */
async function loadRules($: EngineInterface, dir: string, key: string): Promise<{ loaded: LoadedConfig; hasFile: boolean }> {
  const path = `${dir}/${OVERRIDES_PATH}`
  let fileText: string | undefined
  let readProblem: string | undefined
  const hasFile = await $.fs.exists(path)
  if (hasFile) {
    fileText = await $.fs.read(path).catch((error: unknown) => {
      readProblem = `(file): could not be read: ${error instanceof Error ? error.message : String(error)}`
      return undefined
    })
  }
  const loaded = readProblem !== undefined ? { ...loadConfig(undefined), errors: [readProblem] } : loadConfig(fileText)
  if (loaded.errors.length > 0) {
    warnOnce(
      $,
      key,
      text('notice.configBroken', { path: OVERRIDES_PATH, errors: loaded.errors.join('; ') }),
      text('notice.configBrokenShort'),
    )
  }
  return { loaded, hasFile }
}

async function loadContext($: EngineInterface): Promise<Context> {
  const root = await $.session.root()
  const realRoot = (await $.fs.stat(root, { resolve: true }).catch(() => undefined))?.realPath ?? root
  const home = await $.env.get('HOME')
  const { loaded, hasFile } = await loadRules($, root, 'config')
  // C5: a rules file at the root, or a root that is itself a repository, keeps today's single scope.
  const isMulti = !hasFile && !(await $.fs.exists(`${root}/.git`))
  const patterns = patternsWith(loaded.compiled.config.gollum.patterns)
  return { loaded, root, realRoot, patterns, isMulti, ...(home !== undefined && { home }) }
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

/** A direct child of the root as a scope: a real directory holding `.git` is a repository, anything else is not. */
async function loadChild($: EngineInterface, dir: string): Promise<Scope | undefined> {
  const stat = await $.fs.stat(dir).catch(() => undefined)
  if (stat === undefined || stat.isLink || stat.kind !== 'dir') return undefined
  if (!(await $.fs.exists(`${dir}/.git`))) return undefined
  const { loaded } = await loadRules($, dir, `config:${dir}`)
  return { dir, loaded, patterns: patternsWith(loaded.compiled.config.gollum.patterns) }
}

/** The scope of a child directory of the root, or undefined when it is not a repository. Cached, negatives too; a failed load is not. */
function childScope($: EngineInterface, dir: string): Promise<Scope | undefined> {
  let entry = children.get(dir)
  if (entry === undefined) {
    const loading: Promise<Scope | undefined> = loadChild($, dir).catch((error: unknown) => {
      if (children.get(dir) === loading) children.delete(dir)
      throw error
    })
    entry = loading
    children.set(dir, entry)
  }
  return entry
}

const rootScopeOf = (ctx: Context): Scope => ({ dir: ctx.root, loaded: ctx.loaded, patterns: ctx.patterns })

/** The scopes a call touches, in order (DESIGN §14.5); the root scope alone when the lookup is off. */
async function scopesOf($: EngineInterface, ctx: Context, targets: readonly Target[]): Promise<Scope[]> {
  const rootScope = rootScopeOf(ctx)
  if (!ctx.isMulti) return [rootScope]
  const candidates = candidateChildren(targets, ctx.root)
  const found = await Promise.all(candidates.map(dir => childScope($, dir)))
  const repositories = new Map<string, Scope>()
  candidates.forEach((dir, index) => {
    const scope = found[index]
    if (scope !== undefined) repositories.set(dir, scope)
  })
  return scopesTouched(targets, ctx.root, new Set(repositories.keys())).map(dir => repositories.get(dir) ?? rootScope)
}

/** The context for the scopes a call touched; `index` is the deciding one. */
function callContextOf(ctx: Context, scopes: readonly Scope[], index: number): CallContext {
  const deciding = scopes[index] ?? rootScopeOf(ctx)
  const dirs = scopes.map(scope => scope.dir)
  return {
    ...ctx,
    loaded: deciding.loaded,
    patterns: scopeTagOf(dirs, ctx.root) === '' ? ctx.patterns : unionById([ctx.patterns, ...scopes.map(scope => scope.patterns)]),
    scopes,
    gitDir: deciding.dir,
    allowlist: intersection(scopes.map(scope => scope.loaded.compiled.config.gollum.allowlist)),
    writeDir: writeDirOf(dirs, ctx.root, ctx.isMulti),
  }
}

/** The classification of a call across the scopes it touches: the strictest wins (DESIGN §14.5). */
async function classifyIn(
  $: EngineInterface,
  ctx: Context,
  call: Call,
  where: ClassifyContext,
): Promise<{ classification: Classification; ctx: CallContext }> {
  const scopes = await scopesOf($, ctx, targetsOf(call, where))
  const { classification, index } = combineClassifications(scopes.map(scope => classify(call, scope.loaded.compiled, { ...where, root: scope.dir })))
  return { classification, ctx: callContextOf(ctx, scopes, index) }
}

/** The scope of the session's working directory: its repository, else the root's. For `/council` and the start suggestion. */
async function cwdScopeOf($: EngineInterface, ctx: Context): Promise<Scope> {
  const [scope] = await scopesOf($, ctx, [{ path: await $.session.cwd(), isWorkingDir: true }])
  return scope ?? rootScopeOf(ctx)
}

/** The root's context seen through one scope's config, for the `/council` subcommands. */
const inScope = (ctx: Context, scope: Scope): Context =>
  scope.dir === ctx.root ? ctx : { ...ctx, loaded: scope.loaded, patterns: unionById([ctx.patterns, scope.patterns]) }

/** Reads the rules again (decision 9: after the mod's own writes, and on `/council reload`): the root's and every repository's. */
async function reloadContext($: EngineInterface): Promise<Context> {
  context = undefined
  children.clear()
  for (const key of [...warned]) if (key === 'config' || key.startsWith('config:')) warned.delete(key)
  const fresh = await contextOf($)
  await update($, session, value => clearCache(sessionOf(value)))
  return fresh
}

/** The context seen through the session's working directory's scope, for the `/council` subcommands. */
async function cwdContextOf($: EngineInterface): Promise<Context> {
  const ctx = await contextOf($)
  return inScope(ctx, await cwdScopeOf($, ctx))
}

/** After the mod wrote a rules file in `dir`: the root's context, or that repository's entry alone. */
async function reloadAt($: EngineInterface, ctx: Context, dir: string): Promise<void> {
  if (dir === ctx.root) await reloadContext($)
  else await reloadScope($, dir)
}

/** After the mod wrote a repository's rules file: that entry alone is read again. */
async function reloadScope($: EngineInterface, dir: string): Promise<void> {
  children.delete(dir)
  warned.delete(`config:${dir}`)
  await childScope($, dir)
  await update($, session, value => clearCache(sessionOf(value)))
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
 * Runs one git inspection from the table: its argv, then, only if that exits
 * non-zero or throws and the table gives one, its fixed `orElse` argv, once.
 * The fallback's result (and label) stands only if it succeeds; otherwise the
 * first attempt's outcome is kept, as if there were no fallback.
 */
async function runGitInspection(
  $: EngineInterface,
  step: { label: string; argv: readonly string[]; orElse?: { label: string; argv: readonly string[] } },
  ctx: CallContext,
): Promise<{ label: string; run: ProcessRunResult }> {
  const attempt = (argv: readonly string[]): Promise<ProcessRunResult> => $.process.run(argv, { cwd: ctx.gitDir, env: GIT_ENV, timeoutMs: INSPECTION_TIMEOUT_MS })
  let first: ProcessRunResult | undefined
  let failure: unknown
  try {
    first = await attempt(step.argv)
    if (first.exitCode === 0 || step.orElse === undefined) return { label: step.label, run: first }
  } catch (error) {
    if (step.orElse === undefined) throw error
    failure = error
  }
  try {
    const second = await attempt(step.orElse.argv)
    if (second.exitCode === 0) return { label: step.orElse.label, run: second }
  } catch {
    // The fallback failing leaves the first attempt's outcome.
  }
  if (first === undefined) throw failure
  return { label: step.label, run: first }
}

/**
 * Runs Galadriel's inspections: only what the table planned, read-only, each
 * on its own timeout. A failure is no preview, never a decision.
 */
async function previewOf($: EngineInterface, plan: readonly Inspection[], ctx: CallContext): Promise<string | undefined> {
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
        const { label, run } = await runGitInspection($, step, ctx)
        results.push({ kind: 'git', label, exitCode: run.exitCode, stdout: run.stdout.slice(0, 50_000) })
      }
    } catch {
      results.push({ kind: 'failed', label: step.label })
    }
  }
  const preview = formatPreview(results, settings.previewLines)
  return preview === undefined ? undefined : redact(preview, ctx.patterns)
}

/**
 * What a file tool would change, as a diff against the file as it stands,
 * redacted. Reading the file is the only I/O; nothing runs.
 */
async function fileDiffOf($: EngineInterface, call: Call, cwd: string, realPath: string | undefined, ctx: Context): Promise<{ path: string; diff: CallDiff } | undefined> {
  const field = FILE_PATH_FIELDS[call.tool]
  const given = field === undefined ? undefined : call.input[field]
  if (field === undefined) return undefined
  if (typeof given !== 'string') return { path: '(no path)', diff: callDiff(call, '(no path)', { state: 'unreadable' }, settings.diffLines) }
  const absolute = realPath ?? resolve(given, cwd, ctx.home)
  const path = relativeTo(absolute, ctx.root) || absolute
  let current: Current
  if (!(await $.fs.exists(absolute).catch(() => true))) {
    current = { state: 'missing' }
  } else {
    const content = await $.fs.read(absolute).catch(() => undefined)
    current = typeof content === 'string' ? { state: 'text', text: content } : { state: 'unreadable' }
  }
  const diff = callDiff(call, path, current, settings.diffLines)
  return { path, diff: { ...diff, diff: redact(diff.diff, ctx.patterns) } }
}

/** The `.sql` files a database call names, read when they sit inside the project, redacted and cut. */
async function sqlFilesOf($: EngineInterface, files: readonly { word: string; cwd?: string }[], cwd: string, ctx: Context): Promise<SqlPiece[]> {
  const pieces: SqlPiece[] = []
  for (const file of files) {
    const path = resolve(file.word.replace(/^['"]|['"]$/g, ''), file.cwd ?? cwd, ctx.home)
    if (!isInside(path, ctx.root)) continue
    // Inside by name is not enough: a link may land outside the project.
    const real = (await $.fs.stat(path, { resolve: true }).catch(() => undefined))?.realPath
    if (real === undefined || !isInside(real, ctx.realRoot)) continue
    const content = await $.fs.read(real).catch(() => undefined)
    if (typeof content === 'string') {
      pieces.push({ label: relativeTo(path, ctx.root) ?? path, text: redact(truncate(content, ARAGORN_LIMITS.sqlLines, ARAGORN_LIMITS.sqlChars), ctx.patterns) })
    }
  }
  return pieces
}

/** What the seated member is given: the context its profile asks for, and nothing else. */
async function briefOf(
  $: EngineInterface,
  seat: Seat,
  call: Call,
  classification: Classification,
  cwd: string,
  realPath: string | undefined,
  state: CouncilSession,
  preview: string | undefined,
  ctx: Context,
): Promise<Brief> {
  const ruleReasons = [...new Set(classification.findings.map(finding => finding.reason))]
  const shown = callText(call, ctx.patterns)
  const latestPrompt = state.latestPrompt
  const withPreview = preview !== undefined ? { preview } : {}
  // Routing seats the diff reviewer on file tools only, which always have a diff.
  const file = seat.member === 'gandalf' || seat.profile === 'git' ? undefined : await fileDiffOf($, call, cwd, realPath, ctx)
  if (seat.member === 'legolas' && file !== undefined) {
    return { member: 'legolas', context: { tool: call.tool, path: file.path, diff: file.diff, ruleReasons, latestPrompt, ...withPreview } }
  }
  if (seat.member === 'aragorn' && seat.profile === 'git') {
    return {
      member: 'aragorn',
      profile: 'git',
      context: { tool: call.tool, call: shown, ruleReasons, latestPrompt, protectedBranches: ctx.loaded.compiled.config.protectedBranches, ...withPreview },
    }
  }
  if (seat.member === 'aragorn') {
    const found = sqlOf(classification)
    const inline = found.inline.map(piece => ({ label: piece.label, text: redact(piece.text, ctx.patterns) }))
    const sql = [...inline, ...(await sqlFilesOf($, found.files, cwd, ctx))]
    const production = productionHits([shown, ...sql.map(piece => piece.text)].join('\n'), ctx.loaded.compiled.production)
    return {
      member: 'aragorn',
      profile: 'database',
      context: { tool: call.tool, call: shown, ruleReasons, latestPrompt, sql, production, ...(file !== undefined && { diff: file.diff }) },
    }
  }
  const scripts = await scriptsOf($, classification, cwd, state.written, ctx)
  return { member: 'gandalf', context: { tool: call.tool, call: shown, ruleReasons, latestPrompt, scripts, ...withPreview } }
}

/**
 * One model review, for any member: its own system prompt and prompt, the
 * model's request settings, a deadline passed as the call's own timeout,
 * and the strict verdict parse. Every failure is a review without a verdict.
 */
async function review($: EngineInterface, brief: Brief, model: string, deadlineMs: number, signal: AbortSignal): Promise<Review> {
  const nonce = newNonce()
  const request = requestOf(brief, nonce)
  const limits = profileOf(model)
  const who = text(whoOf(brief.member, brief.profile))
  try {
    const reply = await $.model.complete(
      {
        model,
        system: request.system,
        prompt: request.prompt,
        maxTokens: limits.maxTokens,
        ...(limits.effort !== undefined && { effort: limits.effort }),
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
        warnOnce($, `model:${model}`, text('notice.modelFailed', { who, model, problem }))
      }
      return { ok: false, problem, model, tokens }
    }
    const parsed = parseVerdict(reply.text)
    return parsed.ok
      ? { ok: true, verdict: parsed.verdict, model, tokens }
      : { ok: false, problem: `malformed verdict: ${parsed.problem}`, model, tokens }
  } catch (error) {
    const problem = `the request was refused: ${error instanceof Error ? error.message : String(error)}`
    warnOnce($, `model:${model}`, text('notice.modelFailed', { who, model, problem }))
    return { ok: false, problem, model, tokens: 0 }
  }
}

/** The checked-out branch, for whether a merge lands on a protected one; unknown on any failure. */
async function currentBranchOf($: EngineInterface, dir: string): Promise<string | undefined> {
  try {
    const run = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, env: GIT_ENV, timeoutMs: INSPECTION_TIMEOUT_MS })
    const branch = run.stdout.trim()
    return run.exitCode === 0 && branch !== '' ? branch : undefined
  } catch {
    return undefined
  }
}

/**
 * What a push would send or a merge bring in, for the diff reviewer: one
 * read-only `git diff` from Galadriel's table, cut to the diff limit and
 * redacted, with the range that was read (the table's fallback range when the
 * first can't be read). Undefined when git can't say.
 */
async function rangeDiffOf($: EngineInterface, step: Extract<Inspection, { kind: 'git' }>, ctx: CallContext): Promise<{ label: string; diff: string } | undefined> {
  try {
    const { label, run } = await runGitInspection($, step, ctx)
    if (run.exitCode !== 0) return undefined
    const diff = run.stdout.slice(0, LEGOLAS_LIMITS.diffChars * 4).trimEnd()
    return { label, diff: redact(truncate(diff === '' ? '(no changes)' : diff, settings.diffLines, LEGOLAS_LIMITS.diffChars), ctx.patterns) }
  } catch {
    return undefined
  }
}

/**
 * Runs one of the project's checks from a rules file, by argument vector,
 * in the directory of the scope that lists it. Its own timeout ends it (a clock timer, which costs
 * the hook no budget while the child's output is awaited); so does `stop`
 * once the council has blocked, and Esc, through the dispatch's signal.
 */
async function runCheck($: EngineInterface, command: GimliCommand, dir: string, stop: AbortSignal): Promise<GimliRun> {
  const started = await $.clock.now()
  let ended: 'timeout' | 'stopped' | undefined
  let exit: ProcessSpawnResult | undefined
  let output = ''
  let isEnded: () => void = () => undefined
  const endedEarly = new Promise<void>(resolve => {
    isEnded = resolve
  })
  const stream = $.process.spawn({ argv: command.argv, cwd: dir })
  const end = (why: 'timeout' | 'stopped'): void => {
    if (ended !== undefined || exit !== undefined) return
    ended = why
    isEnded()
    // Ending the loop is what kills the child.
    void stream.return(undefined as never).catch(() => undefined)
  }
  const timer = $.clock.after(command.timeoutMs, () => end('timeout'))
  const onStop = (): void => end('stopped')
  stop.addEventListener('abort', onStop)
  if (stop.aborted) onStop()
  const reading = (async () => {
    for await (const chunk of stream) output = keepTail(output, chunk.text)
    if (ended === undefined) exit = await stream.result
  })().catch(() => {
    // It could not start, or its stream broke: no exit code, so it does not pass.
  })
  try {
    // Ended early, the run is over even if the stream is slow to close.
    await Promise.race([reading, endedEarly])
  } finally {
    timer.cancel()
    stop.removeEventListener('abort', onStop)
  }
  const ms = (await $.clock.now()) - started
  return {
    name: command.name,
    status: statusOf(ended, exit),
    ...(ended === undefined && exit !== undefined && { code: exit.code, signal: exit.signal }),
    tail: tailOf(output),
    ms,
  }
}

/** One seat at the full council: who, and the brief it reviews (none: it sits out, saying why). */
type Sitting = { seat: CouncilSeat; who: StringKey; brief?: Brief; skip?: string }

type Held = { voices: Voice[]; tokens: number[]; runs: GimliRun[] }

/** What `convene` reports as it goes, for the debate record: a voice resolved, or a check ended. */
type Progress = { kind: 'voice'; index: number; voice: Voice } | { kind: 'check'; run: GimliRun }

/**
 * The full council. The project's checks start first and run on their own
 * timeouts (decision 3); the model members run in parallel, or one at a time
 * stopping at the first block, under one shared deadline passed to each
 * request as the time remaining. Each member sees only its own brief.
 */
async function convene(
  $: EngineInterface,
  sittings: readonly Sitting[],
  model: string,
  deadlineMs: number,
  isSequential: boolean,
  checks: readonly { command: GimliCommand; dir: string }[],
  signal: AbortSignal,
  progress: (event: Progress) => Promise<void>,
): Promise<Held> {
  const started = await $.clock.now()
  const stop = new AbortController()
  // Esc ends the checks through the engine killing their children; chaining the signal makes that ours too.
  const onAbort = (): void => stop.abort()
  signal.addEventListener('abort', onAbort)
  if (signal.aborted) onAbort()
  try {
    let isCheckFailed = false
    // The debate record is only watching: a note that fails or lags changes nothing here.
    const noted: Promise<void>[] = []
    const note = (event: Progress): void => {
      noted.push(Promise.resolve().then(() => progress(event)).catch(() => undefined))
    }
    const checking = Promise.all(
      checks.map(check =>
        runCheck($, check.command, check.dir, stop.signal).then(run => {
          if (isGimliBlock(run)) {
            isCheckFailed = true
            stop.abort()
          }
          note({ kind: 'check', run })
          return run
        }),
      ),
    )
    const tokens: number[] = sittings.map(() => 0)
    const baseOf = (sitting: Sitting) => ({ who: sitting.who, member: sitting.seat.member, ...(sitting.seat.member === 'aragorn' && { profile: sitting.seat.profile }) })
    const ask = async (sitting: Sitting, index: number): Promise<Voice> => {
      const base = baseOf(sitting)
      if (sitting.brief === undefined) return { kind: 'skipped', ...base, why: sitting.skip ?? '' }
      const remaining = Math.floor(deadlineMs - ((await $.clock.now()) - started))
      if (remaining < 1) return { kind: 'failed', ...base, problem: text('council.deadline') }
      const result = await review($, sitting.brief, model, remaining, signal)
      tokens[index] = result.tokens
      return result.ok ? { kind: 'verdict', ...base, verdict: result.verdict } : { kind: 'failed', ...base, problem: result.problem }
    }
    const resolved = (index: number, voice: Voice): Voice => {
      note({ kind: 'voice', index, voice })
      return voice
    }
    let voices: Voice[]
    if (isSequential) {
      voices = []
      for (const [index, sitting] of sittings.entries()) {
        const isBlocked = isCheckFailed || voices.some(voice => voice.kind === 'failed' || (voice.kind === 'verdict' && voice.verdict.verdict === 'block'))
        voices.push(
          resolved(index, isBlocked ? { kind: 'skipped', ...baseOf(sitting), why: text('council.stopped') } : await ask(sitting, index)),
        )
      }
    } else {
      voices = await Promise.all(sittings.map(async (sitting, index) => resolved(index, await ask(sitting, index))))
    }
    // A check can only add a block: once a member has blocked, one still running cannot matter.
    if (hasRealBlock(voices)) stop.abort()
    const runs = await checking
    await Promise.all(noted)
    return { voices, tokens, runs }
  } finally {
    // A throw above would otherwise leave a check running to its own timeout (up to 600 s).
    stop.abort()
    signal.removeEventListener('abort', onAbort)
  }
}

/** Puts the call to the user; where nobody can be asked, says so. */
async function escalate($: EngineInterface, question: string, withAllowlist: boolean): Promise<Answer | Unanswered> {
  const surfaces = await $.session.surfaces()
  if (surfaces.length === 0) return 'unavailable'
  try {
    // One mode for the labels offered and the labels compared: they must match exactly.
    const mode = currentMode()
    const answer = await $.ui.ask(question, { options: optionsOf(mode, withAllowlist), header: text('ask.rollHeader', {}, mode) })
    return interpretAnswer(answer, mode, withAllowlist)
  } catch {
    // The engine's "Chat about this" rejects exactly like a dismissal and cannot be told apart (DESIGN §12.4).
    return 'dismissed'
  }
}

/** The second confirm before an allowlist entry is written: only "Add it" adds. */
async function confirmAllowlist($: EngineInterface, finding: GollumFinding): Promise<boolean> {
  const base = text('ask.confirmAllowlist', { label: finding.label, entry: finding.fingerprint, path: OVERRIDES_PATH, field: 'gollum.allowlist' })
  const question = warnsPasswordFingerprint(finding) ? `${base}\n${text('ask.confirmAllowlistPassword')}` : base
  try {
    const answer = await $.ui.ask(question, { options: [text('ask.confirmAdd'), text('ask.confirmCancel')], header: text('ask.header') })
    return answer === text('ask.confirmAdd')
  } catch {
    return false
  }
}

/**
 * Rewrites the project rules file with one confirmed change, read fresh: a
 * broken file is left alone, and a result that doesn't validate isn't written.
 */
async function writeOverrides($: EngineInterface, root: string, change: (current: string | undefined) => FileEdit): Promise<FileEdit> {
  const path = `${root}/${OVERRIDES_PATH}`
  try {
    const current = (await $.fs.exists(path)) ? await $.fs.read(path) : undefined
    const edit = change(current)
    if (edit.ok) await $.fs.write(path, edit.text)
    return edit
  } catch (error) {
    return { ok: false, problem: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * After "allow once" and a call that ran: offers the allow rule for it, showing
 * the exact JSON, and writes it only on "Add the rule" (then reloads, decision
 * 9). Any other answer, or dismissing, declines it for the session. Returns the
 * id of the rule written. `where` is the single scope's (its root is `dir`), and
 * the rule goes to the rules file in `dir`.
 */
async function offerRule(
  $: EngineInterface,
  call: Call,
  classification: Classification,
  where: ClassifyContext,
  ctx: Context,
  hadSecret: boolean,
  dir: string,
): Promise<string | undefined> {
  const state = sessionOf(await read($, session))
  const suggested = suggestRule(call, classification, ctx.loaded.compiled, where, { hadSecret, declined: state.declinedRules })
  if (suggested.kind === 'none') return undefined
  const { rule, key } = suggested.suggestion
  if ((await $.session.surfaces()).length === 0) return undefined
  const question = text('ask.suggestRule', { path: OVERRIDES_PATH, json: ruleJson(rule) })
  const answer = await $.ui
    .ask(question, { options: [text('ask.suggestAdd'), text('ask.suggestDecline')], header: text('ask.header') })
    .catch(() => undefined)
  if (answer !== text('ask.suggestAdd')) {
    await update($, session, value => declineRule(sessionOf(value), key))
    return undefined
  }
  const written = await writeOverrides($, dir, current => withRule(current, rule))
  if (!written.ok) {
    $.ui.log(text('notice.ruleFailed', { problem: written.problem }))
    return undefined
  }
  await reloadAt($, ctx, dir)
  $.ui.log(text('notice.ruleWritten', { id: rule.id, path: OVERRIDES_PATH }))
  return rule.id
}

async function appendAudit($: EngineInterface, record: AuditRecord, root: string): Promise<void> {
  const path = resolve(settings.auditLogPath, root)
  const folder = path.slice(0, path.lastIndexOf('/'))
  if (!gitignoreChecked.has(folder)) {
    gitignoreChecked.add(folder)
    const ignore = `${folder}/.gitignore`
    if (isInside(path, root) && !(await $.fs.exists(ignore))) await $.fs.write(ignore, AUDIT_GITIGNORE)
  }
  const line = auditLine(record)
  const current = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
  const maxBytes = settings.auditMaxKb * 1024
  const older: (string | undefined)[] = []
  if (isRotation(current, line, maxBytes)) {
    for (let n = 1; n < ROTATED_FILES - 1; n++) {
      const rotated = `${path}.${n}`
      older.push((await $.fs.exists(rotated)) ? await $.fs.read(rotated) : undefined)
    }
  }
  for (const write of appendPlan(path, current, line, maxBytes, older)) await $.fs.write(write.path, write.text)
}

/**
 * Queues one audit line for each of `dirs` (the call's repositories, else the
 * root: DESIGN §14.5). Writes run in order, but nobody waits for them: a
 * failed write is logged and a hanging one holds back only the lines queued
 * after it, never a decision or the call that follows.
 */
function audit($: EngineInterface, record: AuditRecord, dirs: readonly string[]): void {
  for (const dir of dirs) {
    auditQueue = auditQueue
      .then(() => appendAudit($, record, dir))
      .catch((error: unknown) => {
        $.ui.log(text('notice.auditFailed', { problem: error instanceof Error ? error.message : String(error) }), { to: 'debug' })
      })
  }
}

/** Notes a file Claude wrote, once the write has run. */
async function noteWrite($: EngineInterface, call: Call, cwd: string, home: string | undefined, result: ToolCallResult): Promise<void> {
  const field = FILE_PATH_FIELDS[call.tool]
  const given = field === undefined ? undefined : call.input[field]
  const isWritten = typeof given === 'string' && result.deny === undefined && result.isError !== true
  if (isWritten) await update($, session, value => noteWritten(sessionOf(value), resolve(given, cwd, home)))
}

/**
 * The label by the prompt where SessionMode is not drawn (other surfaces): the
 * status line. Cleared when no such surface is left, so a line set for a phone
 * does not outlive it.
 */
async function syncIndicator($: EngineInterface): Promise<void> {
  const state = sessionOf(await read($, session))
  const label = state.bypass ? text('mode.bypass') : isShadow(state, settings.shadowMode) ? text('mode.shadow') : undefined
  const surfaces = await $.session.surfaces()
  $.ui.status(surfaces.some(surface => surface !== 'terminal' && surface !== 'desktop') ? label : undefined)
}

/**
 * Where nothing draws, the start notice goes in as a row the model reads (the
 * only channel to the person). A refusal or a failure is logged, never raised:
 * session start goes on.
 */
async function announce($: EngineInterface): Promise<void> {
  try {
    if ((await $.session.surfaces()).length > 0) return
    const result = await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: noticeText() }] } })
    if (result.deny !== undefined) $.ui.log(text('notice.appendFailed', { problem: result.deny }), { to: 'debug' })
  } catch (error) {
    $.ui.log(text('notice.appendFailed', { problem: error instanceof Error ? error.message : String(error) }), { to: 'debug' })
  }
}

/**
 * `/council` output as the command's `context`, for a person's command where
 * nothing draws; else undefined. It is built again, in plain (nothing Claude
 * reads is themed) and, for rules, without the allowlist's characters; every
 * line is then redacted (relay.ts).
 */
async function relayOf($: EngineInterface, command: CouncilCommand, origin: string): Promise<readonly string[] | undefined> {
  if (!isRelayed(command) || !HUMAN_ORIGINS.has(origin)) return undefined
  if ((await $.session.surfaces()).length > 0) return undefined
  const ctx = await contextOf($)
  return [relayContext(command, await councilOutput($, command, 'plain'), ctx.patterns, newNonce())]
}

/** Shows `/council` output to the user: in its pane where one draws, else as transcript lines. */
async function show($: EngineInterface, output: Output): Promise<void> {
  const surfaces = await $.session.surfaces()
  if (surfaces.length > 0) {
    await update($, panel, () => output)
    const opened = await $.ui.open({ id: PANE_ID, title: output.title }).catch(() => undefined)
    if (opened?.isPlaced === true) return
  }
  $.ui.log(output.title)
  for (const line of output.lines) $.ui.log(line)
}

/** Rows as a column of Text: a theme key for colour, never a raw colour, so a theme change reaches them. */
function drawRows(Box: Parameters<typeof h>[0], Text: Parameters<typeof h>[0], rows: readonly Row[], wrap: 'wrap' | 'truncate'): RenderElement {
  const lines = rows.map(row =>
    h(Text, { wrap, ...(row.color !== undefined && { color: row.color }), ...(row.bold === true && { bold: true }), ...(row.dim === true && { dimColor: true }) }, row.text),
  )
  return h(Box, { flexDirection: 'column' }, ...lines) as RenderElement
}

/**
 * Opens the debate pane unasked, once per session: the engine itself keeps an
 * unasked open undrawn below 144 columns, so the mod never measures the terminal.
 * A refused open is ignored; it is never retried.
 */
async function openDebatePane($: EngineInterface): Promise<void> {
  if (sessionOf(await read($, session)).debateOpened) return
  // Claimed before the open, so a parallel call does not open it too.
  await update($, session, value => markDebateOpened(sessionOf(value)))
  if ((await $.session.surfaces()).length === 0) return
  await $.ui.open({ id: DEBATE_PANE_ID, title: text('debate.title'), rows: DEBATE_PANE_ROWS }).catch(() => undefined)
}

/** `/council debate`: the pane at any width (it answers the person's command), else the same rows as transcript lines. */
async function showDebate($: EngineInterface): Promise<void> {
  const surfaces = await $.session.surfaces()
  if (surfaces.length > 0) {
    const opened = await $.ui.open({ id: DEBATE_PANE_ID, title: text('debate.title'), rows: DEBATE_PANE_ROWS }).catch(() => undefined)
    if (opened?.isPlaced === true) return
  }
  $.ui.log(text('debate.title'))
  for (const row of debateRows(sessionOf(await read($, session)), undefined, currentMode())) $.ui.log(row.text)
}

/**
 * The epic drop (themed mode, a pushed or merged call the full council
 * approved): the row hides itself once `epicUntil` passes, whatever happens to
 * the timer, which is only a redraw trigger (a hot reload cancels it).
 */
async function epicDrop($: EngineInterface): Promise<void> {
  const until = (await $.clock.now()) + EPIC_MS
  await update($, session, value => withEpic(sessionOf(value), until))
  $.ui.toast(text('epic.toast'), { timeoutMs: EPIC_MS })
  $.clock.after(EPIC_MS + 100, () => {
    void (async () => {
      try {
        const now = await $.clock.now()
        await update($, session, value => clearEpic(sessionOf(value), now))
      } catch {
        // The row hides itself at its time anyway.
      }
    })()
  })
}

/** `/council report`: the rotated files (oldest first), then the current one; an unreadable file is named and left out. */
async function reportFrom($: EngineInterface, path: string, mode?: Mode): Promise<Output> {
  const files: string[] = []
  const unreadable: string[] = []
  for (const file of [...Array.from({ length: ROTATED_FILES - 1 }, (_, i) => `${path}.${ROTATED_FILES - 1 - i}`), path]) {
    try {
      if (await $.fs.exists(file)) files.push(await $.fs.read(file))
    } catch (error) {
      unreadable.push(`${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return mode === undefined ? reportOutput(files, unreadable) : withMode(mode, () => reportOutput(files, unreadable))
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
    settings: settingsModel(slot),
    ...(project !== undefined && { project }),
    ...(sessionModel !== undefined && { session: sessionModel }),
  })
}

/** The project checks a call would run: every touched scope's, each in its own directory (empty when Gimli is off). */
const checksIn = (ctx: CallContext): { command: GimliCommand; dir: string }[] =>
  settings.gimliEnabled ? checksOf(ctx.scopes.map(scope => ({ dir: scope.dir, commands: scope.loaded.compiled.config.gimli.commands }))) : []

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

/**
 * The output of one subcommand. The `$` reads come first; the pure builders then
 * run in `mode` when one is given (the copy Claude reads is built in plain). A
 * mode is given only for that copy, so it also hides the allowlist entries.
 */
async function councilOutput($: EngineInterface, command: Exclude<CouncilCommand, { kind: 'debate' }>, mode?: Mode): Promise<Output> {
  const title = text('cmd.title')
  // Synchronous builders only: nothing that reads `$` goes inside.
  const inMode = (build: () => Output): Output => (mode === undefined ? build() : withMode(mode, build))
  switch (command.kind) {
    case 'status': {
      const ctx = await contextOf($)
      const state = sessionOf(await read($, session))
      const runMode = state.bypass ? 'bypass' : isShadow(state, settings.shadowMode) ? 'shadow' : 'enforcing'
      const input: StatusInput = {
        session: state,
        mode: runMode,
        members: {
          gandalf: { enabled: settings.gandalfEnabled, choice: modelChoice('gandalf', ctx, state.models) },
          legolas: { enabled: settings.legolasEnabled, choice: modelChoice('legolas', ctx, state.models) },
          aragorn: { enabled: settings.aragornEnabled, choice: modelChoice('aragorn', ctx, state.models) },
        },
        council: { enabled: settings.councilEnabled, choice: modelChoice('council', ctx, state.models), sequential: settings.councilSequential },
        gimli: { enabled: settings.gimliEnabled, commands: ctx.loaded.compiled.config.gimli.commands.length },
        gollumEnabled: settings.gollumEnabled,
        galadrielEnabled: settings.galadrielEnabled,
        tokenBudget: settings.tokenBudget,
      }
      return inMode(() => statusOutput(input))
    }
    case 'bypass':
      await update($, session, value => withBypass(sessionOf(value), command.on))
      await syncIndicator($)
      return inMode(() => ({ title, lines: [text(command.on ? 'cmd.bypassOn' : 'cmd.bypassOff')] }))
    case 'shadow':
      await update($, session, value => withShadow(sessionOf(value), command.on))
      await syncIndicator($)
      return inMode(() => ({ title, lines: [text(command.on ? 'cmd.shadowOn' : 'cmd.shadowOff')] }))
    case 'log': {
      const path = resolve(settings.auditLogPath, (await cwdScopeOf($, await contextOf($))).dir)
      try {
        const logText = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
        return inMode(() => logOutput(logText, command.count))
      } catch (error) {
        const problem = error instanceof Error ? error.message : String(error)
        return inMode(() => ({ title, lines: [text('cmd.logUnreadable', { problem })] }))
      }
    }
    case 'rules': {
      const ctx = await cwdContextOf($)
      return inMode(() => rulesOutput(ctx.loaded.compiled, ctx.loaded.origin, ctx.loaded.errors, mode !== undefined))
    }
    case 'test': {
      // Classification only: nothing the command names is run or read. The directories below the root
      // it names are looked at, as for a real call, to know which repositories it touches.
      const root = await contextOf($)
      const cwd = await $.session.cwd()
      const call: Call = { tool: 'Bash', input: { command: command.command } }
      const where = { root: root.root, cwd, ...(root.home !== undefined && { home: root.home }) }
      const { classification, ctx } = await classifyIn($, root, call, where)
      const operation = classification.tier === 'allow' ? undefined : operationOf(call, classification, where)
      const state = sessionOf(await read($, session))
      const seated = classification.tier === 'review' ? route(call, classification, enabledMembers()) : undefined
      const reviewer =
        seated === undefined
          ? undefined
          : { route: seated, ...(seated.kind === 'member' && { choice: modelChoice(seated.member, ctx, state.models) }) }
      // The current branch is not read: a merge counts as one into a protected branch.
      const big = bigOperationOf(classification, ctx.loaded.compiled)
      const council =
        big === undefined
          ? undefined
          : {
              big,
              enabled: settings.councilEnabled,
              seats: councilSeats(call, classification, enabledMembers(), { ranges: settings.galadrielEnabled }),
              choice: modelChoice('council', ctx, state.models),
              checks: settings.gimliEnabled ? checksIn(ctx).map(check => check.command.name) : [],
              isBranchAssumed: big.entry === 'merge-to-protected' && needsCurrentBranch(classification, ctx.loaded.compiled),
            }
      const typed = redact(command.command, ctx.patterns)
      return inMode(() => testOutput(typed, classification, operation, reviewer, council))
    }
    case 'models': {
      const ctx = await cwdContextOf($)
      const state = sessionOf(await read($, session))
      const choices = Object.fromEntries(MODEL_SLOTS.map(slot => [slot, modelChoice(slot, ctx, state.models)])) as Record<ModelSlot, ModelChoice>
      return inMode(() => modelsOutput(choices))
    }
    case 'model':
      return councilModel($, command)
    case 'reload': {
      const ctx = await reloadContext($)
      return inMode(() => {
        const lines = [text('cmd.reloaded', { count: ctx.loaded.compiled.rules.length, origin: ctx.loaded.origin })]
        if (ctx.loaded.errors.length > 0) lines.push(text('cmd.configErrors', { errors: ctx.loaded.errors.join('; ') }))
        return { title, lines }
      })
    }
    case 'report': {
      const scope = await cwdScopeOf($, await contextOf($))
      return reportFrom($, resolve(settings.auditLogPath, scope.dir), mode)
    }
    case 'usage':
      return inMode(() => ({ title, lines: [text(command.key, command.params ?? {}), ...(command.key === 'cmd.unknown' ? [text('cmd.help')] : [])] }))
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

export const register: Register = (on, options) => {
  settings = settingsOf(options)
  setMode(settings.plainMode ? 'plain' : 'themed')

  on('session.start', async ($, e, next) => {
    const ctx = await contextOf($).catch(() => undefined)
    await $.command
      .register({
        name: COMMAND,
        description: text('cmd.description'),
        argumentHint: text('cmd.argumentHint'),
      })
      .catch((error: unknown) => {
        $.ui.log(text('notice.commandFailed', { problem: error instanceof Error ? error.message : String(error) }))
      })
    // Decision 6: suggest shadow mode once, while the council has logged nothing.
    if (ctx !== undefined && !isShadow(sessionOf(await read($, session)), settings.shadowMode)) {
      const dir = (await cwdScopeOf($, ctx).catch(() => undefined))?.dir ?? ctx.root
      const isEmpty = !(await $.fs.exists(resolve(settings.auditLogPath, dir)).catch(() => true))
      if (isEmpty) warnOnce($, 'shadow-suggest', text('notice.shadowSuggest'), text('notice.shadowSuggest'))
    }
    await syncIndicator($).catch(() => undefined)
    await announce($)
    return next(e)
  })

  // The status line follows the roster: a surface that leaves takes its label with it.
  on('session.detach', async ($, e, next) => {
    const result = await next(e)
    // At the end of the session this runs inside a short bound: skip it.
    if (e.reason !== 'end') await syncIndicator($).catch(() => undefined)
    return result
  })

  on('session.attach', async ($, e, next) => {
    const result = await next(e)
    await syncIndicator($).catch(() => undefined)
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    // `/council` never asks the model, so it is not a new task; a skill or prompt command is.
    if (HUMAN_ORIGINS.has(e.origin.kind) && !isCouncilCommand(e.command, COMMAND)) {
      const patterns = (await contextOf($).catch(() => undefined))?.patterns
      // A person's `council allow` / `council deny` lines (ROADMAP C4): answered against the offers of the
      // prompt now ending, then stripped. Any other origin never gets here, so its lines stay ordinary text.
      // Not for a slash command: its text cannot be rewritten, so a line would stay visible to Claude (DESIGN §14.4).
      const { commands, rest } = e.command === undefined ? parseChatLines(e.text) : { commands: [], rest: e.text }
      if (commands.length === 0) {
        await update($, session, value => resetForPrompt(sessionOf(value), redact(e.text, patterns)))
        return next(e)
      }
      // The updater may run again after a lost write; the last run's answers are the ones that landed.
      let acks: string[] = []
      await update($, session, value => {
        const current = sessionOf(value)
        const answered = answerChat(current, commands)
        acks = answered.acks
        return grantChat(resetForPrompt(current, redact(rest, patterns)), answered.grants)
      })
      return next({ ...e, text: rest, context: [...(e.context ?? []), ...acks] })
    } else if (!HUMAN_ORIGINS.has(e.origin.kind)) {
      // Not a person's prompt, so no new task: rounds, lockouts and the latest prompt stay. The cache
      // and a once-allowance only last until the next prompt, though, so neither may carry across
      // one (DESIGN §14.3, §14.4).
      await update($, session, value => forOtherPrompt(sessionOf(value)))
    }
    return next(e)
  }).catch(($, e, next) =>
    // A failing hook must not cost the person's prompt or, left uncaught, the plugin; pass it as typed.
    next(e),
  )

  // Output goes to the user (decision 1). The one exception: where nothing draws, a person's
  // status, report, rules and test also reach Claude as `context`, to relay (ROADMAP C2).
  on('command.run', { command: COMMAND }, async ($, e) => {
    const command = parseCouncil(e.args)
    if (needsPerson(command) && !HUMAN_ORIGINS.has(e.origin.kind)) {
      await show($, { title: text('cmd.title'), lines: [text('cmd.needsPerson')] })
      return {}
    }
    if (command.kind === 'debate') {
      await showDebate($)
      return {}
    }
    const output = await councilOutput($, command)
    await show($, output)
    // Built after the output is shown: a failure here must not cost the person the pane or the lines.
    const context = await relayOf($, command, e.origin.kind).catch(() => undefined)
    return context === undefined ? {} : { context }
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

  // The debate pane draws the agent in view (the main conversation: none) and only reads state.
  on('ui.render', { component: 'Pane', requestId: DEBATE_PANE_ID }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const state = sessionOf(await read($, session))
    return drawRows(Box, Text, debateRows(state, e.props.view.agentId, currentMode()), 'wrap')
  })

  // The council check, and the epic drop: a row each, only while there is one (terminal and desktop).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const state = sessionOf(await read($, session))
    const rows = bandRows(state, e.props.view.agentId, await $.clock.now(), currentMode())
    if (rows === undefined) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return drawRows(Box, Text, rows, 'truncate')
  })

  // The mode label by the prompt while bypass or shadow is on (terminal and desktop).
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const state = sessionOf(await read($, session))
    const label = state.bypass ? text('mode.bypass') : isShadow(state, settings.shadowMode) ? text('mode.shadow') : undefined
    return label === undefined ? next(e) : next({ ...e, props: { ...e.props, modes: [...e.props.modes, label] } })
  })

  on('tool.call', async ($, e, next) => {
    const started = await $.clock.now()
    const call = callOf(e as unknown as Readonly<Record<string, unknown>>)

    /** The one way a call passes: never with the hook's own budget spent. */
    const proceed = async (): Promise<ToolCallResult> =>
      next.budget.remainingMs < BUDGET_GUARD_MS
        ? { deny: refusalText({ who: 'who.council', verdict: 'error', reason: text('reason.internal'), alternative: text('alternative.ask') }) }
        : next(e)

    const sessionCtx = await contextOf($)
    const cwd = await $.session.cwd()
    const realPath = await realPathOf($, call, cwd, sessionCtx)
    // The session root's: operation keys, previews and the Legolas brief's paths keep it, so two repositories' keys never meet.
    const where = {
      root: sessionCtx.root,
      cwd,
      ...(sessionCtx.home !== undefined && { home: sessionCtx.home }),
      ...(realPath !== undefined && { realPath }),
    }
    // C5: classified against every repository the call touches; the strictest decides, and its scope's config is `ctx`'s.
    const { classification, ctx } = await classifyIn($, sessionCtx, call, where)
    const scopeDirs = ctx.scopes.map(scope => scope.dir)
    const scopeTag = scopeTagOf(scopeDirs, ctx.root)
    const logDirs = auditDirsOf(scopeDirs, ctx.root, settings.auditLogPath)
    // The one scope the call touched, for the rules it may be offered (a repository's `where` has its own root).
    const writeWhere = { ...where, root: ctx.scopes[0]?.dir ?? ctx.root }

    if (classification.tier === 'allow') {
      // High-confidence secrets refuse an allowed call too (DESIGN §13.2). It has
      // no operation, so no rounds, no failed attempt and no state write; low
      // findings are ignored here, as the mod never asks on an allowed call.
      if (settings.gollumEnabled) {
        const scan = await scanCall(call, ctx.patterns, ctx.allowlist)
        const first = scan.high[0]
        if (first !== undefined) {
          const deny = refusalText({ who: 'who.gollum', verdict: 'block', reason: text('reason.secretHigh', { label: first.label, snippet: first.snippet }), alternative: text('alternative.removeSecret') })
          const fingerprint = await fingerprintOf(call.tool, call.input)
          const now = await $.clock.now()
          audit(
            $,
            {
              ts: new Date(now).toISOString(),
              tool: call.tool,
              fingerprint,
              opKey: null,
              tier: 'allow',
              ruleId: classification.decided?.ruleId ?? null,
              member: 'gollum',
              profile: null,
              model: null,
              verdict: 'block',
              reason: scan.high.map(finding => finding.label).join(', '),
              shadow: false,
              bypass: false,
              decision: null,
              outcome: 'refused',
              latencyMs: now - started,
              tokens: 0,
              ...(e.agentId !== undefined && { agentId: e.agentId }),
            },
            logDirs,
          )
          return { deny }
        }
      }
      const result = await proceed()
      await noteWrite($, call, cwd, ctx.home, result).catch(() => undefined)
      return result
    }

    // A gated call: everything from here is audited.
    const stored = await read($, session)
    const state = sessionOf(stored)
    // Read as a fresh session, so the call is decided normally; said once, here, since updaters stay pure.
    // (A version 4 record is migrated, not reset, so it is not this case.)
    if (stored !== undefined && !isReadable(stored)) $.ui.log(text('notice.sessionMalformed'), { to: 'debug' })
    // The prompt this call belongs to. A review runs while `next(e)` is in
    // flight; if the user sends a new prompt meanwhile, resetForPrompt bumps
    // the epoch, and a round, wipe or cached approve written afterwards must
    // not land in that new prompt. `thisPrompt` guards those writes.
    const epoch = state.promptEpoch
    const thisPrompt = (value: CouncilSession | undefined): boolean => sessionOf(value).promptEpoch === epoch
    const fingerprint = await fingerprintOf(call.tool, call.input)
    // The verdict cache key: the fingerprint, apart per scope outside the root scope alone (the audit line keeps the plain one).
    const cacheKey = scopeTag === '' ? fingerprint : await fingerprintOf(call.tool, call.input, scopeTag)
    const operation = operationOf(call, classification, where)
    const decided = classification.decided
    const shadow = isShadow(state, settings.shadowMode)
    // Built on first use: a block, lockout or cached call never shows it, and a write can be megabytes.
    let callTextMemo: string | undefined
    const callTextOf = (): string => {
      if (callTextMemo === undefined) callTextMemo = callText(call, ctx.patterns)
      return callTextMemo
    }
    const shownCall = (): string => `${call.tool}: ${callTextOf()}`
    // The debate record: keyed by the call's id, tagged with the agent that made it. It only watches.
    const debateId = e.tool_use_id
    const debateOf = (kind: CouncilDebate['kind'], voices: CouncilDebate['voices'], checks: CouncilDebate['checks'] = []): CouncilDebate => ({
      id: debateId,
      ...(e.agentId !== undefined && { agentId: e.agentId }),
      tool: call.tool,
      call: tidyCall(callTextOf()),
      kind,
      status: 'sitting',
      voices,
      checks,
    })
    const redacted = (raw: string | undefined): string | undefined => (raw === undefined ? undefined : redact(raw, ctx.patterns))
    // Set once the full council approved this very call; the epic drop reads it after the call ran.
    let isCouncilApproved = false
    // Who reviews a review-tier call: the rule's member, or the fallback (pure).
    const seated = classification.tier === 'review' ? route(call, classification, enabledMembers()) : undefined
    const routedMember: MemberName | null = seated === undefined ? null : seated.kind === 'member' ? seated.member : seated.wanted.member
    let member: string | null = routedMember
    let profile: string | null = seated === undefined ? null : ((seated.kind === 'member' ? seated.profile : seated.wanted.profile) ?? null)
    let model: string | null = null
    let tokens = 0
    let verdictText: string | null = null
    let reasonText: string | null = decided?.reason ?? null
    let decision: Decision | null = null
    let isCached = false
    let isShadowed = false
    let preview: string | undefined
    let councilRecord: AuditRecord['council']
    let reviewMs: number | undefined
    let ruleAdded: string | undefined
    // An allow rule would skip the secrets scan: none is offered for a call it flagged.
    let hadSecret = false

    /** Audits the call, then counts it: a failed attempt, or a success that clears its operation. */
    const finish = async (result: ToolCallResult, isWipe = false): Promise<ToolCallResult> => {
      const outcome = outcomeOf(result)
      const now = await $.clock.now()
      const record: AuditRecord = {
        ts: new Date(now).toISOString(),
        tool: call.tool,
        fingerprint,
        opKey: operation.key,
        tier: classification.tier,
        ruleId: decided?.ruleId ?? null,
        member,
        profile,
        model,
        verdict: verdictText,
        reason: reasonText,
        shadow: isShadowed,
        bypass: state.bypass,
        decision,
        outcome,
        latencyMs: now - started,
        ...(reviewMs !== undefined && { reviewMs }),
        ...(ruleAdded !== undefined && { ruleAdded }),
        tokens,
        ...(isCached && { cached: true as const }),
        ...(councilRecord !== undefined && { council: councilRecord }),
        ...(e.agentId !== undefined && { agentId: e.agentId }),
      }
      audit($, record, logDirs)
      const counts = result.deny !== undefined ? isWipe : isWipeOutcome(outcome, wipePolicy())
      if (counts || outcome === 'ran') {
        await update($, session, value => {
          const current = sessionOf(value)
          if (!thisPrompt(current)) return current // a new prompt already reset the counters
          return counts ? noteWipe(current, operation) : resetOperation(current, operation.key)
        })
      }
      // Cosmetic and themed only: a failure here never changes the result.
      if (outcome === 'ran' && isCouncilApproved && rangeOf(classification) !== undefined && currentMode() === 'themed') {
        await epicDrop($).catch(() => undefined)
      }
      if (result.deny === undefined) await noteWrite($, call, cwd, ctx.home, result).catch(() => undefined)
      return result
    }

    /** Refuses with the rounds left on the operation; `isWipe` counts it as a failed attempt. */
    const refuse = async (refusal: Refusal, isWipe: boolean): Promise<ToolCallResult> => {
      const left = roundsLeft(sessionOf(await read($, session)), operation.key)
      return finish({ deny: refusalText({ ...refusal, roundsLeft: left }) }, isWipe)
    }

    /**
     * Lets the call through after the user allowed it, labelling Claude Code's
     * own dialog (decision 10). Once it has run, offers an allow rule for it.
     */
    const allowOnce = async (): Promise<ToolCallResult> => {
      try {
        $.ui.notice(e.tool_use_id, text('notice.allowedOnce'))
      } catch {
        // No dialog to label: nothing lost.
      }
      const result = await proceed()
      if (outcomeOf(result) === 'ran') {
        // Only where one rules file is the call's own (DESIGN §14.5): never a root file that would end the lookup.
        ruleAdded = ctx.writeDir === undefined ? undefined : await offerRule($, call, classification, writeWhere, ctx, hadSecret, ctx.writeDir).catch(() => undefined)
      }
      return finish(result)
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
      const question = questionText(
        {
          call: shownCall(),
          ruleReason: decided?.reason ?? '',
          why,
          opinions,
          ...(preview !== undefined && { preview }),
          ...(secrets.length > 0 && { secrets: secrets.map(finding => ({ label: finding.label, snippet: finding.snippet })) }),
          canAllowlist: secrets.length === 1 && ctx.writeDir !== undefined,
        },
        currentMode(),
      )
      // One entry per confirm: the allowlist is offered for a single finding only.
      const answer = await escalate($, question, secrets.length === 1 && ctx.writeDir !== undefined)
      if (answer === 'unavailable') {
        decision = answer
        // Chat approval (ROADMAP C4): only where nothing draws, and never for a protected path or a block rule.
        const callKey = isOfferable(classification) ? await callKeyOf(call, scopeTag) : undefined
        if (callKey !== undefined) {
          // Consumed in one write, and used only if that write took it: two identical calls must not both spend one.
          const spent: { use: ChatUse } = { use: undefined }
          if (holdsChat(sessionOf(await read($, session)), callKey)) {
            await update($, session, value => {
              const taken = useChat(sessionOf(value), callKey)
              spent.use = taken.use
              return taken.session
            })
          }
          if (spent.use === 'deny') {
            decision = 'chat-deny'
            // The person's refusal, not Claude's failed attempt.
            return refuse({ who: 'who.user', verdict: 'not allowed', reason: text('reason.chatDenied'), alternative: text('alternative.ask') }, false)
          }
          if (spent.use === 'once' || spent.use === 'session') {
            decision = spent.use === 'session' ? 'chat-session' : 'chat-allow'
            return 'allowed'
          }
        }
        const chat =
          callKey === undefined
            ? undefined
            : {
                code: codeOf(callKey),
                // The deciding scope's config and root, the pair its classification came from.
                canSession: suggestRule(call, classification, ctx.loaded.compiled, { ...where, root: ctx.gitDir }, { hadSecret, declined: [] }).kind === 'rule',
              }
        if (callKey !== undefined && chat !== undefined) {
          await update($, session, value => noteOffer(sessionOf(value), { ...chat, callKey }, epoch))
        }
        // Only reached where escalate found no surface, so the model is the only way to tell the person (ROADMAP C2).
        // The operation and the names of who is behind it; never the call, a preview, a finding or a diff.
        const unasked = nobodyToAsk({
          why: text(why, {}, 'plain'),
          operation: redact(operation.key, ctx.patterns),
          ...(decided !== undefined && { ruleId: decided.ruleId }),
          opinions,
          ...(chat !== undefined && chat),
        })
        // A failed attempt, as dismissing is.
        return refuse({ who: 'who.user', verdict: 'not allowed', reason: unasked.reason, alternative: unasked.alternative }, true)
      }
      if (answer === 'dismissed') {
        decision = answer
        // Dismissing (or the engine's "Chat about this") is a failed attempt.
        return refuse({ who: 'who.user', verdict: 'not allowed', reason: text('reason.userDismissed'), alternative: text('alternative.ask') }, true)
      }
      if (answer.kind === 'talk-first') {
        decision = 'chat'
        // Decision 4: "Talk first" is not a failed attempt.
        return refuse({ who: 'who.user', verdict: 'not allowed', reason: text('reason.userWantsChat'), alternative: text('alternative.chat') }, false)
      }
      if (answer.kind === 'allow-once') {
        decision = 'allow-once'
        return 'allowed'
      }
      if (answer.kind === 'allowlist') {
        const finding = secrets[0]
        // Not offered without a rules file of its own to write to, so an answer without one is not honoured.
        const writeDir = ctx.writeDir
        if (finding !== undefined && writeDir !== undefined && (await confirmAllowlist($, finding))) {
          const written = await writeOverrides($, writeDir, current => withAllowlistEntry(current, finding.fingerprint))
          if (written.ok) {
            decision = 'allowlist'
            $.ui.log(text('notice.allowlistWritten', { entry: finding.fingerprint, path: OVERRIDES_PATH }))
            await reloadAt($, ctx, writeDir)
            return 'allowed'
          }
          $.ui.log(text('notice.allowlistFailed', { problem: written.problem }))
          decision = 'keep-blocked'
          // The write failed, not Claude's attempt: it stays blocked but is not counted against it.
          return refuse({ who: 'who.user', verdict: 'keep blocked', reason: text('reason.allowlistNotWritten'), alternative: text('alternative.removeSecret') }, false)
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
    // Decided on a fresh read: a parallel call's failed attempts may have landed since the first.
    const lockout = lockoutOf(sessionOf(await read($, session)), operation)
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
      const scan = await scanCall(call, ctx.patterns, ctx.allowlist)
      if (scan.high.length > 0) {
        member = 'gollum'
        verdictText = 'block'
        reasonText = scan.high.map(finding => finding.label).join(', ')
        const first = scan.high[0] as GollumFinding
        return refuse({ who: 'who.gollum', verdict: 'block', reason: text('reason.secretHigh', { label: first.label, snippet: first.snippet }), alternative: text('alternative.removeSecret') }, true)
      }
      if (scan.low.length > 0) {
        hadSecret = true
        member = 'gollum'
        verdictText = 'ask'
        reasonText = scan.low.map(finding => finding.label).join(', ')
        const answer = await putToUser('escalate.secretLow', [], scan.low)
        if (answer !== 'allowed') return answer
        isAllowedByUser = true
        member = routedMember
      }
    }

    // 7. Ask tier: straight to the user (once: a secrets answer already put the call to them).
    if (classification.tier === 'ask') {
      if (isAllowedByUser) return allowOnce()
      return askUser('escalate.askTier', [])
    }

    // Review. An identical call approved this prompt is not reviewed again.
    if (state.cache.includes(cacheKey)) {
      isCached = true
      verdictText = 'approve'
      reasonText = null
      return finish(await proceed())
    }

    // 8. The read-only preview, for the reviewer and the user.
    if (settings.galadrielEnabled) preview = await previewOf($, planPreview(call, classification, where), ctx)

    /**
     * A big operation: every enabled member with something to review sits on
     * the council's model, the project's checks run alongside, and the
     * strictest verdict wins. Blocked only for want of verdicts comes to you.
     */
    const holdCouncil = async (big: Big): Promise<ToolCallResult> => {
      member = 'council'
      profile = null
      const seats = councilSeats(call, classification, enabledMembers(), { ranges: settings.galadrielEnabled })
      if (seats.length === 0) return shadow ? passInShadow() : askUser('escalate.memberOff', [])
      // A fresh read, so reviews running in parallel are counted when this one decides.
      if (sessionOf(await read($, session)).tokensSpent >= settings.tokenBudget) return shadow ? passInShadow() : askUser('escalate.budget', [])
      const choice = modelChoice('council', ctx, state.models)
      model = choice.model
      const range = rangeOf(classification)
      const ruleReasons = [...new Set(classification.findings.map(finding => finding.reason))]
      const sittings: Sitting[] = []
      for (const seat of seats) {
        const who = whoOf(seat.member, seat.member === 'aragorn' ? seat.profile : undefined)
        if (seat.member === 'legolas' && seat.range !== undefined) {
          const inspection = range === undefined ? undefined : rangeDiffInspection(range.kind, range.part)
          const read = inspection?.kind === 'git' ? await rangeDiffOf($, inspection, ctx) : undefined
          sittings.push(
            read === undefined
              ? { seat, who, skip: text('council.noRange') }
              : {
                  seat,
                  who,
                  brief: {
                    member: 'legolas',
                    context: { tool: call.tool, path: read.label, range: { kind: seat.range, call: callText(call, ctx.patterns) }, diff: { diff: read.diff, isNew: false }, ruleReasons, latestPrompt: state.latestPrompt },
                  },
                },
          )
          continue
        }
        const asked: Seat = seat.member === 'aragorn' ? { member: 'aragorn', profile: seat.profile } : { member: seat.member }
        sittings.push({ seat, who, brief: await briefOf($, asked, call, classification, cwd, realPath, state, preview, ctx) })
      }
      const checks = checksIn(ctx)
      const debate = debateOf(
        'council',
        sittings.map(sitting => ({
          member: sitting.seat.member,
          ...(sitting.seat.member === 'aragorn' && { profile: sitting.seat.profile }),
          status: sitting.brief === undefined ? ('skipped' as const) : ('waiting' as const),
          ...(sitting.brief === undefined && sitting.skip !== undefined && { reason: tidyReason(sitting.skip) }),
        })),
        checks.map(check => ({ name: check.command.name, status: 'running' as const })),
      )
      await update($, session, value => openDebate(sessionOf(value), debate)).catch(() => undefined)
      await openDebatePane($).catch(() => undefined)
      const progress = async (event: Progress): Promise<void> => {
        if (event.kind === 'check') {
          await update($, session, value => noteCheck(sessionOf(value), debateId, event.run.name, event.run.status))
          return
        }
        const outcome = voiceNote(event.voice)
        const detail = { reason: redacted(outcome.reason), alternative: redacted(outcome.alternative) }
        await update($, session, value => noteVoice(sessionOf(value), debateId, event.index, outcome.status, detail))
      }
      const reviewStarted = await $.clock.now()
      const held = await convene($, sittings, choice.model, deadlineFor(choice.model, settings.reviewDeadlineSeconds), settings.councilSequential, checks, next.signal, progress)
      // Esc aborts the model calls and kills the checks. That is not a verdict
      // and not the user keeping the call blocked: refuse plainly, no wipe, no
      // round, no dialog on an abandoned dispatch.
      if (next.signal.aborted) {
        verdictText = 'aborted'
        isShadowed = shadow
        await update($, session, value => closeDebate(sessionOf(value), debateId, 'aborted')).catch(() => undefined)
        return finish({ deny: refusalText({ who: 'who.fullCouncil', verdict: 'interrupted', reason: text('reason.aborted'), alternative: '' }) }, false)
      }
      const runs = held.runs.map(run => ({ ...run, tail: redact(run.tail, ctx.patterns) }))
      const combined = combine(held.voices, runs)
      const councilMs = (await $.clock.now()) - reviewStarted
      reviewMs = councilMs
      tokens = held.tokens.reduce((sum, n) => sum + n, 0)
      isShadowed = shadow
      const isVerdict = combined.reviewed > 0 && !combined.isFailureOnly
      verdictText = isVerdict ? combined.verdict : 'failed'
      isCouncilApproved = isVerdict && combined.verdict === 'approve'
      const debateVerdict = isVerdict ? combined.verdict : 'failed'
      await update($, session, value => closeDebate(sessionOf(value), debateId, debateVerdict)).catch(() => undefined)
      // The audit keeps no check output: the summary leaves it out.
      reasonText = combined.summary || null
      councilRecord = {
        entry: big.entry,
        voices: held.voices.map((voice, index) => ({
          member: voice.member,
          profile: voice.profile ?? null,
          verdict: voice.kind === 'verdict' ? voice.verdict.verdict : voice.kind,
          tokens: held.tokens[index] ?? 0,
        })),
        checks: runs.map(run => ({ name: run.name, status: run.status, ms: run.ms })),
      }
      await update($, session, value => {
        let counted = addReviewTime(addTokens(sessionOf(value), tokens), councilMs)
        for (const voice of held.voices) {
          if (voice.kind !== 'skipped') counted = count(counted, voice.member, voice.kind === 'verdict' ? voice.verdict.verdict : 'failed')
        }
        if (runs.length > 0) counted = count(counted, 'gimli', runs.some(isGimliBlock) ? 'block' : 'approve')
        counted = count(counted, 'council', isVerdict ? combined.verdict : 'failed')
        return isVerdict && !shadow && thisPrompt(value) ? noteRound(counted, operation.key, combined.verdict === 'approve') : counted
      })

      if (combined.reviewed === 0) return shadow ? passInShadow() : askUser('escalate.memberOff', combined.opinions)
      if (combined.isFailureOnly) return shadow ? passInShadow() : askUser('escalate.councilFailed', combined.opinions)
      if (combined.verdict === 'approve') {
        await update($, session, value => {
          const current = sessionOf(value)
          if (!thisPrompt(current)) return current // do not cache into a newer prompt
          return { ...current, cache: cacheApprove(current.cache, cacheKey) }
        })
        return finish(await proceed())
      }
      if (shadow) {
        $.ui.log(text('notice.shadowVerdict', { who: text('who.fullCouncil'), verdict: combined.verdict, tool: call.tool }), { to: 'debug' })
        return passInShadow()
      }
      return refuse({ who: 'who.fullCouncil', verdict: combined.verdict, reason: combined.reason, alternative: combined.alternative }, true)
    }

    // 9. Route: a big operation to the full council; anything else to the rule's member, else the fallback.
    if (isOutOfRounds(state, operation.key) && !shadow) return askUser('escalate.rounds', [])
    if (settings.councilEnabled) {
      const compiled = ctx.loaded.compiled
      const branch = needsCurrentBranch(classification, compiled) ? await currentBranchOf($, ctx.gitDir) : undefined
      const big = bigOperationOf(classification, compiled, branch !== undefined ? { currentBranch: branch } : {})
      if (big !== undefined) return holdCouncil(big)
    }
    if (seated === undefined || seated.kind === 'none') return shadow ? passInShadow() : askUser('escalate.memberOff', [])
    if (sessionOf(await read($, session)).tokensSpent >= settings.tokenBudget) return shadow ? passInShadow() : askUser('escalate.budget', [])

    // 10. Review, and act on the verdict.
    const brief = await briefOf($, seated, call, classification, cwd, realPath, state, preview, ctx)
    const who = whoOf(brief.member, brief.profile)
    member = brief.member
    profile = brief.profile ?? null
    const choice = modelChoice(brief.member, ctx, state.models)
    model = choice.model
    const debate = debateOf('review', [{ member: brief.member, ...(brief.profile !== undefined && { profile: brief.profile }), status: 'waiting' }])
    await update($, session, value => openDebate(sessionOf(value), debate)).catch(() => undefined)
    await openDebatePane($).catch(() => undefined)
    const reviewStarted = await $.clock.now()
    const verdict = await review($, brief, choice.model, deadlineFor(choice.model, settings.reviewDeadlineSeconds), next.signal)
    if (next.signal.aborted) {
      verdictText = 'aborted'
      isShadowed = shadow
      await update($, session, value => closeDebate(sessionOf(value), debateId, 'aborted')).catch(() => undefined)
      return finish({ deny: refusalText({ who, verdict: 'interrupted', reason: text('reason.aborted'), alternative: '' }) }, false)
    }
    const memberMs = (await $.clock.now()) - reviewStarted
    reviewMs = memberMs
    tokens = verdict.tokens
    isShadowed = shadow
    const voiced = verdict.ok ? verdict.verdict.verdict : ('failed' as const)
    const voicedDetail = verdict.ok
      ? { reason: redacted(verdict.verdict.reason), alternative: redacted(verdict.verdict.safer_alternative) }
      : { reason: redacted(verdict.problem) }
    await update($, session, value => closeDebate(noteVoice(sessionOf(value), debateId, 0, voiced, voicedDetail), debateId, voiced)).catch(() => undefined)
    await update($, session, value => {
      const spent = addReviewTime(addTokens(sessionOf(value), verdict.tokens), memberMs)
      const counted = count(spent, brief.member, verdict.ok ? verdict.verdict.verdict : 'failed')
      // A round is a verdict that enforces: in shadow, verdicts only log.
      return verdict.ok && !shadow && thisPrompt(value) ? noteRound(counted, operation.key, verdict.verdict.verdict === 'approve') : counted
    })

    if (!verdict.ok) {
      verdictText = 'failed'
      reasonText = verdict.problem
      return shadow ? passInShadow() : askUser('escalate.failed', [{ who, problem: verdict.problem }])
    }

    verdictText = verdict.verdict.verdict
    reasonText = verdict.verdict.reason
    if (verdict.verdict.verdict === 'approve') {
      await update($, session, value => {
        const current = sessionOf(value)
        if (!thisPrompt(current)) return current // do not cache into a newer prompt
        return { ...current, cache: cacheApprove(current.cache, cacheKey) }
      })
      return finish(await proceed())
    }
    if (shadow) {
      $.ui.log(text('notice.shadowVerdict', { who: text(who), verdict: verdict.verdict.verdict, tool: call.tool }), { to: 'debug' })
      return passInShadow()
    }
    return refuse({ who, verdict: verdict.verdict.verdict, reason: verdict.verdict.reason, alternative: verdict.verdict.safer_alternative }, true)
  }).catch(($, e, next) =>
    // A failure after the call ran replays its result; one before it refuses.
    next.called
      ? next(e)
      : { deny: refusalText({ who: 'who.council', verdict: 'error', reason: text('reason.internal'), alternative: text('alternative.ask') }) },
  )
}
