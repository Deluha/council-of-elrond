import { describe, expect, test } from 'claude-code/testing'

import { loadConfig } from '../hooks/config/schema.js'
import { withAllowlistEntry } from '../hooks/config/write.js'
import { patternsWith, scanCall, scanText, warnsPasswordFingerprint } from '../hooks/members/gollum.js'
import { isCodeReference, isPlaceholder, redact, SECRET_PATTERNS } from '../hooks/redact.js'
import type { SecretPattern } from '../hooks/redact.js'
import {
  ALLOW_ONCE,
  ALLOWLIST,
  APPROVE,
  auditLines,
  council,
  denyOf,
  FAKE_AWS_KEY,
  FAKE_GITHUB_TOKEN,
  FAKE_GITLAB_TOKEN,
  FAKE_GOOGLE_OAUTH_SECRET,
  FAKE_JWT,
  FAKE_NPM_TOKEN,
  FAKE_PGP_KEY,
  FAKE_RANDOM_TOKEN,
  FAKE_SLACK_WEBHOOK,
  KEEP_BLOCKED,
  ROOT,
  settled,
  TALK_FIRST,
  world,
} from './fixtures.js'

const AWS = FAKE_AWS_KEY
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

describe('compound names, more formats and low patterns', () => {
  test('a compound name ending in a secret keyword is a low finding', async () => {
    for (const text of [
      'DB_PASSWORD=hunter2xyz',
      'POSTGRES_PASSWORD=hunter2xyz',
      'PGPASSWORD=hunter2xyz psql -h db',
      'GITHUB_TOKEN=abc123def456',
      'dbPassword: "hunter2xyz"',
    ]) {
      const scan = await scanText(text)
      expect(scan.low.map(finding => finding.patternId), text).toEqual(['assignment'])
      expect(JSON.stringify(scan), text).not.toContain('hunter2xyz')
      expect(redact(text), text).toContain('[REDACTED secret]')
    }
    expect((await scanText('TOKEN_FILE=/work/z.txt')).low).toEqual([])
    expect((await scanText('TOKEN_FILE=abc123def456')).low).toEqual([])
  })

  test('a name prefix of 64 characters before a secret keyword is still found; a longer one is capped', async () => {
    const prefix = `${'A'.repeat(63)}_`
    expect((await scanText(`${prefix}PASSWORD=hunter2xyz`)).low.map(finding => finding.patternId)).toEqual(['assignment'])
    expect(redact(`${prefix}PASSWORD=hunter2xyz`)).toContain('[REDACTED secret]')
    expect((await scanText(`A${prefix}PASSWORD=hunter2xyz`)).low).toEqual([])
  })

  test('a connection string is found with a 40-character scheme, a glued non-scheme prefix a digit-first scheme and a dash-first run', async () => {
    for (const text of [`${'a'.repeat(39)}b://user:pw1secret@host/db`, 'x-postgres://user:pw1secret@host/db', '1x://user:pw1secret@host', '-foo://user:pw1secret@host']) {
      const scan = await scanText(text)
      expect(scan.high.map(finding => finding.patternId), text).toEqual(['connection-string-password'])
      expect(JSON.stringify(scan), text).not.toContain('pw1secret')
      expect(redact(text), text).toContain('[REDACTED password]')
    }
  })

  test('every shipped pattern scans and redacts adversarial input in linear time', async () => {
    const prefixes: Record<string, string> = {
      'private-key': '-----BEGIN RSA PRIVATE KEY-----\n',
      'aws-access-key': 'AKIA',
      'github-token': 'ghp_',
      'anthropic-key': 'sk-ant-',
      'openai-key': 'sk-',
      'slack-token': 'xoxb-',
      'google-api-key': 'AIza',
      'stripe-key': 'sk_live_',
      'gitlab-token': 'glpat-',
      'npm-token': 'npm_',
      'google-oauth-secret': 'GOCSPX-',
      'slack-webhook': 'https://hooks.slack.com/services/T',
      'connection-string-password': 'postgres://a:',
      assignment: 'password=',
      jwt: 'eyJ',
      'authorization-header': 'authorization: bearer ',
      'mysql-password': 'mysql x ',
      'curl-user-password': 'curl -u a:',
      'connection-string-empty-user': 'redis://:',
    }
    const size = 200_000
    for (const pattern of SECRET_PATTERNS) {
      expect(prefixes[pattern.id], `${pattern.id}: add a prefix to this test`).toBeDefined()
      const prefix = prefixes[pattern.id] ?? 'a'
      const inputs = [
        'a'.repeat(size),
        prefix.repeat(Math.ceil(size / prefix.length)),
        `${prefix} `.repeat(Math.ceil(size / (prefix.length + 1))),
        `${prefix}${'a'.repeat(size)}`,
        `${'a'.repeat(size)}${prefix}`,
      ]
      for (const [index, input] of inputs.entries()) {
        const started = Date.now()
        redact(input)
        await scanText(input)
        expect(Date.now() - started, `${pattern.id} input ${index}`).toBeLessThan(1000)
      }
    }
  })

  test('new high formats are high findings', async () => {
    const samples: [string, string][] = [
      ['gitlab-token', FAKE_GITLAB_TOKEN],
      ['npm-token', FAKE_NPM_TOKEN],
      ['google-oauth-secret', FAKE_GOOGLE_OAUTH_SECRET],
      ['slack-webhook', FAKE_SLACK_WEBHOOK],
      ['private-key', FAKE_PGP_KEY],
    ]
    for (const [id, sample] of samples) {
      const scan = await scanText(`x ${sample} y`)
      expect(scan.high.map(finding => finding.patternId), id).toEqual([id])
      expect(JSON.stringify(scan), id).not.toContain(sample.slice(8))
      expect(redact(sample), id).toContain('[REDACTED')
    }
  })

  test('new low formats are low findings', async () => {
    const samples: [string, string, string][] = [
      ['jwt', `token_value ${FAKE_JWT}`, FAKE_JWT],
      ['authorization-header', 'curl -H "Authorization: Bearer abcd1234efgh5678"', 'abcd1234efgh5678'],
      ['mysql-password', 'mysql -h db -u root -pS3cretPw1 app', 'S3cretPw1'],
      ['connection-string-empty-user', 'REDIS_URL=redis://:S3cretPw1@cache:6379', 'S3cretPw1'],
    ]
    for (const [id, text, secret] of samples) {
      const scan = await scanText(text)
      expect(scan.high, id).toEqual([])
      expect(scan.low.map(finding => finding.patternId), id).toContain(id)
      expect(JSON.stringify(scan), id).not.toContain(secret)
      expect(redact(text), id).not.toContain(secret)
    }
    expect((await scanText('mysql -h db -P3306 -u root app')).low).toEqual([])
  })
})

describe('redaction keeps code', () => {
  test('plainly-code values are left as written, any other value is redacted', () => {
    for (const text of [
      'const token = process.env.API_TOKEN',
      'password: string',
      'token = tokens[0]',
      'token: string[]',
      'password = getPassword()',
      'secret = config.keys[name]',
    ]) {
      expect(redact(text), text).toBe(text)
    }
    expect(redact('password = "hunter2xyz"')).toBe('password = "[REDACTED secret]"')
    expect(redact('password=correcthorse')).toBe('password=[REDACTED secret]')
    for (const value of ['tokens[0]', 'config.keys[name]', 'process.env.API_TOKEN', 'String', 'number[]', '********', '$TOKEN']) {
      expect(isCodeReference(value), value).toBe(true)
    }
    for (const value of ['hunter2xyz', 'correcthorse', 'a.b!c']) expect(isCodeReference(value), value).toBe(false)
  })

  test('the scan keeps its own placeholder test: indexing is a finding, a plain word is not', async () => {
    expect(isPlaceholder('tokens[0]')).toBe(false)
    expect((await scanText('token = tokens[0]')).low).toHaveLength(1)
    expect((await scanText('password=correcthorse')).low).toEqual([])
    for (const text of ['const token = process.env.API_TOKEN', 'password: string']) expect((await scanText(text)).low, text).toEqual([])
  })

  test('redacting twice is the same as once, for every shipped pattern', () => {
    const text = [
      FAKE_AWS_KEY,
      FAKE_GITHUB_TOKEN,
      FAKE_GITLAB_TOKEN,
      FAKE_NPM_TOKEN,
      FAKE_GOOGLE_OAUTH_SECRET,
      FAKE_SLACK_WEBHOOK,
      FAKE_PGP_KEY,
      FAKE_JWT,
      `sk-ant-${'abcdefghij'.repeat(3)}`,
      `sk-${'abcdefghij'.repeat(4)}`,
      'xoxb-1234567890-abcdef',
      `AIza${'abcdefghij'.repeat(3)}abcde`,
      `sk_live_${'abcdefghij'.repeat(3)}`,
      'DATABASE_URL=postgres://app:s3cretpw@db/app',
      'REDIS_URL=redis://:S3cretPw1@cache:6379',
      'DB_PASSWORD=hunter2xyz',
      '{"password":\\"hunter2xyz\\"}',
      'curl -H "Authorization: Bearer abcd1234efgh5678"',
      'mysql -h db -u root -pS3cretPw1 app',
      `x = "${FAKE_RANDOM_TOKEN}"`,
    ].join('\n')
    const once = redact(text)
    expect(once).not.toBe(text)
    expect(redact(once)).toBe(once)
    for (const pattern of SECRET_PATTERNS) expect(once.match(new RegExp(pattern.re.source, pattern.re.flags))?.[0], pattern.id).toBeUndefined()
  })
})

const lowIds = async (text: string): Promise<string[]> => (await scanText(text)).low.map(finding => finding.patternId)
const patternOf = (id: string): SecretPattern => {
  const pattern = SECRET_PATTERNS.find(candidate => candidate.id === id)
  if (pattern === undefined) throw new Error(`no pattern ${id}`)
  return pattern
}

describe('placeholders are whole references, not values that start like one', () => {
  test('a value that is wholly a variable, template, call or mask is neither flagged nor redacted', async () => {
    for (const value of [
      '$HOME',
      '$DB_PASS',
      '${DB_PASSWORD}',
      '${DB_PASSWORD:-}',
      '${DB_PASSWORD:-changeme}',
      '${DB_PASSWORD:-$OTHER_PASS}',
      '$(pass_show)',
      '$(vault read -field=pw x)',
      '%DB_PASSWORD%',
      '%(password)s',
      '<your-api-key>',
      '<your api key>',
      '<token>',
      '{{ secrets.TOKEN }}',
      '{{secrets.TOKEN}}',
      '{password}',
      '{db_password}',
      '****',
      '********',
      'process.env.API_TOKEN',
      'getToken()',
      'getSecret(',
      'config.get(name)',
    ]) {
      const quoted = `password = "${value}"`
      expect(isPlaceholder(value), value).toBe(true)
      expect(isCodeReference(value), value).toBe(true)
      for (const text of [`password=${value}`, quoted]) {
        if (/\s/.test(value) && !text.includes('"')) continue
        const scan = await scanText(text)
        expect([...scan.high, ...scan.low], text).toEqual([])
        expect(redact(text), text).toBe(text)
      }
    }
  })

  test('a value that only starts like a reference, or holds a parenthesis, but reads as a literal is a finding and is redacted', async () => {
    for (const value of ['$ecret123!', 'Sup3r(Secret)9', 'Sup3r(Secret9', '<realkey12345>', '{realkey12345}', '(hunter2xyz)', '[hunter2xyz]', '*hunter2xyz', '%hunter2xyz', 'Secret(abcd1234)', '$(hunter2)x!']) {
      expect(isPlaceholder(value), value).toBe(false)
      expect(isCodeReference(value), value).toBe(false)
      const text = `password=${value}`
      expect(await lowIds(text), text).toEqual(['assignment'])
      expect(JSON.stringify(await scanText(text)), text).not.toContain(value)
      expect(redact(text), text).toBe('password=[REDACTED secret]')
    }
  })
})

describe('shapes the redaction missed', () => {
  test('a quoted value with spaces is one secret, for each keyword the pattern knows', async () => {
    for (const key of ['password', 'passwd', 'pwd', 'secret', 'token', 'api_key', 'DB_PASSWORD']) {
      for (const text of [`${key}="my secret pass phrase"`, `${key}: 'my secret pass phrase'`, `{"${key}": "my secret pass phrase"}`, `{"${key}":\\"my secret pass phrase\\"}`]) {
        expect(await lowIds(text), text).toEqual(['assignment'])
        const scan = JSON.stringify(await scanText(text))
        for (const word of ['my secret', 'pass phrase', 'phrase']) expect(scan, text).not.toContain(word)
        const out = redact(text)
        expect(out, text).toContain('[REDACTED secret]')
        for (const word of ['my s', 'secret pass', 'pass phrase', 'phrase']) expect(out, text).not.toContain(word)
      }
    }
    expect(redact('password="my secret pass phrase" --flag')).toBe('password="[REDACTED secret]" --flag')
    // A quoted template with spaces, a call and a type stay readable.
    for (const text of ['token: "{{ secrets.TOKEN }}"', 'password = "$(pass show db)"', 'password: "string"']) expect(redact(text), text).toBe(text)
    // A quoted value under 4 characters is not a password.
    expect(await lowIds('password="ab c"')).toEqual(['assignment'])
    expect(await lowIds('password="abc"')).toEqual([])
  })

  test('a value of 4 or 5 characters is a secret; 3 is not', async () => {
    for (const text of ['PASSWORD=abc12', 'password = "ab1c"', 'API_KEY=a1b2']) {
      expect(await lowIds(text), text).toEqual(['assignment'])
      expect(redact(text), text).toContain('[REDACTED secret]')
    }
    expect(redact('PASSWORD=abc12')).toBe('PASSWORD=[REDACTED secret]')
    expect(await lowIds('PASSWORD=a1b')).toEqual([])
    expect(redact('PASSWORD=a1b')).toBe('PASSWORD=a1b')
  })

  test('curl -u and --user: the password part goes, the user stays', async () => {
    for (const text of ['curl -u admin:s3cretpw https://example.com', 'curl -s --user admin:s3cretpw https://example.com', 'curl --user=admin:s3cretpw https://example.com', "curl -u 'admin:s3cretpw' https://example.com", 'curl -uadmin:s3cretpw https://example.com', 'curl https://example.com -u :s3cretpw']) {
      expect(await lowIds(text), text).toContain('curl-user-password')
      expect(JSON.stringify(await scanText(text)), text).not.toContain('s3cretpw')
      expect(redact(text), text).not.toContain('s3cretpw')
    }
    expect(redact('curl -u admin:s3cretpw https://example.com')).toBe('curl -u admin:[REDACTED password] https://example.com')
    expect(patternOf('curl-user-password').kind).toBe('password')
    for (const text of ['curl -u admin https://example.com', 'curl -u admin:$API_PASS https://example.com', 'curl --user-agent a:s3cretpw https://example.com', 'curl https://example.com:8080/x', 'wget -u admin:s3cretpw https://example.com']) {
      expect(await lowIds(text), text).not.toContain('curl-user-password')
    }
    expect(redact('curl -u admin:$API_PASS https://example.com')).toBe('curl -u admin:$API_PASS https://example.com')
    expect(redact('wget -u admin:s3cretpw https://example.com')).toContain('s3cretpw')
  })

  test('mysql programs: -pVALUE (attached), --password=VALUE and --password VALUE; a spaced -p is a prompt, then the database name', async () => {
    for (const text of ['mysql -u root --password=s3cretpw1 app', 'mysql -u root --password s3cretpw1 app', 'mysqldump -u root -ps3cretpw1 app', 'mariadb -h db -ps3cretpw1', 'mysqladmin --password\ts3cretpw1 status']) {
      // The mysql pattern alone: the assignment pattern would also catch the `--password=` form first.
      const mysql = [patternOf('mysql-password')]
      expect((await scanText(text, mysql)).low.map(finding => finding.patternId), text).toEqual(['mysql-password'])
      expect(redact(text, mysql), text).not.toContain('s3cretpw1')
      expect(redact(text), text).not.toContain('s3cretpw1')
      expect(JSON.stringify(await scanText(text)), text).not.toContain('s3cretpw1')
    }
    expect(redact('mysql -u root --password=s3cretpw1 app', [patternOf('mysql-password')])).toBe('mysql -u root --password=[REDACTED password] app')
    // A spaced -p prompts and the next word is the database name: neither flagged nor redacted, whatever the program or the word.
    for (const text of ['mysql -u app -p shop2024', 'mysqldump -u root -p s3cretpw1 app', 'mariadb -h db -p s3cretpw1', 'mysqladmin -p\ts3cretpw1 status']) {
      expect([...(await scanText(text)).low, ...(await scanText(text)).high], text).toEqual([])
      expect(redact(text), text).toBe(text)
    }
    // A flag, a redirect, a pipe, another program, a line break or a generic tool: no value.
    for (const text of ['mysql -u root --password -e "select 1"', 'mysql -u root --password < dump.sql', 'mysql -u root --password\nSELECT1x', 'mysql -u root --password | cat', 'psql -p s3cretpw1 db', 'ssh -p s3cretpw1 host', 'tool --password s3cretpw1', 'mysql -h db -P3306 -u root app']) {
      expect(await lowIds(text), text).not.toContain('mysql-password')
      expect(redact(text, [patternOf('mysql-password')]), text).toBe(text)
    }
  })

  test('Authorization: Token and ApiKey, X-Api-Key and X-Auth-Token headers, by the header pattern alone', async () => {
    const header = patternOf('authorization-header')
    for (const text of [
      'curl -H "Authorization: Token abcd1234efgh5678"',
      'curl -H "Authorization: ApiKey abcd1234efgh5678"',
      'curl -H "authorization: token abcd1234efgh5678"',
      'curl -H "X-Api-Key: abcd1234efgh5678"',
      'curl -H "x-auth-token: abcd1234efgh5678"',
      '{"X-Api-Key":\\"abcd1234efgh5678\\"}',
      'curl -H "Authorization: Basic abcd1234efgh5678"',
      'curl -H "Authorization: Bearer abcd1234efgh5678"',
    ]) {
      expect(redact(text, [header]), text).toContain('[REDACTED authorization header]')
      expect(redact(text, [header]), text).not.toContain('abcd1234')
      expect((await scanText(text, [header])).low.map(finding => finding.patternId), text).toEqual(['authorization-header'])
      expect(redact(text), text).not.toContain('abcd1234')
    }
    for (const text of ['Authorization: Token expired', 'Authorization: Token\nabcd1234efgh5678', 'X-Api-Key: short', 'Authorization: Digest abcd1234efgh5678']) {
      expect(redact(text, [header]), text).toBe(text)
    }
  })

  test('the new and widened patterns stay linear on adversarial input', () => {
    const size = 200_000
    const unit = ['password="', 'password=\'', 'password="a b ', 'curl -u ', 'curl -u a:', 'mysql x -p ', 'mysql --password ', 'authorization: token ', 'x-api-key: ']
    for (const prefix of unit) {
      for (const input of [prefix.repeat(Math.ceil(size / prefix.length)), `${prefix}${'a '.repeat(size / 2)}`, `${prefix}${'"'.repeat(size)}`, `${'a'.repeat(size)}${prefix}`]) {
        const started = Date.now()
        redact(input)
        expect(Date.now() - started, prefix).toBeLessThan(1000)
      }
    }
  })
})

describe('the scan cap', () => {
  const fill = (length: number) => 'x'.repeat(length)

  test('a text over the cap is also scanned at its end, and says it was not scanned in full', async () => {
    const tail = `\n${AWS}\n`
    const long = `${fill(600_000)}${tail}`
    const scan = await scanText(long)
    expect(scan.high.map(finding => finding.patternId)).toEqual(['aws-access-key'])
    expect(scan.partial).toBe(true)
    expect(JSON.stringify(scan)).not.toContain(AWS)
    // A secret within the first 500,000 characters is still found.
    expect((await scanText(`${AWS}\n${fill(600_000)}`)).high).toHaveLength(1)
  })

  test('a secret in the middle of a long text is not read, and the flag is the warning', async () => {
    const scan = await scanText(`${fill(500_100)}\n${AWS}\n${fill(300_000)}`)
    expect(scan.high).toEqual([])
    expect(scan.partial).toBe(true)
  })

  test('a text that the head and the tail cover whole is not partial; neither is a short one', async () => {
    expect((await scanText('password = "hunter2xyz"')).partial).toBe(false)
    expect((await scanText(fill(500_000))).partial).toBe(false)
    const covered = await scanText(`${fill(550_000)}\n${AWS}\n${fill(10)}`)
    expect(covered.high).toHaveLength(1)
    expect(covered.partial).toBe(false)
    expect((await scanText(fill(600_001))).partial).toBe(true)
    expect((await scanCall({ tool: 'Write', input: { file_path: 'a', content: fill(700_000) } })).partial).toBe(true)
    expect((await scanCall({ tool: 'Read', input: { file_path: 'a' } })).partial).toBe(false)
  })
})

describe('the password warning in the allowlist confirm', () => {
  test('which findings get it: by kind, shipped and configured', async () => {
    const kindOf = async (text: string, patterns?: ReturnType<typeof patternsWith>) => {
      const scan = await scanText(text, patterns)
      const [finding] = [...scan.high, ...scan.low]
      return finding === undefined ? undefined : warnsPasswordFingerprint(finding)
    }
    expect(await kindOf('password = "hunter2xyz"')).toBe(true)
    expect(await kindOf('mysql -h db -u root -pS3cretPw1 app')).toBe(true)
    expect(await kindOf('REDIS_URL=redis://:S3cretPw1@cache:6379')).toBe(true)
    expect(await kindOf('DATABASE_URL=postgres://app:s3cretpw@db/app')).toBe(true)
    expect(await kindOf(`x = "${FAKE_RANDOM_TOKEN}"`)).toBe(false)
    expect(await kindOf(`token_value ${FAKE_JWT}`)).toBe(false)
    expect(await kindOf(AWS)).toBe(false)
    const acme = { id: 'acme', level: 'low' as const, regex: 'ACME-[0-9]{8}', label: 'Acme' }
    expect(await kindOf('ACME-12345678', patternsWith([{ ...acme, kind: 'password' }]))).toBe(true)
    expect(await kindOf('ACME-12345678', patternsWith([acme]))).toBe(false)
  })

  test('rules.json accepts kind "password" or "token" and rejects anything else', () => {
    const pattern = { id: 'acme', level: 'low', regex: 'ACME-[0-9]{8}', label: 'Acme' }
    const load = (kind?: unknown) => loadConfig(JSON.stringify({ schemaVersion: 1, gollum: { patterns: [{ ...pattern, ...(kind === undefined ? {} : { kind }) }] } }))
    expect(load().errors).toEqual([])
    expect(load('password').errors).toEqual([])
    expect(load('token').errors).toEqual([])
    expect(load('password').compiled.config.gollum.patterns.at(-1)?.kind).toBe('password')
    expect(load('secret').errors).toEqual(['gollum.patterns[0].kind: one of password, token'])
    expect(load(3).errors).toEqual(['gollum.patterns[0].kind: one of password, token'])
  })

  test('shown for a password finding', async ($, on) => {
    const w = world(on, { answers: [ALLOWLIST, 'Cancel'], answer: KEEP_BLOCKED })
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/db.ts`, content: 'const password = "hunter2xyz"' })
    expect(w.asked[1]?.question).toMatch(/sha256:[0-9a-f]{16}/)
    expect(w.asked[1]?.question).toContain('can be guessed offline')
  })

  test('not shown for a random token', async ($, on) => {
    const w = world(on, { answers: [ALLOWLIST, 'Cancel'], answer: KEEP_BLOCKED })
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/key.ts`, content: `const k = "${FAKE_RANDOM_TOKEN}"` })
    expect(w.asked[1]?.question).toMatch(/sha256:[0-9a-f]{16}/)
    expect(w.asked[1]?.question).not.toContain('can be guessed offline')
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
    expect((await auditLines(w))[0]).toMatchObject({ member: 'gollum', verdict: 'block', outcome: 'refused' })
    await settled(w)
    expect(w.files.get(`${ROOT}/.claude/council-of-elrond/audit/audit.jsonl`)).not.toContain(AWS)
  })

  test('a low finding asks with a redacted snippet; allow once goes on to the review', async ($, on) => {
    const w = world(on, { answer: ALLOW_ONCE, replies: [APPROVE] })
    const call = { tool: 'Write', file_path: `${ROOT}/src/db.ts`, content: 'const password = "hunter2xyz"' } as const
    expect(await $.tool.call(call)).toEqual({ result: 'ran' })
    expect(w.asked[0]?.options).toEqual([ALLOW_ONCE, ALLOWLIST, KEEP_BLOCKED, TALK_FIRST])
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
    expect((await auditLines(w))[0]).toMatchObject({ decision: 'allowlist', outcome: 'ran' })

    // The next call with the same secret is not asked about.
    await $.tool.call(call)
    expect(w.asked).toHaveLength(2)
    expect(w.ran).toHaveLength(2)
  })

  test('several possible secrets: no allowlist option', async ($, on) => {
    const w = world(on, { answer: KEEP_BLOCKED })
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/db.ts`, content: 'password = "hunter2xyz"\ntoken = "abc123def456"' })
    expect(w.asked[0]?.options).toEqual([ALLOW_ONCE, KEEP_BLOCKED, TALK_FIRST])
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

  test('a configured pattern from the rules file is enforced and redacted', { options: { trustProjectRules: 'always' } }, async ($, on) => {
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
    expect(await auditLines(w)).toHaveLength(2)
    for (const line of await auditLines(w)) expect(line).toMatchObject({ tier: 'allow', member: 'gollum', verdict: 'block', outcome: 'refused', opKey: null, decision: null })
    await settled(w)
    expect(w.files.get(AUDIT)).not.toContain(AWS)
  })

  test('a low finding runs: nobody is asked and nothing is logged', async ($, on) => {
    const w = world(on)
    expect(await $.tool.call({ tool: 'Bash', command: 'echo password=hunter2xyz' })).toEqual({ result: 'ran' })
    expect(w.asked).toEqual([])
    expect(w.ran).toHaveLength(1)
    expect(await auditLines(w)).toEqual([])
  })

  test('an allowlisted high secret runs', { options: { trustProjectRules: 'always' } }, async ($, on) => {
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
    expect((await auditLines(w))[0]).toMatchObject({ shadow: false, outcome: 'refused' })
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
    expect((await auditLines(w))[0]).toMatchObject({ tier: 'allow', agentId: 'sub-1' })
  })

  test('/council report counts it as refused by the secrets scan', async ($, on) => {
    const w = world(on, { surfaces: [] })
    await $.tool.call({ tool: 'Bash', command: `echo ${AWS}` })
    await settled(w)
    await council($, 'report')
    expect(w.logs.join('\n')).toContain('(no rule): 1 (by the secrets scan 1)')
  })
})
