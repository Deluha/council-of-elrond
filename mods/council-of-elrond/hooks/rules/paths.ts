/**
 * POSIX path arithmetic without the file system: `..` and `.` resolved as
 * text. Symbolic links are the caller's to resolve (`$.fs.stat` realPath).
 */

export function normalize(path: string): string {
  const isAbsolute = path.startsWith('/')
  const out: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop()
      else if (!isAbsolute) out.push('..')
    } else {
      out.push(segment)
    }
  }
  const joined = out.join('/')
  return isAbsolute ? `/${joined}` : joined === '' ? '.' : joined
}

/** `path` made absolute against `base`, with `~` expanded when `home` is known. */
export function resolve(path: string, base: string, home?: string): string {
  let expanded = path
  if (home !== undefined) {
    if (expanded === '~') expanded = home
    else if (expanded.startsWith('~/')) expanded = `${home}${expanded.slice(1)}`
    expanded = expanded.replace(/^\$\{?HOME\}?(?=\/|$)/, home)
  }
  return normalize(expanded.startsWith('/') ? expanded : `${base}/${expanded}`)
}

/** True when `path` is strictly inside `root`. */
export const isInside = (path: string, root: string): boolean =>
  path.startsWith(root.endsWith('/') ? root : `${root}/`)

/** `path` relative to `root`, or undefined when it is not inside it. */
export function relativeTo(path: string, root: string): string | undefined {
  if (path === root) return '.'
  return isInside(path, root) ? path.slice(root.replace(/\/$/, '').length + 1) : undefined
}
