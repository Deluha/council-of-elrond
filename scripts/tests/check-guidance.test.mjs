// Tests for scripts/check-guidance.mjs: a fixture tree per check, a passing and a failing case each.
// Run: node --test scripts/tests/

import assert from 'node:assert/strict'
import { spawnClean } from './helpers.mjs'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import * as g from '../check-guidance.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name) => readFileSync(join(here, 'fixtures', 'ask', name), 'utf8')
const SCRIPT = join(here, '..', 'check-guidance.mjs')

const SKILL = '.claude/skills/council-of-elrond-development'
const REFS = `${SKILL}/references`

const EVALS_OK = JSON.stringify({ evals: [{ id: 'a', expect_reads: ['references/workflows/add-rule.md'] }, { id: 'b', expect_reads: [] }] }, null, 2)

const made = []
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

/** A tree that passes every check; each test changes it a little. Returns { root, put, remove }. */
function tree(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'guidance-'))
  made.push(root)
  const files = {
    'CLAUDE.md': `# project\n\n## Hard rules\n\n- R1 Never load it. \`${REFS}/conventions.md#r1\`\n- R2 Never edit it. \`${REFS}/conventions.md#r2\`\n\n${fixture('ask-first.md')}`,
    '.claude/settings.json': fixture('settings.json'),
    '.github/CODEOWNERS': fixture('CODEOWNERS'),
    '.github/workflows/ci-tests.yml': 'jobs:\n  hygiene:\n    steps:\n      - run: node scripts/check-guidance.mjs\n      - run: node --test scripts/tests/\n',
    '.githooks/pre-commit': '#!/bin/sh\nexec node scripts/verify.mjs --staged\n',
    'scripts/verify.mjs': "// the guidance row\nconst r = run('node', ['scripts/check-guidance.mjs', '--json'], { cwd: root })\n",
    [`${SKILL}/SKILL.md`]: '---\nname: council-of-elrond-development\ndescription: x\n---\n\n| Task | File under `references/` |\n| :- | :- |\n| Rules | `conventions.md` |\n| Style | `style.md` |\n| Add a rule | `workflows/add-rule.md` |\n| Roles | `recipes-orchestration.md` |\n',
    [`${REFS}/conventions.md`]: '# Conventions\n\n<a id="r1"></a>\n## R1 Never load the mod\n\nText.\n\n<a id="r2"></a>\n## R2 Never edit the types\n\nText.\n\n## The pinned build\n',
    [`${REFS}/style.md`]: '# Style\n\nSee `conventions.md#the-pinned-build`.\n',
    [`${REFS}/workflows/add-rule.md`]: '# Add a rule\n',
    [`${SKILL}/evals/evals.json`]: EVALS_OK,
    [`${REFS}/recipes-orchestration.md`]: '# Roles\n\n| Role | Model |\n| :- | :- |\n| implementer | sonnet |\n| reader | haiku |\n',
    '.claude/rules/classifier.md': '---\npaths:\n  - "mods/council-of-elrond/hooks/rules/**"\n---\n\n- Adding a rule: `references/workflows/add-rule.md`\n- Rules that apply: R1\n',
    '.claude/skills/verify/SKILL.md': '---\nname: verify\ndescription: x\n---\n\n# Verify\n\n- Run `scripts/verify.mjs` with node.\n',
    '.claude/agents/implementer.md': '---\nname: implementer\nmodel: sonnet\n---\n\nEdit what the brief names. Roles: `references/recipes-orchestration.md`\n',
    // The files the ask-first list names, so that its pointers resolve.
    'mods/council-of-elrond/hooks/config/defaults.ts': '',
    'mods/council-of-elrond/hooks/config/trust.ts': '',
    'mods/council-of-elrond/hooks/config/schema.ts': '',
    'mods/council-of-elrond/hooks/redact.ts': '',
    'mods/council-of-elrond/hooks/members/gollum.ts': '',
    'mods/council-of-elrond/.claude-plugin/plugin.json': '{}',
    '.claude-plugin/marketplace.json': '{}',
    'SECURITY.md': '',
    LICENSE: '',
    'README.md': '# root\n',
    'CHANGELOG.md': '',
    'mods/council-of-elrond/SPEC.md': '',
    'mods/council-of-elrond/types/index.d.ts': '',
    ...Object.fromEntries(
      ['register', 'state', 'audit', 'members/shared', 'members/brief', 'members/galadriel', 'elrond/operations', 'elrond/commands', 'elrond/escalation', 'elrond/refusal', 'elrond/suggest', 'elrond/chat'].map((n) => [`mods/council-of-elrond/hooks/${n}.ts`, '']),
    ),
    ...overrides,
  }
  const put = (rel, text) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), text)
  }
  for (const [rel, text] of Object.entries(files)) if (text !== null) put(rel, text)
  const remove = (rel) => rmSync(join(root, rel), { force: true })
  return { root, put, remove }
}

const ids = (findings) => findings.map((f) => f.id)
const messages = (findings) => findings.map((f) => `${f.file}:${f.line} ${f.message}`).join('\n')

describe('the baseline tree', () => {
  test('passes every check', () => {
    const { root } = tree()
    assert.deepEqual(g.checkAll(root), [])
  })
})

describe('G1 pointers resolve', () => {
  test('a missing path fails, with its line', () => {
    const { root, put } = tree()
    put('.claude/rules/x.md', '---\npaths:\n  - a\n---\n\n- See `docs/nowhere.md`\n')
    const f = g.checkG1(root)
    assert.equal(f.length, 1)
    assert.equal(f[0].file, '.claude/rules/x.md')
    assert.equal(f[0].line, 6)
  })

  test('an ambiguous path fails', () => {
    const { root, put } = tree()
    put('mods/council-of-elrond/README.md', '# mod\n')
    put('.claude/rules/x.md', 'See `README.md`\n')
    const f = g.checkG1(root)
    assert.equal(f.length, 1)
    assert.match(f[0].message, /ambiguous/)
  })

  test('the lookup order: root, the mod, the skill folder, its references', () => {
    const { root, put } = tree()
    put('mods/council-of-elrond/hooks/register.ts', '')
    put('.claude/rules/x.md', 'See `hooks/register.ts`, `references/conventions.md`, `conventions.md` and `workflows/add-rule.md`.\n')
    assert.deepEqual(g.checkG1(root), [])
  })

  test('a leading slash means the repository root, and a glob is a pattern, not a path', () => {
    const { root, put } = tree()
    put('.claude/rules/x.md', 'See `/SECURITY.md`, `/.github/**`, `/mods/council-of-elrond/hooks/rules/**` and `.claude/rules/*.md`.\n')
    assert.deepEqual(g.checkG1(root), [])
    put('.claude/rules/y.md', 'See `/NOPE.md`.\n')
    assert.equal(g.checkG1(root).length, 1)
  })

  test('commands, code, slash commands, import specifiers and prose are skipped; a path:line suffix is stripped', () => {
    const { root, put } = tree()
    put('mods/council-of-elrond/hooks/register.ts', '')
    put(
      '.claude/rules/x.md',
      'Run `node scripts/verify.mjs --all`, `/verify`, `next(`, `$.state`, `tool.check`, `opus/sonnet`, `./schema.js`, `.ts`, `https://example.com/a.md`, `<name>.md` and `hooks/register.ts:1772-1776`.\n',
    )
    assert.deepEqual(g.checkG1(root), [])
  })

  test('fenced code is not read', () => {
    const { root, put } = tree()
    put('.claude/rules/x.md', '```\nSee `docs/nowhere.md`\n```\n')
    assert.deepEqual(g.checkG1(root), [])
  })

  test('only CLAUDE.md and .claude/ are read, and the pointer documents for their .claude/ and scripts/ pointers', () => {
    const { root, put } = tree()
    put('docs/other.md', 'See `docs/nowhere.md`\n')
    assert.deepEqual(g.checkG1(root), [])
    assert.deepEqual([...g.POINTER_DOCS].sort(), ['CONTRIBUTING.md', 'docs/DEVELOPMENT.md', 'docs/GITHUB.md', 'docs/MAINTENANCE.md'])
    for (const file of g.POINTER_DOCS) {
      put(file, 'Prose with `docs/nowhere.md`, `src/x.ts`, `a/b.md` and a good pointer `.claude/skills/verify/SKILL.md` and `scripts/verify.mjs`.\n')
      assert.deepEqual(g.checkG1(root), [], file)
      put(file, 'See `.claude/skills/council-of-elrond-development/references/gone.md`.\n')
      const f = g.checkG1(root)
      assert.equal(f.length, 1, file)
      assert.equal(f[0].file, file)
      put(file, 'See `scripts/gone.mjs`.\n')
      assert.equal(g.checkG1(root).length, 1, file)
      put(file, '# x\n')
    }
  })

  test('a token that starts with ./scripts/ or ./.claude/ is a pointer from the root, in the pointer documents', () => {
    const { root, put } = tree()
    for (const file of g.POINTER_DOCS) {
      put(file, 'See `./scripts/verify.mjs`, `./.claude/skills/verify/SKILL.md` and `./schema.js`, `./other/x.md`.\n')
      assert.deepEqual(g.checkG1(root), [], file)
      put(file, 'See `./scripts/gone.mjs`.\n')
      assert.equal(g.checkG1(root).length, 1, `${file}: ./scripts/`)
      put(file, 'See `./.claude/skills/gone/SKILL.md`.\n')
      assert.equal(g.checkG1(root).length, 1, `${file}: ./.claude/`)
      put(file, '# x\n')
    }
  })

  test('the first argument of a node, bash or sh command is a pointer, in every file read; a flag first is not', () => {
    const { root, put } = tree()
    put('.claude/rules/x.md', 'Run `node scripts/verify.mjs --all`, `bash scripts/verify.mjs`, `sh scripts/verify.mjs`, `node --test scripts/tests/` and `node <file>`.\n')
    assert.deepEqual(g.checkG1(root), [])
    for (const cmd of ['node scripts/gone.mjs --all', 'bash scripts/gone.sh', 'sh scripts/gone.sh', 'node ./scripts/gone.mjs']) {
      put('.claude/rules/x.md', `Run \`${cmd}\`.\n`)
      const f = g.checkG1(root)
      assert.equal(f.length, 1, cmd)
      assert.match(f[0].message, /does not resolve/, cmd)
    }
    put('.claude/rules/x.md', '# x\n')
    for (const file of g.POINTER_DOCS) {
      put(file, 'Run `node scripts/gone.mjs`, and `node src/other.js`.\n')
      const f = g.checkG1(root)
      assert.equal(f.length, 1, file)
      assert.equal(f[0].file, file)
      put(file, '# x\n')
    }
    put('.claude/rules/x.md', 'Run `node scripts/verify.mjs#gone`.\n')
    assert.equal(g.checkG2(root).length, 0, 'verify.mjs is not markdown; no anchor check')
  })

  test('a slash command naming one of the command skills needs its SKILL.md; an unknown name is skipped', () => {
    const { root, put } = tree()
    put('.claude/rules/x.md', 'Run `/verify` or `/verify --all`.\n')
    assert.deepEqual(g.checkG1(root), [])
    // A folder with no SKILL.md is a command skill that lost its file; a name with no folder is not a command of this repository.
    put('.claude/skills/live-check/notes.md', 'x\n')
    put('.claude/rules/x.md', 'Run `/live-check` and `/live-check a probe`, `/compact` and `/nothing-here`.\n')
    const f = g.checkG1(root)
    assert.equal(f.length, 2)
    assert.match(messages(f), /\/live-check.*no \.claude\/skills\/live-check\/SKILL\.md/)
    put('.claude/skills/live-check/SKILL.md', '---\nname: live-check\n---\n\nSee `scripts/verify.mjs`.\n')
    assert.deepEqual(g.checkG1(root), [])
  })

  test('the command skills are the folders under .claude/skills/ except the development skill: a new one needs no edit', () => {
    const { root, put } = tree()
    assert.deepEqual(g.commandSkills(root), ['verify'])
    put('.claude/skills/brand-new/notes.md', 'x\n')
    assert.deepEqual(g.commandSkills(root), ['brand-new', 'verify'])
    put('.claude/rules/x.md', 'Run `/brand-new`, `/council-of-elrond-development`.\n')
    const f = g.checkG1(root)
    assert.equal(f.length, 1)
    assert.match(f[0].message, /\/brand-new/)
    put('.claude/skills/brand-new/SKILL.md', '---\nname: brand-new\n---\n\nSee `scripts/verify.mjs`.\n')
    assert.deepEqual(g.checkG1(root), [])
    assert.deepEqual(g.commandSkills(join(root, 'nowhere')), [])
  })

  test('an unclosed code fence is a finding, at the line that opens it', () => {
    const { root, put } = tree()
    put('.claude/rules/x.md', 'Text\n\n```sh\nls\n\nSee `docs/nowhere.md` (hidden by the fence)\n')
    const f = g.checkG1(root)
    assert.equal(f.length, 1)
    assert.equal(f[0].line, 3)
    assert.match(f[0].message, /never closed/)
    put('.claude/rules/x.md', '```sh\nls\n```\n\n~~~\nx\n~~~\n')
    assert.deepEqual(g.checkG1(root), [])
    put('.claude/rules/x.md', '````\n```\n````\n')
    assert.deepEqual(g.checkG1(root), [])
  })
})

describe('G2 anchors', () => {
  test('a renamed heading fails', () => {
    const { root, put } = tree()
    put(`${REFS}/conventions.md`, '# Conventions\n\n<a id="r1"></a>\n## R1 x\n\n<a id="r2"></a>\n## R2 y\n\n## The build\n')
    const f = g.checkG2(root)
    assert.equal(f.length, 1)
    assert.match(f[0].message, /#the-pinned-build/)
    assert.equal(f[0].file, `${REFS}/style.md`)
  })

  test('GitHub slug rules: punctuation dropped, duplicates suffixed', () => {
    assert.equal(g.slugOf('R1: Never load `the` mod (ever)!'), 'r1-never-load-the-mod-ever')
    assert.equal(g.slugOf('The pinned build'), 'the-pinned-build')
    const set = g.anchorsOf('## A\n\n## A\n')
    assert.ok(set.has('a') && set.has('a-1'))
  })

  test('the three documents are read for anchors in their .claude/ and scripts/ pointers only', () => {
    const { root, put } = tree()
    put('docs/DEVELOPMENT.md', 'See `references/conventions.md#r1` and `.claude/skills/council-of-elrond-development/references/conventions.md#r1`.\n')
    assert.deepEqual(g.checkG2(root), [])
    put('docs/DEVELOPMENT.md', 'See `.claude/skills/council-of-elrond-development/references/conventions.md#gone` and `#own`, `docs/x.md#y`.\n')
    const f = g.checkG2(root)
    assert.equal(f.length, 1)
    assert.equal(f[0].file, 'docs/DEVELOPMENT.md')
    assert.match(f[0].message, /#gone/)
  })

  test('an explicit anchor and a bare self-anchor both count', () => {
    const { root, put } = tree()
    put('.claude/rules/x.md', 'See `references/conventions.md#r1`, `references/conventions.md#r2` and `#own`.\n\n## Own\n')
    assert.deepEqual(g.checkG2(root), [])
    put('.claude/rules/x.md', 'See `#gone`.\n')
    assert.equal(g.checkG2(root).length, 1)
  })
})

describe('G3 CLAUDE.md budget', () => {
  test('80 lines pass and line 81 fails', () => {
    const { root, put } = tree()
    put('CLAUDE.md', `${Array.from({ length: 80 }, () => 'x').join('\n')}\n`)
    assert.deepEqual(g.checkG3(root), [])
    put('CLAUDE.md', `${Array.from({ length: 81 }, () => 'x').join('\n')}\n`)
    const f = g.checkG3(root)
    assert.equal(f.length, 1)
    assert.equal(f[0].line, 81)
  })

  test('the byte budget holds even with long lines', () => {
    const { root, put } = tree()
    put('CLAUDE.md', `${'x'.repeat(6144)}`)
    assert.deepEqual(g.checkG3(root), [])
    put('CLAUDE.md', `${'x'.repeat(6145)}`)
    assert.match(g.checkG3(root)[0].message, /bytes/)
  })

  test('a missing CLAUDE.md fails', () => {
    const { root, remove } = tree()
    remove('CLAUDE.md')
    assert.equal(g.checkG3(root).length, 1)
  })
})

describe('G4 the routing table', () => {
  const skill = (rows) => `---\nname: x\n---\n\n| Task | File under \`references/\` |\n| :- | :- |\n${rows}\n`

  test('zero rows for a reference file fails', () => {
    const { root, put } = tree()
    put(`${SKILL}/SKILL.md`, skill('| Rules | `conventions.md` |\n| Style | `style.md` |\n| Roles | `recipes-orchestration.md` |'))
    const f = g.checkG4(root)
    assert.equal(f.length, 1)
    assert.match(f[0].message, /workflows\/add-rule\.md has no row/)
  })

  test('two rows for one file fail', () => {
    const { root, put } = tree()
    put(`${SKILL}/SKILL.md`, skill('| Rules | `conventions.md` |\n| Again | `conventions.md` |\n| Style | `style.md` |\n| Add | `workflows/add-rule.md` |\n| Roles | `recipes-orchestration.md` |'))
    const f = g.checkG4(root)
    assert.equal(f.length, 1)
    assert.match(f[0].message, /2 rows/)
  })

  test('a dangling row fails, and a row naming no file fails', () => {
    const { root, put } = tree()
    put(`${SKILL}/SKILL.md`, skill('| Rules | `conventions.md` |\n| Style | `style.md` |\n| Add | `workflows/add-rule.md` |\n| Roles | `recipes-orchestration.md` |\n| Gone | `gone.md` |\n| Nothing | none |'))
    const f = g.checkG4(root)
    assert.equal(f.length, 2)
    assert.match(messages(f), /gone\.md, which does not exist/)
    assert.match(messages(f), /names no file/)
  })

  test('paths in the other columns are not routing rows, and a references/ prefix is allowed', () => {
    const { root, put } = tree()
    put(`${SKILL}/SKILL.md`, `---\nname: x\n---\n\n| Task about \`hooks/register.ts\` | File | Text that moves in |\n| :- | :- | :- |\n| a | \`references/conventions.md\` | \`CLAUDE.md\` |\n| b | \`style.md\` | \`DEVELOPMENT.md\` |\n| c | \`workflows/add-rule.md\` | |\n| d | \`recipes-orchestration.md\` | |\n`)
    assert.deepEqual(g.checkG4(root), [])
  })

  test('no SKILL.md fails', () => {
    const { root, remove } = tree()
    remove(`${SKILL}/SKILL.md`)
    assert.equal(g.checkG4(root).length, 1)
  })
})

describe('G5 reference size', () => {
  test('10240 bytes pass, one over fails', () => {
    const { root, put } = tree()
    put(`${REFS}/style.md`, 'x'.repeat(10240))
    assert.deepEqual(g.checkG5(root), [])
    put(`${REFS}/workflows/add-rule.md`, 'x'.repeat(10241))
    const f = g.checkG5(root)
    assert.equal(f.length, 1)
    assert.equal(f[0].file, `${REFS}/workflows/add-rule.md`)
  })
})

describe('G6 rule ids', () => {
  test('a duplicate definition fails', () => {
    const { root, put } = tree()
    put(`${REFS}/conventions.md`, '# C\n\n## R1 a\n\n## R1 again\n\n## R2 b\n')
    assert.match(messages(g.checkG6(root)), /R1 is defined 2 times/)
  })

  test('an unknown id fails', () => {
    const { root, put } = tree()
    put('.claude/rules/x.md', 'See R7 and R1.\n')
    const f = g.checkG6(root)
    assert.equal(f.length, 1)
    assert.match(f[0].message, /R7 is not defined/)
  })

  test('CLAUDE.md must list every defined id', () => {
    const { root, put } = tree()
    put(`${REFS}/conventions.md`, '# C\n\n## R1 a\n\n## R2 b\n\n## R3 c\n')
    assert.match(messages(g.checkG6(root)), /does not list R3/)
  })

  test('an id defined outside conventions.md fails; an anchor can define an id', () => {
    const { root, put } = tree()
    put('.claude/rules/x.md', '## R2 a second home\n')
    assert.match(messages(g.checkG6(root)), /defined only in references\/conventions\.md/)
    put('.claude/rules/x.md', 'plain\n')
    put(`${REFS}/conventions.md`, '# C\n\n<a id="r1"></a>\nText\n\n<a id="r2"></a>\nText\n')
    assert.deepEqual(g.checkG6(root), [])
  })
})

describe('G7 path rules', () => {
  const rule = (front, body) => `---\n${front}---\n\n${body}`
  const ok = '- See `references/workflows/add-rule.md`\n'

  test('a good rule passes', () => {
    const { root, put } = tree()
    put('.claude/rules/x.md', rule('paths:\n  - "a/**"\n', ok))
    put('.claude/rules/y.md', rule('paths: ["a/**"]\n', ok))
    assert.deepEqual(g.checkG7(root), [])
  })

  test('missing or empty paths: fails', () => {
    const { root, put } = tree()
    put('.claude/rules/x.md', rule('description: x\n', ok))
    put('.claude/rules/y.md', rule('paths:\n', ok))
    put('.claude/rules/z.md', ok)
    assert.equal(g.checkG7(root).length, 3)
  })

  test('seven lines fail, six pass', () => {
    const { root, put } = tree()
    put('.claude/rules/x.md', rule('paths: a\n', `${ok}${'- more\n'.repeat(5)}`))
    assert.deepEqual(g.checkG7(root), [])
    put('.claude/rules/x.md', rule('paths: a\n', `${ok}${'- more\n'.repeat(6)}`))
    assert.match(messages(g.checkG7(root)), /7 non-empty lines/)
  })

  test('a body with no pointer fails', () => {
    const { root, put } = tree()
    put('.claude/rules/x.md', rule('paths: a\n', 'Be careful. Rules R1.\n'))
    assert.match(messages(g.checkG7(root)), /no pointer/)
  })

  test('fenced code fails', () => {
    const { root, put } = tree()
    put('.claude/rules/x.md', rule('paths: a\n', `${ok}\`\`\`\nls\n\`\`\`\n`))
    assert.match(messages(g.checkG7(root)), /fenced code/)
  })
})

describe('G8 command skills', () => {
  test('16 non-empty body lines fail; 15 pass', () => {
    const { root, put } = tree()
    const body = (n) => `---\nname: x\n---\n\n- \`scripts/verify.mjs\`\n${Array.from({ length: n - 1 }, () => '- line').join('\n')}\n`
    put('.claude/skills/other/SKILL.md', body(15))
    assert.deepEqual(g.checkG8(root), [])
    put('.claude/skills/other/SKILL.md', body(16))
    const f = g.checkG8(root)
    assert.equal(f.length, 1)
    assert.match(f[0].message, /16 non-empty lines/)
  })

  test('no pointer fails, and the development skill is exempt', () => {
    const { root, put } = tree()
    put('.claude/skills/other/SKILL.md', '---\nname: x\n---\n\nJust prose.\n')
    assert.match(messages(g.checkG8(root)), /no pointer/)
    put('.claude/skills/other/SKILL.md', '---\nname: x\n---\n\nSee `scripts/verify.mjs`.\n')
    put(`${SKILL}/SKILL.md`, `---\n---\n${'long\n'.repeat(40)}`)
    assert.deepEqual(g.checkG8(root), [])
  })
})

describe('G9 model tier names', () => {
  test('a tier name in a rule file fails, whatever its case', () => {
    const { root, put } = tree()
    put('.claude/rules/x.md', '---\npaths: a\n---\n\nUse Sonnet for this: `references/style.md`\n')
    const f = g.checkG9(root)
    assert.equal(f.length, 1)
    assert.equal(f[0].file, '.claude/rules/x.md')
  })

  test('a full id and a word-bounded match: claude-3-5-sonnet fails, "hopus" and claude-code do not', () => {
    const { root, put } = tree()
    put('.claude/rules/x.md', 'See hopus and claude-code and mods/types/claude-code.d.ts\n')
    assert.deepEqual(g.checkG9(root), [])
    put('.claude/rules/x.md', 'The id claude-3-5-x is a full id\n')
    assert.equal(g.checkG9(root).length, 1)
  })

  test('agent frontmatter may name a tier; the agent body may not', () => {
    const { root, put } = tree()
    assert.deepEqual(g.checkG9(root), [])
    put('.claude/agents/implementer.md', '---\nname: implementer\nmodel: sonnet\n---\n\nThe sonnet model edits.\n')
    const f = g.checkG9(root)
    assert.equal(f.length, 1)
    assert.equal(f[0].line, 6)
  })

  test('the one table of the orchestration recipe may name tiers; its prose and a second table may not', () => {
    const { root, put } = tree()
    put(`${REFS}/recipes-orchestration.md`, '# Roles\n\nHaiku reads.\n\n| Role | Model |\n| :- | :- |\n| implementer | sonnet |\n\nText.\n\n| Other | Model |\n| :- | :- |\n| x | opus |\n')
    const f = g.checkG9(root)
    assert.equal(f.length, 2)
    assert.match(messages(f), /orchestration recipe/)
    assert.match(messages(f), /second table/)
  })

  test('settings.json and CLAUDE.md are guidance too', () => {
    const { root, put } = tree()
    put('.claude/settings.json', '{"model": "opus"}\n')
    assert.equal(g.checkG9(root).length, 1)
    put('.claude/settings.json', '{}\n')
    put('CLAUDE.md', 'The haiku reads.\n')
    assert.equal(g.checkG9(root).length, 1)
  })
})

describe('G10 the three ask-first lists agree', () => {
  test('the real shapes agree', () => {
    const { root } = tree()
    assert.deepEqual(g.checkG10(root), [])
  })

  test('the parsers read the real spelling', () => {
    const { root } = tree()
    const settings = g.askPatterns(root, fixture('settings.json')).map((e) => e.pattern)
    const claude = g.askFirstList(root, fixture('ask-first.md')).edits.map((e) => e.pattern)
    const owners = g.codeownersBlock(root, fixture('CODEOWNERS')).map((e) => e.pattern)
    assert.equal(settings.length, 14)
    assert.deepEqual(claude, settings)
    assert.deepEqual(owners, settings)
    assert.equal(settings[0], 'mods/council-of-elrond/hooks/rules/**')
    assert.equal(settings[13], '.claude/settings.json')
  })

  test('a path only in settings.json fails', () => {
    const { root, put } = tree()
    const s = JSON.parse(fixture('settings.json'))
    s.permissions.ask.push('Edit(/NOTICE.md)')
    put('.claude/settings.json', JSON.stringify(s, null, 2))
    const f = g.checkG10(root)
    assert.equal(f.length, 1)
    assert.equal(f[0].file, '.claude/settings.json')
    assert.match(f[0].message, /NOTICE\.md.*CLAUDE\.md.*CODEOWNERS/)
  })

  test('a path only in CLAUDE.md fails', () => {
    const { root, put } = tree()
    put('CLAUDE.md', readFileSync(join(root, 'CLAUDE.md'), 'utf8').replace('`/LICENSE`', '`/LICENSE` `/NOTICE.md`'))
    const f = g.checkG10(root)
    assert.equal(f.length, 1)
    assert.equal(f[0].file, 'CLAUDE.md')
  })

  test('a path only in CODEOWNERS fails', () => {
    const { root, put } = tree()
    put('.github/CODEOWNERS', `${fixture('CODEOWNERS').replace('# Behaviour-gated', '/NOTICE.md @owner\n\n# Behaviour-gated')}`)
    const f = g.checkG10(root)
    assert.equal(f.length, 1)
    assert.equal(f[0].file, '.github/CODEOWNERS')
  })

  test('a path missing from one list fails at the lists that have it', () => {
    const { root, put } = tree()
    put('.github/CODEOWNERS', fixture('CODEOWNERS').replace(/^\/LICENSE .*\n/m, ''))
    const f = g.checkG10(root)
    assert.equal(f.length, 2)
    assert.deepEqual(f.map((x) => x.file).sort(), ['.claude/settings.json', 'CLAUDE.md'])
  })

  test('the same paths in a different order fail', () => {
    const { root, put } = tree()
    const lines = fixture('CODEOWNERS').split('\n')
    const a = lines.findIndex((l) => l.startsWith('/SECURITY.md'))
    const b = lines.findIndex((l) => l.startsWith('/LICENSE'))
    ;[lines[a], lines[b]] = [lines[b], lines[a]]
    put('.github/CODEOWNERS', lines.join('\n'))
    const f = g.checkG10(root)
    assert.equal(f.length, 1)
    assert.match(f[0].message, /different order/)
  })

  test('the behaviour-gated block is not compared', () => {
    const { root, put } = tree()
    put('.github/CODEOWNERS', `${fixture('CODEOWNERS')}/mods/council-of-elrond/hooks/extra.ts @owner\n`)
    assert.deepEqual(g.checkG10(root), [])
  })

  test('a relative spelling in CLAUDE.md is read by the pointer convention', () => {
    const { root } = tree()
    const edits = g.askFirstList(root, '## Ask first\n\nEdits prompt:\n\n- `hooks/config/trust.ts` `hooks/config/{schema,defaults}.ts`\n\nStop and ask:\n\n- `hooks/register.ts`\n').edits
    assert.deepEqual(edits.map((e) => e.pattern), [
      'mods/council-of-elrond/hooks/config/trust.ts',
      'mods/council-of-elrond/hooks/config/schema.ts',
      'mods/council-of-elrond/hooks/config/defaults.ts',
    ])
  })

  test('a missing list is reported', () => {
    const { root, put, remove } = tree()
    put('CLAUDE.md', '# no ask section\n')
    remove('.github/CODEOWNERS')
    assert.match(messages(g.checkG10(root)), /no "Ask first" section/)
    assert.match(messages(g.checkG10(root)), /CODEOWNERS/)
  })
})

describe('G12 the evals file', () => {
  const EVALS = `${SKILL}/evals/evals.json`
  const evals = (...list) => JSON.stringify({ evals: list }, null, 2)

  test('a good file passes; a root path, a mod path and a skill-relative path all resolve', () => {
    const { root, put } = tree()
    put('mods/council-of-elrond/ROADMAP.md', '# Roadmap\n')
    put(EVALS, evals({ id: 'a', expect_reads: ['references/workflows/add-rule.md', 'mods/council-of-elrond/ROADMAP.md', '.claude/agents/implementer.md'] }))
    assert.deepEqual(g.checkG12(root), [])
  })

  test('a missing file fails', () => {
    const { root, remove } = tree()
    remove(EVALS)
    assert.match(messages(g.checkG12(root)), /evals\.json:1 missing/)
  })

  test('invalid JSON fails', () => {
    const { root, put } = tree()
    put(EVALS, '{ "evals": [')
    assert.match(messages(g.checkG12(root)), /not valid JSON/)
  })

  test('a file with no evals array fails', () => {
    const { root, put } = tree()
    put(EVALS, '{}')
    assert.match(messages(g.checkG12(root)), /no "evals" array/)
  })

  test('a dangling expect_reads path fails, with the line of its eval', () => {
    const { root, put } = tree()
    put(EVALS, evals({ id: 'a', expect_reads: [] }, { id: 'b', expect_reads: ['references/workflows/gone.md'] }))
    const f = g.checkG12(root)
    assert.equal(f.length, 1)
    assert.equal(f[0].id, 'G12')
    assert.match(f[0].message, /"b" expects a read of "references\/workflows\/gone\.md"/)
    assert.equal(f[0].line, 8)
  })

  test('a duplicate id fails, at the second one', () => {
    const { root, put } = tree()
    put(EVALS, evals({ id: 'a', expect_reads: [] }, { id: 'a', expect_reads: [] }))
    const f = g.checkG12(root)
    assert.equal(f.length, 1)
    assert.match(f[0].message, /id "a" is used twice \(first at line 4\)/)
    assert.equal(f[0].line, 8)
  })
})

describe('G11 wired in', () => {
  const CI = (...steps) => `jobs:\n  hygiene:\n    steps:\n${steps.join('\n')}\n`

  test('removing the CI checker line fails', () => {
    const { root, put } = tree()
    put('.github/workflows/ci-tests.yml', 'jobs:\n  hygiene:\n    steps:\n      - run: node --test scripts/tests/\n')
    const f = g.checkG11(root)
    assert.equal(f.length, 1)
    assert.match(f[0].message, /check-guidance/)
  })

  test('removing the CI test line fails; a commented-out line does not count', () => {
    const { root, put } = tree()
    put('.github/workflows/ci-tests.yml', 'steps:\n  - run: node scripts/check-guidance.mjs\n  # - run: node --test scripts/tests/\n')
    const f = g.checkG11(root)
    assert.equal(f.length, 1)
    assert.match(f[0].message, /--test/)
  })

  test('CI: the commands in comments or in step names only do not count; a block scalar and a plain run do', () => {
    const { root, put } = tree()
    put('.github/workflows/ci-tests.yml', CI('      # run: node scripts/check-guidance.mjs', '      - name: node scripts/check-guidance.mjs', '        run: echo ok', '      - name: node --test scripts/tests/', '        run: echo node --test scripts/tests/'))
    assert.equal(g.checkG11(root).length, 2)
    put('.github/workflows/ci-tests.yml', CI('      - run: |', '          node scripts/check-guidance.mjs', '          node --test scripts/tests/'))
    assert.deepEqual(g.checkG11(root), [])
    put('.github/workflows/ci-tests.yml', CI('      - name: x', '        run: node scripts/check-guidance.mjs', '      - run: "node --test scripts/tests/"'))
    assert.deepEqual(g.checkG11(root), [])
    put('.github/workflows/ci-tests.yml', CI('      - run: node scripts/check-guidance.mjs --root /tmp', '      - run: node --test scripts/tests/ other'))
    assert.equal(g.checkG11(root).length, 2, 'a different command is not the command')
  })

  test('the pre-commit hook must run verify --staged as a command; an echo or a comment does not count', () => {
    const { root, put } = tree()
    put('.githooks/pre-commit', '#!/bin/sh\nscripts/check-hygiene.sh --staged\n')
    assert.equal(g.checkG11(root).length, 1)
    for (const hook of [
      '#!/bin/sh\necho "run node scripts/verify.mjs --staged"\n',
      "#!/bin/sh\nprintf 'node scripts/verify.mjs --staged\\n'\n",
      '#!/bin/sh\n# exec node scripts/verify.mjs --staged\n',
      '#!/bin/sh\necho node scripts/verify.mjs --staged\n',
      '#!/bin/sh\nexec node scripts/verify.mjs\n',
      '#!/bin/sh\nnode scripts/verify.mjs --staged || true\n',
      '#!/bin/sh\nnode scripts/verify.mjs --staged; exit 0\n',
      '#!/bin/sh\nexec node scripts/verify.mjs --staged || true\n',
      '#!/bin/sh\nnode scripts/verify.mjs --staged || exit 1\n',
      '#!/bin/sh\nnode scripts/verify.mjs --staged && echo ok\n',
      '#!/bin/sh\nnode scripts/verify.mjs --staged # never || true\n',
      '#!/bin/sh\nnode scripts/verify.mjs --staged-only\n',
    ]) {
      put('.githooks/pre-commit', hook)
      const f = g.checkG11(root)
      assert.equal(f.length, 1, hook)
      assert.match(f[0].message, /verify\.mjs --staged/)
    }
    for (const hook of ['#!/bin/sh\nexec node scripts/verify.mjs --staged\n', '#!/bin/sh\nset -e\nif command -v node; then\n  node scripts/verify.mjs --staged\nfi\n', '#!/bin/sh\n  exec node scripts/verify.mjs --staged   # the checks\n']) {
      put('.githooks/pre-commit', hook)
      assert.deepEqual(g.checkG11(root), [], hook)
    }
  })

  test('the pre-commit line must hand its status to git: exec, last line, or after set -e; not after a continuation', () => {
    const { root, put } = tree()
    const V = 'node scripts/verify.mjs --staged'
    const rejected = [
      ['followed by exit 0 without set -e', `#!/bin/sh\nset -u\n${V}\nexit 0\n`],
      ['followed by a line without set -e', `#!/bin/sh\n${V}\necho done\n`],
      ['set -e only after it', `#!/bin/sh\n${V}\nset -e\nexit 0\n`],
      ['a commented set -e', `#!/bin/sh\n# set -e\n${V}\nexit 0\n`],
      ['preceded by a continuation', `#!/bin/sh\nset -e\necho a \\\n${V}\n`],
      ['exec preceded by a continuation', `#!/bin/sh\necho a \\\nexec ${V}\n`],
    ]
    for (const [name, hook] of rejected) {
      put('.githooks/pre-commit', hook)
      const f = g.checkG11(root)
      assert.equal(f.length, 1, name)
      assert.match(f[0].message, /status reaches git/, name)
    }
    const accepted = [
      ['followed by exit 0 with set -e', `#!/bin/sh\nset -e\n${V}\nexit 0\n`],
      ['set -eu', `#!/bin/sh\nset -eu\n${V}\nexit 0\n`],
      ['set -euo pipefail', `#!/bin/sh\nset -euo pipefail\n${V}\nexit 0\n`],
      ['set -o errexit', `#!/bin/sh\nset -o errexit\n${V}\nexit 0\n`],
      ['the last line', `#!/bin/sh\nset -u\n${V}\n`],
      ['the last live line before a comment and blank lines', `#!/bin/sh\n${V}\n\n# end\n`],
      ['exec with lines after', `#!/bin/sh\nexec ${V}\necho fallback\nexit 1\n`],
    ]
    for (const [name, hook] of accepted) {
      put('.githooks/pre-commit', hook)
      assert.deepEqual(g.checkG11(root), [], name)
    }
  })

  test('CI: a matching step switched off by if: false or continue-on-error: true does not count; an enabled one does', () => {
    const { root, put } = tree()
    const both = (a, b) => CI(...a, ...b)
    const guidance = ['      - run: node scripts/check-guidance.mjs']
    const tests = ['      - run: node --test scripts/tests/']
    const off = [
      ['      - name: x', '        if: false', '        run: node --test scripts/tests/'],
      ['      - if: false', '        run: node --test scripts/tests/'],
      ['      - run: node --test scripts/tests/', '        if: false'],
      ["      - name: x", "        if: 'false'", '        run: node --test scripts/tests/'],
      ['      - name: x', '        if: ${{ false }}', '        run: node --test scripts/tests/'],
      ['      - name: x', '        continue-on-error: true', '        run: node --test scripts/tests/'],
      ['      - run: |', '          node --test scripts/tests/', '        continue-on-error: true'],
    ]
    for (const step of off) {
      put('.github/workflows/ci-tests.yml', both(guidance, step))
      const f = g.checkG11(root)
      assert.equal(f.length, 1, step.join('\n'))
      assert.match(f[0].message, /--test/)
    }
    // The same step with other keys, and a step that is off next to one that is on.
    put('.github/workflows/ci-tests.yml', both(guidance, ['      - name: x', "        if: github.event_name == 'push'", '        continue-on-error: false', '        run: node --test scripts/tests/']))
    assert.deepEqual(g.checkG11(root), [])
    put('.github/workflows/ci-tests.yml', CI(...guidance, '      - if: false', '        run: node --test scripts/tests/', ...tests))
    assert.deepEqual(g.checkG11(root), [])
    // A neighbouring step's switch does not leak into the step that runs.
    put('.github/workflows/ci-tests.yml', CI(...guidance, '      - if: false', '        run: echo skipped', ...tests))
    assert.deepEqual(g.checkG11(root), [])
  })

  test('CI: a job switched off by if: false or continue-on-error: true does not count its steps', () => {
    const { root, put } = tree()
    const job = (head, ...lines) => `jobs:\n  hygiene:\n${head}    steps:\n      - run: node scripts/check-guidance.mjs\n      - run: node --test scripts/tests/\n${lines.join('')}`
    put('.github/workflows/ci-tests.yml', job(''))
    assert.deepEqual(g.checkG11(root), [])
    for (const head of ['    if: false\n', '    continue-on-error: true\n', "    if: 'false'\n"]) {
      put('.github/workflows/ci-tests.yml', job(head))
      assert.equal(g.checkG11(root).length, 2, head)
    }
    // Another job's switch does not count, and a job's own steps keys at the step indentation are not job keys.
    put('.github/workflows/ci-tests.yml', `${job('')}  other:\n    if: false\n    steps:\n      - run: echo hi\n`)
    assert.deepEqual(g.checkG11(root), [])
  })

  test('verify: a call in a JSDoc or a block comment does not count', () => {
    const { root, put } = tree()
    for (const text of [
      "/**\n * run('node', ['scripts/check-guidance.mjs', '--json'], { cwd: root })\n */\n",
      "/* run('node', ['scripts/check-guidance.mjs', '--json']) */\n",
      "  // run('node', ['scripts/check-guidance.mjs', '--json'])\n",
    ]) {
      put('scripts/verify.mjs', text)
      assert.match(messages(g.checkG11(root)), /does not run scripts\/check-guidance\.mjs/, text)
    }
    put('scripts/verify.mjs', "/** the row */\nconst r = run('node', ['scripts/check-guidance.mjs', '--json'], { cwd: root })\n")
    assert.deepEqual(g.checkG11(root), [])
  })

  test('verify must run the checker; an import or a mention does not count', () => {
    const { root, put } = tree()
    for (const text of [
      '// no checker here\n',
      "import { patternToRegExp } from './check-guidance.mjs'\n",
      "// run('node', ['scripts/check-guidance.mjs', '--json'])\n",
      "const note = 'scripts/check-guidance.mjs'\n",
    ]) {
      put('scripts/verify.mjs', text)
      assert.match(messages(g.checkG11(root)), /does not run scripts\/check-guidance\.mjs/, text)
    }
    put('scripts/verify.mjs', "const r = run('node', ['scripts/check-guidance.mjs', '--json'], { cwd: root })\n")
    assert.deepEqual(g.checkG11(root), [])
  })
})

describe('the real allow list', () => {
  const settings = JSON.parse(readFileSync(join(here, '..', '..', '.claude', 'settings.json'), 'utf8'))

  test('only verify and the guidance checker take a prefix; every other entry is an exact command', () => {
    const allow = settings.permissions.allow
    assert.ok(allow.length > 0)
    for (const entry of allow) {
      if (/^Bash\(node scripts\/(?:verify|check-guidance)\.mjs:\*\)$/.test(entry)) continue
      assert.match(entry, /^Bash\([^*:]+\)$/, `${entry} is a prefix or a pattern`)
    }
    assert.ok(allow.includes('Bash(node --test scripts/tests/)'))
    assert.ok(!allow.some((e) => /\bclaude\b/.test(e)), 'claude -p is never allowed')
  })
})

describe('the command line', () => {
  const run = (root, ...args) => spawnClean(process.execPath, [SCRIPT, '--root', root, ...args], { encoding: 'utf8' })

  test('exit 0 and no output on a clean tree', () => {
    const { root } = tree()
    const r = run(root)
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '')
  })

  test('one line per finding, G<n> file:line message, exit 1', () => {
    const { root, put } = tree()
    put('.claude/notes.md', 'See `docs/nowhere.md`\n')
    const r = run(root)
    assert.equal(r.status, 1)
    assert.match(r.stdout, /^G1 \.claude\/notes\.md:1 pointer `docs\/nowhere\.md` does not resolve/)
    assert.equal(r.stdout.trim().split('\n').length, 1)
  })

  test('--json prints the findings', () => {
    const { root, put } = tree()
    put('.claude/notes.md', 'See `docs/nowhere.md`\n')
    const r = run(root, '--json')
    assert.equal(r.status, 1)
    const out = JSON.parse(r.stdout)
    assert.deepEqual(ids(out.findings), ['G1'])
    assert.equal(out.findings[0].line, 1)
  })
})
