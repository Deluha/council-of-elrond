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

/** The theme's own words: none may reach plain mode or anything Claude reads. */
export const THEME =
  /gandalf|legolas|aragorn|gimli|gollum|galadriel|elrond|boromir|mordor|middle-earth|shall not pass|leeroy|wipe|loot|raid|\bneed:|\bpass:|greed|legendary|epic|threat|ready check|precious|isengard|rivendell|\belf\b/i

/** Member ids (`[gandalf]`, `[aragorn/git]`) are config keys the user types, not theme text. */
export const withoutIds = (shown: string): string => shown.replace(/\[[a-z/]+\]/g, '')

/**
 * Fake secrets in the shapes the redaction patterns match. Each is joined from
 * two halves at run time so that no committed line holds a well-formed token
 * (secret scanners flag those), while the tests still exercise the real patterns.
 */
export const FAKE_AWS_KEY = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('')
export const FAKE_GITHUB_TOKEN = ['ghp_', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('')

export const FAKE_GITLAB_TOKEN = ['glpat-', 'abcdefghij0123456789xyz'].join('')
export const FAKE_NPM_TOKEN = ['npm_', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('')
export const FAKE_GOOGLE_OAUTH_SECRET = ['GOCSPX-', 'abcdefghijklmnopqrstuvwxyz01'].join('')
export const FAKE_SLACK_WEBHOOK = ['https://hooks.slack.com/services/', 'T0ABCDEFGH/B0ABCDEFGH/', 'abcdefghijklmnopqrstuvwx'].join('')
export const FAKE_PGP_KEY = ['-----BEGIN PGP PRIVATE KEY', ' BLOCK-----\nlQdGBF\n-----END PGP PRIVATE KEY', ' BLOCK-----'].join('')
export const FAKE_JWT = ['eyJhbGciOiJIUzI1NiJ9', '.eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.abcdefghij1234567890'].join('')
export const FAKE_RANDOM_TOKEN = ['q8Zr2LkP0vT7mN4bW9sX1c', 'Y6hJ3dF5gA0eR8tU2iO'].join('')

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
export const TALK_FIRST = 'Parley: talk first'

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
  /** What the user answers: a label, free text, `dismiss` or `chat` (the engine's "Chat about this": the call rejects like a dismissal). Queued `answers` go first. */
  answer: string
  answers: string[]
  /** Model replies, in order; the last one repeats. */
  replies: ModelReply[]
  /** A reply chosen by the request itself (its prompt), asked before `replies`; undefined falls through. */
  replyFor: ((request: Record<string, unknown>) => ModelReply | undefined) | undefined
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
  /** Whether a write to this path is refused (the call rejects). */
  writeFails: (path: string) => boolean
  /** Whether a `clock.now` read is refused (the call rejects), when the clock is mocked. */
  clockFails: () => boolean
  notices: { id: string; text: string | undefined }[]
  panes: string[]
  /** Every pane the mod opened, as it asked. */
  opens: { id: string; title?: string; rows?: number; focus?: true }[]
  /** Whether a surface draws the pane an open asks for (`isPlaced`). */
  isPlaced: boolean
  /** Whether an open is refused outright (the call rejects). */
  isOpenRefused: boolean
  statuses: (string | undefined)[]
  configSets: { key: string; value: unknown }[]
  commands: string[]
  /** What each command was registered with. */
  commandSpecs: { name: string; description: string; argumentHint?: string }[]
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
    /** The engine's own band above the prompt, beneath the plugin: it draws "engine band". */
    isBandDrawn?: boolean
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
    replyFor: undefined,
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
    writeFails: () => false,
    clockFails: () => false,
    notices: [],
    panes: [],
    opens: [],
    isPlaced: true,
    isOpenRefused: false,
    statuses: [],
    configSets: [],
    commands: [],
    commandSpecs: [],
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
    if (w.writeFails(e.path)) return { deny: `EIO: ${e.path}` }
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
  if (setup.isClockMocked === true) {
    // The mocked clock's own `clock.now` hook, behind a switch that makes the read fail.
    const gated = ((name: string, ...rest: unknown[]) => {
      const register = on as unknown as (...args: unknown[]) => unknown
      if (name !== 'clock.now') return register(name, ...rest)
      const hook = rest[rest.length - 1] as (...args: unknown[]) => unknown
      return register(name, ...rest.slice(0, -1), (...args: unknown[]) => (w.clockFails() ? { deny: 'clock is down' } : hook(...args)))
    }) as unknown as On
    w.clock = mock.clock(gated)
  }
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
  if (setup.isBandDrawn === true) {
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return h(Text, null, 'engine band') as never
    })
  }
  on('ui.notice', ($, e) => {
    w.notices.push({ id: e.tool_use_id, text: e.text })
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    w.panes.push(e.id)
    w.opens.push({ id: e.id, ...(e.title !== undefined && { title: e.title }), ...(e.rows !== undefined && { rows: e.rows }), ...(e.focus !== undefined && { focus: e.focus }) })
    if (w.isOpenRefused) return { deny: 'no room' }
    return { value: w.isPlaced ? { isPlaced: true } : ({ isPlaced: false, reason: 'narrow' } as never) }
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
    w.commandSpecs.push({ name: e.name, description: e.description, ...(e.argumentHint !== undefined && { argumentHint: e.argumentHint }) })
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
  on('model.complete', async ($, e, next) => {
    w.modelRequests.push(e as unknown as Record<string, unknown>)
    const delay = w.modelDelays.shift()
    if (delay !== undefined && w.clock !== undefined) {
      // A request the caller aborted (Esc) answers "aborted" at once, as the engine's does.
      const interrupted = new Promise<'aborted'>(resolve => next.signal.addEventListener('abort', () => resolve('aborted'), { once: true }))
      if ((await Promise.race([w.clock.sleep(delay).then(() => 'done' as const), interrupted])) === 'aborted') {
        return { value: { isAnswered: false, reason: 'aborted', usage: USAGE } as never }
      }
      // Past its own timeout, the request is abandoned.
      if (typeof e.timeoutMs === 'number' && delay >= e.timeoutMs) return { value: { isAnswered: false, reason: 'aborted', usage: USAGE } as never }
    }
    const chosen = w.replyFor?.(e as unknown as Record<string, unknown>)
    const reply = chosen ?? (w.replies.length > 1 ? w.replies.shift() : w.replies[0])
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
      if (answer === 'chat') return { deny: "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). To tell you how to proceed, the user said:\nThe user wants to clarify these questions." }
      return { result: { answers: { [question.question]: answer } } as never }
    }
    w.ran.push(strip(e as unknown as Record<string, unknown>))
    return w.toolResult as never
  })
  return w
}

/** Who ran a command: the person's own Enter by default, as the engine stamps it. */
export type Origin = { kind: string; name?: string }

type CommandRunner = { command: { run: (e: unknown) => Promise<unknown> } }

/**
 * `/council <args>` as the engine delivers it: the whole `command.run` input,
 * origin and presentation included. Without an origin the hook sees none.
 */
export const council = ($: unknown, args = '', origin: Origin = { kind: 'composer' }): Promise<unknown> =>
  ($ as CommandRunner).command.run({ command: 'council', args, origin, presentation: { isFullscreen: false, columns: 80 } })

/**
 * Watches the session record beneath the mod: how often it was read, every value
 * written, and two switches. `readAs(n)` makes the n-th read (1-based) answer a
 * value of the test's choosing (undefined: the real one); `refuseWrite()` makes a
 * write fail. Opt in per test: a test that registers its own `state.set` must not.
 */
export type StateWatch = {
  reads: number
  written: unknown[]
  readAs: (n: number) => unknown
  refuseWrite: () => boolean
}

export function watchState(on: On): StateWatch {
  const watch: StateWatch = { reads: 0, written: [], readAs: () => undefined, refuseWrite: () => false }
  on('state.get', async ($, e, next) => {
    const real = await next(e)
    if (e.plugin !== 'council-of-elrond' || e.key !== 'session') return real
    if (real.deny !== undefined) return real
    watch.reads++
    const seeded = watch.readAs(watch.reads)
    // The hook's result wraps the read itself: `{ value: { value, version } }`.
    return seeded === undefined ? real : { ...real, value: { ...real.value, value: seeded as never } }
  })
  on('state.set', ($, e, next) => {
    if (e.plugin !== 'council-of-elrond' || e.key !== 'session') return next(e)
    if (watch.refuseWrite()) return { deny: 'disk full' }
    watch.written.push(e.value)
    return next(e)
  })
  return watch
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
