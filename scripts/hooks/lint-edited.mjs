#!/usr/bin/env node
// PostToolUse hook for Edit and Write (wired in .claude/settings.json): a small check of the one
// file just edited. It reads the hook's JSON from stdin and tells the model what it found; it
// never blocks and never fails: the whole body is in one try/catch, every child process has a
// timeout, anything it does not understand is silence, and it always exits 0.
//
// What it checks (this is a small check; the whole-project typecheck is `scripts/verify.mjs`):
//   .ts            syntax by Node's type stripper (`module.stripTypeScriptTypes`: it also refuses enum
//                  and namespace); for a .ts under mods/, a
//                  single-file `tsc --noEmit` with the flags of mods/tsconfig.json, 10 s at most,
//                  reported as "this file and its imports only", errors in the edited file only
//   .mjs .js       syntax by `node --check`
//   .json          JSON.parse
//   .sh            `bash -n`
//   all of those and .md   the .editorconfig rules: LF, final newline, no tab indentation, and
//                  no trailing whitespace outside .md
// Findings go to stdout as { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext } }.
// Input (the documented hook input): { tool_name, tool_input: { file_path }, cwd, ... }; a few other
// spellings of the file path are accepted.

import { spawnSync } from 'node:child_process'
import * as nodeModule from 'node:module'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_BYTES = 1024 * 1024
const MAX_FINDINGS = 8

/** The file path in a hook input, or null. */
export function filePathOf(input) {
  if (!input || typeof input !== 'object') return null
  const cands = [input.tool_input?.file_path, input.tool_input?.path, input.tool_response?.filePath, input.tool_response?.file_path, input.file_path]
  const found = cands.find((c) => typeof c === 'string' && c !== '')
  return found ?? null
}

/** .editorconfig findings for a text: LF, final newline, no tab indentation, no trailing whitespace outside .md. */
export function editorconfigFindings(text, ext) {
  const out = []
  if (text.includes('\r')) out.push('uses CRLF or a stray CR; the repository uses LF')
  if (text.length > 0 && !text.endsWith('\n')) out.push('has no final newline')
  const lines = text.split('\n')
  const tab = lines.findIndex((l) => /^\t/.test(l) || /^ +\t/.test(l))
  if (tab >= 0 && !text.includes('\r')) out.push(`line ${tab + 1} is indented with a tab; the repository uses spaces`)
  if (ext !== '.md') {
    const ws = lines.findIndex((l) => /[ \t]+\r?$/.test(l))
    if (ws >= 0) out.push(`line ${ws + 1} has trailing whitespace`)
  }
  return out
}

function run(cmd, args, timeout, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'] })
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, error: r.error }
}

const trimOut = (s) =>
  s
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l && !/ExperimentalWarning|--trace-warnings|^\(Use `node/.test(l))
    .slice(0, 6)
    .join('\n')

function findProjectRoot(file) {
  let dir = dirname(file)
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, '.git')) || existsSync(join(dir, 'mods', 'tsconfig.json'))) return dir
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}

/** Findings (strings) for one file; [] when clean or when it cannot be checked. */
export function lintFile(file, env = process.env) {
  const out = []
  let st
  try {
    st = statSync(file)
  } catch {
    return out
  }
  if (!st.isFile() || st.size > MAX_BYTES) return out
  const buf = readFileSync(file)
  if (buf.subarray(0, 8192).includes(0)) return out
  const text = buf.toString('utf8')
  const name = file.toLowerCase()
  const ext = name.endsWith('.d.ts') ? '.d.ts' : name.slice(name.lastIndexOf('.'))
  const known = ['.ts', '.tsx', '.mjs', '.js', '.json', '.sh', '.md', '.d.ts']
  if (!known.includes(ext)) return out

  const cwd = dirname(file)
  const syntax = (cmd, args, label) => {
    const r = run(cmd, args, 8000, cwd)
    if (r.error) return
    if (r.status !== 0) out.push(`${label} reports a syntax error:\n${trimOut(r.out)}`)
  }
  if (ext === '.ts') {
    // `node --check` does not parse an ES module written as .ts, so the type stripper is used in
    // process: it throws on a syntax error and on syntax that strip-only mode cannot run (enum, namespace).
    const strip = nodeModule.stripTypeScriptTypes
    if (typeof strip === 'function') {
      const emit = process.emitWarning
      process.emitWarning = () => {}
      try {
        strip(text)
      } catch (e) {
        out.push(`syntax error (node's type stripper): ${String(e instanceof Error ? e.message : e).split('\n')[0]}`)
      } finally {
        process.emitWarning = emit
      }
    }
  }
  else if (ext === '.mjs' || ext === '.js') syntax(process.execPath, ['--check', file], 'node --check')
  else if (ext === '.sh') syntax('bash', ['-n', file], 'bash -n')
  else if (ext === '.json') {
    try {
      JSON.parse(text)
    } catch (e) {
      out.push(`is not valid JSON: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (!(ext === '.d.ts' && st.size > 100_000)) {
    for (const f of editorconfigFindings(text, ext === '.d.ts' ? '.ts' : ext)) out.push(f)
  }

  if (ext === '.ts' && !out.some((o) => o.includes('syntax error'))) {
    const root = findProjectRoot(file)
    const rel = root ? relative(root, file).split(sep).join('/') : ''
    if (root && rel.startsWith('mods/') && existsSync(join(root, 'mods', 'tsconfig.json'))) {
      const tsc = tscFindings(root, file, env)
      if (tsc) out.push(tsc)
    }
  }
  return out
}

/** A single-file tsc with mods/tsconfig.json's flags: this file and its imports only. Null when clean or unavailable. */
function tscFindings(root, file, env) {
  const decls = [join(root, 'mods', 'types', 'claude-code.d.ts'), join(root, 'mods', 'council-of-elrond', 'types', 'index.d.ts')].filter((p) => existsSync(p))
  let dir
  try {
    dir = mkdtempSync(join(tmpdir(), 'lint-edited-'))
    const cfg = join(dir, 'tsconfig.json')
    writeFileSync(cfg, JSON.stringify({ extends: join(root, 'mods', 'tsconfig.json'), include: [], files: [...decls, file] }))
    const r = run(env.COUNCIL_TSC || 'tsc', ['-p', cfg, '--noEmit', '--pretty', 'false'], 10_000, root)
    if (r.error) return null
    if (r.status === 0) return null
    const mine = []
    let elsewhere = 0
    for (const l of r.out.split('\n')) {
      const m = /^(.*?)\((\d+),(\d+)\): (error TS\d+: .*)$/.exec(l)
      if (!m) continue
      if (resolve(root, m[1] ?? '') === file) mine.push(`${relative(root, file)}:${m[2]} ${m[4]}`)
      else elsewhere++
    }
    if (mine.length === 0) return null
    const more = elsewhere ? ` (${elsewhere} more in its imports or the declarations)` : ''
    return `tsc, this file and its imports only (the whole project is \`node scripts/verify.mjs\`):\n${mine.slice(0, MAX_FINDINGS).join('\n')}${more}`
  } catch {
    return null
  } finally {
    try {
      if (dir) rmSync(dir, { recursive: true, force: true })
    } catch {
      // nothing to do
    }
  }
}

function report(file, findings) {
  const text = `Checked ${file} after the edit (a small check: syntax and .editorconfig rules, plus tsc for this file under mods/):\n- ${findings.join('\n- ')}`
  writeSync(1, `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } })}\n`)
}

async function readStdin() {
  return new Promise((done) => {
    let data = ''
    const timer = setTimeout(() => done(data), 3000)
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => {
      data += c
    })
    process.stdin.on('end', () => {
      clearTimeout(timer)
      done(data)
    })
    process.stdin.on('error', () => {
      clearTimeout(timer)
      done(data)
    })
  })
}

async function main() {
  try {
    const raw = await readStdin()
    if (raw.trim() === '') return
    const input = JSON.parse(raw)
    const given = filePathOf(input)
    if (given === null) return
    const base = typeof input.cwd === 'string' && isAbsolute(input.cwd) ? input.cwd : process.cwd()
    const file = resolve(base, given)
    const findings = lintFile(file)
    if (findings.length > 0) report(relative(base, file) || file, findings)
  } catch {
    // Silence: a hook that cannot read its input says nothing.
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.on('uncaughtException', () => process.exit(0))
  main().finally(() => process.exit(0))
}
