# Changelog

All notable changes to the mod are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/) and are the `version` field of
`mods/council-of-elrond/.claude-plugin/plugin.json`. Before 1.0.0, a minor bump may change
behaviour.

Each stage of the original build order (SPEC §20) landed as one pull request.

## [Unreleased]

### Added
- **`/council trust`, `/council trust <code>`, `/council untrust` and the option "Trust project rules
  files".** `trust` lists what a project's rules file would enable once confirmed, all of it, each
  setting in full with every field it has (each allow rule, disabled rule, model, check with
  every argument on its own line, and secret pattern; secrets allowlist entries counted, never shown),
  with the file's code, or says why the file cannot be confirmed from the session; `trust <code>`
  confirms the file with that code, as it stands now, only if it was listed in this session;
  `untrust` takes the confirmation back. Only a person's own
  command runs `trust`. The option `trustProjectRules` is `confirm` (default) or `always`. See the
  first entry under "Changed".
- **Rules per repository under one root.** When the session root is the parent of several
  repositories (no `rules.json` of its own, no `.git`), each repository directly below it can have
  its own `.claude/council-of-elrond/rules.json`. A call is decided by the repositories it touches
  (the directories it runs in and the paths it names), the strictest winning; protected paths and
  the project checks resolve against their repository, git runs there, and the audit line is
  written inside each repository touched. `rm -rf` of another repository is blocked. Approvals and
  chat codes stay within the repositories they were given for. Allow rules and the secrets allowlist
  are offered only for a call in one repository. A root that has a `rules.json`, or is a repository,
  behaves as before. See "Several repositories under one root" in the README.
- **More secret formats.** Refused as high-confidence: GitLab personal access tokens, npm tokens,
  Google OAuth client secrets, Slack webhook URLs and PGP private key blocks. Asked about as
  low-confidence: JWTs, `Authorization: Bearer` and `Basic` headers, a `mysql -p<password>`
  argument and a password in a connection string with no user (`redis://:<password>@host`).
- **A `kind` for your own secret patterns.** `gollum.patterns` entries in `rules.json` take an
  optional `kind`, `"password"` or `"token"` (the default). A `password` finding gets the
  allowlist warning; the shipped assignment, `mysql -p`, and connection-string password patterns are
  passwords.
- **A password warning in the allowlist confirm.** For a password-shaped finding, the second
  question adds that a short password's fingerprint can be guessed offline, so the allowlist is for
  keys and tokens.
- **"Talk first" in the escalation dialog** (themed "Parley: talk first"). It refuses the call and
  tells Claude to stop and talk it through with you, without counting as a failed attempt.
- **A new branch's push has a range.** When the remote does not have the branch yet, the preview's
  commits and the diff reviewer's diff are read against the remote's default branch
  (`<remote>/HEAD`) instead of being left out. Only for a push that names a remote; a fixed fallback
  that is tried once, never a fourth inspection.
- **Themed strings and a plain mode.** Member names, the escalation dialog, bypass and the wipe
  count have themed variants (Gandalf, Legolas, Aragorn, Gimli, Gollum, Galadriel, Elrond, the
  Council of Elrond), and a "Plain mode" option in `/config` (default off) switches every theme
  word off. Refusals Claude reads, the full council's reasons and the rule reason written to your
  rules file stay plain in both modes.
- **The loot roll.** The escalation dialog is headed "Loot roll" with the options "Need: allow
  once", "Pass: keep blocked" and, for one possible secret, "Greed: add to allowlist". Bypass is
  "Leeroy mode".
- **The debate pane.** A second pane (`council-debate`, "The debate" themed, "Council review"
  plain) shows your newest reviews: the call, each reviewer's verdict with a word beside every
  symbol, its reason and safer alternative, the project checks, and one line of flavour per
  reviewer in themed mode. It follows the agent in view, opens by itself once per session at the
  first model review, and `/council debate` opens it at any width.
- **The council check band.** While a full council sits, a band above the prompt (terminal and
  desktop) shows a row per reviewer and per check as each answers ("Ready check" themed).
- **The wipe counter and the threat meter** in the debate pane: refused or failed attempts since
  your last prompt, and each reviewer's blocks as a bar and a number.
- **The epic drop** (themed mode only): after a push or merge the full council approved and that
  ran, "Legendary commit acquired" as a toast and a band row for eight seconds.
- **`/council` answers through Claude where nothing draws.** In the cloud web client, `claude -p`
  and the SDK, nothing the mod draws reaches you, so when you type `/council` status, report, rules
  or test in the cloud web client, the same lines also go to Claude, fenced as the council's output
  and redacted line by line, with an instruction to repeat them to you in its next reply. A scoped
  exception to "command output never reaches Claude": no other subcommand, no command from a plugin
  or another session, and nothing at all where a surface draws. `/council rules` shows an exact-string allowlist entry as
  `(an exact string, not shown)`, not its first three characters. See "Where nothing
  draws" in the README.
- **A start notice where nothing draws.** The session starts with a row Claude reads, saying the
  council is active, that a call needing your approval is refused here with the reason, and how you
  can let it run (an allow rule in `rules.json` that you add yourself, or a terminal session).
- **Approve in chat where nothing draws.** When a call is refused because nobody can be asked, the
  refusal carries a code (`council:1a2b3c`) that Claude gives you; the start notice tells Claude to.
  Type `council allow 1a2b3c` on a line of your own to let that exact call run once,
  `council allow 1a2b3c session` to let it run for the rest of the session, or `council deny 1a2b3c`
  to refuse it (not a failed attempt). The line is removed from your message and Claude is told what
  it did. Only a person's own message counts (not `claude -p`, the SDK, a plugin or another
  session), a code is answered only in your next message, a once-allowance ends at your next prompt,
  and a protected path, a block rule or a high-confidence secret is never offered. The audit log
  records `chat-allow`, `chat-session` and `chat-deny`, and `/council report` counts the first two
  with the calls you allowed. The session record is now version 6; a version 4 or 5 record is read as 6,
  so an upgrade keeps its rounds and lockouts. See "Where nothing draws" in the README.
- **`sqlite3` joins the database reviewer's clients.** Its SQL is read from `-cmd`, from the
  statement after the database file (`sqlite3 app.db "DROP TABLE x"`) and from `-init` files.

### Changed
- **A project's rules file is ignored where it loosens the gate or runs code, until you confirm it.
  After upgrading, your `rules.json` is untrusted until you act.** A rules file arrives with a cloned
  repository and used to be honoured in full with nobody confirming it. Now its allow rules,
  `disableRules`, `models`, `gollum.patterns`, `gollum.allowlist` and `gimli.commands` take
  effect only after a person has confirmed that exact file content; until then they are as if absent
  (so a big operation whose project checks are among them is refused with "not run: the rules file is
  not trusted"), and its block, ask and review rules (which only add to what the shipped rules decide,
  see "Security"), protected paths, protected branches, production patterns and `bigOperations`
  still apply. **Two ways to get the old behaviour back:** run
  `/council trust`, read what it lists and type `/council trust <code>` (any change to the file makes
  it untrusted again, and `/council untrust` takes it back); or set the new option "Trust project
  rules files" to `always` (`trustProjectRules=always`) for a host whose owner controls which
  repositories it opens, such as a cloud or CI environment. The confirmation is kept in the plugin's
  own store, never in the repository. `/council rules` and `/council` show where each file stands; the
  mod does not offer an allow rule or allowlist entry for a file that waits, and after your own
  "Add the rule" or allowlist answer the file is trusted at its new content. See "Trusting a
  project's rules file" in the README.
- **After upgrading, expect more reviews and questions.** The stricter behaviours you will meet,
  each described under "Security":
  - A command whose program is a variable or a substitution is reviewed (the entry "A program name
    computed at run time is reviewed").
  - Plugin management commands (`claude plugin install`, `update`, `disable` and the like) ask (the
    entry "The mod protects itself").
  - A shell command that writes to, or may write to, your plugin folders asks; one that only reads
    them, or runs a script they hold, does not (the entry "The plugin folders ask for a write, not a
    read").
  - A shell command too long to review in full is never approved by a model alone and comes to you
    (the entry "A command too long to review is never approved by a model alone").
  - A force push whose branch cannot be read asks (the entry "A force push of the checked-out branch
    meets the protected-branch block").
  - A compound command shares its retry counts with its parts, so a locked-out part locks out the
    whole (the entry "Rounds, failed attempts and lockouts follow each part of a compound command").
- **An allow rule offered after "allow once" is narrower, and the question says what it allows.** A
  shell rule allows that exact command text, in any folder, without review. A file tool's rule allows
  every later write to that file by that tool, whatever it writes. A rule for any other tool allows that
  tool with exactly the same arguments (the input is pinned as its escaped JSON; no offer over 300
  characters; the call is classified again with the rule in place before it is offered). No rule is
  offered for a shell command with an unquoted `*`, `?`, `[`, `{` or `~` (any one counts; a quoted or
  escaped one is still offered), nor for a big operation, since a rule would skip the full council (with
  no current branch known, every merge counts as big). `council allow <code> session` is unavailable in
  the same cases, because a session allowance has the offer's limits. The rule's `reason` and the
  question say which kind of call it is.
- **A project rule's reason is shown as the project's text.** In a reviewer's prompt it sits inside a
  data block under a lead-in that says so (not after "Flagged because"), and in the dialog it is
  shown after the `|` bar, on one line of at most 200 characters. A shipped rule's reason is as it
  was.
- **The nobody-to-ask refusal says what was refused.** Where nothing draws and a call needs you, the
  refusal names the operation (the audit log's redacted key), the rule behind it and the reviewers
  by name, and tells Claude to tell you and how you can let the call run. Never the call's text, a
  preview, a secrets finding, a diff or a reviewer's reason. Still a failed attempt.
- **Protected paths hold at any depth.** The shipped CI, `.git`, `db/migrate` and
  `.claude/council-of-elrond` / `.claude/settings*.json` entries now start with `**/`, so they
  protect every repository below the session root, a rules file at any depth included, and the
  directory itself (`rm -rf app/.git`) asks. A directory named like a `**/migrations/**` entry now
  asks too.
- **Redaction keeps code.** A low-confidence match whose value is plainly code (`process.env.X`, a
  type, a call, an indexed lookup such as `tokens[0]`) is left as written in reviewer prompts,
  refusals and the audit log; any other value after a secret keyword is redacted, even one the scan
  does not flag (`password=correcthorse`).
- **`/council off`, `shadow on` and `model` only run when a person types them.** They loosen the
  gate, so a command from a plugin, another Claude session or a scheduled prompt is now refused
  with one line and changes nothing; `on`, `shadow off`, the `model` listing, `reload` and the
  rest answer from any origin.
- **`claude -p` and SDK prompts are no longer a person's.** The `sdk` prompt origin is the host's
  own turn, not typed at a terminal (the cloud web client arrives as `composer`). So in `claude -p`
  and the SDK `/council off`, `shadow on` and `model` are refused, a `/council` command gets no
  relay to Claude, and a prompt no longer resets the per-prompt counters (rounds, failed attempts,
  lockouts), which last until `/clear`. Any prompt not typed by a person, `sdk` included, clears
  the cached approvals.
- The default is now themed: `/council`, the dialog and the report name the characters, and the
  dialog's options read "Need: allow once" and "Pass: keep blocked". Turn on "Plain mode" in
  `/config` to keep the old text ("Allow once", "Keep blocked", role names).
- **README.** A "Modes" section (enforcing, shadow, bypass, plain), the install command under
  "Loading it", a note that subagents' calls are gated too, and bypass named among the limits.
- **Test fixtures.** Fake secrets in tests are built at run time from two halves, so no committed line holds a well-formed token.
- **Documentation.** The repository README, the maintainer and contributor guides, the GitHub
  notes and the three project skills are brought in step with the final deliverables: test
  counts, the three denial wordings, the fixtures' two-half fake tokens, and when 0.6.0 and 1.0
  happen.
- **Install guide for teams and the cloud.** `docs/INSTALL.md` now says that a project-scope install still needs one `claude plugin install` per collaborator, and has a "Cloud sessions" section: a repository's settings do not load plugins in a cloud session, so the cloud needs organization managed settings or a setup script. A cloud session has since been tried: the section gives the setup-script recipe (a pinned ref, loaded at session start, the options written to the user settings with `--config`) and what a cloud session does differently (nothing drawn, nobody to ask, one repository per environment), and the supported-hosts note lists the cloud as tested.
- **Types regenerated for Claude Code 2.1.299.** Drift: additive for every API the mod calls. Two
  engine changes found by probe: a hook that overruns its time budget, or blocks the hooks worker,
  is now cut off and its `.catch` asked; the mod refuses the call in both cases, as it already did
  for any failure before a call ran.
- **Types regenerated for Claude Code 2.1.304.** Drift: additive for every API the mod calls; the
  engine no longer asks a hook's `.catch` when it skips the hook for re-entry, which the mod never
  relied on. Nothing changes for users.
- **Types regenerated for Claude Code 2.1.308 and 2.1.322.** Drift: additive for every API the mod calls; `decider` on a `tool.check` verdict is gone, which the mod never used. Nothing changes for users.
- **`/council` no longer resets the review rounds.** A `/council` command you type keeps the
  current prompt's rounds, failed attempts and cached approvals, and the prompt the reviewers see,
  as they were. Other slash commands still start afresh.
- **A project check that can't start says why.** The refusal Claude reads now carries the engine's
  error, such as a program missing from the PATH, redacted and cut to one line. The audit log still
  keeps no check output.
- **Operation keys follow what a call does, not how it is worded.** A SQL client's inline SQL
  (`psql -c "…"`, `--command=…`, `mysql -e`) is no longer part of its key, so rewording a statement
  no longer starts a fresh set of rounds and failed attempts. A redirect write to a file keys on the
  file (`echo x > out.txt` and `echo y > out.txt` are one operation). `git push origin HEAD` is the
  same operation as `git push origin`, and `git push -o <value> origin main` the same as
  `git push origin main`. `psql -n` no longer swallows the next word. Counts stored under the old
  keys simply stop matching.
- **A switched-off diff reviewer named for a shell command is reported as off**, not as "no file to
  diff". The call is still reviewed by the destructive-operations reviewer.
- **`/council report`:** a council line in the audit log with no readable `voices` list adds no cost,
  instead of counting under a reviewer named `council`.


### Security
- **A repository's rules file can no longer loosen the gate or run code on its own say-so.** See the
  first entry under "Changed": its allow rules, disabled shipped rules, model choices,
  extra secret patterns, secrets allowlist and project checks wait for a person to confirm that exact
  content (a hash in the plugin's own store); a file that has not been confirmed can never make the
  gate weaker than no file, and a project check it names is reported as not run, never dropped.
  `/council trust` needs a person at the composer, as `/council off` does.
- **Confirming a rules file can no longer confirm settings you were not shown.** `/council trust`
  now lists every setting that waits (it used to show ten of each kind, then "and N more", and
  `trust <code>` confirmed them all), each in full, with every field it has, not cut and not redacted.
  A file that cannot be listed in full cannot be confirmed from the session, and the listing says
  why instead of giving a code: more than 40 settings waiting, a value over 400 characters, a value
  that looks like a secret, or a value with a control, invisible or direction-changing character in
  it. The code, now derived from a per-session secret as well as the file's hash, works only for
  content listed in this session, so a code worked out from the file, by Claude or anyone else who
  can read it, confirms nothing; and each listing is used up by the confirmation it leads to.
  `trustProjectRules=always` is unchanged. The session record gains the secret and the list of
  what was listed.
- **A project rule's reason is no longer said in the council's voice.** In Claude's refusal and in the
  audit line, the reason of a rule from the project's file, trusted or not, is introduced as "The
  project's rules file says", on one line of at most 200 characters, with control, invisible and
  direction-changing characters removed. Shipped rules' reasons are as they were.
- **The names in a rules file are short and plain.** A rule id, a secret pattern id and a check name
  are at most 64 characters, each a letter, a digit, `.`, `_` or `-`; a file with another name is
  invalid and ignored whole, like any other error, so such a name can no longer carry text into a
  refusal, a dialog or a listing.
- **A rules file nobody has confirmed can add protection, never replace a shipped decision.** An `ask`
  rule of such a file used to turn every call the shipped rules review (a push, a piped install
  script, a delete) into a bare question, with no reviewer, no preview, no council, a short excerpt and
  the file's own reason, and on a tie its reason and rule id replaced the shipped ones. Now the shipped
  decision is made first, as if the file had no rules, and stands: its tier, rule, reason, reviewer or
  full council, preview and checks. The file's rules only add: a `block` rule blocks; an `ask` rule puts
  a call the shipped rules let through to you, and, on a call they review, is asked only after the
  review approves (with the file's reason shown as the project's text; a revise or a block stands and
  you are not asked on top; never remembered; refused where nobody can be asked; in shadow mode too);
  a `review` rule, which now applies at once instead of waiting, reviews a call the shipped rules let
  through and changes nothing else. A file with nothing that waits is read the same way, since nobody
  can confirm it; a confirmed file, and the option `always`, decide first as before. The audit line
  keeps the shipped `ruleId` and lists the file's rules that only added in the new field
  `alsoRuleIds`. `/council trust` no longer lists review rules among what waits. The counts in the
  status, notice and trust lines say "allow rule(s)", and those lines say that the file's block, ask
  and review rules apply and only add to what the shipped rules decide. The question put after a review
  approved because such a rule asks has its own words ("The project's rules file asks you about this
  call too, after its review."), and `/council rules` lists the paths protected against writes
  ("Protected against writes") apart from the protected paths.
- **The plugin folders ask for a write, not a read.** The protection of `**/.claude/plugins/**` made
  every shell mention of it ask, so `cat ~/.claude/plugins/x/README.md`, `ls ~/.claude/plugins/` and
  running a plugin skill's own script asked on each call. The folders are now on a second, built-in
  list, for writes only (not a field of the rules file). A `Write`, `Edit` or `NotebookEdit` of a file
  there asks, as does a shell command that names the folder unless it only reads it (`cat`, `head`,
  `tail`, `less`, `more`, `bat`, `ls`, `tree`, `stat`, `file`, `wc`, `du`, `find`, `grep` and its kin,
  `rg`, `ag`, `diff`, `cmp`, `sort`, `uniq`, `cut`, `jq`, `yq`, the checksum tools, `realpath`,
  `readlink`, `basename`, `dirname`, `test`, `[`, `cd`, `pushd`; not `find -delete` or `-exec`, `jq
  --in-place`, `yq -i`, `sort -o`, `tree -o`, `less -o`, `file -C`, a redirect into the folder) or runs
  what it holds (the program written as a path, or the script an interpreter or shell is given), which
  the ordinary rules judge as before (a script is reviewed). `cp`, `mv`, `rm`, `tee`, `sed -i`, `ln`,
  `chmod`, `touch`, `install`, `rsync`, `tar`, `git -C`, an unknown program and a redirect target ask.
  The protection of these folders is new in this release, so against the last release nothing is
  looser. A path that is protected proper (`.env`, `.git`,
  the settings files, the rules file) asks for any mention.
- **More classifier gaps are closed.** Recursive `rm` is blocked when `--recursive` or
  `--no-preserve-root` is written as a unique prefix, for another user's home (`~user`) and for a
  defaulted home expansion (`${HOME:-/}`); a write to a disk device is blocked when the device is
  written with extra slashes or dots, or relative to a folder the command first enters. The force and
  delete flags of `git push` are read as git reads them (clusters with digits or other letters, long
  options by unique prefix); a force push whose destination is computed asks; a force push after a
  command in the same call that can switch the current branch (checkout, switch, reset and the like, an
  unknown git subcommand, or code that is not read) asks, while a protected branch read before the call
  still blocks; `git send-pack` and `hub push` are read like `git push`; `git subtree push`,
  `git lfs push` and `jj git push` are reviewed. Code fed to an interpreter through `/dev/stdin`, a
  descriptor path, a process substitution or `<&0` is reviewed; the option tables were completed, and
  an option the tool does not know on a fed interpreter is reviewed; more interpreters and inline-code
  flags are covered; `python -m` of a module that runs the code it is given (`code`, `asyncio`,
  `timeit`, `pdb`, `runpy`, `idlelib`, `IPython`, `ptpython`, `bpython`) is reviewed.
- **Command lines handed to other programs are classified like `sh -c`.** `tmux` (`send-keys`,
  `run-shell`, `if-shell`, `respawn-window`, `display-popup`, `pipe-pane`, `set-hook`,
  `confirm-before`, `bind-key`, `\;` lists, unique command prefixes), `screen`, `zellij`,
  `nix develop|shell|run`, `git submodule foreach`, `git bisect run`, `git rebase --exec`, the filters
  of `git filter-branch`, `find -exec` and `-ok`, `entr` and `parallel`. A key sequence or a command
  file that cannot be read is reviewed (new rule `command-unreadable`).
- **More forms are reviewed.** `curl` data options attached or clustered and methods other than GET,
  `wget` and HTTPie bodies, `gh` writes, more `git rm`, `git checkout` of paths,
  `git switch --discard-changes` and `git branch -df`, `awk` and `sed` that run commands or write
  files, more cloud deletes, and `tar` or `unzip` extracting outside the project (new rule
  `extract-outside-project`, reviewed only when extracting).
- **The mod protects itself further.** `plugin-manage` sees global options before `plugin`, options
  between its words, the CLI's short aliases and `npx @anthropic-ai/claude-code@<version>`. A new ask
  rule, `claude-session`, covers starting a nested Claude Code session (`-p`, `--bare`, `--settings`,
  `--plugin-dir`, a permission bypass, `CLAUDE_*` assignments) and `claude mcp add|remove`,
  `claude config set`.
- **A shipped pattern that was slow on long input is now linear.**
- **A reformatted command is reviewed again.** An approval used to be reused for a later command that differed only in whitespace. Whitespace can change what a shell command does, so the verdict cache and chat approvals now match a command exactly.
- **A heredoc body is read when the shell expands it.** With an unquoted delimiter (`<<EOF`,
  `<<-EOF`) the shell runs the `$(...)` and backticks in the body; those commands are now classified
  like any other part, so a delete or force push inside one is blocked or reviewed as usual. A quoted
  delimiter (`<<'EOF'`, `<<"EOF"`, `<<\EOF`) keeps the body as plain data, as before.
- **More wrappers show the command they run.** `chrt`, `taskset` and `setarch` (their priority, mask
  or architecture is skipped), `exec -a name` and `exec -la name`, `env -S'...'` and `env -vS ...`,
  `busybox` and `toybox` (the applet is the command), `fakeroot`, `firejail`, `systemd-run`,
  `op run`, `doppler run` and `mise exec`. The command strings of `script -c`, `nix-shell --run`,
  `--command` and the `tmux` subcommands that start a command (`new-session`, `new-window`,
  `split-window`, `respawn-pane`) are classified like `sh -c`. The package runners (`npm exec`,
  `uv run`, `conda run` and the rest) now skip their own flags correctly (`npm exec --yes <cmd>`,
  `conda run --no-capture-output <cmd>`), so the command after them is still seen. When a runner's
  options cannot be read with certainty, the call is reviewed (`shell-runner-unresolved`) and the
  inner command keeps its own tier if that is stricter.
- **A program name computed at run time is reviewed** (`shell-dynamic-program`): a variable, `${...}`
  or a substitution in the program position means the program is not known. An unquoted `$IFS` or
  `${IFS}` is now read as a space, so a command written with it reaches its rule.
- **Code fed to an interpreter without a flag is reviewed** (`script-stdin`): `python3`, `node`,
  `deno`, `bun`, `perl`, `ruby`, `php`, `Rscript` or `lua` given no script and reading a pipe, a
  heredoc, a here-string or a `<` redirect. A named script, `python3 -m module`, and a version or help
  flag are unchanged.
- **Inline code flags are matched attached and in clusters** (`script-inline`): `python3 -c'...'`,
  `python3 -Bc '...'`, `perl -ne`, `-pe`, `-E`, `ruby -ne`, `-pe`, `node -pe`, `--eval=...`,
  `--print=...`, `-e'...'` and `php -r'...'`.
- **The mod protects itself.** `claude plugin disable|uninstall|remove|rm|update|install|enable` and
  `claude plugin marketplace add|remove|rm|update` now ask (`plugin-manage`); `claude plugin test`,
  `validate`, `list` and `eval` do not. Your plugin folders (`**/.claude/plugins/**`) are protected
  paths like `.claude/settings.json`, which already covered `~/.claude/settings.json` and
  `~/.claude/settings.local.json`. (Amended below: the plugin folders are protected against writes
  only.)
- **Allowed calls are scanned for high-confidence secrets.** A literal key in an allowed `curl` or
  `echo` used to reach the network or the transcript unscanned; it is now refused, as on a gated
  call, and logged with tier `allow` so `/council report` counts it. Low-confidence findings on an
  allowed call still pass: the mod never asks on an allowed call.
- **No preview where git would run elsewhere.** The preview, the diff reviewer's read and a merge's
  current-branch check now skip a call that points git at another repository: `GIT_DIR=`,
  `GIT_WORK_TREE=` and the other location variables (also from an earlier `export` or `env`),
  `--namespace`, or a `cd` to a folder outside the project or one the mod cannot name (`cd $X`). The
  diff reviewer then sits out ("not asked: the changes could not be read"), and a merge whose branch is
  unknown counts as a merge into a protected branch, so it goes to the full council.
- **The mod's own git starts no configured program.** The write preview's `git diff --stat` turns off
  external diff drivers and textconv filters, and every git the mod runs switches off `core.fsmonitor`
  and `log.showSignature` (which runs the configured gpg program).
- **A command too long to review is never approved by a model alone.** A reviewer reads at most 200
  lines or 12,000 characters of a shell command (40 lines or 4,000 characters of the push or merge
  command a diff reviewer quotes). Past that, an approve no longer lets the call run: it comes to
  you with "The command was too long to review in full", or is refused where nobody can be asked,
  exactly as a call with no verdict is. The approve is not remembered, and the audit line shows the
  reviewer's approve with that reason. A revise or a block still stands, and a long file or diff is
  not held back (its reviewer is told, below). In the full council it applies when every member
  approves and one of them saw only part of the command.
- **Cut input keeps both ends, and reviewers are told what was left out.** Input over a limit used
  to keep its start and end with `[... truncated]`, and no reviewer was told what that meant. It now
  keeps about two thirds from the start and one third from the end, with one line saying how many
  lines and characters are missing. Every reviewer's instructions say that what was left out has not
  been seen and is not to be assumed safe: approve only when the rest is low-risk, otherwise ask for
  the change in smaller pieces. A note from the council, outside the quoted material, says when and
  by how much a block was cut, so a marker typed into a command or a file means nothing.
- **Secrets are redacted before a cut, not after.** A script, a `.sql` file, the changes a push would
  send, the read-only preview and a file's diff were cut first, so a secret that straddled the cut no
  longer matched its pattern and a piece of it reached the reviewer. They are redacted whole first.
- **Left-out context is named.** A `.sql` file the call names that is outside the project, missing or
  unreadable (or past the three the reviewer reads), and a script the call runs that was not written
  through a file tool this session or could not be read, are now said so in one line of the prompt,
  where they used to be left out without a word.
- **The question shows call text behind a gutter.** Every line of the call and the preview in the
  escalation question starts with `  | ` and has control characters removed, so text in a command
  cannot imitate a line of the dialog (a reviewer's verdict, a heading). A reviewer's reason, a
  problem and a secret snippet are kept to one line. A long call or preview shows its start and its
  end with the amount not shown, within the same 12 lines and 600 characters as before.
- **A malformed verdict echoes less.** The names of unexpected fields in a reviewer's reply are
  capped (three, 40 characters each, control characters removed) before they reach a dialog, a
  refusal or the log.
- **More secrets are redacted, without blanking ordinary code.** A value is treated as a placeholder only when all of it is one (`$NAME`, `${NAME}`, `${1:-default}`, `<your-key>`, `{{ ... }}`, `****`, a call expression such as `getToken()` or `z.string().min(8)`, an indexed lookup such as `tokens[0]`); a literal that merely starts with such a character (`$ecret123!`, `Sup3r(Secret)9`, `<realkey12345>`, `(hunter2xyz)`) is redacted and reported. Quoted passwords containing spaces, shorter values, `curl -u user:password`, `--password` for the database clients already known, and `Authorization: Token`, `X-Api-Key` and `X-Auth-Token` headers are now covered. A value of 4 or 5 characters counts only when it holds a digit or a character other than letters, `_` and `.`; a plain word needs 6, as before. Not secrets: a bare number under 6 digits, a path or a backtick substitution under 6 characters, and anything assigned to a variable named exactly `PWD` or `OLDPWD`. Text longer than the scan limit also has its end scanned, and is no longer passed silently (see below). Ordinary code that only names a secret (`{ token: token }`, `this.token = token`, `export PWD=/tmp`, `z.string().min(8)`) is left readable and is not asked about.
- **A project's own secret patterns are applied wherever the mod redacts.** Once a rules file is
  confirmed, its `gollum.patterns` were applied to what reviewers read and to the debate pane, but not
  to the operation key, the audit line, the refusal Claude reads or the dialog's second pass. They are
  now, and the audit line also redacts its operation key, which a file path or a push URL can hold a
  token in.
- **The scan reads more of a call.** A shell call's `description`, a file tool's path (as well as what
  it writes), and the whole input of every other tool (a fetch's URL, an agent's prompt, a search
  pattern), not only an MCP call's, are scanned for secrets.
- **A text too long to scan in full is no longer passed silently.** The secrets scan reads the first
  500,000 and the last 100,000 characters of a text. Over 600,000 characters, a gated call now comes
  to you with the reason that it is too long for the scan to read in full (never remembered, no allow
  rule offered), and is refused where nobody can be asked; an allowed call is refused and logged, as a
  high-confidence finding is. Shadow mode does not change it, and bypass skips it for a gated call only.
- **`/council rules` shows no character of an allowlisted secret.** An exact-string allowlist entry
  was shown to you as its first three characters (Claude was already shown none); it is now
  `(an exact string, not shown)` in both. A `sha256:` fingerprint is still shown.
- **The question hides invisible characters, wraps long lines and keeps its closing lines.** Direction
  marks and overrides, zero-width characters and the byte order mark are removed from the call, a
  reviewer's reason, a rule's reason and a finding, as control characters were. A call line over 100
  characters wraps, and every row of it starts with the gutter. When the question is over its size cap,
  the end of the call goes first, then the end of the preview, then each reviewer's reason is cut to
  its share; the question's own lines and every reviewer's verdict stay (the old cap cut the end of
  the question, where the closing lines and the last reviewers were).
- **A force push of the checked-out branch meets the protected-branch block.** A force push that
  names no branch, or only `HEAD` (`git push --force`, `-f`, `-f origin`, `-f origin HEAD`,
  `origin +HEAD`), overwrites the current branch, so the mod reads the branch checked out where the
  push runs (only for such a push, in the folder it runs in, with the same git protections as the
  previews) and blocks it when it matches your protected branches. When that branch cannot be
  determined (a detached HEAD, git failing or timing out, git pointed elsewhere, more than three
  folders), it asks (`force-push-unknown-branch`). On another branch it is reviewed as before.
  `--force-if-includes` now counts as a force flag. `/council test` does not read the branch, so it
  shows such a push as asked about.
- **A push's preview and range diff show what is pushed.** The commits the preview lists and the
  changes the diff reviewer reads are read per refspec (the first three), from its own source
  against the remote branch it lands on: `git push origin other:main` shows `origin/main..other`, `git push origin a b` shows both.
  A delete shows none. A refspec the mod cannot name safely, a range git cannot read, no remote that
  is a plain name, or more than three refspecs is said in the preview and in a line the reviewers
  read outside the preview, so they never take the checked-out branch's commits for the push's.
  The operation key of a push is unchanged.
- **Rounds, failed attempts and lockouts follow each part of a compound command.** A command made of
  several gated parts used to be one operation as a whole, so the same part inside another
  combination started again with no failed attempts and fresh review rounds. Each gated part now has
  a key of its own (the key a call of that part alone has), and so does each part's verb. A failed
  attempt counts on the whole call, on each part and on each verb of the call; a review round on the
  whole call and each part. A call is locked out when its whole key or any part's key reached three
  failed attempts, or any verb in it reached five; it goes to you without a model call when its
  whole key or any part has used its two rounds. Your typed instruction gives the whole call its
  rounds back, and a call that ran clears its whole key; neither touches a part's key or the verb
  counters, so a part keeps what a call of that part alone has used. The status and the debate
  pane count a locked verb as locked out. The first eight
  gated parts of a call have part keys, so a long command cannot grow the session record. Existing
  counts and lockouts are kept. A call of one part, a file tool or another tool counts as before.
- **A push of every branch or tag says so in the preview.** `git push --all`, `--mirror` or `--tags`
  with no refspec still lists the current branch's commits, and now adds a line, in the preview and
  to every reviewer outside the preview, that the push sends more branches or tags than the commits
  shown.
- **A protected path named as the value of a wrapper or runner option asks again.** (`op run
  --env-file=.env`, `mise x -C .git`, `fakeroot -s .env`, `firejail --profile=.env`; an earlier change
  in this release had stopped seeing it.) The same now holds for `uv run --env-file`, `npm exec
  --userconfig`, `pnpm exec --dir`, `dd of=` and `NAME=path`. Wrapper and runner options are read as
  the program reads them: clusters letter by letter (`timeout -vs KILL 5 …`, `env -iu NAME …`), long
  options by unique prefix, global options before a runner's subcommand (`pnpm -r exec`, `npm -s
  exec`, `yarn workspace web exec`, `uv -q run`). An option the tables do not list sends the call to
  review. A wrapper or runner that changes the directory or root (`env -C`, `sudo -D`/`-R`, `chroot`,
  `nsenter`, `mise -C`, `npm --prefix`, `pnpm --dir`, `uv --directory`) is also judged from `/`. A
  `cd` inside a subshell, group or `$(…)` moves the folder for the later commands of that level. A
  program word the shell builds at run time, by a glob, a bracket or a brace list as well as a
  variable, is reviewed; a flat literal brace list is read as the command it expands to. A command
  substitution inside unquoted `$(( … ))` is classified. `uv run -m` and `poetry run -v` no longer
  cause a review.
- **An approval holds in the folder it was given in.** A reviewer's approve, kept until your next
  prompt, and a chat `council allow` (once or for the session) used to be matched on the call alone,
  and the session's working directory follows a `cd` between commands, so an approved `rm -rf build`
  in one folder ran unreviewed in another. Both are now matched on the call and the folder (and, under
  a multi-repository root, the repositories it touches). The audit line's fingerprint is unchanged.
- **The full council's approve is never remembered, and neither is any call with a `git` part.** A
  repeated big operation (a push, a migration) convenes the council and runs your project's checks
  again. A call that has a `git` part (gated or not) is never served from the approve cache and its
  approve is not cached, since the checked-out branch and the index are not part of what the call
  says: an approved `git reset --hard` is reviewed again on repeat. The same call without git, in the
  same folder, is still reviewed once.
- **The cache and the rounds are read just before they are used.** Two calls running at once now see
  each other's approve and spent rounds, where each used the snapshot taken when its own hook began.
- **A script or SQL file that was cut is not approved by a model alone.** A script the call runs, or
  a `.sql` file or inline SQL it executes, longer than its reviewer reads is code that will run and
  that no reviewer saw in full. Like a cut command, an approve of such a call comes to you ("The
  command, or a script or SQL file it runs, was too long to review in full"), is refused where
  nobody can be asked, is never remembered, and the audit line says why. A long file written with a
  file tool is unchanged.
- **The retry brake follows a long compound command and its force pushes.** A shell command with more
  than eight gated parts is no longer reviewed by a model: only the first eight have keys of their
  own, so a locked-out part placed ninth was neither locked nor out of rounds. It comes to you ("too
  many separate gated parts to track; split it"), is refused where nobody can be asked, and is never
  remembered. The per-kind failed-attempt counters stop growing at 200 kinds: a new kind then counts
  on one shared counter that locks at five, and nothing counted is dropped. A force or delete push
  keeps a retry count of its own, which a plain push of the same branch never clears (before, two
  revised force pushes and one successful plain push gave the next force push fresh rounds).
- **A push's preview says when it may be stale.** When a push follows another command of its call
  (`git commit -am x && git push`, `git checkout main && git push`), the commits shown were read
  before the earlier commands ran. The preview is kept and a line, in the preview and to every
  reviewer outside it, says so.

### Fixed
- **The status line is cleared when its surface leaves.** A label set for a phone or VS Code
  (`council: shadow`) used to stay after that client detached; it is now cleared, and set again when
  a client attaches.
- **A failed allowlist write is no longer a failed attempt.** When the entry could not be written
  the call stays blocked, with the transcript line and a reason that says the entry could not be
  written (not that you chose to keep it blocked), but the failure is the mod's and no longer
  counts toward a lockout. Cancelling the confirm still counts.
- **A malformed stored session no longer denies every call until `/clear`.** The record's shape is
  checked, not only its version; a value of the wrong shape is read as a fresh session (one debug
  line says so), and the call is reviewed and decided as usual.
- **The audit log rotates by bytes.** With multibyte text in the log the size check counted
  characters, so the log could rotate without moving `.1` to `.2`, and lose a file of lines.
- **A hanging audit write no longer holds up later calls.** The audit line is queued and written
  in order after the call, and nothing waits for it, so a write that never returns holds back only
  the lines queued after it. `/council log` and `/council report` may not show a line still waiting.
- **A council check no longer outlives a failed review.** When the full council failed part-way,
  the project checks it had started now end at once instead of running to their own timeouts, up
  to ten minutes.
- **Parallel calls see each other's failed attempts and spent tokens.** The lockout and the token
  budget are decided on a fresh read of the session, so calls running together on one operation
  are less likely to all pass a limit that one of them reaches.
- **Compound secret names are caught.** `DB_PASSWORD=…`, `POSTGRES_PASSWORD=…`,
  `PGPASSWORD=…`, `GITHUB_TOKEN=…` and `dbPassword: "…"` are now low-confidence findings and are
  redacted; before, only a bare keyword before `=` or `:` was.
- **Claude Code's "Chat about this" was meant not to count as a failed attempt, but the mod cannot
  tell it from a dismissal** (Claude Code sends both the same way), so it was always counted. It
  now counts as a dismissal, documented; "Talk first" is the way to stop without one.
- **A third automatic-denial wording is recognised.** Claude Code's "This command requires approval" (seen on 2.1.294 in `-p`) now reads as `denied-by-permission`, so it never counts as a failed attempt, instead of as an ordinary tool error.
- **A deny rule on a file is read as an automatic denial.** Claude Code's "Permission to edit …
  has been denied" and "Permission to read … has been denied" (read from the 2.1.296 binary) now
  read as `denied-by-permission`, like "Permission to use … has been denied", so they never count
  as a failed attempt; before, they were ordinary tool errors.
- **A failure in the prompt hook no longer risks the mod.** The mod's prompt hook now has its own
  error handler, so if it fails the prompt goes through as typed and the mod stays loaded.
- **The diff reviewer sees the whole change of an `Edit` that carries an `edits` array**, instead of
  an empty or partial diff.
- **Diffs read as git writes them.** A new file starts at `-0,0`, CRLF files show without stray `\r`,
  a change of line endings alone is named, and a missing newline at the end of a file is marked.
- **A reviewer's `safer_alternative` is cut to 400 characters**, as its reason already was.
- **Git previews follow a `cd`.** A push, merge, reset or rebase after a `cd` into a folder inside the
  project is previewed in that folder (links are resolved, and a folder that really lies outside the
  project is not used), including the diff the full council's diff reviewer reads and the branch a
  merge is checked against.
- **`git push -o`, `--push-option` and `--receive-pack` values are read as values.** The preview and the
  diff reviewer no longer take `ci.skip` in `git push -o ci.skip origin main` for the remote.
- **A quoted delete target** is previewed under its own name (a name with literal quote characters keeps
  them).

## [0.5.0] - 2026-10-08

A hardening release closing the rules-tier and pipeline findings of the end-of-Stage-5 review
([docs/REVIEW-2026-10.md](docs/REVIEW-2026-10.md)), plus the project's open-source scaffolding.
No new features; the theme and UI (Stage 6) are still to come.

### Security
Every item below could let a tool call reach a weaker tier than intended; the rules tier is the
safety boundary. Each fix ships with a test using the input it closes.
- **Shell constructs no longer hide a command.** A function body, a `case` arm or a `coproc`, and
  a program name written with an empty substitution, locale-translation quoting or ANSI-C escapes,
  are now classified as the command the shell runs.
- **Wrappers and runners reveal the command they run.** Package-manager runners (npm exec, poetry
  run and the like), process wrappers (setsid, strace, chroot, flock, nsenter and others) and
  env's environment-clearing and split-string options are stripped; privilege-changing wrappers
  (gosu, runuser, setpriv, run0, chpst, pkexec) also ask. New shipped rules cover rimraf and the
  trash tools, `find -ok`, `parallel`, and remote or in-container execution (ssh, docker/kubectl
  exec, docker run, rsync -e).
- **Global options before a subcommand** no longer defeat the kubectl, helm, docker and terraform
  rules.
- **Git configuration and environment-variable injection** are reviewed: `git config` writes,
  dangerous `git -c` keys, `--exec-path`, `bisect run`, and leading assignments of LD_PRELOAD,
  GIT_SSH_COMMAND, NODE_OPTIONS and similar.
- **Protected paths** now cover the protected directory itself (not only its contents), match
  case-insensitively, and catch a targeted glob that could name a protected file.
- **Block rules that stopped one tier short** now block: mirror, prune and glob-destination
  pushes, brace-expanded rm flags, a wider raw-disk device and tool set (redirects, cp, tee,
  shred, blkdiscard, the mkfs family), `sh -c --`, and pkexec of a blocked command.
- **Secrets no longer reach the audit log** through the operation key, which is now redacted.
- **The approve cache** hashes file content exactly (whitespace is collapsed only for shell
  commands), so a re-indented write is not reused unreviewed.
- **The allow rule offered after "allow once"** forbids the sandbox-disabled variant of the same
  command.
- **Reviewer prompts** sanitise call-derived labels (a file path, a SQL piece's name), so they
  cannot forge prompt lines outside the untrusted-data block.
- **Esc during a review** refuses plainly with no failed attempt, round or dialog; a new prompt
  arriving mid-review cannot have a stale round, wipe or cached approve written into it.

### Added
- Stage 5 ([Deluha/council-of-elrond#5](https://github.com/Deluha/council-of-elrond/pull/5)):
  an allow rule offered after "allow once", once the call has run, written to `rules.json` only
  on "Add the rule"; `/council report` over the audit log and its rotated files (most refused,
  stopped then allowed, shadow verdicts, cost and median review time per reviewer); the
  `reviewMs` audit field; one shared, validating writer for `rules.json`.
- Project documentation for contributors and maintainers: `CONTRIBUTING.md`, `SECURITY.md`,
  `CODE_OF_CONDUCT.md`, `SUPPORT.md`, this changelog, issue and pull request templates, CI and a
  release workflow, git hooks, CODEOWNERS, a marketplace manifest, `docs/`.
- `mods/types/NOTICE.md` states what the vendored API declarations are and that the MIT licence
  makes no claim over them.

## [0.4.0] - 2026-10-05

Stage 4 ([Deluha/council-of-elrond#4](https://github.com/Deluha/council-of-elrond/pull/4)).

### Added
- The full council for big operations (`git push`, a merge into a protected branch, a database
  migration; `bigOperations` in `rules.json`): every enabled reviewer sits at once on one model
  under one deadline, strictest verdict wins, each objection labelled.
- Project checks (Gimli): `gimli.commands` from `rules.json` run alongside the council by argv
  with no shell, each with its own timeout; a failure blocks and Claude gets the last 20 lines.
- The diff reviewer reviews the range a push would send or a merge would bring in.
- `/config` rows: full council on/off, its model, one at a time, project checks on/off.
- The audit line's `council` field (what made it big, each voice, each check).

### Changed
- A mixed compound command that contains a big operation goes to the full council; other mixed
  commands stay with Gandalf.

## [0.3.0] - 2026-10-05

Stage 3 ([Deluha/council-of-elrond#3](https://github.com/Deluha/council-of-elrond/pull/3)).

### Added
- Legolas, the diff reviewer: a diff built from the call against the file as it stands (Edit,
  Write, NotebookEdit), cut to the diff line limit.
- Aragorn with two profiles: git (push, merge, rebase, reset, tag, amend) and database (SQL
  clients, migrations, `.sql` files inside the project, production patterns).
- Routing: the rule's member and profile decide, Gandalf is the fallback; `/council test` prints
  the fallback and why.
- `/config` rows for Legolas and Aragorn (enabled, model) and the diff line limit.
- Previews for `git merge` and `git commit --amend`.

### Fixed
- A reviewer's reason containing a file name was cut at the dot.

## [0.2.0] - 2026-10-05

Stage 2 ([Deluha/council-of-elrond#2](https://github.com/Deluha/council-of-elrond/pull/2)).

### Added
- Gollum, the secrets scan: high-confidence findings refused, low-confidence ones asked, an
  allowlist of fingerprints written only after a second confirmation.
- Galadriel, the read-only preview from a fixed command table.
- Operation keys, review rounds, failed attempts and lockout; the approve cache until the next
  prompt.
- The `/council` command: status, `off`/`on`, `shadow`, `log`, `rules`, `test`, `model`, `reload`.
- Shadow mode (session switch and `/config`), the mode label by the prompt.
- The user's own refusal at Claude Code's permission prompt counts as a failed attempt; an
  automatic denial does not.

## [0.1.0] - 2026-10-05

Stage 1 ([Deluha/council-of-elrond#1](https://github.com/Deluha/council-of-elrond/pull/1)).

### Added
- Elrond's pipeline on `tool.call`: the rules tier (allow, review, ask, block; compound commands
  split; protected paths), Gandalf as the single reviewer, escalation to the user with allow once,
  keep blocked and a typed instruction, fail-closed handling, and the JSONL audit log with
  rotation. Plain mode only.

[Unreleased]: https://github.com/Deluha/council-of-elrond/compare/council-of-elrond--v0.5.0...HEAD
[0.5.0]: https://github.com/Deluha/council-of-elrond/compare/0.4.0...council-of-elrond--v0.5.0
[0.4.0]: https://github.com/Deluha/council-of-elrond/pull/4
[0.3.0]: https://github.com/Deluha/council-of-elrond/pull/3
[0.2.0]: https://github.com/Deluha/council-of-elrond/pull/2
[0.1.0]: https://github.com/Deluha/council-of-elrond/pull/1
