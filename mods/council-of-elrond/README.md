# council-of-elrond

A Claude Code mod that gates risky tool calls before they run. Rules sort every call into a tier.
Calls that need a second opinion go to a model reviewer, and anything uncertain comes to you.

> **The rules tier is the safety boundary.** The model reviewers are a second opinion: they can
> catch what a pattern misses, but they never widen what the rules allow. This is not a sandbox or a
> security product (see [What it does not protect against](#what-it-does-not-protect-against)).

Status: **built through Stage 6, with the final deliverables (SPEC §21–22), the v1 hardening and
cloud work, and the hardening after the November reviews (DESIGN.md §15 and §16). Nothing is tagged yet:**
0.5.0 is a changelog heading, and the work since it is under "Unreleased" in
[CHANGELOG.md](../../CHANGELOG.md), which opens with what changes for someone upgrading from 0.5.0. Available now: the rules; three model reviewers (destructive operations, diffs, and
git and databases) with routing between them; the full council with your project's own checks for
big operations; the secrets scan, read-only previews, review rounds and lockout, the approve cache,
escalation to you, allow rules offered after "allow once", `/council` and `/council report`, shadow
mode and bypass, fail-closed handling and the audit log, the theme (with a plain mode), and the
debate pane, the council check band, the wipe counter, the threat meter and the epic drop. The
hardening after the Stage 5 review ([docs/REVIEW-2026-10.md](../../docs/REVIEW-2026-10.md)) and the
November review ([docs/REVIEW-2026-11.md](../../docs/REVIEW-2026-11.md)) closed most of the rules-tier and
pipeline findings. Some are still open: [ROADMAP.md](./ROADMAP.md) lists them under "Open decisions", and
the gaps in shell parsing that remain are under "Known gaps in shell parsing" below. Headless live checks ran on Claude Code
2.1.294; the interactive screens (the dialogs, the pane, the band, the mode label) still await a
check in a terminal.
See [ROADMAP.md](./ROADMAP.md) for what's left, [SPEC.md](./SPEC.md) for the original spec and
[DESIGN.md](./DESIGN.md) for how it works.

## Your first days: shadow mode

Turn on **shadow mode** while you tune the rules: `/council shadow on` for one session, or "Shadow
mode" in `/config`. Reviewers still run and log their verdicts to the audit log, but they never
refuse. The block tier, the ask tier, protected paths and the secrets scan still enforce. The label
`council: shadow` shows by the prompt while it is on. Until the audit log has a line, a one-time
toast at session start suggests it.

## Loading it

Requires Claude Code 2.1.287 or later (mods are on by default).

- **One session:** `claude --plugin-dir ./mods/council-of-elrond`
- **For good:** `claude plugin marketplace add Deluha/council-of-elrond`, then `claude plugin install council-of-elrond@council-of-elrond`. Other ways, updating and removing: [docs/INSTALL.md](../../docs/INSTALL.md).
- **Where no flag can be given** (desktop app, SDK host): set `CLAUDE_CODE_PLUGIN_DIRS` to the folder's absolute path in the environment or in `~/.claude/settings.json` under `env`.

Check it loaded: `/plugin` shows the mods line, and `claude plugin validate ./mods/council-of-elrond`
lists its hooks.

## Tiers

| Tier | What happens |
| :- | :- |
| allow | Passes untouched, with no model call. Anything no rule matches is allowed. |
| review | A model reviewer gives a verdict: approve runs it, revise or block refuses it. |
| ask | Comes straight to you. |
| block | Refused, with the rule's reason. No model call, no question. |

Compound commands (`&&`, `;`, `|`, `$(...)`, backticks, subshells, `sh -c '...'`, `eval`, heredocs
fed to a shell, and the `$(...)` and backticks in the body of a heredoc with an unquoted delimiter,
which the shell expands) are split, and the strictest part decides. A heredoc with a quoted delimiter
(`<<'EOF'`, `<<"EOF"`, `<<\EOF`) is plain data.

**Classified as the command they run.** A command line handed to another program is read like the
argument of `sh -c`, and each command in it is judged on its own: `script -c`, `su -c`,
`nix-shell --run`, `env -S`, `tmux` (`send-keys`, `run-shell`, `if-shell`, `new-session`, `new-window`,
`split-window`, `respawn-pane`, `respawn-window`, `display-popup`, `pipe-pane`, `set-hook`,
`confirm-before`, `bind-key`, commands joined with `\;`, and a command written by any unique
prefix), `screen`, `zellij`, `nix develop|shell|run`, `git submodule foreach`, `git bisect run`,
`git rebase --exec`, the filters of `git filter-branch`, `find -exec`, `-execdir`, `-ok` and `-okdir`,
`entr` and `parallel`. A key sequence or a command file that cannot be read (several tmux keys typed
at once, `tmux source-file`, `screen -X source`, `zellij action write`) is reviewed instead
(rule `command-unreadable`).

Shipped defaults:

- **Block:**
  - a recursive delete of `/`, your home directory, the project root, or anything outside the project;
  - a force push or delete of a protected branch, including a force push of the branch that is checked
    out when it is a protected one: `git push --force`, `-f`, `-f origin`, `-f origin HEAD` and
    `origin +HEAD` name no branch or only `HEAD`, so the mod reads the checked-out branch (in the
    folder the push runs in, only for such a push) and blocks it when it matches your protected
    branches. On any other branch they stay in review;
  - DROP or TRUNCATE against a production-looking target;
  - raw disk writes;
  - a command that repeats wrapper options or split strings more often than the parser reads
    (`command-too-complex-to-read`): a split string that repeats a wrapper thousands of times, a split
    string or a second reading that holds more commands than the extra readings' budget (400 parts),
    or scripts nested deeper than their 4 levels. Only a crafted command reaches it, and it is refused
    whatever else it holds ("Write the command plainly"). Honest but extreme commands that were
    reviewed are refused too: more than 200 commands inside one `env -S` string or inside the script
    of a command behind ambiguous `nsenter` options, four or more scripts nested inside one of those,
    and four `env -S` strings that each hold a `${NAME}` expansion followed by a nested script (five followed by
    anything), 81 commands of one such string each joined in one call (134 of one string without an expansion); a script behind one plain split string is refused from 199 commands (the previous commit: 399), behind one with an expansion from 99 (previous: 133), two plain strings per command joined from 81 commands, and a script with three nested command substitutions behind one split string is refused (already at the previous commit):
    the extra readings share their depth and their parts with the scripts that follow; write the
    command plainly, or put it in a script file and run that. A command over 200 parts or 4 levels
    deep is reviewed (`command-too-complex`) as before.
- **Ask:**
  - `sudo`, `doas`, `su`;
  - a force push of the current branch when the branch it would overwrite cannot be determined
    (rule `force-push-unknown-branch`): a detached HEAD, git failing or timing out, or git pointed
    elsewhere (`git -C`, `GIT_DIR=`, a `cd` out of the project). It is asked about, not blocked, as
    the branch may well be a feature branch. The same rule asks for a force push whose destination is
    computed (`HEAD:$B`, `"$(git branch --show-current)"`), and for a force push of the current branch
    that follows a command in the same call that can switch it (`git checkout`, `switch`, `reset`
    and the like, a git subcommand the mod does not know, or code it does not read: an interpreter,
    a script by its path, a program named by a variable). A protected branch read before the call
    still blocks. Force and delete flags are read as git reads them (clusters with digits or other
    letters, long options by unique prefix), and `git send-pack` and `hub push` are read like
    `git push`;
  - installing, updating, enabling, disabling or removing a Claude Code plugin or marketplace
    (`claude plugin disable|uninstall|remove|rm|update|install|enable`, `claude plugin marketplace
    add|remove|rm|update`, the CLI's short aliases (`i`, `rm`) and its other management actions, with
    global options before `plugin` or options between the words, through a path to the binary or
    `npx @anthropic-ai/claude-code@<version>`; rule `plugin-manage`). `claude plugin test`, `validate`,
    `list` and `eval` are not asked about;
  - starting a nested Claude Code session, or changing its servers or configuration: `-p`, `--bare`,
    `--settings`, `--setting-sources`, `--plugin-dir`, `--mcp-config`, `--permission-mode`, a permission
    bypass, a `CLAUDE_*` variable set for it, `claude mcp add|remove` (and its other changing actions)
    and `claude config set` (rule `claude-session`);
  - typing or pasting into another terminal (rule `terminal-input`): `tmux send-keys` (`send`), `paste-buffer`, `pipe-pane -I`, `command-prompt`, and `load-buffer` or `set-buffer` in a tmux command line that also pastes or sends; `screen -X stuff`, `paste`, `readbuf`; `zellij action write` and `write-chars`; `kitty @ send-text` and `send-key`; `wezterm cli send-text`; `xdotool type`, `key`, `keydown`; `ydotool type`, `key`; `wtype`; `osascript` with `keystroke`. They can answer a prompt, or type a command, as you. What is typed is still read as before (`tmux send-keys 'rm -rf ~' Enter` blocks); anything else comes to you;
  - anything touching a protected path, wherever it appears in the command: as a word, as the value of a wrapper or runner option (`op run --env-file=.env`, `mise x -C .git`, `uv run --env-file`, `npm exec --userconfig`), after `=` (`dd of=`, `NAME=path`) or glued to an option. `.env*`, `Jenkinsfile`, migrations folders, and the entries below. The entries written with a leading `**/` hold in every repository below the session root, at any depth, the rules file included (`app/.claude/council-of-elrond/rules.json`), and so does the directory itself (`rm -rf app/.git` asks). A path outside the session root is matched by its absolute form, so another repository's `.git/` or your user `~/.claude/settings.json` (which holds hooks and permissions) asks too:
    - `**/.github/workflows/**`, `**/.gitlab-ci.yml`, `**/.circleci/**`, `**/.buildkite/**`;
    - `**/db/migrate/**`;
    - `**/.git/**`;
    - `**/.claude/council-of-elrond/**`, `**/.claude/settings.json`, `**/.claude/settings.local.json`;
  - **a write to your plugin folders.** `**/.claude/plugins/**` covers your user plugin folders (`~/.claude/plugins/`) and, because it is written with `**/`, a `.claude/plugins/` folder in any repository. It is a second, built-in list, for writes only: not a field of the rules file, so a project can neither add to it nor empty it. A file write or edit there asks. A shell command that names a path there asks unless it only reads it or runs what it holds:
    - it reads when its program is one of `cat`, `head`, `tail`, `less`, `more`, `bat`, `ls`, `tree`, `stat`, `file`, `wc`, `du`, `find`, `grep`, `egrep`, `fgrep`, `rg`, `ag`, `diff`, `cmp`, `sort`, `uniq`, `cut`, `jq`, `yq`, `md5sum`, `sha1sum`, `sha256sum`, `shasum`, `realpath`, `readlink`, `basename`, `dirname`, `test`, `[`, `[[`, `cd` and `pushd`, and the path is one of its operands; so is `git -C <path>` followed by `status`, `log`, `diff`, `show`, `rev-parse`, `ls-files`, `branch` (with no argument, or only `--show-current`, `-a`, `-r` or `-v`), `remote` (with no argument, or `-v`), `describe`, `blame` or `cat-file`, with no other global option than `--no-pager` and `--no-optional-locks`, and no option that writes a file or runs a program (`--output`, `--ext-diff`, `--textconv`). Not when an option of it writes (`find -delete`, `-exec`, `-execdir`, `-ok`, `-okdir`, `-fprint*`, `-fls`; `jq --in-place`; `yq -i`, `-s` and `--split-exp`; `sort -o` and `-T`; `tree -o`; `less -o` and `-O`; `file -C`; `uniq` with an output file), when a redirect of the command names the path, when a wrapper or an assignment names it (`time -o`, `X=path cat`), or when a wrapper's option was not read in full (`timeout --weird 5 cat path`); and not when what the reader prints goes on, through a pipe, into a program that is not itself one of these readers (`ls ~/.claude/plugins | xargs rm -rf`, `find ~/.claude/plugins -type f | xargs sed -i …`, `cat path | sh`);
    - it runs when the path is the program (`~/.claude/plugins/x/bin/tool --help`) or the script an interpreter or a shell is given (`python3 ~/.claude/plugins/x/run.py`, `bash ~/.claude/plugins/x/run.sh`), and no code flag or piped code comes with it. The ordinary rules then judge it, so a script is reviewed (`script-file`, `script-shell`, `script-path`) as it was before the folder was protected.

    Every other command that names the folder asks: `cp`, `mv`, `rm`, `tee`, `sed -i`, `ln`, `chmod`, `touch`, `install`, `rsync`, `tar`, `git -C` with any other subcommand, a program the mod does not know, a redirect target. A path that is protected proper (`.env`, `.git`, the settings files, the rules file) asks for any mention, a read included.
- **Review:**
  - file writes and edits;
  - deletes, moves, in-place edits, writes through a redirect;
  - git operations that change a remote or history, or discard work (`git rm` of a tree or by force, `git checkout` of paths, `git switch --discard-changes`, `git branch -df`), and the pushes that are not `git push` itself: `git subtree push`, `git lfs push` and `jj git push`;
  - database clients and migrations;
  - infrastructure changes, including more cloud deletes (`gsutil rm`, `aws s3 rb`, `pulumi destroy`), network writes (a `curl` data option attached or clustered, a method other than GET, `wget` bodies, HTTPie bodies and methods) and publishing, `gh` writes included;
  - `awk` and `sed` programs that run a command or write a file;
  - extracting an archive (`tar -x`, `unzip`) into a folder outside the project, or one only known at run time (rule `extract-outside-project`); other uses of `tar` and `unzip` are not matched;
  - a command line handed to another program in a form that cannot be read: a key sequence of several tmux keys, a command file, an ambiguous tmux command prefix, and the tmux forms that run a command line nobody can read: `set` or `set-option` of `default-command`, `default-shell`, `lock-command`, `status-left` or `status-right`, or of any option whose value holds `#(`; `-f <file>` on the tmux command line; `detach-client -E`; `display-message` with `#(`; `choose-tree`, `choose-buffer` and `choose-client` with a command template (rule `command-unreadable`);
  - running scripts or inline code, including code fed to an interpreter on its standard input (a
    pipe, a heredoc, a here-string or a `<` redirect into `python3`, `node`, `perl`, `ruby`, `php`,
    `deno`, `bun`, `Rscript` or `lua` with no script named; rule `script-stdin`), also when the script
    is `/dev/stdin`, a descriptor path (`/dev/fd/3`), a process substitution or `<&0`, and when an
    option the mod's tables do not know comes before a script on a fed interpreter (it may take the
    script's place). Many more interpreters and their inline-code flags are covered, and a code flag
    is read attached or in a cluster (`python3 -Bc`, `perl -ne`, `node -pe`, `php -r'...'`).
    `python -m` of a module that runs the code it is given (`code`, `asyncio`, `timeit`, `pdb`,
    `runpy`, `idlelib`, `IPython`, `ptpython`, `bpython`) is reviewed;
  - a first word the shell builds at run time, such as a variable, a substitution, a glob, a bracket
    expression or a brace list in the program position (`shell-dynamic-program`; an unquoted `$IFS`
    or `${IFS}` is read as a space first, and a flat literal brace list is read as the command it
    expands to);
  - a command run through a wrapper or runner that has an option the mod's tables do not list: it
    cannot be read with certainty, so the call is reviewed (`shell-runner-unresolved`);
  - Bash with the sandbox disabled;
  - MCP tools whose names say they change something.

**Approve never pre-approves.** An approved call still goes through Claude Code's normal permission
check and prompt. The mod never takes part in the permission decision.

**Subagents are gated too.** A subagent's tool calls go through the same pipeline as the main
conversation's, and their audit lines carry the subagent's `agentId` (checked live on Claude Code
2.1.294, with the subagent in the background and in the foreground).

## Reviewers

A review-tier call goes to exactly one model reviewer, the one its rule names (`member` and
`profile` in a rule), unless it is a big operation (see [The full council](#the-full-council)).
Each reviewer has a short checklist of its own and sees only what that checklist needs.

| Reviewer | Takes | Sees | Checks |
| :- | :- | :- | :- |
| Destructive operations (Gandalf, `gandalf`) | deletes, moves, overwrites, scripts, infrastructure, anything no rule names | the call, the preview, scripts Claude wrote this session | reversibility, width, reach, backups, intent |
| Diffs (Legolas, `legolas`) | Write, Edit, NotebookEdit | a diff built from the call against the file as it stands (cut to the diff line limit, keeping both ends), the file's git status | matches the request, scope creep, weakened tests, disabled checks, dependency/CI/config changes, obvious breakage. No style review. |
| Git (Aragorn, `aragorn`, profile `git`) | push, merge, rebase, reset, tag, amend and other history changes | the command, the branch, remote and commits it would send or bring in, recent history with remote branches marked, your protected branches | protected target, force, rewriting pushed history, unrelated commits |
| Database (Aragorn, `aragorn`, profile `database`) | SQL clients, migrations, `.sql` files | the command, SQL from `-c`/`-e`/heredocs, `.sql` files it names inside the project, or a SQL file's diff; which production patterns match | rollback path, destructive DDL, UPDATE/DELETE without WHERE, production-looking target, transactions, long locks |

**Gandalf is the fallback.** A call goes to Gandalf when its rule names nobody, when the named
reviewer is switched off, when a compound command's parts name different reviewers (one specialist
would judge only its own part), or when a rule names the diff reviewer for something with no file.
If Gandalf is off too, the call comes to you. `/council test "<command>"` shows who would review and
why.

### Long input

A reviewer reads a limited amount of each part of a call (the command, the preview, a script, SQL, a
diff, your latest message). Text over the limit is cut in the middle: a reviewer sees the start and
the end, with one line between them saying how many lines and characters were left out, and a note
from the council, outside the quoted material, repeats how much. Its instructions say that what was
left out has not been seen and is not to be assumed safe: it approves only when what it can see and
the nature of the call make the rest low-risk, and otherwise asks for the change in smaller pieces
(a revise). A line that looks like that marker, in a command or a file, is only text: the note is
what counts.

- **A command too long to read is never approved by a model alone.** When the command of a shell
  call is longer than its reviewer reads (200 lines or 12,000 characters, and 40 lines or 4,000
  characters for the push or merge a diff reviewer quotes), a reviewer's approve does not let it
  run: the call comes to you ("The command was too long to review in full"), as a call with no
  verdict does, or is refused where nobody can be asked. A revise or a block stands as it is, and
  the approve is not remembered. This is about the command text; a long file or diff is not held
  back, and its reviewer is told.
- **A script or SQL file it runs is held to the same rule.** A script the call runs (written through
  a file tool this session) or a `.sql` file or inline SQL it executes that is longer than its
  reviewer reads (120 lines or 8,000 characters for a script, 150 lines or 8,000 characters for SQL)
  is code that will run and that no reviewer saw in full. A reviewer's approve of such a call does
  not let it run either: it comes to you ("… or a script or SQL file it runs, was too long to review
  in full"), is refused where nobody can be asked, and is not remembered. Writing the same long file
  with a file tool is not a run and is unchanged: its reviewer is told what was left out.
- **Secrets are redacted before anything is cut**, so a cut cannot leave half a secret that no
  longer looks like one.
- **Context that could not be shown is said so.** A `.sql` file the call names that is outside the
  project, missing or unreadable, and a script the call runs that Claude did not write through a
  file tool this session (or that could not be read), are named in one line of the prompt, so a
  reviewer does not take their absence for harmlessness.

## The full council

**Big operations** go to every enabled reviewer at once instead of one. By default they are a
`git push`, a merge into a protected branch (`git merge` while a protected branch is checked out, or
`gh pr merge`) and a database migration.

- **Who sits:** every enabled reviewer with something of the call to review.
  - The destructive-operations reviewer always sits.
  - The git and database reviewer sits once for each profile the call touches, so `git push && psql …` gets both.
  - The diff reviewer sits for a file change, and for a push or merge. There it reviews the changes the push would send or the merge would bring in, read by fixed, read-only `git diff`s: one for a merge, and for a push one per refspec (the first three), each from the refspec's own source. A refspec whose changes cannot be read is said so in the reviewer's prompt. When the remote does not have the branch yet, the diff is against the remote's default branch (`<remote>/HEAD`), the changes since the branch point.
- **One model:** every member sits on the council's model (`opus` by default), not its own.
- **One deadline:** every member runs under one shared deadline from that model (Opus 45 s, or "Review deadline" in `/config`). By default they run in parallel. "Full council one at a time" asks them in turn instead, each getting what is left of the deadline, and stops at the first block.
- **Strictest wins:** block, then revise, then approve. Every objection is labelled with the reviewer who raised it. A reviewer that errors, times out or answers malformed counts as a block from that reviewer.
  - Blocked only for want of verdicts (nobody actually objected, every check passed): the call comes to you, as a single reviewer's failure does.
  - Any real objection or failed check: Claude gets the refusal.
- **Independent:** reviewers never see each other's verdicts.
- **A command too long for a seat:** when every reviewer approves but one of them saw only part of the command, the call comes to you (see [Long input](#long-input)). An objection from any reviewer stands as before.

**Project checks** (Gimli, `gimli`) run alongside: your tests, lint and typecheck, from
`gimli.commands` in `rules.json`:

```json
{
  "schemaVersion": 1,
  "gimli": {
    "commands": [
      { "name": "tests", "argv": ["npm", "test"], "timeoutMs": 300000 },
      { "name": "lint", "argv": ["npx", "eslint", "."] }
    ]
  },
  "bigOperations": ["publish", "/^kubectl\\s+apply(\\s|$)/"]
}
```

- **They run only after you confirm the file.** `gimli.commands` waits for `/council trust` (see [Trusting a project's rules file](#trusting-a-projects-rules-file)); until then a big operation is refused with "not run: the rules file is not trusted".
- **Only these commands run.** They run by argument vector with no shell, in the project root (with several repositories under one root, in each repository's own directory), and nothing comes from Claude or the call. `rules.json` is a protected path, so Claude can't add a command without asking you.
- **Pass or fail by exit code.** A failure, a timeout or a command that can't start is a block. Claude gets the check's last 20 lines (redacted) so it can fix the cause, and for a command that can't start, the error (a missing program, say; redacted); the audit log keeps none of them.
- **Each command has its own timeout:** 120 s unless `timeoutMs` says otherwise, at most 600 s. It runs outside the reviewers' deadline, so a council can take as long as the longer of the two.
- **Stopping early:** Esc ends them. Once a reviewer has blocked, or another check has failed, timed out or could not start, a check still running is stopped, since it can only add a block.
- **Make them non-interactive.** No watch mode or prompts; standard input is closed. For example, `["env", "CI=1", "npm", "test"]`.

**Changing what counts as big:** `bigOperations` in `rules.json` adds rule ids,
`/regex/flags` matched against each shell part, or `merge-to-protected`; it only adds to the shipped
list. Only calls the rules already send to review can be big operations: a blocked call stays
refused, and an ask-tier call still comes to you. To send big operations to one reviewer like any other call, turn off "Full council for big
operations" in `/config`. `/council test "<command>"` shows when a call would go to the full council,
who would sit and which checks would run.

## Editing rules

Put project overrides in `.claude/council-of-elrond/rules.json`:

```json
{
  "schemaVersion": 1,
  "rules": [
    {
      "id": "allow-clean-build",
      "tier": "allow",
      "tools": ["Bash"],
      "command": "^rm -rf (build|dist)$",
      "reason": "Build output is disposable here."
    },
    {
      "id": "no-terraform-destroy",
      "tier": "block",
      "tools": ["Bash"],
      "command": "^terraform destroy",
      "reason": "Infrastructure is torn down by CI only."
    },
    {
      "id": "review-mcp-db",
      "tier": "review",
      "tools": ["mcp__db__*"],
      "reason": "Database MCP calls."
    }
  ],
  "disableRules": ["shell-move"],
  "protectedPaths": ["secrets/**"],
  "protectedBranches": ["staging"],
  "productionPatterns": ["\\bprd-"],
  "models": { "gandalf": "opus" }
}
```

**Rule fields:**
- `tools`: exact names, globs (`mcp__*`) or `/regex/flags`.
- `command`: a regex matched against each shell part, with quotes removed and wrappers such as `sudo`, `env` and `nice` stripped.
- `path`: a regex matched against the file path relative to the project root.
- `input`: a regex matched against the call's JSON.
- `member` and `profile`: who reviews (`gandalf`, `legolas`, `aragorn` with `git` or `database`).
- `id` (a rule, and a secret pattern) and a check's `name`: at most 64 characters, each a letter, a digit, `.`, `_` or `-`. A file with another name is broken, like any other error.

**How overrides combine with the shipped rules:**
- **Overrides win.** A matching project rule of a confirmed file decides before the shipped rules. A file nobody has confirmed only adds to what the shipped rules decide ([Trusting a project's rules file](#trusting-a-projects-rules-file)).
- **Two things can't be lowered.** No project rule goes below a shipped block rule or a protected path, and block rules can't be disabled.
- **Lists only grow.** Lists add to the shipped ones.
- **Some settings wait for you.** Until you confirm the file with `/council trust`, its allow rules, disabled rules, models, patterns, allowlist and checks are ignored ([Trusting a project's rules file](#trusting-a-projects-rules-file)).
- **A project rule's reason is the project's text.** Reviewers see it inside a data block under a lead-in that says so, not after "Flagged because", and the dialog shows it after the `|` bar. Claude's refusal and the audit line introduce it as "The project's rules file says" and never as the council's own sentence. Everywhere it is on one line of at most 200 characters, with control, invisible and direction-changing characters removed.

**A file with errors is partly applied.** If the file is JSON of this schema version but has
errors (an unknown key, a rule that does not validate, a regex over 1,000 characters), what can only
make the gate stricter still applies: its `protectedPaths`, `protectedBranches`, valid
`productionPatterns` and `bigOperations`, and its valid `block`, `ask` and `review` rules, which
only add to what the shipped rules decide, as for a file nobody has confirmed. Everything else in it
is ignored, whatever the file's trust and the `trustProjectRules` option: allow rules, `disableRules`,
`models`, `gollum.patterns`, `gollum.allowlist`, `gimli.commands`, and every entry that has an error.
A broken file is never read as confirmed, and `/council trust` has nothing to confirm in it. Its
project checks are not run: a big operation then blocks, with "not run: the project rules file has
errors", until the file is fixed (fix it, then `/council reload`). A file that is not JSON, not an
object or of another `schemaVersion` is ignored whole and the shipped rules stay in force. Either way you are
told: the errors are listed by field in the transcript with a toast, `/council status` and
`/council rules` say "partly applied: N error(s)" or "ignored: not readable", and where nothing
draws, Claude is given one row with the number of errors (nothing from the file) to pass on to you,
once per version of the file.

**Limits.** A regex in a rules file is at most 1,000 characters, and a file holds at most 200 rules
and 200 secret patterns. Over a limit is an error like any other.

The overrides file is itself a protected path, so Claude can't edit it without asking you.

**Where the file lives.** At the top of the project: `.claude/council-of-elrond/rules.json` under
the session root. When the session root is the parent of several repositories, each repository
directly below it has its own, at its own top (see the next section). No other depth counts: a
file in an arbitrary subfolder is never read, so a planted file cannot set rules for the calls
beneath it.

### Trusting a project's rules file

A rules file arrives with a cloned repository, so what it holds is not yours until you have read
it. The settings that can only make the gate stricter apply at once; the ones that loosen it or run
code wait until you confirm that exact file.

| Applies at once | Waits until you confirm the file |
| :- | :- |
| `block`, `ask` and `review` rules (they only add, see below), `protectedPaths`, `protectedBranches`, `productionPatterns`, `bigOperations` | `allow` rules, `disableRules`, `models`, `gollum.patterns`, `gollum.allowlist`, `gimli.commands` |

**A file nobody has confirmed can add protection, never replace a shipped decision.** The shipped
rules decide the call first, as if the file held no rules, and what they decide stands: its tier,
its rule, its reason, the reviewer or the full council, the preview and the checks. The file's rules
then add to it:

| The file's rule | The shipped rules let the call through | The shipped rules review it | The shipped rules ask | The shipped rules block |
| :- | :- | :- | :- | :- |
| `block` | blocked, with the file's reason shown as the project's text | blocked, likewise | blocked, likewise | the shipped block stands |
| `ask` | comes to you | reviewed as the shipped rules say, and, only if the review approves, then put to you with the file's reason shown as the project's text. A revise or a block stands and you are not asked on top. Never remembered, so a repeat is reviewed and asked again; where nobody can be asked, it is refused | the shipped ask stands | the shipped block stands |
| `review` | reviewed by one reviewer | nothing changes | nothing changes | nothing changes |

A rule that only adds (it asks after a review, or it matched where the shipped rules had already decided) is listed in the audit line (`alsoRuleIds`); `ruleId` keeps the shipped rule.
So such a file can never leave a call with less review, a thinner preview or a smaller council than
having no file: it only adds a question or a block, or a review where there was none. The option set
to `always` and a file you confirmed decide first, as a project's rules always did.

**Confirming changes more than the settings that wait.** Once you confirm a file, *every* rule in it
decides before the shipped non-block rules, whatever its tier: a `review` rule of the file can replace
a shipped question (a `review` rule matching `ls` turns `sudo ls` from a question into a review); only
the shipped block rules and the protected paths stay a floor no project rule lowers. So a file that holds a rule of any tier
is a file to confirm, even if nothing in it is ignored: it is listed by `/council trust`, the notice
and the status say that its rules apply now and only add, and that confirming it lets them decide
first. A file of lists only (`protectedPaths` and the like) has nothing to confirm: it is not listed,
and the mod does not rewrite it either.

Until then the waiting settings are as if absent: an allow rule lets nothing through, a shipped
rule you disabled still fires, the built-in models are used, your patterns are not applied, and the
project checks are not run. A big operation whose checks are among them is refused with "not run:
the rules file is not trusted", the same as a check that could not be started, so a check the
project asked for is never dropped silently.

**Telling you.** Once per session per file the council says, in a transcript line and a toast, that
the file has settings that are ignored, with counts and no text from the file. Where nothing draws
the same notice reaches you through Claude, with counts only (see [Where nothing draws](#where-nothing-draws)).
`/council rules` and `/council` show, for the file in scope, whether it is trusted (you confirmed this
content), trusted by the option, or not trusted, with how many settings are ignored.

**Confirming.**
- `/council trust` lists, for each file in scope that has something to confirm (a session root that
  holds several repositories has one per repository), every setting of it, none left behind a "more",
  in two groups:
  - **Applies now and only adds to the shipped rules:** each `block`, `ask` and `review` rule, each
    protected path, protected branch, production pattern and big operation. One sentence follows the
    rules: after you confirm, these rules decide before the shipped ones, so a `review` rule here can
    replace a shipped question.
  - **Switched on by confirming:** each `allow` rule, disabled rule, model, check and secret pattern,
    and the count of allowlisted secrets.

  Every rule of every tier is listed with every field it has (id, tier, tools, command, path, input,
  check, member, profile and reason), each check's name, timeout and every argument on a line of its
  own in quotes, and each secret pattern's id, level, regex, label and kind. One value per line after
  a `|` bar, as the file has it: not cut and not redacted. Secrets allowlist entries are counted and
  never shown. A rule with no `command`, `path`, `input` or `check` gets a line under it saying it
  matches every call of the tools it names, and one whose `tools` match every tool (`*`) says so.
  Then the file's code and the line to type.
- **Some files cannot be confirmed from the session**, because the listing would not show you all
  of them or could mislead you: more than 40 settings in all, in both groups together (every rule of
  every tier, every list entry, every allowlist entry, or more than 20 files, past the twentieth); a
  value over 400 characters; a value that looks like a secret (it is shown as "not shown: looks like a
  secret"); a value with a control, invisible or direction-changing character in it, which includes the
  soft hyphen, the joiners and fillers, the invisible operators, variation selectors, tag characters
  and every Unicode space but the plain one (a no-break or ideographic space reads like a space). `/council trust` still prints what it can, names each such
  value, and says the file cannot be confirmed from the session instead of giving a code. Shorten or fix the file, or, if you control
  which repositories this host opens, set `trustProjectRules` to `always`.
- `/council trust <code>` reads the files again and confirms the one with that code, but only if
  that very content was listed in full in this session and is unchanged since. The code is 8 hex
  characters worked out from the file's hash and a secret the session made for itself and shows
  nowhere, so no one who can read the file, Claude included, can work it out; it differs from one
  session to the next. A code typed before the listing, for a file
  edited since it, or for a file that cannot be confirmed from the session, confirms nothing and says
  so. A listing is used up by the confirmation it leads to. It then reloads and says what is now in force.
- `/council untrust` takes the confirmation back for the files in scope.
- Any change to the file, one byte or a copy at another path, makes it untrusted again; it is read
  again at the next `/council reload` or session. `/council reload` itself never trusts anything.
- Only a person's own command runs `trust`, as `off` does: not a plugin, another session, a
  scheduled prompt, `claude -p` or the SDK.

The confirmation is kept in the plugin's own store (a file under your Claude Code configuration
folder), never in the repository, as a path and the SHA-256 of the exact text; at most 200 files. A
store that cannot be read trusts nothing.

**The mod's own writes.** When you answer "Add the rule" after "allow once", or add an allowlist
entry, the file is written, and its new content is recorded as trusted only if the file was not there,
or you had confirmed its previous content, or it held no setting at all: you confirmed that one entry
and nothing else in the file. A file that exists and that you have not confirmed (one with settings
waiting, one that holds only `review`, `ask` or `block` rules, or one that holds only lists) is not
offered a rule or an allowlist entry, and nothing is recorded for it; run `/council trust` first.

**For a host with nobody to confirm.** Set the option "Trust project rules files" to `always`
(`trustProjectRules=always` in the plugin's configuration) and every rules file is trusted, as it was
before this rule existed. Use it where the owner of the environment decides which repositories it
opens (a cloud or CI setup), never for repositories you did not choose. It is the plugin's own
configuration; no rules file can set it.

**If you used a rules file before this rule.** Its waiting settings stop applying on upgrade, so a push
with project checks is refused until you run `/council trust` and type the code, or set the option.

### Several repositories under one root

Some environments (a cloud environment with two repositories, a workspace folder) start the
session in a folder that holds several repositories rather than in one of them. If that folder has
no `rules.json` of its own and is not itself a repository (no `.git`), the mod looks up the rules
per call:

- **A repository** is a real directory (not a link) directly below the session root that holds
  `.git`. Its rules are its own `.claude/council-of-elrond/rules.json`, or the shipped defaults when
  it has none. A rules file in a folder with no `.git`, or deeper than a repository's top, is
  ignored.
- **A call touches the repositories it works in or names.** For a shell command that is the
  directory each part runs in (the session's, moved by a `cd` earlier in the command) and every path
  the part names; for a file edit, the file. `cd app && make` from the root touches the root and
  `app`; `cat ../app/x` run in `lib` touches `lib` and `app`; `cmd > /dev/null` names a path in no
  repository and adds nothing. A directory the call works in that is in no repository (the root, a
  plain folder, `/`, an unknown `cd $X`) brings in the root's own rules, which are the shipped
  defaults.
- **The strictest repository decides.** The call is classified against each repository it touches
  and the strictest tier wins: a call that one repository's rule allows but another's defaults
  review is reviewed. The deciding repository's models, big operations, protected branches and
  routing apply. `rm -rf ../lib` run in `app` is blocked, since `lib` is outside the repository the
  rule measures against (deleting a repository is like `rm -rf .`).
- **Protected paths, production patterns and project checks resolve against their repository.**
  `protectedPaths: ["config/secret/**"]` in `app`'s file is `app/config/secret/**`. A council
  call runs the checks of every repository it touches, each in its own directory, eight in all
  (the repositories' lists joined in the order they were touched). Git (the preview, a push's range,
  the current branch for a merge) runs in the deciding repository (or in the folder a `cd` in the
  command leads to, when it is inside the project).
- **Secrets.** The patterns of the root and of every repository the call touches apply, and
  everything the call shows is redacted by all of them. An allowlist entry counts only when every
  touched repository lists it.
- **The audit log is written in the repository.** A call that touched one or more repositories adds
  its line to the log of each; a call that touched none goes to the root's, as before. A
  `.gitignore` is written beside each. `/council log`, `report`, `rules` and `models` read the
  repository of the session's working directory (the root's when it is in none).
- **Approvals do not travel.** A cached approval, and a code typed in chat, apply to the same call
  in the same set of repositories and the same working folder only.
- **Allow rules and the allowlist are offered only for a call in one repository.** The rule or
  entry is written to that repository's file. A call touching two, or only the root, is not offered
  either (a file at the root would turn this lookup off): add the rule to the file by hand.

Each repository's file is read once and kept; `/council reload` reads them all again, and the mod's
own write to a repository's file reloads that one. A repository created after the session started
is seen after `/council reload`. A session root that has a `rules.json`, or is itself a repository,
keeps the single set of rules it always had. The lookup is on for any root with neither, even one
that holds no repository: a plain folder is then offered no allow rule or allowlist entry for calls
outside a repository, so give it a `rules.json` (even `{"schemaVersion": 1}`) to get them back. Each
repository's file is trusted on its own ([Trusting a project's rules file](#trusting-a-projects-rules-file)):
confirming one does not confirm another. The cloud guide has the setup, and the one option a cloud
environment usually sets, `trustProjectRules=always`, since nobody there can confirm a file:
[Cloud sessions](../../docs/INSTALL.md#cloud-sessions).

## Models

| Reviewer | Built-in default |
| :- | :- |
| Destructive operations (Gandalf) | `sonnet` |
| Diffs (Legolas) | `sonnet` |
| Git and database (Aragorn, both profiles) | `opus` |
| Full council (every member, for big operations) | `opus` |

Aliases resolve to the newest model of that family your Claude Code build knows. A reviewer's model
comes from the first of these that sets one:

1. A session switch (`/council model gandalf opus`). Each switch is checked with one tiny request first.
2. Its row in `/config` ("Gandalf model", "Legolas model", "Aragorn model", "Full council model": `default`, `sonnet`, `opus`, `fable` or `haiku`).
3. `models` in the project rules file, which also takes full model IDs.
4. The built-in default.

The token cap, effort and deadline follow the model automatically. "Review deadline" in `/config`
overrides the deadline.

## Options (`/config`)

| Option | Default |
| :- | :- |
| Gandalf enabled | on (off: calls only it would review come to you) |
| Gandalf model | `default` |
| Legolas enabled | on (off: its reviews go to Gandalf) |
| Legolas model | `default` |
| Aragorn enabled | on (off: its reviews go to Gandalf) |
| Aragorn model | `default` |
| Full council for big operations | on (off: big operations go to one reviewer) |
| Full council model | `default` |
| Full council one at a time | off (members in parallel) |
| Project checks enabled | on (runs `gimli.commands` for big operations) |
| Review deadline (seconds) | 0 (from the model) |
| Session token budget | 1,500,000 (spent: reviews come to you) |
| Audit log path | `.claude/council-of-elrond/audit/audit.jsonl` |
| Audit log size before rotation (KB) | 1024, three files kept |
| Shadow mode | off |
| Plain mode | off (themed). On: no theme text anywhere |
| Secrets scan enabled | on |
| Read-only preview enabled | on |
| Preview line limit | 80 |
| Diff line limit | 200 |
| Tool errors count as failed attempts | on |
| Trust project rules files | `confirm`: the settings of a rules file that loosen the gate or run code wait for `/council trust`. `always`: every file is trusted, for a host whose owner controls the repositories it opens (see [Trusting a project's rules file](#trusting-a-projects-rules-file)) |

## Modes

| Mode | What it does | How to set it |
| :- | :- | :- |
| Enforcing (the default) | Every tier applies. A reviewer's revise or block refuses the call; a reviewer that fails, or none being on, brings it to you. | Nothing to set. |
| Shadow | Reviewers and the full council (its project checks included) log their verdicts and never refuse; a failed review passes, logged. The block tier, the ask tier, protected paths, the secrets scan and lockouts still enforce. | `/council shadow on` for the session, or "Shadow mode" in `/config`. Label: `council: shadow`. |
| Bypass (themed: Leeroy mode) | Every gated call passes unreviewed, block-tier calls and the secrets scan included, and each is logged. The scan alone still refuses an allowed call that holds a high-confidence secret, or whose text is too long to scan in full: bypass does not reach it. | `/council off`, for this session only and never saved; `/council on` ends it. Label: `council: bypass` (`council: Leeroy mode` themed). |
| Plain | Every string in its plain variant, with no theme text anywhere; behaviour is identical. It combines with any mode above. | "Plain mode" in `/config`. |

## Theme and plain mode

By default the council speaks in its theme. The "Plain mode" option in `/config` switches every
theme word off; behaviour is identical in both modes.

What is themed, for you only:

- The names: `/council`, the dialog and the report say Gandalf, Legolas, Aragorn (git or
  databases), Gimli, Gollum, Galadriel, Elrond and the Council of Elrond where plain mode says the
  role ("the destructive-operations reviewer", "the full council").
- The escalation dialog is a loot roll: headed "Loot roll", with the options "Need: allow once",
  "Pass: keep blocked", "Parley: talk first" and, for one possible secret, "Greed: add to
  allowlist".
- Bypass is Leeroy mode (`council: Leeroy mode` by the prompt, and in `/council`).
- `/council` counts wipes where plain mode says "refused or failed attempts".
- Each member's one line of flavour in the debate pane, the pane's title ("The debate"), the council check band's header ("Ready check"), the wipe counter, the threat meter and the epic drop (see [Debate pane and council check](#debate-pane-and-council-check)).

What is never themed: what Claude reads. Refusals, the full council's reasons and the rule reason
written to your rules file are plain in both modes, and name the role, not the character. Member
ids you type (`/council model gandalf opus`) are config keys and stay as written. The dialogs that
confirm exact data you agree to write (the allowlist entry, an allow rule) keep their plain text.

Each theme term and its plain name are in the [Glossary](#glossary).

"Council" stays in plain mode: it is the product's name.

## Commands

Everything `/council` prints is for you: it draws in a pane where a surface draws one, else as
dim transcript lines. Claude does not read it, with one exception: where nothing draws at all (the
cloud web client, `claude -p`, the SDK), `/council` status, report, rules and test also go to Claude
to show you, because Claude is then the only way to reach you; see
[Where nothing draws](#where-nothing-draws). That applies only to a person's command. In `claude -p`
and the SDK a command is not a person's, so it gets no relay. In a plain `claude -p "/council"` run nothing prints;
use `--output-format stream-json`, where the lines arrive as `ui_log` messages.

| Command | What it does |
| :- | :- |
| `/council` | Status: mode, each member with its state, model and verdict counts, the full council and the project checks, failed attempts since your last prompt, tokens spent, median review time, how the project rules file stands (confirmed, waiting, partly applied or ignored), and, once any failed, how many audit lines could not be written. |
| `/council off`, `/council on` | Bypass for this session: gated calls pass unreviewed and are logged. Never persisted. The label `council: bypass` (`council: Leeroy mode` when themed) shows by the prompt. |
| `/council shadow on`, `/council shadow off` | Shadow mode for this session, over the `/config` setting. |
| `/council log [n]` | The last *n* gated calls (default 10) from the audit log. |
| `/council rules` | Every effective rule with its source (`shipped` or `project`), and the lists: protected paths, the paths protected against writes, protected branches, production patterns, extra secret patterns, and the secret allowlist (a fingerprint, or `(an exact string, not shown)`: never a character of an exact entry). |
| `/council test "<command>"` | Which tier, rule, reviewer (and profile, and why it fell back to Gandalf if it did) and operation key a shell command would get. For a big operation it shows the full council's seats, model and checks. Runs nothing, so a merge is assumed to land on a protected branch and a force push of the current branch is asked about (its branch is not read). |
| `/council model [<member> <model> [--save]]` | Lists each slot's model and where it came from, or switches one for this session (`default` clears the switch). `--save` also writes the `/config` row when the model is one of its picker values. |
| `/council trust`, `/council trust <code>`, `/council untrust` | Lists everything a rules file with settings that wait would enable, with its code (or why it cannot be confirmed from the session); confirms the file whose code you type, if it was listed in this session and is unchanged; removes the confirmation. See [Trusting a project's rules file](#trusting-a-projects-rules-file). |
| `/council reload` | Reads `rules.json` again (every repository's, when the session root holds several). It never trusts a file. Only a person's own command runs it. |
| `/council report` | A summary of the audit log, rotated files included (see below). |
| `/council debate` | Opens the [debate pane](#debate-pane-and-council-check) at any width (where nothing draws, prints its rows as transcript lines). |

**`off`, `shadow on`, `model`, `trust` and `reload` only run when a person types them.** They loosen the gate (bypass,
reviewers that never refuse, a different reviewing model, a project file's settings, or reading a changed rules file), so a command that arrives from a plugin,
another Claude session or a scheduled prompt is refused with one line and changes nothing. Typing
them at the prompt (the cloud web client included) or through the Remote Control bridge works.
`claude -p` and the SDK are not a person, so those five are refused there; set them in `/config` or
the plugin's options instead. `on`, `shadow off`, the `model` listing and the rest answer
from any origin (`untrust` too: it only tightens).

### `/council report`

Read the report after a few days in shadow mode to tune the rules. It has four parts:

- **Most refused:** the rules behind the most refusals, each with who refused (the rules, a reviewer, you, the secrets scan, a lockout), and the operations refused most.
- **Stopped, then allowed by you:** calls the council stopped and you then allowed once, allowed in chat or allowlisted, by rule, with examples. These are the false-positive candidates. It also lists the allow rules you added that way.
- **Shadow verdicts that would have refused:** per reviewer, how many blocks and revises it logged in shadow mode, and under which rules.
- **Cost per reviewer:** tokens per reviewer, with its share of full councils (taken from each member's own tokens in the council), the full council's sittings, and the median review time. Review times are logged from Stage 5 on; older lines count for tokens only.

A line that doesn't parse is skipped and counted; a log file that can't be read is named and left out.

## Debate pane and council check

Three things show you a review as it happens, none of them read by Claude:

- **The debate pane** (`The debate` themed, `Council review` plain) lists your newest reviews, three at most, newest first. Each shows the call, then one row per reviewer: its name, a symbol with a word (`✓ approve`, `✗ revise`, `✗ block`, `✗ no verdict`, `… reviewing`, `– sat out`), its reason and its safer alternative, and, in themed mode, one line of flavour. A full council also shows each project check (`✓ passed`, `✗ failed`, `✗ timed out`, `✗ could not start`, `– stopped`, `… running`) and a final verdict row. Below the reviews are two session-wide rows: the **wipe counter** (refused or failed attempts since your last prompt, over how many operations, and how many are locked out; "Wipes" themed) and the **threat meter** (each reviewer that has blocked, most blocks first, as a bar and the number: `Gandalf ███ 3 blocks`; plain mode says `the destructive-operations reviewer ███ 3 blocks`). Nothing depends on colour: every symbol has its word.
- **The council check band** sits above the prompt only while a full council sits: a header ("Ready check" themed, "Full council review" plain), then a row per reviewer and per check as it answers. It leaves when the council is done, and gives way to a survey. A single reviewer's review never draws in the band.
- **The epic drop** is for themed mode only. When a push or merge passed the full council, ran, and was not a repeat of an approved call, "✦ Legendary commit acquired" shows in the band for eight seconds, with a toast of the same words. Plain mode has none of it: no toast, no row.

The pane has its own tab (`council-debate`), beside the `/council` output pane. It opens on its own once per session, the first time a model review or a full council starts; Claude Code keeps an unasked pane hidden below 144 terminal columns, so on a narrow terminal it stays hidden. `/council debate` opens it at any width, and is the way back after you close it. It follows the agent in view: with a subagent's transcript on screen, it shows that subagent's reviews.

What draws where: the pane on every surface Claude Code draws panes for (terminal, desktop, VS Code, mobile; whether VS Code paints it is for a live check to say), and the band on the terminal and desktop only. Where a surface draws nothing (a `claude -p` run, the SDK, cloud), nothing is drawn and nothing is lost: `/council debate` prints the rows as transcript lines, and the audit log and `/council` keep the full record. In a cloud session the web client does not show those transcript lines either, so there the audit log is the record, and a few things reach you through Claude instead ([Where nothing draws](#where-nothing-draws); the debate pane's rows are not among them). The mod does not reach a cloud session from repository settings; see [Cloud sessions](../../docs/INSTALL.md#cloud-sessions).

## Where nothing draws

Some clients draw nothing the mod makes: the cloud web client, `claude -p` and the SDK report no
surface (no pane, no status line, no toast), and the transcript lines `/council` prints are not
shown there. In those sessions the only way to reach you is Claude, so a few things go through it.
This applies only where nothing draws; with a terminal, desktop app, VS Code or the phone app
attached, nothing changes and Claude reads none of it.

**What reaches you through Claude**

- **`/council` status, report, rules and test, when a person types them** (not in `claude -p` or
  the SDK, where a command is not a person's and gets no relay). The same lines the pane would
  show are handed to Claude with an instruction to repeat them to you verbatim, in a code block, when
  it next replies. They sit inside a fenced block that Claude is told to treat as the council's output,
  not as instructions. Every line is redacted first, a typed command included, and `/council rules`
  shows an exact-string allowlist entry as `(an exact string, not shown)`, in the pane as here, with no
  character of it. (A command does not start a reply by itself: Claude repeats the lines when you next
  write to it, for example "go on".)
- **A notice when a project rules file has settings waiting for your confirmation**, once per file, with counts only (nothing from the file), telling Claude to tell you and how: run `/council trust` in a terminal, or set the option "Trust project rules files" to `always` for a host you control. `/council trust` itself prints to the transcript lines, which are not shown here, so this is not a place to confirm.
- **A notice at the start of the session**, saying the council is active, that a call needing your
  approval is refused here with the reason, and that Claude should tell you which call was refused
  and why.
- **The refusal when a call needs you and nobody can be asked.** It names the operation (the same
  redacted key the audit log holds), the rule behind it and the reviewers that looked at it, by
  name only, and the way to let it run, with a code you can answer in chat
  ([Approving in chat](#approving-in-chat)).

**What never goes through Claude:** the read-only preview and any secrets finding (its label, its
snippet and the secret), a diff, the call's own text or what a write would put in a file, a
reviewer's reason or failure, and every other subcommand (`log`, `off`, `on`, `shadow`, `model`,
`models`, `trust`, `untrust`, `reload`, `debate`). Only a person's own command is answered this way: one that arrives
from a plugin, another Claude session, a scheduled prompt, `claude -p` or the SDK gets nothing
back, so Claude cannot probe how a command would be classified.

**Letting a refused call run.** You can approve it in chat (below), add an allow rule for it to
`.claude/council-of-elrond/rules.json` yourself (Claude is told not to edit that file: it is a
protected path), or continue the session in a terminal, where the council can ask you. Neither the
notice nor the refusal offers turning the council off or shadow mode as a way round.

### Approving in chat

When a call is refused because nobody can be asked, the refusal carries a code, `council:` and six
hex characters (say `council:1a2b3c`), and Claude is told to give it to you. The code is the first
six characters of a hash of the call (its tool and arguments, without a shell command's
`description`), so a retry with new wording keeps its code. You answer in your next message, with a
line of your own that holds nothing else:

| You type | What it does |
| :- | :- |
| `council allow 1a2b3c` | The council lets that exact call run once, if Claude makes it again with the same arguments. |
| `council allow 1a2b3c session` | The same, whenever Claude makes it, until `/clear`. |
| `council deny 1a2b3c` | Refuses it. Claude is told not to make it again. It is not counted as a failed attempt. |

- **Typed on a line of their own.** Case and spacing do not matter, and
  `council allow council:1a2b3c` works. A line that begins `council allow` or `council deny` but is
  anything else (no code, a wrong code, `deny` with `session`, extra words) is answered as
  malformed and records nothing. Every such line is removed from your message before Claude reads
  it, and Claude is told what it did: only the code, never your raw line. At most ten such lines in
  a message are acted on.
- **Once or session.** A once-allowance ends at your next message of any kind (or the next prompt
  that is not yours, such as a finished task) or when it is used, whichever is first. A session
  allowance lasts until `/clear` and survives your messages; it is offered only where an allow rule
  could be (not for a script, a long or multi-line command, a command whose words expand when it
  runs or that has an unquoted `*`, `?`, `[`, `{` or `~`, a big operation, or one with a possible
  secret in it: for those `session` records nothing and Claude says so, and you type the once form).
- **The folder is part of the call.** The code, and a once or session allowance, stand for the call
  in the working folder it was refused in. The folder follows a `cd` between Claude's commands, so
  the same call made from another folder is another call: it is refused again, with a code of its
  own, and the allowance still holds for the first folder.
- **Offers last until your next message.** A code from a refusal is answered only in the next
  message you write; after a further message it is unknown, and Claude is told so.
- **Never offered:** a protected path and a block rule have no code, and a high-confidence secret is
  refused before any of this. Where a surface draws, nothing changes: you are asked in the dialog,
  and an earlier chat answer does not skip it.
- **An ordinary message.** Type the line in a message of its own words, not inside a slash command
  (such as `/review`): a message that runs a slash command is never read for these lines.
- **Only a line you type counts.** A message from `claude -p`, the SDK, a plugin, another session, a
  channel or a schedule is ordinary text, and its `council allow` line is not removed or acted on.
  In `claude -p` and the SDK there is therefore no chat approval.
- **A limit:** you approve through what Claude relays, so read the operation the refusal names before
  you type the line. The code stands for the exact call, but you only see the operation key.

The audit log records these as the decisions `chat-allow`, `chat-session` and `chat-deny`.

## Secrets scan

Every call is scanned for secrets in what it would write or run: a shell command (heredocs and its
description included); for a file tool, its path and what it writes (Write content, an Edit's new
text, a notebook cell); for any other tool, whatever its name, its whole input (a URL, an agent's
prompt, a search pattern, an MCP call's arguments). A high-confidence finding refuses the call
whatever its tier, allowed calls included. A low-confidence finding comes to you only on a gated
call: an allowed call never gets a question.

A text up to 600,000 characters is scanned whole. A longer one is read from its start (500,000
characters) and its end (100,000), each reaching 512 characters into the skipped middle, so a token
that straddles either cut is still read whole; the rest of the middle is not read, and the scan says
so instead of passing it silently. A gated call of that length comes
to you, with the reason that it is too long for the secrets scan to read in full (allow once, keep
blocked, talk first or type an instruction; your answer is not remembered and no allow rule is
offered for it); where nobody can be asked it is refused. An allowed call of that length is refused,
logged, as a high-confidence finding is. Shadow mode does not change this, as it does not change a
finding; bypass skips a gated call's scan, not an allowed call's.

- **High confidence** (private keys, PGP private key blocks, AWS, GitHub, GitLab, npm, Anthropic, OpenAI, Slack, Google and Stripe keys, Google OAuth client secrets, Slack webhook URLs, passwords in connection strings): refused without asking you, on an allowed call too (it is logged, with tier `allow`). Claude is told to remove the secret.
- **Low confidence** (`password=…`-style assignments, including compound names such as `DB_PASSWORD`, `PGPASSWORD` and `dbPassword`; JWTs; `Authorization: Bearer …` and `Basic …` headers; a `mysql -p<password>` argument; a password in a connection string with no user, `redis://:<password>@host`; long random-looking tokens): comes to you with a redacted snippet. Allow once, keep blocked, type an instruction, or **add to allowlist**. The allowlist asks a second time, showing the exact entry: a `sha256:` fingerprint of the secret, never the secret. Only then is it written to `rules.json` under `gollum.allowlist`. The fingerprint of a short password can be guessed offline, so the allowlist is for keys and tokens: for a password finding the second question says so, and a real password is better changed.

Code that only names a secret is neither a finding nor redacted. That is a value which is wholly a reference: a variable or a template (`$TOKEN`, `${DB_PASSWORD:-}`, `${1:-default}`, `{{ secrets.TOKEN }}`), a call expression whose arguments hold no quoted string and no literal of 8 or more letters and digits (`getToken()`, `z.string().min(8)`, `crypto.randomBytes(32)`, `uuid4()`, `await getToken(user)`, `response.json()["token"]`; not one whose callee starts with a capital letter, is not a known type name (`String`, `Numeric`, `Uint8Array`, `VARCHAR`, ...) and either has a digit in its name or starts with a digit argument: `Winter(2024)`, `Passw0rd()` are words dressed as calls, while `Token(options)`, `Config()` and `String(128)` stay code), an indexed lookup such as `tokens[0]`, a type annotation such as `password: string`, a bare number under 6 digits (`"token": 1234`), a path or a backtick substitution under 6 characters (`/tmp`, `~/x`, `` `pwd` ``), and the shell's own `PWD` and `OLDPWD` when it is a shell assignment of a directory: the name is exactly `PWD` or `OLDPWD`, written with `=` (not a quoted key such as `"PWD":`), standing where a shell reads an assignment word (at the start of the text or of a line, after a space or a tab, after `(`, `{`, a backtick or `$(`, or glued to a `|`, `||` or `&&`; after any other white space, such as a carriage return or a no-break space, or after any other character, as in `db.PWD=`, `--PWD=`, `&PWD=` or `,PWD=`, it is a key and is redacted), with no `;` earlier on the line, and the value is shaped like a path (it starts with `/`, `~/`, `./`, `../` or `$`, or is `.`, `..`, `~` or a whole `$(...)` or backtick substitution of plain words; it holds only letters, digits and `. _ / ~ + @ % -` (and `$ { }` for an expansion), no `; ! : & ? #`, quote or space; and no part between slashes is a word of 6 or more characters that mixes letters and digits, such as `s3cr3t`). Any other value after `PWD` is a password: it is the password keyword of ODBC-style connection strings (`Server=x;PWD=hunter2xyz`, `PWD=/Pa55w0rd!`), and so is any `PWD` after a `;` earlier on the same line, any `PWD` with a blank around its `=` (that is no shell assignment), and any `PWD` value (bare or quoted, up to 1,000 characters, with up to 16 blanks or tabs allowed before the `;`) followed by `;` and then a character that is no blank and up to 64 more with a `=` among them (`PWD=/x;UID=sa`, `PWD=/x ;UID=sa`, `PWD=/x;User ID=sa`, `PWD=/x;[UID]=sa`). A shell command after a `;` has a blank or no `=` and stays readable (`PWD=/tmp; ls`, `PWD=/tmp ; ls`, `PWD=/home/me/project; CC=gcc make`, `PWD=/work/p;make`); `PWD=/work/p;make CC=gcc` is redacted, and a connection string whose `PWD` value is over 1,000 characters or has a blank inside it, with more than 16 blanks before its `;`, whose next name is over 64, or whose item follows a blank (`UID=sa PWD=...`), is the residual. A plain word of letters, `_` and `.` is a secret only from 6 characters (`token: token`, a commit message "fix password: reset flow"); with a digit or any other character, from 4 (`PASSWORD=abc12`). A value that only starts like a reference is still a secret: `$ecret123!`, `Sup3r(Secret)9`, `<realkey12345>`, `(hunter2xyz)`. Redaction is stricter than the scan: a value is left readable only when it is plainly code (a variable, a call, a dotted path, an indexed lookup, a type word); any other value after a secret keyword is redacted, even one the scan does not flag (a word of 6 letters or more, such as `correcthorse`). A longer path (`pwd=/work/x`) is redacted, as it was before this release's shorter minimum. Redaction also covers shapes the scan does not flag: the password of `curl -u user:password` (and `--user`), `--password` for the `mysql`-family clients, `Authorization: Token …` and `Authorization: ApiKey …` headers, and the `X-Api-Key` and `X-Auth-Token` headers.

Add your own patterns in `rules.json`:

```json
{
  "schemaVersion": 1,
  "gollum": {
    "patterns": [{ "id": "acme-key", "level": "high", "regex": "ACME-[0-9]{8}", "label": "Acme key" }, { "id": "acme-pass", "level": "low", "regex": "acme-pw=[^ ]{6,}", "label": "Acme password", "kind": "password" }],
    "allowlist": ["sha256:0123456789abcdef"]
  }
}
```

`kind` is optional: `"password"` adds the allowlist warning that a short password's fingerprint can be guessed offline; `"token"`, the default, does not.

Allowlist entries are exact strings or fingerprints, never regexes. Your patterns, once the file is
confirmed ([Trusting a project's rules file](#trusting-a-projects-rules-file)), are also used to
redact everything that is shown or kept: the dialog, reviewer prompts, the refusal Claude reads, the
operation keys and the audit log.

## Read-only preview

Before a review, the mod runs a few fixed, read-only inspections and shows the result to the
reviewer and to you. The commands come from a table in the mod; the call's targets are passed only as
data, and the proposed command never runs.

- **Deletes** (`rm`, `find -delete`): what each target is, and a folder's entries (no process).
- **`git push`:** the current branch, the remote's URL (redacted) and, for each refspec the push names (the first three), the commits it would send: `<remote>/<destination>..<source>` from the refspec's own source, so `git push origin other:main` shows `origin/main..other` and `git push origin a b` shows both, never the checked-out branch's commits unless a refspec names `HEAD`. A push that names no refspec sends the current branch (`@{upstream}..HEAD`). A delete (`:old`, `--delete`) sends no commits and shows none. When the remote does not have the branch yet, the commits are shown against the remote's default branch (`<remote>/HEAD`). What cannot be shown is said, in the preview and in a line the reviewers are given outside the preview: a source or destination that is not a plain ref name, no remote named as a plain name for a refspec to compare against, a range git could not read, or more than three refspecs.
- **`git merge`:** the current branch and the commits it would bring in.
- **`git reset`, `git rebase`, `git commit --amend`:** recent commits, marked with the remote branches that point at them, and uncommitted changes.
- **Write, Edit:** the file's diff stat against `HEAD`, and whether git tracks it.

They run in the repository the call is decided in, or in the folder a `cd` earlier in the command
leads to when that folder is inside the project. A call that points git elsewhere (`-C`,
`--git-dir`, `--work-tree`, `--namespace`, `GIT_DIR=` and the other location variables, or a `cd`
outside the project) gets no git preview, and the diff reviewer sits out of its council.

Each inspection has 5 seconds. No preview is never a reason to allow or block.

## Rounds, failed attempts and lockout

An **operation** is what a call tries to do, not its exact text: the tool family, the verb, and its
targets with flags dropped and paths resolved. `rm -rf ./build` and `rm -r build/` are one
operation. A push keys on its remote and branch, and SQL on its database.

- **Rounds:** after a reviewer refuses the same operation twice, further attempts come to you without another model call. Typing an instruction starts the rounds over.
- **Failed attempts:** a refusal by a rule, a reviewer or the secrets scan, your "keep blocked" (or a dismissed question, or nobody to ask), your refusal at Claude Code's own permission prompt, and a gated call that ran and errored all count. Claude Code's own "Chat about this" counts like a dismissal. "Talk first" does not, nor does Claude Code denying a call on its own with nobody asked (in `claude -p`, or by a deny rule), nor an allowlist entry the mod could not write (the call stays blocked, but the failure is not Claude's).
- **Lockout:** three failed attempts on one operation, or five on one kind of operation (say `git push` to any target), lock it out. Claude is told to stop retrying, tell you what failed and propose another approach.
- **A command of several parts:** each gated part of a shell command (`rm -rf build; git push origin main`) is also counted as the operation it would be alone. A failed attempt counts on the whole command, on each part and on each part's kind; a review round on the whole command and on each part. A command is locked out when its whole operation or any part of it is, or when any kind in it is, and it comes to you without another model call when its whole operation or any part has used its rounds. Only the first eight gated parts of one command are counted this way, besides the command as a whole; a command with more than eight gated parts is not decided by a reviewer at all, because a locked or spent part could sit among those not counted: it comes to you ("too many separate gated parts to track"), is refused where nobody can be asked, and is never remembered. Split it.
- **A force or delete push has a count of its own.** Besides its operation's count, a force push (`-f`, `--force`, `--force-with-lease`, `+branch`) or a delete (`--delete`, `:branch`) keeps its own rounds and failed attempts, which a plain `git push` of the same branch never clears. Two revised force pushes, a plain push that went through, then a third force push come to you.
- **The per-kind counters are bounded.** At 200 kinds of operation a new kind is counted on one shared counter ("other verbs"), which locks at five like any kind. Nothing already counted is dropped.
- A call that runs successfully clears its own operation (for a command of several parts: the command as a whole; its parts' own counts and the per-kind counters stay). Likewise, typing an instruction gives the command as a whole its rounds back, not its parts. Everything resets when you send a new prompt (a `/council` command is not one).
  Only a person's prompt starts them over: in `claude -p` and SDK sessions they last until `/clear`.
- **Cache:** a single reviewer's approve is reused for the identical call, from the same working folder, until your next prompt. A block or revise never is, and neither is the approve of the full council (a big operation convenes it, and runs your project's checks, every time), nor any call with a `git` part, since the checked-out branch and the index are not part of what the call says, nor any call that runs a script or code (a script file, a program by its path, inline code, code fed to an interpreter, `eval`, `source`, `xargs`; every `script-*` rule) or a project's runner (`make`, `just`, `npm run`, `cargo`, `yarn` and the like), since the same words can run other code after the file is edited. A call with none of these, in the same folder, still costs one review. The cache and the rounds are read again just before they are used, so two calls running at once see each other's result. Any prompt that is not a person's (`claude -p`, the SDK, a task notification, a schedule) also clears the cache.

## Escalation

When a call comes to you, the question shows the call (with secrets redacted), why it was gated,
the read-only preview when there is one, and each reviewer's verdict. A long call or preview is
shown by its start and its end, with a line saying how much is not shown. Every line of the call
and the preview starts with a gutter (`  | `) and has its control characters removed, and so are the
characters that change how text reads without showing (direction marks and overrides, zero-width
characters), so text in a command cannot pass for a line of the question, such as a reviewer's verdict
or a heading. A line wraps at 72 display columns (a wide character counts 2, a combining mark 0), and
every row of it starts with the gutter. When the question would be over about 2,500 characters, what
a reviewer wrote goes first (each reason cut to at most 240 characters), then the preview is cut to
its first and last line, then the middle of the call; the first 4 and the last 4 lines of the call
always stay. A line says what was cut each time, and the question's own lines and every reviewer's
verdict stay. You can:

- **Allow once** (themed: "Need: allow once"): the call runs, and still meets Claude Code's normal permission prompt, which then carries the line "Council: you allowed this once".
- **Keep blocked** (themed: "Pass: keep blocked"): it is refused.
- **Talk first** (themed: "Parley: talk first"): it is refused, and Claude is told to stop and talk the call through with you before anything else. It is not a failed attempt.
- **Type an instruction:** it is refused and your text is passed to Claude.

Dismissing the question, or choosing Claude Code's own "Chat about this", refuses the call and counts as a failed attempt (Claude Code does not tell the mod which of the two you chose). Where nobody can be asked (`claude -p`, nothing
attached), the call is refused, and the refusal tells Claude which operation, which rule and which
reviewers to name to you, and how you can let it run; see [Where nothing draws](#where-nothing-draws).

### Allow rules after "allow once"

Once a call you allowed once has run, a second question offers an allow rule for it, showing the
exact JSON. It is written to `rules.json` (after your own rules, keeping your file's key order)
only if you choose **Add the rule**, and the rules are then reloaded. **Not now**, or dismissing
the question, writes nothing, and the same rule isn't offered again this session. For
`sudo apt update`:

```json
{
  "id": "allow-apt-update",
  "tier": "allow",
  "tools": ["Bash"],
  "command": "^apt update$",
  "input": "^(?!.*\"dangerouslyDisableSandbox\":true).*\"command\":\" *sudo +apt +update *\"",
  "reason": "You allowed this call once after the council stopped it, and added this rule: it allows this exact command text, in any folder, without review."
}
```

The question says what the rule allows, by kind of call:

- **A shell command:** exactly that command text, in any folder, without review. `command` names the
  part that was gated, and `input` pins the whole command (and a call with the sandbox disabled is
  left out), so `sudo`, a redirect (`> file`) or another command chained on can't ride along. Only the
  same command passes (spacing may differ).
- **A file tool (`Write`, `Edit`, `NotebookEdit`):** every later write to that file by that tool,
  whatever it writes, without review. The rule pins the tool and the path, not the content.
- **Any other tool (an MCP tool, for one):** that tool with exactly the same arguments. The input is
  pinned as its JSON text, escaped; an input over 300 characters is not offered a rule.

Before offering it, the council checks that the rule would really let this call through. If one of
your own rules would still decide first, nothing is offered.

No rule is offered for:

- a call the rules block, or one touching a protected path;
- a call the secrets scan flagged at any level (an allow rule would skip the low-confidence scan);
- a script or inline code (what runs isn't in the command);
- a command whose words expand when it runs (`$VAR`, `$(…)`, backticks), one with an unquoted `*`, `?`, `[`, `{` or `~` (any one counts, even unpaired; a quoted or escaped one is still offered), one over several lines, or one over 300 characters;
- a big operation (a push, a merge into a protected branch, a migration, anything your `bigOperations` list): an allow rule would skip the full council from then on. When the current branch is not known, as here, every merge counts as big;
- a call you then refused at Claude Code's own prompt, or one that didn't run.

A broken `rules.json` is never rewritten: the rule isn't written, and a transcript line says why.
Secrets get their own confirm-then-write path, the allowlist (see [Secrets scan](#secrets-scan)).

## Audit log

One JSONL line per gated call: time, tool, fingerprint, operation key, tier, rule, member, model,
verdict, reason, shadow and bypass flags, your decision (`allow-once`, `allowlist`, `keep-blocked`, `instruction`, `dismissed`, `chat` for "Talk first", `unavailable` when nobody could be asked, and `chat-allow`, `chat-session` and `chat-deny` for a typed `council allow` or `council deny`), outcome, latency (the whole call), the
review's own time (`reviewMs`), tokens, and the id of an allow rule you added for it (`ruleAdded`).
A full council
adds what made the call big, each member's own verdict and tokens, and each check's result and time. The outcome
tells apart a call you refused at Claude Code's permission prompt (`refused-by-user`), one that
check denied with nobody asked (`denied-by-permission`), and one that ran and errored (`error`). It never holds file contents, diffs or secrets: the
call itself appears only as a hash. A `.gitignore` beside it keeps it out of git. With several repositories under one root, the line goes to each repository the call touched.

Lines are written in order after the call, and nothing waits for them: a failed write never changes a
decision. The first one that fails in a session is said once in the transcript, with a toast;
`/council status` then shows how many lines could not be written since the session began, and every one
goes to the debug log. A `.gitignore` that could not be written is tried again with the next line. One
write that never returns holds back only the lines queued after it, never a decision or a later call. `/council log` and `/council report` may not show a line still waiting.
The log is rotated by size (in bytes) into `.1` and `.2`. Two Claude Code sessions in one project share the
file with no lock between them, so their lines can interleave or one can overwrite the other's;
`/council report` skips any line it cannot read.

## Expected token cost

A review sends roughly 1,000–4,000 input tokens (checklist, the call or diff cut to its limit, both ends kept,
the preview, your latest prompt) and receives roughly 100–300 output tokens, plus thinking on
Sonnet, Opus and Fable at low effort. In a live check, small reviews took about 1,000 tokens each:
a one-line file write (diffs, Sonnet) in 1.6 s, a `git tag` (git, Opus) in 2.8 s and a `psql -c`
(database, Opus) in 2.4 s.
In the final live check, a subagent's `rm -r build` was reviewed like any other call: about 980
tokens in 1.9–2.5 s on Sonnet.

A **full council** costs one review per seat, on the council's model (Opus by default): typically
three for a push (about 3,000 tokens in all, about 2 s in a live check, in parallel), two for a
migration. Project checks cost no tokens, only their run time. Allowed calls cost nothing. Check
current prices for the models you choose.

## Known gaps in shell parsing

Parsing is best effort, by pattern, and not a shell. The parser does unwrap function and `case`
bodies, package and process wrappers, `$'…'` escapes and empty substitutions, so the command they
hold is classified (0.5.0). Since then it also reads the wrappers that take a positional before the
command (`chrt`, `taskset`, `setarch`), multi-call binaries (`busybox`, `toybox`), the runners
`fakeroot`, `firejail`, `systemd-run`, `op run`, `doppler run` and `mise exec`, the command strings of
`script -c`, `nix-shell --run`, `env -S` and the `tmux` subcommands that start a command, and the
substitutions in an unquoted heredoc body. The gaps that remain:

- **Variables and runtime expansions aren't resolved.** `rm -rf $DIR` has an unknown target, so review decides. A program word the shell builds at run time (a variable, a substitution, a glob, a bracket or a brace list; a flat literal brace list is read as the command it expands to) is reviewed, but what it expands to is not known, so the command it would run is not classified. `cd $X` followed by a relative recursive delete is treated as if `$X` were `/`; a `cd` to `$HOME`, `${HOME}` or `~` is followed to that folder (as well as to `/`), and one whose text names a protected or write-protected place (`cd $X/.claude/plugins/y`, `cd $D/.git`) is taken as inside it. A protected file named only through a variable (`X=.env; cat $X`) is not recognised as protected.
- **A `cd` is followed for the commands of its own level.** A `cd` or `pushd` between the parts of a command (`cd src && rm -rf generated`) moves where the later parts of that level work, and a target the mod cannot know (`cd $X`, `cd -`) counts as `/`. A `cd` inside a subshell, a group or `$(…)` moves the folder for the later commands of that level, not for the commands outside it: both readings are judged, so nothing is judged more leniently than before. The scope selection under a multi-repository root does not follow a `cd` inside a subshell. `popd` is not tracked.
- **Wrapper and runner options are read as the program reads them, and an unknown one means review.** Clusters are read letter by letter (`timeout -vs KILL 5`, `env -iu NAME`), long options by unique prefix, and global options before a runner's subcommand (`pnpm -r exec`, `npm -s exec`, `yarn workspace web exec`, `uv -q run`). An option the mod's tables do not list sends the call to review. `env -S` strings are split as GNU `env` 9.4 splits them (and are also read alone, as a shell reads them, and as the first versions read them); a string that holds a `${NAME}` is reviewed, since an unset name makes its word vanish and the words after the string can become the command, and is read with the expansions kept, with them replaced by nothing, and with the words after the string as `env`'s own words (a name set to an option or a program word stays unknown); the command that 0.5.0 read after any `env -S` string (it took the string for an option's value and went on with the words after it) is read too, so, with three exceptions (`nsenter` with an ambiguous `-S`/`-G` option in front of a glued or clustered string, a `gosu` wrapper in front, a `busybox` wrapper in front), no `env -S` form is read below it, and `env`'s own words are read as `env` reads them (after `--` a lone `-` is its `-i`; any word with a `=` in it is an assignment); `nsenter -S`/`-G` followed by a separate word are read both ways, however many; the readings the parser adds beside the text have budgets of their own, and a command that uses one up is refused (`command-too-complex-to-read`). A wrapper or runner that changes the directory or the root (`env -C`, `sudo -D`/`-R`, `chroot`, `nsenter`, `mise -C`, `npm --prefix`, `pnpm --dir`, `uv --directory`) is judged from `/` as well as from where the session is.
- **A protected path counts wherever the command names it.** Every word as written, the value of `name=value` and `--opt=value`, and a value glued to an option are tested, including a wrapper's or runner's own option value (`op run --env-file=.env`, `fakeroot -s .env`, `firejail --profile=.env`).
- **Code inside interpreters isn't parsed.** `python -c "shutil.rmtree('/')"` is review (script execution); the reviewer sees the code, but no rule reads it. The same holds for code fed on standard input and for a script file's contents.
- **tmux key sequences of several keys are reviewed, not read; typing into another terminal always asks.** `tmux send-keys` with one word reads that word as a command line; several keys typed at once (`send-keys ls Space -l Enter`) cannot be turned into the line they type, so the call is reviewed (`command-unreadable`) and, as every send, asked about (`terminal-input`), as is a command file a multiplexer is told to load. What `xdotool`, `kitty @ send-text` and the like type is not read, only asked about. tmux's control mode (`tmux -C`), which reads commands from standard input, is not read.
- **A reader whose output is piped on is judged by what follows it.** Only the programs listed under "a write to your plugin folders" count as readers there, so `ls ~/.claude/plugins | sed s/a/b/` or `| awk` asks, though neither writes.
- **`nix run` is judged by the app name only.** `nix run nixpkgs#curl -- …` is read as `curl …`; what the flake's app really runs is not known.
- **Encoded or downloaded payloads** (`base64 -d | sh`, `curl | sh`) are caught only as "piped into a shell" (review).
- **Shell symbolic links aren't resolved.** File-tool paths are resolved to their real path; paths in shell commands are not.
- **Two-sided glob intersection isn't computed.** A glob that names a protected file directly (`cat .en*`) is caught, but a glob with a wildcard in a middle segment against a protected `**` glob (`cat .github/*/ci.yml`) may not be.
- **Not every program that changes things is named.** The shipped rules cover the common ones; a cloud or database CLI, an HTTP write, an interpreter route or a command runner they don't list may pass. A listed runner is read through a table of its options: an option the table does not know is read as taking a value, and the call is reviewed (`shell-runner-unresolved`). Add a project rule, or propose a default.
- **Alternating verbs on one target are separate operations.** `rm build`, `trash build`, `find build -delete` and a script that deletes it each get their own rounds and their own failed attempts, since the key starts with the verb. Three refusals of `rm` do not lock out the fourth try with `trash`; the per-kind counter catches only retries of the same verb.
- **A `.sql` file's content isn't read by the block rules.** The database reviewer reads a `.sql` file a command names inside the project (`psql -h prod-db -f drop.sql`), but the rules classify the command without opening any file, so a destructive file run against production is reviewed, not blocked. Put a project rule on the command if a file must never run against a database.
- **POSIX only:** no Windows paths or PowerShell parsing. Windows is unsupported ([docs/INSTALL.md](../../docs/INSTALL.md)).
- **A text over 600,000 characters has an unscanned middle.** The secrets scan reads the first 500,000 characters and the last 100,000 of a call's text, each 512 characters further into the middle, so a secret only in the middle of a longer text is not found. The call is not passed on that account: a gated one comes to you, and an allowed one is refused (see [Secrets scan](#secrets-scan)).
- **A regex in a project rule runs before the file is confirmed.** The regexes of a project's `ask` and `block` rules and of `bigOperations` apply at once ([Trusting a project's rules file](#trusting-a-projects-rules-file)). A runaway one (catastrophic backtracking) stalls the hook, which then refuses the call (a hook that overruns its time fails closed: it cannot let one through). Read a repository's rules file before you open it in a session.
- **`git push.default` and other git configuration aren't read.** A push with no refspec is treated as a push of the checked-out branch (its preview is `@{upstream}..HEAD`), whatever `push.default` would send.
- **Long commands aren't parsed.** Commands longer than 20,000 characters, or nested more than four levels deep, go to review; and a command longer than its reviewer reads is never approved by a model alone (see [Long input](#long-input)).

## What it does not protect against

- Anything outside tool calls: what Claude says, files it reads, network requests other tools make.
- A mod that fails to load, a disabled mod, `disableAllHooks`, `--safe-mode` or `--bare`: then nothing is gated.
- **Bypass.** While `/council off` is on, every gated call passes, block-tier calls and the secrets scan included, until `/council on` or the session ends. An allowed call is not gated: the scan still refuses one that holds a high-confidence secret, or whose text is too long to scan in full, whatever the mode.
- **Diffs are built from the call, not from git.** The diff reviewer sees the change the call describes against the file as it stands when the hook runs; a file over 4 MiB, or one it can't read, is shown as the call's own text only, and the prompt says so.
- **The project checks run your project's code.** Claude can edit the tests and scripts they run (file edits go to the diff reviewer, not to you), so a passing check is only as good as the code it runs. They run as you, with your environment.
- **A push with no range to read.** For a branch the remote doesn't have yet, the range is read against the remote's default branch, which needs `<remote>/HEAD`: `git clone` sets it, `git remote add` does not (`git remote set-head origin -a` sets it). Without it, or for a push that names no remote, the diff reviewer sits out of that council and the preview shows no commits. The same goes for a refspec the mod cannot name safely (a source or destination with spaces, `..` or a wildcard): its commits are not shown, and the reviewers are told so. A push of `--all`, `--mirror` or `--tags` still shows the current branch's commits, not every ref it sends, and says so: "This push sends more branches or tags than the commits shown: only the current branch is listed, so what the others would send is unknown." The shipped rules block `--all` and `--mirror`, so in practice the note shows for `--tags`.
- **Git pointed elsewhere.** For a push or merge that runs git in another repository (`git -C`, `GIT_DIR=`, a `cd` out of the project), the mod does not read that repository: the preview shows no commits, the diff reviewer sits out of the council, and a merge counts as one into a protected branch.
- **The database reviewer sees only the SQL it can find**: inline `-c`/`-e` (and `sqlite3`'s `-cmd` and its statement after the database file), heredocs, and `.sql` files named in the command and inside the project. A migration tool's own migration files (`prisma migrate deploy`) are not looked up.
- A reviewer persuaded by content it reviews. All session content is marked as untrusted data and the prompt says to ignore instructions in it, but that is mitigation, not a guarantee.
- Rules you loosen, and calls you allow. An allow rule you add skips review, the ask tier and the secrets scan for that exact command; it does not follow a `cd` earlier in another command, so `rm -r build` is allowed in whichever folder Claude runs it.
- **Low-confidence secrets in allowed calls.** An allowed call is refused for a high-confidence secret, or for a text too long to scan in full, and for nothing else: a `password=…`-style assignment or a random-looking token in an allowed `curl` or `echo` passes without a question.
- **Secrets the patterns don't know.** The scan is patterns plus a randomness check. Low-confidence findings skip values that look like code (`process.env.X`, `getToken()`, `string`, `tokens[0]`), an identifier without a digit and hashes (`sha512-…`), so a password with no digit in a plain assignment can slip through the scan (redaction still hides it). A plain word of fewer than 6 letters (`token: token`, `password: reset`), a bare number under 6 digits, a call expression whose arguments hold no literal, and anything assigned to a variable named exactly `PWD` or `OLDPWD` whose value is a directory are read as code, not redacted and not flagged.
- **Two sessions in one project share one audit log without a lock.** Claude Code's file access has none, so lines can interleave or be lost; the report skips lines it cannot parse.
- **Several repositories: a command too long or too complex to parse** names no `cd` or path, so it is classified against the repository of the session's working directory only (it is reviewed at least). Two repositories' checks with the same name show under one name in the debate pane.
- **Operation keys are best effort.** A retry through a different tool (a script instead of `rm`) is a different operation; the per-kind counter catches only retries of the same verb. A command with more than eight gated parts is counted by the whole command and its first eight parts. A key names the verb and its targets, not the wording: a SQL client's inline statement, the text an `echo` writes to a file and the value of a push option are not part of it.
- A hook that overruns its time limit. The engine may run the call; Elrond refuses rather than pass with its budget nearly spent, but it can't act once it has run out.

## Adding a member

The council is three model reviewers (destructive operations, diffs, git and databases) and three
code members (the secrets scan, the read-only preview, the project checks). The spec caps the
model members at three, so adding one means replacing one, or adding a code member. The steps,
file by file, are in the development workflow:
[change-reviewer.md](../../.claude/skills/council-of-elrond-development/references/workflows/change-reviewer.md). In short: a member
supplies only its checklist (`system(nonce)`) and its prompt (`prompt(context, nonce)`); the
request, the deadline, token accounting and the strict verdict parse are shared, and every piece
of session content it sees is wrapped as untrusted data.

## Glossary

The names below are the project's own vocabulary, used in the code, the design documents and the
themed mode, which is the default. Plain mode says the plain meaning instead, everywhere you read.

| Name | Plain meaning |
| :- | :- |
| The council | The mod as a whole: the gate on tool calls. |
| Elrond | The chair: the code that classifies, routes, combines verdicts, escalates and logs. Not a reviewer. |
| Boromir | The proposer: the Claude session whose tool calls are gated. Not part of the mod. |
| Gandalf | The destructive-operations reviewer, and the fallback for anything no other reviewer takes. |
| Legolas | The diff reviewer, for file writes and edits. |
| Aragorn | The git reviewer and the database reviewer: one member with two profiles. |
| Gimli | The project checks: your tests, lint and typecheck, run alongside the full council. |
| Gollum | The secrets scan. |
| Galadriel | The read-only preview ("the mirror") of what a call would touch. |
| Full council | Every enabled reviewer at once, for a big operation. Themed: the Council of Elrond. |
| Ready check, council check | The band above the prompt while the full council sits: a row per reviewer and check, with its answer. |
| Round | One proposal and one verdict on the same operation. Two refusals, and the call comes to you. |
| Wipe | A failed attempt: a refusal, your "keep blocked", a call that ran and errored. The wipe counter shows them in the debate pane. |
| Lockout | Three failed attempts on one operation, or five on one kind: Claude is told to stop retrying. |
| Loot roll | The escalation question, in themed mode. Need, Pass, Greed and Parley are its labels: allow once, keep blocked, add to allowlist, talk first (you can also type an instruction). |
| Leeroy mode | Session bypass (`/council off`). |
| Shadow mode | Reviewers log their verdicts but never refuse. |
| Threat meter | Blocks per reviewer, in the debate pane. |
| Epic drop | The "Legendary commit acquired" row and toast after a push or merge passes the full council (themed mode only). |
| Plain mode | Every string in its plain variant; no theme names anywhere. Behaviour is identical. |

## Tests

```
claude plugin test ./mods/council-of-elrond
claude plugin validate ./mods/council-of-elrond
tsc -p ./mods
```

Contributor index: [docs/DEVELOPMENT.md](../../docs/DEVELOPMENT.md), which points into the development skill.
Installing, configuring and removing: [docs/INSTALL.md](../../docs/INSTALL.md).
