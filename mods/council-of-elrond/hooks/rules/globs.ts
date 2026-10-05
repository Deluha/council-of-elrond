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

/**
 * A tool-name matcher: an exact name, a glob with `*`, or `/source/flags`.
 * Throws on a regex that does not compile.
 */
export function toolMatcher(pattern: string): (tool: string) => boolean {
  const regex = /^\/(.+)\/([a-z]*)$/.exec(pattern)
  if (regex !== null) {
    const compiled = new RegExp(regex[1] as string, regex[2])
    return tool => compiled.test(tool)
  }
  if (pattern.includes('*')) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
    const compiled = new RegExp(`^${escaped}$`)
    return tool => compiled.test(tool)
  }
  return tool => tool === pattern
}
