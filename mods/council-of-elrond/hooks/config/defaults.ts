import type { Config, Rule } from './types.js'

/**
 * The shipped rules. Shell `command` patterns match one part of a compound
 * command at a time, after quotes are removed and wrappers (`sudo`, `env`,
 * `nice`, `timeout`, ...) and leading `NAME=value` assignments are stripped,
 * with git's global options (`-C dir`, `-c k=v`) dropped. They are anchored
 * at the program name.
 *
 * The rules are the safety boundary; the model members are a second opinion.
 */

const SHELL = ['Bash', 'Monitor'] as const
const FILES = ['Write', 'Edit', 'NotebookEdit'] as const

const BLOCK: readonly Rule[] = [
  {
    id: 'rm-recursive-outside-repo',
    tier: 'block',
    tools: SHELL,
    check: 'rm-outside-repo',
    reason:
      'Recursive delete of the filesystem root, the home directory or a path outside the project.',
  },
  {
    id: 'force-push-protected-branch',
    tier: 'block',
    tools: SHELL,
    check: 'force-push-protected',
    reason: 'Force push (or delete) of a protected branch.',
  },
  {
    id: 'destructive-sql-production',
    tier: 'block',
    tools: SHELL,
    check: 'destructive-sql-production',
    reason: 'DROP or TRUNCATE against a target that looks like production.',
  },
  {
    id: 'raw-disk-write',
    tier: 'block',
    tools: SHELL,
    check: 'raw-disk-write',
    reason: 'Writes directly to a disk device.',
  },
]

const ASK: readonly Rule[] = [
  {
    id: 'privileged',
    tier: 'ask',
    tools: SHELL,
    check: 'privileged',
    reason: 'Runs with elevated privileges (sudo, doas, su).',
  },
  {
    id: 'force-push-unknown-branch',
    tier: 'ask',
    tools: SHELL,
    check: 'force-push-unknown-branch',
    reason: 'Force push of the current branch, and the branch it would overwrite could not be determined.',
  },
  {
    id: 'plugin-manage',
    tier: 'ask',
    tools: SHELL,
    // Global options (some with values) may stand before `plugin`, and options
    // before the action; the actions and aliases are the ones the CLI lists.
    command:
      String.raw`^((\S*/)?claude|@anthropic-ai/claude-code(@\S+)?)\s(-\S+\s([^-\s]\S*\s){0,3}){0,12}plugins?\s(-\S+\s([^-\s]\S*\s)?){0,6}` +
      String.raw`((disable|uninstall|remove|rm|update|install|i|enable|prune|autoremove|configure|restore-set-aside|init|new)|marketplace\s(-\S+\s){0,3}(add|remove|rm|update))(\s|$)`,
    reason: 'Installs, updates, enables, disables or removes a Claude Code plugin or marketplace, which can switch off this protection.',
  },
  {
    id: 'claude-session',
    tier: 'ask',
    tools: SHELL,
    check: 'claude-session',
    reason: 'Starts a nested Claude Code session, or changes its MCP servers or configuration, which can run without this protection.',
  },
  {
    id: 'terminal-input',
    tier: 'ask',
    tools: SHELL,
    check: 'terminal-input',
    reason: 'Sends keystrokes or pasted text to another terminal, which can answer a prompt or type a command as the person.',
  },
]

const REVIEW: readonly Rule[] = [
  {
    id: 'sql-file-write',
    tier: 'review',
    tools: FILES,
    path: String.raw`\.sql$`,
    member: 'aragorn',
    profile: 'database',
    reason: 'Writes or edits SQL.',
  },
  {
    id: 'file-write',
    tier: 'review',
    tools: FILES,
    member: 'legolas',
    reason: 'Writes or edits a file.',
  },
  {
    id: 'shell-delete',
    tier: 'review',
    tools: SHELL,
    command: String.raw`^(rm|rmdir|unlink|shred|srm|trash|trash-put|rimraf|del-cli|trash-cli)(\s|$)`,
    reason: 'Deletes files.',
  },
  {
    id: 'shell-find-delete',
    tier: 'review',
    tools: SHELL,
    command: String.raw`^find\s.*\s(-delete|-exec(dir)?\s|-ok(dir)?\s)`,
    reason: 'Finds files and deletes or runs a command on each.',
  },
  {
    id: 'shell-move',
    tier: 'review',
    tools: SHELL,
    command: String.raw`^mv(\s|$)`,
    reason: 'Moves or renames files, which can overwrite.',
  },
  {
    id: 'shell-overwrite-tools',
    tier: 'review',
    tools: SHELL,
    command: String.raw`^(dd|mkfs(\.\w+)?|truncate|wipefs|fdisk|parted|sfdisk)(\s|$)`,
    reason: 'Overwrites or truncates data in place.',
  },
  {
    id: 'shell-recursive-permissions',
    tier: 'review',
    tools: SHELL,
    command: String.raw`^(chmod|chown|chgrp)\s(.*\s)?(-[a-zA-Z]*R[a-zA-Z]*|--recursive)(\s|$)`,
    reason: 'Changes permissions or ownership recursively.',
  },
  {
    id: 'shell-in-place-edit',
    tier: 'review',
    tools: SHELL,
    command: String.raw`^(sed|perl|ruby)\s(.*\s)?(-[a-zA-Z0-9]*i[a-zA-Z0-9]*|--in-place)(\S*)(\s|$)|^[gmn]?awk\s(.*\s)?(-i\s?inplace|--include[ =]inplace)(\s|$)`,
    reason: 'Edits files in place.',
  },
  {
    id: 'shell-redirect-write',
    tier: 'review',
    tools: SHELL,
    check: 'redirect-write',
    reason: 'Writes or overwrites a file through a shell redirect.',
  },
  {
    id: 'shell-tee',
    tier: 'review',
    tools: SHELL,
    command: String.raw`^tee(\s|$)`,
    reason: 'Writes a file with tee.',
  },
  {
    id: 'git-remote-or-history',
    tier: 'review',
    tools: SHELL,
    command: String.raw`^git\s(push|send-pack|merge|rebase|reset|tag|filter-branch|filter-repo|cherry-pick|revert|update-ref|replace)(\s|$)|^git\scommit\s(.*\s)?--amend(\s|$)|^git\s(subtree|lfs)\spush(\s|$)|^hub\spush(\s|$)|^jj\sgit\spush(\s|$)`,
    member: 'aragorn',
    profile: 'git',
    reason: 'Changes a remote or rewrites git history.',
  },
  {
    id: 'git-config-write',
    tier: 'review',
    tools: SHELL,
    check: 'git-config-write',
    member: 'aragorn',
    profile: 'git',
    reason: 'Writes git configuration (.git/config), which can set hooks, a pager or an SSH command that runs code.',
  },
  {
    id: 'git-config-injection',
    tier: 'review',
    tools: SHELL,
    check: 'git-config-injection',
    member: 'aragorn',
    profile: 'git',
    reason: 'Passes git a configuration key, exec-path or bisect command that can run arbitrary code.',
  },
  {
    id: 'dangerous-env-assignment',
    tier: 'review',
    tools: SHELL,
    check: 'dangerous-env-assignment',
    reason: 'Sets an environment variable that changes what a later program loads or runs.',
  },
  {
    id: 'git-discard',
    tier: 'review',
    tools: SHELL,
    command:
      String.raw`^git\s(clean|restore|worktree\sremove)(\s|$)|^git\sstash\s(drop|clear)(\s|$)|^git\sbranch\s(.*\s)?-[a-zA-Z]*D[a-zA-Z]*(\s|$)` +
      String.raw`|^git\sbranch\s(?=(.*\s)?(--delete|-d)(\s|$))(?=(.*\s)?(--force|-f)(\s|$))|^git\sbranch\s(.*\s)?-[a-zA-Z]*(d[a-zA-Z]*f|f[a-zA-Z]*d)[a-zA-Z]*(\s|$)` +
      String.raw`|^git\scheckout\s(.*\s)?(--|-f|--force|\.)(\s|$)|^git\sgc\s(.*\s)?--prune|^git\sreflog\s(expire|delete)(\s|$)` +
      // `git rm` of a tree or by force; `git checkout` of paths (two or more words, none of the forms that switch or create a branch); `git switch` that discards changes.
      String.raw`|^git\srm\s(.*\s)?(-[a-zA-Z]*[rf][a-zA-Z]*|--force|--recursive)(\s|$)` +
      String.raw`|^git\scheckout\s(?!(.*\s)?(-[a-zA-Z]*[bBt][a-zA-Z]*|--orphan|--track|--detach)(\s|$))(-\S+\s)*[^-\s]\S*\s(-\S+\s)*[^-\s]` +
      String.raw`|^git\sswitch\s(.*\s)?(--discard-changes|--force|-[a-zA-Z]*f[a-zA-Z]*)(\s|$)`,
    reason: 'Discards git work that may not be recoverable.',
  },
  {
    id: 'database-client',
    tier: 'review',
    tools: SHELL,
    command: String.raw`^(psql|pg_restore|dropdb|createdb|mysql|mariadb|mysqladmin|sqlite3|mongo|mongosh|mongorestore|redis-cli|cqlsh|sqlcmd|clickhouse(-client)?)(\s|$)`,
    member: 'aragorn',
    profile: 'database',
    reason: 'Runs a database client.',
  },
  {
    id: 'database-migration',
    tier: 'review',
    tools: SHELL,
    command: String.raw`^((npx|bunx|pnpm(\sexec|\sdlx)?|yarn)\s)?(prisma\s(migrate|db\spush|db\sexecute)|knex\smigrate|sequelize(-cli)?\sdb:|typeorm\smigration|drizzle-kit\s(push|migrate|drop)|alembic\s(upgrade|downgrade|stamp)|flyway|liquibase|goose|dbmate|atlas\s(migrate|schema\sapply)|migrate\s)|^(python\d*(\.\d+)?\s)?(\S*/)?manage\.py\s(migrate|flush|sqlflush|reset_db)|^((bundle\sexec|bin/)\s?)?(rails|rake)\sdb:`,
    member: 'aragorn',
    profile: 'database',
    reason: 'Runs a database migration.',
  },
  {
    id: 'infrastructure',
    tier: 'review',
    tools: SHELL,
    command: String.raw`^(terraform|tofu)\s(apply|destroy|import|taint|state\s(rm|mv|push))|^kubectl\s(delete|apply|replace|patch|scale|drain|cordon|rollout\sundo|set)|^helm\s(install|upgrade|uninstall|delete|rollback)|^docker\s((container|image|volume|network|system|builder)\s)?(rm|rmi|prune)|^docker[\s-]compose\s(.*\s)?down|^(aws|gcloud|az)\s.*\s(delete|remove|rm|destroy|terminate|rb(\s|$)|--delete(\s|$))|^gsutil\s(.*\s)?(rm|rb)(\s|$)|^gsutil\s(.*\s)?rsync\s(.*\s)?-[a-zA-Z]*d|^pulumi\s(destroy|up|refresh|cancel|stack\s(rm|remove))(\s|$)`,
    reason: 'Changes or deletes infrastructure.',
  },
  {
    id: 'network-write',
    tier: 'review',
    tools: SHELL,
    command:
      // curl: a short cluster of flags that ends in -d, -F or -T (the value glued or not; a letter that takes a value, such as -u, ends the cluster), a long data option, or a method other than GET given with -X or --request.
      String.raw`^curl\s(.*\s)?(-[0-46aBfgGhiIjJklLMnNOpqRsSvVZ#:]*X\s?(?!(GET|HEAD|OPTIONS)(\s|$))\S|--request[\s=](?!(GET|HEAD|OPTIONS)(\s|$))\S|-[0-46aBfgGhiIjJklLMnNOpqRsSvVZ#:]*[dFT]|--(data|form|json|url-query|upload-file)(-\w+)?)` +
      String.raw`|^wget\s(.*\s)?--(po|me|bo)` +
      // HTTPie: a method other than GET, or a `key=value` or `key:=json` item.
      String.raw`|^(https?|xhs?)\s(.*\s)?((?!(GET|HEAD|OPTIONS)(\s|$))[A-Z]{3,10}(\s|$)|[A-Za-z0-9_][\w.\[\]-]*(:=|=)([^=\s]|$))`,
    reason: 'Sends data to a remote service.',
  },
  {
    id: 'remote-copy',
    tier: 'review',
    tools: SHELL,
    command: String.raw`^(scp|sftp)(\s|$)|^rsync\s(.*\s)?--(delete\S*|remove-source-files)(\s|$)`,
    reason: 'Copies to another machine, or syncs with deletion.',
  },
  {
    id: 'publish',
    tier: 'review',
    tools: SHELL,
    command: String.raw`^(npm|pnpm|yarn)\s(.*\s)?publish(\s|$)|^cargo\spublish|^twine\supload|^gem\spush|^gh\s(release\s(create|delete|edit|upload)|repo\s(delete|archive|edit|rename)|pr\s(merge|close|create)|issue\s(close|delete|create|comment)|secret\s(set|delete|remove)|variable\s(set|delete)|workflow\s(run|enable|disable)|run\s(rerun|cancel|delete)|auth\s(?!status(\s|$))|auth\sstatus\s(.*\s)?(-t|--show-token)(\s|$)|api\s(.*\s)?(-X\s?(?!GET(\s|$))\S|--method[\s=](?!GET(\s|$))\S|-[fF]|--(field|raw-field|input)))`,
    reason: 'Publishes or changes something outside this machine.',
  },
  {
    id: 'command-unreadable',
    tier: 'review',
    tools: SHELL,
    check: 'unreadable-command',
    reason: 'Hands a command line to another program in a form this tool cannot read (key sequences, a file of commands), so the command is not known.',
  },
  {
    id: 'extract-outside-project',
    tier: 'review',
    tools: SHELL,
    check: 'extract-outside-repo',
    reason: 'Extracts an archive into a folder outside the project (or one only known at run time), which can overwrite files there.',
  },
  {
    id: 'script-shell',
    tier: 'review',
    tools: SHELL,
    command: String.raw`^(bash|sh|zsh|dash|ksh|fish|csh|tcsh)(\s|$)`,
    reason: 'Runs a shell script, inline shell code or code piped into a shell.',
  },
  {
    id: 'script-inline',
    tier: 'review',
    tools: SHELL,
    // The first branch is a code flag anywhere in the arguments; the others
    // are the attached and clustered forms (`-c'code'`, `-Bc`, `-ne`, `-pe`,
    // `--eval=code`), read only among the options before the script.
    command:
      String.raw`^(python\d*(\.\d+)?|pypy3?|node|nodejs|deno|bun|ruby|perl|php|lua\d*(\.\d+)?|luajit|Rscript|osascript|pwsh|powershell)\s(.*\s)?(-c|-e|--eval|-p|--print|-r|-|-Command)(\s|$)` +
      String.raw`|^(python\d*(\.\d+)?|pypy3?)\s(-[WX]\s\S+\s|-\S+\s)*-[A-Za-z]*c\S*(\s|$)` +
      String.raw`|^(node|nodejs)\s(-\S+\s)*(-[chiv]*[ep]\S*|--(eval|print)=\S*)(\s|$)` +
      String.raw`|^perl\s(-I\s\S+\s|-\S+\s)*-[acdfhilnpsStTuUwWxX0-9]*[eE]\S*(\s|$)` +
      String.raw`|^ruby\s(-I\s\S+\s|-\S+\s)*-[acdFhilnpsSvwWx0-9]*e\S*(\s|$)` +
      String.raw`|^php\s(-\S+\s)*-[aehilmnqsvwBEHR]*r\S*(\s|$)|^php\s(-\S+\s)*-[a-zA-Z]*[BREF]\S*(\s|$)` +
      // More runtimes and their eval flags; `deno eval`; PowerShell's command, file and encoded-command options (any case, any abbreviation).
      String.raw`|^(R|julia|elixir|iex|erl|scala|groovy|racket|guile|sbcl|clisp|ghci|ghc|runghc|irb|pry|ts-node|tsx)\s(.*\s)?(-c|-e|-E|-x|-eval|--eval)(\s|$)|^deno\seval(\s|$)` +
      String.raw`|^(pwsh|powershell)(\.exe)?\s(.*\s)?-+[eEcCfF]\S*(\s|$)` +
      // A module that runs the code it is given.
      String.raw`|^(python\d*(\.\d+)?|pypy3?)\s(-\S+\s)*-[A-Za-z]*m\s?(code|asyncio|timeit|pdb|runpy|idlelib|IPython|ptpython|bpython)(\.\S*)?(\s|$)` +
      // awk with a program that runs a command or writes a file (system(), a pipe, getline from a file, print to a file), and a sed script with an `e` or `w` command or flag.
      String.raw`|^[gmn]?awk\s.*(system\s*\(|\bprintf?\b[^;}]{0,200}[>|]|\|&?\s*getline|getline\b[^;}]{0,100}<|@include|@load)` +
      String.raw`|^sed\s(.*[\s;{}!])?s(?<sdelim>[/|#,:@!%])(?:(?!\k<sdelim>).)*\k<sdelim>(?:(?!\k<sdelim>).)*\k<sdelim>[a-zA-Z0-9]*[ew]` +
      String.raw`|^sed\s(.*[\s;{}!])?(\d+|\$)?(,(\d+|\$))?(\/[^/\s]*\/)?[ew](\s|$)`,
    reason: 'Runs inline code.',
  },
  {
    id: 'script-stdin',
    tier: 'review',
    tools: SHELL,
    check: 'interpreter-stdin',
    reason: 'Runs code piped or redirected into an interpreter.',
  },
  {
    id: 'script-file',
    tier: 'review',
    tools: SHELL,
    command: String.raw`^(python\d*(\.\d+)?|node|nodejs|deno(\srun)?|bun(\srun)?|ruby|perl|php|lua|Rscript|ts-node|tsx)\s(-\S+\s)*[^-\s]\S*\.(py|js|mjs|cjs|ts|mts|cts|rb|pl|php|lua|R)(\s|$)`,
    reason: 'Runs a script file.',
  },
  {
    id: 'script-path',
    tier: 'review',
    tools: SHELL,
    command: String.raw`^[^\s/]*/\S*(\s|$)`,
    reason: 'Runs a program or script by its path.',
  },
  {
    id: 'script-eval',
    tier: 'review',
    tools: SHELL,
    command: String.raw`^(eval|source|\.|xargs|parallel)(\s|$)|^psql\s(.*\s)?(-f|--file)(\s|=|$)`,
    reason: 'Evaluates code built at run time or from a file (eval, source, xargs, parallel).',
  },
  {
    id: 'shell-dynamic-program',
    tier: 'review',
    tools: SHELL,
    // The first word, once assignments and wrappers are stripped, holds a
    // variable, a backtick, a brace list or a glob: the shell makes the program
    // at run time. A bare `[` or `[[` (the test) and `name[1]=x` are not that.
    command: String.raw`^(?![A-Za-z_]\w*\[[^\]]*\]\+?=)\S*(\$|\x60|\{[^\s{}]*,[^\s{}]*\}|[*?]|\[[^\s\[\]]+\])`,
    reason: 'The program to run is only known at run time (a variable, a command substitution, a brace list or a glob).',
  },
  {
    // A wrapper or runner whose own options the parser does not know: it reads
    // them as it can, and this sends the whole call to review. Keep in step
    // with the wrapper and runner tables in rules/shell.ts (a test checks the
    // wrapper names).
    id: 'shell-runner-unresolved',
    tier: 'review',
    tools: SHELL,
    command:
      String.raw`^(npm|pnpm|yarn)\s(exec|x|dlx)(\s|$)|^(poetry|pipenv|pdm|rye|hatch|uv|conda|mamba|micromamba|op|doppler)\srun(\s|$)|^(bundle|composer)\sexec(\s|$)|^mise\s(exec|x)(\s|$)` +
      String.raw`|^(npx|bunx|pnpx|uvx)(\s|$)` +
      String.raw`|^(sudo|doas|env|nice|ionice|nohup|time|command|builtin|exec|timeout|stdbuf|unbuffer|caffeinate|chroot|setsid|flock|strace|ltrace|watch|unshare|nsenter|chrt|taskset|numactl)(\s|$)` +
      String.raw`|^(setarch|linux32|linux64|i386|x86_64|uname26|busybox|toybox|fakeroot(-sysv|-tcp|-ng)?|firejail|systemd-run|eatmydata|proxychains4?|xvfb-run|retry)(\s|$)` +
      String.raw`|^(gosu|runuser|setpriv|run0|chpst|pkexec)(\s|$)`,
    reason: 'Runs a command through a wrapper or runner whose options this tool cannot read with certainty, so the command is not known.',
  },
  {
    id: 'remote-exec',
    tier: 'review',
    tools: SHELL,
    command: String.raw`^(ssh|nc|ncat|netcat|telnet)(\s|$)|^rsync\s(.*\s)?(-e|--rsync-path)(\s|=)|^docker\s(.*\s)?(exec|run)(\s|$)|^docker[\s-]compose\s(.*\s)?(exec|run)(\s|$)|^(podman|nerdctl)\s(.*\s)?(exec|run)(\s|$)|^kubectl\s(.*\s)?exec(\s|$)|^(heroku|fly|flyctl)\s(.*\s)?(run|ssh)(\s|$)|^gcloud\s(.*\s)?ssh(\s|$)|^aws\s(.*\s)?(ssm\s(start-session|send-command))`,
    reason: 'Runs a command on another machine or inside a container.',
  },
  {
    id: 'sandbox-disabled',
    tier: 'review',
    tools: ['Bash'],
    input: String.raw`"dangerouslyDisableSandbox":true`,
    reason: 'Runs a command with the sandbox disabled.',
  },
  {
    id: 'mcp-mutating',
    tier: 'review',
    tools: [String.raw`/^mcp__.+__.*(delete|remove|drop|merge|push|write|update|create|send|execute|exec|run|deploy|publish|destroy|purge|truncate|move|rename|upload|post|insert|modify|set)/i`],
    reason: 'Calls an MCP tool whose name says it changes something.',
  },
]

/**
 * Paths whose writes ask but whose plain reads and runs do not: the mod's own
 * installed code must not be rewritten unasked, yet reading a plugin's files
 * and running its scripts is ordinary work. Internal: not a field of the rules
 * file, so a project cannot add to it, lower it or list it (DESIGN §16).
 */
export const WRITE_PROTECTED_PATHS: readonly string[] = ['**/.claude/plugins/**']

export const SHIPPED: Config = {
  schemaVersion: 1,
  rules: [...BLOCK, ...ASK, ...REVIEW],
  disableRules: [],
  protectedPaths: [
    '**/.env',
    '**/.env.*',
    '**/.github/workflows/**',
    '**/.gitlab-ci.yml',
    '**/.circleci/**',
    '**/.buildkite/**',
    '**/Jenkinsfile',
    '**/migrations/**',
    '**/db/migrate/**',
    '**/.git/**',
    '**/.claude/council-of-elrond/**',
    '**/.claude/settings.json',
    '**/.claude/settings.local.json',
  ],
  protectedBranches: ['main', 'master', 'production', 'prod', 'release/*', 'trunk'],
  productionPatterns: [
    String.raw`(^|[^a-z0-9])prod(uction)?([^a-z0-9]|$)`,
    String.raw`(^|[^a-z0-9])live([^a-z0-9]|$)`,
    String.raw`(^|[^a-z0-9])primary([^a-z0-9]|$)`,
  ],
  models: {},
  gollum: { patterns: [], allowlist: [] },
  // A push, a merge into a protected branch, a migration: the full council.
  bigOperations: [String.raw`/^git\s+push(\s|$)/`, 'merge-to-protected', 'database-migration'],
  gimli: { commands: [] },
}

/**
 * The built-in model per slot: the latest Sonnet as the floor, the latest
 * Opus where the stakes are higher. Aliases resolve to the newest model of
 * that family the running Claude Code knows.
 */
export const BUILT_IN_MODELS = {
  gandalf: 'sonnet',
  legolas: 'sonnet',
  aragorn: 'opus',
  council: 'opus',
} as const

/** The project overrides file, relative to the project root. */
export const OVERRIDES_PATH = '.claude/council-of-elrond/rules.json'
