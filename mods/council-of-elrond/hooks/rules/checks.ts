import type { CheckName } from '../config/types.js'
import { isInside, resolve } from './paths.js'
import type { ShellPart } from './shell.js'

export type CheckContext = {
  /** The project root, absolute. */
  root: string
  /** The session's working directory, absolute. */
  cwd: string
  /** $HOME, when known. */
  home?: string
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
  const isRecursive = flags.some(flag => /^-[a-zA-Z]*[rR]/.test(flag) || flag === '--recursive')
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

const OPTIONS_WITH_ARG = new Set(['--repo', '-o', '--push-option', '--receive-pack', '--exec'])

/** A force push (or a delete) naming a protected branch, or of every branch. */
function forcePushProtected(part: ShellPart, context: CheckContext): boolean {
  const [git, push, ...rest] = part.coreWords
  if (git !== 'git' || push !== 'push') return false
  let isForce = false
  let isDelete = false
  let isEvery = false
  const positional: string[] = []
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i] as string
    if (OPTIONS_WITH_ARG.has(word)) {
      i++
    } else if (word === '--force' || word === '-f' || word.startsWith('--force-with-lease') || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(word)) {
      isForce = true
    } else if (word === '--delete' || word === '-d') {
      isDelete = true
    } else if (word === '--mirror' || word === '--all' || word === '--prune') {
      isEvery = true
    } else if (!word.startsWith('-')) {
      positional.push(word)
    }
  }
  const refspecs = positional.slice(1)
  if ((isForce || isDelete) && isEvery) return true
  return refspecs.some(spec => {
    const isPlus = spec.startsWith('+')
    const bare = isPlus ? spec.slice(1) : spec
    const isEmptySource = bare.startsWith(':')
    const destination = (bare.includes(':') ? bare.slice(bare.indexOf(':') + 1) : bare).replace(/^refs\/heads\//, '')
    const isDestructive = isForce || isDelete || isPlus || isEmptySource
    return isDestructive && context.protectedBranches.some(branch => branch.test(destination))
  })
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
    part.wrappers.some(wrapper => wrapper === 'sudo' || wrapper === 'doas') ||
    ['su', 'sudo', 'doas', 'pkexec'].includes(part.coreWords[0] ?? '')
  )
}

const HARMLESS_TARGET = /^\/dev\/(null|stdout|stderr|tty|fd\/\d+)$/
const WRITE_OPS = new Set(['>', '>>', '>|', '&>', '&>>', '<>'])

function redirectWrite(part: ShellPart): boolean {
  return part.redirects.some(({ op, target }) => WRITE_OPS.has(op) && !HARMLESS_TARGET.test(target))
}

export function runCheck(check: CheckName, part: ShellPart, context: CheckContext): boolean {
  switch (check) {
    case 'rm-outside-repo':
      return rmOutsideRepo(part, context)
    case 'force-push-protected':
      return forcePushProtected(part, context)
    case 'destructive-sql-production':
      return destructiveSqlProduction(part, context)
    case 'privileged':
      return privileged(part)
    case 'redirect-write':
      return redirectWrite(part)
  }
}
