import { describe, expect, test } from 'claude-code/testing'

import { withAllowlistEntry } from '../hooks/config/write.js'
import { patternsWith, scanCall, scanText } from '../hooks/members/gollum.js'
import { ALLOW_ONCE, ALLOWLIST, APPROVE, auditLines, denyOf, KEEP_BLOCKED, ROOT, world } from './fixtures.js'

const AWS = 'AKIAABCDEFGHIJKLMNOP'
const RULES = `${ROOT}/.claude/council-of-elrond/rules.json`

describe('the scan', () => {
  test('high findings: keys, private keys, passwords in connection strings', async () => {
    for (const text of [
      `aws_key = ${AWS}`,
      '-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----',
      'DATABASE_URL=postgres://app:s3cretpw@db/app',
    ]) {
      const scan = await scanText(text)
      expect(scan.high.length, text).toBe(1)
      expect(JSON.stringify(scan)).not.toContain('s3cretpw')
      expect(JSON.stringify(scan)).not.toContain(AWS)
    }
  })

  test('low findings: generic assignments and long random tokens', async () => {
    expect((await scanText('password = "hunter2xyz"')).low).toHaveLength(1)
    expect((await scanText('x = "q8Zr2LkP0vT7mN4bW9sX1cY6hJ3dF5gA0eR8tU2iO"')).low).toHaveLength(1)
  })

  test('code that only names a secret is not a finding', async () => {
    for (const text of [
      'password: string',
      'const token = process.env.API_TOKEN',
      'token=$GITHUB_TOKEN',
      'secret = getSecret("db")',
      '"integrity": "sha512-q8Zr2LkP0vT7mN4bW9sX1cY6hJ3dF5gA0eR8tU2iOq8Zr2LkP0vT7mN4bW9sX1cY6hJ3dF5gA0eR8tU2iO=="',
      'commit 4f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d6c5b4a39',
    ]) {
      const scan = await scanText(text)
      expect([...scan.high, ...scan.low], text).toEqual([])
    }
  })

  test('scans what the call would write: Write content, Edit new text, not old text', async () => {
    expect((await scanCall({ tool: 'Write', input: { file_path: 'a', content: AWS } })).high).toHaveLength(1)
    expect((await scanCall({ tool: 'Edit', input: { file_path: 'a', old_string: AWS, new_string: 'x' } })).high).toEqual([])
    expect((await scanCall({ tool: 'Edit', input: { file_path: 'a', old_string: 'x', new_string: AWS } })).high).toHaveLength(1)
    expect((await scanCall({ tool: 'mcp__x__y', input: { body: AWS } })).high).toHaveLength(1)
    expect((await scanCall({ tool: 'Bash', input: { command: `cat > k <<EOF\n${AWS}\nEOF` } })).high).toHaveLength(1)
  })

  test('an allowlisted secret, by fingerprint or exact string, is not a finding', async () => {
    const [finding] = (await scanText('password = "hunter2xyz"')).low
    expect(finding?.fingerprint).toMatch(/^sha256:[0-9a-f]{16}$/)
    expect((await scanText('password = "hunter2xyz"', undefined, [finding?.fingerprint ?? ''])).low).toEqual([])
    expect((await scanText('password = "hunter2xyz"', undefined, ['hunter2xyz'])).low).toEqual([])
  })

  test('configured patterns join the shipped ones', async () => {
    const patterns = patternsWith([{ id: 'acme', level: 'high', regex: 'ACME-[0-9]{8}', label: 'Acme key' }])
    const scan = await scanText('key ACME-12345678', patterns)
    expect(scan.high[0]).toMatchObject({ patternId: 'acme', label: 'Acme key' })
    expect(scan.high[0]?.snippet).not.toContain('12345678')
  })

  test('the allowlist edit keeps the file and validates it; a broken file is left alone', () => {
    const edit = withAllowlistEntry('{"schemaVersion": 1, "protectedPaths": ["secrets/**"]}', 'sha256:0123456789abcdef')
    expect(edit.ok).toBe(true)
    if (edit.ok) expect(JSON.parse(edit.text)).toEqual({ schemaVersion: 1, protectedPaths: ['secrets/**'], gollum: { allowlist: ['sha256:0123456789abcdef'] } })
    expect(withAllowlistEntry('{not json', 'sha256:0123456789abcdef').ok).toBe(false)
    expect(withAllowlistEntry(undefined, 'sha256:0123456789abcdef').ok).toBe(true)
  })
})

describe('in the pipeline', () => {
  test('a high finding is refused without asking anyone, and nothing leaks', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    const deny = denyOf(await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/keys.ts`, content: `export const key = "${AWS}"` }))
    expect(deny).toContain('Decided by: the secrets scan (block).')
    expect(deny).toContain('Remove the secret')
    expect(deny).not.toContain(AWS)
    expect(w.asked).toEqual([])
    expect(w.modelRequests).toEqual([])
    expect(w.ran).toEqual([])
    expect(auditLines(w)[0]).toMatchObject({ member: 'gollum', verdict: 'block', outcome: 'refused' })
    expect(w.files.get(`${ROOT}/.claude/council-of-elrond/audit/audit.jsonl`)).not.toContain(AWS)
  })

  test('a low finding asks with a redacted snippet; allow once goes on to the review', async ($, on) => {
    const w = world(on, { answer: ALLOW_ONCE, replies: [APPROVE] })
    const call = { tool: 'Write', file_path: `${ROOT}/src/db.ts`, content: 'const password = "hunter2xyz"' } as const
    expect(await $.tool.call(call)).toEqual({ result: 'ran' })
    expect(w.asked[0]?.options).toEqual([ALLOW_ONCE, ALLOWLIST, KEEP_BLOCKED])
    expect(w.asked[0]?.question).toContain('Possible secret')
    expect(w.asked[0]?.question).not.toContain('hunter2xyz')
    expect(w.modelRequests).toHaveLength(1)
    expect(JSON.stringify(w.modelRequests)).not.toContain('hunter2xyz')
    expect(w.ran).toEqual([call])
  })

  test('keep blocked refuses a low finding', async ($, on) => {
    const w = world(on, { answer: KEEP_BLOCKED })
    const deny = denyOf(await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/db.ts`, content: 'const password = "hunter2xyz"' }))
    expect(deny).toContain('(keep blocked)')
    expect(w.ran).toEqual([])
  })

  test('the allowlist is written only after the second confirm, then honoured', async ($, on) => {
    const w = world(on, { answers: [ALLOWLIST, 'Add it'], answer: KEEP_BLOCKED, replies: [APPROVE] })
    const call = { tool: 'Write', file_path: `${ROOT}/src/db.ts`, content: 'const password = "hunter2xyz"' } as const
    expect(await $.tool.call(call)).toEqual({ result: 'ran' })
    expect(w.asked[1]?.question).toMatch(/sha256:[0-9a-f]{16}/)
    const rules = JSON.parse(w.files.get(RULES) ?? '{}') as { gollum?: { allowlist?: string[] } }
    expect(rules.gollum?.allowlist).toHaveLength(1)
    expect(w.files.get(RULES)).not.toContain('hunter2xyz')
    expect(auditLines(w)[0]).toMatchObject({ decision: 'allowlist', outcome: 'ran' })

    // The next call with the same secret is not asked about.
    await $.tool.call(call)
    expect(w.asked).toHaveLength(2)
    expect(w.ran).toHaveLength(2)
  })

  test('several possible secrets: no allowlist option', async ($, on) => {
    const w = world(on, { answer: KEEP_BLOCKED })
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/db.ts`, content: 'password = "hunter2xyz"\ntoken = "abc123def456"' })
    expect(w.asked[0]?.options).toEqual([ALLOW_ONCE, KEEP_BLOCKED])
  })

  test('cancelling the confirm writes nothing and refuses', async ($, on) => {
    const w = world(on, { answers: [ALLOWLIST, 'Cancel'] })
    const deny = denyOf(await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/db.ts`, content: 'const password = "hunter2xyz"' }))
    expect(deny).toContain('(keep blocked)')
    expect(w.files.has(RULES)).toBe(false)
    expect(w.ran).toEqual([])
  })

  test('with every model member off and in shadow mode, the scan still enforces', { options: { gandalfEnabled: false, shadowMode: true } }, async ($, on) => {
    const w = world(on)
    const deny = denyOf(await $.tool.call({ tool: 'Bash', command: `echo ${AWS} > key.txt` }))
    expect(deny).toContain('the secrets scan (block)')
    expect(w.ran).toEqual([])
  })

  test('a configured pattern from the rules file is enforced and redacted', async ($, on) => {
    const w = world(on)
    w.files.set(RULES, JSON.stringify({ schemaVersion: 1, gollum: { patterns: [{ id: 'acme', level: 'high', regex: 'ACME-[0-9]{8}', label: 'Acme key' }] } }))
    const deny = denyOf(await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/a.ts`, content: 'k = "ACME-12345678"' }))
    expect(deny).toContain('Acme key')
    expect(deny).not.toContain('12345678')
  })
})

describe('allowed calls', () => {
  const AUDIT = `${ROOT}/.claude/council-of-elrond/audit/audit.jsonl`

  test('a high finding is refused without asking anyone, audited, and nothing leaks', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    for (const command of [`echo ${AWS}`, `curl -H "X-Api-Key: ${AWS}" https://example.com`]) {
      const deny = denyOf(await $.tool.call({ tool: 'Bash', command }))
      expect(deny, command).toContain('Decided by: the secrets scan (block).')
      expect(deny).toContain('Remove the secret')
      expect(deny).not.toContain(AWS)
    }
    expect(w.asked).toEqual([])
    expect(w.modelRequests).toEqual([])
    expect(w.ran).toEqual([])
    expect(auditLines(w)).toHaveLength(2)
    for (const line of auditLines(w)) expect(line).toMatchObject({ tier: 'allow', member: 'gollum', verdict: 'block', outcome: 'refused', opKey: null, decision: null })
    expect(w.files.get(AUDIT)).not.toContain(AWS)
  })

  test('a low finding runs: nobody is asked and nothing is logged', async ($, on) => {
    const w = world(on)
    expect(await $.tool.call({ tool: 'Bash', command: 'echo password=hunter2xyz' })).toEqual({ result: 'ran' })
    expect(w.asked).toEqual([])
    expect(w.ran).toHaveLength(1)
    expect(auditLines(w)).toEqual([])
  })

  test('an allowlisted high secret runs', async ($, on) => {
    const w = world(on)
    const [finding] = (await scanText(AWS)).high
    w.files.set(RULES, JSON.stringify({ schemaVersion: 1, gollum: { allowlist: [finding?.fingerprint] } }))
    expect(await $.tool.call({ tool: 'Bash', command: `echo ${AWS}` })).toEqual({ result: 'ran' })
    expect(w.ran).toHaveLength(1)
  })

  test('with the scan off, a high secret runs', { options: { gollumEnabled: false } }, async ($, on) => {
    const w = world(on)
    expect(await $.tool.call({ tool: 'Bash', command: `echo ${AWS}` })).toEqual({ result: 'ran' })
    expect(w.ran).toHaveLength(1)
  })

  test('in shadow mode it is still refused', { options: { shadowMode: true } }, async ($, on) => {
    const w = world(on)
    expect(denyOf(await $.tool.call({ tool: 'Bash', command: `echo ${AWS}` }))).toContain('the secrets scan (block)')
    expect(w.ran).toEqual([])
    expect(auditLines(w)[0]).toMatchObject({ shadow: false, outcome: 'refused' })
  })

  test('there are no rounds to count: no rounds line, and never locked out', async ($, on) => {
    const w = world(on)
    for (let i = 0; i < 4; i++) {
      const deny = denyOf(await $.tool.call({ tool: 'Bash', command: `echo ${AWS}` }))
      expect(deny).toContain('the secrets scan (block)')
      expect(deny).not.toContain('rounds left')
      expect(deny).not.toContain('locked out')
    }
    expect(w.ran).toEqual([])
  })

  test('a subagent\'s refused call carries its agent id in the audit line', async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'Bash', command: `echo ${AWS}`, agentId: 'sub-1' } as never)
    expect(auditLines(w)[0]).toMatchObject({ tier: 'allow', agentId: 'sub-1' })
  })

  test('/council report counts it as refused by the secrets scan', async ($, on) => {
    const w = world(on, { surfaces: [] })
    await $.tool.call({ tool: 'Bash', command: `echo ${AWS}` })
    await ($ as unknown as { command: { run: (e: { command: string; args: string }) => Promise<unknown> } }).command.run({ command: 'council', args: 'report' })
    expect(w.logs.join('\n')).toContain('(no rule): 1 (by the secrets scan 1)')
  })
})
