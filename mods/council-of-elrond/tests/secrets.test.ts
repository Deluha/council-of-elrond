import { describe, expect, test } from 'claude-code/testing'

import { auditLine } from '../hooks/audit.js'
import type { AuditRecord } from '../hooks/audit.js'
import { questionText } from '../hooks/elrond/escalation.js'
import { operationOf } from '../hooks/elrond/operations.js'
import { refusalText } from '../hooks/elrond/refusal.js'
import { patternsWith, scanCall, scannedText, scanText } from '../hooks/members/gollum.js'
import { isCodeReference, isPlaceholder, redact } from '../hooks/redact.js'
import { classify } from '../hooks/rules/classify.js'
import type { Call } from '../hooks/rules/classify.js'
import { text } from '../hooks/strings.js'
import { ALLOW_ONCE, APPROVE, auditLines, CONTEXT, council, denyOf, FAKE_GITHUB_TOKEN, KEEP_BLOCKED, ROOT, SHIPPED_COMPILED, settled, verdict, watchState, world } from './fixtures.js'

const RULES = `${ROOT}/.claude/council-of-elrond/rules.json`
const AUDIT = `${ROOT}/.claude/council-of-elrond/audit/audit.jsonl`

/** Every text a finding or a redaction touches: neither the scan nor the redaction may leave it as it was. */
const found = async (line: string): Promise<boolean> => {
  const scan = await scanText(line)
  return scan.high.length + scan.low.length > 0
}

/** A project's own secret format, as a rules file holds it. */
const ACME = { id: 'acme', level: 'high' as const, regex: 'ACME-[0-9]{8}', label: 'Acme key' }
const ACME_LOW = { ...ACME, level: 'low' as const }
const ACME_KEY = 'ACME-12345678'
const ACME_PATTERNS = patternsWith([ACME])

describe('a project\'s own patterns are applied wherever the mod redacts (DESIGN §16 item 14)', () => {
  const push: Call = { tool: 'Bash', input: { command: `git push https://${ACME_KEY}@example.com/r.git feature` } }
  const classified = classify(push, SHIPPED_COMPILED, CONTEXT)

  test('the operation key: the shipped patterns leave the project\'s format, the call\'s patterns redact it; with none the key is as it was', () => {
    const shipped = operationOf(push, classified, CONTEXT)
    expect(shipped.key).toContain(ACME_KEY)
    const own = operationOf(push, classified, CONTEXT, ACME_PATTERNS)
    expect(JSON.stringify(own)).not.toContain('12345678')
    expect(own.key).toContain('[REDACTED Acme key]')
    expect(own.partKeys.join(' ')).toContain('[REDACTED Acme key]')
    // A pattern anchored to the whole of a target matches the target alone, not the key around it.
    const anchored = patternsWith([{ id: 'acme-host', level: 'high', regex: '^ACME-[0-9]{8}$', label: 'Acme host' }])
    const sql: Call = { tool: 'Bash', input: { command: `psql -h ${ACME_KEY} shop` } }
    expect(operationOf(sql, classify(sql, SHIPPED_COMPILED, CONTEXT), CONTEXT).key).toContain(ACME_KEY)
    expect(operationOf(sql, classify(sql, SHIPPED_COMPILED, CONTEXT), CONTEXT, anchored).key).toContain('[REDACTED Acme host]')
    // The key of a command the parser read no part of.
    const unparsed: Call = { tool: 'Bash', input: { command: `echo ${ACME_KEY}` } }
    expect(operationOf(unparsed, { ...classified, findings: [] }, CONTEXT, ACME_PATTERNS).key).toBe('shell:echo [REDACTED Acme key]')
    expect(operationOf(unparsed, { ...classified, findings: [] }, CONTEXT).key).toBe(`shell:echo ${ACME_KEY}`)
  })

  const record = (over: Partial<AuditRecord>): AuditRecord => ({
    ts: '2026-01-01T00:00:00.000Z',
    tool: 'Bash',
    fingerprint: '0123456789abcdef',
    opKey: null,
    tier: 'review',
    ruleId: null,
    member: 'gandalf',
    profile: null,
    model: null,
    verdict: 'revise',
    reason: null,
    shadow: false,
    bypass: false,
    decision: null,
    outcome: 'refused',
    latencyMs: 1,
    tokens: 0,
    ...over,
  })

  test('the audit line: the operation key and the reason are redacted with the call\'s patterns, and as before without them', () => {
    const line = record({ opKey: `shell:git push ${ACME_KEY}`, reason: `pushes with ${ACME_KEY}` })
    expect(auditLine(line)).toContain(ACME_KEY)
    const own = JSON.parse(auditLine(line, ACME_PATTERNS)) as { opKey: string; reason: string }
    expect(own).toMatchObject({ opKey: 'shell:git push [REDACTED Acme key]', reason: 'pushes with [REDACTED Acme key]' })
    // A key or a reason that holds nothing is as it was; a null stays null.
    expect(auditLine(record({ opKey: 'shell:ls', reason: 'Fine.' }), ACME_PATTERNS)).toBe(auditLine(record({ opKey: 'shell:ls', reason: 'Fine.' })))
    expect(JSON.parse(auditLine(record({}), ACME_PATTERNS))).toMatchObject({ opKey: null, reason: null })
    // A file tool's key is a path, which a token can be in.
    expect(auditLine(record({ opKey: `file:src/${FAKE_GITHUB_TOKEN}.ts` }))).not.toContain(FAKE_GITHUB_TOKEN)
  })

  test('the refusal Claude reads: a reviewer\'s reason, alternative and instruction, and a project rule\'s reason', () => {
    const refusal = { who: 'who.gandalf' as const, verdict: 'revise', reason: `Uses ${ACME_KEY}.`, alternative: `Use $KEY, not ${ACME_KEY}.`, instruction: `Do not paste ${ACME_KEY}.` }
    expect(refusalText(refusal)).toContain(ACME_KEY)
    const own = refusalText(refusal, 'plain', ACME_PATTERNS)
    expect(own).not.toContain('12345678')
    expect(own.match(/\[REDACTED Acme key\]/g)).toHaveLength(3)
    expect(refusalText({ ...refusal, isProjectReason: true }, 'plain', ACME_PATTERNS)).not.toContain('12345678')
  })

  test('the dialog: the call, a reviewer\'s line, a project rule\'s reason, the preview and a secret\'s snippet', () => {
    const question = {
      call: `Bash: git push ${ACME_KEY}`,
      ruleReason: `Pushes with ${ACME_KEY}`,
      isProjectReason: true,
      why: 'escalate.askProject' as const,
      opinions: [{ who: 'who.gandalf' as const, verdict: 'approve', reason: `Fine, ${ACME_KEY} is a test key.` }],
      preview: `remote ${ACME_KEY}`,
      secrets: [{ label: 'Acme key', snippet: `k=${ACME_KEY}` }],
    }
    expect(questionText(question)).toContain(ACME_KEY)
    const own = questionText(question, 'plain', ACME_PATTERNS)
    expect(own).not.toContain('12345678')
    expect(own).toContain('approve. Fine, [REDACTED Acme key] is a test key.')
  })

  test('through the pipeline: a confirmed project pattern redacts the key, the audit line, the refusal and the dialog; nothing holds the match', { options: { trustProjectRules: 'always' } }, async ($, on) => {
    const w = world(on, { answer: ALLOW_ONCE, replies: [verdict('revise', `Do not push with ${ACME_KEY}.`, `Push with $KEY, not ${ACME_KEY}.`)] })
    const state = watchState(on)
    w.files.set(RULES, JSON.stringify({ schemaVersion: 1, gollum: { patterns: [ACME_LOW] } }))
    w.processReply = argv => (argv[1] === 'log' ? { exitCode: 0, stdout: 'aaa111 Work\n' } : { exitCode: 0, stdout: 'feature\n' })
    const deny = denyOf(await $.tool.call({ tool: 'Bash', command: `git push https://${ACME_KEY}@example.com/r.git feature` }))
    // The scan's question, then the reviewer's revise.
    expect(w.asked).toHaveLength(1)
    expect(deny).toContain('Do not push with [REDACTED Acme key].')
    expect(deny).toContain('Push with $KEY, not [REDACTED Acme key].')
    await settled(w)
    const [line] = await auditLines(w)
    expect(line).toMatchObject({ verdict: 'revise', outcome: 'refused' })
    expect(JSON.stringify(line)).toContain('[REDACTED Acme key]')
    // The key the session counts the failed attempt under holds none of it either.
    expect(state.written.length).toBeGreaterThan(0)
    for (const shown of [deny, JSON.stringify(w.asked), JSON.stringify(line), w.files.get(AUDIT) ?? '', JSON.stringify(state.written)]) expect(shown).not.toContain('12345678')
  })

  test('through the pipeline: the reviewer\'s own line in the dialog an unconfirmed project ask rule opens, with the project\'s own pattern', { options: { trustProjectRules: 'always' } }, async ($, on) => {
    const w = world(on, { answer: KEEP_BLOCKED, replies: [verdict('approve', `Fine: ${ACME_KEY} is a test key.`)] })
    w.files.set(
      RULES,
      JSON.stringify({ schemaVersion: 1, gollum: { patterns: [ACME_LOW] }, rules: [{ id: 'ask-all', tier: 'ask', tools: ['Bash'], command: '^git ', reason: `Ask about ${ACME_KEY}.` }] }),
    )
    w.processReply = () => ({ exitCode: 0, stdout: 'feature\n' })
    await $.tool.call({ tool: 'Bash', command: `git push origin feature # ${ACME_KEY}` })
    expect(w.asked.length).toBeGreaterThan(0)
    expect(JSON.stringify(w.asked)).not.toContain('12345678')
    expect(w.asked.map(asked => asked.question).join('\n')).toContain('[REDACTED Acme key]')
  })

  test('without a project pattern nothing about the shipped redaction changes: the pinned keys', () => {
    const call: Call = { tool: 'Bash', input: { command: 'git push origin feature' } }
    expect(operationOf(call, classify(call, SHIPPED_COMPILED, CONTEXT), CONTEXT).key).toBe(operationOf(call, classify(call, SHIPPED_COMPILED, CONTEXT), CONTEXT, patternsWith([])).key)
    const url: Call = { tool: 'Bash', input: { command: 'git push https://user:s3cretpw@example.com/r.git feature' } }
    expect(operationOf(url, classify(url, SHIPPED_COMPILED, CONTEXT), CONTEXT).key).not.toContain('s3cretpw')
  })
})

describe('what the scan reads (DESIGN §16 item 15)', () => {
  const token = FAKE_GITHUB_TOKEN

  test('a shell call: its description and its command; a file tool: its path and what it writes; any other tool: its whole input', () => {
    expect(scannedText({ tool: 'Bash', input: { command: 'ls', description: 'list' } })).toBe('list\nls')
    expect(scannedText({ tool: 'Bash', input: { command: 'ls' } })).toBe('ls')
    expect(scannedText({ tool: 'Monitor', input: { command: 'tail -f x', description: 'watch' } })).toContain('watch')
    expect(scannedText({ tool: 'Write', input: { file_path: '/work/a.ts', content: 'x = 1' } })).toBe('/work/a.ts\nx = 1')
    expect(scannedText({ tool: 'Edit', input: { file_path: '/work/a.ts', old_string: 'OLD', new_string: 'NEW' } })).toBe('/work/a.ts\nNEW')
    expect(scannedText({ tool: 'Edit', input: { file_path: '/work/a.ts', edits: [{ old_string: 'o', new_string: 'one' }, null, { new_string: 'two' }] } })).toBe('/work/a.ts\none\ntwo')
    expect(scannedText({ tool: 'NotebookEdit', input: { notebook_path: '/work/n.ipynb', new_source: 'x = 2' } })).toBe('/work/n.ipynb\nx = 2')
    expect(scannedText({ tool: 'WebFetch', input: { url: 'https://example.com/?a=1', prompt: 'p' } })).toBe('{"prompt":"p","url":"https://example.com/?a=1"}')
    expect(scannedText({ tool: 'Agent', input: { prompt: 'go' } })).toBe('{"prompt":"go"}')
    expect(scannedText({ tool: 'mcp__x__y', input: { b: 1, a: [{ d: 2, c: 3 }] } })).toBe('{"a":[{"c":3,"d":2}],"b":1}')
    // Not what is replaced: an Edit's old text.
    expect(scannedText({ tool: 'Edit', input: { file_path: '/work/a.ts', old_string: token, new_string: 'x' } })).not.toContain(token)
  })

  test('a high-confidence token in each place is a finding, and shows nowhere', async () => {
    const calls: Call[] = [
      { tool: 'Bash', input: { command: 'ls', description: `list files for ${token}` } },
      { tool: 'Write', input: { file_path: `/work/src/${token}.ts`, content: 'x' } },
      { tool: 'Edit', input: { file_path: `/work/src/${token}.ts`, old_string: 'a', new_string: 'b' } },
      { tool: 'NotebookEdit', input: { notebook_path: `/work/${token}.ipynb`, new_source: 'x' } },
      { tool: 'WebFetch', input: { url: `https://example.com/?key=${token}`, prompt: 'read it' } },
      { tool: 'Agent', input: { description: 'do it', prompt: `use ${token} to log in` } },
      { tool: 'Read', input: { file_path: `/work/${token}` } },
      { tool: 'SomeNewTool', input: { nested: { deeper: [token] } } },
    ]
    for (const call of calls) {
      const scan = await scanCall(call)
      expect(scan.high.map(finding => finding.patternId), call.tool).toEqual(['github-token'])
      expect(JSON.stringify(scan), call.tool).not.toContain(token)
    }
    // No token, no finding: the same calls without it.
    for (const call of [{ tool: 'WebFetch', input: { url: 'https://example.com/docs', prompt: 'read it' } }, { tool: 'Agent', input: { prompt: 'summarise the repository' } }] as Call[]) {
      const scan = await scanCall(call)
      expect([...scan.high, ...scan.low]).toEqual([])
    }
  })

  test('through the pipeline: a token in a Bash description, a Write path, a WebFetch URL and an Agent prompt each refuses', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    const calls = [
      { tool: 'Bash', command: 'ls', description: `list ${token}` },
      { tool: 'Write', file_path: `${ROOT}/src/${token}.ts`, content: 'export const a = 1' },
      { tool: 'WebFetch', url: `https://example.com/?k=${token}`, prompt: 'read' },
      { tool: 'Agent', description: 'x', prompt: `log in with ${token}` },
    ] as const
    for (const call of calls) {
      const deny = denyOf(await $.tool.call(call as never))
      expect(deny, call.tool).toContain('Decided by: the secrets scan (block).')
      expect(deny, call.tool).not.toContain(token)
    }
    expect(w.ran).toEqual([])
    expect(w.asked).toEqual([])
    await settled(w)
    expect(w.files.get(AUDIT) ?? '').not.toContain(token)
  })

  test('a long input is scanned within the size cap: the cost stays that of a scan of the cap, whatever the tool', async () => {
    const started = Date.now()
    const scan = await scanCall({ tool: 'WebSearch', input: { query: 'x'.repeat(1_000_000) } })
    expect(scan.partial).toBe(true)
    expect(Date.now() - started).toBeLessThan(2000)
  })
})

describe('a text too long to scan in full is not passed silently (DESIGN §16 item 16)', () => {
  const big = (length: number): string => 'x'.repeat(length)
  const WRITE = (content: string) => ({ tool: 'Write', file_path: `${ROOT}/src/big.ts`, content }) as const
  const PARTIAL = 'The call is too long for the secrets scan to read in full'

  test('a gated call asks, with its own reason, and the person\'s answer is not kept', async ($, on) => {
    const w = world(on, { answer: ALLOW_ONCE, replies: [APPROVE] })
    expect(await $.tool.call(WRITE(big(700_000)))).toEqual({ result: 'ran' })
    expect(w.asked).toHaveLength(1)
    expect(w.asked[0]?.question).toContain(PARTIAL)
    expect(w.asked[0]?.question).not.toContain('Possible')
    // No allow rule is offered for it, and the same call asks again.
    expect(w.asked[0]?.options).toEqual([ALLOW_ONCE, KEEP_BLOCKED, 'Parley: talk first'])
    await $.tool.call(WRITE(big(700_000)))
    expect(w.asked).toHaveLength(2)
    expect((await auditLines(w))[0]).toMatchObject({ tier: 'review', decision: 'allow-once', outcome: 'ran' })
  })

  test('keeping it blocked refuses; where nobody can be asked it is refused and says why', async ($, on) => {
    const w = world(on, { answer: KEEP_BLOCKED })
    expect(denyOf(await $.tool.call(WRITE(big(700_000))))).toContain('(keep blocked)')
    expect(w.ran).toEqual([])
  })

  test('where nobody can be asked it is refused, naming the reason', async ($, on) => {
    const w = world(on, { surfaces: [] })
    const deny = denyOf(await $.tool.call(WRITE(big(700_000))))
    expect(deny).toContain(PARTIAL)
    expect(w.ran).toEqual([])
  })

  test('a text the head and the tail cover whole is not asked about', async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    expect(await $.tool.call(WRITE(big(550_000)))).toEqual({ result: 'ran' })
    expect(w.asked).toEqual([])
  })

  test('a finding and a partial scan together are one question that says both', async ($, on) => {
    const w = world(on, { answer: KEEP_BLOCKED })
    await $.tool.call(WRITE(`password = "hunter2xyz"\n${big(700_000)}`))
    expect(w.asked).toHaveLength(1)
    expect(w.asked[0]?.question).toContain('may be a secret, and the call is too long')
    expect(w.asked[0]?.question).toContain('Possible secret')
  })

  test('an allowed call is refused, with one audit line, and nothing else changes', async ($, on) => {
    const w = world(on)
    const deny = denyOf(await $.tool.call({ tool: 'Grep', pattern: big(700_000) } as never))
    expect(deny).toContain('Decided by: the secrets scan (block).')
    expect(deny).toContain(PARTIAL)
    expect(deny).toContain('Make the call shorter')
    expect(deny).not.toContain('rounds left')
    expect(w.ran).toEqual([])
    expect(w.asked).toEqual([])
    const lines = await auditLines(w)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ tier: 'allow', member: 'gollum', verdict: 'block', outcome: 'refused', opKey: null, decision: null, shadow: false })
    // A short one runs, and writes nothing.
    expect(await $.tool.call({ tool: 'Grep', pattern: 'x' } as never)).toEqual({ result: 'ran' })
    expect(await auditLines(w)).toHaveLength(1)
  })

  test('with the scan off, a long call passes', { options: { gollumEnabled: false } }, async ($, on) => {
    const w = world(on, { replies: [APPROVE] })
    expect(await $.tool.call({ tool: 'Grep', pattern: big(700_000) } as never)).toEqual({ result: 'ran' })
    expect(await $.tool.call(WRITE(big(700_000)))).toEqual({ result: 'ran' })
    expect(w.asked).toEqual([])
  })

  test('shadow mode and bypass: the scan enforces in shadow, as for a finding; bypass passes a gated call and refuses an allowed one', async ($, on) => {
    const w = world(on, { answer: ALLOW_ONCE, replies: [APPROVE] })
    // Shadow: the person is still asked, as for a finding (DESIGN §6.10).
    await council($, 'shadow on')
    await $.tool.call(WRITE(big(700_000)))
    expect(w.asked).toHaveLength(1)
    expect(denyOf(await $.tool.call({ tool: 'Grep', pattern: big(700_000) } as never))).toContain(PARTIAL)
    // Bypass: a gated call passes unasked, as with a finding; an allowed one is refused.
    await council($, 'shadow off')
    await council($, 'off')
    expect(await $.tool.call(WRITE(big(700_000)))).toEqual({ result: 'ran' })
    expect(w.asked).toHaveLength(1)
    expect(denyOf(await $.tool.call({ tool: 'Grep', pattern: big(700_000) } as never))).toContain(PARTIAL)
  })
})

// The value minimum, paths, call expressions and the rest (DESIGN §16 item 18).
describe('redaction noise this release added is gone, and what must be caught still is', () => {
  const quiet = async (line: string): Promise<void> => {
    expect(await found(line), line).toBe(false)
    expect(redact(line), line).toBe(line)
  }
  const loud = async (line: string): Promise<void> => {
    expect(await found(line), line).toBe(true)
    expect(redact(line), line).not.toBe(line)
  }

  test('(a) a plain word of letters, underscores and dots needs 6 characters; with a digit or any other character, 4', async () => {
    for (const line of ['{ token: token }', 'this.token = token', 'passwd: files systemd', '// TODO token: move to env', 'git commit -m "fix password: reset flow"', 'password=hunte', 'password=ab_c', 'token: a.bcd']) await quiet(line)
    // Six letters or more is a word the redaction blanks and the scan, which skips a plain word, does not flag.
    for (const line of ['password=hunter', 'password=hunter_xyz', 'token=Correct_Horse']) {
      expect(await found(line), line).toBe(false)
      expect(redact(line), line).toContain('[REDACTED secret]')
    }
    for (const line of ['PASSWORD=abc12', 'PASSWORD=ab-c', 'password=a1b2', 'token="a b c"', 'password: "reset flow"', 'password="ab c"']) await loud(line)
    // Three characters never.
    for (const line of ['PASSWORD=a1b', 'password="abc"']) await quiet(line)
  })

  test('(b) a short path or substitution, the shell\'s own PWD and OLDPWD: not secrets; the keyword in any other name is', async () => {
    for (const line of ['export PWD=/tmp', 'OLDPWD=/work', 'pwd=`pwd`', 'PWD=/home/me/project', 'OLDPWD=/work/project/sub', 'export PWD=$(pwd)', '{"PWD": "/work/x"}', 'pwd=/tmp', 'token=~/x', 'token=/work', 'pwd=$PWD', 'PWD=hunter2xyz']) await quiet(line)
    // PWD must be the whole name, in capitals: `pwd` is a keyword anywhere else.
    for (const line of ['pwd=hunter2xyz', 'MYPWD=hunter2xyz', 'NEWPWD=hunter2xyz', 'Pwd=hunter2xyz', 'DB_PWD=hunter2xyz']) await loud(line)
    // A longer path is redacted as it was on origin/main, whatever the name: only a path under 6 characters is let go.
    for (const line of ['pwd=/work/x', 'token=/home/me/.ssh/id', 'password=~/.secrets']) await loud(line)
  })

  test('(c) a call expression, a subscript chain, a positional default and a small number are code, not secrets', async () => {
    for (const line of [
      'const schema = { password: z.string().min(8) }',
      'token = crypto.randomBytes(32)',
      'token = uuid4()',
      'token = uuid.uuid4().hex',
      'token = response.json()["token"]',
      'token = await getToken(user)',
      'token = new Token(options)',
      'secret = config.get(name)',
      'PASSWORD=${1:-default}',
      'PASSWORD=${1}',
      'token = tokens[0]',
      'token = data.items[2][name]',
      'secret = ENV["SECRET"]',
      '"token": 1234',
      '"token": 12345,',
      'token = getToken(user, opts)',
      'password = Column(String(128), nullable=False)',
    ]) await quiet(line)
    for (const value of ['z.string().min(8)', 'crypto.randomBytes(32)', 'uuid4()', 'response.json()["token"]', 'await getToken(user)', 'new Token(options)', '${1:-default}', 'tokens[0]', 'getToken(user', 'getSecret(', 'response.json()[']) {
      expect(isPlaceholder(value), value).toBe(true)
      expect(isCodeReference(value), value).toBe(true)
    }
    // Six digits is a number a person might use as a password; a call with a literal or a string argument is not code.
    for (const line of ['"token": 123456', 'password=1234567']) await loud(line)
    // A number in quotes is a string a person may have chosen as a password: a finding, as it was.
    for (const line of ['"token": "1234"', "password = '12345'", 'password="12345"']) await loud(line)
  })

  test('(c) what only looks like a call is not one', () => {
    for (const value of ['Secret(abcd1234)', 'Sup3r(Secret)9', 'Sup3r(Secret9', 'getToken(abc12345def)', 'getToken("abcdef")', "getToken('abcdef')", 'f(a)(b)', 'f(a).', 'f(a)x', 'await', 'a.b', '(hunter2xyz)', '$ecret123!', 'x()[abcd1234efgh]']) {
      expect(isPlaceholder(value) && value !== 'await' && value !== 'a.b', value).toBe(false)
    }
    // A call cut at a space or a comma is code only while it holds names: not a digit, a symbol or a name with a digit in it.
    for (const value of ['Summer(2024!', 'Summer(2024', 'aec([e', 'pass(word!', 'Sup3r(Secret', 'Hunter(abc123']) expect(isPlaceholder(value), value).toBe(false)
    for (const value of ['getToken(user', 'Column(String(128)', 'a.b(c.d']) expect(isPlaceholder(value), value).toBe(true)
    expect(isCodeReference('Sup3r(Secret)9')).toBe(false)
    expect(isCodeReference('Secret(abcd1234)')).toBe(false)
  })

  test('(d) everything the reviews said must be caught, in the scan and in the redaction', async () => {
    for (const line of [
      'password=$ecret123!',
      'password=Sup3r(Secret)9',
      'password=<realkey12345>',
      'password=(hunter2xyz)',
      'PASSWORD=abc12',
      'password="my secret pass phrase"',
      "passwd: 'correct horse battery staple'",
      '{"token": "my secret pass phrase"}',
      'curl -u user:pass1234 https://example.com',
      'curl --user admin:s3cretpw https://example.com',
      'mysql -u root --password=s3cretpw1 app',
      'curl -H "Authorization: Token abcd1234efgh5678"',
      'curl -H "X-Api-Key: abcd1234efgh5678"',
      'curl -H "x-auth-token: abcd1234efgh5678"',
      'DB_PASSWORD=hunter2xyz',
      'token = "p4ssw0rd!"',
    ]) await loud(line)
  })

  test('nothing origin/main redacted is let go, but the lines (b) and (c) name: its redaction of ordinary code and of secrets stands', () => {
    for (const line of [
      'this.password = password',
      'DB_PASSWORD=changeme',
      'API_KEY=your-api-key-here',
      'secret: Secret<string>',
      'token = os.environ["API_TOKEN"]',
      'def login(user, password=None): pass',
      'password: !vault |',
      'tls.secret = tls-secret',
      'password=correcthorse',
      'GITHUB_TOKEN=abc123def456',
      'secret = hunter2',
      "api_key: 'Zx9-Qw7-Lm3-Pr5'",
      'curl -H "X-Api-Key: abcd1234efgh5678"',
      'DATABASE_URL=postgres://app:s3cretpw@db/app',
    ]) {
      expect(redact(line), line).not.toBe(line)
    }
  })

  test('every new or changed pattern stays linear on adversarial input', async () => {
    const size = 200_000
    const values = ['(', 'a(', 'a()', 'a().', 'a()[', 'a[', '[', ']', 'a(b)(c)', '${1:-', '`', '/', '~/', '0', 'await ', 'new a(']
    for (const value of values) {
      for (const input of [value.repeat(Math.ceil(size / value.length)), `password=${value.repeat(Math.ceil(size / value.length))}`, `password=a${value.repeat(Math.ceil(size / value.length))}`, `${'a'.repeat(size)}${value}`]) {
        const started = Date.now()
        redact(input)
        isPlaceholder(input)
        isCodeReference(input)
        await scanText(input)
        expect(Date.now() - started, value).toBeLessThan(1500)
      }
    }
    // A long run of calls and of nested parentheses.
    for (const input of [`password=${'a().'.repeat(size / 4)}`, `password=${'('.repeat(size)}`, `password=a${'('.repeat(size)}${')'.repeat(size)}`]) {
      const started = Date.now()
      redact(input)
      await scanText(input)
      expect(Date.now() - started, input.slice(0, 20)).toBeLessThan(1500)
    }
  })
})

describe('the words of this release (item 7)', () => {
  test('the question after a review approved because an unconfirmed project rule asks', () => {
    expect(text('escalate.askProject')).toBe("The project's rules file asks you about this call too, after its review.")
  })

  test('the new reason strings', () => {
    expect(text('escalate.secretPartial')).toContain('too long for the secrets scan to read in full')
  })
})
