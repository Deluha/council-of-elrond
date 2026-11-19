#!/usr/bin/env node
// The guidance checker: keeps CLAUDE.md, the development skill, the path rules, the command
// skills, the agents and the ask-first list in step with each other and with the repository.
//
//   node scripts/check-guidance.mjs [--json] [--root <dir>]
//
// One line per finding, "G<n> file:line message"; exit 1 on any finding, 0 otherwise.
// --json prints { findings: [{ id, file, line, message }] } instead (scripts/verify.mjs reads it).
// Every check is a pure function of a root directory, so the tests run it on fixture trees.
//
// Scope. G1, G2 and G9 read CLAUDE.md and the files under .claude/ only; the mod's own documents
// name reviewer models as product facts and are exempt. G1 and G2 also read CONTRIBUTING.md,
// docs/DEVELOPMENT.md, docs/MAINTENANCE.md and docs/GITHUB.md, which hold pointers to the skill and
// the scripts, but only the pointers under .claude/ and scripts/ in them: their ordinary prose is
// not checked.
//
// The pointer convention (G1, G2, G7, G8). A pointer is a backticked path in a guidance file. It
// is looked up from the repository root, from mods/council-of-elrond/, from the development
// skill's folder and from that folder's references/ folder. It must resolve in exactly one of
// them: no match is a broken pointer, two matches are an ambiguous one (write the longer path).
// `#anchor` after a path must match a heading of the target (GitHub's slug rules) or an explicit
// <a id="..."> anchor in it; a bare `#anchor` is looked up in the file that holds it.
//
// Which backticked tokens count as paths (G1's stated skip rule). A token is a candidate only
// when it has no spaces and only the characters A-Z a-z 0-9 . _ / - (so commands, globs with *,
// code such as next( or $.state, URLs, ~/ paths and placeholders in <> are skipped); it does not
// contain a "*"; a leading "/" means "from the repository root" (the ask-first list is written
// that way): the slash is stripped and the path is looked up at the root only, while a token
// with a leading "/" and no extension, "/" or folder (a slash command such as /verify)
// is not a path; an import specifier ("./schema.js") and a bare extension (".ts") are not paths;
// a trailing ":12" or ":12-20" line suffix and a "#anchor" are stripped first;
// and it either ends in a known file extension
// (md, json, ts, tsx, mjs, js, sh, yml, yaml), or ends in "/", or starts with the name of a
// folder that exists under one of the lookup bases. Everything else (opus/sonnet, Read/Grep,
// tool.check, R1) is not a path and is skipped. Fenced code blocks are not read for pointers.
// Two more forms are read as pointers, in every file G1 and G2 read: a token that starts with
// "./scripts/" or "./.claude/" (the "./" is dropped; it means the repository root there), and the
// FIRST argument of a backticked command of the form `node <path>`, `bash <path>` or `sh <path>`
// (a first argument that is a flag, such as `node --test scripts/tests/`, is not a path).
//
// G12 reads the one JSON file of hand-run prompts (evals/evals.json) that the markdown checks do not
// reach: it parses, its ids are unique and every expect_reads entry resolves by the convention above.
//
// G11 (wired in) is a line-based check, not a proof. It does not prove that the wired line is
// reachable: dead code (a line after an earlier `exit`, inside a never-true `if`, or in a function
// nobody calls) and a command that only appears in a here-document or a string that a script later
// runs or ignores still count. For the workflow it reads only `if:` and `continue-on-error:` keys
// of the same step or job, at their exact indentation; an expression such as
// `if: ${{ github.event_name == 'x' }}`, a flow-style mapping, a YAML anchor or a matrix does not
// switch a step off here. In verify.mjs a call is ignored on a `//`, `/*` or ` *` line only, not on
// a line inside a block comment that has no leading `*`. In the pre-commit hook the exact
// `node scripts/verify.mjs --staged` line must be `exec node ...`, or the last live line, or come
// after a live `set -e` line (`-eu`, `-euo pipefail`, `-o errexit`), and the live line before it
// must not end in a backslash; a `set -e` inside a function or after a `set +e` still counts, and
// a trap or an `if`/`||` that handles the status is not read. It shows that the wiring is written,
// not that it runs.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const MOD = 'mods/council-of-elrond'
export const SKILL = '.claude/skills/council-of-elrond-development'
export const REFS = `${SKILL}/references`
export const BASES = ['', `${MOD}/`, `${SKILL}/`, `${REFS}/`]

export const LIMITS = { claudeLines: 80, claudeBytes: 6144, referenceBytes: 10240, ruleLines: 6, commandLines: 15 }

const EXT = /\.(?:md|json|ts|tsx|mjs|js|sh|yml|yaml)$/
const TIERS = /\b(?:opus|sonnet|haiku|fable)\b|\bclaude-\d[\w.-]*/i

// ---------------------------------------------------------------------------------------------
// File helpers

export function readText(root, rel) {
  try {
    return readFileSync(join(root, rel), 'utf8')
  } catch {
    return null
  }
}

/** Every file under a folder, recursively, as sorted posix paths relative to it. */
export function listFiles(root, rel) {
  const out = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const next = dir ? `${dir}/${e.name}` : e.name
      if (e.isDirectory()) walk(next)
      else if (e.isFile()) out.push(next)
    }
  }
  walk(rel)
  return out.sort().map((p) => (rel ? p.slice(rel.length + 1) : p))
}

const isFile = (root, rel) => {
  try {
    return statSync(join(root, rel)).isFile()
  } catch {
    return false
  }
}
const isDir = (root, rel) => {
  try {
    return statSync(join(root, rel)).isDirectory()
  } catch {
    return false
  }
}

/** CLAUDE.md and everything under .claude/, as paths relative to the root. */
export function guidanceFiles(root) {
  const out = []
  if (isFile(root, 'CLAUDE.md')) out.push('CLAUDE.md')
  for (const f of listFiles(root, '.claude')) out.push(`.claude/${f}`)
  return out
}

const guidanceMarkdown = (root) => guidanceFiles(root).filter((f) => f.endsWith('.md'))

/** The documents outside .claude/ whose pointers to .claude/ and scripts/ G1 and G2 check. */
export const POINTER_DOCS = ['CONTRIBUTING.md', 'docs/DEVELOPMENT.md', 'docs/MAINTENANCE.md', 'docs/GITHUB.md']
const AUTOMATION_PATH = /^(?:\.claude|scripts)\//

/** Files G1 and G2 read: { file, only } where `only` keeps a pointer (null: every pointer counts). */
function pointerSources(root) {
  const out = guidanceMarkdown(root).map((file) => ({ file, only: null }))
  for (const file of POINTER_DOCS) if (isFile(root, file)) out.push({ file, only: (p) => !p.pointer.selfAnchor && AUTOMATION_PATH.test(p.pointer.path) })
  return out
}

// ---------------------------------------------------------------------------------------------
// Markdown helpers

/** Lines of a text with a flag for whether each sits inside a fenced code block (fences included). */
export function linesWithFences(text) {
  const out = []
  let fence = null
  text.split('\n').forEach((line, i) => {
    const m = /^\s*(```+|~~~+)/.exec(line)
    if (fence) {
      out.push({ text: line, line: i + 1, fenced: true })
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null
    } else if (m) {
      fence = m[1]
      out.push({ text: line, line: i + 1, fenced: true })
    } else {
      out.push({ text: line, line: i + 1, fenced: false })
    }
  })
  return out
}

/** { front, body, bodyStart }: the frontmatter text (or null), the rest, and the body's first line number. */
export function splitFrontmatter(text) {
  const lines = text.split('\n')
  if (lines[0]?.trim() !== '---') return { front: null, body: text, bodyStart: 1 }
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      return { front: lines.slice(1, i).join('\n'), body: lines.slice(i + 1).join('\n'), bodyStart: i + 2 }
    }
  }
  return { front: null, body: text, bodyStart: 1 }
}

/** GitHub's heading slug, without the duplicate suffix. */
export function slugOf(heading) {
  return heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[`*~]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, '')
    .replace(/ /g, '-')
}

export function headingsOf(text) {
  const out = []
  for (const l of linesWithFences(text)) {
    if (l.fenced) continue
    const m = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(l.text)
    if (m) out.push({ level: m[1].length, text: m[2], line: l.line })
  }
  return out
}

/** The set of anchors a markdown file offers: heading slugs (with GitHub's -1, -2 suffixes) and <a id>. */
export function anchorsOf(text) {
  const set = new Set()
  const seen = new Map()
  for (const h of headingsOf(text)) {
    const base = slugOf(h.text)
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    set.add(n === 0 ? base : `${base}-${n}`)
  }
  for (const m of text.matchAll(/<a\s+[^>]*\b(?:id|name)\s*=\s*"([^"]+)"/gi)) set.add(m[1])
  return set
}

/** The line of a code fence that is never closed, or null. An unclosed fence hides the rest of the file. */
export function unclosedFenceLine(text) {
  let fence = null
  let at = 0
  text.split('\n').forEach((line, i) => {
    const m = /^\s*(```+|~~~+)/.exec(line)
    if (!m) return
    if (!fence) {
      fence = m[1]
      at = i + 1
    } else if (m[1][0] === fence[0] && m[1].length >= fence.length) fence = null
  })
  return fence ? at : null
}

/** Backticked spans outside fenced code: { token, line }. */
export function backtickTokens(text) {
  const out = []
  for (const l of linesWithFences(text)) {
    if (l.fenced) continue
    for (const m of l.text.matchAll(/`([^`\n]+)`/g)) out.push({ token: m[1], line: l.line })
  }
  return out
}

/** Non-empty lines of a text. */
const nonEmpty = (text) => text.split('\n').filter((l) => l.trim() !== '')

// ---------------------------------------------------------------------------------------------
// Pointers

/**
 * Parse a backticked token as a pointer: { path, anchor, selfAnchor } or null when it is not one.
 * See "Which backticked tokens count as paths" at the top of the file.
 */
export function parsePointer(root, raw) {
  let t = raw.trim()
  let anchor = null
  const hash = t.indexOf('#')
  if (hash >= 0) {
    anchor = t.slice(hash + 1)
    t = t.slice(0, hash)
    if (!/^[\w-]+$/.test(anchor)) return null
  }
  if (t === '') return anchor !== null ? { path: '', anchor, selfAnchor: true } : null
  t = t.replace(/:\d+(?:[-,]\d+)*$/, '')
  if (/^\.{1,2}\//.test(t) || /^\.[A-Za-z]+$/.test(t)) return null
  const anchored = t.startsWith('/')
  if (anchored) t = t.replace(/^\/+/, '')
  if (!/^[A-Za-z0-9._/-]+$/.test(t) || t === '.' || t === '..') return null
  const first = t.split('/')[0] ?? ''
  const bases = anchored ? [''] : BASES
  const candidate = EXT.test(t) || t.endsWith('/') || (t.includes('/') && bases.some((b) => isDir(root, `${b}${first}`)))
  return candidate ? { path: t, anchor, selfAnchor: false, anchored } : null
}

/** Every lookup base where the path exists, as repository-relative paths. */
export function resolvePointer(root, path, anchored = false) {
  const hits = []
  for (const b of anchored ? [''] : BASES) {
    const rel = `${b}${path}`.replace(/\/+$/, '')
    if (existsSync(join(root, rel)) && !hits.includes(rel)) hits.push(rel)
  }
  return hits
}

/**
 * The text of a backticked token that is read as a path: the token itself, or the first argument of a
 * `node`, `bash` or `sh` command; a leading "./" before scripts/ or .claude/ is dropped (it means the root).
 */
function pathSubject(token) {
  const cmd = /^(?:node|bash|sh)\s+(\S+)/.exec(token.trim())
  return (cmd ? (cmd[1] ?? '') : token).replace(/^\.\/(?=(?:scripts|\.claude)\/)/, '')
}

/** Pointers in a markdown text with what each resolves to: { token, line, pointer, hits }. */
export function pointersIn(root, text) {
  const out = []
  for (const { token, line } of backtickTokens(text)) {
    const pointer = parsePointer(root, pathSubject(token))
    if (pointer) out.push({ token, line, pointer, hits: pointer.selfAnchor ? [] : resolvePointer(root, pointer.path, pointer.anchored) })
  }
  return out
}

const finding = (id, file, line, message) => ({ id, file, line, message })

// ---------------------------------------------------------------------------------------------
// G1, G2: pointers resolve; anchors match

/**
 * The command skills of this repository: every folder under .claude/skills/ except the development
 * skill. A backticked `/name` for one of them needs its SKILL.md. A folder counts with or without a
 * SKILL.md (a folder that lost its SKILL.md is what the check is for); a name with no folder is
 * not a command of this repository and is skipped.
 */
export function commandSkills(root) {
  try {
    return readdirSync(join(root, '.claude/skills'), { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'council-of-elrond-development')
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
}

export function checkG1(root) {
  const out = []
  const commands = commandSkills(root)
  for (const { file, only } of pointerSources(root)) {
    const text = readText(root, file) ?? ''
    const open = unclosedFenceLine(text)
    if (open !== null) out.push(finding('G1', file, open, 'this code fence is never closed; it hides the rest of the file from the checks'))
    for (const { token, line } of backtickTokens(text)) {
      const m = /^\/([a-z][a-z0-9-]*)(?:\s.*)?$/.exec(token)
      if (m && commands.includes(m[1] ?? '') && !isFile(root, `.claude/skills/${m[1]}/SKILL.md`)) {
        out.push(finding('G1', file, line, `command \`${token}\` has no .claude/skills/${m[1]}/SKILL.md`))
      }
    }
    for (const p of pointersIn(root, text)) {
      if (p.pointer.selfAnchor) continue
      if (only && !only(p)) continue
      if (p.hits.length === 0) out.push(finding('G1', file, p.line, `pointer \`${p.token}\` does not resolve (looked in the root, ${MOD}/, the skill folder and its references/)`))
      else if (p.hits.length > 1) out.push(finding('G1', file, p.line, `pointer \`${p.token}\` is ambiguous: it resolves to ${p.hits.join(' and ')}; write the longer path`))
    }
  }
  return out
}

export function checkG2(root) {
  const out = []
  for (const { file, only } of pointerSources(root)) {
    const text = readText(root, file) ?? ''
    for (const p of pointersIn(root, text)) {
      const { pointer } = p
      if (pointer.anchor === null) continue
      if (only && !only(p)) continue
      let target
      if (pointer.selfAnchor) target = file
      else if (p.hits.length === 1) target = p.hits[0]
      else continue // G1 reports a missing or ambiguous target
      if (!target?.endsWith('.md')) continue
      const body = readText(root, target)
      if (body === null) continue
      if (!anchorsOf(body).has(pointer.anchor)) out.push(finding('G2', file, p.line, `anchor #${pointer.anchor} matches no heading of ${target}`))
    }
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// G3: CLAUDE.md budget

export function checkG3(root) {
  const text = readText(root, 'CLAUDE.md')
  if (text === null) return [finding('G3', 'CLAUDE.md', 1, 'CLAUDE.md is missing')]
  const lines = text.split('\n')
  if (text.endsWith('\n')) lines.pop()
  const out = []
  if (lines.length > LIMITS.claudeLines) out.push(finding('G3', 'CLAUDE.md', LIMITS.claudeLines + 1, `CLAUDE.md has ${lines.length} lines; the limit is ${LIMITS.claudeLines}`))
  const bytes = Buffer.byteLength(text)
  if (bytes > LIMITS.claudeBytes) out.push(finding('G3', 'CLAUDE.md', 1, `CLAUDE.md is ${bytes} bytes; the limit is ${LIMITS.claudeBytes}`))
  return out
}

// ---------------------------------------------------------------------------------------------
// G4, G5: the routing table and the reference sizes

/**
 * The routing table of the development skill: { rows: [{ line, files: [name] }], problems }.
 * Rows are the data rows of every markdown table in SKILL.md. The file cell is the cell of the
 * column whose header contains "file" or "reference", else the second cell; the files it names
 * are its backticked ".md" tokens, relative to references/ (a leading "references/" is allowed).
 */
export function routingRows(text) {
  const rows = []
  const lines = linesWithFences(text).filter((l) => !l.fenced)
  const cells = (s) => s.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
  const sep = (s) => /^\s*\|[\s:|-]+\|?\s*$/.test(s)
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i]
    const nextLine = lines[i + 1]
    if (!cur || !nextLine || !cur.text.trim().startsWith('|') || !sep(nextLine.text)) continue
    const header = cells(cur.text)
    let col = header.findIndex((h) => /file|reference/i.test(h))
    if (col < 0) col = Math.min(1, header.length - 1)
    for (let j = i + 2; j < lines.length; j++) {
      const row = lines[j]
      if (!row || !row.text.trim().startsWith('|')) break
      const cell = cells(row.text)[col] ?? ''
      const files = [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '').filter((t) => t.endsWith('.md')).map((t) => t.replace(/^references\//, ''))
      rows.push({ line: row.line, files })
    }
  }
  return rows
}

export function checkG4(root) {
  const skillFile = `${SKILL}/SKILL.md`
  const text = readText(root, skillFile)
  if (text === null) return [finding('G4', skillFile, 1, 'the development skill has no SKILL.md')]
  const refs = listFiles(root, REFS)
  const rows = routingRows(text)
  const out = []
  const counts = new Map(refs.map((r) => [r, 0]))
  for (const row of rows) {
    if (row.files.length === 0) out.push(finding('G4', skillFile, row.line, 'routing row names no file under references/'))
    for (const f of row.files) {
      if (!counts.has(f)) out.push(finding('G4', skillFile, row.line, `routing row names ${f}, which does not exist under references/`))
      else counts.set(f, (counts.get(f) ?? 0) + 1)
    }
  }
  for (const [f, n] of counts) {
    if (n === 0) out.push(finding('G4', skillFile, 1, `references/${f} has no row in the routing table`))
    else if (n > 1) out.push(finding('G4', skillFile, 1, `references/${f} has ${n} rows in the routing table; it needs exactly one`))
  }
  return out
}

export function checkG5(root) {
  const out = []
  for (const f of listFiles(root, REFS)) {
    const bytes = statSync(join(root, REFS, f)).size
    if (bytes > LIMITS.referenceBytes) out.push(finding('G5', `${REFS}/${f}`, 1, `${bytes} bytes; the limit is ${LIMITS.referenceBytes}`))
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// G6: rule ids

const CONVENTIONS = `${REFS}/conventions.md`

/** Definitions of rule ids in a markdown text: Map id -> lines. A heading starting with R<n>, or an anchor id r<n> when no heading defines it. */
export function ruleDefinitions(text) {
  const headings = new Map()
  for (const h of headingsOf(text)) {
    const m = /^R(\d+)\b/.exec(h.text)
    if (m) headings.set(`R${m[1]}`, [...(headings.get(`R${m[1]}`) ?? []), h.line])
  }
  const anchors = new Map()
  text.split('\n').forEach((l, i) => {
    for (const m of l.matchAll(/<a\s+[^>]*\b(?:id|name)\s*=\s*"r(\d+)"/gi)) anchors.set(`R${m[1]}`, [...(anchors.get(`R${m[1]}`) ?? []), i + 1])
  })
  const out = new Map(headings)
  for (const [id, lines] of anchors) if (!out.has(id)) out.set(id, lines)
  return out
}

export function checkG6(root) {
  const out = []
  const conv = readText(root, CONVENTIONS)
  const defined = conv === null ? new Map() : ruleDefinitions(conv)
  if (conv === null) out.push(finding('G6', CONVENTIONS, 1, 'the rules are defined in references/conventions.md, which is missing'))
  for (const [id, lines] of defined) {
    if (lines.length > 1) out.push(finding('G6', CONVENTIONS, lines[1] ?? 1, `${id} is defined ${lines.length} times (lines ${lines.join(', ')}); define it once`))
  }
  for (const file of guidanceMarkdown(root)) {
    const text = readText(root, file) ?? ''
    if (file !== CONVENTIONS) {
      for (const [id, lines] of ruleDefinitions(text)) out.push(finding('G6', file, lines[0] ?? 1, `${id} is defined here; rule ids are defined only in references/conventions.md`))
    }
    const reported = new Set()
    text.split('\n').forEach((l, i) => {
      for (const m of l.matchAll(/\bR(\d+)\b/g)) {
        const id = `R${m[1]}`
        if (conv !== null && !defined.has(id) && !reported.has(id)) {
          reported.add(id)
          out.push(finding('G6', file, i + 1, `rule id ${id} is not defined in references/conventions.md`))
        }
      }
    })
  }
  const claude = readText(root, 'CLAUDE.md') ?? ''
  for (const id of defined.keys()) {
    if (!new RegExp(`\\b${id}\\b`).test(claude)) out.push(finding('G6', 'CLAUDE.md', 1, `CLAUDE.md does not list ${id}`))
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// G7, G8: path rules and command skills

const hasPointer = (root, text) => backtickTokens(text).some(({ token }) => parsePointer(root, token) !== null)

export function checkG7(root) {
  const out = []
  for (const f of listFiles(root, '.claude/rules').filter((n) => n.endsWith('.md') && !n.includes('/'))) {
    const file = `.claude/rules/${f}`
    const { front, body, bodyStart } = splitFrontmatter(readText(root, file) ?? '')
    const paths = front === null ? null : /^paths\s*:(.*)$/m.exec(front)
    if (front === null || paths === null) out.push(finding('G7', file, 1, 'no `paths:` frontmatter'))
    else if ((paths[1] ?? '').trim() === '' && !/^paths\s*:\s*\n\s*-\s*\S/m.test(front)) out.push(finding('G7', file, 1, '`paths:` is empty'))
    const lines = nonEmpty(body)
    if (lines.length > LIMITS.ruleLines) out.push(finding('G7', file, bodyStart, `body has ${lines.length} non-empty lines; the limit is ${LIMITS.ruleLines}`))
    if (!hasPointer(root, body)) out.push(finding('G7', file, bodyStart, 'body has no pointer (a backticked path)'))
    const fenced = linesWithFences(body).find((l) => l.fenced)
    if (fenced) out.push(finding('G7', file, bodyStart + fenced.line - 1, 'body has a fenced code block; a rule only points'))
  }
  return out
}

export function checkG8(root) {
  const out = []
  for (const f of listFiles(root, '.claude/skills')) {
    const parts = f.split('/')
    if (parts.length !== 2 || parts[1] !== 'SKILL.md' || parts[0] === 'council-of-elrond-development') continue
    const file = `.claude/skills/${f}`
    const { body, bodyStart } = splitFrontmatter(readText(root, file) ?? '')
    const lines = nonEmpty(body)
    if (lines.length > LIMITS.commandLines) out.push(finding('G8', file, bodyStart, `body has ${lines.length} non-empty lines; the limit is ${LIMITS.commandLines}`))
    if (!hasPointer(root, body)) out.push(finding('G8', file, bodyStart, 'body has no pointer (a backticked path)'))
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// G9: model tier names

/**
 * Tier names (opus, sonnet, haiku, fable, full claude-<digit> ids; case-insensitive, word-bounded)
 * may appear in CLAUDE.md and .claude/ only in the frontmatter of an agent file and in the one
 * table of references/recipes-orchestration.md.
 */
export function checkG9(root) {
  const out = []
  for (const file of guidanceFiles(root)) {
    const text = readText(root, file)
    if (text === null) continue
    const isAgent = /^\.claude\/agents\/[^/]+\.md$/.test(file)
    const isTable = file === `${REFS}/recipes-orchestration.md`
    const split = splitFrontmatter(text)
    const frontEnd = isAgent && split.front !== null ? split.bodyStart - 1 : 0
    let tableBlock = 0
    let inTable = false
    text.split('\n').forEach((l, i) => {
      const row = l.trim().startsWith('|')
      if (row && !inTable) tableBlock++
      inTable = row
      const m = TIERS.exec(l)
      if (!m) return
      if (i + 1 <= frontEnd) return
      if (isTable && row && tableBlock === 1) return
      const where = isTable && row ? 'a second table' : isTable ? 'the text of the orchestration recipe' : isAgent ? 'the body of an agent file' : 'guidance'
      out.push(finding('G9', file, i + 1, `model tier name "${m[0]}" in ${where}; tiers are named only in agent frontmatter and the one table of references/recipes-orchestration.md`))
    })
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// G10: the ask-first paths agree

const EDIT_TOOL = /^(?:Edit|Write|MultiEdit|NotebookEdit)\((.*)\)$/

/** One-level brace expansion: a/{b,c}.ts -> a/b.ts, a/c.ts. */
export function expandBraces(s) {
  const m = /^(.*?)\{([^{}]*)\}(.*)$/.exec(s)
  if (!m) return [s]
  return (m[2] ?? '').split(',').flatMap((alt) => expandBraces(`${m[1]}${alt}${m[3]}`))
}

/**
 * Normalise a path pattern to a repository-root-relative form: no leading "/", a folder is
 * "dir/**". A pattern without a leading "/" is looked up by the pointer convention: when its
 * literal prefix does not exist at the root but does under mods/council-of-elrond/, it is
 * prefixed with that. Edit(...) and Write(...) wrappers are removed.
 */
export function normalisePattern(root, raw) {
  let p = raw.trim()
  const w = EDIT_TOOL.exec(p)
  if (w) p = w[1] ?? ''
  const anchored = p.startsWith('/')
  p = p.replace(/^\/+/, '').replace(/^\.\//, '')
  if (p.endsWith('/')) p += '**'
  p = p.replace(/\/\*\*$/, '/**')
  if (!anchored) {
    const literal = p.split(/[*{]/)[0] ?? ''
    if (!existsSync(join(root, literal)) && existsSync(join(root, MOD, literal))) p = `${MOD}/${p}`
  }
  return p
}

/** Convert a normalised pattern to a RegExp over repository-relative paths. */
export function patternToRegExp(pattern) {
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] ?? ''
    if (c === '*' && pattern[i + 1] === '*') {
      re += '.*'
      i++
    } else if (c === '*') re += '[^/]*'
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

/** Entries of permissions.ask that gate edits: [{ pattern, line }]. */
export function askPatterns(root, settingsText) {
  let json
  try {
    json = JSON.parse(settingsText)
  } catch {
    return null
  }
  const ask = json?.permissions?.ask
  if (!Array.isArray(ask)) return []
  const lines = settingsText.split('\n')
  const out = []
  for (const entry of ask) {
    if (typeof entry !== 'string' || !EDIT_TOOL.test(entry)) continue
    const line = lines.findIndex((l) => l.includes(JSON.stringify(entry))) + 1
    for (const p of expandBraces(EDIT_TOOL.exec(entry)?.[1] ?? '')) out.push({ pattern: normalisePattern(root, `/${p.replace(/^\//, '')}`), line: line || 1 })
  }
  return out
}

const PATHISH = /^[A-Za-z0-9._/*{},-]+$/

/**
 * The Ask first section of CLAUDE.md, read as it is written: a label or heading line containing
 * "edits prompt" or "stop and ask" sets the kind of the bullets under it until the next label or
 * heading; a bullet that itself contains one of the phrases has that kind alone. Returns
 * { found, edits: [{ pattern, line }] } with the paths on the bullets of kind "edits prompt",
 * in order. A path is a backticked token (optionally wrapped in Edit(...)) made of path
 * characters with a "/", an extension or a "*"; only bullets carry paths, so a label line that
 * mentions .github/CODEOWNERS adds nothing.
 */
export function askFirstList(root, text) {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => /^#{1,6}\s+ask first\b/i.test(l))
  if (start < 0) return { found: false, edits: [] }
  const level = /^(#+)/.exec(lines[start] ?? '')?.[1]?.length ?? 1
  const edits = []
  let mode = null
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i] ?? ''
    const h = /^(#+)\s/.exec(l)
    if (h && (h[1]?.length ?? 0) <= level) break
    const bullet = /^\s*(?:[-*+]|\d+[.)])\s/.test(l)
    const own = /edits prompt/i.test(l) ? 'edits' : /stop and ask/i.test(l) ? 'stop' : null
    if (!bullet) {
      if (own) mode = own
      else if (h) mode = null
      continue
    }
    if ((own ?? mode) !== 'edits') continue
    for (const m of l.matchAll(/`([^`\n]+)`/g)) {
      const tok = EDIT_TOOL.exec(m[1] ?? '')?.[1] ?? m[1] ?? ''
      if (!PATHISH.test(tok) || !(tok.includes('/') || tok.includes('*') || EXT.test(tok))) continue
      for (const p of expandBraces(tok)) edits.push({ pattern: normalisePattern(root, p), line: i + 1 })
    }
  }
  return { found: true, edits }
}

/**
 * The path-gated block of .github/CODEOWNERS: the rule lines after the first comment containing
 * "path-gated" up to the first later comment containing "behaviour-gated" (or "behavior-gated"),
 * or the end of the file. The catch-all "*" rule is not part of it. Returns null when no comment
 * marks the block.
 */
export function codeownersBlock(root, text) {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => l.trim().startsWith('#') && /path-gated/i.test(l))
  if (start < 0) return null
  const out = []
  for (let i = start + 1; i < lines.length; i++) {
    const l = (lines[i] ?? '').trim()
    if (l.startsWith('#')) {
      if (/behaviou?r-gated/i.test(l)) break
      continue
    }
    if (l === '') continue
    const pattern = l.split(/\s+/)[0] ?? ''
    if (pattern !== '*') out.push({ pattern: normalisePattern(root, pattern.startsWith('/') ? pattern : `/${pattern}`), line: i + 1 })
  }
  return out
}

const unique = (list) => {
  const seen = new Set()
  return list.filter((e) => (seen.has(e.pattern) ? false : (seen.add(e.pattern), true)))
}

/**
 * Three lists are written in the same spelling and order and must agree, compared as normalised
 * path patterns (see normalisePattern):
 *   A  the Edit(...) / Write(...) entries of permissions.ask in .claude/settings.json;
 *   B  the paths on the "edits prompt" bullets of the Ask first section of CLAUDE.md;
 *   C  the path-gated block of .github/CODEOWNERS (the behaviour-gated block after it is not compared).
 * Every pattern missing from one list but present in another is a finding at the list that has
 * it ("settings has X which CLAUDE.md lacks"). When the sets agree but the order differs, one
 * finding says so.
 */
export function checkG10(root) {
  const out = []
  const settingsText = readText(root, '.claude/settings.json')
  const claudeText = readText(root, 'CLAUDE.md')
  const ownersText = readText(root, '.github/CODEOWNERS')
  const lists = []
  if (settingsText === null) out.push(finding('G10', '.claude/settings.json', 1, 'missing; its permissions.ask list is one of the three ask-first lists'))
  else {
    const parsed = askPatterns(root, settingsText)
    if (parsed === null) out.push(finding('G10', '.claude/settings.json', 1, 'is not valid JSON'))
    else lists.push({ file: '.claude/settings.json', name: 'permissions.ask', entries: unique(parsed) })
  }
  if (claudeText === null) out.push(finding('G10', 'CLAUDE.md', 1, 'missing; its Ask first list is one of the three ask-first lists'))
  else {
    const list = askFirstList(root, claudeText)
    if (!list.found) out.push(finding('G10', 'CLAUDE.md', 1, 'has no "Ask first" section'))
    else lists.push({ file: 'CLAUDE.md', name: 'the "Edits prompt" lines of CLAUDE.md', entries: unique(list.edits) })
  }
  if (ownersText === null) out.push(finding('G10', '.github/CODEOWNERS', 1, 'missing; its path-gated block is one of the three ask-first lists'))
  else {
    const block = codeownersBlock(root, ownersText)
    if (block === null) out.push(finding('G10', '.github/CODEOWNERS', 1, 'has no comment marking the path-gated block'))
    else lists.push({ file: '.github/CODEOWNERS', name: 'the path-gated block of .github/CODEOWNERS', entries: unique(block) })
  }
  for (const list of lists) {
    for (const e of list.entries) {
      const lacking = lists.filter((o) => o !== list && !o.entries.some((x) => x.pattern === e.pattern))
      if (lacking.length > 0) out.push(finding('G10', list.file, e.line, `${list.name} has ${e.pattern}, which ${lacking.map((o) => o.name).join(' and ')} lack${lacking.length === 1 ? 's' : ''}`))
    }
  }
  if (out.length === 0 && lists.length === 3) {
    const [first, ...rest] = lists
    for (const o of rest) {
      const a = first?.entries.map((e) => e.pattern) ?? []
      const b = o.entries.map((e) => e.pattern)
      if (a.join('\n') !== b.join('\n')) out.push(finding('G10', o.file, o.entries[0]?.line ?? 1, `${o.name} lists the same paths as ${first?.name} in a different order`))
    }
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// G11: wired in

/** The lines of a text that are not comments (# or //). */
const live = (text) => text.split('\n').filter((l) => !/^\s*(?:#|\/\/)/.test(l))

/** The lines of a JavaScript text that are not comments: not a `//` line, a `/*` line or a ` *` JSDoc line. */
const liveJs = (text) => text.split('\n').filter((l) => !/^\s*(?:\/\/|\/\*|\*)/.test(l))

const indentOf = (l) => /^\s*/.exec(l)?.[0].length ?? 0
const OFF_IF = /^if:\s*(?:\$\{\{\s*false\s*\}\}|(['"]?)false\1)\s*(?:#.*)?$/
const OFF_CONTINUE = /^continue-on-error:\s*(['"]?)true\1\s*(?:#.*)?$/
const switchedOff = (text) => OFF_IF.test(text) || OFF_CONTINUE.test(text)

/**
 * Whether the step that holds the `run:` line at `at`, or the job that holds that step, is switched
 * off: a key `if: false` or `continue-on-error: true` of the step, or of the job, at its own
 * indentation. Line-based: the step runs from its `- ` line to the next line indented less than its
 * keys; the job from its key under `jobs:` to the next line indented as little. Expressions,
 * flow-style mappings and anchors are not evaluated.
 */
function switchedOffAround(lines, at) {
  const line = lines[at] ?? ''
  const keyCol = line.search(/\brun:/)
  // The step.
  for (let j = at; j >= 0; j--) {
    const l = lines[j] ?? ''
    if (l.trim() === '') continue
    if (indentOf(l) < keyCol - 2) break
    const dash = /^(\s*)-(\s+)\S/.exec(l)
    if (!dash || (dash[1] ?? '').length + 1 + (dash[2] ?? '').length !== keyCol) continue
    for (let k = j; k < lines.length; k++) {
      const m = lines[k] ?? ''
      if (m.trim() === '') continue
      if (k > j && indentOf(m) < keyCol) break
      if (k === j ? switchedOff(m.slice(keyCol)) : indentOf(m) === keyCol && switchedOff(m.trim())) return true
    }
    break
  }
  // The job.
  const jobs = lines.slice(0, at).map((l, i) => [l, i]).reverse().find(([l]) => /^jobs:\s*$/.test(l))?.[1]
  if (jobs === undefined) return false
  const first = lines.findIndex((l, i) => i > jobs && l.trim() !== '')
  if (first < 0) return false
  const jobIndent = indentOf(lines[first] ?? '')
  let head = -1
  for (let j = at; j > jobs; j--) {
    if (lines[j]?.trim() !== '' && indentOf(lines[j] ?? '') === jobIndent) {
      head = j
      break
    }
  }
  if (head < 0) return false
  const childAt = lines.findIndex((l, i) => i > head && l.trim() !== '')
  const childIndent = indentOf(lines[childAt] ?? '')
  for (let k = head + 1; k < lines.length; k++) {
    const m = lines[k] ?? ''
    if (m.trim() === '') continue
    if (indentOf(m) <= jobIndent) break
    if (indentOf(m) === childIndent && switchedOff(m.trim())) return true
  }
  return false
}

/**
 * Whether a workflow has a `run:` step whose command is exactly `command`: on the `run:` line itself
 * or as a line of its block scalar. A comment or a step `name:` does not count, and neither does a
 * step (or a step in a job) carrying `if: false` or `continue-on-error: true`; see switchedOffAround
 * for how far that reads.
 */
export function ciRuns(ciText, command) {
  const lines = live(ciText)
  const same = (s) => s.trim().replace(/^(['"])(.*)\1$/, '$2').trim() === command
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[i] ?? '')
    if (!m) continue
    const rest = m[2] ?? ''
    let matched = false
    if (!/^[|>][-+]?\s*$/.test(rest)) matched = same(rest)
    else {
      const indent = (m[1] ?? '').length
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j] ?? ''
        if (l.trim() === '') continue
        if (indentOf(l) <= indent) break
        if (same(l)) {
          matched = true
          break
        }
      }
    }
    if (matched && !switchedOffAround(lines, i)) return true
  }
  return false
}

/**
 * Whether a shell script has a line that is exactly `command`, optionally after `exec` and leading
 * whitespace, with nothing after it but an optional `# comment`; never a line that also says
 * `exit 0` or `|| true`. Not inside echo, printf or a string; not with any other tail. The status
 * must also reach the caller: the line is `exec ...`, or the last live line of the script, or
 * comes after a live `set -e` line (`set -eu`, `set -euo pipefail`, `set -o errexit`); and the live
 * line before it does not end in a backslash (a continuation would make it an argument).
 */
export function shellRuns(script, command) {
  const esc = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^\\s*(exec\\s+)?${esc}(?:\\s+#.*)?\\s*$`)
  const lines = live(script)
  let last = lines.length - 1
  while (last >= 0 && (lines[last] ?? '').trim() === '') last--
  const errexit = /^\s*set\s+(?:-[a-zA-Z]*e[a-zA-Z]*|(?:-\S+\s+)*-o\s+errexit)(?:\s|$)/
  return lines.some((l, i) => {
    const m = re.exec(l)
    if (!m || /\bexit\s+0\b|\|\|\s*true\b/.test(l)) return false
    if (/\\\s*$/.test(lines[i - 1] ?? '')) return false
    return m[1] !== undefined || i === last || lines.slice(0, i).some((p) => errexit.test(p))
  })
}

export function checkG11(root) {
  const out = []
  const ci = readText(root, '.github/workflows/ci-tests.yml')
  if (ci === null) out.push(finding('G11', '.github/workflows/ci-tests.yml', 1, 'missing'))
  else {
    if (!ciRuns(ci, 'node scripts/check-guidance.mjs')) out.push(finding('G11', '.github/workflows/ci-tests.yml', 1, 'has no `run:` step whose command is `node scripts/check-guidance.mjs`'))
    if (!ciRuns(ci, 'node --test scripts/tests/') && !ciRuns(ci, 'node --test scripts/tests')) out.push(finding('G11', '.github/workflows/ci-tests.yml', 1, 'has no `run:` step whose command is `node --test scripts/tests/`'))
  }
  const hook = readText(root, '.githooks/pre-commit')
  if (hook === null) out.push(finding('G11', '.githooks/pre-commit', 1, 'missing'))
  else if (!shellRuns(hook, 'node scripts/verify.mjs --staged')) out.push(finding('G11', '.githooks/pre-commit', 1, 'has no line that is exactly `node scripts/verify.mjs --staged` whose status reaches git: `exec node scripts/verify.mjs --staged`, or the last live line, or after a live `set -e`; not after a line ending in a backslash (optionally with a comment; an echo, a comment, a tail such as `|| true` or `; exit 0` does not count)'))
  const verify = readText(root, 'scripts/verify.mjs')
  if (verify === null) out.push(finding('G11', 'scripts/verify.mjs', 1, 'missing'))
  else if (!liveJs(verify).some((l) => /\brun\(\s*'node'\s*,\s*\[\s*'scripts\/check-guidance\.mjs'/.test(l))) out.push(finding('G11', 'scripts/verify.mjs', 1, "does not run scripts/check-guidance.mjs: expected a `run('node', ['scripts/check-guidance.mjs', ...])` call (an import or a mention does not count)"))
  return out
}

// ---------------------------------------------------------------------------------------------
// G12: the evals file

export const EVALS = `${SKILL}/evals/evals.json`

/**
 * The hand-run prompts: the file exists and parses, each eval has a unique id, and every
 * expect_reads entry resolves by the pointer convention (a missing file is a finding; two matches
 * are not, since the entry names a file to read, not a link).
 */
export function checkG12(root) {
  const text = readText(root, EVALS)
  if (text === null) return [finding('G12', EVALS, 1, 'missing; SKILL.md points to it')]
  let json
  try {
    json = JSON.parse(text)
  } catch (e) {
    return [finding('G12', EVALS, 1, `is not valid JSON: ${e.message}`)]
  }
  if (!Array.isArray(json?.evals)) return [finding('G12', EVALS, 1, 'has no "evals" array')]
  const lines = text.split('\n')
  const at = (needle, from = 0) => Math.max(1, lines.findIndex((l, i) => i >= from && l.includes(needle)) + 1)
  const out = []
  const seen = new Map()
  for (const e of json.evals) {
    const id = e?.id
    if (typeof id !== 'string' || id === '') {
      out.push(finding('G12', EVALS, 1, 'an eval has no string "id"'))
      continue
    }
    const key = JSON.stringify(id)
    const first = seen.get(id)
    const line = first === undefined ? at(`"id": ${key}`) : at(`"id": ${key}`, first)
    if (first !== undefined) out.push(finding('G12', EVALS, line, `id ${key} is used twice (first at line ${first}); ids are unique`))
    else seen.set(id, line)
    for (const f of Array.isArray(e.expect_reads) ? e.expect_reads : []) {
      if (typeof f !== 'string' || resolvePointer(root, f).length === 0) out.push(finding('G12', EVALS, line, `eval ${key} expects a read of ${JSON.stringify(f)}, which does not resolve (looked in the root, ${MOD}/, the skill folder and its references/)`))
    }
  }
  return out
}

// ---------------------------------------------------------------------------------------------

export const CHECKS = [checkG1, checkG2, checkG3, checkG4, checkG5, checkG6, checkG7, checkG8, checkG9, checkG10, checkG11, checkG12]

export function checkAll(root) {
  return CHECKS.flatMap((check) => check(root))
}

export function formatFinding(f) {
  return `${f.id} ${f.file}:${f.line} ${f.message}`
}

export function main(argv, out = (s) => process.stdout.write(s)) {
  const json = argv.includes('--json')
  const rootAt = argv.indexOf('--root')
  const root = rootAt >= 0 && argv[rootAt + 1] ? resolve(argv[rootAt + 1] ?? '.') : resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const findings = checkAll(root)
  if (json) out(`${JSON.stringify({ findings }, null, 2)}\n`)
  else for (const f of findings) out(`${formatFinding(f)}\n`)
  return findings.length === 0 ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.stdout.on('error', () => {})
  process.exitCode = main(process.argv.slice(2))
}
