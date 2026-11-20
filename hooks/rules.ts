/**
 * The rules: plain patterns over a call's command or file path. No shell
 * parser, on purpose: this catches honest mistakes, and anyone who wants past
 * a pattern can get past it. Claude Code's own permissions are the boundary.
 *
 * To add a rule, add a line to RULES and a case to tests/council.test.ts.
 */

export type Member = 'gandalf' | 'aragorn' | 'legolas' | 'gimli'

/** `block` is refused outright; `council` goes to the rule's member for review. */
export type Tier = 'block' | 'council'

export type Rule = {
  id: string
  tier: Tier
  member: Member
  /** What the pattern reads: a shell command's text, or a written file's path. */
  on: 'command' | 'path'
  pattern: RegExp
  why: string
}

/** One simple command: everything up to the next `;`, `&`, `|` or newline. */
const SEG = String.raw`[^;&|\n]*`
const git = (rest: string, flags = ''): RegExp => new RegExp(String.raw`\bgit\b${SEG}${rest}`, flags)
const RECURSIVE = String.raw`\s(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)(?=\s|$)`
const ROOT_OR_HOME = String.raw`\s["']?(?:\/|~|\$HOME|\$\{HOME\})\/?\*?["']?(?=\s|$|[;&|])`

export const RULES: readonly Rule[] = [
  // Block: no review, no override.
  { id: 'rm-root', tier: 'block', member: 'gandalf', on: 'command', pattern: new RegExp(String.raw`\brm\b(?=${SEG}${RECURSIVE})${SEG}${ROOT_OR_HOME}`), why: 'Recursive delete of the filesystem root or the home folder.' },
  { id: 'disk-write', tier: 'block', member: 'gandalf', on: 'command', pattern: /\bmkfs(\.\w+)?\b|\bdd\b[^;&|\n]*\bof=\/dev\/(sd|nvme|hd|disk)|>\s*\/dev\/(sd|nvme|hd)/, why: 'Writes straight to a disk device.' },
  { id: 'fork-bomb', tier: 'block', member: 'gandalf', on: 'command', pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, why: 'A fork bomb.' },
  { id: 'force-push-main', tier: 'block', member: 'aragorn', on: 'command', pattern: git(String.raw`\bpush\b(?=${SEG}(?:--force(?!-with-lease)|\s-f\b|\s\+\S))${SEG}\b(?:main|master)\b`), why: 'Force push to main.' },
  { id: 'credentials-path', tier: 'block', member: 'legolas', on: 'path', pattern: /(^|\/)(\.ssh|\.gnupg)\/|(^|\/)\.aws\/credentials$/, why: 'Writes into a credentials folder.' },
  { id: 'git-internals', tier: 'block', member: 'legolas', on: 'path', pattern: /(^|\/)\.git\/(config|HEAD|index|objects|refs|packed-refs)(\/|$)/, why: "Writes into git's own files." },

  // Gandalf: destructive operations.
  { id: 'rm-recursive', tier: 'council', member: 'gandalf', on: 'command', pattern: new RegExp(String.raw`\brm\b${SEG}${RECURSIVE}`), why: 'Recursive delete.' },
  { id: 'find-delete', tier: 'council', member: 'gandalf', on: 'command', pattern: /\bfind\b[^;&\n]*(\s-delete\b|\brm\b)/, why: 'Deletes whatever a find matches.' },
  { id: 'git-clean', tier: 'council', member: 'gandalf', on: 'command', pattern: git(String.raw`\bclean\b${SEG}\s-[a-zA-Z]*f`), why: 'Deletes untracked files.' },
  { id: 'pipe-to-shell', tier: 'council', member: 'gandalf', on: 'command', pattern: /\b(curl|wget)\b[^;&\n]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/, why: 'Runs a downloaded script.' },
  { id: 'sudo', tier: 'council', member: 'gandalf', on: 'command', pattern: /\bsudo\s/, why: 'Runs as root.' },
  { id: 'chmod-recursive', tier: 'council', member: 'gandalf', on: 'command', pattern: /\bch(mod|own)\b[^;&|\n]*\s-[a-zA-Z]*R/, why: 'Changes permissions or owners recursively.' },

  // Aragorn: git history.
  { id: 'force-push', tier: 'council', member: 'aragorn', on: 'command', pattern: git(String.raw`\bpush\b${SEG}(?:--force|\s-f\b|\s\+\S)`), why: 'Force push.' },
  { id: 'push-main', tier: 'council', member: 'aragorn', on: 'command', pattern: git(String.raw`\bpush\b${SEG}\b(?:main|master)\b`), why: 'One does not simply push to main.' },
  { id: 'push-delete', tier: 'council', member: 'aragorn', on: 'command', pattern: git(String.raw`\bpush\b${SEG}(?:--delete\b|\s:\S)`), why: 'Deletes a remote branch.' },
  { id: 'reset-hard', tier: 'council', member: 'aragorn', on: 'command', pattern: git(String.raw`\breset\b${SEG}--hard\b`), why: 'Discards uncommitted work.' },
  { id: 'discard-all', tier: 'council', member: 'aragorn', on: 'command', pattern: git(String.raw`\b(?:checkout|restore)\b${SEG}\s\.(?=\s|$)`), why: 'Discards every uncommitted change.' },
  { id: 'stash-drop', tier: 'council', member: 'aragorn', on: 'command', pattern: git(String.raw`\bstash\s+(?:drop|clear)\b`), why: 'Throws stashed work away.' },
  { id: 'branch-delete', tier: 'council', member: 'aragorn', on: 'command', pattern: git(String.raw`\bbranch\b${SEG}\s(?:-D\b|--delete\s+--force\b)`), why: 'Force-deletes a branch.' },
  { id: 'rewrite-history', tier: 'council', member: 'aragorn', on: 'command', pattern: git(String.raw`\b(?:filter-branch|filter-repo|reflog\s+expire)\b`), why: 'Rewrites or expires history.' },
  { id: 'no-verify', tier: 'council', member: 'aragorn', on: 'command', pattern: git(String.raw`\b(?:commit|push|merge)\b${SEG}--no-verify\b`), why: "Skips the repository's own hooks." },

  // Gimli: data, infrastructure and releases.
  { id: 'sql-drop', tier: 'council', member: 'gimli', on: 'command', pattern: /\b(drop\s+(table|database|schema)|truncate\s+table)\b/i, why: 'Drops or truncates data.' },
  { id: 'sql-delete-all', tier: 'council', member: 'gimli', on: 'command', pattern: /\bdelete\s+from\s+[\w.]+\s*(;|["']|$)/i, why: 'A DELETE with no WHERE.' },
  { id: 'terraform', tier: 'council', member: 'gimli', on: 'command', pattern: /\bterraform\b[^;&|\n]*\b(destroy|apply)\b/, why: 'Changes real infrastructure.' },
  { id: 'kubectl-delete', tier: 'council', member: 'gimli', on: 'command', pattern: /\b(kubectl\b[^;&|\n]*\b(delete|drain)|helm\b[^;&|\n]*\b(uninstall|delete))\b/, why: 'Removes things from a cluster.' },
  { id: 'docker-prune', tier: 'council', member: 'gimli', on: 'command', pattern: /\bdocker\b[^;&|\n]*\b(system\s+prune|volume\s+(rm|prune))\b/, why: 'Deletes containers, images or volumes.' },
  { id: 'cloud-delete', tier: 'council', member: 'gimli', on: 'command', pattern: /\b(aws|gcloud|az)\s[^;&|\n]*\b(delete\S*|terminate\S*|destroy|rb)\b/, why: 'Deletes cloud resources.' },
  { id: 'publish', tier: 'council', member: 'gimli', on: 'command', pattern: /\b((npm|pnpm|yarn|cargo)\b[^;&|\n]*\bpublish|twine\s+upload|gh\s+release\s+create)\b/, why: 'Publishes a release; that cannot be taken back.' },

  // Legolas: files worth a second look.
  { id: 'env-file', tier: 'council', member: 'legolas', on: 'path', pattern: /(^|\/)\.env(\.(?!example$|sample$|template$)[\w.-]+)?$/, why: 'An environment file, usually holding secrets.' },
  { id: 'ci-config', tier: 'council', member: 'legolas', on: 'path', pattern: /(^|\/)(\.github\/workflows\/|\.gitlab-ci\.yml$|\.circleci\/)/, why: 'CI configuration: it runs with the repository’s secrets.' },
  { id: 'key-file', tier: 'council', member: 'legolas', on: 'path', pattern: /\.(pem|key|p12|pfx)$/, why: 'A key file.' },
  { id: 'git-hooks', tier: 'council', member: 'legolas', on: 'path', pattern: /(^|\/)(\.git\/hooks|\.husky)\//, why: 'A git hook: it runs on every commit.' },
  { id: 'shell-profile', tier: 'council', member: 'legolas', on: 'path', pattern: /(^|\/)\.(bashrc|zshrc|profile|bash_profile|zprofile)$/, why: 'A shell profile: it runs in every new shell.' },
]

/** The parts of a call the rules and the secrets scan read, whatever the tool. */
export type Call = { tool: string; command?: string; path?: string; written?: string }

const stringOf = (input: Record<string, unknown>, ...keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return undefined
}

/** Reads a tool call's input by field name, so Bash, PowerShell, Write, Edit and NotebookEdit need no table. */
export const callOf = (input: Record<string, unknown>): Call => {
  const call: Call = { tool: String(input.tool) }
  const command = stringOf(input, 'command')
  const path = stringOf(input, 'file_path', 'notebook_path')
  const written = stringOf(input, 'content', 'new_string', 'new_source')
  if (command !== undefined) call.command = command
  if (path !== undefined) call.path = path
  if (written !== undefined) call.written = written
  return call
}

/** A rule made from a pattern the user set in the mod's options; undefined when it is empty or does not compile. */
export const customRule = (tier: Tier, source: unknown): Rule | undefined => {
  if (typeof source !== 'string' || source.trim() === '') return undefined
  try {
    return { id: `custom-${tier}`, tier, member: 'gandalf', on: 'command', pattern: new RegExp(source), why: 'Matches a pattern from your settings.' }
  } catch {
    return undefined
  }
}

/** The rule that decides a call: the first block rule that matches, else the first council rule, else none. */
export const classify = (call: Call, extra: readonly Rule[] = []): Rule | undefined => {
  const matches = [...extra, ...RULES].filter(rule => {
    const subject = rule.on === 'command' ? call.command : call.path
    return subject !== undefined && rule.pattern.test(subject)
  })
  return matches.find(rule => rule.tier === 'block') ?? matches[0]
}

/** Gollum's hoard: token shapes that are secrets with near certainty. */
const SECRETS: readonly (readonly [string, RegExp])[] = [
  ['an AWS access key', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['a GitHub token', /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/],
  ['a GitLab token', /\bglpat-[A-Za-z0-9_-]{20,}/],
  ['an Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['an OpenAI API key', /\bsk-(proj-)?[A-Za-z0-9]{40,}\b/],
  ['a Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ['a Stripe live key', /\b[sr]k_live_[A-Za-z0-9]{20,}/],
  ['a Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['an npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
]

/** What kind of secret a call would run or write, if any. */
export const secretIn = (call: Call): string | undefined => {
  const text = `${call.command ?? ''}\n${call.written ?? ''}`
  return SECRETS.find(([, pattern]) => pattern.test(text))?.[0]
}
