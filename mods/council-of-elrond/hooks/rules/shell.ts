/**
 * Best-effort shell parsing, by hand: enough to split a compound command into
 * the commands it runs and read each one's program, arguments and redirects.
 * It is not a shell. The gaps it knows of are listed in the README; anything
 * it cannot follow stays in the text a rule's pattern sees.
 */

export type Redirect = { op: string; target: string }

export type ShellPart = {
  /** The part's source text, trimmed. */
  text: string
  /** Every word, quotes removed, assignments and keywords included. */
  words: readonly string[]
  /** Wrapper programs stripped from the front (`sudo`, `env`, `nice`, ...). */
  wrappers: readonly string[]
  /** The command after assignments, keywords and wrappers. */
  coreWords: readonly string[]
  /** `coreWords` joined by single spaces: what rule patterns match. */
  core: string
  redirects: readonly Redirect[]
  /** Bodies of heredocs and here-strings fed to this part. */
  input: string
  /** True when the part came from `$(...)`, backticks, a subshell, `sh -c` or `eval`. */
  isNested: boolean
}

export type Split = {
  parts: ShellPart[]
  /** The command was longer than MAX_COMMAND_CHARS and was not parsed. */
  isTooLong: boolean
  /** The part or depth limit cut the parse short. */
  isCut: boolean
}

export const MAX_COMMAND_CHARS = 20_000
const MAX_PARTS = 200
const MAX_DEPTH = 4

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh', 'ash', 'busybox'])

// `function` is not here: coreOf consumes it with the name that follows, so
// that `function f { ... }` does not hide the body behind the name `f`.
const KEYWORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until',
  'case', 'esac', 'in', 'coproc', 'select', '!', '{', '}',
])

/** A function-definition header word, e.g. `deploy()` or glued `deploy(){`. */
const FUNCTION_HEADER = /^[A-Za-z_]\w*\(\)\{?$/

/**
 * Wrapper programs and the options of each that take an argument. A wrapper
 * runs the command that follows it, so stripping it lets the rules see that
 * command. The privilege-changing ones also mark the part privileged (ask),
 * so a benign command run as another user is still gated.
 */
const WRAPPERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['sudo', new Set(['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-U', '-T', '--user', '--group'])],
  ['doas', new Set(['-u', '-C'])],
  ['env', new Set(['-u', '-C', '-S', '--unset', '--chdir', '--split-string'])],
  ['nice', new Set(['-n', '--adjustment'])],
  ['ionice', new Set(['-c', '-n', '-p', '-t'])],
  ['nohup', new Set()],
  ['time', new Set(['-f', '-o'])],
  ['command', new Set()],
  ['builtin', new Set()],
  ['exec', new Set(['-a'])],
  ['timeout', new Set(['-s', '-k', '--signal', '--kill-after'])],
  ['stdbuf', new Set(['-i', '-o', '-e'])],
  ['unbuffer', new Set()],
  ['caffeinate', new Set(['-t', '-w'])],
  // Process wrappers that run their argument command.
  ['chroot', new Set(['--userspec', '--groups'])],
  ['setsid', new Set()],
  ['flock', new Set(['-w', '--timeout', '-E', '--conflict-exit-code'])],
  ['strace', new Set(['-o', '-p', '-e', '-s', '-S', '-u'])],
  ['ltrace', new Set(['-o', '-p', '-e', '-s'])],
  ['watch', new Set(['-n', '--interval', '-d', '--differences'])],
  // Only options that always take a value; the namespace flags take none, so
  // listing them would swallow the command that follows.
  ['unshare', new Set(['--map-user', '--map-group'])],
  ['nsenter', new Set(['-t', '--target', '-S', '--setuid', '-G', '--setgid'])],
  ['chrt', new Set([])],
  ['taskset', new Set(['-c', '-p'])],
  ['numactl', new Set(['-N', '--cpunodebind', '-m', '--membind', '-C', '--physcpubind'])],
  ['setarch', new Set([])],
  ['eatmydata', new Set()],
  ['proxychains', new Set(['-f'])],
  ['proxychains4', new Set(['-f'])],
  ['xvfb-run', new Set(['-n', '-s', '-e', '-f'])],
  ['retry', new Set(['-t', '-d'])],
  // Privilege-changing wrappers (also flagged by the `privileged` check).
  ['gosu', new Set()],
  ['runuser', new Set(['-u', '-g', '-G', '-c', '--user', '--group'])],
  ['setpriv', new Set(['--reuid', '--regid', '--groups', '--inh-caps', '--ambient-caps', '--bounding-set'])],
  ['run0', new Set(['--uid', '--gid', '-u', '-g', '--setenv', '--chdir', '-D'])],
  ['chpst', new Set(['-u', '-U', '-e', '-/', '-n', '-l', '-L'])],
])

/**
 * Package-manager runners whose given subcommands run an arbitrary command
 * that follows (`poetry run rm ...`, `npm exec rm ...`). The prefix is
 * stripped so the rules see the command. A runner that fetches and runs an
 * arbitrary package by name (`npx`, `bunx`) is a wrapper below.
 */
const TWO_WORD_RUNNERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['npm', new Set(['exec', 'x'])],
  ['pnpm', new Set(['exec', 'dlx'])],
  ['yarn', new Set(['exec', 'dlx'])],
  ['poetry', new Set(['run'])],
  ['pipenv', new Set(['run'])],
  ['pdm', new Set(['run'])],
  ['rye', new Set(['run'])],
  ['hatch', new Set(['run'])],
  ['uv', new Set(['run'])],
  ['bundle', new Set(['exec'])],
  ['composer', new Set(['exec'])],
  ['conda', new Set(['run'])],
  ['mamba', new Set(['run'])],
  ['micromamba', new Set(['run'])],
])

/** One-word runners that fetch and run a command; stripped like a wrapper. */
const ONE_WORD_RUNNERS: ReadonlySet<string> = new Set(['npx', 'bunx', 'pnpx', 'uvx'])

/** Wrappers that run their command with changed privileges (ask, not allow). */
export const PRIVILEGE_WRAPPERS: ReadonlySet<string> = new Set(['sudo', 'doas', 'gosu', 'runuser', 'setpriv', 'run0', 'chpst'])

const GIT_GLOBALS_WITH_ARG = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env'])

const SYSTEM_BIN = /^\/(usr\/(local\/)?)?s?bin\/|^\/opt\/homebrew\/bin\/|^\/bin\//

const isAssignment = (word: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(word)

/**
 * Index of the character closing a group opened just before `start`,
 * respecting quotes and nesting; -1 when it never closes.
 */
function findClose(s: string, start: number, open: string, close: string): number {
  let depth = 1
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (c === '\\') {
      i++
    } else if (c === "'") {
      const end = s.indexOf("'", i + 1)
      if (end < 0) return -1
      i = end
    } else if (c === '"') {
      for (i++; i < s.length && s[i] !== '"'; i++) if (s[i] === '\\') i++
    } else if (c === '`' && open !== '`') {
      for (i++; i < s.length && s[i] !== '`'; i++) if (s[i] === '\\') i++
    } else if (c === close) {
      depth--
      if (depth === 0) return i
    } else if (c === open) {
      depth++
    }
  }
  return -1
}

type Builder = {
  parts: ShellPart[]
  isCut: boolean
}

/** Strips assignments, keywords, wrappers and git's global options. */
function coreOf(words: readonly string[]): { wrappers: string[]; coreWords: string[]; nestedScripts: string[] } {
  let k = 0
  const wrappers: string[] = []
  const nestedScripts: string[] = []
  // Skip leading assignments, plain keywords, function-definition headers and
  // a `case SUBJECT in PATTERN)` arm, so the command they wrap is what the
  // rules see. Without this a definition body or a case arm hides its command.
  const skipTrivia = () => {
    for (;;) {
      while (k < words.length && (isAssignment(words[k] as string) || KEYWORDS.has(words[k] as string))) k++
      const word = words[k]
      if (word === undefined) return
      if (word === 'function') {
        k++
        if (k < words.length && !KEYWORDS.has(words[k] as string)) k++ // the name
        continue
      }
      if (FUNCTION_HEADER.test(word)) {
        k++
        continue
      }
      return
    }
  }
  // A `case` arm: the subject, `in`, and the pattern up to its `)`.
  if (words[0] === 'case') {
    k = 1
    while (k < words.length && words[k] !== 'in') k++
    if (words[k] === 'in') k++
    while (k < words.length && !(words[k] as string).includes(')')) k++
    if (k < words.length) k++
  }
  for (;;) {
    skipTrivia()
    const word = words[k]
    if (word === undefined) break
    const name = word.includes('/') && SYSTEM_BIN.test(word) ? word.slice(word.lastIndexOf('/') + 1) : word

    // A two-word runner: `poetry run <cmd>`, `npm exec <cmd>`.
    const runnerSubs = TWO_WORD_RUNNERS.get(name)
    if (runnerSubs !== undefined && runnerSubs.has(words[k + 1] ?? '')) {
      wrappers.push(`${name} ${words[k + 1]}`)
      k += 2
      // Skip this runner's own options and their values until the command.
      while (k < words.length) {
        const option = words[k] as string
        if (option === '--') { k++; break }
        if (!option.startsWith('-')) break
        k += option.includes('=') ? 1 : 2 // `-n env`, `--no-capture-output`
      }
      continue
    }

    // A one-word fetch-and-run runner: `npx <pkg>`, `bunx <pkg>`.
    if (ONE_WORD_RUNNERS.has(name)) {
      wrappers.push(name)
      k++
      while (k < words.length) {
        const option = words[k] as string
        if (option === '--') { k++; break }
        if (option === '-c' || option === '--call') {
          nestedScripts.push(words[k + 1] ?? '')
          k += 2
          continue
        }
        if (!option.startsWith('-')) break
        k += option === '-p' || option === '--package' ? 2 : 1
      }
      continue
    }

    const takesArg = WRAPPERS.get(name)
    if (takesArg === undefined) break
    wrappers.push(name)
    k++
    while (k < words.length) {
      const option = words[k] as string
      if (option === '--') {
        k++
        break
      }
      if (name === 'env' && (isAssignment(option) || option === '-' || option === '-i' || option === '--ignore-environment')) {
        k++
        continue
      }
      // `env -S "cmd ..."` / `--split-string=...`: the value is a command line.
      if (name === 'env' && (option === '-S' || option === '--split-string' || option.startsWith('--split-string='))) {
        const value = option.includes('=') ? option.slice(option.indexOf('=') + 1) : (words[k + 1] ?? '')
        nestedScripts.push(value)
        k += option.includes('=') ? 1 : 2
        continue
      }
      if (!option.startsWith('-') || option === '-') break
      k += takesArg.has(option) ? 2 : 1
    }
    if (name === 'timeout' && k < words.length) k++ // the duration
    // chroot NEWROOT CMD, flock LOCKFILE CMD: one positional before the command.
    if ((name === 'chroot' || name === 'flock') && k < words.length && !(words[k] as string).startsWith('-')) k++
  }
  const coreWords = words.slice(k).map((word, index) =>
    index === 0 && word.includes('/') && SYSTEM_BIN.test(word) ? word.slice(word.lastIndexOf('/') + 1) : word,
  )
  if (coreWords[0] === 'git') {
    let g = 1
    while (g < coreWords.length && (coreWords[g] as string).startsWith('-')) {
      const option = coreWords[g] as string
      g += GIT_GLOBALS_WITH_ARG.has(option) ? 2 : 1
    }
    coreWords.splice(1, g - 1)
  }
  return { wrappers, coreWords, nestedScripts }
}

/** The script a shell runs with `-c` (any short-option cluster holding `c`). */
function inlineScriptOf(coreWords: readonly string[]): string | undefined {
  const program = coreWords[0]
  if (program === undefined) return undefined
  if (program === 'eval') return coreWords.slice(1).join(' ')
  if (!SHELLS.has(program) && program !== 'su') return undefined
  for (let i = 1; i < coreWords.length; i++) {
    const word = coreWords[i] as string
    if (word === '-c' || /^-[a-zA-Z]*c[a-zA-Z]*$/.test(word) || word === '--command') {
      return coreWords[i + 1]
    }
  }
  return undefined
}

function scan(command: string, depth: number, isNested: boolean, out: Builder): void {
  if (depth > MAX_DEPTH) {
    out.isCut = true
    return
  }

  let partStart = 0
  let words: string[] = []
  let word = ''
  let hasWord = false
  let isWordQuoted = false
  let redirects: Redirect[] = []
  let pendingTarget: string | undefined
  let pendingHeredocs: { tag: string; owner: number }[] = []
  let heredocTags: string[] = []
  let input = ''

  const nested = (text: string) => scan(text, depth + 1, true, out)

  // A command substitution inside a word. It is scanned for the commands it
  // runs, and leaves a placeholder in the word — but an empty one (`$()`, ``)
  // expands to nothing, so the surrounding text joins up (`r$()m` -> `rm`).
  const substitution = (inner: string): string => {
    if (inner.trim() === '') return ''
    nested(inner)
    return '$(...)'
  }

  const endWord = () => {
    if (!hasWord) return
    if (pendingTarget === '<<' || pendingTarget === '<<-') {
      heredocTags.push(word)
    } else if (pendingTarget === '<<<') {
      input += `${word}\n`
    } else if (pendingTarget !== undefined) {
      redirects.push({ op: pendingTarget, target: word })
    } else {
      words.push(word)
    }
    pendingTarget = undefined
    word = ''
    hasWord = false
    isWordQuoted = false
  }

  const endPart = (end: number) => {
    endWord()
    const text = command.slice(partStart, end).trim()
    const owner = out.parts.length
    if (words.length > 0 || redirects.length > 0) {
      if (out.parts.length >= MAX_PARTS) {
        out.isCut = true
      } else {
        const { wrappers, coreWords, nestedScripts } = coreOf(words)
        const part: ShellPart = {
          text,
          words,
          wrappers,
          coreWords,
          core: coreWords.join(' '),
          redirects,
          input,
          isNested,
        }
        out.parts.push(part)
        const script = inlineScriptOf(coreWords)
        if (script !== undefined && script !== '') nested(script)
        for (const nestedScript of nestedScripts) if (nestedScript !== '') nested(nestedScript)
      }
    }
    if (out.parts.length > owner) {
      pendingHeredocs.push(...heredocTags.map(tag => ({ tag, owner })))
    }
    heredocTags = []
    words = []
    redirects = []
    input = ''
  }

  /** Consumes heredoc bodies after a newline at `i`; returns the new index. */
  const takeHeredocs = (i: number): number => {
    let at = i + 1
    for (const { tag, owner } of pendingHeredocs) {
      let body = ''
      while (at <= command.length) {
        const lineEnd = command.indexOf('\n', at)
        const line = command.slice(at, lineEnd < 0 ? command.length : lineEnd)
        at = lineEnd < 0 ? command.length + 1 : lineEnd + 1
        if (line.replace(/^\t+/, '') === tag) break
        body += `${line}\n`
      }
      const part = out.parts[owner]
      if (part === undefined) continue
      out.parts[owner] = { ...part, input: part.input + body }
      const isFedToShell = out.parts
        .slice(owner)
        .some(later => later.isNested === isNested && SHELLS.has(later.coreWords[0] ?? ''))
      if (isFedToShell) nested(body)
    }
    pendingHeredocs = []
    return at - 1
  }

  for (let i = 0; i < command.length; i++) {
    const c = command[i] as string
    const next = command[i + 1]

    if (c === '\\') {
      if (next === '\n') {
        i++
        continue
      }
      if (next !== undefined) word += next
      hasWord = true
      i++
      continue
    }
    if (c === "'") {
      const end = command.indexOf("'", i + 1)
      const stop = end < 0 ? command.length : end
      word += command.slice(i + 1, stop)
      hasWord = true
      isWordQuoted = true
      i = stop
      continue
    }
    if (c === '$' && next === "'") {
      let j = i + 2
      for (; j < command.length && command[j] !== "'"; j++) {
        if (command[j] !== '\\') {
          word += command[j]
          continue
        }
        // $'...' decodes C-style escapes, so the program name can be written
        // $'\x72m', $'\162m' or $'rm'. Decode them to what the shell runs.
        j++
        const e = command[j] as string | undefined
        if (e === undefined) break
        const simple: Record<string, string> = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', e: '\x1b', '\\': '\\', "'": "'", '"': '"' }
        if (e === 'x' || e === 'u' || e === 'U') {
          const len = e === 'x' ? 2 : e === 'u' ? 4 : 8
          const hex = /^[0-9a-fA-F]+/.exec(command.slice(j + 1, j + 1 + len))?.[0] ?? ''
          if (hex !== '') {
            word += String.fromCodePoint(parseInt(hex, 16))
            j += hex.length
          } else {
            word += e
          }
        } else if (e >= '0' && e <= '7') {
          const oct = /^[0-7]{1,3}/.exec(command.slice(j))?.[0] ?? e
          word += String.fromCharCode(parseInt(oct, 8) & 0xff)
          j += oct.length - 1
        } else {
          word += simple[e] ?? e
        }
      }
      hasWord = true
      isWordQuoted = true
      i = j
      continue
    }
    // `$"..."` is locale translation: the shell runs it as `"..."`.
    if (c === '"' || (c === '$' && next === '"')) {
      let j = c === '$' ? i + 2 : i + 1
      for (; j < command.length && command[j] !== '"'; j++) {
        const d = command[j] as string
        if (d === '\\' && /["\\$`\n]/.test(command[j + 1] ?? '')) {
          j++
          if (command[j] !== '\n') word += command[j]
        } else if (d === '$' && command[j + 1] === '(' && command[j + 2] !== '(') {
          const close = findClose(command, j + 2, '(', ')')
          const stop = close < 0 ? command.length : close
          word += substitution(command.slice(j + 2, stop))
          j = stop
        } else if (d === '`') {
          const close = command.indexOf('`', j + 1)
          const stop = close < 0 ? command.length : close
          word += substitution(command.slice(j + 1, stop))
          j = stop
        } else {
          word += d
        }
      }
      hasWord = true
      isWordQuoted = true
      i = j
      continue
    }
    if (c === '$' && next === '(') {
      if (command[i + 2] === '(') {
        const close = findClose(command, i + 3, '(', ')')
        const stop = close < 0 ? command.length : Math.min(command.length, close + 1)
        word += command.slice(i, stop + 1)
        hasWord = true
        i = stop
        continue
      }
      const close = findClose(command, i + 2, '(', ')')
      const stop = close < 0 ? command.length : close
      word += substitution(command.slice(i + 2, stop))
      hasWord = true
      i = stop
      continue
    }
    if (c === '`') {
      const close = command.indexOf('`', i + 1)
      const stop = close < 0 ? command.length : close
      word += substitution(command.slice(i + 1, stop))
      hasWord = true
      i = stop
      continue
    }
    if ((c === '<' || c === '>') && next === '(') {
      endWord()
      const close = findClose(command, i + 2, '(', ')')
      const stop = close < 0 ? command.length : close
      nested(command.slice(i + 2, stop))
      words.push('<(...)')
      i = stop
      continue
    }
    if (c === '(' && !hasWord && words.length === 0) {
      const close = findClose(command, i + 1, '(', ')')
      const stop = close < 0 ? command.length : close
      nested(command.slice(i + 1, stop))
      partStart = stop + 1
      i = stop
      continue
    }
    if (c === '#' && !hasWord) {
      const lineEnd = command.indexOf('\n', i)
      i = (lineEnd < 0 ? command.length : lineEnd) - 1
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      endWord()
      continue
    }
    if (c === '\n') {
      endPart(i)
      if (pendingHeredocs.length > 0) i = takeHeredocs(i)
      partStart = i + 1
      continue
    }
    if (c === ';' || c === '|' || (c === '&' && next !== '>')) {
      endPart(i)
      if ((c === '&' && next === '&') || (c === '|' && (next === '|' || next === '&')) || (c === ';' && next === ';')) i++
      partStart = i + 1
      continue
    }
    if (c === '>' || c === '<' || (c === '&' && next === '>')) {
      if (hasWord && !isWordQuoted && /^\d+$/.test(word)) {
        word = ''
        hasWord = false
      } else {
        endWord()
      }
      let op = c
      let j = i + 1
      if (c === '&') {
        op = '&>'
        j = i + 2
        if (command[j] === '>') {
          op = '&>>'
          j++
        }
      } else if (c === '>') {
        if (command[j] === '>' || command[j] === '|') op += command[j++]
        if (command[j] === '&') {
          // `>&2`, `2>&1`: a descriptor, not a file
          j++
          const fd = /^[0-9-]+/.exec(command.slice(j))
          if (fd !== null) {
            i = j + fd[0].length - 1
            continue
          }
          op = '&>'
        }
      } else {
        if (command[j] === '<') {
          op = '<<'
          j++
          if (command[j] === '<') {
            op = '<<<'
            j++
          } else if (command[j] === '-') {
            op = '<<-'
            j++
          }
        } else if (command[j] === '&' || command[j] === '>') {
          op += command[j++]
        }
      }
      pendingTarget = op
      i = j - 1
      continue
    }
    word += c
    hasWord = true
  }
  endPart(command.length)
  if (pendingHeredocs.length > 0) takeHeredocs(command.length)
}

/** Splits a shell command into the commands it would run. */
export function splitShell(command: string): Split {
  if (command.length > MAX_COMMAND_CHARS) {
    return { parts: [], isTooLong: true, isCut: false }
  }
  const out: Builder = { parts: [], isCut: false }
  scan(command, 0, false, out)
  return { parts: out.parts, isTooLong: false, isCut: out.isCut }
}
