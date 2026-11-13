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
  /** Its standard input comes from the pipe of the part before it. */
  isPiped: boolean
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
  // chrt and taskset take one positional (priority, mask or list) before the
  // command; coreOf skips it, except in the pid forms (`-p`), which run nothing.
  // taskset keeps `-p` as a value option so a pid form is read as it always was.
  ['chrt', new Set(['-T', '-P', '-D', '--sched-runtime', '--sched-period', '--sched-deadline'])],
  ['taskset', new Set(['-p'])],
  ['numactl', new Set(['-N', '--cpunodebind', '-m', '--membind', '-C', '--physcpubind'])],
  ['setarch', new Set([])],
  // Multi-call binaries and sandbox runners: the command that follows is what runs.
  ['busybox', new Set()],
  ['toybox', new Set()],
  ['fakeroot', new Set(['-l', '--lib', '-f', '--faked', '-i', '-s', '-b'])],
  ['firejail', new Set()],
  ['systemd-run', new Set([
    '-u', '--unit', '-p', '--property', '-E', '--setenv', '-M', '--machine', '-H', '--host', '-D', '--working-directory',
    '--description', '--slice', '--uid', '--gid', '--nice', '--service-type', '--timer-property', '--on-active',
    '--on-boot', '--on-startup', '--on-unit-active', '--on-unit-inactive', '--on-calendar', '--on-clock-change',
    '--on-timezone-change', '--root-directory', '--job-mode',
  ])],
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
  ['pkexec', new Set(['--user'])],
])

type Runner = {
  /** The subcommands that run the command that follows. */
  subs: ReadonlySet<string>
  /** Options that take the next word as their value. */
  values?: ReadonlySet<string>
  /** Options of this runner that take no value. */
  flags?: ReadonlySet<string>
  /** Options whose value is a script a shell runs (`npm exec -c "..."`). */
  scripts?: ReadonlySet<string>
  /** Tool specs (`node@20`) come before the `--` that starts the command. */
  hasToolSpecs?: boolean
}

const setOf = (...list: string[]): ReadonlySet<string> => new Set(list)

/** Options that take no value in every runner below (a runner's own `values` win). */
const RUNNER_FLAGS = setOf(
  '--yes', '-y', '--no', '--quiet', '-q', '--verbose', '-v', '-vv', '--silent', '--offline', '--frozen', '--locked',
  '--no-sync', '--no-project', '--isolated', '--no-cache', '--no-capture-output', '--live-stream', '--no-install',
  '--no-progress', '--dev', '--no-dev', '--no-env-file', '--active', '--refresh', '--reinstall', '--no-build',
  '--no-binary', '--debug-wrapper-scripts', '--change-ps1', '--no-change-ps1', '--include-workspace-root',
  '--workspaces', '-ws', '--no-masking', '--no-color', '--no-interaction', '-n', '--no-ansi', '--ansi',
)

/** A tool written `name@version`, as `mise exec node@20 -- cmd` takes them. */
const TOOL_SPEC = /^[^\s@-][^\s@]*@\S+$/

/**
 * Runners whose given subcommands run an arbitrary command that follows
 * (`poetry run rm ...`, `npm exec rm ...`). The prefix is stripped so the rules
 * see the command. A runner that fetches and runs an arbitrary package by name
 * (`npx`, `bunx`) is a wrapper below. An option the tables do not know is read
 * as taking a value (as every option once was) and the call is also reviewed.
 */
const TWO_WORD_RUNNERS: ReadonlyMap<string, Runner> = new Map([
  ['npm', { subs: setOf('exec', 'x'), values: setOf('-p', '--package', '-w', '--workspace', '--prefix', '--registry', '--userconfig', '--cache', '--loglevel'), scripts: setOf('-c', '--call') }],
  ['pnpm', { subs: setOf('exec', 'dlx'), values: setOf('-C', '--dir', '--filter', '-F', '--reporter', '--workspace-concurrency'), flags: setOf('-c', '--shell-mode', '-r', '--recursive') }],
  ['yarn', { subs: setOf('exec', 'dlx'), values: setOf('-p', '--package') }],
  ['poetry', { subs: setOf('run'), values: setOf('-C', '--directory', '-P', '--project') }],
  ['pipenv', { subs: setOf('run'), values: setOf('--python', '--pypi-mirror') }],
  ['pdm', { subs: setOf('run'), values: setOf('-p', '--project') }],
  ['rye', { subs: setOf('run') }],
  ['hatch', { subs: setOf('run'), values: setOf('-e', '--env', '-i', '--include', '-x', '--exclude') }],
  ['uv', { subs: setOf('run'), values: setOf(
    '-p', '--python', '--with', '--with-editable', '--with-requirements', '--extra', '--group', '--no-group', '--only-group',
    '--package', '--project', '--directory', '--env-file', '--index', '--default-index', '--index-url', '--extra-index-url',
    '-f', '--find-links', '--config-file', '--cache-dir', '--python-preference', '--resolution', '--prerelease', '--link-mode',
    '--exclude-newer', '--index-strategy', '--keyring-provider', '--color', '-P', '--upgrade-package', '--refresh-package',
    '--reinstall-package', '-C', '--config-setting', '--no-binary-package', '--no-build-package', '--python-platform',
  ) }],
  ['bundle', { subs: setOf('exec'), flags: setOf('--keep-file-descriptors') }],
  ['composer', { subs: setOf('exec'), values: setOf('-d', '--working-dir') }],
  ['conda', { subs: setOf('run'), values: setOf('-n', '--name', '-p', '--prefix', '--cwd') }],
  ['mamba', { subs: setOf('run'), values: setOf('-n', '--name', '-p', '--prefix', '--cwd') }],
  ['micromamba', { subs: setOf('run'), values: setOf('-n', '--name', '-p', '--prefix', '--cwd', '-r', '--root-prefix', '-a', '--attach') }],
  ['op', { subs: setOf('run'), values: setOf('--env-file', '--account', '--cache', '--config', '--session', '--format', '--iso-timestamps') }],
  ['doppler', { subs: setOf('run'), values: setOf(
    '-p', '--project', '-c', '--config', '-t', '--token', '--mount', '--mount-format', '--mount-max-reads', '--mount-template',
    '--name-transformer', '--fallback', '--only-secrets', '--preserve-env', '--api-host', '--scope',
  ), scripts: setOf('--command') }],
  ['mise', { subs: setOf('exec', 'x'), values: setOf('-C', '--cd', '-E', '--env', '-j', '--jobs'), scripts: setOf('-c', '--command'), hasToolSpecs: true }],
])

/** One-word runners that fetch and run a command; stripped like a wrapper. */
const ONE_WORD_RUNNERS: ReadonlySet<string> = new Set(['npx', 'bunx', 'pnpx', 'uvx'])

/** Wrappers that run their command with changed privileges (ask, not allow). */
export const PRIVILEGE_WRAPPERS: ReadonlySet<string> = new Set(['sudo', 'doas', 'gosu', 'runuser', 'setpriv', 'run0', 'chpst', 'pkexec'])

const GIT_GLOBALS_WITH_ARG = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env'])

/**
 * Subcommand tools whose global options come before the verb, with the
 * options of each that take a separate value. Stripping these leading options
 * lets a rule anchored on `<tool> <verb>` match `kubectl -n prod delete ...`.
 * An option written `--opt=value` is one token and needs no entry.
 */
const SUBCOMMAND_GLOBALS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['kubectl', new Set(['-n', '--namespace', '--context', '--cluster', '--user', '--kubeconfig', '-s', '--server', '--as', '--as-group', '--as-uid', '--token', '--cache-dir', '--request-timeout', '--tls-server-name', '--client-certificate', '--client-key', '--certificate-authority', '-v', '--v'])],
  ['helm', new Set(['-n', '--namespace', '--kube-context', '--kubeconfig', '--kube-apiserver', '--kube-as-user', '--kube-as-group', '--kube-token', '--kube-ca-file', '--registry-config', '--repository-config', '--repository-cache', '--burst-limit'])],
  ['docker', new Set(['-H', '--host', '-c', '--context', '--config', '-l', '--log-level', '--tlscacert', '--tlscert', '--tlskey'])],
  ['terraform', new Set()],
  ['tofu', new Set()],
])

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

type Core = {
  wrappers: string[]
  coreWords: string[]
  nestedScripts: string[]
  /**
   * The words from a runner whose inner command could not be found for sure
   * (an option the tables do not know): they are classified again as they
   * stand, so a rule can send the call to review.
   */
  unresolved?: string[]
}

/** `setarch` architecture names (the first positional); a command is never read as one. */
const ARCH = /^(linux(32|64)|uname26|i[3-6]86|x86|x86_64|ia64|alpha|arm|armv\d\w*|aarch64(_be)?|mips(64)?(el)?|ppc(64)?(le)?|powerpc(64)?|s390x?|sparc(32bash|64)?|sparc32|parisc(64)?|hppa(64)?|riscv(32|64)|loongarch64|sh[234]|m68k)$/

/** Wrappers with a pid form (`chrt -p 10 123`, `taskset -p 123`) that runs no command. */
const PID_WRAPPERS: ReadonlySet<string> = new Set(['chrt', 'taskset'])
const PID_OPTION = /^-[A-Za-z]*p[A-Za-z]*$|^--pid$/

/** Wrappers whose every option is known: an unknown one is not guessed at. */
const KNOWN_FLAGS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['fakeroot', setOf('-u', '--unknown-is-real', '-h', '--help', '-v', '--version')],
  ['systemd-run', setOf(
    '--user', '--system', '--scope', '--no-block', '--wait', '--pty', '-t', '--pipe', '-P', '--shell', '-S',
    '--no-ask-password', '--collect', '-q', '--quiet', '--remain-after-exit', '-r', '--same-dir', '-d', '--send-sighup',
    '--ignore-failure', '--no-pager', '--no-wall', '-h', '--help', '--version', '--slice-inherit', '--expand-environment',
  )],
])

/** A word as a shell would read it back: quoted unless it is plainly safe. */
const quoted = (word: string): string => (/^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`)

/** Strips assignments, keywords, wrappers and git's global options. */
function coreOf(words: readonly string[]): Core {
  let k = 0
  const wrappers: string[] = []
  const nestedScripts: string[] = []
  let unresolved: string[] | undefined
  const markUnresolved = (from: number) => {
    unresolved ??= words.slice(from)
  }
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
    const start = k

    // A two-word runner: `poetry run <cmd>`, `npm exec <cmd>`.
    const runner = TWO_WORD_RUNNERS.get(name)
    if (runner !== undefined && runner.subs.has(words[k + 1] ?? '')) {
      wrappers.push(`${name} ${words[k + 1]}`)
      k += 2
      let hasSeparator = false
      let hasSpec = false
      // Skip this runner's own options and their values until the command.
      while (k < words.length) {
        const option = words[k] as string
        if (option === '--') {
          k++
          hasSeparator = true
          break
        }
        if (runner.hasToolSpecs === true && TOOL_SPEC.test(option)) {
          hasSpec = true
          k++
          continue
        }
        if (!option.startsWith('-')) break
        const eq = option.indexOf('=')
        if (runner.scripts?.has(eq < 0 ? option : option.slice(0, eq)) === true) {
          nestedScripts.push(eq < 0 ? (words[k + 1] ?? '') : option.slice(eq + 1))
          k += eq < 0 ? 2 : 1
        } else if (eq >= 0) {
          k++ // `--opt=value`
        } else if (runner.values?.has(option) === true) {
          k += 2 // `-n env`
        } else if (runner.flags?.has(option) === true || RUNNER_FLAGS.has(option)) {
          k++ // `--no-capture-output`
        } else {
          markUnresolved(start)
          k += 2 // not known: read as taking a value, as every option once was
        }
      }
      if (hasSpec && !hasSeparator) markUnresolved(start)
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
    const known = KNOWN_FLAGS.get(name)
    let isPidForm = false
    let splitString: string | undefined
    const skipOptions = () => {
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
        // `env -S "cmd ..."`, `-S'cmd'`, `-vS ...`, `--split-string=...`: the
        // value is a command line (the words after it are its arguments).
        if (name === 'env') {
          const attached = /^-[iv0]*S/.exec(option)
          if (attached !== null || option === '--split-string' || option.startsWith('--split-string=')) {
            const inline = attached !== null ? option.slice(attached[0].length) : option.includes('=') ? option.slice(option.indexOf('=') + 1) : ''
            const isInline = inline !== '' || option.startsWith('--split-string=')
            splitString = isInline ? inline : (words[k + 1] ?? '')
            k += isInline ? 1 : 2
            continue
          }
        }
        if (!option.startsWith('-') || option === '-') break
        if (PID_WRAPPERS.has(name) && PID_OPTION.test(option)) isPidForm = true
        // `exec -la name cmd`: `-a` last in a cluster takes the next word.
        if (name === 'exec' && /^-[cl]+a$/.test(option)) {
          k += 2
          continue
        }
        if (known !== undefined && !takesArg.has(option) && !known.has(option) && !option.includes('=')) markUnresolved(start)
        k += takesArg.has(option) ? 2 : 1
      }
    }
    skipOptions()
    // setarch ARCH [options] CMD: the architecture is not the command.
    if (name === 'setarch' && ARCH.test(words[k] ?? '')) {
      k++
      skipOptions()
    }
    if (name === 'timeout' && k < words.length) k++ // the duration
    // chroot NEWROOT CMD, flock LOCKFILE CMD: one positional before the command.
    if ((name === 'chroot' || name === 'flock') && k < words.length && !(words[k] as string).startsWith('-')) k++
    // chrt PRIORITY CMD, taskset MASK CMD: the same, unless it is a pid form.
    if (PID_WRAPPERS.has(name) && !isPidForm && k < words.length) k++
    if (splitString !== undefined) nestedScripts.push([splitString, ...words.slice(k).map(quoted)].join(' '))
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
  const subGlobals = SUBCOMMAND_GLOBALS.get(coreWords[0] ?? '')
  if (subGlobals !== undefined) {
    let g = 1
    while (g < coreWords.length && (coreWords[g] as string).startsWith('-')) {
      const option = coreWords[g] as string
      g += !option.includes('=') && subGlobals.has(option) ? 2 : 1
    }
    coreWords.splice(1, g - 1)
  }
  return { wrappers, coreWords, nestedScripts, ...(unresolved !== undefined && { unresolved }) }
}

/** `script` options that take the next word. */
const SCRIPT_VALUE_OPTIONS = new Set(['-c', '-E', '-I', '-O', '-B', '-T', '-m'])

/**
 * The command of `script FILE COMMAND...` (the BSD form): what follows the
 * typescript file, the first word after the options.
 */
function scriptCommandOf(coreWords: readonly string[]): string | undefined {
  let i = 1
  for (; i < coreWords.length; i++) {
    const word = coreWords[i] as string
    if (word === '--') {
      i++
      break
    }
    if (!word.startsWith('-')) break
    // BSD `-t time` takes a number; util-linux `-t` takes none.
    if (SCRIPT_VALUE_OPTIONS.has(word) || (word === '-t' && /^\d+$/.test(coreWords[i + 1] ?? ''))) i++
  }
  // The word at `i` is the typescript file; everything after it is the command.
  const command = coreWords.slice(i + 1)
  return command.length > 0 ? command.map(quoted).join(' ') : undefined
}

/** `tmux` subcommands that start a command in a pane or window, with their options that take a value. */
const TMUX_SUBCOMMANDS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['new-session', setOf('-c', '-e', '-f', '-F', '-n', '-s', '-t', '-x', '-y')],
  ['new', setOf('-c', '-e', '-f', '-F', '-n', '-s', '-t', '-x', '-y')],
  ['new-window', setOf('-c', '-e', '-F', '-n', '-t')],
  ['neww', setOf('-c', '-e', '-F', '-n', '-t')],
  ['split-window', setOf('-c', '-e', '-F', '-l', '-p', '-t')],
  ['splitw', setOf('-c', '-e', '-F', '-l', '-p', '-t')],
  ['respawn-pane', setOf('-c', '-e', '-t')],
  ['respawnp', setOf('-c', '-e', '-t')],
])

/** The shell command a `tmux new-session|new-window|split-window|respawn-pane` runs, from its trailing arguments. */
function tmuxScriptOf(coreWords: readonly string[]): string | undefined {
  let i = 1
  // tmux's own options come first; `-c` there is a shell command too.
  for (; i < coreWords.length && (coreWords[i] as string).startsWith('-'); i++) {
    const option = coreWords[i] as string
    if (option === '-c') return coreWords[i + 1]
    if (['-L', '-S', '-f', '-T'].includes(option)) i++
  }
  const valued = TMUX_SUBCOMMANDS.get(coreWords[i] ?? '')
  if (valued === undefined) return undefined
  for (i++; i < coreWords.length; i++) {
    const option = coreWords[i] as string
    if (option === '--') {
      i++
      break
    }
    if (!option.startsWith('-') || option === '-') break
    // getopt: the first letter that takes a value ends the cluster; the value
    // is the rest of the word, or the next word when it was the last letter.
    for (let c = 1; c < option.length; c++) {
      if (!valued.has(`-${option[c]}`)) continue
      if (c === option.length - 1) i++
      break
    }
  }
  const rest = coreWords.slice(i)
  return rest.length === 0 ? undefined : rest.map((word, index) => (index === 0 && rest.length === 1 ? word : quoted(word))).join(' ')
}

/** The script a shell runs with `-c` (any short-option cluster holding `c`). */
function inlineScriptOf(coreWords: readonly string[]): string | undefined {
  const program = coreWords[0]
  if (program === undefined) return undefined
  if (program === 'eval') return coreWords.slice(1).join(' ')
  if (program === 'tmux') return tmuxScriptOf(coreWords)
  if (program === 'nix-shell') {
    for (let i = 1; i < coreWords.length; i++) {
      const word = coreWords[i] as string
      if (word === '--run' || word === '--command') return coreWords[i + 1]
      const eq = /^--(run|command)=([\s\S]*)$/.exec(word)
      if (eq !== null) return eq[2]
    }
    return undefined
  }
  // `script -c CMD` runs CMD in a shell, as `sh -c` does.
  if (!SHELLS.has(program) && program !== 'su' && program !== 'script') return undefined
  for (let i = 1; i < coreWords.length; i++) {
    const word = coreWords[i] as string
    if (word.startsWith('--command=')) return word.slice('--command='.length)
    if (word === '-c' || /^-[a-zA-Z]*c[a-zA-Z]*$/.test(word) || word === '--command') {
      // `--` ends option parsing: `sh -c -- 'cmd'` runs `cmd`, not `--`.
      return coreWords[i + 1] === '--' ? coreWords[i + 2] : coreWords[i + 1]
    }
  }
  return program === 'script' ? scriptCommandOf(coreWords) : undefined
}

/**
 * The command substitutions (`$(...)`, backticks) in text a shell expands but
 * does not run as a script, such as an unquoted heredoc body. A backslash
 * escapes the next character; the inside of `$((...))` is searched too.
 */
function substitutionsIn(text: string, depth = 0): string[] {
  const found: string[] = []
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') {
      i++
    } else if (c === '$' && text[i + 1] === '(') {
      const isArithmetic = text[i + 2] === '('
      const from = i + (isArithmetic ? 3 : 2)
      const close = findClose(text, from, '(', ')')
      const stop = close < 0 ? text.length : close
      const inner = text.slice(from, stop)
      if (!isArithmetic) found.push(inner)
      else if (depth < MAX_DEPTH) found.push(...substitutionsIn(inner, depth + 1))
      i = stop
    } else if (c === '`') {
      let j = i + 1
      for (; j < text.length && text[j] !== '`'; j++) if (text[j] === '\\') j++
      found.push(text.slice(i + 1, Math.min(j, text.length)))
      i = j
    }
  }
  return found
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
  let isWordEscaped = false
  let redirects: Redirect[] = []
  let pendingTarget: string | undefined
  let pendingHeredocs: { tag: string; owner: number; isExpanded: boolean }[] = []
  let heredocTags: { tag: string; isExpanded: boolean }[] = []
  let input = ''
  // The next part reads the pipe of the one before it.
  let isPipeNext = false

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
      // Any quote or backslash in the delimiter makes the body plain data.
      heredocTags.push({ tag: word, isExpanded: !isWordQuoted && !isWordEscaped })
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
    isWordEscaped = false
  }

  const endPart = (end: number) => {
    endWord()
    const text = command.slice(partStart, end).trim()
    const owner = out.parts.length
    const isPiped = isPipeNext
    isPipeNext = false
    if (words.length > 0 || redirects.length > 0) {
      if (out.parts.length >= MAX_PARTS) {
        out.isCut = true
      } else {
        const { wrappers, coreWords, nestedScripts, unresolved } = coreOf(words)
        const part: ShellPart = {
          text,
          words,
          wrappers,
          coreWords,
          core: coreWords.join(' '),
          redirects,
          input,
          isNested,
          isPiped,
        }
        out.parts.push(part)
        // A runner whose inner command was not found for sure: the words as
        // they stand are a part of their own, so a rule can review the call.
        if (unresolved !== undefined && out.parts.length < MAX_PARTS) {
          out.parts.push({ ...part, wrappers: [], coreWords: unresolved, core: unresolved.join(' '), redirects: [], input: '' })
        }
        const script = inlineScriptOf(coreWords)
        if (script !== undefined && script !== '') nested(script)
        for (const nestedScript of nestedScripts) if (nestedScript !== '') nested(nestedScript)
      }
    }
    if (out.parts.length > owner) {
      pendingHeredocs.push(...heredocTags.map(({ tag, isExpanded }) => ({ tag, owner, isExpanded })))
    }
    heredocTags = []
    words = []
    redirects = []
    input = ''
  }

  /** Consumes heredoc bodies after a newline at `i`; returns the new index. */
  const takeHeredocs = (i: number): number => {
    let at = i + 1
    for (const { tag, owner, isExpanded } of pendingHeredocs) {
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
      // An unquoted delimiter: the shell expands `$(...)` and backticks in the
      // body, so the commands they run are parts of this call.
      else if (isExpanded) for (const inner of substitutionsIn(body)) if (inner.trim() !== '') nested(inner)
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
      isWordEscaped = true
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
    // An unquoted $IFS or ${IFS} (and the empty $9 that follows it as a trick)
    // is whitespace: `rm${IFS}-rf${IFS}~` is `rm -rf ~`.
    if (c === '$') {
      const separator = /^\$(?:\{IFS\}|IFS(?![A-Za-z0-9_]))(?:\$\d|\$\{\d\})?/.exec(command.slice(i, i + 16))
      if (separator !== null) {
        endWord()
        i += separator[0].length - 1
        continue
      }
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
      if (c === '|' && next !== '|') isPipeNext = true
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
