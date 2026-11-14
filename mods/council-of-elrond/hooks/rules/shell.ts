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
  nsenter: specOf({
    values: ['-t', '-S', '-G', '--target', '--setuid', '--setgid'],
    flags: ['-a', '-m', '-u', '-i', '-n', '-p', '-C', '-T', '-U', '-r', '-w', '-F', '-Z', '-e', '-W', '--all', '--mount', '--uts', '--ipc', '--net', '--pid', '--cgroup', '--time', '--user', '--root', '--wd', '--wdns', '--no-fork', '--follow-context', '--preserve-credentials', '--env', '-h', '-V', '--help', '--version'],
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
    values: ['-u', '--unit', '-p', '--property', '-E', '--setenv', '-M', '--machine', '-H', '--host', '--description', '--slice', '--uid', '--gid', '--nice', '--service-type', '--timer-property', '--on-active', '--on-boot', '--on-startup', '--on-unit-active', '--on-unit-inactive', '--on-calendar', '--on-clock-change', '--on-timezone-change', '--job-mode'],
    chdir: ['-D', '--working-directory', '--root-directory'],
    flags: ['--user', '--system', '--scope', '--no-block', '--wait', '--pty', '-t', '--pipe', '-P', '--shell', '-S', '--no-ask-password', '--collect', '-q', '--quiet', '--remain-after-exit', '-r', '--same-dir', '-d', '--send-sighup', '--ignore-failure', '--no-pager', '--no-wall', '-h', '--help', '--version', '--slice-inherit', '--expand-environment'],
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
}

type Core = {
  wrappers: string[]
  coreWords: string[]
  nestedScripts: string[]
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
 * The words `env -S` makes of its string: split on blanks, with quotes and the
 * escapes `env` reads (`\_` is a separator outside quotes and a blank inside
 * double quotes, `\c` ends the string, `#` at the start of a word begins a
 * comment). `\f \n \r \t \v` are read as separators, the way that exposes more
 * of what follows.
 */
function envStringWords(text: string): string[] {
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

const MAX_BRACE_ELEMENTS = 16

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

/** Strips assignments, keywords, wrappers and git's global options. */
function coreOf(input: readonly string[]): Core {
  let words = input
  let k = 0
  const wrappers: string[] = []
  const nestedScripts: string[] = []
  const optionValues: string[] = []
  let unresolved: string[] | undefined
  let movesDir = false
  // A call whose options were not all read: its words as they stand are classified
  // again, and where it runs is not known either.
  const markUnresolved = (rest: string[]) => {
    unresolved ??= rest
    movesDir = true
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
          if (read.attached !== undefined) optionValues.push(...read.attached)
          if (read.name !== undefined) {
            if (runner.chdir.has(read.name)) movesDir = true
            if (runner.scripts.has(read.name)) nestedScripts.push(read.value ?? '')
          }
          k = read.next
        }
        if (isUnknown || (hasSpec && !hasSeparator)) markUnresolved([name, sub, ...words.slice(j + 1)])
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
      if (isUnknown) markUnresolved([name, ...words.slice(start + 1)])
      continue
    }

    const canonical = WRAPPER_ALIASES.get(name) ?? name
    const spec = WRAPPERS.get(canonical)
    if (spec === undefined) break
    wrappers.push(name)
    k++
    if (spec.movesDir) movesDir = true
    let isPidForm = false
    const splits: { raw: string; rest: string[] }[] = []
    const skipOptions = () => {
      while (k < words.length) {
        const option = words[k] as string
        if (option === '--') {
          k++
          break
        }
        if (canonical === 'env' && (isAssignment(option) || option === '-')) {
          k++
          continue
        }
        if (!option.startsWith('-') || option === '-') break
        if (PID_WRAPPERS.has(canonical) && PID_OPTION.test(option)) isPidForm = true
        const read = readOption(spec, words, k, false)
        if (read.isUnknown) markUnresolved([name, ...words.slice(start + 1)])
        if (read.attached !== undefined) optionValues.push(...read.attached)
        if (read.name !== undefined) {
          if (spec.chdir.has(read.name)) movesDir = true
          if (spec.scripts.has(read.name)) nestedScripts.push(read.value ?? '')
          // `env -S "cmd ..."`, `-S'cmd'`, `-vS ...`, `--split-string=...`: the value
          // is a command line, and its words are read as the rest of env's own.
          if (canonical === 'env' && (read.name === '-S' || read.name === '--split-string')) {
            const raw = read.value ?? ''
            splits.push({ raw, rest: words.slice(read.next) })
            words = [...words.slice(0, k), ...envStringWords(raw), ...words.slice(read.next)]
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
    if (canonical === 'gosu' && k < words.length) k++ // the user
    // chroot NEWROOT CMD, flock LOCKFILE CMD: one positional before the command.
    if ((canonical === 'chroot' || canonical === 'flock') && k < words.length && !(words[k] as string).startsWith('-')) {
      k++
      if (canonical === 'flock') skipOptions() // options may follow the lock file (`flock f -c cmd`)
    }
    // chrt PRIORITY CMD, taskset MASK CMD: the same, unless it is a pid form.
    if (PID_WRAPPERS.has(canonical) && !isPidForm && k < words.length) k++
    for (const split of splits) nestedScripts.push([split.raw, ...split.rest.map(quoted)].join(' '))
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
  return { wrappers, coreWords, nestedScripts, movesDir, optionValues, ...(unresolved !== undefined && { unresolved }) }
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

function scan(command: string, depth: number, isNested: boolean, out: Builder, scope = 0, parentScope?: number): void {
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

  const nested = (text: string) => scan(text, depth + 1, true, out, ++out.lastScope, scope)

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
        const { wrappers, coreWords, nestedScripts, unresolved, movesDir, optionValues } = coreOf(words)
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
  const out: Builder = { parts: [], isCut: false, lastScope: 0 }
  scan(command, 0, false, out)
  return { parts: out.parts, isTooLong: false, isCut: out.isCut }
}
