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
  /**
   * The nesting level it belongs to: 0 for the command itself, a number of its
   * own for each `$(...)`, subshell, `sh -c` script or heredoc fed to a shell.
   * A `cd` moves the folder for the later parts of its own level (and of the
   * levels opened after it), not for the level that holds it.
   */
  scope: number
  /** The level that holds `scope`; undefined for level 0. */
  parentScope?: number
  /** A wrapper or runner option moves the directory or the root, so where it runs is not known. */
  movesDir: boolean
  /** What was glued to a wrapper or runner option (`-C.git`, `--dir=x`): words that may name a file. */
  optionValues: readonly string[]
  /** Set on the copy of a wrapper or runner call whose options were not all read: the inner command is not known. */
  isUnresolved?: boolean
  /** Set when the part hands a command line to another program in a form that could not be read (a key sequence, a file of commands). */
  isUnreadable?: boolean
  /** Set when the part types or pastes into another terminal (a multiplexer, a window system's input tool): it can answer a prompt or type a command as the person. */
  isTerminalInput?: boolean
  /** Set on a part made by a heredoc body read as an extra (DESIGN §16 item 49): no part of the parse before that item. */
  isExtraBody?: boolean
}

export type Split = {
  parts: ShellPart[]
  /** The command was longer than MAX_COMMAND_CHARS and was not parsed. */
  isTooLong: boolean
  /** The part or depth limit cut the parse short (the command's own text; the call is reviewed). */
  isCut: boolean
  /**
   * The readings this parser adds beside the text (the `nsenter` option read as taking a value, a spliced `env -S` string
   * read again, the strings past the splice bound, and what is nested in them) used up their own budget and were not all
   * read: the call is refused, never reviewed.
   */
  isExhausted: boolean
}

export const MAX_COMMAND_CHARS = 20_000
/** The parts a command's own text may make (nested scripts it writes included); past it the parse is cut and the call is reviewed. */
const MAX_PARTS = 200
const MAX_DEPTH = 4
/**
 * The budgets of the extra readings: what this parser reads beside the command's own text (the `nsenter -S` option read
 * as taking a value, the word after `gosu` read as the program, the second reading of a spliced `env -S` string, the
 * strings past the splice bound, `origin/main`'s reading of a part with such a string, the script it took from a
 * `busybox` part, and every script nested inside one of those). They are never shared with the text's own: the text keeps `MAX_PARTS` and `MAX_DEPTH`
 * exactly as before, and an extra neither uses them up nor is read through them. When an extra budget is used up the call
 * is refused (`isExhausted`), never reviewed: a bound that lowered a block to a review is how three earlier versions failed.
 */
const MAX_EXTRA_CHARS = 20 * MAX_COMMAND_CHARS
const MAX_EXTRA_PARTS = 400
const MAX_EXTRA_DEPTH = 4

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
 * How a wrapper or runner reads its options. A single-dash word is a cluster
 * read letter by letter, as getopt does: the first letter that takes a value
 * ends it, and the value is the rest of the word, or the next word when that
 * letter was the last. A long option may be written by any unique prefix.
 */
type Spec = {
  /** Options that take a value (the next word, or the rest of the word). */
  values: ReadonlySet<string>
  /** Options that take none. */
  flags: ReadonlySet<string>
  /** Options whose value, when there is one, is attached to them (`-d[x]`). */
  optional: ReadonlySet<string>
  /** Value options that change the directory or the root the command runs in. */
  chdir: ReadonlySet<string>
  /** Value options whose value is a script a shell runs. */
  scripts: ReadonlySet<string>
  /** The legacy `-5` form (`nice -5 cmd`). */
  hasDigits: boolean
  /** The wrapper itself changes the directory or the root (`chroot`, `nsenter`). */
  movesDir: boolean
}

type SpecInput = {
  values?: readonly string[]
  flags?: readonly string[]
  optional?: readonly string[]
  chdir?: readonly string[]
  scripts?: readonly string[]
  hasDigits?: boolean
  movesDir?: boolean
}

const specOf = (input: SpecInput): Spec => ({
  values: new Set([...(input.values ?? []), ...(input.chdir ?? []), ...(input.scripts ?? [])]),
  flags: new Set(input.flags ?? []),
  optional: new Set(input.optional ?? []),
  chdir: new Set(input.chdir ?? []),
  scripts: new Set(input.scripts ?? []),
  hasDigits: input.hasDigits === true,
  movesDir: input.movesDir === true,
})

const HELP = ['-h', '--help', '-V', '--version'] as const

/**
 * Wrapper programs and their options. A wrapper runs the command that follows
 * it, so stripping it lets the rules see that command. The privilege-changing
 * ones also mark the part privileged (ask), so a benign command run as another
 * user is still gated. An option in neither list of a wrapper is not read with
 * certainty: the part is also reviewed (`shell-runner-unresolved`; keep that
 * rule's pattern in step with these names).
 */
const WRAPPERS: ReadonlyMap<string, Spec> = new Map(Object.entries({
  sudo: specOf({
    values: ['-u', '-g', '-h', '-p', '-r', '-t', '-U', '-C', '-T', '--user', '--group', '--host', '--prompt', '--role', '--type', '--other-user', '--close-from', '--command-timeout'],
    chdir: ['-D', '--chdir', '-R', '--chroot'],
    flags: ['-A', '-b', '-B', '-E', '-e', '-H', '-i', '-K', '-k', '-l', '-N', '-n', '-P', '-S', '-s', '-V', '-v', '--askpass', '--background', '--bell', '--preserve-env', '--edit', '--set-home', '--help', '--login', '--remove-timestamp', '--reset-timestamp', '--list', '--no-update', '--non-interactive', '--preserve-groups', '--stdin', '--shell', '--version', '--validate'],
  }),
  doas: specOf({ values: ['-u', '-C'], flags: ['-L', '-n', '-s'] }),
  env: specOf({
    values: ['-u', '-S', '-a', '-P', '--unset', '--split-string', '--argv0'],
    chdir: ['-C', '--chdir'],
    flags: ['-i', '-0', '-v', '--ignore-environment', '--null', '--debug', '--list-signal-handling', '--block-signal', '--default-signal', '--ignore-signal', '--help', '--version'],
  }),
  nice: specOf({ values: ['-n', '--adjustment'], flags: ['--help', '--version'], hasDigits: true }),
  ionice: specOf({ values: ['-c', '-n', '-p', '-P', '-u', '--class', '--classdata', '--pid', '--pgid', '--uid'], flags: ['-t', '--ignore', ...HELP] }),
  nohup: specOf({ flags: ['--help', '--version'] }),
  time: specOf({ values: ['-f', '-o', '--format', '--output'], flags: ['-a', '-p', '-v', '-q', '--append', '--portability', '--verbose', '--quiet', ...HELP] }),
  command: specOf({ flags: ['-p', '-v', '-V'] }),
  builtin: specOf({}),
  exec: specOf({ values: ['-a'], flags: ['-c', '-l'] }),
  timeout: specOf({ values: ['-s', '-k', '--signal', '--kill-after'], flags: ['-v', '-f', '-p', '--verbose', '--foreground', '--preserve-status', '--help', '--version'] }),
  stdbuf: specOf({ values: ['-i', '-o', '-e', '--input', '--output', '--error'], flags: ['--help', '--version'] }),
  unbuffer: specOf({ flags: ['-p'] }),
  caffeinate: specOf({ values: ['-t', '-w'], flags: ['-d', '-i', '-m', '-s', '-u'] }),
  // Process wrappers that run their argument command.
  chroot: specOf({ values: ['--userspec', '--groups'], flags: ['--skip-chdir', '--help', '--version'], movesDir: true }),
  setsid: specOf({ flags: ['-c', '-f', '-w', '--ctty', '--fork', '--wait', ...HELP] }),
  flock: specOf({
    values: ['-w', '-E', '--timeout', '--conflict-exit-code'],
    scripts: ['-c', '--command'],
    flags: ['-s', '-x', '-u', '-n', '-o', '-F', '--shared', '--exclusive', '--unlock', '--nonblock', '--nb', '--close', '--no-fork', '--verbose', ...HELP],
  }),
  strace: specOf({
    values: ['-a', '-b', '-e', '-E', '-I', '-o', '-O', '-p', '-P', '-s', '-S', '-u', '-U', '-X'],
    flags: ['-A', '-c', '-C', '-d', '-D', '-f', '-F', '-i', '-k', '-n', '-N', '-q', '-r', '-t', '-T', '-v', '-w', '-x', '-y', '-Y', '-z', '-Z', '-h', '-V', '--follow-forks', '--summary', '--summary-only', '--stack-traces', '--seccomp-bpf', '--output-separately', '--debug', '--help', '--version'],
  }),
  ltrace: specOf({ values: ['-a', '-A', '-D', '-e', '-F', '-l', '-n', '-o', '-p', '-s', '-u', '-w'], flags: ['-b', '-c', '-C', '-f', '-h', '-i', '-L', '-r', '-S', '-t', '-T', '-V', '--help', '--version'] }),
  watch: specOf({
    values: ['-n', '-q', '--interval', '--equexit'],
    optional: ['-d', '--differences'],
    flags: ['-b', '-c', '-C', '-e', '-g', '-p', '-r', '-t', '-w', '-x', '-h', '-v', '--beep', '--color', '--no-color', '--errexit', '--chgexit', '--precise', '--no-rerun', '--no-title', '--no-wrap', '--exec', '--help', '--version'],
  }),
  // The namespace flags take no value (a path only with `=`), so they are flags.
  unshare: specOf({
    values: ['-S', '-G', '--setuid', '--setgid', '--propagation', '--setgroups', '--monotonic', '--boottime', '--map-user', '--map-users', '--map-group', '--map-groups', '--load-interp'],
    chdir: ['-R', '--root', '-w', '--wd'],
    flags: ['-m', '-u', '-i', '-n', '-p', '-C', '-U', '-T', '-f', '-r', '-c', '--mount', '--uts', '--ipc', '--net', '--pid', '--cgroup', '--user', '--time', '--fork', '--kill-child', '--map-root-user', '--map-current-user', '--map-auto', '--keep-caps', '--mount-proc', '--help', '--version', '-h', '-V'],
  }),
  // `-S` and `-G` (and `--setuid`, `--setgid`) take a glued value or one after `=`; whether a separate word is
  // also their value depends on the installed util-linux, so coreOf reads both ways (NSENTER_AMBIGUOUS). `-W` takes one.
  nsenter: specOf({
    values: ['-t', '-W', '--target', '--wdns'],
    optional: ['-S', '-G', '--setuid', '--setgid'],
    flags: ['-a', '-m', '-u', '-i', '-n', '-p', '-C', '-T', '-U', '-r', '-w', '-F', '-Z', '-e', '--all', '--mount', '--uts', '--ipc', '--net', '--pid', '--cgroup', '--time', '--user', '--root', '--wd', '--no-fork', '--follow-context', '--preserve-credentials', '--env', '-h', '-V', '--help', '--version'],
    movesDir: true,
  }),
  // chrt and taskset take one positional (priority, mask or list) before the
  // command; coreOf skips it, except in the pid forms (`-p`), which run nothing.
  // taskset keeps `-p` as a value option so a pid form is read as it always was.
  chrt: specOf({
    values: ['-T', '-P', '-D', '--sched-runtime', '--sched-period', '--sched-deadline'],
    flags: ['-a', '-b', '-d', '-e', '-f', '-i', '-m', '-o', '-p', '-r', '-R', '-v', '-h', '-V', '--all-tasks', '--batch', '--deadline', '--ext', '--fifo', '--idle', '--max', '--other', '--pid', '--rr', '--reset-on-fork', '--verbose', '--help', '--version'],
  }),
  taskset: specOf({ values: ['-p'], flags: ['-a', '-c', '-h', '-V', '--all-tasks', '--cpu-list', '--help', '--version'] }),
  numactl: specOf({
    values: ['-N', '-m', '-C', '-i', '-p', '-P', '-S', '-f', '-L', '-o', '-M', '-I', '--cpunodebind', '--membind', '--physcpubind', '--interleave', '--preferred', '--preferred-many', '--shm', '--file', '--length', '--offset'],
    flags: ['-l', '-H', '-s', '-a', '-t', '-d', '-D', '-x', '-b', '-v', '-h', '--localalloc', '--hardware', '--show', '--all', '--touch', '--dump', '--dump-nodes', '--strict', '--balancing', '--verify', '--help'],
  }),
  setarch: specOf({ flags: ['-v', '-R', '-F', '-Z', '-L', '-X', '-B', '-I', '-S', '-3', '-T', '-l', ...HELP, '--verbose', '--addr-no-randomize', '--fdpic-funcptrs', '--mmap-page-zero', '--addr-compat-layout', '--read-implies-exec', '--32bit-mmap', '--short-inode', '--sticky-timeouts', '--3gb', '--tasksize-unlimited', '--uname-2.6', '--list'] }),
  // Multi-call binaries and sandbox runners: the command that follows is what runs.
  busybox: specOf({ flags: ['--help', '--list', '--list-full'] }),
  toybox: specOf({}),
  fakeroot: specOf({ values: ['-l', '--lib', '-f', '--faked', '-i', '-s', '-b'], flags: ['-u', '--unknown-is-real', '-h', '--help', '-v', '--version'] }),
  // Its options are all `--name` or `--name=value`; these are the bare ones.
  firejail: specOf({
    flags: ['--noprofile', '--quiet', '--debug', '--trace', '--tracelog', '--private', '--private-tmp', '--private-dev', '--private-cache', '--private-lib', '--noroot', '--nonewprivs', '--seccomp', '--nosound', '--no3d', '--novideo', '--nodbus', '--nou2f', '--notv', '--nodvd', '--nogroups', '--disable-mnt', '--allusers', '--x11', '--apparmor', '--appimage', '--writable-etc', '--writable-var', '--writable-run-user', '--writable-var-log', '--machine-id', '--keep-dev-shm', '--keep-var-tmp', '--overlay', '--overlay-tmpfs', '--overlay-clean', '--help', '--version'],
  }),
  'systemd-run': specOf({
    values: ['-u', '--unit', '-p', '--property', '-E', '--setenv', '-M', '--machine', '-H', '--host', '--description', '--slice', '--uid', '--gid', '--nice', '--service-type', '--timer-property', '--on-active', '--on-boot', '--on-startup', '--on-unit-active', '--on-unit-inactive', '--on-calendar', '--on-clock-change', '--on-timezone-change', '--job-mode', '--expand-environment'],
    chdir: ['-D', '--working-directory', '--root-directory'],
    flags: ['--user', '--system', '--scope', '--no-block', '--wait', '--pty', '-t', '--pipe', '-P', '--shell', '-S', '--no-ask-password', '--collect', '-q', '--quiet', '--remain-after-exit', '-r', '--same-dir', '-d', '--send-sighup', '--ignore-failure', '--no-pager', '--no-wall', '-h', '--help', '--version', '--slice-inherit'],
  }),
  eatmydata: specOf({}),
  proxychains: specOf({ values: ['-f'], flags: ['-q'] }),
  proxychains4: specOf({ values: ['-f'], flags: ['-q'] }),
  'xvfb-run': specOf({ values: ['-e', '-f', '-n', '-p', '-s', '-w', '--error-file', '--auth-file', '--server-num', '--xauth-protocol', '--server-args', '--wait'], flags: ['-a', '-l', '-h', '--auto-servernum', '--listen-tcp', '--help'] }),
  retry: specOf({ values: ['-t', '-d', '--times', '--delay'], flags: ['-h', '-V', '--help', '--version'] }),
  // Privilege-changing wrappers (also flagged by the `privileged` check).
  gosu: specOf({ flags: ['-h', '-v', '--help', '--version'] }),
  runuser: specOf({
    values: ['-u', '-g', '-G', '-s', '-w', '--user', '--group', '--supp-group', '--shell', '--whitelist-environment'],
    scripts: ['-c', '--command', '--session-command'],
    flags: ['-m', '-p', '-l', '-f', '-P', '--preserve-environment', '--login', '--fast', '--pty', ...HELP],
  }),
  setpriv: specOf({
    values: ['--ruid', '--euid', '--rgid', '--egid', '--reuid', '--regid', '--groups', '--inh-caps', '--ambient-caps', '--bounding-set', '--securebits', '--pdeathsig', '--selinux-label', '--apparmor-profile', '--landlock-access', '--landlock-rule', '--seccomp-filter'],
    flags: ['-d', '--dump', '--nnp', '--no-new-privs', '--clear-groups', '--keep-groups', '--init-groups', '--reset-env', '--list-caps', ...HELP],
  }),
  run0: specOf({
    values: ['--uid', '--gid', '-u', '-g', '--user', '--group', '--setenv', '-E', '--unit', '--property', '--description', '--slice', '--nice', '--machine', '-M', '--background'],
    chdir: ['--chdir', '-D'],
    flags: ['--no-ask-password', '--pty', '--pipe', '--slice-inherit', '--no-pager', '--help', '--version', '-h'],
  }),
  chpst: specOf({ values: ['-u', '-U', '-b', '-e', '-n', '-l', '-L', '-m', '-d', '-o', '-p', '-f', '-c'], chdir: ['-/', '-C'], flags: ['-P', '-0', '-1', '-2', '-v', '-V'] }),
  pkexec: specOf({ values: ['--user'], flags: ['--disable-internal-agent', '--keep-cwd', '--help', '--version'] }),
}))

/** The nsenter options whose separate next word may or may not be their value, by version. */
const NSENTER_AMBIGUOUS: ReadonlySet<string> = new Set(['-S', '-G', '--setuid', '--setgid'])

/** Other names a wrapper goes by, read with the table of the one it points to. */
const WRAPPER_ALIASES: ReadonlyMap<string, string> = new Map([
  ['linux32', 'setarch'], ['linux64', 'setarch'], ['i386', 'setarch'], ['x86_64', 'setarch'], ['uname26', 'setarch'],
  ['fakeroot-sysv', 'fakeroot'], ['fakeroot-tcp', 'fakeroot'], ['fakeroot-ng', 'fakeroot'],
])

/** Every program name read as a wrapper: the one list the unresolved-option rule must cover. */
export const WRAPPER_PROGRAMS: readonly string[] = [...WRAPPERS.keys(), ...WRAPPER_ALIASES.keys()]

type Runner = Spec & {
  /** The subcommands that run the command that follows. */
  subs: ReadonlySet<string>
  /** Words before the subcommand that take this many more words (`yarn workspace NAME exec`). */
  prefixes: ReadonlyMap<string, number>
  /** Tool specs (`node@20`) come before the `--` that starts the command. */
  hasToolSpecs: boolean
}

const runnerOf = (subs: readonly string[], input: SpecInput & { prefixes?: ReadonlyMap<string, number>; hasToolSpecs?: boolean } = {}): Runner => ({
  ...specOf(input),
  subs: new Set(subs),
  prefixes: input.prefixes ?? new Map(),
  hasToolSpecs: input.hasToolSpecs === true,
})

/** Options that take no value in every runner below (a runner's own `values` win). */
const RUNNER_FLAGS = [
  '--yes', '-y', '--no', '--quiet', '-q', '--verbose', '-v', '-vv', '--silent', '--offline', '--frozen', '--locked',
  '--no-sync', '--no-project', '--isolated', '--no-cache', '--no-capture-output', '--live-stream', '--no-install',
  '--no-progress', '--dev', '--no-dev', '--no-env-file', '--active', '--refresh', '--reinstall', '--no-build',
  '--no-binary', '--debug-wrapper-scripts', '--change-ps1', '--no-change-ps1', '--include-workspace-root',
  '--workspaces', '-ws', '--no-masking', '--no-color', '--no-interaction', '-n', '--no-ansi', '--ansi',
]

/** A tool written `name@version`, as `mise exec node@20 -- cmd` takes them. */
const TOOL_SPEC = /^[^\s@-][^\s@]*@\S+$/

/**
 * Runners whose given subcommands run an arbitrary command that follows
 * (`poetry run rm ...`, `npm exec rm ...`). The prefix is stripped so the rules
 * see the command. Global options before the subcommand (`pnpm -r exec`,
 * `uv --directory x run`) are read with the same table. An option the tables do
 * not know is read as taking a value (as every option once was) and the call is
 * also reviewed. A runner that fetches and runs an arbitrary package by name
 * (`npx`, `bunx`) is a one-word runner below.
 */
const TWO_WORD_RUNNERS: ReadonlyMap<string, Runner> = new Map(Object.entries({
  npm: runnerOf(['exec', 'x'], {
    values: ['-p', '--package', '-w', '--workspace', '--registry', '--userconfig', '--globalconfig', '--cache', '--loglevel', '--tag', '--otp', '--scope', '--script-shell', '--omit', '--include'],
    chdir: ['--prefix'],
    scripts: ['-c', '--call'],
    flags: [...RUNNER_FLAGS, '-s', '-g', '--global', '-d', '-dd', '-ddd', '--json', '--color', '--force', '-f', '--prefer-offline', '--prefer-online', '--ignore-scripts', '--no-audit', '--no-fund', '--legacy-peer-deps'],
  }),
  pnpm: runnerOf(['exec', 'dlx'], {
    values: ['--filter', '-F', '--filter-prod', '--reporter', '--workspace-concurrency', '--loglevel'],
    chdir: ['-C', '--dir'],
    flags: [...RUNNER_FLAGS, '-c', '--shell-mode', '-r', '--recursive', '-w', '--workspace-root', '-s', '--stream', '--aggregate-output', '--color', '--ignore-workspace', '--fail-if-no-match', '--if-present', '--parallel', '--no-bail', '--reverse', '--sort', '--no-sort'],
    prefixes: new Map([['recursive', 0], ['multi', 0], ['m', 0]]),
  }),
  yarn: runnerOf(['exec', 'dlx'], {
    values: ['-p', '--package'],
    chdir: ['--cwd'],
    flags: [...RUNNER_FLAGS, '-s', '--json', '--non-interactive', '--frozen-lockfile', '--ignore-scripts', '--ignore-engines', '--prefer-offline', '--no-lockfile', '--pure-lockfile'],
    prefixes: new Map([['workspace', 1]]),
  }),
  poetry: runnerOf(['run'], {
    values: ['-P', '--project'],
    chdir: ['-C', '--directory'],
    flags: [...RUNNER_FLAGS, '-vvv', '-h', '--help', '-V', '--version', '--no-plugins'],
  }),
  pipenv: runnerOf(['run'], {
    values: ['--python', '--pypi-mirror'],
    flags: [...RUNNER_FLAGS, '--bare', '--clear', '--three', '--two', '--site-packages', '--support', '--rm', '--venv', '--py', '--where', '--envs', '--man', '--version', '--help', '--no-interactive'],
  }),
  pdm: runnerOf(['run'], {
    values: ['-p', '--project', '--venv'],
    flags: [...RUNNER_FLAGS, '-s', '--site-packages', '-l', '--list', '-j', '--json', '-I', '--ignore-python', '-h', '--help', '-V', '--version'],
  }),
  rye: runnerOf(['run'], { values: ['--env-file'], flags: [...RUNNER_FLAGS, '-l', '--list', '-h', '--help', '--version'] }),
  hatch: runnerOf(['run'], {
    values: ['-e', '--env', '-i', '--include', '-x', '--exclude', '--data-dir', '--cache-dir', '--config'],
    flags: [...RUNNER_FLAGS, '--interactive', '--no-interactive', '--version', '--help'],
  }),
  uv: runnerOf(['run'], {
    values: [
      '-p', '--python', '--with', '--with-editable', '--with-requirements', '--extra', '--group', '--no-group', '--only-group',
      '--package', '--project', '--env-file', '--index', '--default-index', '--index-url', '-i', '--extra-index-url',
      '-f', '--find-links', '--config-file', '--cache-dir', '--python-preference', '--resolution', '--prerelease', '--link-mode',
      '--exclude-newer', '--index-strategy', '--keyring-provider', '--color', '-P', '--upgrade-package', '--refresh-package',
      '--reinstall-package', '-C', '--config-setting', '--no-binary-package', '--no-build-package', '--python-platform',
    ],
    chdir: ['--directory'],
    flags: [
      ...RUNNER_FLAGS, '-m', '--module', '-s', '--script', '--all-extras', '--all-groups', '--all-packages', '--only-dev', '--no-editable',
      '--native-tls', '--no-config', '--managed-python', '--no-managed-python', '--no-python-downloads', '--preview', '-U', '--upgrade',
      '--exact', '--no-default-groups', '-h', '--help', '-V', '--version',
    ],
  }),
  bundle: runnerOf(['exec'], { values: ['--gemfile'], flags: [...RUNNER_FLAGS, '--keep-file-descriptors', '-V', '--version', '-h', '--help'] }),
  composer: runnerOf(['exec'], {
    chdir: ['-d', '--working-dir'],
    flags: [...RUNNER_FLAGS, '-vvv', '-V', '--version', '--profile', '--no-plugins', '--no-scripts', '--no-audit', '-h', '--help', '-l', '--list'],
  }),
  conda: runnerOf(['run'], {
    values: ['-n', '--name', '-p', '--prefix'],
    chdir: ['--cwd'],
    flags: [...RUNNER_FLAGS, '-vvv', '--json', '-h', '--help', '-V', '--version'],
  }),
  mamba: runnerOf(['run'], {
    values: ['-n', '--name', '-p', '--prefix'],
    chdir: ['--cwd'],
    flags: [...RUNNER_FLAGS, '-vvv', '--json', '-h', '--help', '-V', '--version'],
  }),
  micromamba: runnerOf(['run'], {
    values: ['-n', '--name', '-p', '--prefix', '-r', '--root-prefix', '-a', '--attach', '--log-level', '--rc-file'],
    chdir: ['--cwd'],
    flags: [...RUNNER_FLAGS, '-vvv', '--clean-env', '--no-rc', '--json', '-h', '--help', '-V', '--version'],
  }),
  op: runnerOf(['run'], {
    values: ['--env-file', '--account', '--config', '--session', '--format', '--encoding', '--environment', '--language'],
    flags: [...RUNNER_FLAGS, '--cache', '--iso-timestamps', '--debug', '-h', '--help', '-v', '--version'],
  }),
  doppler: runnerOf(['run'], {
    values: [
      '-p', '--project', '-c', '--config', '-t', '--token', '--mount', '--mount-format', '--mount-max-reads', '--mount-template',
      '--name-transformer', '--fallback', '--only-secrets', '--preserve-env', '--api-host', '--scope', '--config-dir',
    ],
    scripts: ['--command'],
    flags: [...RUNNER_FLAGS, '--json', '--debug', '--no-check-version', '--no-read-env', '--forward-signals', '--watch', '--no-exit-on-write-failure', '--no-timeout', '--print-config', '--dump-config', '-h', '--help', '--version'],
  }),
  mise: runnerOf(['exec', 'x'], {
    values: ['-E', '--env', '-j', '--jobs'],
    chdir: ['-C', '--cd'],
    scripts: ['-c', '--command'],
    flags: [...RUNNER_FLAGS, '-vvv', '--raw', '--no-config', '--no-env', '--debug', '--trace', '-h', '--help', '-V', '--version'],
    hasToolSpecs: true,
  }),
}))

/**
 * One-word runners that fetch and run a command; stripped like a wrapper, with
 * the options of each (an unknown one is not read with certainty).
 */
const ONE_WORD_RUNNERS: ReadonlyMap<string, Spec> = new Map(Object.entries({
  npx: specOf({
    values: ['-p', '--package', '-w', '--workspace', '--registry', '--cache', '--userconfig', '--shell', '--node-arg', '--loglevel', '--scope'],
    chdir: ['--prefix'],
    scripts: ['-c', '--call'],
    flags: [...RUNNER_FLAGS, '--ignore-existing', '--prefer-offline', '--prefer-online', '--json', '-h', '--help', '--version'],
  }),
  bunx: specOf({ values: ['-p', '--package'], flags: [...RUNNER_FLAGS, '--bun', '-b', '--help', '--version'] }),
  pnpx: specOf({ values: ['-p', '--package'], scripts: ['-c', '--call'], flags: [...RUNNER_FLAGS, '--shell-mode', '--help', '--version'] }),
  uvx: specOf({
    values: [
      '--from', '--with', '--with-editable', '--with-requirements', '-p', '--python', '--env-file', '--index', '--default-index', '--index-url', '-i',
      '--extra-index-url', '-f', '--find-links', '--config-file', '--cache-dir', '--python-preference', '--resolution', '--prerelease', '--link-mode',
      '--exclude-newer', '--index-strategy', '--keyring-provider', '--color', '--python-platform',
    ],
    chdir: ['--directory'],
    flags: [...RUNNER_FLAGS, '--native-tls', '--no-config', '--managed-python', '--no-managed-python', '--no-python-downloads', '--preview', '-h', '--help', '-V', '--version'],
  }),
}))

const setOf = (...list: string[]): ReadonlySet<string> => new Set(list)

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
  /** The last nesting level handed out. */
  lastScope: number
  /** The parts the command's own text made: bound by `MAX_PARTS`, as on `origin/main`, and by nothing else. */
  ownParts: number
  /** The extra readings (see `MAX_EXTRA_CHARS`): the characters scanned, the parts made, and whether one budget ran out. */
  extraScanned: number
  /** The most characters the extras may scan: `MAX_EXTRA_CHARS`, less when a test asks. */
  maxExtraChars: number
  extraParts: number
  isExhausted: boolean
  /** The parts made of heredoc bodies read as extras (§16 item 49): never taken for parts of the text that feed a heredoc to a shell. */
  bodyParts?: Set<ShellPart>
}

type Core = {
  wrappers: string[]
  coreWords: string[]
  /** Scripts the part's own text holds (the value of a wrapper or runner's `-c` option, a shell string): read as the text's own. */
  nestedScripts: string[]
  /**
   * The readings this parser adds: each `env -S` string alone, the shell scanner's second reading of each spliced one,
   * both readings (env's and the shell's) of the strings past the splice bound, `origin/main`'s reading of the part
   * (§16 item 47) and the script it took from a `busybox` part (§16 item 48). Read as extras, with budgets of their own.
   */
  extraScripts: string[]
  /** An `nsenter` option whose separate next word may or may not be its value was met: the part is also read as if every one takes it. */
  isAmbiguous: boolean
  /** A `gosu` with a word after its options was met: the part is also read with that word as the program (§16 item 48). */
  hasGosuWord: boolean
  /** This reading met an `env -S` string, so `origin/main`'s reading of the part was made (or was the part's own words). */
  hasMainReading: boolean
  /**
   * The words from a wrapper or runner whose options could not be read for
   * sure (one the tables do not know): they are classified again as they stand,
   * so a rule can send the call to review.
   */
  unresolved?: string[]
  /** A wrapper or runner option changes the directory or the root: where the command runs is not known. */
  movesDir: boolean
  /** The values glued to a wrapper or runner option (`-C.git`, `--dir=x`): words that may name a file. */
  optionValues: string[]
}

/** `setarch` architecture names (the first positional); a command is never read as one. */
const ARCH = /^(linux(32|64)|uname26|i[3-6]86|x86|x86_64|ia64|alpha|arm|armv\d\w*|aarch64(_be)?|mips(64)?(el)?|ppc(64)?(le)?|powerpc(64)?|s390x?|sparc(32bash|64)?|sparc32|parisc(64)?|hppa(64)?|riscv(32|64)|loongarch64|sh[234]|m68k)$/

/** Wrappers with a pid form (`chrt -p 10 123`, `taskset -p 123`) that runs no command. */
const PID_WRAPPERS: ReadonlySet<string> = new Set(['chrt', 'taskset'])
const PID_OPTION = /^-[A-Za-z]*p[A-Za-z]*$|^--pid$/

/** A word as a shell would read it back: quoted unless it is plainly safe. */
const quoted = (word: string): string => (/^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`)

type Option = {
  /** The index of the first word after this option and its value. */
  next: number
  /** The option as the table names it, when it is known. */
  name?: string
  /** What it was given, glued to it or from the next word. */
  value?: string
  /** What was glued to the option (`-n5`, `--user=x`); for an unknown cluster, both ways of reading it. */
  attached?: string[]
  /** The tables do not know it. */
  isUnknown: boolean
}

/** Whether an option word of pnpm is `-c` or `--shell-mode`, alone, by a unique prefix, or in a cluster of its flag letters. */
function isShellModeOption(spec: Spec, word: string, name: string | undefined): boolean {
  if (name === '-c' || name === '--shell-mode') return true
  if (word.startsWith('--') || !word.startsWith('-')) return false
  const letters = [...spec.flags].filter(flag => /^-[A-Za-z]$/.test(flag)).map(flag => flag[1] as string)
  return [...word.slice(1)].every(letter => letters.includes(letter)) && word.includes('c')
}

/** The long option a written name stands for: the exact name, else the one it is a unique prefix of. */
function longOption(spec: Spec, typed: string): string | undefined {
  const all = [...spec.values, ...spec.flags, ...spec.optional].filter(name => name.startsWith('--'))
  if (all.includes(typed)) return typed
  const matches = all.filter(name => name.startsWith(typed))
  return matches.length === 1 ? matches[0] : undefined
}

/**
 * Reads the option at `words[k]` as getopt would: a long option by its name
 * (or a unique prefix of it), a single-dash word letter by letter. The first
 * letter that takes a value ends the cluster; its value is the rest of the
 * word, or the next word when it was the last letter. An option the tables do
 * not know is `isUnknown` and read as taking the next word when `takesUnknown`.
 */
function readOption(spec: Spec, words: readonly string[], k: number, takesUnknown: boolean): Option {
  const option = words[k] as string
  // A whole word the table lists, such as `-vv` or `-ws`.
  if (spec.values.has(option)) return { next: k + 2, name: option, ...(words[k + 1] !== undefined && { value: words[k + 1] }), isUnknown: false }
  if (spec.flags.has(option) || spec.optional.has(option)) return { next: k + 1, name: option, isUnknown: false }
  if (option.startsWith('--')) {
    const eq = option.indexOf('=')
    const name = longOption(spec, eq < 0 ? option : option.slice(0, eq))
    const glued = eq < 0 ? undefined : option.slice(eq + 1)
    if (name === undefined) {
      return { next: k + (glued === undefined && takesUnknown ? 2 : 1), ...(glued !== undefined && { value: glued, attached: [glued] }), isUnknown: true }
    }
    if (glued !== undefined) return { next: k + 1, name, value: glued, attached: [glued], isUnknown: false }
    if (spec.values.has(name)) return { next: k + 2, name, ...(words[k + 1] !== undefined && { value: words[k + 1] }), isUnknown: false }
    return { next: k + 1, name, isUnknown: false }
  }
  if (spec.hasDigits && /^-\d+$/.test(option)) return { next: k + 1, name: option, isUnknown: false }
  for (let c = 1; c < option.length; c++) {
    const letter = `-${option[c]}`
    const rest = option.slice(c + 1)
    if (spec.values.has(letter)) {
      return rest !== ''
        ? { next: k + 1, name: letter, value: rest, attached: [rest], isUnknown: false }
        : { next: k + 2, name: letter, ...(words[k + 1] !== undefined && { value: words[k + 1] }), isUnknown: false }
    }
    if (spec.optional.has(letter)) return { next: k + 1, name: letter, ...(rest !== '' && { value: rest, attached: [rest] }), isUnknown: false }
    if (spec.flags.has(letter)) continue
    return { next: k + (rest === '' && takesUnknown ? 2 : 1), attached: [option.slice(c), rest].filter(word => word !== ''), isUnknown: true }
  }
  return { next: k + 1, isUnknown: false }
}

/**
 * A word of env's own that sets a variable: any word with a `=` in it that is not an option (checked with harmless `printf`
 * calls on env 9.4: `=1`, `a-b=c`, `1a=b` and `a.b=c` all set one). A shell's assignment word needs a name; env's does not.
 */
const isEnvAssignment = (word: string): boolean => !word.startsWith('-') && word.includes('=')

/**
 * Where env's own words end after a `--`: env 9.4 reads a lone `-` there as its `-i`, then every word with a `=` in it as an
 * assignment. `isNew` says a word was skipped that the earlier versions read as the program (the `-`, a word that is no
 * shell assignment): that reading is made too, as an extra (§16 item 47), so that no tier is lower than it was.
 */
function envOwnWordsEnd(words: readonly string[], from: number): { end: number; isNew: boolean } {
  let k = from
  let isNew = false
  if (words[k] === '-') {
    k++
    isNew = true
  }
  while (k < words.length && (words[k] as string).includes('=')) {
    if (!isAssignment(words[k] as string)) isNew = true
    k++
  }
  return { end: k, isNew }
}

/** `env -S` splits on these six blanks (the C locale's `isspace`), not on every character a regular expression's `\s` holds. */
const ENV_BLANKS = ' \t\n\v\f\r'
const ENV_VARIABLE = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}/
const ENV_LITERAL_ESCAPES = '#$"\'\\'
const ENV_CONTROL_ESCAPES: Readonly<Record<string, string>> = { f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' }

/**
 * The words GNU `env -S` makes of its string, as `env` 9.4 does (checked with harmless `printf` calls):
 * - outside quotes: blanks separate; `\_` is a separator; `\c` ends the string; `\f \n \r \t \v` are those characters
 *   (not separators); `\# \$ \" \' \\` are the character; a `#` that starts a word begins a comment to the end;
 *   `${NAME}` is expanded from the environment (kept as written here: its value is not known) and a bare `$` is an error;
 * - inside single quotes: only `\\` and `\'` are escapes, every other backslash is a backslash, `$` is plain;
 * - inside double quotes: as outside, but `\_` is a blank character, `\c` is an error, and a `#` is plain;
 * - any other backslash sequence, a backslash at the end, an unterminated quote and a bare `$` are errors: `env` runs
 *   nothing. `isSure` is then false; the words are still read on (leniently: an unknown escape is its character, a bare
 *   `$` is itself, an unterminated quote runs to the end), so that the part is reviewed with the most the string could say.
 *
 * An expansion's value is not known to the classifier, and an unset name expands to nothing: its word vanishes (or keeps
 * the text glued to it), so an option before it takes the next word, and a `#` straight after it starts a comment. So
 * `hasExpansion` says the string holds one (outside single quotes), and with `isVanishing` every expansion is replaced by
 * nothing: the other end of what the string can mean, read beside the words with the expansions kept.
 */
function envSplit(text: string, isVanishing = false): { words: string[]; isSure: boolean; hasExpansion: boolean } {
  const words: string[] = []
  let word = ''
  let hasWord = false
  let quote = ''
  let isSure = true
  let hasExpansion = false
  const end = () => {
    if (hasWord) words.push(word)
    word = ''
    hasWord = false
  }
  let skip = 0
  const variable = (at: number): void => {
    const found = ENV_VARIABLE.exec(text.slice(at, at + 80))
    if (found === null) {
      isSure = false
      word += '$'
    } else {
      hasExpansion = true
      if (!isVanishing) word += found[0]
    }
    skip = found === null ? 0 : found[0].length - 1
    // Kept as a word, an expansion starts one; replaced by nothing it starts none (a quote has already started it).
    if (found === null || !isVanishing) hasWord = true
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string
    if (c === '\\') {
      const e = text[++i]
      if (quote === "'") {
        // Only `\\` and `\'` are escapes in single quotes; any other backslash is literal and what follows it is read again.
        if (e === '\\' || e === "'") word += e
        else {
          word += '\\'
          i--
        }
        hasWord = true
        continue
      }
      if (e === undefined) {
        isSure = false
        word += '\\'
        hasWord = true
        continue
      }
      if (e === 'c') {
        if (quote === '"') {
          isSure = false
          word += 'c'
          hasWord = true
          continue
        }
        end()
        return { words, isSure, hasExpansion }
      }
      if (e === '_') {
        if (quote === '"') {
          word += ' '
          hasWord = true
        } else end()
      } else if (Object.hasOwn(ENV_CONTROL_ESCAPES, e)) {
        word += ENV_CONTROL_ESCAPES[e]
        hasWord = true
      } else {
        if (!ENV_LITERAL_ESCAPES.includes(e)) isSure = false
        word += e
        hasWord = true
      }
      continue
    }
    if (quote !== '') {
      if (c === quote) quote = ''
      else if (c === '$' && quote === '"') {
        variable(i)
        i += skip
      } else word += c
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      hasWord = true
    } else if (ENV_BLANKS.includes(c)) {
      end()
    } else if (c === '#' && !hasWord) {
      break
    } else if (c === '$') {
      variable(i)
      i += skip
    } else {
      word += c
      hasWord = true
    }
  }
  if (quote !== '') isSure = false
  end()
  return { words, isSure, hasExpansion }
}

/**
 * The reading of the first versions of this parser (it handled a backslash before it looked at the quote state, and split on
 * every blank a regular expression's `\s` holds, `\f \n \r \t \v` included): not what `env` does, but it exposes more of what
 * follows in the strings where the two differ, so it is read as a further extra beside `envSplit`, and only then. Its result
 * is never the only reading of a string.
 */
function envLooseWords(text: string): string[] {
  const out: string[] = []
  let word = ''
  let hasWord = false
  let quote = ''
  const end = () => {
    if (hasWord) out.push(word)
    word = ''
    hasWord = false
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string
    if (c === '\\') {
      const e = text[++i]
      if (e === undefined || e === 'c') break
      if (quote === '' && (e === '_' || 'fnrtv'.includes(e))) end()
      else {
        word += e === '_' || 'fnrtv'.includes(e) ? ' ' : e
        hasWord = true
      }
      continue
    }
    if (quote !== '') {
      if (c === quote) quote = ''
      else word += c
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      hasWord = true
    } else if (/\s/.test(c)) {
      end()
    } else if (c === '#' && !hasWord) {
      break
    } else {
      word += c
      hasWord = true
    }
  }
  end()
  return out
}

/**
 * The wrappers and the options of each that take a value, as `origin/main` read them (before the tables above were
 * corrected). Only `mainEnvWalk` uses it: it finds the `env -S` strings that `origin/main`'s walk found, however its
 * options were misread, because a string env's own splitting leaves unread must still be read as it was. The last
 * row, `busybox`, is not `origin/main`'s: its walk stopped there (§16 item 48).
 */
const MAIN_WRAPPERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
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
  ['chroot', new Set(['--userspec', '--groups'])],
  ['setsid', new Set()],
  ['flock', new Set(['-w', '--timeout', '-E', '--conflict-exit-code'])],
  ['strace', new Set(['-o', '-p', '-e', '-s', '-S', '-u'])],
  ['ltrace', new Set(['-o', '-p', '-e', '-s'])],
  ['watch', new Set(['-n', '--interval', '-d', '--differences'])],
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
  ['gosu', new Set()],
  ['runuser', new Set(['-u', '-g', '-G', '-c', '--user', '--group'])],
  ['setpriv', new Set(['--reuid', '--regid', '--groups', '--inh-caps', '--ambient-caps', '--bounding-set'])],
  ['run0', new Set(['--uid', '--gid', '-u', '-g', '--setenv', '--chdir', '-D'])],
  ['chpst', new Set(['-u', '-U', '-e', '-/', '-n', '-l', '-L'])],
  ['pkexec', new Set(['--user'])],
  // Not a wrapper on `origin/main` (its walk stopped there and read the part as a shell's): the walk goes on behind it, as
  // behind the others, so an `env -S` string after it is found and the command after the string is read (§16 item 48).
  ['busybox', new Set()],
])

/**
 * The script `origin/main` took from a part whose program was `busybox`, which it read as a shell: the word after the
 * first `-c`, `--command` or cluster of letters holding a `c` among the words from `from` on (after a `--`, the word
 * after that). Read as an added script beside the applet (§16 item 48). One pass, no backtracking.
 */
function mainShellScriptOf(words: readonly string[], from: number): string | undefined {
  for (let i = from; i < words.length; i++) {
    const word = words[i] as string
    if (word === '--command' || (word.startsWith('-') && word.includes('c') && /^-[a-zA-Z]+$/.test(word))) {
      return words[i + 1] === '--' ? words[i + 2] : words[i + 1]
    }
  }
  return undefined
}

/**
 * Which reading of a part `coreOf` makes. The first is the part as the tables read it. The added ones are whole readings
 * of the same words, each one more part charged to the extras' budgets: `takesAmbiguous`, where every ambiguous `nsenter`
 * option takes its next word (§16 items 40, 42), and `isGosuProgram`, where the word after `gosu` is the program, as
 * `origin/main` read it, and not the user (§16 item 48). `hasMainReading` says an earlier reading of the part already made
 * `origin/main`'s reading of it, which is the same for all of them.
 */
type Reading = { takesAmbiguous: boolean; isGosuProgram: boolean; hasMainReading: boolean }
const FIRST_READING: Reading = { takesAmbiguous: false, isGosuProgram: false, hasMainReading: false }
const MAIN_TWO_WORD_RUNNERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['npm', new Set(['exec', 'x'])], ['pnpm', new Set(['exec', 'dlx'])], ['yarn', new Set(['exec', 'dlx'])], ['poetry', new Set(['run'])],
  ['pipenv', new Set(['run'])], ['pdm', new Set(['run'])], ['rye', new Set(['run'])], ['hatch', new Set(['run'])], ['uv', new Set(['run'])],
  ['bundle', new Set(['exec'])], ['composer', new Set(['exec'])], ['conda', new Set(['run'])], ['mamba', new Set(['run'])], ['micromamba', new Set(['run'])],
])
const MAIN_ONE_WORD_RUNNERS: ReadonlySet<string> = new Set(['npx', 'bunx', 'pnpx', 'uvx'])

/** Where the command of a `case SUBJECT in PATTERN)` arm starts (0 when the words are no arm). */
function caseArmEnd(words: readonly string[]): number {
  if (words[0] !== 'case') return 0
  let k = 1
  while (k < words.length && words[k] !== 'in') k++
  if (words[k] === 'in') k++
  while (k < words.length && !(words[k] as string).includes(')')) k++
  if (k < words.length) k++
  return k
}

/**
 * Where the command starts after the assignments, plain keywords and function-definition headers that may stand before
 * it (a definition body or a keyword must not hide the command they wrap). `function NAME` goes with the name.
 */
function triviaEnd(words: readonly string[], from: number): number {
  let k = from
  for (;;) {
    while (k < words.length && (isAssignment(words[k] as string) || KEYWORDS.has(words[k] as string))) k++
    const word = words[k]
    if (word === undefined) return k
    if (word === 'function') {
      k++
      if (k < words.length && !KEYWORDS.has(words[k] as string)) k++ // the name
      continue
    }
    if (FUNCTION_HEADER.test(word)) {
      k++
      continue
    }
    return k
  }
}

/**
 * `origin/main`'s walk over a part's words, as it made it: assignments, keywords and function headers skipped, its
 * wrappers (each with the options in the table above that take a value) and runners stripped in turn, an `env` taking
 * `-S` and `--split-string` strings anywhere among its options (and `-`, `-i`, assignments and `--ignore-environment`
 * as its own words), the first word that is no option ending them. It gives the `env -S` and `--split-string` strings it
 * found, each time one stands, and, when it found any, the words it left as the command (`rest`). Each string is read
 * alone as an extra and the rest as one more (§16 item 47), so that what that reading found stays found whatever env's
 * own splitting does with a string before it (`env -S x watch env -S 'rm -rf /'`: for env `x` is the program; for main
 * the walk went on; `env -S 'x y' rm -rf /`: for env the string holds the program, for main `rm` was the command).
 * One pass over the words.
 */
function mainEnvWalk(words: readonly string[]): { strings: string[]; rest: string[]; privileged: string[]; scripts: string[] } {
  const found: string[] = []
  const privileged: string[] = []
  const scripts: string[] = []
  let hasMetBusybox = false
  let k = caseArmEnd(words)
  for (;;) {
    k = triviaEnd(words, k)
    const word = words[k]
    if (word === undefined) break
    const name = word.includes('/') && SYSTEM_BIN.test(word) ? word.slice(word.lastIndexOf('/') + 1) : word
    const subs = MAIN_TWO_WORD_RUNNERS.get(name)
    if (subs !== undefined && subs.has(words[k + 1] ?? '')) {
      k += 2
      while (k < words.length) {
        const option = words[k] as string
        if (option === '--') {
          k++
          break
        }
        if (!option.startsWith('-')) break
        k += option.includes('=') ? 1 : 2
      }
      continue
    }
    if (MAIN_ONE_WORD_RUNNERS.has(name)) {
      k++
      while (k < words.length) {
        const option = words[k] as string
        if (option === '--') {
          k++
          break
        }
        if (option === '-c' || option === '--call') {
          scripts.push(words[k + 1] ?? '')
          k += 2
          continue
        }
        if (!option.startsWith('-')) break
        k += option === '-p' || option === '--package' ? 2 : 1
      }
      continue
    }
    const takesValue = MAIN_WRAPPERS.get(name)
    if (takesValue === undefined) break
    if (PRIVILEGE_WRAPPERS.has(name)) privileged.push(name)
    k++
    // Main's walk stopped at its first `busybox`: its command was the words from there on (read again with the tables
    // of this parser), and it took a script from them as a shell's. Both stay read when the walk goes on: the words as a
    // script of their own, behind the privilege wrappers passed (not when they are the part's own words again: that
    // reading would be this one), and the script.
    if (name === 'busybox' && !hasMetBusybox) {
      hasMetBusybox = true
      const fromBusybox = [...privileged, ...words.slice(k - 1)]
      if (fromBusybox.length !== words.length || fromBusybox.some((word, index) => word !== words[index])) scripts.push(fromBusybox.map(quoted).join(' '))
      const script = mainShellScriptOf(words, k)
      if (script !== undefined) scripts.push(script)
    }
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
      if (name === 'env' && (option === '-S' || option === '--split-string' || option.startsWith('--split-string='))) {
        found.push(option.includes('=') ? option.slice(option.indexOf('=') + 1) : (words[k + 1] ?? ''))
        k += option.includes('=') ? 1 : 2
        continue
      }
      if (!option.startsWith('-') || option === '-') break
      k += takesValue.has(option) ? 2 : 1
    }
    if (name === 'timeout' && k < words.length) k++
    if ((name === 'chroot' || name === 'flock') && k < words.length && !(words[k] as string).startsWith('-')) k++
  }
  return { strings: found, rest: words.slice(k), privileged, scripts }
}

const MAX_BRACE_ELEMENTS = 16

/** At most this many `env -S` strings in one command are spliced into env's own words; more is not read for sure (review). */
const MAX_ENV_SPLICES = 8

/**
 * A word that is one brace list of plain elements (`{rm,-rf,/x}`, `r{m,m}`):
 * the words the shell makes of it, or undefined when it is not that (nested,
 * with a variable, a glob or a quote in it, an empty element, or too long).
 */
function braceWords(word: string): string[] | undefined {
  const match = /^([^{}$`*?[\]]*)\{([^{}$`*?[\]\s]+)\}([^{}$`*?[\]]*)$/.exec(word)
  if (match === null) return undefined
  const elements = (match[2] as string).split(',')
  if (elements.length < 2 || elements.length > MAX_BRACE_ELEMENTS || elements.some(element => element === '')) return undefined
  return elements.map(element => `${match[1]}${element}${match[3]}`)
}

/**
 * Strips assignments, keywords, wrappers and git's global options. With `reading.takesAmbiguous` an `nsenter` option whose
 * separate next word may or may not be its value takes it (the other of the two readings; `Core.isAmbiguous` says there
 * is one); with `reading.isGosuProgram` the word after `gosu` is the program (`Core.hasGosuWord` says there is one).
 */
function coreOf(input: readonly string[], reading: Reading = FIRST_READING): Core {
  const isReadingA = reading.takesAmbiguous
  const isAdded = reading.takesAmbiguous || reading.isGosuProgram
  let hasGosuWord = false
  // 0.5.0's script of the first `busybox` of the part (see `mainShellScriptOf`).
  let hasMetBusybox = false
  let busyboxScript: string | undefined
  let words = input
  let k = 0
  const wrappers: string[] = []
  const nestedScripts: string[] = []
  const extraScripts: string[] = []
  const optionValues: string[] = []
  let unresolved: string[] | undefined
  let movesDir = false
  let isAmbiguous = false
  let envSplices = 0
  // Each `env -S` string read alone, as a script, as `origin/main` read it: an extra. Each time it stands (a crafted command
  // that repeats one makes main's parts run out, and so ours: the same count, in the extras' budget). The strings main's own
  // walk over the words found (`mainEnvWalk`) are read first, whatever env's splitting leaves of them; the loop below
  // reads the others (an attached `-Sx` is a string for env and was a flag for main) and not again those already read.
  // An added reading (`Reading`) has the same words, so main's walk finds the same strings and the first reading has read
  // them; its own walk can differ (it can reach an `env` the first did not), so it reads the others it meets (§16 item 48).
  const aloneToRead = new Map<string, number>()
  // `origin/main`'s whole reading of the part (§16 item 47): the strings were an option's values, the words after them went
  // on as env's own (options, assignments) and the first that is none was the command. Whatever env's own splitting makes of
  // a string, that command is read too (one extra, made once the walk below has seen whether any `env -S` string stands in
  // the part), so no part with an `env -S` string is read below what `origin/main` read. The wrappers that mark a part
  // privileged stay in front of it (the rules ask about them), the others are not needed to read the command.
  let mainReading: string[] = []
  let mainScripts: string[] = []
  let hasMainEnvString = false
  const readAlone = (text: string) => {
    if (text === '') return
    const left = aloneToRead.get(text) ?? 0
    if (left > 0) aloneToRead.set(text, left - 1)
    else extraScripts.push(text)
  }
  {
    const main = mainEnvWalk(input)
    for (const alone of main.strings) {
      if (alone === '') continue
      aloneToRead.set(alone, (aloneToRead.get(alone) ?? 0) + 1)
      if (!isAdded) extraScripts.push(alone)
    }
    mainReading = [...main.privileged, ...main.rest]
    mainScripts = main.scripts
    hasMainEnvString = main.strings.length > 0
  }
  // The `env -S` strings past the bound, each as env reads it and as a shell reads it, with the words between them, and where the words not yet added start.
  let pastEnv: string[] | undefined
  let pastShell: string[] | undefined
  let pastLoose: string[] | undefined
  let hasPastLoose = false
  // The same strings with every `${NAME}` replaced by nothing, and whether one past the bound holds an expansion.
  let pastVanished: string[] | undefined
  let hasPastExpansion = false
  let pastBoundFrom = 0
  // The word the earlier versions read as env's program and env reads as its own (a `-` after `--`, a word with a `=` that is no
  // shell assignment: `=1`, `a-b=c`, `${X}=v`) is also read as the program, as an extra, once for the part (the earlier walk
  // stopped at the first): a text in such a word that a rule matches (`env 'dd if=/dev/zero of=/dev/sda' ""`) still reviews.
  let hasReadAsProgram = false
  const readAsProgram = (at: number) => {
    if (hasReadAsProgram) return
    hasReadAsProgram = true
    extraScripts.push(words.slice(at).map(quoted).join(' '))
  }
  // A call whose options were not all read: its words as they stand are classified
  // again, and where it runs is not known either.
  // The words are made only the first time: a crafted run of unknown options must not copy the rest for each.
  const markUnresolved = (rest: () => string[]) => {
    unresolved ??= rest()
    movesDir = true
  }
  // Skip leading assignments, plain keywords, function-definition headers and
  // a `case SUBJECT in PATTERN)` arm, so the command they wrap is what the
  // rules see. Without this a definition body or a case arm hides its command.
  const skipTrivia = () => {
    k = triviaEnd(words, k)
  }
  // A `case` arm: the subject, `in`, and the pattern up to its `)`.
  k = caseArmEnd(words)
  for (;;) {
    skipTrivia()
    const word = words[k]
    if (word === undefined) break
    // A brace list in the program position is words the shell makes before it
    // runs anything: `{rm,-rf,/x}` is `rm -rf /x`.
    const braced = braceWords(word)
    if (braced !== undefined) {
      words = [...words.slice(0, k), ...braced, ...words.slice(k + 1)]
      continue
    }
    const name = word.includes('/') && SYSTEM_BIN.test(word) ? word.slice(word.lastIndexOf('/') + 1) : word
    const start = k

    // A two-word runner: `poetry run <cmd>`, `npm exec <cmd>`, with the global
    // options (and `yarn workspace NAME`) that may come before the subcommand.
    const runner = TWO_WORD_RUNNERS.get(name)
    if (runner !== undefined) {
      let j = k + 1
      let isGlobalUnknown = false
      let isMoved = false
      // pnpm's `-c` / `--shell-mode`: the words after the options are one shell command line.
      let isShellMode = false
      const globalValues: string[] = []
      while (j < words.length && !runner.subs.has(words[j] as string)) {
        const global = words[j] as string
        const prefix = runner.prefixes.get(global)
        if (prefix !== undefined) {
          j += 1 + prefix
          continue
        }
        if (!global.startsWith('-') || global === '-' || global === '--') break
        const read = readOption(runner, words, j, true)
        if (read.isUnknown) isGlobalUnknown = true
        if (name === 'pnpm' && isShellModeOption(runner, global, read.name)) isShellMode = true
        if (read.name !== undefined && runner.chdir.has(read.name)) isMoved = true
        if (read.attached !== undefined) globalValues.push(...read.attached)
        // An option not known, followed by the subcommand: it took no value (the way that finds the command).
        j = read.isUnknown && read.next === j + 2 && runner.subs.has(words[j + 1] as string) ? j + 1 : read.next
      }
      if (j < words.length && runner.subs.has(words[j] as string)) {
        const sub = words[j] as string
        wrappers.push(`${name} ${sub}`)
        k = j + 1
        optionValues.push(...globalValues)
        if (isMoved) movesDir = true
        let hasSeparator = false
        let hasSpec = false
        let isUnknown = isGlobalUnknown
        // Skip this runner's own options and their values until the command.
        while (k < words.length) {
          const option = words[k] as string
          if (option === '--') {
            k++
            hasSeparator = true
            break
          }
          if (runner.hasToolSpecs && TOOL_SPEC.test(option)) {
            hasSpec = true
            k++
            continue
          }
          if (!option.startsWith('-') || option === '-') break
          const read = readOption(runner, words, k, true)
          if (read.isUnknown) isUnknown = true
          if (name === 'pnpm' && isShellModeOption(runner, option, read.name)) isShellMode = true
          if (read.attached !== undefined) optionValues.push(...read.attached)
          if (read.name !== undefined) {
            if (runner.chdir.has(read.name)) movesDir = true
            if (runner.scripts.has(read.name)) nestedScripts.push(read.value ?? '')
          }
          k = read.next
        }
        // What follows is one shell string: it is read as a script, once, and not stripped of wrappers again (a chain of them would copy the rest each time).
        const isString = isShellMode && k < words.length
        if (isString) nestedScripts.push(words.slice(k).join(' '))
        if (isUnknown || (hasSpec && !hasSeparator)) markUnresolved(() => [name, sub, ...words.slice(j + 1)])
        if (isString) break
        continue
      }
    }

    // A one-word fetch-and-run runner: `npx <pkg>`, `bunx <pkg>`, `uvx <pkg>`.
    const fetcher = ONE_WORD_RUNNERS.get(name)
    if (fetcher !== undefined) {
      wrappers.push(name)
      k++
      let isUnknown = false
      while (k < words.length) {
        const option = words[k] as string
        if (option === '--') {
          k++
          break
        }
        if (!option.startsWith('-') || option === '-') break
        // An option it does not know is read as a flag (as it always was): the word after it stays the command.
        const read = readOption(fetcher, words, k, false)
        if (read.isUnknown) isUnknown = true
        if (read.attached !== undefined) optionValues.push(...read.attached)
        if (read.name !== undefined) {
          if (fetcher.chdir.has(read.name)) movesDir = true
          if (fetcher.scripts.has(read.name)) nestedScripts.push(read.value ?? '')
        }
        k = read.next
      }
      if (isUnknown) markUnresolved(() => [name, ...words.slice(start + 1)])
      continue
    }

    const canonical = WRAPPER_ALIASES.get(name) ?? name
    const spec = WRAPPERS.get(canonical)
    if (spec === undefined) break
    wrappers.push(name)
    k++
    if (canonical === 'busybox' && !hasMetBusybox) {
      hasMetBusybox = true
      busyboxScript = mainShellScriptOf(words, k)
    }
    if (spec.movesDir) movesDir = true
    let isPidForm = false
    const splits: { raw: string; rest: string[] }[] = []
    const skipOptions = () => {
      while (k < words.length) {
        const option = words[k] as string
        if (option === '--') {
          k++
          // env's own words still follow `--` (§16 item 47): a lone `-` is its `-i`, and a word with a `=` in it is an assignment.
          if (canonical === 'env') {
            const own = envOwnWordsEnd(words, k)
            if (own.isNew) readAsProgram(k)
            k = own.end
          }
          break
        }
        // Before any option check: env takes a word with a `=` in it, however it starts, as an assignment (`=1`, `a-b=c`, `${X}=v`).
        if (canonical === 'env' && (isEnvAssignment(option) || option === '-')) {
          if (isEnvAssignment(option) && !isAssignment(option)) readAsProgram(k)
          k++
          continue
        }
        if (!option.startsWith('-') || option === '-') break
        if (PID_WRAPPERS.has(canonical) && PID_OPTION.test(option)) isPidForm = true
        const read = readOption(spec, words, k, false)
        if (read.isUnknown) markUnresolved(() => [name, ...words.slice(start + 1)])
        if (read.attached !== undefined) optionValues.push(...read.attached)
        // nsenter's -S and -G: whether a separate word is the option's value depends on the installed util-linux, and one
        // version holds for every link of a chain, so there are two readings of these options for the whole part and no
        // more. Reading B (the word is the program) is this loop: the word ends the options, and the part is reviewed as
        // one not read for sure. Reading A (every such option takes the next word) is the same loop run once more with
        // `reading.takesAmbiguous`: the caller makes one extra part of it for the part, whatever the number of options
        // and links (and one more of each where a `gosu` is read both ways, see `Reading`).
        if (canonical === 'nsenter' && read.name !== undefined && NSENTER_AMBIGUOUS.has(read.name) && read.attached === undefined) {
          const next = words[read.next]
          // A lone `-` is a word, not an option: `origin/main` read it as the option's value (§16 item 48).
          if (next !== undefined && (!next.startsWith('-') || next === '-')) {
            if (isReadingA) {
              k = read.next + 1
              continue
            }
            isAmbiguous = true
            markUnresolved(() => [name, ...words.slice(start + 1)])
          }
        }
        if (read.name !== undefined) {
          if (spec.chdir.has(read.name)) movesDir = true
          if (spec.scripts.has(read.name)) nestedScripts.push(read.value ?? '')
          // `env -S "cmd ..."`, `-S'cmd'`, `-vS ...`, `--split-string=...`: the value
          // is a command line, and its words are read as the rest of env's own.
          if (canonical === 'env' && (read.name === '-S' || read.name === '--split-string')) {
            const raw = read.value ?? ''
            const split = envSplit(raw)
            // Each string is also read alone as a script, as `origin/main` read it: an extra (the splice below and the readings
            // past the bound add to it and never stand for it, and it can neither use up the room of the text nor be cut by it).
            readAlone(raw)
            // Past the bound the strings are no longer spliced (that copies every word after them, and a crafted command
            // made it quadratic): they are read together, in order, with the words between and after them, as two scripts
            // (extras): the env reading (each string split as env splits it, each word quoted) and the shell reading (the
            // raw strings, as the earlier versions read them), and the part is reviewed as one whose options were not
            // all read. Two scripts for all of them, so the work does not grow with their number.
            // A further reading, the first versions' (`envLooseWords`), made only when it differs from env's own.
            const loose = envLooseWords(raw)
            const isLooseDifferent = loose.length !== split.words.length || loose.some((word, index) => word !== split.words[index])
            // A string holding an expansion (`${NAME}`, whose value the classifier cannot know: an unset name makes its word
            // vanish, so an option before it takes the next word and the words after the string can become the command) is
            // read two ways beside the first: with the expansions replaced by nothing (the words made again, the options
            // read again from the start of the part), and the words that follow the string, alone, as a command. All
            // extras; the part is reviewed whatever they say.
            const vanished = split.hasExpansion ? envSplit(raw, true).words : split.words
            if (split.hasExpansion) hasPastExpansion ||= envSplices >= MAX_ENV_SPLICES
            if (++envSplices > MAX_ENV_SPLICES) {
              markUnresolved(() => [name, ...words.slice(start + 1)])
              const between = words.slice(pastBoundFrom, k).map(quoted)
              if (pastEnv === undefined || pastShell === undefined || pastLoose === undefined || pastVanished === undefined) {
                pastEnv = split.words.map(quoted)
                pastShell = [raw]
                pastLoose = loose.map(quoted)
                pastVanished = vanished.map(quoted)
              } else {
                pastEnv.push(...between, ...split.words.map(quoted))
                pastShell.push(...between, raw)
                pastLoose.push(...between, ...loose.map(quoted))
                pastVanished.push(...between, ...vanished.map(quoted))
              }
              if (isLooseDifferent) hasPastLoose = true
              pastBoundFrom = read.next
              k = read.next
              continue
            }
            // A string env cannot read (an error in it) runs nothing in env; the part is reviewed, and the shell's reading below is the one that tells what the text says.
            if (!split.isSure) markUnresolved(() => [name, ...words.slice(start + 1)])
            if (split.hasExpansion) {
              markUnresolved(() => [name, ...words.slice(start + 1)])
              const tail = words.slice(read.next)
              extraScripts.push([...words.slice(0, k), ...vanished, ...tail].map(quoted).join(' '))
              // As env's own words: env goes on reading options and assignments there, so they are not the program (§16 item 47).
              if (tail.length > 0) extraScripts.push(['env', ...tail.map(quoted)].join(' '))
            }
            if (isLooseDifferent) extraScripts.push([...loose, ...words.slice(read.next)].map(quoted).join(' '))
            splits.push({ raw, rest: words.slice(read.next) })
            words = [...words.slice(0, k), ...split.words, ...words.slice(read.next)]
            continue
          }
        }
        k = read.next
      }
    }
    skipOptions()
    // setarch ARCH [options] CMD: the architecture is not the command.
    if (canonical === 'setarch' && name === 'setarch' && ARCH.test(words[k] ?? '')) {
      k++
      skipOptions()
    }
    if (canonical === 'timeout' && k < words.length) k++ // the duration
    // gosu USER CMD. `origin/main` read the word after `gosu` as the program, so the part is read both ways (§16 item 48):
    // here the word is the user, and in the added reading it is the program (a wrapper there is stripped in its turn, as
    // main's walk did). What the added reading found before its first `gosu` the first reading has found: not read twice.
    if (canonical === 'gosu' && k < words.length) {
      if (!reading.isGosuProgram) k++
      else if (!hasGosuWord) extraScripts.length = 0
      hasGosuWord = true
    }
    // chroot NEWROOT CMD, flock LOCKFILE CMD: one positional before the command.
    if ((canonical === 'chroot' || canonical === 'flock') && k < words.length && !(words[k] as string).startsWith('-')) {
      k++
      if (canonical === 'flock') skipOptions() // options may follow the lock file (`flock f -c cmd`)
    }
    // chrt PRIORITY CMD, taskset MASK CMD: the same, unless it is a pid form.
    if (PID_WRAPPERS.has(canonical) && !isPidForm && k < words.length) k++
    // The second reading of a spliced string (the shell scanner's, beside env's own that is in the part): an extra.
    for (const split of splits) extraScripts.push([split.raw, ...split.rest.map(quoted)].join(' '))
  }
  const hasMainReading = hasMainEnvString || envSplices > 0
  // An added reading makes it when no reading before it did: it met an `env -S` string that the first reading did not reach
  // (`nsenter -S 0 env -Sx cmd`, where the first reading takes `0` for the program).
  if (hasMainReading && !reading.hasMainReading) {
    // Not when it is the part's own words again (the walk of main stopped at the first word: a wrapper main did not know, a
    // brace word): its reading would be this one, and so on to the extras' depth, and the call refused.
    if (mainReading.length > 0 && !(mainReading.length === input.length && mainReading.every((word, index) => word === input[index]))) {
      extraScripts.push(mainReading.map(quoted).join(' '))
    }
    // The `-c` and `--call` scripts of the runners that walk passed (a nested script of the part on `origin/main`).
    for (const script of mainScripts) if (script !== '') extraScripts.push(script)
  }
  // Led by `env`, so that its options between and after the strings are read as options and not as the program. One
  // script of each reading for the whole call, however many wrappers it chains (one for each would hold all the words
  // after it, and cost the square of their number).
  if (pastEnv !== undefined && pastShell !== undefined) {
    const tail = words.slice(pastBoundFrom).map(quoted)
    extraScripts.push(['env', ...pastEnv, ...tail].join(' '), ['env', ...pastShell, ...tail].filter(word => word !== '').join(' '))
    if (hasPastLoose && pastLoose !== undefined) extraScripts.push(['env', ...pastLoose, ...tail].join(' '))
    // A string past the bound that holds an expansion: the strings with it replaced by nothing. (The words after them alone
    // are the part's own command already: a string past the bound is skipped, not spliced.)
    if (hasPastExpansion && pastVanished !== undefined) extraScripts.push(['env', ...pastVanished, ...tail].join(' '))
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
  // `origin/main` read `busybox` as a shell: the value of a later `-c` word was a script. Read too, as an extra, unless the
  // applet reading holds that very script already (`busybox sh -c '...'`).
  if (busyboxScript !== undefined && busyboxScript !== '' && !nestedScripts.includes(busyboxScript) && !inlineOf(coreWords).scripts.includes(busyboxScript)) {
    extraScripts.push(busyboxScript)
  }
  return {
    wrappers,
    coreWords,
    nestedScripts,
    extraScripts,
    isAmbiguous,
    hasGosuWord,
    hasMainReading: hasMainReading || reading.hasMainReading,
    movesDir,
    optionValues,
    ...(unresolved !== undefined && { unresolved }),
  }
}

/** `script` options that take the next word. */
const SCRIPT_VALUE_OPTIONS = new Set(['-c', '-E', '-I', '-O', '-B', '-T', '-m'])
/** The letters of `script` and `su` options that take a value, besides `-c`. */
const SCRIPT_VALUE_LETTERS: ReadonlySet<string> = new Set(['E', 'I', 'O', 'B', 'T', 'm', 'o'])
const SU_VALUE_LETTERS: ReadonlySet<string> = new Set(['g', 'G', 's', 'w'])

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

/** What a program that runs another command line makes of its arguments. */
type Inline = {
  /** Command lines to classify as `sh -c` is. */
  scripts: string[]
  /** Part of what it runs could not be read: the call is reviewed. */
  isUnreadable: boolean
  /** It types or pastes into another terminal. */
  isInput: boolean
}

const inline = (...scripts: (string | undefined)[]): Inline => ({ scripts: scripts.filter((script): script is string => script !== undefined && script !== ''), isUnreadable: false, isInput: false })
const UNREADABLE: Inline = { scripts: [], isUnreadable: true, isInput: false }
const INPUT: Inline = { scripts: [], isUnreadable: false, isInput: true }
const merge = (parts: readonly Inline[]): Inline => ({
  scripts: parts.flatMap(part => part.scripts),
  isUnreadable: parts.some(part => part.isUnreadable),
  isInput: parts.some(part => part.isInput),
})
/** The same, with the command lines it also runs. */
const withScripts = (base: Inline, ...scripts: (string | undefined)[]): Inline => merge([base, inline(...scripts)])

/** The command a program makes of its trailing words: one word is a shell string as written, several are an argument vector. */
const commandOf = (rest: readonly string[]): string | undefined =>
  rest.length === 0 ? undefined : rest.map((word, index) => (index === 0 && rest.length === 1 ? word : quoted(word))).join(' ')

type TmuxKind = 'shell' | 'if' | 'tmux' | 'set-hook' | 'keys' | 'bind' | 'source' | 'menu' | 'paste' | 'prompt' | 'choose' | 'set' | 'display' | 'detach' | 'none'
type TmuxCommand = { name: string; alias: string; values: ReadonlySet<string>; kind: TmuxKind }

const tmuxCommand = (name: string, alias: string, kind: TmuxKind = 'none', values: ReadonlySet<string> = new Set()): TmuxCommand => ({ name, alias, values, kind })

/**
 * Every `tmux` command, with the options of those that run something and
 * take a value. tmux resolves a written name by an exact alias or name, else by
 * a prefix of a name that no other name shares: the same here.
 */
const CHOOSE_VALUES = setOf('-F', '-f', '-K', '-O', '-t')

const TMUX_COMMANDS: readonly TmuxCommand[] = [
  tmuxCommand('attach-session', 'attach'), tmuxCommand('bind-key', 'bind', 'bind', setOf('-N', '-T')), tmuxCommand('break-pane', 'breakp'),
  tmuxCommand('capture-pane', 'capturep'), tmuxCommand('choose-buffer', '', 'choose', CHOOSE_VALUES), tmuxCommand('choose-client', '', 'choose', CHOOSE_VALUES), tmuxCommand('choose-tree', '', 'choose', CHOOSE_VALUES),
  tmuxCommand('clear-history', 'clearhist'), tmuxCommand('clear-prompt-history', 'clearphist'), tmuxCommand('clock-mode', ''),
  tmuxCommand('command-prompt', '', 'prompt', setOf('-I', '-p', '-t', '-T')), tmuxCommand('confirm-before', 'confirm', 'tmux', setOf('-c', '-p', '-t')), tmuxCommand('copy-mode', ''),
  tmuxCommand('customize-mode', ''), tmuxCommand('delete-buffer', 'deleteb'), tmuxCommand('detach-client', 'detach', 'detach', setOf('-E', '-s', '-t')),
  tmuxCommand('display-menu', 'menu', 'menu'), tmuxCommand('display-message', 'display', 'display', setOf('-c', '-d', '-t')), tmuxCommand('display-panes', 'displayp'),
  tmuxCommand('display-popup', 'popup', 'shell', setOf('-b', '-c', '-d', '-e', '-h', '-s', '-S', '-t', '-T', '-w', '-x', '-y')),
  tmuxCommand('find-window', 'findw'), tmuxCommand('has-session', 'has'),
  tmuxCommand('if-shell', 'if', 'if', setOf('-t')), tmuxCommand('join-pane', 'joinp'), tmuxCommand('kill-pane', 'killp'), tmuxCommand('kill-server', ''),
  tmuxCommand('kill-session', ''), tmuxCommand('kill-window', 'killw'), tmuxCommand('last-pane', 'lastp'), tmuxCommand('last-window', 'last'),
  tmuxCommand('link-window', 'linkw'), tmuxCommand('list-buffers', 'lsb'), tmuxCommand('list-clients', 'lsc'), tmuxCommand('list-commands', 'lscm'),
  tmuxCommand('list-keys', 'lsk'), tmuxCommand('list-panes', 'lsp'), tmuxCommand('list-sessions', 'ls'), tmuxCommand('list-windows', 'lsw'),
  tmuxCommand('load-buffer', 'loadb'), tmuxCommand('lock-client', 'lockc'), tmuxCommand('lock-server', 'lock'), tmuxCommand('lock-session', 'locks'),
  tmuxCommand('move-pane', 'movep'), tmuxCommand('move-window', 'movew'),
  tmuxCommand('new-session', 'new', 'shell', setOf('-c', '-e', '-f', '-F', '-n', '-s', '-t', '-x', '-y')),
  tmuxCommand('new-window', 'neww', 'shell', setOf('-c', '-e', '-F', '-n', '-t')),
  tmuxCommand('next-layout', 'nextl'), tmuxCommand('next-window', 'next'), tmuxCommand('paste-buffer', 'pasteb', 'paste', setOf('-b', '-s', '-t')),
  tmuxCommand('pipe-pane', 'pipep', 'shell', setOf('-t')), tmuxCommand('previous-layout', 'prevl'), tmuxCommand('previous-window', 'prev'),
  tmuxCommand('refresh-client', 'refresh'), tmuxCommand('rename-session', 'rename'), tmuxCommand('rename-window', 'renamew'),
  tmuxCommand('resize-pane', 'resizep'), tmuxCommand('resize-window', 'resizew'),
  tmuxCommand('respawn-pane', 'respawnp', 'shell', setOf('-c', '-e', '-t')), tmuxCommand('respawn-window', 'respawnw', 'shell', setOf('-c', '-e', '-t')),
  tmuxCommand('rotate-window', 'rotatew'), tmuxCommand('run-shell', 'run', 'shell', setOf('-d', '-t')), tmuxCommand('save-buffer', 'saveb'),
  tmuxCommand('select-layout', 'selectl'), tmuxCommand('select-pane', 'selectp'), tmuxCommand('select-window', 'selectw'),
  tmuxCommand('send-keys', 'send', 'keys', setOf('-c', '-N', '-t')), tmuxCommand('send-prefix', ''), tmuxCommand('server-access', ''),
  tmuxCommand('set-buffer', 'setb'), tmuxCommand('set-environment', 'setenv'), tmuxCommand('set-hook', '', 'set-hook', setOf('-t')),
  tmuxCommand('set-option', 'set', 'set', setOf('-t')), tmuxCommand('set-window-option', 'setw', 'set', setOf('-t')), tmuxCommand('show-buffer', 'showb'), tmuxCommand('show-environment', 'showenv'),
  tmuxCommand('show-hooks', ''), tmuxCommand('show-messages', 'showmsgs'), tmuxCommand('show-options', 'show'), tmuxCommand('show-prompt-history', 'showphist'),
  tmuxCommand('show-window-options', 'showw'), tmuxCommand('source-file', 'source', 'source'),
  tmuxCommand('split-window', 'splitw', 'shell', setOf('-c', '-e', '-F', '-l', '-p', '-t')), tmuxCommand('start-server', 'start'),
  tmuxCommand('suspend-client', 'suspendc'), tmuxCommand('swap-pane', 'swapp'), tmuxCommand('swap-window', 'swapw'), tmuxCommand('switch-client', 'switchc'),
  tmuxCommand('unbind-key', 'unbind'), tmuxCommand('unlink-window', 'unlinkw'), tmuxCommand('wait-for', 'wait'),
]

/** The tmux commands a written name stands for: one for an exact name or alias or a unique prefix, several when ambiguous (tmux refuses it), none when unknown. */
function tmuxCommandsNamed(typed: string): readonly TmuxCommand[] {
  const exact = TMUX_COMMANDS.find(command => command.alias === typed || command.name === typed)
  if (exact !== undefined) return [exact]
  return typed === '' ? [] : TMUX_COMMANDS.filter(command => command.name.startsWith(typed))
}

/** The options and the positional words of a tmux command's arguments, read as getopt does. */
function tmuxOptions(args: readonly string[], valued: ReadonlySet<string>): { flags: ReadonlySet<string>; values: ReadonlyMap<string, string>; rest: string[] } {
  const flags = new Set<string>()
  const values = new Map<string, string>()
  let i = 0
  for (; i < args.length; i++) {
    const option = args[i] as string
    if (option === '--') {
      i++
      break
    }
    if (!option.startsWith('-') || option === '-') break
    // The first letter that takes a value ends the cluster; its value is the
    // rest of the word, or the next word when it was the last letter.
    for (let c = 1; c < option.length; c++) {
      flags.add(option[c] as string)
      if (!valued.has(`-${option[c]}`)) continue
      values.set(option[c] as string, c === option.length - 1 ? (args[i + 1] ?? '') : option.slice(c + 1))
      if (c === option.length - 1) i++
      break
    }
  }
  return { flags, values, rest: args.slice(i) }
}

/** tmux options that hold a command line, or a format that runs one with `#(...)`. */
const TMUX_RUNNING_OPTIONS = ['default-command', 'default-shell', 'lock-command', 'status-left', 'status-right']

const KEY_ENTER = /^(?:Enter|C-m|C-j|KPEnter)$/

/** The command lines a list of tmux commands (`a ; b`) runs. */
function tmuxList(words: readonly string[], depth = 0): Inline {
  if (depth > MAX_DEPTH) return UNREADABLE
  // `\;` reaches here as `;`, or glued to the last word of a command (`Enter;`).
  const commands: string[][] = [[]]
  for (const word of words) {
    const current = commands[commands.length - 1] as string[]
    if (word === ';') commands.push([])
    else if (word.endsWith(';') && !word.endsWith('\\;')) {
      current.push(word.slice(0, -1))
      commands.push([])
    } else current.push(word)
  }
  return merge(commands.filter(command => command.length > 0).map(command => tmuxOne(command, depth)))
}

function tmuxOne(command: readonly string[], depth: number): Inline {
  const [typed, ...args] = command
  const named = tmuxCommandsNamed(typed as string)
  if (named.length === 0) return inline()
  // An ambiguous prefix is refused by tmux; it is reviewed if any command it could be runs something.
  if (named.length > 1) return named.some(candidate => candidate.kind !== 'none') ? UNREADABLE : inline()
  const found = named[0] as TmuxCommand
  const { flags, values, rest } = tmuxOptions(args, found.values)
  const asTmux = (text: string | undefined): Inline => (text === undefined || text === '' ? inline() : inline(`tmux ${text}`))
  switch (found.kind) {
    case 'shell':
      // run-shell -C takes a tmux command, not a shell command.
      if (found.name === 'run-shell' && flags.has('C')) return asTmux(rest[0])
      // `pipe-pane -I` feeds what the command prints into the pane as typed input.
      return withScripts(found.name === 'pipe-pane' && flags.has('I') ? INPUT : inline(), commandOf(rest))
    case 'if':
      return merge([flags.has('F') ? inline() : inline(rest[0]), asTmux(rest[1]), asTmux(rest[2])])
    case 'tmux':
      return asTmux(rest[0])
    case 'set-hook':
      return flags.has('u') || flags.has('R') ? inline() : asTmux(rest[1])
    case 'bind':
      // A binding only registers its command (a reload of a config file is the usual one): what it would run is read, a file it would load is not a finding.
      return rest.length > 1 ? inline(...tmuxList(rest.slice(1), depth + 1).scripts) : inline()
    case 'keys': {
      // Every form sends something to a pane; `-X` sends a copy-mode command, `-H` hexadecimal bytes.
      if (flags.has('X')) return INPUT
      if (flags.has('H')) return merge([INPUT, UNREADABLE])
      // Each run of keys up to an Enter is typed into a shell: a single word is a command line, several are keys this cannot read.
      const segments: string[][] = [[]]
      for (const key of rest) {
        if (KEY_ENTER.test(key)) segments.push([])
        else (segments[segments.length - 1] as string[]).push(key)
      }
      return merge([
        INPUT,
        ...segments
          .filter(keys => keys.length > 0)
          .map(keys => (keys.length === 1 ? inline(keys[0]) : { ...inline(keys.join(' ')), isUnreadable: true })),
      ])
    }
    case 'paste':
      return INPUT
    case 'prompt':
      // Types into the tmux prompt; its template is a tmux command, run when the prompt is answered.
      return merge([INPUT, asTmux(rest[0])])
    case 'choose':
      // A template is a tmux command run on the choice; it is read, and the call is reviewed all the same.
      return rest.length > 0 ? merge([UNREADABLE, asTmux(rest[0])]) : inline()
    case 'set': {
      // Options that run a command (a new pane's, a lock's, a status line's `#(...)`), or any option whose value does.
      const name = (rest[0] ?? '').replace(/\[\d*\]$/, '')
      // tmux takes an exact option name, else a unique prefix: `status` is an option of its own.
      const isRunning = name !== 'status' && name.length >= 4 && TMUX_RUNNING_OPTIONS.some(option => option.startsWith(name))
      return isRunning || rest.slice(1).some(value => value.includes('#(')) ? UNREADABLE : inline()
    }
    case 'display':
      return rest.some(word => word.includes('#(')) ? UNREADABLE : inline()
    case 'detach': {
      // `detach-client -E` replaces the client with a shell command.
      const command = values.get('E')
      return command === undefined ? inline() : withScripts(UNREADABLE, command)
    }
    case 'source':
    case 'menu':
      return found.kind === 'menu' && rest.length === 0 ? inline() : UNREADABLE
    case 'none':
      return inline()
  }
}

/** The command lines a `tmux` call runs, from its words. */
function tmuxInline(coreWords: readonly string[]): Inline {
  let i = 1
  let own = inline()
  // tmux's own options come first; `-c` there is a shell command too, and `-f` names a file of commands it runs at start.
  for (; i < coreWords.length && (coreWords[i] as string).startsWith('-'); i++) {
    const option = coreWords[i] as string
    if (option === '-c') return withScripts(own, coreWords[i + 1])
    if (/^-[A-Za-z0-9]*f/.test(option)) own = merge([own, UNREADABLE])
    if (['-L', '-S', '-f', '-T'].includes(option)) i++
  }
  return merge([own, tmuxList(coreWords.slice(i))])
}

/** `screen [options] command args`, `screen -X stuff 'text'`: the command line it starts or types. */
function screenInline(coreWords: readonly string[]): Inline {
  let i = 1
  for (; i < coreWords.length; i++) {
    const word = coreWords[i] as string
    if (word === '--') {
      i++
      break
    }
    if (!word.startsWith('-') || word === '-') break
    if (['-ls', '-list', '-wipe', '-v'].includes(word)) continue
    for (let c = 1; c < word.length; c++) {
      const letter = word[c] as string
      if (letter === 'X') {
        const rest = word.length > c + 1 ? [word.slice(c + 1), ...coreWords.slice(i + 1)] : coreWords.slice(i + 1)
        const [action, ...args] = rest
        if (action === 'stuff') return withScripts(INPUT, args[0])
        if (action === 'paste' || action === 'readbuf' || action === 'process') return INPUT
        if (action === 'screen' || action === 'exec') {
          // `screen [-opts] [n] cmd args`: the options and a window number come first.
          let at = 0
          while (at < args.length && (args[at] as string).startsWith('-')) at++
          if (/^\d+$/.test(args[at] ?? '')) at++
          return inline(commandOf(args.slice(at)))
        }
        return action === 'eval' || action === 'source' ? UNREADABLE : inline()
      }
      if ('cehpsStT'.includes(letter)) {
        if (c === word.length - 1) i++
        break
      }
    }
  }
  return inline(commandOf(coreWords.slice(i)))
}

/** `zellij run -- cmd`, `zellij action write-chars 'text'`. */
function zellijInline(coreWords: readonly string[]): Inline {
  const at = coreWords.findIndex((word, index) => index > 0 && ['run', 'r', 'action', 'ac'].includes(word))
  if (at < 0) return inline()
  const rest = coreWords.slice(at + 1)
  const afterSeparator = (): readonly string[] => {
    const separator = rest.indexOf('--')
    return separator < 0 ? [] : rest.slice(separator + 1)
  }
  if (coreWords[at] === 'run' || coreWords[at] === 'r') {
    if (rest.includes('--')) return inline(commandOf(afterSeparator()))
    const valued = new Set(['-n', '--name', '-d', '--direction', '--cwd', '-x', '-y', '--width', '--height', '--pinned'])
    let j = 0
    for (; j < rest.length && (rest[j] as string).startsWith('-'); j++) if (valued.has(rest[j] as string)) j++
    return inline(commandOf(rest.slice(j)))
  }
  const [action, ...args] = rest
  if (action === 'write-chars') return withScripts(INPUT, args[0])
  if (action === 'write') return merge([INPUT, UNREADABLE])
  if (action === 'new-pane' || action === 'new-tab') return inline(commandOf(afterSeparator()))
  return inline()
}

/** `nix develop|shell -c cmd`, `nix run REF -- args`: the command line it runs. */
function nixInline(coreWords: readonly string[]): Inline {
  const at = coreWords.findIndex((word, index) => index > 0 && ['develop', 'shell', 'run'].includes(word))
  if (at < 0) return inline()
  const rest = coreWords.slice(at + 1)
  if (coreWords[at] !== 'run') {
    const flag = rest.findIndex(word => word === '-c' || word === '--command')
    return flag < 0 ? inline() : inline(commandOf(rest.slice(flag + 1)))
  }
  // `nix run REF -- args` runs the app REF names: its name and the arguments are the command.
  const separator = rest.indexOf('--')
  const own = separator < 0 ? rest : rest.slice(0, separator)
  const ref = own.find(word => !word.startsWith('-') && word.includes('#')) ?? own.find(word => !word.startsWith('-'))
  const name = ref === undefined ? undefined : /^[^#]*#([A-Za-z0-9_.+-]+)(?:\^\S*)?$/.exec(ref)?.[1]
  if (name === undefined) return UNREADABLE
  return inline(commandOf([name, ...(separator < 0 ? [] : rest.slice(separator + 1))]))
}

/** `git submodule foreach`, `git bisect run`, `git rebase --exec`, `git filter-branch --tree-filter`: the command lines git runs. */
function gitInline(coreWords: readonly string[]): Inline {
  const [, sub, ...rest] = coreWords
  if (sub === 'submodule' && rest[0] === 'foreach') {
    const options = rest.slice(1).findIndex(word => !word.startsWith('-'))
    return options < 0 ? inline() : inline(commandOf(rest.slice(1 + options)))
  }
  if (sub === 'bisect' && rest[0] === 'run') return inline(commandOf(rest.slice(1)))
  if (sub === 'rebase') {
    return inline(
      ...rest.map((word, index) => {
        if (word === '--exec' || /^-[a-zA-Z]*x$/.test(word)) return rest[index + 1]
        const glued = /^(?:--exec=|-x)([\s\S]+)$/.exec(word)
        return glued?.[1]
      }),
    )
  }
  if (sub === 'filter-branch') {
    return inline(...rest.map((word, index) => (/^--(?:tree|index|msg|env|commit|tag-name|parent)-filter$|^--setup$/.test(word) ? rest[index + 1] : undefined)))
  }
  return inline()
}

/** `find ... -exec cmd {} ;`, `-execdir`, `-ok`, `-okdir`: each command it runs. */
function findInline(coreWords: readonly string[]): Inline {
  const found: (string | undefined)[] = []
  for (let i = 1; i < coreWords.length; i++) {
    if (!['-exec', '-execdir', '-ok', '-okdir'].includes(coreWords[i] as string)) continue
    let end = i + 1
    while (end < coreWords.length && coreWords[end] !== ';' && !(coreWords[end] === '+' && coreWords[end - 1] === '{}')) end++
    found.push(commandOf(coreWords.slice(i + 1, end)))
    i = end
  }
  return inline(...found)
}

/** `entr [-acdnprsz] cmd args`: the utility it runs when a file changes (with `-s`, a shell command line). */
function entrInline(coreWords: readonly string[]): Inline {
  let i = 1
  let isShell = false
  for (; i < coreWords.length && (coreWords[i] as string).startsWith('-') && coreWords[i] !== '-'; i++) if (/^-[a-zA-Z]*s/.test(coreWords[i] as string)) isShell = true
  const rest = coreWords.slice(i)
  return inline(isShell ? rest.join(' ') : commandOf(rest))
}

/** `parallel [options] cmd args ::: inputs`: the command it runs for each input. */
function parallelInline(coreWords: readonly string[]): Inline {
  const valued = new Set(['-j', '-S', '-a', '-N', '-n', '-L', '-l', '-I', '-d', '-C', '-E', '-P', '--jobs', '--sshlogin', '--arg-file', '--max-args', '--max-lines', '--delimiter', '--colsep', '--joblog', '--results', '--delay', '--timeout', '--retries', '--eof'])
  let i = 1
  for (; i < coreWords.length && (coreWords[i] as string).startsWith('-') && coreWords[i] !== '-'; i++) if (valued.has(coreWords[i] as string)) i++
  const rest = coreWords.slice(i)
  const end = rest.findIndex(word => word.startsWith(':::'))
  return inline(commandOf(end < 0 ? rest : rest.slice(0, end)))
}

/** The programs that type into another window's terminal, and the words after which they do. */
const INPUT_WORDS: Readonly<Record<string, readonly string[]>> = {
  xdotool: ['type', 'key', 'keydown'],
  ydotool: ['type', 'key'],
}

/** `kitty @ send-text|send-key`, `wezterm cli send-text`, `xdotool type|key|keydown`, `ydotool type|key`, `wtype`, `osascript` with `keystroke`. */
function isTerminalInputTool(coreWords: readonly string[]): boolean {
  const [program, ...rest] = coreWords
  switch (program) {
    case 'kitty':
    case 'kitten':
      return rest.includes('@') && rest.some(word => word === 'send-text' || word === 'send-key')
    case 'wezterm':
      return rest.includes('cli') && rest.includes('send-text')
    case 'xdotool':
    case 'ydotool':
      return rest.some(word => INPUT_WORDS[program]?.includes(word) === true)
    case 'wtype':
      return true
    case 'osascript':
      return rest.some(word => /\bkeystroke\b|\bkey code\b/.test(word))
    default:
      return false
  }
}

/** The command lines a program runs for what it is given: a shell's `-c`, `eval`, `su -c`, a multiplexer, a runner, `find -exec`. */
function inlineOf(coreWords: readonly string[]): Inline {
  const program = coreWords[0]
  if (program === undefined) return inline()
  if (program === 'eval') return inline(coreWords.slice(1).join(' '))
  if (program === 'tmux') return tmuxInline(coreWords)
  if (program === 'screen') return screenInline(coreWords)
  if (program === 'zellij') return zellijInline(coreWords)
  if (program === 'nix') return nixInline(coreWords)
  if (program === 'git') return gitInline(coreWords)
  if (program === 'find') return findInline(coreWords)
  if (program === 'entr') return entrInline(coreWords)
  if (program === 'parallel') return parallelInline(coreWords)
  if (isTerminalInputTool(coreWords)) return INPUT
  return inline(inlineScriptOf(coreWords))
}

/** The script a shell runs with `-c` (any short-option cluster holding `c`). */
function inlineScriptOf(coreWords: readonly string[]): string | undefined {
  const program = coreWords[0]
  if (program === undefined) return undefined
  if (program === 'nix-shell') {
    for (let i = 1; i < coreWords.length; i++) {
      const word = coreWords[i] as string
      if (word === '--run' || word === '--command') return coreWords[i + 1]
      const eq = /^--(run|command)=([\s\S]*)$/.exec(word)
      if (eq !== null) return eq[2]
    }
    return undefined
  }
  // `script -c CMD` and `su -c CMD` run CMD in a shell, as `sh -c` does, and
  // take it glued (`-c'cmd'`, `-qc 'cmd'`) or by a long name or a unique prefix of it.
  if (program === 'script' || program === 'su') {
    const valueLetters = program === 'script' ? SCRIPT_VALUE_LETTERS : SU_VALUE_LETTERS
    for (let i = 1; i < coreWords.length; i++) {
      const word = coreWords[i] as string
      if (word.startsWith('--')) {
        const eq = word.indexOf('=')
        const typed = eq < 0 ? word : word.slice(0, eq)
        if (typed.length > 2 && '--command'.startsWith(typed)) return eq < 0 ? coreWords[i + 1] : word.slice(eq + 1)
        continue
      }
      if (!word.startsWith('-') || word === '-') continue
      for (let c = 1; c < word.length; c++) {
        const letter = word[c] as string
        const rest = word.slice(c + 1)
        if (letter === 'c') return rest !== '' ? rest : coreWords[i + 1] === '--' ? coreWords[i + 2] : coreWords[i + 1]
        if (valueLetters.has(letter)) {
          if (rest === '') i++
          break
        }
      }
    }
  }
  if (!SHELLS.has(program) && program !== 'su' && program !== 'script') return undefined
  // Any cluster holding `c`, as it has always been read (and `--command`).
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

/**
 * Whether a shell reads a heredoc, as the readings of the parts see it (§16 item 49). The heredoc's part makes one; every
 * reading of that part or of a later part of its line, and every extra or option script read for those, marks it when its
 * program is a shell or it stands behind `busybox`: the body is then read as a script, as release 0.5.0 read it. A
 * command with no heredoc makes none, so nothing changes for it.
 */
type Stdin = { isFedToShell: boolean }

/**
 * Scans a command (or a script nested in it) into parts. `extraDepth` is 0 for the command's own text and its nested
 * scripts, which keep `MAX_PARTS` and `MAX_DEPTH` exactly as on `origin/main` (past them the parse is cut and the call is
 * reviewed). An extra reading (see `MAX_EXTRA_CHARS`) is scanned at `extraDepth` 1 or more, and so is everything nested
 * in one: it is charged to the extra budgets only, never to the text's own, and its depth does not count against
 * `MAX_DEPTH`. When an extra budget runs out the scanning of extras stops and `isExhausted` is set: the call is refused.
 * `stdinOf` is set when the text is a script that reads the standard input of a part a heredoc may feed (see `Stdin`).
 */
function scan(command: string, depth: number, isNested: boolean, out: Builder, scope = 0, parentScope?: number, extraDepth = 0, stdinOf?: Stdin): void {
  const isExtra = extraDepth > 0
  if (isExtra) {
    if (out.isExhausted) return
    out.extraScanned += command.length
    if (extraDepth > MAX_EXTRA_DEPTH || out.extraScanned > out.maxExtraChars) {
      out.isExhausted = true
      return
    }
  } else if (depth > MAX_DEPTH) {
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
  let pendingHeredocs: { tag: string; owner: number; isExpanded: boolean; stdin: Stdin | undefined }[] = []
  let heredocTags: { tag: string; isExpanded: boolean }[] = []
  let input = ''
  // The next part reads the pipe of the one before it.
  let isPipeNext = false

  // Everything nested in an extra is an extra (the flag is inherited, and the depth is the extras' own); text of the
  // command's own is read one level deeper as it always was, and an extra reading `isExtraText` starts a new extra.
  // `stdin` goes with a script that reads the standard input of the part it stands in: an extra reading of the part, or
  // the script of a wrapper or runner option. The scripts handed to another program (`inlineOf`) get none.
  const nested = (text: string, isExtraText = false, stdin?: Stdin) => {
    if (isExtra || isExtraText) scan(text, depth, true, out, ++out.lastScope, scope, extraDepth + 1, stdin)
    else scan(text, depth + 1, true, out, ++out.lastScope, scope, 0, stdin)
  }
  // The parts are counted against the bound of their kind: the text's own against `MAX_PARTS`, an extra's against `MAX_EXTRA_PARTS`.
  const hasRoom = (isExtraPart: boolean) => (isExtraPart ? out.extraParts < MAX_EXTRA_PARTS : out.ownParts < MAX_PARTS)
  const countPart = (isExtraPart: boolean) => {
    if (isExtraPart) out.extraParts++
    else out.ownParts++
  }

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

  const endPart = (end: number, isLineEnd = false) => {
    endWord()
    // A redirect operator with no word after it in this part: nothing the part says is sure (a syntax error in a
    // shell, and what the scanner would take for its target is the next part's own text). The call is reviewed.
    if (pendingTarget !== undefined) {
      out.isCut = true
      pendingTarget = undefined
    }
    const text = command.slice(partStart, end).trim()
    const owner = out.parts.length
    const isPiped = isPipeNext
    // A pipe at the end of a line goes on to the next line's command.
    if (!isLineEnd || words.length > 0 || redirects.length > 0) isPipeNext = false
    // Where the readings of this part say whether a shell reads a heredoc (`Stdin`): the part's own when it has one; else
    // the one of the last part of this line that has one and whose body is not yet taken (release 0.5.0 fed a heredoc
    // to a shell in any later part); else the one of the part this text is a script of.
    const stdin: Stdin | undefined = heredocTags.length > 0 ? { isFedToShell: false } : (pendingHeredocs.at(-1)?.stdin ?? stdinOf)
    // One reading of the words as a part, with the scripts it holds. `isReadingA` is an added reading (`Reading`: the second
    // reading of an ambiguous `nsenter` option, the word after `gosu` as the program): an extra, and so is everything it
    // holds. It makes no part of the words as they stand: the first reading made it where an ambiguous option stands, and
    // a part behind `gosu` asks already (`privileged`), which is above the review that part gives. Returns whether the
    // part was made.
    const makePart = (core: Core, isReadingA: boolean): boolean => {
      const isExtraPart = isExtra || isReadingA
      if (isExtraPart && out.isExhausted) return false
      if (!hasRoom(isExtraPart)) {
        // The text's own parts past the bound cut the parse (review, as on `origin/main`); an extra's refuse the call.
        if (isExtraPart) out.isExhausted = true
        else out.isCut = true
        return false
      }
      const { wrappers, coreWords, nestedScripts, extraScripts, unresolved, movesDir, optionValues } = core
      const { scripts, isUnreadable, isInput } = inlineOf(coreWords)
      // This reading feeds the heredoc to a shell, or to `busybox`, which release 0.5.0 took for one (§16 item 49).
      if (stdin !== undefined && (SHELLS.has(coreWords[0] ?? '') || wrappers.includes('busybox'))) stdin.isFedToShell = true
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
        scope,
        ...(parentScope !== undefined && { parentScope }),
        movesDir,
        optionValues,
        ...(isUnreadable && { isUnreadable }),
        ...(isInput && { isTerminalInput: true }),
      }
      out.parts.push(part)
      countPart(isExtraPart)
      // A runner whose inner command was not found for sure: the words as they stand are a part of their own, so a rule
      // can review the call. Not counted (one for a part at most), so it never uses up a bound the text had without it.
      if (unresolved !== undefined && !isReadingA) {
        out.parts.push({ ...part, wrappers: [], coreWords: unresolved, core: unresolved.join(' '), redirects: [], input: '', isUnresolved: true })
      }
      // What the text holds comes first, and the extra readings after it.
      for (const script of scripts) nested(script, isReadingA)
      for (const nestedScript of nestedScripts) if (nestedScript !== '') nested(nestedScript, isReadingA, stdin)
      for (const extra of extraScripts) if (extra !== '') nested(extra, true, stdin)
      return true
    }
    if (words.length > 0 || redirects.length > 0) {
      // The added readings of the part (`Reading`): the ambiguous `nsenter` options taking their word, the word after
      // `gosu` as the program, and both, each made only when it can differ from one made before it.
      const core = coreOf(words)
      if (makePart(core, false)) {
        let hasMainReading = core.hasMainReading
        const added = (takesAmbiguous: boolean, isGosuProgram: boolean): Core | undefined => {
          const more = coreOf(words, { takesAmbiguous, isGosuProgram, hasMainReading })
          hasMainReading = more.hasMainReading
          return makePart(more, true) ? more : undefined
        }
        const taking = core.isAmbiguous ? added(true, false) : undefined
        if (!core.isAmbiguous || taking !== undefined) {
          const program = core.hasGosuWord ? added(false, true) : undefined
          if ((!core.hasGosuWord || program !== undefined) && (taking?.hasGosuWord === true || program?.isAmbiguous === true)) added(true, true)
        }
      }
    }
    if (out.parts.length > owner) {
      pendingHeredocs.push(...heredocTags.map(({ tag, isExpanded }) => ({ tag, owner, isExpanded, stdin })))
    }
    heredocTags = []
    words = []
    redirects = []
    input = ''
  }

  /** Consumes heredoc bodies after a newline at `i`; returns the new index. */
  const takeHeredocs = (i: number): number => {
    let at = i + 1
    // A later part of the line marks the last heredoc before it: the mark holds for every heredoc before that one too.
    let isLaterFed = false
    for (let pending = pendingHeredocs.length - 1; pending >= 0; pending--) {
      const stdin = pendingHeredocs[pending]?.stdin
      if (stdin === undefined) continue
      isLaterFed ||= stdin.isFedToShell
      stdin.isFedToShell = isLaterFed
    }
    for (const { tag, owner, isExpanded, stdin } of pendingHeredocs) {
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
      // The parts of a body read as an extra (below) are not the text's: they never make this test true, which would
      // read a body as the text's own script and not as below.
      const later = out.parts.slice(owner).filter(other => other.isNested === isNested)
      const isFedToShell = later.some(other => SHELLS.has(other.coreWords[0] ?? '') && out.bodyParts?.has(other) !== true)
      if (isFedToShell) {
        nested(body)
        continue
      }
      // A reading the parser added feeds it to a shell, or a part of the line stands behind `busybox`: the body is a
      // script too, read as an extra, so it is charged to the extras' budgets and never to the text's own (§16 items 45
      // and 49). So it is when release 0.5.0's own test holds: a later part of this nesting, a part of such a body among
      // them, is a shell or stands behind `busybox`.
      if (stdin?.isFedToShell === true || later.some(other => SHELLS.has(other.coreWords[0] ?? '') || other.wrappers.includes('busybox'))) {
        const from = out.parts.length
        nested(body, true)
        out.bodyParts ??= new Set()
        for (let made = from; made < out.parts.length; made++) {
          const bodyPart = out.parts[made] as ShellPart
          bodyPart.isExtraBody = true
          out.bodyParts.add(bodyPart)
        }
      }
      // An unquoted delimiter: the shell expands `$(...)` and backticks in the body, so the commands they run are parts
      // of this call. Read as on `origin/main`, with the text's own bounds, whatever was read above: a script reading
      // takes a substitution behind an apostrophe or a `#` for a quoted word or a comment.
      if (isExpanded) for (const inner of substitutionsIn(body)) if (inner.trim() !== '') nested(inner)
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
        // A command substitution inside the arithmetic still runs.
        for (const inner of substitutionsIn(command.slice(i, stop + 1))) if (inner.trim() !== '') nested(inner)
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
      // The substitution is a word like any other: the target of a redirect that is waiting for one, else an argument.
      word = '<(...)'
      hasWord = true
      endWord()
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
      endPart(i, true)
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
        // A file descriptor number, not a word: nothing of it may stay for the word that follows (an escaped digit
        // would make the next heredoc delimiter read as quoted).
        word = ''
        hasWord = false
        isWordEscaped = false
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
export function splitShell(command: string, extraChars = MAX_EXTRA_CHARS): Split {
  if (command.length > MAX_COMMAND_CHARS) {
    return { parts: [], isTooLong: true, isCut: false, isExhausted: false }
  }
  const out: Builder = { parts: [], isCut: false, lastScope: 0, ownParts: 0, extraScanned: 0, maxExtraChars: extraChars, extraParts: 0, isExhausted: false }
  scan(command, 0, false, out)
  return { parts: out.parts, isTooLong: false, isCut: out.isCut, isExhausted: out.isExhausted }
}
