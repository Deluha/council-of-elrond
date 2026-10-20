import type { EngineInterface, Register } from 'claude-code'

// Throwaway probe for ROADMAP C4. Gates only Bash commands containing PROBE_PERSON
// (a tool.check ask with decider 'person') or PROBE_ASK (a plain ask, the control).
// Writes redacted lines to decider-probe.log at the session root. Never merge.

const LOG_NAME = 'decider-probe.log'
const lines: string[] = []
let earlier: string | undefined
const t0 = Date.now()

function redact(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value)
  return text
    .replace(/(the user said:).*/is, '$1 <redacted>')
    .replace(/(?:~|\/)[^\s"',)]*\/[^\s"',)]*/g, '<path>')
    .replace(/[A-Za-z0-9_+/=-]{24,}/g, '<long>')
    .slice(0, 300)
}

function variantOf(input: unknown): 'PERSON' | 'ASK' | undefined {
  const command = (input as { command?: unknown } | undefined)?.command
  if (typeof command !== 'string') return undefined
  if (command.includes('PROBE_PERSON')) return 'PERSON'
  if (command.includes('PROBE_ASK')) return 'ASK'
  return undefined
}

async function log($: EngineInterface, what: string, data: Record<string, unknown>): Promise<void> {
  const fields = Object.entries(data).map(([key, value]) => `${key}=${redact(value)}`).join(' ')
  const root = await $.session.root().catch(() => undefined)
  if (root === undefined) return
  const path = `${root}/${LOG_NAME}`
  // Keep what an earlier process (a resume, a restart) wrote.
  earlier ??= (await $.fs.exists(path).catch(() => false)) ? await $.fs.read(path).catch(() => '') : ''
  lines.push(`+${Date.now() - t0}ms ${what} ${fields}`)
  await $.fs.write(path, `${earlier}${lines.join('\n')}\n`).catch(() => undefined)
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'decider-probe', description: 'Logs the origin this command arrives with' }).catch(() => undefined)
    const result = await next(e)
    await log($, 'session.start', { surfaces: await $.session.surfaces(), surface: e.surface, isInteractive: e.isInteractive })
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    await log($, 'prompt', { origin: e.origin, isMeta: e.isMeta, command: e.command })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'decider-probe' }, async ($, e) => {
    await log($, 'command', { origin: e.origin, surfaces: await $.session.surfaces() })
    return {}
  })

  on('tool.call', async ($, e, next) => {
    const variant = variantOf(e)
    if (variant === undefined) return next(e)
    const started = Date.now()
    await log($, 'call.before', { variant, remainingMs: next.budget.remainingMs })
    const result = await next(e)
    await log($, 'call.after', {
      variant,
      ms: Date.now() - started,
      ran: !('deny' in result && result.deny !== undefined) && result.isError !== true,
      isError: result.isError,
      text: 'text' in result ? result.text : undefined,
      remainingMs: next.budget.remainingMs,
    })
    return result
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'decider-probe: hook failed' }))

  on('tool.check', async ($, e, next) => {
    const variant = variantOf(e.input)
    if (variant === undefined) return next(e)
    const core = await next(e)
    await log($, 'check', { variant, query: e.tool_use_id === undefined, core })
    return variant === 'PERSON'
      ? { decision: 'ask', decider: 'person', reason: 'decider-probe: this ask must be answered by a person' }
      : { decision: 'ask', reason: 'decider-probe: a plain ask (control)' }
  }).catch(() => ({ decision: 'deny' as const, reason: 'decider-probe: check failed' }))
}
