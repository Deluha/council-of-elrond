/**
 * Globs over `/`-separated paths: `**` any depth, `*` within one segment,
 * `?` one character. Anchored at both ends.
 */
export function globToRegExp(glob: string): RegExp {
  let source = ''
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i] as string
    if (char === '*') {
      if (glob[i + 1] === '*') {
        const isSegment = glob[i + 2] === '/'
        source += isSegment ? '(?:.*/)?' : '.*'
        i += isSegment ? 2 : 1
      } else {
        source += '[^/]*'
      }
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${source}$`)
}

export type ProtectedMatcher = {
  glob: string
  /** Matches a file path the glob covers (case-insensitive: macOS, Windows). */
  re: RegExp
  /** The literal directory prefix before the first wildcard, or '' if none. */
  prefix: string
  /** A concrete path the glob matches, to test a candidate glob against. */
  sample: string
}

/**
 * How a protected-path glob is matched against a candidate path. Beyond the
 * files the glob covers, it protects the directory itself and its ancestors
 * (deleting `.git` removes `.git/config`), and it is case-insensitive so a
 * different letter case on a case-insensitive file system cannot slip past.
 */
export function protectedMatcher(glob: string): ProtectedMatcher {
  const firstWild = glob.search(/[*?{[]/)
  const head = firstWild < 0 ? glob : glob.slice(0, firstWild)
  const prefix = head.includes('/') ? head.slice(0, head.lastIndexOf('/')) : ''
  const sample = glob
    .replace(/\*\*\//g, '')
    .replace(/\*\*/g, 'x')
    .replace(/[*?]/g, 'x')
    .replace(/\{([^,}]*)[^}]*\}/g, '$1')
    .replace(/\[[^\]]*\]/g, 'a')
  return { glob, re: new RegExp(globToRegExp(glob).source, 'i'), prefix, sample }
}

/**
 * Whether a candidate path, which may itself be a glob, could touch a
 * protected path: the candidate matches the glob, is the protected directory
 * itself, or is a targeted glob whose language includes a protected file.
 *
 * A candidate with a match-everything segment (`*`, `**`) is not treated as a
 * protected-path hit: `rm -rf *` is a broad operation for review to judge, not
 * an attempt to name a protected file. A targeted glob (`.en*`, `*.env`) is.
 */
export function touchesProtected(candidate: string, matchers: readonly ProtectedMatcher[]): boolean {
  const isTargetedGlob = /[*?{[]/.test(candidate) && !candidate.split('/').some(segment => segment === '*' || segment === '**')
  const candidateRe = isTargetedGlob ? new RegExp(globToRegExp(candidate).source, 'i') : undefined
  return matchers.some(({ re, prefix, sample }) => {
    if (re.test(candidate)) return true
    if (prefix !== '' && candidate === prefix) return true
    if (candidateRe !== undefined && candidateRe.test(sample)) return true
    return false
  })
}

/**
 * A tool-name matcher: an exact name, a glob with `*`, or `/source/flags`.
 * Throws on a regex that does not compile.
 */
export function toolMatcher(pattern: string): (tool: string) => boolean {
  const compiled = slashRegex(pattern)
  if (compiled !== undefined) return tool => compiled.test(tool)
  if (pattern.includes('*')) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
    const compiled = new RegExp(`^${escaped}$`)
    return tool => compiled.test(tool)
  }
  return tool => tool === pattern
}

/**
 * A pattern written `/source/flags` as a RegExp; undefined for anything else.
 * Throws on a regex that does not compile. Stateful flags (`g`, `y`) are
 * refused, since one RegExp is tested again and again.
 */
export function slashRegex(pattern: string): RegExp | undefined {
  const regex = /^\/(.+)\/([a-z]*)$/.exec(pattern)
  if (regex === null) return undefined
  const flags = regex[2] ?? ''
  if (/[gy]/.test(flags)) throw new Error('the g and y flags are not allowed')
  return new RegExp(regex[1] as string, flags)
}
