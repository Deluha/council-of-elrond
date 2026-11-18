// Tests for scripts/tests/helpers.mjs: the fixture helpers never act on the repository whose git
// variables are in the environment (the case under the pre-commit hook). Offline.
// Run: node --test scripts/tests/

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { cleanEnv, fixtureGit, spawnClean } from './helpers.mjs'

const here = dirname(fileURLToPath(import.meta.url))

const made = []
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})
const tmp = (prefix) => {
  const d = mkdtempSync(join(tmpdir(), prefix))
  made.push(d)
  return d
}

/** Set environment variables for the length of a function, then put them back. */
async function withEnv(vars, fn) {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]))
  Object.assign(process.env, vars)
  try {
    return await fn()
  } finally {
    for (const [k, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[k]
      else process.env[k] = value
    }
  }
}

describe('the git variables of the parent never reach a fixture', () => {
  test('cleanEnv drops every GIT_* variable and keeps the rest; extra comes after the stripping', async () => {
    await withEnv({ GIT_DIR: '/decoy', GIT_INDEX_FILE: '/decoy/index', GIT_WORK_TREE: '/decoy', GIT_AUTHOR_NAME: 'nobody', COUNCIL_TEST_KEEP: '1' }, () => {
      const env = cleanEnv({ GIT_CONFIG_GLOBAL: '/dev/null' })
      assert.deepEqual(Object.keys(env).filter((k) => k.startsWith('GIT_')), ['GIT_CONFIG_GLOBAL'])
      assert.equal(env.COUNCIL_TEST_KEEP, '1')
    })
  })

  test('fixtureGit builds a repository with GIT_DIR and GIT_INDEX_FILE pointing at a decoy, and leaves the decoy untouched', async () => {
    const decoy = tmp('decoy-')
    const decoyDir = join(decoy, 'git-dir')
    mkdirSync(decoyDir)
    const decoyIndex = join(decoy, 'index')
    writeFileSync(decoyIndex, 'decoy index')
    const fixture = tmp('fixture-')
    writeFileSync(join(fixture, 'a.txt'), 'hi\n')
    await withEnv({ GIT_DIR: decoyDir, GIT_INDEX_FILE: decoyIndex, GIT_WORK_TREE: decoy }, () => {
      for (const args of [['init', '-q', '-b', 'main'], ['add', '.'], ['commit', '-q', '-m', 'fixture']]) {
        const r = fixtureGit(fixture, ...args)
        assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
      }
    })
    assert.ok(existsSync(join(fixture, '.git')), 'the fixture got its own repository')
    assert.deepEqual(readdirSync(decoyDir), [], 'the decoy git dir was not written to')
    assert.equal(readFileSync(decoyIndex, 'utf8'), 'decoy index', 'the decoy index was not touched')
    assert.deepEqual(readdirSync(decoy).sort(), ['git-dir', 'index'])
    assert.match(fixtureGit(fixture, 'log', '--format=%s').stdout, /fixture/)
  })

  test('spawnClean starts a child with no GIT_* variable unless the caller passes an env', async () => {
    await withEnv({ GIT_DIR: '/decoy', GIT_INDEX_FILE: '/decoy/index' }, () => {
      const show = "console.log(Object.keys(process.env).filter((k) => k.startsWith('GIT_')).join(','))"
      assert.equal(spawnClean(process.execPath, ['-e', show], { encoding: 'utf8' }).stdout.trim(), '')
      assert.equal(spawnClean(process.execPath, ['-e', show], { encoding: 'utf8', env: { GIT_X: '1' } }).stdout.trim(), 'GIT_X')
    })
  })

  test('no test file starts a child process without the helper', () => {
    const imports = new RegExp(`from '${'node:child'}_process'`)
    const spreads = new RegExp(`\\.\\.\\.${'process'}\\.env`)
    for (const f of readdirSync(here).filter((n) => n.endsWith('.mjs') && n !== 'helpers.mjs')) {
      const text = readFileSync(join(here, f), 'utf8')
      assert.doesNotMatch(text, imports, `${f} imports the child-process module; use ./helpers.mjs`)
      assert.doesNotMatch(text, spreads, `${f} spreads the process environment; use cleanEnv()`)
    }
  })
})
