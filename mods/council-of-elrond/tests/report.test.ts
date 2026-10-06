import { describe, expect, test } from 'claude-code/testing'

import { auditLine } from '../hooks/audit.js'
import type { AuditRecord } from '../hooks/audit.js'
import { parseAudit, reportOutput } from '../hooks/elrond/report.js'
import { auditLines, ROOT, world } from './fixtures.js'

const LOG = `${ROOT}/.claude/council-of-elrond/audit/audit.jsonl`

type Dollar = { command: { run: (e: { command: string; args?: string }) => Promise<unknown> } }
const council = ($: unknown, args = '') => ($ as Dollar).command.run({ command: 'council', args })

/** One audit line, as the mod writes it, with the fields a test names. */
const line = (fields: Partial<AuditRecord>): string =>
  auditLine({
    ts: '2026-10-01T10:00:00.000Z',
    tool: 'Bash',
    fingerprint: '0123456789abcdef',
    opKey: null,
    tier: 'review',
    ruleId: null,
    member: null,
    profile: null,
    model: null,
    verdict: null,
    reason: null,
    shadow: false,
    bypass: false,
    decision: null,
    outcome: 'ran',
    latencyMs: 10,
    tokens: 0,
    ...fields,
  })

const review = (member: string, verdict: string, tokens: number, reviewMs: number, extra: Partial<AuditRecord> = {}): string =>
  line({ member, model: 'sonnet', verdict, tokens, reviewMs, outcome: verdict === 'approve' ? 'ran' : 'refused', ...extra })

// The oldest rotated file, the newer one, then the current file.
const ROTATED_2 = [
  line({ ts: '2026-09-01T09:00:00.000Z', tier: 'block', ruleId: 'rm-recursive-outside-repo', opKey: 'shell:rm /', outcome: 'refused' }),
  review('gandalf', 'block', 1_000, 2_000, { ruleId: 'shell-delete', opKey: 'shell:rm build' }),
].join('')
const ROTATED_1 = [
  review('gandalf', 'block', 1_000, 4_000, { ruleId: 'shell-delete', opKey: 'shell:rm build' }),
  'not json at all\n',
  line({ ts: '2026-09-15T09:00:00.000Z', tier: 'ask', ruleId: 'privileged', opKey: 'shell:apt update', decision: 'allow-once', outcome: 'ran', ruleAdded: 'allow-apt-update' }),
].join('')
const CURRENT = [
  review('legolas', 'block', 800, 1_000, { ruleId: 'file-write', shadow: true, outcome: 'ran' }),
  review('aragorn', 'revise', 2_000, 3_000, { profile: 'git', ruleId: 'git-remote-or-history', shadow: true, outcome: 'ran' }),
  review('gandalf', 'failed', 500, 30_000, { ruleId: 'shell-delete', opKey: 'shell:rm out', decision: 'allow-once', outcome: 'ran' }),
  review('gandalf', 'approve', 0, 0, { ruleId: 'shell-delete', cached: true }),
  line({
    ts: '2026-10-05T12:00:00.000Z',
    member: 'council',
    model: 'opus',
    verdict: 'approve',
    tokens: 3_000,
    reviewMs: 2_000,
    ruleId: 'git-remote-or-history',
    council: {
      entry: '/^git\\s+push(\\s|$)/',
      voices: [
        { member: 'gandalf', profile: null, verdict: 'approve', tokens: 1_000 },
        { member: 'legolas', profile: null, verdict: 'approve', tokens: 1_200 },
        { member: 'aragorn', profile: 'git', verdict: 'approve', tokens: 800 },
      ],
      checks: [{ name: 'tests', status: 'passed', ms: 900 }],
    },
  }),
  line({ ts: '2026-10-05T13:00:00.000Z', member: 'gollum', verdict: 'block', ruleId: 'shell-redirect-write', outcome: 'refused' }),
].join('')

const FILES = [ROTATED_2, ROTATED_1, CURRENT]

describe('reading the log', () => {
  test('every file, oldest first; lines that do not parse are counted and skipped', () => {
    const { entries, skipped } = parseAudit(FILES)
    expect(entries).toHaveLength(10)
    expect(skipped).toBe(1)
    expect(entries[0]?.ts).toBe('2026-09-01T09:00:00.000Z')
    expect(entries[9]?.member).toBe('gollum')
  })

  test('a line of another shape is skipped, not trusted', () => {
    expect(parseAudit(['{"hello":"world"}\n[]\n{"ts":1,"tool":"Bash","outcome":"ran"}\n']).skipped).toBe(3)
  })
})

describe('the report', () => {
  const lines = reportOutput(FILES).lines
  const joined = lines.join('\n')

  test('the span covers the rotated files', () => {
    expect(joined).toContain('10 gated calls from 2026-09-01 to 2026-10-05, over 3 log files')
    expect(joined).toContain('1 lines could not be read and were skipped.')
  })

  test('most refused, by rule and by operation, saying who refused', () => {
    expect(joined).toContain('Most refused, by rule (4 refusals in all):')
    expect(joined).toContain('  shell-delete: 2 (by a reviewer 2)')
    expect(joined).toContain('  rm-recursive-outside-repo: 1 (by the rules 1)')
    expect(joined).toContain('  shell-redirect-write: 1 (by the secrets scan 1)')
    expect(joined).toContain('  shell:rm build: 2')
    // The most refused comes first.
    expect(lines.findIndex(l => l.includes('shell-delete: 2'))).toBeLessThan(lines.findIndex(l => l.includes('rm-recursive-outside-repo: 1')))
  })

  test('blocks the user overrode with "allow once": the false-positive candidates', () => {
    expect(joined).toContain('Stopped, then allowed by you (false-positive candidates; 2 in all):')
    expect(joined).toContain('  privileged: 1; e.g. shell:apt update')
    expect(joined).toContain('  shell-delete: 1; e.g. shell:rm out')
    expect(joined).toContain('Allow rules you added after allowing once: 1 (allow-apt-update)')
  })

  test('shadow verdicts that would have refused, per reviewer', () => {
    expect(joined).toContain('Shadow verdicts that would have refused (2 in all):')
    expect(joined).toContain('the diff reviewer [legolas]: 1 (1 block, 0 revise); rules: file-write 1')
    expect(joined).toContain('the git reviewer [aragorn/git]: 1 (0 block, 1 revise); rules: git-remote-or-history 1')
  })

  test("cost per reviewer: tokens (a council's voices by member) and median review time; cached verdicts cost nothing", () => {
    expect(joined).toContain('Cost per reviewer (8300 tokens in all):')
    // Gandalf: 3 reviews alone (1,000 + 1,000 + 500) plus 1,000 in the council; times 2 s, 4 s, 30 s.
    expect(joined).toContain('the destructive-operations reviewer [gandalf]: 3 reviews alone, 3500 tokens (1000 of them in the full council), median 4.0 s')
    expect(joined).toContain('the diff reviewer [legolas]: 1 reviews alone, 2000 tokens (1200 of them in the full council), median 1.0 s')
    expect(joined).toContain('the git reviewer [aragorn/git]: 1 reviews alone, 2800 tokens (800 of them in the full council), median 3.0 s')
    expect(joined).toContain('the full council: 1 sittings, 3000 tokens, median 2.0 s')
  })

  test('an empty log, and lines from before review times were logged', () => {
    expect(reportOutput([]).lines).toEqual(['No gated calls are logged yet.'])
    const old = reportOutput([line({ member: 'gandalf', model: 'sonnet', verdict: 'approve', tokens: 900 })]).lines.join('\n')
    expect(old).toContain('1 reviews alone, 900 tokens (0 of them in the full council), median -')
    expect(old).toContain('Review times are logged from this version on')
  })
})

describe('/council report', () => {
  test('reads the current and rotated files, and its output never reaches Claude', async ($, on) => {
    const w = world(on, { surfaces: [] })
    w.files.set(`${LOG}.2`, ROTATED_2)
    w.files.set(`${LOG}.1`, ROTATED_1)
    w.files.set(LOG, CURRENT)
    const result = (await council($, 'report')) as { text?: string }
    expect(result.text).toBeUndefined()
    const logged = w.logs.join('\n')
    expect(logged).toContain('Council report (the audit log, rotated files included)')
    expect(logged).toContain('10 gated calls from 2026-09-01 to 2026-10-05, over 3 log files')
  })

  test('reads what the mod itself logs: a review records its time, and the report counts it', async ($, on) => {
    const w = world(on, { surfaces: [] })
    await $.tool.call({ tool: 'Bash', command: 'rm -r build' })
    expect(typeof auditLines(w)[0]?.reviewMs).toBe('number')
    await council($, 'report')
    expect(w.logs.join('\n')).toContain('the destructive-operations reviewer [gandalf]: 1 reviews alone, 1000 tokens')
  })

  test('an unreadable rotated file is named and left out; the rest is reported', async ($, on) => {
    const w = world(on, { surfaces: [] })
    w.files.set(LOG, CURRENT)
    // Listed as present, but it cannot be read.
    w.dirs.add(`${LOG}.1`)
    await council($, 'report')
    const logged = w.logs.join('\n')
    expect(logged).toContain(`Left out: ${LOG}.1`)
    expect(logged).toContain('6 gated calls')
  })
})
