import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'

import { SHIPPED } from '../hooks/config/defaults.js'
import { compileConfig } from '../hooks/config/schema.js'
import type { CompiledConfig } from '../hooks/config/schema.js'
import type { ClassifyContext } from '../hooks/rules/classify.js'

/**
 * A project at /work, as the engine beneath the plugin: files in memory, a
 * scripted model, a scripted user, and the tool itself as the bottom of the
 * `tool.call` chain (what runs is recorded, nothing executes).
 */

export const ROOT = '/work'
export const HOME = '/home/me'

export const CONTEXT: ClassifyContext = { root: ROOT, cwd: ROOT, home: HOME }

export const SHIPPED_COMPILED: CompiledConfig = compileConfig(SHIPPED, new Set())

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}

export const USAGE: Usage = {
  input_tokens: 900,
  output_tokens: 100,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
}

export type ModelReply =
  | { isAnswered: true; text: string; usage: Usage }
  | { isAnswered: false; reason: 'aborted' | 'empty-reply'; usage: Usage }
  | { isAnswered: false; reason: 'api-error'; status: number | null; error: string; usage: Usage }
  | 'refuse-request'

export const verdict = (value: 'approve' | 'revise' | 'block', reason = 'Looks fine.', alternative = ''): ModelReply => ({
  isAnswered: true,
  text: JSON.stringify({ verdict: value, reason, safer_alternative: alternative }),
  usage: USAGE,
})

export const APPROVE = verdict('approve', 'Proportionate and requested.')
export const BLOCK = verdict('block', 'Deletes the whole build cache.', 'Delete only build/tmp with rm -r build/tmp.')
export const REVISE = verdict('revise', 'Too wide.', 'Run rm -r build/out instead.')

/** The loot roll's labels, as the default (themed) mode offers them. */
export const ALLOW_ONCE = 'Need: allow once'
export const KEEP_BLOCKED = 'Pass: keep blocked'
export const ALLOWLIST = 'Greed: add to allowlist'

export type Asked = { question: string; options: readonly string[]; header: string | undefined }

export type ProcessReply = { exitCode: number; stdout: string } | 'timeout'

/**
 * How a spawned check answers, by its argv: its output and exit code; `hang`
 * writes its output and never exits (until the clock or Esc ends it);
 * `no-start` cannot start.
 */
export type SpawnReply = { code: number | null; signal?: string | null; output?: string } | { hang: true; output?: string } | 'no-start'

export type World = {
  cwd: string
  files: Map<string, string>
  dirs: Set<string>
  /** Symbolic links: path -> where it really lands. */
  links: Map<string, string>
  surfaces: string[]
  /** What the user answers: a label, free text, or `dismiss`. Queued `answers` go first. */
  answer: string
  answers: string[]
  /** Model replies, in order; the last one repeats. */
  replies: ModelReply[]
  /** What reached the tool (the bottom of the chain), envelope stripped. */
  ran: Record<string, unknown>[]
  asked: Asked[]
  modelRequests: Record<string, unknown>[]
  logs: string[]
  toasts: string[]
  toolResult: Record<string, unknown>
  /** Every process the mod started, as argv. */
  processes: string[][]
  /** How a process answers, by its argv; absent: exit 0, no output. */
  processReply: (argv: readonly string[]) => ProcessReply
  /** The mocked clock, when the world was made with one. */
  clock: MockClock | undefined
  /** How long each model request takes on the mocked clock, in order (absent: at once). */
  modelDelays: number[]
  /** Every check the mod spawned, as argv, and how many were ended before they exited. */
  spawned: string[][]
  spawnReply: (argv: readonly string[]) => SpawnReply
  ended: number
  notices: { id: string; text: string | undefined }[]
  panes: string[]
  statuses: (string | undefined)[]
  configSets: { key: string; value: unknown }[]
  commands: string[]
}

const strip = (e: Record<string, unknown>): Record<string, unknown> => {
  const { tool_use_id: _id, ...rest } = e
  return rest
}

export function world(
  on: On,
  setup: Partial<Pick<World, 'answer' | 'answers' | 'replies' | 'surfaces' | 'cwd'>> & {
    cwdFails?: boolean
    /** A mocked clock (`w.clock`) answers `$.clock`; else `$.clock.now` reads real time. */
    isClockMocked?: boolean
  } = {},
): World {
  const w: World = {
    cwd: setup.cwd ?? ROOT,
    files: new Map([
      [`${ROOT}/src/app.ts`, 'export const app = 1\n'],
      [`${ROOT}/package.json`, '{"name":"work"}\n'],
    ]),
    dirs: new Set([ROOT, `${ROOT}/src`, `${ROOT}/build`, HOME, '/', '/etc', `${ROOT}/.claude`]),
    links: new Map(),
    surfaces: setup.surfaces ?? ['terminal'],
    answer: setup.answer ?? KEEP_BLOCKED,
    answers: setup.answers ?? [],
    replies: setup.replies ?? [APPROVE],
    ran: [],
    asked: [],
    modelRequests: [],
    logs: [],
    toasts: [],
    toolResult: { result: 'ran' },
    processes: [],
    processReply: () => ({ exitCode: 0, stdout: '' }),
    clock: undefined,
    modelDelays: [],
    spawned: [],
    spawnReply: () => ({ code: 0 }),
    ended: 0,
    notices: [],
    panes: [],
    statuses: [],
    configSets: [],
    commands: [],
  }

  on('session.root', () => ({ value: ROOT }))
  on('session.cwd', () => {
    if (setup.cwdFails === true) throw new Error('no cwd')
    return { value: w.cwd }
  })
  on('session.surfaces', () => ({ value: w.surfaces as never }))
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('fs.exists', ($, e) => ({ value: w.files.has(e.path) || w.dirs.has(e.path) }))
  on('fs.read', ($, e) => {
    const content = w.files.get(e.path)
    return content === undefined ? { deny: `ENOENT: ${e.path}` } : { value: content }
  })
  on('fs.write', ($, e) => {
    w.files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.stat', ($, e) => {
    const link = w.links.get(e.path)
    const isFile = w.files.has(e.path)
    const isDir = w.dirs.has(e.path)
    if (link === undefined && !isFile && !isDir) return { deny: `ENOENT: ${e.path}` }
    return {
      value: {
        kind: isDir ? 'dir' : 'file',
        size: w.files.get(e.path)?.length ?? 0,
        mtimeMs: 0,
        isLink: link !== undefined,
        ...(e.resolve && { realPath: link ?? e.path }),
      },
    }
  })
  on('fs.list', ($, e) => {
    const folder = e.path ?? w.cwd
    const names = new Set<string>()
    const kinds = new Map<string, 'file' | 'dir'>()
    for (const [paths, kind] of [[[...w.files.keys()], 'file'], [[...w.dirs], 'dir']] as const) {
      for (const path of paths) {
        if (!path.startsWith(`${folder}/`)) continue
        const name = path.slice(folder.length + 1).split('/')[0] ?? ''
        if (name === '') continue
        names.add(name)
        kinds.set(name, path.slice(folder.length + 1).includes('/') ? 'dir' : kind)
      }
    }
    return { value: [...names].map(name => ({ name, kind: kinds.get(name) ?? 'file', size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('process.run', ($, e) => {
    w.processes.push([...e.argv])
    const reply = w.processReply(e.argv)
    if (reply === 'timeout') return { deny: 'timed out' }
    return { value: { exitCode: reply.exitCode, stdout: reply.stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  if (setup.isClockMocked === true) w.clock = mock.clock(on)
  else on('clock.now', () => ({ value: Date.now() }))
  on('process.spawn', async function* ($, e, next) {
    w.spawned.push([...e.argv])
    const reply = w.spawnReply(e.argv)
    if (reply === 'no-start') return { deny: `ENOENT: ${e.argv[0]}` }
    let isDone = false
    try {
      if (reply.output !== undefined) yield { stream: 'stdout' as const, text: reply.output }
      // Runs on, quietly writing, until the reader leaves (the engine kills the child then).
      if ('hang' in reply) {
        for (;;) {
          await (w.clock !== undefined ? w.clock.sleep(1_000) : new Promise<void>(() => undefined))
          yield { stream: 'stdout' as const, text: '.' }
        }
      }
      isDone = true
      return { value: { code: 'code' in reply ? reply.code : 0, signal: 'signal' in reply ? (reply.signal ?? null) : null } }
    } finally {
      if (!isDone) w.ended++
    }
  })
  on('ui.notice', ($, e) => {
    w.notices.push({ id: e.tool_use_id, text: e.text })
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    w.panes.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.status', ($, e) => {
    w.statuses.push(e.text)
    return { value: undefined }
  })
  on('config.set', ($, e) => {
    w.configSets.push({ key: e.key, value: e.value })
    return { value: e.value }
  })
  on('command.register', ($, e) => {
    w.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.log', ($, e) => {
    w.logs.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('model.complete', async ($, e) => {
    w.modelRequests.push(e as unknown as Record<string, unknown>)
    const delay = w.modelDelays.shift()
    if (delay !== undefined && w.clock !== undefined) {
      await w.clock.sleep(delay)
      // Past its own timeout, the request is abandoned.
      if (typeof e.timeoutMs === 'number' && delay >= e.timeoutMs) return { value: { isAnswered: false, reason: 'aborted', usage: USAGE } as never }
    }
    const reply = w.replies.length > 1 ? w.replies.shift() : w.replies[0]
    if (reply === undefined || reply === 'refuse-request') return { deny: 'model is blocked by policy' }
    return { value: reply as never }
  })
  on('tool.call', ($, e) => {
    if (e.tool === 'AskUserQuestion') {
      const question = (e as unknown as { questions: { question: string; header?: string; options: { label: string }[] }[] })
        .questions[0]
      if (question === undefined) return { deny: 'no question' }
      w.asked.push({ question: question.question, options: question.options.map(o => o.label), header: question.header })
      const answer = w.answers.shift() ?? w.answer
      if (answer === 'dismiss') return { deny: 'dismissed' }
      return { result: { answers: { [question.question]: answer } } as never }
    }
    w.ran.push(strip(e as unknown as Record<string, unknown>))
    return w.toolResult as never
  })
  return w
}

/** The audit log's lines, parsed. */
export const auditLines = (w: World, path = `${ROOT}/.claude/council-of-elrond/audit/audit.jsonl`): Record<string, unknown>[] =>
  (w.files.get(path) ?? '')
    .split('\n')
    .filter(line => line !== '')
    .map(line => JSON.parse(line) as Record<string, unknown>)

export const denyOf = (result: unknown): string => {
  const deny = (result as { deny?: unknown }).deny
  return typeof deny === 'string' ? deny : ''
}
