// Shared by the script tests: child processes that never see the git variables of the process that
// runs the tests.
//
// Git exports GIT_DIR, GIT_INDEX_FILE and GIT_WORK_TREE to its hooks. A test that builds a fixture
// repository with `git add` and `git commit` from inside pre-commit would then act on the real
// repository's index. Every child process of these tests is started with an environment that has no
// GIT_* variable from the parent; a test that wants one (GIT_CONFIG_GLOBAL, an author) passes it in
// `extra`, after the stripping. Use spawnClean, cleanEnv or fixtureGit; do not import spawnSync from
// node:child_process in a test file (helpers.test.mjs checks that).

import { spawnSync } from 'node:child_process'

/** The environment of this process without any GIT_* variable, plus `extra`. */
export function cleanEnv(extra = {}) {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith('GIT_')) env[key] = value
  return { ...env, ...extra }
}

/**
 * spawnSync with the git variables stripped. An `env` in `options` is the whole environment of the
 * child, as with spawnSync, and is used as given: build it with cleanEnv (or from nothing).
 */
export function spawnClean(command, args, options = {}) {
  return spawnSync(command, args, { ...options, env: options.env ?? cleanEnv() })
}

/** The identity and the config a fixture repository needs, so that no global git config is read. */
export const GIT_FIXTURE_ENV = {
  GIT_AUTHOR_NAME: 'me',
  GIT_AUTHOR_EMAIL: 'me@example.com',
  GIT_COMMITTER_NAME: 'me',
  GIT_COMMITTER_EMAIL: 'me@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
}

/** Run git in a fixture repository: returns the spawnSync result; GIT_* of the parent are stripped. */
export function fixtureGit(cwd, ...args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', env: cleanEnv(GIT_FIXTURE_ENV) })
}
