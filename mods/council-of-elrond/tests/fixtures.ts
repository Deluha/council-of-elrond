import type { On } from 'claude-code'

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

export type Asked = { question: string; options: readonly string[]; header: string | undefined }

export type World = {
  cwd: string
  files: Map<string, string>
  dirs: Set<string>
  /** Symbolic links: path -> where it really lands. */
  links: Map<string, string>
  surfaces: string[]
  /** What the user answers: a label, free text, or `dismiss`. */
  answer: string
  /** Model replies, in order; the last one repeats. */
  replies: ModelReply[]
  /** What reached the tool (the bottom of the chain), envelope stripped. */
  ran: Record<string, unknown>[]
  asked: Asked[]
  modelRequests: Record<string, unknown>[]
  logs: string[]
  toasts: string[]
  toolResult: Record<string, unknown>
}

const strip = (e: Record<string, unknown>): Record<string, unknown> => {
  const { tool_use_id: _id, ...rest } = e
  return rest
}

export function world(
  on: On,
  setup: Partial<Pick<World, 'answer' | 'replies' | 'surfaces' | 'cwd'>> & { cwdFails?: boolean } = {},
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
    answer: setup.answer ?? 'Keep blocked',
    replies: setup.replies ?? [APPROVE],
    ran: [],
    asked: [],
    modelRequests: [],
    logs: [],
    toasts: [],
    toolResult: { result: 'ran' },
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
  on('ui.log', ($, e) => {
    w.logs.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('model.complete', ($, e) => {
    w.modelRequests.push(e as unknown as Record<string, unknown>)
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
      if (w.answer === 'dismiss') return { deny: 'dismissed' }
      return { result: { answers: { [question.question]: w.answer } } as never }
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
