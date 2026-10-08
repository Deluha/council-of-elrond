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
    command: String.raw`^(sed|perl|ruby)\s(.*\s)?(-[a-zA-Z]*i[a-zA-Z]*|--in-place)(\S*)(\s|$)`,
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
    command: String.raw`^git\s(push|merge|rebase|reset|tag|filter-branch|filter-repo|cherry-pick|revert|update-ref|replace)(\s|$)|^git\scommit\s(.*\s)?--amend(\s|$)`,
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
    command: String.raw`^git\s(clean|restore|worktree\sremove)(\s|$)|^git\sstash\s(drop|clear)(\s|$)|^git\sbranch\s(.*\s)?-[a-zA-Z]*D[a-zA-Z]*(\s|$)|^git\sbranch\s(.*\s)?(--delete|-d)\s(.*\s)?(--force|-f)(\s|$)|^git\scheckout\s(.*\s)?(--|-f|--force|\.)(\s|$)|^git\sgc\s(.*\s)?--prune|^git\sreflog\s(expire|delete)(\s|$)`,
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
    command: String.raw`^(terraform|tofu)\s(apply|destroy|import|taint|state\s(rm|mv|push))|^kubectl\s(delete|apply|replace|patch|scale|drain|cordon|rollout\sundo|set)|^helm\s(install|upgrade|uninstall|delete|rollback)|^docker\s((container|image|volume|network|system|builder)\s)?(rm|rmi|prune)|^docker[\s-]compose\s(.*\s)?down|^(aws|gcloud|az)\s.*\s(delete|remove|rm|destroy|terminate)`,
    reason: 'Changes or deletes infrastructure.',
  },
  {
    id: 'network-write',
    tier: 'review',
    tools: SHELL,
    command: String.raw`^curl\s(.*\s)?(-X\s?(POST|PUT|PATCH|DELETE)|--request\s(POST|PUT|PATCH|DELETE)|-d|--data(-\w+)?|-F|--form|-T|--upload-file)(\s|$|=)|^wget\s(.*\s)?--(post|method|body)`,
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
    command: String.raw`^(npm|pnpm|yarn)\s(.*\s)?publish(\s|$)|^cargo\spublish|^twine\supload|^gem\spush|^gh\s(release\s(create|delete|upload)|repo\s(delete|archive|edit)|pr\smerge|api\s.*-X\s?(POST|PUT|PATCH|DELETE))`,
    reason: 'Publishes or changes something outside this machine.',
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
    command: String.raw`^(python\d*(\.\d+)?|node|nodejs|deno|bun|ruby|perl|php|lua|Rscript|osascript|pwsh|powershell)\s(.*\s)?(-c|-e|--eval|-p|--print|-r|-|-Command)(\s|$)`,
    reason: 'Runs inline code.',
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

export const SHIPPED: Config = {
  schemaVersion: 1,
  rules: [...BLOCK, ...ASK, ...REVIEW],
  disableRules: [],
  protectedPaths: [
    '**/.env',
    '**/.env.*',
    '.github/workflows/**',
    '.gitlab-ci.yml',
    '.circleci/**',
    '.buildkite/**',
    '**/Jenkinsfile',
    '**/migrations/**',
    'db/migrate/**',
    '.git/**',
    '.claude/council-of-elrond/**',
    '.claude/settings.json',
    '.claude/settings.local.json',
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
