import type { CheckName } from '../config/types.js'
import { isInside, normalize, resolve } from './paths.js'
import { isCurrentBranchRef, parsePush } from './push.js'
import type { ParsedPush } from './push.js'
import { PRIVILEGE_WRAPPERS } from './shell.js'
import type { ShellPart } from './shell.js'

export type CheckContext = {
  /** The project root, absolute. */
  root: string
  /** The session's working directory, absolute. */
  cwd: string
  /** $HOME, when known. */
  home?: string
  /**
   * The branch checked out where a force push of the current branch would run,
   * read by the caller only for such a call. Absent when it could not be read
   * (git failed, a detached HEAD, git would run elsewhere): then it is unknown.
   */
  currentBranch?: string
  /**
   * An earlier part of the same call can move HEAD (a checkout, a reset, a
   * script that is not read), so the branch read before the call may no longer
   * be the one a later push overwrites. Set by `classify` for each part.
   */
  isHeadMoved?: boolean
  protectedBranches: readonly RegExp[]
  production: readonly RegExp[]
}

const flagsAndArgs = (words: readonly string[]): { flags: string[]; args: string[] } => {
  const flags: string[] = []
  const args: string[] = []
  let isEnd = false
  for (const word of words) {
    if (!isEnd && word === '--') isEnd = true
    else if (!isEnd && word.startsWith('-') && word !== '-') flags.push(word)
    else args.push(word)
  }
  return { flags, args }
}

/** True when `flag` is a long option written in full or as a prefix of `full` at least `min` characters long. */
const isLongPrefix = (flag: string, full: string, min: number): boolean => flag.length >= min && full.startsWith(flag)

/** A target that is another user's home (`~root`) or the previous directory (`~-`): not known to be inside the project. */
const isOtherHome = (target: string): boolean => /^~(?:[A-Za-z_][\w.-]*|-)(?:\/|$)/.test(target)

/**
 * A target whose expansion carries a default or an alternative that is, or may
 * be, home or an absolute path: `${HOME:-/}`, `${HOME-x}`, `${X:-/etc}`. The
 * shell decides at run time, so it counts as the home or root target.
 */
const isDefaultedAbsolute = (target: string): boolean =>
  /^\$\{HOME[^}\w]/.test(target) || /\$\{[A-Za-z_]\w*:?[-=+](?:\/|~|\$\{?HOME)/.test(target)

/** A recursive rm whose target is `/`, home, or outside the project. */
function rmOutsideRepo(part: ShellPart, context: CheckContext): boolean {
  if (part.coreWords[0] !== 'rm') return false
  const { flags, args } = flagsAndArgs(part.coreWords.slice(1))
  // Brace expansion in a flag: `-{r,f}` is `-r -f`, `--{recursive,force}` is
  // `--recursive --force`.
  const expand = (flag: string): string[] => {
    const brace = /^(.*)\{([^{}]*)\}(.*)$/.exec(flag)
    return brace === null ? [flag] : brace[2]!.split(',').map(part => `${brace[1]}${part}${brace[3]}`)
  }
  const expanded = flags.flatMap(expand)
  // A long option may be written by any unique prefix: `--rec`, `--no-pres`.
  if (expanded.some(flag => isLongPrefix(flag, '--no-preserve-root', 3))) return true
  const isRecursive = expanded.some(flag => /^-[a-zA-Z]*[rR]/.test(flag) || isLongPrefix(flag, '--recursive', 3))
  if (!isRecursive) return false
  return args.some(target => {
    if (/^\/+\*?$/.test(target)) return true
    if (/^(~|\$\{?HOME\}?)\/?\*?$/.test(target)) return true
    if (/^(~|\$\{?HOME\}?)/.test(target) && context.home === undefined) return true
    if (isOtherHome(target) || isDefaultedAbsolute(target)) return true
    if (/\$/.test(target.replace(/^\$\{?HOME\}?/, ''))) return false // unknown variable: review decides
    const isContents = /\*$/.test(target)
    const trimmed = target.replace(/\/?\*$/, '')
    const path = resolve(trimmed === '' ? (target.startsWith('/') ? '/' : '.') : trimmed, context.cwd, context.home)
    // The root's contents by glob are review's to judge; the root itself
    // (.git and all) and anything above or beside it are out.
    if (path === context.root) return !isContents
    return !isInside(path, context.root)
  })
}

/** The programs that push refs the way `git push` does, and where their arguments start. */
const pushOf = (part: ShellPart): ParsedPush | undefined => {
  const [program, sub, ...rest] = part.coreWords
  if (program === 'git' && (sub === 'push' || sub === 'send-pack')) return parsePush(rest, { keepEmpty: true })
  if (program === 'hub' && sub === 'push') return parsePush(rest, { keepEmpty: true })
  return undefined
}

/** The checked-out branch when it is known: a detached HEAD (`HEAD`) is not one. */
const knownBranch = (context: CheckContext): string | undefined =>
  context.currentBranch === undefined || context.currentBranch === '' || isCurrentBranchRef(context.currentBranch) ? undefined : context.currentBranch

/**
 * A force push (or a `+` refspec) that overwrites the branch checked out where
 * it runs: it names no refspec at all (`git push -f`, `git push -f origin`), or
 * one that lands on `HEAD`. Which branch that is, only the caller can say
 * (`CheckContext.currentBranch`). `--all`, `--mirror` and `--prune` are not this:
 * the protected-branch check takes them whole.
 */
export function forcesCurrentBranch(part: ShellPart): boolean {
  const push = pushOf(part)
  if (push === undefined || push.isEvery) return false
  if (push.refspecs.length === 0) return push.isForce
  return push.refspecs.some(spec => isCurrentBranchRef(spec.destination) && (push.isForce || spec.isPlus))
}

/** A word the shell fills in at run time: a variable, a command substitution or a backtick. */
const isComputed = (word: string): boolean => /[$`]/.test(word)

/**
 * A force push or a delete whose remote or destination is computed
 * (`"$(git branch --show-current)"`, `HEAD:$B`, `$REF`): what it overwrites
 * cannot be shown to be unprotected.
 */
function forcesComputedBranch(part: ShellPart): boolean {
  const push = pushOf(part)
  if (push === undefined || push.isEvery) return false
  if (!push.isForce && !push.isDelete && !push.refspecs.some(spec => spec.isPlus || spec.source === '')) return false
  return (push.remote !== undefined && isComputed(push.remote)) || push.refspecs.some(spec => isComputed(spec.destination))
}

/** A force push (or a delete) naming a protected branch, or of every branch, or of a protected branch that is checked out. */
function forcePushProtected(part: ShellPart, context: CheckContext): boolean {
  const push = pushOf(part)
  if (push === undefined) return false
  // --mirror force-overwrites every ref and deletes refs the local lacks;
  // --prune deletes remote branches with no local match. Either can destroy a
  // protected branch, with or without an explicit force flag.
  if (push.isEvery) return true
  const isProtectedName = (name: string): boolean => context.protectedBranches.some(branch => branch.test(name))
  const isNamed = push.refspecs.some(spec => {
    const isDestructive = push.isForce || push.isDelete || spec.isPlus || spec.source === ''
    if (!isDestructive) return false
    // A glob destination (refs/heads/*) can land on a protected branch.
    if (/[*?]/.test(spec.destination)) return true
    return isProtectedName(spec.destination)
  })
  if (isNamed) return true
  const branch = knownBranch(context)
  return branch !== undefined && forcesCurrentBranch(part) && isProtectedName(branch)
}

/**
 * A force push of the checked-out branch whose name could not be determined
 * (it was not read, or an earlier part of the call may have moved HEAD), or a
 * force push whose destination is computed: what it would overwrite is unknown.
 */
function forcePushUnknownBranch(part: ShellPart, context: CheckContext): boolean {
  if (forcesComputedBranch(part)) return true
  return forcesCurrentBranch(part) && (knownBranch(context) === undefined || context.isHeadMoved === true)
}

// Subcommands of git that switch or rewrite the branch checked out, or that may (an alias the tool cannot see through).
const HEAD_MOVING_GIT: ReadonlySet<string> = new Set([
  'checkout', 'switch', 'symbolic-ref', 'reset', 'rebase', 'merge', 'pull', 'worktree', 'bisect', 'update-ref', 'filter-branch', 'filter-repo', 'submodule',
])
// Subcommands known to leave the checked-out branch alone. Any other word may be an alias for one that moves it.
const HEAD_STAYING_GIT: ReadonlySet<string> = new Set([
  'add', 'commit', 'status', 'diff', 'log', 'show', 'fetch', 'push', 'tag', 'remote', 'config', 'rev-parse', 'ls-files', 'ls-remote', 'ls-tree',
  'blame', 'grep', 'describe', 'shortlog', 'reflog', 'rm', 'mv', 'clean', 'gc', 'prune', 'fsck', 'cat-file', 'for-each-ref', 'show-ref', 'help',
  'version', 'archive', 'bundle', 'notes', 'format-patch', 'apply', 'diff-tree', 'diff-index', 'merge-base', 'name-rev', 'rev-list', 'whatchanged',
  'send-pack', 'clone', 'init', 'cherry-pick', 'revert', 'am', 'restore', 'read-tree', 'count-objects', 'check-ignore', 'lfs', 'subtree', 'hash-object', 'verify-commit', 'verify-tag', 'maintenance', 'sparse-checkout',
])
// Programs that run code this tool does not read: interpreters, shells and the like.
const RUNS_UNSEEN_CODE =
  /^(python\d*(\.\d+)?|pypy3?|node(js)?|deno|bun|ruby|perl|php|lua\d*(\.\d+)?|luajit|Rscript|R|julia|bash|sh|zsh|dash|ksh|fish|csh|tcsh|ash|eval|source|\.|xargs|parallel|ts-node|tsx)$/
const DYNAMIC_PROGRAM = /^(?![A-Za-z_]\w*\[[^\]]*\]\+?=)\S*(\$|\x60|\{[^\s{}]*,[^\s{}]*\}|[*?]|\[[^\s[\]]+\])/

/**
 * A part that can switch the branch checked out, or that runs something this
 * tool cannot read (an unresolved wrapper, a program known only at run time, an
 * interpreter or a script by its path): after it, the branch read before the
 * call may no longer be the current one.
 */
export function mayMoveHead(part: ShellPart): boolean {
  if (part.isUnresolved === true) return true
  const [program, sub, ...rest] = part.coreWords
  if (program === undefined) return false
  if (program === 'git') {
    if (sub === undefined) return false
    if (HEAD_MOVING_GIT.has(sub)) return true
    if (sub === 'stash') return ['pop', 'apply', 'branch'].includes(rest[0] ?? '')
    if (sub === 'branch') return rest.some(word => /^-[a-zA-Z]*[mMfF]/.test(word) || word === '--move' || word === '--force')
    return !HEAD_STAYING_GIT.has(sub)
  }
  return DYNAMIC_PROGRAM.test(part.core) || RUNS_UNSEEN_CODE.test(program) || program.includes('/')
}

const RAW_DEVICE = /^\/dev\/(sd|hd|vd|xvd|nvme|disk\d|rdisk|mmcblk|loop|md\d|dm-|mapper\/)/
const DISK_WRITERS = new Set(['mkfs', 'mke2fs', 'mkswap', 'wipefs', 'blkdiscard', 'sgdisk', 'sfdisk', 'dd', 'shred', 'tee', 'cp', 'dd'])

/**
 * Writes directly to a disk device, by a disk tool, a redirect or cp/tee/shred.
 * A target is read as the system reads it: repeated slashes collapsed, `.` and
 * `..` resolved, and a relative one taken from the folder the part runs in.
 */
function rawDiskWrite(part: ShellPart, context: CheckContext): boolean {
  const program = (part.coreWords[0] ?? '').replace(/\..*/, '') // mkfs.ext4 -> mkfs
  const isDevice = (target: string): boolean => RAW_DEVICE.test(resolve(target, context.cwd, context.home))
  const targets = part.coreWords.slice(1).map(word => (word.startsWith('of=') ? word.slice(3) : word))
  const hitsDevice = targets.some(isDevice) || part.redirects.some(r => WRITE_OPS.has(r.op) && isDevice(r.target))
  if (!hitsDevice) return false
  // A redirect to a device is a write whatever the program; otherwise the
  // program must be one that writes its target.
  if (part.redirects.some(r => WRITE_OPS.has(r.op) && isDevice(r.target))) return true
  return DISK_WRITERS.has(program)
}

const DESTRUCTIVE_SQL = /\b(DROP\s+(TABLE|DATABASE|SCHEMA|VIEW|INDEX|COLUMN|USER|ROLE|OWNED)|TRUNCATE(\s+TABLE)?\s)/i

/** DROP or TRUNCATE (or dropdb) where the command names a production-looking target. */
function destructiveSqlProduction(part: ShellPart, context: CheckContext): boolean {
  const text = `${part.text}\n${part.input}`
  const isDestructive = DESTRUCTIVE_SQL.test(text) || part.coreWords[0] === 'dropdb'
  return isDestructive && context.production.some(pattern => pattern.test(text))
}

function privileged(part: ShellPart): boolean {
  return (
    part.wrappers.some(wrapper => PRIVILEGE_WRAPPERS.has(wrapper)) ||
    ['su', 'sudo', 'doas', 'pkexec', 'gosu', 'runuser', 'setpriv', 'run0'].includes(part.coreWords[0] ?? '')
  )
}

const HARMLESS_TARGET = /^\/dev\/(null|stdout|stderr|tty|fd\/\d+)$/
const WRITE_OPS = new Set(['>', '>>', '>|', '&>', '&>>', '<>'])

function redirectWrite(part: ShellPart): boolean {
  return part.redirects.some(({ op, target }) => WRITE_OPS.has(op) && !HARMLESS_TARGET.test(target))
}

const GIT_READONLY_CONFIG = new Set(['--get', '--get-all', '--get-regexp', '--get-urlmatch', '-l', '--list', '--show-origin', '--show-scope'])

/** `git config` writing a value (`.git/config` is a protected path). */
function gitConfigWrite(part: ShellPart): boolean {
  if (part.coreWords[0] !== 'git' || part.coreWords[1] !== 'config') return false
  const rest = part.coreWords.slice(2)
  if (rest.length === 0) return false // bare `git config` prints usage
  return !rest.some(word => GIT_READONLY_CONFIG.has(word))
}

// Config keys whose value is a command or a path to code git will execute.
const DANGEROUS_GIT_KEY = /^(alias\.|core\.(hookspath|sshcommand|pager|editor|fsmonitor|askpass)|credential\.helper|diff\.external|sequence\.editor|uploadpack\.|receive\.|protocol\.|http\.proxy)|\.(textconv|driver|command)$/i

/** The `key` of a `key=value` (or bare key) config token. */
const configKey = (token: string): string => (token.includes('=') ? token.slice(0, token.indexOf('=')) : token).trim()

/** `git -c key=value`, `--config-env`, `--exec-path` or `bisect run` that can run code. */
function gitConfigInjection(part: ShellPart): boolean {
  if (part.coreWords[0] !== 'git') return false
  if (part.coreWords[1] === 'bisect' && part.coreWords[2] === 'run') return true
  for (let i = 0; i < part.words.length; i++) {
    const word = part.words[i] as string
    if (word === 'git') continue
    if (word === '-c' && DANGEROUS_GIT_KEY.test(configKey(part.words[i + 1] ?? ''))) return true
    if (word.startsWith('-c') && word.length > 2 && DANGEROUS_GIT_KEY.test(configKey(word.slice(2)))) return true
    if (word.startsWith('--config-env=') || word.startsWith('--exec-path')) return true
  }
  return false
}

// Environment variables that change what a later program loads or runs.
const DANGEROUS_ENV =
  /^(LD_PRELOAD|LD_LIBRARY_PATH|LD_AUDIT|DYLD_[A-Z_]+|GIT_SSH|GIT_SSH_COMMAND|GIT_CONFIG(_[A-Z]+)?|GIT_EXTERNAL_DIFF|GIT_PROXY_COMMAND|GIT_PAGER|GIT_EDITOR|GIT_SEQUENCE_EDITOR|BASH_ENV|ENV|PERL5OPT|PERL5LIB|RUBYOPT|RUBYLIB|PYTHONSTARTUP|PYTHONPATH|NODE_OPTIONS|PROMPT_COMMAND|PS4)\+?=/

/** A leading assignment of an environment variable that can run arbitrary code. */
function dangerousEnvAssignment(part: ShellPart): boolean {
  return part.words.some(word => DANGEROUS_ENV.test(word))
}

/**
 * How an interpreter reads its options, enough to find the script word. A
 * single-dash cluster is read letter by letter where `letters` is given (the
 * first letter that takes a value ends it); otherwise a word is one option.
 */
type InterpreterSpec = {
  /** Options that take a value: the next word, unless written `--name=value`. */
  values: ReadonlySet<string>
  /** Options that take none. */
  flags: ReadonlySet<string>
  /** Long options (without a value) matched by pattern: families too many to list. */
  flagRe?: RegExp
  /** Options after which nothing is read from stdin: code of their own (the inline rule's), a module, a version, help. */
  stop: ReadonlySet<string>
  /** Cluster letters: `flag` take nothing, `value` take the rest of the word or the next word, `glued` take the rest of the word, `stop` as `stop`. */
  letters?: { flag: string; value: string; glued: string; stop: string }
  /** Every option not listed is a flag (the way these were always read). Off: an option not listed makes the call reviewed. */
  isOpen?: boolean
}

const wordSet = (list: string): ReadonlySet<string> => new Set(list.split(/\s+/).filter(word => word !== ''))
const interpreter = (spec: Partial<{ [K in keyof InterpreterSpec]: InterpreterSpec[K] | string }>): InterpreterSpec => ({
  values: wordSet((spec.values as string | undefined) ?? ''),
  flags: wordSet((spec.flags as string | undefined) ?? ''),
  stop: wordSet((spec.stop as string | undefined) ?? ''),
  ...(spec.flagRe !== undefined && { flagRe: spec.flagRe as RegExp }),
  ...(spec.letters !== undefined && { letters: spec.letters as InterpreterSpec['letters'] }),
  ...(spec.isOpen === true && { isOpen: true }),
})

const PYTHON = interpreter({
  values: '--check-hash-based-pycs',
  stop: '--version --help --help-env --help-xoptions --help-all',
  letters: { flag: 'bBdEiIOqsSuvxRP', value: 'WX', glued: '', stop: 'cmVh?' },
})
const PERL = interpreter({
  stop: '--version --help',
  letters: { flag: 'acfglnpsStTuUwWX0123456789', value: 'I', glued: 'MmFCixdD', stop: 'eEvVh?' },
})
const RUBY = interpreter({
  values: '--encoding --external-encoding --internal-encoding',
  stop: '--version --help --copyright',
  flagRe: /^--(?:disable|enable|jit|yjit|rjit|dump|verbose|yydebug|backtrace-limit|debug|crash-report|parser)(?:-[\w-]+)?$/,
  letters: { flag: 'acdlnpsSwyZ0123456789', value: 'CEIr', glued: 'xFiWKT', stop: 'evh?' },
})
const PHP = interpreter({
  stop: '--ini --version --help --info --modules',
  flagRe: /^--r[a-z]+$/,
  letters: { flag: 'anqeHC', value: 'cdtzS', glued: '', stop: 'rBREFfilmvhsw?' },
})
const NODE = interpreter({
  values:
    '-r --require --import --loader --experimental-loader --env-file --env-file-if-exists --title --max-old-space-size -C --conditions --input-type --stack-size ' +
    '--inspect-port --icu-data-dir --openssl-config --redirect-warnings --report-dir --cpu-prof-dir --heap-prof-dir --disable-warning --watch-path ' +
    '--test-name-pattern --test-reporter --test-reporter-destination --trace-event-categories --diagnostic-dir --dns-result-order --max-http-header-size ' +
    '--secure-heap --secure-heap-min --unhandled-rejections --experimental-default-type --localstorage-file',
  flags: '-i --interactive --test --watch --no-warnings --no-deprecation --enable-source-maps --expose-gc --harmony --jitless --check',
  stop: '-v --version -h --help -c --check -e --eval -p --print -pe -ep',
  flagRe:
    /^--(?:no-)?(?:experimental|trace|enable|disable|abort-on|expose|use|harmony|report|insecure|openssl|tls|force|frozen|preserve|interpreted|prof|cpu-prof|heap-prof|pending|throw|warnings|deprecation|watch|test|inspect|verify|node|zero|stack|network|global|addons|async|extra|require|entry)[\w-]*$/,
})
// Subcommand-first runtimes: an option before the subcommand was always read as a flag.
const SUBCOMMAND_RUNTIME = interpreter({ stop: '-v --version -V -h --help -e --eval -p --print', isOpen: true })
const LUA = interpreter({ values: '-l -W', flags: '-i -E', stop: '-v -e' })
const R = interpreter({
  values: '--gui -g --encoding --arch',
  flags: '--vanilla --no-save --no-restore --no-restore-data --no-restore-history --no-environ --no-site-file --no-init-file --slave --silent --quiet -q --interactive --verbose --restore --save',
  stop: '-e -f --file --version --help -h',
})
const RSCRIPT = interpreter({
  flags: '--verbose --vanilla --no-save --no-restore --slave --default-packages',
  stop: '-e --version --help',
})
const OSASCRIPT = interpreter({ values: '-l -s', flags: '-i', stop: '-e' })
const TCL = interpreter({ values: '-encoding -display -geometry -name -visual -use -colormap', flags: '-sync' })
const JULIA = interpreter({
  values: '-J --sysimage -C --cpu-target -p --procs -L --load -t --threads',
  flags: '-q --quiet -i --interactive --banner',
  stop: '-e -E --eval --print -h --help -v --version',
})
const RUBY_REPL = interpreter({
  values: '-r -I -E --encoding --prompt',
  flags: '-f -d -w -W --noecho --echo --simple-prompt --noprompt --readline --noreadline --verbose --noverbose --multiline --nomultiline',
  stop: '-v --version -h --help',
})
const GENERIC = (values: string, flags: string, stop: string): InterpreterSpec => interpreter({ values, flags, stop })

const INTERPRETERS: readonly [RegExp, InterpreterSpec][] = [
  [/^(?:python\d*(?:\.\d+)?|pypy3?)$/, PYTHON],
  [/^perl$/, PERL],
  [/^ruby$/, RUBY],
  [/^php$/, PHP],
  [/^(?:node(?:js)?|ts-node|tsx)$/, NODE],
  [/^(?:deno|bun)$/, SUBCOMMAND_RUNTIME],
  [/^(?:lua\d*(?:\.\d+)?|luajit)$/, LUA],
  [/^R$/, R],
  [/^Rscript$/, RSCRIPT],
  [/^osascript$/, OSASCRIPT],
  [/^(?:tclsh|wish)\d*(?:\.\d+)?$/, TCL],
  [/^julia$/, JULIA],
  [/^(?:irb|pry)$/, RUBY_REPL],
  [/^(?:ghci|runghc|runhaskell)$/, GENERIC('', '-ignore-dot-ghci -v0 -Wall', '-e --version --help')],
  [/^(?:elixir|iex)$/, GENERIC('-r -pr -pa -pz --erl --sname --name --cookie -S', '--no-halt --hidden --werl', '-e --eval -v --version')],
  [/^erl$/, GENERIC('-pa -pz -sname -name -setcookie -boot -config -s -run -args_file -env -mode', '-noshell -noinput -detached -hidden', '-eval -version')],
  [/^(?:scala|groovy)$/, GENERIC('-cp -classpath --classpath -howtorun -savecompiled -D', '-nc -nobootcp -n -p -a', '-e --version -v -h --help')],
  [/^jshell$/, GENERIC('--class-path -cp --module-path -p --add-modules --add-exports --feedback --startup', '-q -s -v --no-startup', '--version -h --help')],
  [/^(?:racket)$/, GENERIC('', '-i -n', '-e -f -t -l -r -u -k -m --version -h --help')],
  [/^guile$/, GENERIC('-L -C -l -e -x', '--no-auto-compile -q', '-c -s --version -h --help')],
  [/^sbcl$/, GENERIC('--core --dynamic-space-size --control-stack-size --tls-limit --userinit --sysinit --load', '--noinform --disable-debugger --non-interactive --no-userinit --no-sysinit --noprint --end-toplevel-options --end-runtime-options', '--script --eval --version --help')],
  [/^clisp$/, GENERIC('-i -l -M -B -m -t -w -E -K', '-q -ansi -traditional -on-error', '-x -c --version -h --help')],
]

const STDIN_SCRIPT = /^(?:\/dev\/stdin|\/dev\/fd\/\d+|\/proc\/[^/]+\/fd\/\d+|<\(\.\.\.\))$/
const isStdinScript = (word: string): boolean => STDIN_SCRIPT.test(word.startsWith('/') ? normalize(word) : word)

/** How one option word reads: it ends the search (`stop`), is a flag, takes the next word (`value`), or is not known. */
function readInterpreterOption(spec: InterpreterSpec, word: string): 'stop' | 'flag' | 'value' | 'unknown' {
  if (spec.stop.has(word)) return 'stop'
  if (spec.values.has(word)) return 'value'
  if (spec.flags.has(word)) return 'flag'
  if (word.startsWith('--')) {
    const eq = word.indexOf('=')
    const name = eq < 0 ? word : word.slice(0, eq)
    if (spec.stop.has(name)) return 'stop'
    if (spec.values.has(name)) return eq < 0 ? 'value' : 'flag'
    if (spec.flags.has(name) || spec.flagRe?.test(name) === true || eq >= 0 || spec.isOpen === true) return 'flag'
    return 'unknown'
  }
  const letters = spec.letters
  if (letters !== undefined) {
    for (let c = 1; c < word.length; c++) {
      const letter = word[c] as string
      if (letters.stop.includes(letter)) return 'stop'
      if (letters.glued.includes(letter)) return 'flag'
      if (letters.value.includes(letter)) return c === word.length - 1 ? 'value' : 'flag'
      if (!letters.flag.includes(letter)) return 'unknown'
    }
    return 'flag'
  }
  return spec.isOpen === true || word.includes('=') ? 'flag' : 'unknown'
}

/** `awk -f -`, `sed -f -`, `make -f -`: the program or the makefile is read from stdin. */
function programFromStdin(program: string, args: readonly string[]): boolean {
  if (!/^(?:[gmn]?awk|sed|g?make)$/.test(program)) return false
  const isStdin = (word: string | undefined): boolean => word === '-' || (word !== undefined && isStdinScript(word))
  return args.some((word, index) => {
    if (/^(?:-[a-zA-Z]*f|--file|--makefile)$/.test(word)) return isStdin(args[index + 1])
    const glued = /^(?:-[a-zA-Z]*f|--file=|--makefile=)(.+)$/.exec(word)
    return glued !== null && isStdin(glued[1])
  })
}

/**
 * An interpreter given no script, module or code flag while its standard input
 * is a pipe, a heredoc, a here-string or a redirect: it runs what it is fed.
 * So does one whose script word is stdin itself (`/dev/stdin`, `/dev/fd/N`) or a
 * process substitution. An option the table does not know may take a value, so
 * what follows it is not known to be a script: that is read as code too. (`-c`,
 * `-e` and an explicit `-` are the inline-code rule's.)
 */
function interpreterStdin(part: ShellPart): boolean {
  const [program, ...args] = part.coreWords
  if (program === undefined) return false
  if (programFromStdin(program, args)) return true
  const spec = INTERPRETERS.find(([name]) => name.test(program))?.[1]
  if (spec === undefined) return false
  const hasStdin =
    part.isPiped ||
    part.input !== '' ||
    part.redirects.some(({ op, target }) => (op === '<' && target !== '/dev/null') || op === '<>' || (op === '<&' && target !== '-'))
  let script: string | undefined
  for (let i = 0; i < args.length; i++) {
    const word = args[i] as string
    if (word === '--') {
      script = args[i + 1]
      break
    }
    if (!word.startsWith('-') || word === '-') {
      script = word // a script, a module, a subcommand
      break
    }
    const read = readInterpreterOption(spec, word)
    if (read === 'stop') return false
    if (read === 'unknown') return hasStdin
    if (read === 'value') i++
  }
  return script === undefined ? hasStdin : isStdinScript(script)
}

/** The program of a Claude Code command line: `claude` at any path, or the npm package that holds it. */
const isClaudeProgram = (program: string | undefined): boolean =>
  program !== undefined && /^(?:(?:.*\/)?claude(?:\.exe)?|@anthropic-ai\/claude-code(?:@\S*)?)$/.test(program)

// Options that start a session of its own or change what runs in it: a nested Claude Code can be started without this protection.
const CLAUDE_SESSION_OPTIONS: ReadonlySet<string> = new Set([
  '--print', '--bare', '--settings', '--setting-sources', '--plugin-dir', '--dangerously-skip-permissions', '--allow-dangerously-skip-permissions',
  '--permission-mode', '--mcp-config',
])
const CLAUDE_CONFIG_ACTIONS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['mcp', new Set(['add', 'remove', 'add-json', 'add-from-claude-desktop', 'reset-project-choices'])],
  ['config', new Set(['set', 'add', 'remove', 'delete'])],
])

/**
 * A Claude Code command that starts a session of its own (`-p`, `--bare`,
 * `--settings`, `--plugin-dir`, a permission bypass), that has `CLAUDE_*`
 * variables set for it, or that changes its MCP servers or configuration.
 */
function claudeSession(part: ShellPart): boolean {
  const [program, ...args] = part.coreWords
  if (!isClaudeProgram(program)) return false
  if (part.words.slice(0, part.words.length - part.coreWords.length).some(word => /^CLAUDE\w*\+?=/.test(word))) return true
  const end = args.indexOf('--')
  const own = end < 0 ? args : args.slice(0, end)
  return own.some((word, index) => {
    if (word.startsWith('--')) return CLAUDE_SESSION_OPTIONS.has(word.includes('=') ? word.slice(0, word.indexOf('=')) : word)
    if (/^-[a-zA-Z]*p[a-zA-Z]*$/.test(word)) return true
    return CLAUDE_CONFIG_ACTIONS.get(word)?.has(own[index + 1] ?? '') === true
  })
}

/** `tar` and `unzip` told to put what they extract in a folder outside the project, or in one the shell fills in. */
function extractOutsideRepo(part: ShellPart, context: CheckContext): boolean {
  const [program, ...args] = part.coreWords
  if (program === undefined) return false
  const isOutside = (dir: string): boolean => {
    if (/[$`]/.test(dir)) return true
    const path = resolve(dir, context.cwd, context.home)
    return path !== context.root && !isInside(path, context.root)
  }
  if (program === 'unzip') {
    // `-d dir`, `-ddir`, `-od dir`: the first letter that takes a value ends the cluster.
    return args.some((word, index) => {
      if (!/^-[a-zA-Z]+/.test(word) || word.startsWith('--')) return false
      const at = word.indexOf('d', 1)
      if (at < 0) return false
      const glued = word.slice(at + 1)
      return isOutside(glued !== '' ? glued : (args[index + 1] ?? ''))
    })
  }
  if (!/^(?:tar|gtar|bsdtar)$/.test(program)) return false
  let isExtract = false
  const dirs: string[] = []
  // Letters that take a value: the rest of the word, or the next word. Old-style
  // (`tar xCf dir a.tar`) takes them from the following words, in order.
  const queue: string[] = []
  for (let i = 0; i < args.length; i++) {
    const word = args[i] as string
    if (word === '--extract' || word === '--get') isExtract = true
    else if (word === '--directory') dirs.push(args[++i] ?? '')
    else if (word.startsWith('--directory=')) dirs.push(word.slice('--directory='.length))
    else if (word.startsWith('--')) continue
    else if (word.startsWith('-') && word !== '-') {
      for (let c = 1; c < word.length; c++) {
        const letter = word[c] as string
        if (letter === 'x') isExtract = true
        if (!'CfTXIL'.includes(letter)) continue
        const rest = word.slice(c + 1)
        const value = rest !== '' ? rest : (args[++i] ?? '')
        if (letter === 'C') dirs.push(value)
        break
      }
    } else if (i === 0) {
      for (const letter of word) {
        if (letter === 'x') isExtract = true
        if ('CfTXIL'.includes(letter)) queue.push(letter)
      }
    } else if (queue.length > 0) {
      if (queue.shift() === 'C') dirs.push(word)
    }
  }
  return isExtract && dirs.some(isOutside)
}

/** A part that hands a command line to another program in a form that could not be read. */
const unreadableCommand = (part: ShellPart): boolean => part.isUnreadable === true

/** A part that types or pastes into another terminal. */
const terminalInput = (part: ShellPart): boolean => part.isTerminalInput === true

export function runCheck(check: CheckName, part: ShellPart, context: CheckContext): boolean {
  switch (check) {
    case 'rm-outside-repo':
      return rmOutsideRepo(part, context)
    case 'force-push-protected':
      return forcePushProtected(part, context)
    case 'force-push-unknown-branch':
      return forcePushUnknownBranch(part, context)
    case 'destructive-sql-production':
      return destructiveSqlProduction(part, context)
    case 'privileged':
      return privileged(part)
    case 'redirect-write':
      return redirectWrite(part)
    case 'git-config-write':
      return gitConfigWrite(part)
    case 'git-config-injection':
      return gitConfigInjection(part)
    case 'dangerous-env-assignment':
      return dangerousEnvAssignment(part)
    case 'raw-disk-write':
      return rawDiskWrite(part, context)
    case 'interpreter-stdin':
      return interpreterStdin(part)
    case 'claude-session':
      return claudeSession(part)
    case 'unreadable-command':
      return unreadableCommand(part)
    case 'terminal-input':
      return terminalInput(part)
    case 'extract-outside-repo':
      return extractOutsideRepo(part, context)
  }
}
