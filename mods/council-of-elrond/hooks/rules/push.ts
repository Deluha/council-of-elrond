/**
 * The one reading of `git push` arguments, shared by the force-push check
 * (rules/checks.ts), the operation keys (elrond/operations.ts) and the
 * preview and range diff (members/galadriel.ts), so they never disagree about
 * what a push names. Pure; the words are the ones after `push`.
 */

/** Options of `git push` that take the next word as their value. */
export const PUSH_OPTIONS_WITH_ARG: ReadonlySet<string> = new Set(['--repo', '-o', '--push-option', '--receive-pack', '--exec'])

/** One refspec, split into what is pushed and where it lands. */
export type PushRefspec = {
  /** `+` marks a forced refspec. */
  isPlus: boolean
  /** What is pushed: a ref, `HEAD`, a tag; empty for a delete (`:name`). A bare name is its own source. */
  source: string
  /** The remote ref it lands on, with `refs/heads/` dropped: a bare name lands on itself. */
  destination: string
}

export type ParsedPush = {
  /** A force flag in any form: `--force`, `-f` (also clustered), `--force-with-lease[=...]`, `--force-if-includes`. */
  isForce: boolean
  isDelete: boolean
  /** `--all`, `--mirror` or `--prune`: more than the refspecs name. */
  isEvery: boolean
  /** The first positional word; absent when the push names none. */
  remote?: string
  /** Every positional word after the remote, in order. */
  refspecs: readonly PushRefspec[]
}

const isForceFlag = (word: string): boolean => word === '--force' || word.startsWith('--force-') || /^-[a-zA-Z0-9]*f[a-zA-Z0-9]*$/.test(word)

/**
 * The long options of `git push` (and `send-pack`), as git resolves a written
 * name: the exact name, else the one it is a unique prefix of. The value of a
 * name in `LONG_WITH_ARG` is the next word unless it is written `--name=value`.
 */
const PUSH_LONG: readonly string[] = [
  'all', 'branches', 'prune', 'mirror', 'delete', 'tags', 'follow-tags', 'signed', 'atomic', 'push-option', 'receive-pack', 'exec', 'repo',
  'dry-run', 'porcelain', 'thin', 'force', 'force-with-lease', 'force-if-includes', 'set-upstream', 'progress', 'verbose', 'quiet', 'verify',
  'recurse-submodules', 'ipv4', 'ipv6',
]
const LONG_WITH_ARG: ReadonlySet<string> = new Set(['push-option', 'receive-pack', 'exec', 'repo'])
/** What each destructive long option does; a prefix several of them share does all of it (git refuses it, so nothing runs). */
const LONG_EFFECT: Readonly<Record<string, 'force' | 'delete' | 'every'>> = {
  force: 'force',
  'force-with-lease': 'force',
  'force-if-includes': 'force',
  delete: 'delete',
  all: 'every',
  branches: 'every',
  mirror: 'every',
  prune: 'every',
}

type LongReading = { effects: ReadonlySet<'force' | 'delete' | 'every'>; takesNext: boolean }

/** A `--name[=value]` word read the way git reads it: by its exact name or any prefix of it. */
function readLong(word: string): LongReading {
  const eq = word.indexOf('=')
  const typed = (eq < 0 ? word : word.slice(0, eq)).slice(2)
  const effects = new Set<'force' | 'delete' | 'every'>()
  if (typed.length === 0 || typed.startsWith('no-')) return { effects, takesNext: false }
  const exact = PUSH_LONG.includes(typed)
  const candidates = exact ? [typed] : PUSH_LONG.filter(name => name.startsWith(typed))
  for (const name of candidates) {
    const effect = LONG_EFFECT[name]
    if (effect !== undefined) effects.add(effect)
  }
  return { effects, takesNext: eq < 0 && candidates.length === 1 && LONG_WITH_ARG.has(candidates[0] as string) }
}

function refspecOf(text: string): PushRefspec {
  const isPlus = text.startsWith('+')
  const bare = isPlus ? text.slice(1) : text
  const colon = bare.indexOf(':')
  const source = colon === -1 ? bare : bare.slice(0, colon)
  const destination = (colon === -1 ? bare : bare.slice(colon + 1)).replace(/^\+/, '').replace(/^refs\/heads\//, '')
  return { isPlus, source, destination }
}

/**
 * `git push [options] [remote] [refspec...]` from the words after `push`.
 * An empty word is dropped, as the operation key and the preview always did;
 * the force-push check keeps it (`keepEmpty`), as it always did, so an empty
 * word still takes the remote's place and the refspecs after it stay refspecs.
 */
export function parsePush(words: readonly string[], options: { keepEmpty?: boolean } = {}): ParsedPush {
  let isForce = false
  let isDelete = false
  let isEvery = false
  const positional: string[] = []
  for (let i = 0; i < words.length; i++) {
    const word = words[i] as string
    if (PUSH_OPTIONS_WITH_ARG.has(word)) {
      i++ // `-o ci.skip`: the value is not the remote or a refspec
    } else if (word.startsWith('--') && word.length > 2) {
      // A long option by any unique prefix (`--del`, `--mir`, `--forc`), as git resolves it.
      const read = readLong(word)
      if (isForceFlag(word) || read.effects.has('force')) isForce = true
      if (read.effects.has('delete')) isDelete = true
      if (read.effects.has('every')) isEvery = true
      if (read.takesNext) i++
    } else if (word.startsWith('-') && word !== '-' && word !== '--') {
      // A short cluster, letter by letter: `f` forces, `d` deletes, and `o` takes
      // a value (glued, or the next word when it is the last letter). Digits (`-4`) and other letters change nothing.
      if (isForceFlag(word)) isForce = true
      if (/^-[a-zA-Z0-9]*d/.test(word)) isDelete = true
      if (word.endsWith('o') && /^-[a-zA-Z0-9]+$/.test(word)) i++
    } else if ((word !== '' || options.keepEmpty === true) && !word.startsWith('-')) {
      positional.push(word)
    }
  }
  const [remote, ...refspecs] = positional
  return { isForce, isDelete, isEvery, ...(remote !== undefined && { remote }), refspecs: refspecs.map(refspecOf) }
}

/** `HEAD` and its alias `@`: the branch checked out where the push runs. */
export const isCurrentBranchRef = (name: string): boolean => name === 'HEAD' || name === '@'
