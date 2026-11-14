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

const isForceFlag = (word: string): boolean => word === '--force' || word.startsWith('--force-') || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(word)

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
    } else if (isForceFlag(word)) {
      isForce = true
    } else if (word === '--delete' || word === '-d') {
      isDelete = true
    } else if (word === '--mirror' || word === '--all' || word === '--prune') {
      isEvery = true
    } else if ((word !== '' || options.keepEmpty === true) && !word.startsWith('-')) {
      positional.push(word)
    }
  }
  const [remote, ...refspecs] = positional
  return { isForce, isDelete, isEvery, ...(remote !== undefined && { remote }), refspecs: refspecs.map(refspecOf) }
}

/** `HEAD` and its alias `@`: the branch checked out where the push runs. */
export const isCurrentBranchRef = (name: string): boolean => name === 'HEAD' || name === '@'
