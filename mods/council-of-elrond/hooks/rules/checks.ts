import type { CheckName } from '../config/types.js'
import { isInside, resolve } from './paths.js'
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

/** A recursive rm whose target is `/`, home, or outside the project. */
function rmOutsideRepo(part: ShellPart, context: CheckContext): boolean {
  if (part.coreWords[0] !== 'rm') return false
  const { flags, args } = flagsAndArgs(part.coreWords.slice(1))
  if (flags.includes('--no-preserve-root')) return true
  // Brace expansion in a flag: `-{r,f}` is `-r -f`, `--{recursive,force}` is
  // `--recursive --force`.
  const expand = (flag: string): string[] => {
    const brace = /^(.*)\{([^{}]*)\}(.*)$/.exec(flag)
    return brace === null ? [flag] : brace[2]!.split(',').map(part => `${brace[1]}${part}${brace[3]}`)
  }
  const expanded = flags.flatMap(expand)
  const isRecursive = expanded.some(flag => /^-[a-zA-Z]*[rR]/.test(flag) || flag === '--recursive')
  if (!isRecursive) return false
  return args.some(target => {
    if (/^\/+\*?$/.test(target)) return true
    if (/^(~|\$\{?HOME\}?)\/?\*?$/.test(target)) return true
    if (/^(~|\$\{?HOME\}?)/.test(target) && context.home === undefined) return true
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

const pushOf = (part: ShellPart): ParsedPush | undefined => {
  const [git, push, ...rest] = part.coreWords
  return git === 'git' && push === 'push' ? parsePush(rest, { keepEmpty: true }) : undefined
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

/** A force push of the checked-out branch whose name the caller could not determine: what it would overwrite is unknown. */
function forcePushUnknownBranch(part: ShellPart, context: CheckContext): boolean {
  return forcesCurrentBranch(part) && knownBranch(context) === undefined
}

const RAW_DEVICE = /^\/dev\/(sd|hd|vd|xvd|nvme|disk\d|rdisk|mmcblk|loop|md\d|dm-|mapper\/)/
const DISK_WRITERS = new Set(['mkfs', 'mke2fs', 'mkswap', 'wipefs', 'blkdiscard', 'sgdisk', 'sfdisk', 'dd', 'shred', 'tee', 'cp', 'dd'])

/** Writes directly to a disk device, by a disk tool, a redirect or cp/tee/shred. */
function rawDiskWrite(part: ShellPart): boolean {
  const program = (part.coreWords[0] ?? '').replace(/\..*/, '') // mkfs.ext4 -> mkfs
  const targets = [
    ...part.coreWords.slice(1).map(word => (word.startsWith('of=') ? word.slice(3) : word)),
    ...part.redirects.filter(r => WRITE_OPS.has(r.op)).map(r => r.target),
  ]
  const hitsDevice = targets.some(target => RAW_DEVICE.test(target))
  if (!hitsDevice) return false
  // A redirect to a device is a write whatever the program; otherwise the
  // program must be one that writes its target.
  if (part.redirects.some(r => WRITE_OPS.has(r.op) && RAW_DEVICE.test(r.target))) return true
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

const STDIN_INTERPRETER = /^(python\d*(\.\d+)?|node(js)?|deno|bun|perl|ruby|php|Rscript|lua)$/
// Options of these interpreters that take the next word, which is not a script.
const INTERPRETER_VALUE_OPTIONS = new Set(['-W', '-X', '-I', '-r', '-R', '-C', '-l', '--require', '--import', '--loader', '--experimental-loader', '--conditions'])
// Options after which stdin is data or nothing is run: a module, a version, help.
const INTERPRETER_NO_STDIN_CODE = new Set(['-m', '-V', '--version', '-h', '--help', '-?'])

/**
 * An interpreter given no script, module or code flag while its standard input
 * is a pipe, a heredoc, a here-string or a redirect: it runs what it is fed.
 * (`-c`, `-e` and an explicit `-` are the inline-code rule's.)
 */
function interpreterStdin(part: ShellPart): boolean {
  const [program, ...args] = part.coreWords
  if (program === undefined || !STDIN_INTERPRETER.test(program)) return false
  const hasStdin =
    part.isPiped || part.input !== '' || part.redirects.some(({ op, target }) => op === '<' && target !== '/dev/null')
  if (!hasStdin) return false
  for (let i = 0; i < args.length; i++) {
    const word = args[i] as string
    if (word === '--') return args[i + 1] === undefined
    if (!word.startsWith('-') || word === '-') return false // a script, a module, a subcommand
    if (INTERPRETER_NO_STDIN_CODE.has(word) || (word === '-v' && !program.startsWith('python'))) return false
    if (INTERPRETER_VALUE_OPTIONS.has(word)) i++
  }
  return true
}

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
      return rawDiskWrite(part)
    case 'interpreter-stdin':
      return interpreterStdin(part)
  }
}
