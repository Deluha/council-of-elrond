# Changelog

All notable changes to the mod are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/) and are the `version` field of
`mods/council-of-elrond/.claude-plugin/plugin.json`. Before 1.0.0, a minor bump may change
behaviour.

Each stage of the original build order (SPEC §20) landed as one pull request.

## [Unreleased]

### Upgrading from 0.5.0
- **An existing project rules file needs one confirmation.** A rules file arrives with a cloned repository; it used to
  be honoured in full. Until a person confirms that exact content, its allow rules, `disableRules`, `models`,
  `gollum.patterns`, `gollum.allowlist` and `gimli.commands` are ignored, and a big operation whose project checks are
  among them is refused ("not run: the rules file is not trusted"). Confirm with `/council trust` (read what it lists,
  then type `/council trust <code>`), or set the new option "Trust project rules files" to `always`
  (`trustProjectRules=always`) for a host whose owner controls which repositories it opens, such as a cloud or CI
  environment. Where nothing draws, only the option works. Any change to the file untrusts it again.
- **Names and sizes in a rules file are limited.** A rule id, a secret pattern id and a check name are at most 64
  characters of `[A-Za-z0-9._-]`; a regex is at most 1,000 characters; a file holds at most 200 rules and 200 secret
  patterns. A file that breaks a limit, or any other check, is partly applied (see "Security"), not ignored whole.
- **More calls are reviewed or asked about:** a program word computed at run time, a wrapper or runner option the
  tables do not list, and code fed to an interpreter without a flag (reviewed); `claude plugin install`, `update`,
  `disable` and the like, a nested Claude Code session, typing into another terminal such as `tmux send-keys`, a shell
  command that writes or may write a plugin folder, and a protected path at any depth or named as a wrapper or runner
  option's value (ask; a read of a plugin folder does not); a force push whose branch is unknown, computed or may have
  moved (asks; one of a protected checked-out branch is blocked); a shell command, script or SQL file too long for its
  reviewer, a command with more than eight gated parts and a text too long for the secrets scan (they come to you,
  never to a model alone).
- **A crafted command can now be refused outright** (`command-too-complex-to-read`): one whose split strings repeat
  a wrapper thousands of times, or whose split strings, second readings or nested scripts hold more commands, or nest
  deeper, than the readings the parser adds are allowed (see "Changed", which also names the few honest but extreme
  commands that were reviewed and are now refused, and what to do). Nothing ordinary meets it.
- **Repeats are reviewed again.** The full council's approve is never remembered, so a repeated push or migration
  convenes it, and runs your checks, each time. A call with a git part, one that runs a script or a project's runner,
  and one reformatted in whitespace are reviewed again too; an approval holds only in the folder it was given in.
- **`/council off`, `shadow on`, `model`, `trust` and `reload` need a person at the prompt.** From a plugin, another
  session, a scheduled prompt, `claude -p` or the SDK they are refused. A `claude -p` or SDK prompt is not a person's:
  it does not reset the per-prompt counters (rounds, failed attempts, lockouts), which last until `/clear`.
- **`council allow <code> session` and the allow-rule offer are withheld** for a command with an unquoted glob or `~`,
  for a big operation and for a call that runs a script. Rules offered are narrower.
- **The default is now themed** (Plain mode in `/config` keeps the old text). The session record is version 6; a
  version 4 or 5 record is read as 6, so rounds and lockouts survive.

### Looser than 0.5.0
- A shell assignment of a directory to `PWD` or `OLDPWD` (a path-shaped value: see "Secrets and redaction" below) is
  not redacted, whatever its length; any other value after `PWD` still is.
- The secrets scan no longer flags a plain subscript lookup (`token = tokens[0]`); redaction already left it readable.
- `watch -d` takes no separate value, so a read of a plugin folder run under it passes as the read it is, where 0.5.0
  took the command for `-d`'s value and reviewed it.
- Wrapper and runner options are read as the programs read them, so a word after an option that takes a value is that
  value and not a command; a few commands an old, wrong reading made review or block are now classified as what they
  are (for example `systemd-run --expand-environment` and `nsenter -W`).
- A long command that 0.5.0 reviewed only because the readings it made of its split strings used up its 200 parts is
  read completely, and gets the tier of what it holds.
- A merge's current branch is read in the repository that decides the call, so a merge into a branch that is not
  protected is no longer treated as one, and a reviewer now gets a diff it did not get. A key for a word holding an
  escaped literal quote is narrower than before.

### Added
- **`/council trust`, `/council trust <code>`, `/council untrust` and the option "Trust project rules files".**
  `trust` lists everything a project's rules file holds and what confirming it would change (see "Security"); `trust
  <code>` confirms the file with that code; `untrust` takes the confirmation back; the option `trustProjectRules` is
  `confirm` (default) or `always`.
- **Rules per repository under one root.** When the session root is the parent of several repositories (no
  `rules.json` of its own, no `.git`), each repository directly below it can have its own
  `.claude/council-of-elrond/rules.json`. A call is decided by the repositories it touches, the strictest winning;
  protected paths and project checks resolve against their repository, git runs there, and the audit line is written
  inside each one touched. `rm -rf` of another repository is blocked; approvals and chat codes stay within the
  repositories they were given for; allow rules and the allowlist are offered only for a call in one repository. A
  root that has a `rules.json`, or is a repository, behaves as before. See "Several repositories under one root" in
  the README.
- **More secret formats.** Refused as high-confidence: GitLab personal access tokens, npm tokens, Google OAuth client
  secrets, Slack webhook URLs and PGP private key blocks. Asked about as low-confidence: JWTs, `Authorization:
  Bearer`, `Basic`, `Token` headers, `X-Api-Key` and `X-Auth-Token`, a `mysql -p<password>` argument, `curl -u
  user:password`, `--password` for the known database clients, a password in a connection string with no user, quoted
  passwords with spaces and compound names such as `DB_PASSWORD=…` or `dbPassword: "…"`.
- **A `kind` for your own secret patterns.** `gollum.patterns` entries take an optional `kind`, `"password"` or
  `"token"` (the default). A `password` finding gets the allowlist warning, a second question saying a short
  password's fingerprint can be guessed offline, so the allowlist is for keys and tokens.
- **"Talk first" in the escalation dialog** (themed "Parley: talk first"). It refuses the call and tells Claude to
  stop and talk it through with you, without counting as a failed attempt.
- **A new branch's push has a range.** When the remote does not have the branch yet, the preview's commits and the
  diff reviewer's diff are read against the remote's default branch (`<remote>/HEAD`), only for a push that names a
  remote, as a fallback tried once.
- **Themed strings and a plain mode.** Member names, the dialog, bypass and the wipe count have themed variants
  (Gandalf, Legolas, Aragorn, Gimli, Gollum, Galadriel, Elrond, the Council of Elrond); "Plain mode" in `/config`
  (default off) switches every theme word off. Refusals Claude reads, the full council's reasons and the rule reason
  written to your rules file stay plain in both modes. The dialog is headed "Loot roll" with "Need: allow once",
  "Pass: keep blocked" and, for one possible secret, "Greed: add to allowlist"; bypass is "Leeroy mode".
- **The debate pane.** A second pane (`council-debate`, "The debate" themed, "Council review" plain) shows your newest
  reviews: the call, each reviewer's verdict with a word beside every symbol, its reason and safer alternative, the
  project checks, and in themed mode one line of flavour per reviewer. It follows the agent in view, opens once per
  session at the first model review, and `/council debate` opens it at any width. It also holds the wipe counter
  (refused or failed attempts since your last prompt) and the threat meter (each reviewer's blocks as a bar and a
  number).
- **The council check band.** While a full council sits, a band above the prompt shows a row per reviewer and per
  check as each answers ("Ready check" themed).
- **The epic drop** (themed mode only): after a push or merge the full council approved and that ran, "Legendary
  commit acquired" as a toast and a band row for eight seconds.
- **`/council` answers through Claude where nothing draws.** In the cloud web client, `claude -p` and the SDK, typing
  `/council` status, report, rules or test also sends the same lines to Claude, fenced as the council's output and
  redacted line by line, with an instruction to repeat them to you. A scoped exception to "command output never
  reaches Claude": no other subcommand, no command from a plugin or another session, nothing where a surface draws.
  See "Where nothing draws" in the README.
- **A start notice where nothing draws.** The session starts with a row Claude reads, saying the council is active,
  that a call needing your approval is refused here with the reason, and how you can let it run (an allow rule you add
  yourself, a chat approval, or a terminal session).
- **Approve in chat where nothing draws.** A refusal because nobody can be asked carries a code (`council:1a2b3c`)
  that Claude gives you. Type `council allow 1a2b3c` on a line of your own to let that exact call run once, `council
  allow 1a2b3c session` for the rest of the session, or `council deny 1a2b3c` to refuse it (not a failed attempt). The
  line is removed from your message and Claude is told what it did. Only a person's own message counts, a code is
  answered only in your next message, a once-allowance ends at your next prompt, and a protected path, a block rule or
  a high-confidence secret is never offered. The audit log records `chat-allow`, `chat-session` and `chat-deny`;
  `/council report` counts the first two with the calls you allowed. See "Where nothing draws" in the README.
- **`sqlite3` joins the database reviewer's clients.** Its SQL is read from `-cmd`, from the statement after the
  database file and from `-init` files.

### Changed
- **A command that repeats wrapper options or split strings more often than the parser reads is refused**, by a
  new block, `command-too-complex-to-read` (the call is blocked: "The command repeats wrapper options or split strings
  more often than the parser reads; it is refused. Write the command plainly."). Only a crafted command reaches it:
  a split string that repeats a wrapper thousands of times, a split string or a second reading that holds more
  commands than the extra readings' budget of 400 parts, or scripts nested deeper than their 4 levels; an ordinary
  `env -S 'cmd args'`, `env VAR=x cmd` or `nsenter -t 1 -m ls` never does. A block the command's own parts found
  still names its own rule. A command over 200 parts or 4 levels deep is reviewed (`command-too-complex`) as before.
  It is a finding of the classifier like `command-too-long`, so a project rule cannot lower it, and no allow rule is
  offered for it. **Honest but extreme commands that were reviewed are now refused:** more than 200 commands inside
  one `env -S` string, or inside the script of a command behind ambiguous `nsenter` options; four or more scripts
  nested inside one of those; four `env -S` strings that each hold a `${NAME}` expansion followed by a nested script
  (`bash -c ...`), or five followed by anything; 81 commands of one such string each joined in one call, or 134 of
  one string without an expansion (the extra readings share their depth and their parts with the scripts that
  follow); a script behind one plain split string is refused from 199 commands (the previous commit: 399), behind one with an expansion from 99 (previous: 133), two plain strings per command joined from 81 commands, and a script with three nested command substitutions behind one split string is refused (already at the previous commit); and four `-Senv` strings with a 19,000-character word. Write the command plainly, or put it in a script
  file and run that.
- **`origin/main`'s reading of a part with an `env -S` string is always also made, and `env`'s own words are read as
  `env` reads them.** Besides the readings above, the command that 0.5.0 read after the string (it took the string for
  an option's value and went on with the words after it) is read too, with the privilege wrapper (`sudo`, `doas`, ...)
  in front of it, so `env -S 'x y' rm -rf /home/me` and `env -S'-u' git push --force origin main` are blocked as in 0.5.0,
  and a shebang-style `env -S node --flag script.js` is reviewed as the script it runs. After `--` a lone `-` is `env`'s `-i`, and any word with a `=` in it
  (`=1`, `a-b=c`, `${X}=v`) is an assignment, not the program; the words after a string that holds an expansion are
  read as `env`'s own words (options, assignments, then the command), not as a plain command. Everyday
  `env -S 'node --check' f.js` stays reviewed (a script file; 0.5.0 allowed it), `env -S node --experimental-vm-modules
  node_modules/.bin/jest` is reviewed as a script path, as in 0.5.0, and a loop `env -S "node --check" "$f"` is
  reviewed (a program computed at run time). This is never lower than 0.5.0, also behind `nsenter` with an ambiguous `-S`/`-G` option, behind `gosu` and behind `busybox` (next entry). A split string that holds the program and its first arguments, followed by more arguments, gets the tier `origin/main` gave to those following words read as a command (an argument that names a privileged program asks, one that reads like a delete is reviewed, a remote-exec string followed by a destructive command is refused). A chain of four wrapper strings followed by one very long dash word with expansions takes about 1 s at 20,000 characters.
- **`gosu` and `busybox` are read both ways, and the second `nsenter` reading reads an `env` split string as the first does.**
  The word after `gosu` is read as the user and also as the program, as 0.5.0 read it, so `gosu rm -rf /home/me` is
  blocked again (an ask before), and the command 0.5.0 read after a split string keeps its program behind `gosu`.
  `busybox` is read as a wrapper of its applet and also as 0.5.0 read it: the value of a later `-c` word (or of a
  cluster of letters holding a `c`, or `--command`) is classified as a script, so `busybox x -c '<script>'` gets the
  script's tier again, and the command after a split string behind `busybox` is read. Where `nsenter -S` or `-G` is
  followed by a separate word, the reading in which the option takes that word now makes every added reading the
  first one makes (the string alone, 0.5.0's command), so a split string glued to `env`'s option or in a cluster
  behind it is read as in 0.5.0, and a lone `-` after such an option counts as a separate word. Everyday
  `gosu <user> <command>` and `busybox <applet>` keep their tier, with one class of exceptions that 0.5.0 had too:
  the word after a `busybox` applet option that is `-c` or a cluster of letters holding a `c` (`-czf`, `-cnewer`) is
  classified as a command, whatever the applet makes of it, so a path there is reviewed as a program run by its path
  (`busybox tar -czf /tmp/out.tgz .`, `busybox wget -c <url>`, `busybox wc -c ./file`) and a text there that reads as
  a command gets that command's tier. Each added reading is one more part charged to the added readings' budget.
  Still read below 0.5.0, which took the body for a script: a heredoc fed to a `busybox` applet that is no shell, and
  a heredoc after an `env` split string that holds the program.
- **An `env -S` string that holds a `${NAME}` expansion is reviewed and read three ways.** `env` expands the name
  from its environment, and one that is unset expands to nothing, so its word vanishes, an option before it takes the
  next word, and the words after the string can become the command. The classifier cannot know the value, so the
  part is reviewed (`shell-runner-unresolved`) and the strictest of three readings wins: the expansion kept as a word,
  every expansion replaced by nothing (the options read again from the start), and the words after the string
  alone as a command. Honest strings with an expansion (`env -S 'node ${NODE_OPTS}' app.js`, `env -S 'echo ${HOME}'`)
  are reviewed where they were allowed; a string with the `$` escaped or in single quotes is no expansion and is read as
  before. What stays unknown is what a set name holds (an option, a program word) and how a mixture of set and unset
  names in one string moves where the options end.
- **The allow rule offered after "allow once" is narrower, and the question says what it allows.** A shell rule allows
  that exact command text, in any folder, without review. A file tool's rule allows every later write to that file by
  that tool. A rule for any other tool allows that tool with exactly the same arguments (pinned as escaped JSON; no
  offer over 300 characters; the call is classified again with the rule in place before it is offered). No rule is
  offered for a command with an unquoted `*`, `?`, `[`, `{` or `~` (a quoted or escaped one is still offered), nor for
  a big operation (with no current branch known, every merge counts as big). `council allow <code> session` is
  unavailable in the same cases, as a session allowance has the offer's limits. The rule's `reason` and the question
  say which kind of call it is.
- **The nobody-to-ask refusal says what was refused.** Where nothing draws and a call needs you, the refusal names the
  operation (the audit log's redacted key), the rule behind it and the reviewers by name, and tells Claude to tell you
  and how you can let the call run. Never the call's text, a preview, a secrets finding, a diff or a reviewer's
  reason. Still a failed attempt.
- **Protected paths hold at any depth.** The shipped CI, `.git`, `db/migrate` and `.claude/council-of-elrond` /
  `.claude/settings*.json` entries start with `**/`, so they protect every repository below the session root, a rules
  file at any depth included, and the directory itself (`rm -rf app/.git`) asks. A directory named like a
  `**/migrations/**` entry asks too. A protected path named as a value of a wrapper or runner option
  (`--env-file=.env`, `-C .git`), as `dd of=`, as `NAME=path` or glued to an option asks again.
- **`claude -p` and SDK prompts are no longer a person's.** The `sdk` prompt origin is the host's own turn, not typed
  at a terminal (the cloud web client arrives as `composer`). In `claude -p` and the SDK a `/council` command gets no
  relay to Claude, and any prompt not typed by a person clears the cached approvals.
- **`/council` no longer resets the review rounds.** A `/council` command you type keeps the current prompt's rounds,
  failed attempts and cached approvals; other slash commands still start afresh.
- **A project check that can't start says why.** The refusal Claude reads carries the engine's error, such as a
  program missing from the PATH, redacted and cut to one line. The audit log keeps no check output.
- **Operation keys follow what a call does, not how it is worded.** A SQL client's inline SQL is no longer part of its
  key; a redirect write keys on the file; `git push origin HEAD` is the same operation as `git push origin`, and `git
  push -o <value> origin main` the same as `git push origin main`; `psql -n` no longer swallows the next word. Counts
  stored under old keys stop matching.
- **A switched-off diff reviewer named for a shell command is reported as off**, not as "no file to diff".
- **`/council report`:** a council line in the audit log with no readable `voices` list adds no cost, instead of
  counting under a reviewer named `council`.
- **Documents and types.** The README has a "Modes" section, the install command and a note that subagents' calls are
  gated; `docs/INSTALL.md` says a project-scope install still needs one `claude plugin install` per collaborator and
  has a "Cloud sessions" section (organization managed settings or a setup script, and what a cloud session does
  differently). Fake secrets in tests are built at run time from two halves. Types are regenerated for Claude Code
  2.1.299 to 2.1.322: additive for every API the mod calls; a hook that overruns its time budget or blocks the hooks
  worker is cut off and its `.catch` asked, and the mod refuses the call in both cases, as for any failure before a
  call ran.

### Security
**Rules-file trust**
- **A project's rules file cannot loosen the gate or run code on its own say-so.** Allow rules, `disableRules`,
  `models`, `gollum.patterns`, `gollum.allowlist` and `gimli.commands` take effect only after a person confirmed that
  exact content (path and SHA-256 hash, kept in the plugin's own store, never in the repository); until then they are
  as if absent, and a project check it names is reported as not run, never dropped. An unconfirmed file can never make
  the gate weaker than no file. `/council rules` and `/council` show where each file stands; once per file content a
  line and a toast tell you, and where nothing draws one row without text from the file reaches Claude. After your own
  "Add the rule" or allowlist answer the file is trusted at its new content only if it was not there, you had
  confirmed its previous content, or it held no setting at all; no rule or allowlist entry is offered for any other
  file.
- **An unconfirmed file's rules only add.** Its protected paths, protected branches, production patterns, big
  operations and block, ask and review rules apply at once, but the shipped decision is made first, as if the file had
  no rules, and stands: its tier, rule, reason, reviewer or full council, preview and checks. A `block` rule blocks;
  an `ask` rule puts a call the shipped rules let through to you, and on a call they review is asked only after the
  review approves (with the file's reason shown as the project's text; a revise or a block stands; never remembered;
  refused where nobody can be asked; in shadow mode too), with its own wording ("The project's rules file asks you
  about this call too, after its review."); a `review` rule reviews a call the shipped rules let through. A confirmed
  file, and the option `always`, decide first. The audit line keeps the shipped `ruleId` and lists the file's rules
  that only added in `alsoRuleIds`. The status, notice and trust lines say the file's rules apply and only add, and
  that confirming lets them decide first; `/council rules` lists the paths protected against writes apart from the
  protected paths.
- **Confirming confirms only what you were shown.** `/council trust` lists every setting of the file, each in full
  with every field (a list as one line per element), neither cut nor redacted, in two groups: "Applies now and only
  adds to the shipped rules" (every block, ask and review rule, protected paths and branches, production patterns, big
  operations) and "Switched on by confirming" (allow rules, disabled rules, models, secret patterns, the count of
  allowlisted secrets, project checks; allowlist entries are counted, never shown). One sentence says that after you
  confirm, the first group's rules decide before the shipped ones, so a `review` rule can replace a shipped question.
  A rule with no matcher says it matches every call of its tools, and a `tools` entry matching every tool says so. A
  file that cannot be listed in full cannot be confirmed from the session, and the listing says why instead of giving
  a code: more than 40 settings in all, a value over 400 characters, a value that looks like a secret, or one holding
  a control, invisible or direction-changing character (including the soft hyphen, joiners and fillers, invisible
  operators, variation selectors, tag characters and every Unicode space but the plain one); more than 20 files
  waiting are not all listed. The code is derived from a per-session secret as well as the file's hash, works only for
  content listed in this session, and each listing is used up by the confirmation it leads to, so a code worked out
  from the file confirms nothing. `trust` and `reload` need a person; `untrust` runs from any origin.
- **A rules file with errors keeps what can only tighten, and you are told.** Where it is JSON of this version, the
  entries that validate on their own and can only make the gate stricter still apply (protected paths and branches,
  production patterns, big operations, block, ask and review rules, which only add); allow rules, disabled rules,
  models, secret patterns, the allowlist and checks are ignored, and the file is never read as confirmed. Its project
  checks are held back and a big operation's council blocks until it is fixed. A file that is not JSON, not an object
  or of another version is ignored whole. The transcript line and toast say how far it applies, `/council status` and
  `rules` show "partly applied" or "ignored", and where nothing draws one row with the error count reaches Claude,
  once per version of the file.
- **A project rule's reason is shown as the project's text.** In a reviewer's prompt it sits in a data block under a
  lead-in saying so, in the dialog after the gutter, and in Claude's refusal and the audit line it is introduced as
  "The project's rules file says", on one line of at most 200 characters with control, invisible and
  direction-changing characters removed. A shipped rule's reason is as it was.
- **Names and sizes are bounded** (see "Upgrading from 0.5.0"); the cap is checked before a regex is compiled, so an
  oversized one is an error and not a stall.

**The classifier**
- **A command the parser did not see, or a program it did not know, reaches its rule.** Unquoted heredoc bodies are
  scanned for `$(...)` and backticks (a quoted delimiter keeps the body as data). Wrappers and runners show the
  command they run: `chrt`, `taskset`, `setarch`, `exec -a`, `env -S` (attached, clustered and `--split-string`),
  `busybox`, `toybox`, `fakeroot`, `firejail`, `systemd-run`, `op run`, `doppler run`, `mise exec`, and the package
  runners (`npm exec`, `uv run`, `conda run` and the rest), which skip their own flags correctly. The command strings
  of `script -c`, `nix-shell --run`, `--command`, `pnpm -c` and the `tmux`, `screen`, `zellij`, `nix
  develop|shell|run`, `git submodule foreach`, `git bisect run`, `git rebase --exec`, `git filter-branch`, `find
  -exec`, `entr` and `parallel` forms that start a command are classified like `sh -c`; a key sequence or command file
  that cannot be read is reviewed (`command-unreadable`).
- **Options are read as the program reads them.** Clusters letter by letter, long options by unique prefix, global
  options before a runner's subcommand. An option the tables do not list sends the call to review
  (`shell-runner-unresolved`) and the inner command keeps its own tier when stricter. A wrapper or runner that changes
  the directory or the root is also judged from `/`. `cd` is tracked per nesting level and followed through `$HOME`,
  `~` and a folder the text names. `nsenter -S` and `-G` (and `--setuid`, `--setgid`) followed by a separate word are
  read both ways, as the option's value and as the program: the part is reviewed and the strictest reading wins. Three
  option tables were wrong (`systemd-run --expand-environment`, `nsenter -W`, and `pnpm -c`/`--shell-mode`, whose
  words are one shell string) and hid a command from the rules; they are corrected. More than eight `env -S` strings
  in one command are not spliced but read together with the words that follow them, as `env` splits them and as a
  shell reads them, and the part is reviewed, so a crafted chain no longer stalls the classifier and the command it
  holds keeps its own tier. However many `-S` or `-G` options `nsenter` is given, and however many `nsenter` links
  are chained, the part is read two ways and no more: the word after the first option as the program, and every such
  option taking its next word; the strictest reading wins. Each `env -S` string is split as GNU `env` 9.4 splits it
  (its blanks, quotes, `\_`, `\c`, `#` comments and `${NAME}`), and is also read alone, as a shell reads it, and as
  the earlier versions read it, so a string `env` cannot read (an error in it) is reviewed and still classified. A
  string that holds a `${NAME}` is reviewed and read three ways, and the command 0.5.0 read after any `env -S` string is
  read too, so no `env -S` form is read below 0.5.0 (a heredoc aside, see "Changed"); `env`'s own words after `--` are read as `env`
  reads them (a lone `-`, any word with a `=`).
  **The readings the parser adds beside the text have budgets of their own** (400,000 characters scanned, 400
  parts, 4 levels deep): the second `nsenter` reading, the shell scanner's reading of an `env -S` string, the
  strings past the eighth, and every script nested in one of those. The text the command holds (its parts, `-c`
  strings, substitutions, subshells, process substitutions, `eval` and heredoc bodies) keeps the 200 parts and 4
  levels it always had, and is never charged to them, so a block there stays a block. A budget that is used up
  refuses the call (see "Changed"); two earlier versions of the bound reviewed it, and each lowered some blocks to
  reviews.
- **A process substitution used as a redirect target no longer hides the command that follows it.** The substitution
  is the redirect's target, and the command after it, whatever separates them, is read with its own program. A redirect
  with no target at the end of a part, and an escaped digit before a here-document, no longer carry over to what comes
  next; a call that ends in a redirect with no target is reviewed. A pipe at the end of a line goes on to the next
  line's command.
- **A program name computed at run time is reviewed** (`shell-dynamic-program`): a variable, `${...}`, a substitution,
  a glob, a bracket or a brace list in the program position; a flat literal brace list is read as the command it
  expands to. An unquoted `$IFS` is read as a space. A command substitution inside unquoted `$(( … ))` is classified.
- **Block rules read what the programs read.** Recursive `rm` is blocked when `--recursive` or `--no-preserve-root` is
  a unique prefix, for another user's home and for a defaulted home expansion; a write to a disk device is blocked
  however the device is spelt, or relative to a folder first entered.
- **Pushes.** The force and delete flags of `git push` are read as git reads them (clusters, unique prefixes;
  `--force-if-includes` counts as force). A force push that names no branch, or only `HEAD`, overwrites the
  checked-out branch, so the mod reads that branch (only for such a push, in the folder it runs in, with the previews'
  git protections) and blocks it when it matches your protected branches; when the branch cannot be determined, or may
  have moved (a destination or remote computed at run time, an earlier part of the call that may switch the branch),
  it asks (`force-push-unknown-branch`); `/council test` reads no branch and shows it as asked about. `git send-pack`
  and `hub push` are read like `git push`; `git subtree push`, `git lfs push` and `jj git push` are reviewed.
- **Interpreters.** Code fed through standard input without a flag (`script-stdin`: a pipe, heredoc, here-string, `<`
  redirect, `/dev/stdin`, a descriptor path, a process substitution or `<&0`) is reviewed, as is an unknown option on
  a fed interpreter and `python -m` of a module that runs the code it is given. Inline code flags are matched attached
  and in clusters (`script-inline`), for more interpreters.
- **More forms are reviewed.** `curl` data options attached or clustered and methods other than GET, `wget` and HTTPie
  bodies, `gh` writes, more `git rm`, `git checkout` of paths, `git switch --discard-changes`, `git branch -df`, `awk`
  and `sed` that run commands or write files, more cloud deletes, and `tar` or `unzip` extracting outside the project
  (`extract-outside-project`).
- **The mod protects itself.** `plugin-manage` (ask) covers `claude plugin install|update|enable|disable|
  uninstall|remove|rm` and `marketplace add|remove|rm|update`, through global options, short aliases and `npx
  @anthropic-ai/claude-code@<version>`; `claude plugin test`, `validate`, `list` and `eval` do not ask.
  `claude-session` (ask) covers a nested Claude Code session (`-p`, `--bare`, `--settings`, `--plugin-dir`, a
  permission bypass, `CLAUDE_*` assignments) and `claude mcp add|remove`, `claude config set`. The plugin folders
  (`**/.claude/plugins/**`) are protected against writes only: `Write`, `Edit` and `NotebookEdit` of a file there ask,
  and so does a shell command that names the folder unless it only reads it (a fixed list of reader programs, `[[ ]]`,
  `cd`, and `git -C <path>` with a read-only subcommand and no option that runs a program) or runs what it holds,
  which the ordinary rules judge (a script is reviewed). A reader whose output goes on through a pipe into a program
  that is not a reader asks; so does a part that writes (`cp`, `mv`, `tee`, `sed -i`, `ln`, `find -delete`, `sort -o`,
  `yq -s`, a redirect into the folder, an unknown program). A path that is protected proper (`.env`, `.git`, the
  settings files, the rules file) asks for any mention. The plugin-folder protection is new in this release, so
  nothing is looser than 0.5.0.
- **Typing into another terminal asks** (`terminal-input`): `tmux send-keys`, `paste-buffer`, `pipe-pane -I`,
  `command-prompt`, and `load-buffer` or `set-buffer` in a line that also pastes or sends; `screen -X stuff`, `paste`,
  `readbuf`; `zellij action write`; `kitty @` and `wezterm cli` send-text; `xdotool`, `ydotool`, `wtype`; `osascript`
  with `keystroke`. It matches through wrappers; what is typed is still read, so a block still blocks. The tmux forms
  that run a command line nobody can read (`set` of `default-command`, `default-shell`, `lock-command`, `status-left`,
  `status-right` or an option whose value holds `#(`; `-f <file>`; `detach-client -E`; `display-message` with `#(`;
  `choose-*` templates) are reviewed.
- **Git previews stay in their repository, and the mod's own git starts no program.** No preview where git would run
  elsewhere (`GIT_DIR=` and the other location variables, `--namespace`, a `cd` outside the project or to a folder the
  mod cannot name); the diff reviewer then sits out and a merge whose branch is unknown goes to the full council.
  External diff drivers, textconv filters, `core.fsmonitor` and `log.showSignature` are switched off.
- **A shipped pattern that was slow on long input is now linear.**

**Approvals and the cache**
- **An approval holds in the folder it was given in.** A reviewer's approve and a chat `council allow` are matched on
  the call and the folder (and, under a multi-repository root, the repositories it touches); a command is matched
  exactly, not after collapsing whitespace. The audit fingerprint is the plain one.
- **What is never remembered.** The full council's approve; a call with a git part (gated or not); a call that runs a
  script or code or a project's runner (`make`, `just`, `npm run`, `cargo` and the like); one with more than eight
  gated parts; one asked about after its review because an unconfirmed rule asks; a call too long or complex to split.
  The same ordinary call in the same folder is reviewed once. The cache and the rounds are read just before they are
  used, so two calls running at once see each other's approve and spent rounds.
- **A command too long to review, or a script or SQL file it runs that was cut, is never approved by a model alone.**
  A reviewer reads at most 200 lines or 12,000 characters of a shell command (40 lines or 4,000 characters of the push
  command a diff reviewer quotes), 120 lines or 8,000 characters of a script and 150 lines or 8,000 characters of SQL.
  Past that, an approve no longer lets the call run: it comes to you ("The command, or a script or SQL file it runs,
  was too long to review in full"), or is refused where nobody can be asked; it is not remembered, and the audit line
  shows the approve with that reason. A revise or a block stands; in the full council it applies when every member
  approves and one saw only part. A long file or diff a file tool writes is not held back.
- **A shell command with more than eight gated parts is not reviewed by a model.** It comes to you ("too many separate
  gated parts to track; split it"), or is refused where nobody can be asked, and is never remembered.

**The retry brake**
- **Rounds, failed attempts and lockouts follow each part of a compound command.** Each gated part has a key of its
  own (the key a call of that part alone has), and so does each part's verb; only the first eight gated parts have
  keys. A failed attempt counts on the whole call, each part and each verb; a review round on the whole call and each
  part. A call is locked out when its whole key or any part's key reached three failed attempts, or any verb five; it
  goes to you without a model call when its whole key or any part has used its two rounds. Your typed instruction
  gives the whole call its rounds back and a call that ran clears its whole key; neither touches a part's key or the
  verb counters. The status and the pane count a locked verb as locked out. Counts and lockouts of an older record are
  kept.
- **The per-kind counters are bounded, and a force push counts apart.** At 200 verb kinds a new kind counts on one
  shared counter that locks at five; nothing counted is dropped. A force or delete push keeps a retry count of its
  own, which a plain push of the same branch never clears.
- **A failed command is not read as a permission denial because its output held the wording.** The deny-rule wording
  ("Permission to use|edit|read … has been denied") counts only at the start of the error text. Some other
  automatic-denial wordings are still read from their phrase alone, so a failed command whose own output resembles one
  may be recorded as a denial and not counted as a failed attempt; that limit is open (ROADMAP, brief M1.9 and
  decision OD2).

**Secrets and redaction**
- **Allowed calls are scanned.** A high-confidence secret in an allowed call is refused, as on a gated call, and
  logged with tier `allow`; low-confidence findings on an allowed call still pass (the mod never asks on an allowed
  call). The scan reads a shell call's `description` and command, a file tool's path and what it writes, and the whole
  input of every other tool (a fetch's URL, an agent's prompt, a search pattern).
- **A text too long to scan in full is no longer passed silently.** The scan reads a text up to 600,000 characters
  whole; a longer one from its start and its end, each reaching 512 characters past the seam, so a token at a seam is
  whole. Over 600,000 characters, a gated call comes to you with the reason (never remembered, no allow rule offered)
  and is refused where nobody can be asked; an allowed call is refused and logged. Shadow mode does not change it;
  bypass skips it for a gated call only.
- **Redaction.** A value is a placeholder only when all of it is one (`$NAME`, `${NAME}`, `${1:-default}`,
  `<your-key>`, `{{ ... }}`, `****`, a call expression such as `getToken()`, an indexed lookup such as `tokens[0]`); a
  literal that merely starts with such a character is redacted and reported, as is a word dressed as a call (a
  capitalised callee that is no known type with a digit in its name or a digit-led argument). A value of 4 or 5
  characters counts only when it holds a digit or a character other than letters, `_` and `.`; a plain word needs 6.
  Not secrets: a bare number under 6 digits, a path or a backtick substitution under 6 characters, and a `PWD` or
  `OLDPWD` assigned a directory in the shell's form. Ordinary code that only names a secret (`{ token: token }`, `this.token = token`,
  `z.string().min(8)`) is left readable and not asked about; any other value after a secret keyword is redacted, even
  one the scan does not flag. A code value is left as written in reviewer prompts, refusals and the audit log.
- **`PWD` and `OLDPWD` are left readable only as a shell assignment of a directory.** The name must be exactly `PWD` or
  `OLDPWD`, written with `=` and not as a quoted key, and the value must be shaped like a path (a start of `/`, `~/`,
  `./`, `../`, an expansion or a plain substitution; letters, digits and `. _ / ~ + @ % -` only; no `; ! : & ? #`, quote
  or space; no segment that is a word of 6 or more characters that mixes letters and digits), and the name must stand
  where a shell reads an assignment word: at the start of the text or of a line, after a space or a tab, after `(`, `{`, a
  backtick or `$(`, or glued to a `|`, `||` or `&&`. After any other character (`db.PWD=`, `--PWD=`, `&PWD=`,
  `,PWD=`, `#PWD=`, `$PWD=`, a quote, and any white space but those: a carriage return, a no-break space) it is a key of
  a query, an option or a field, and is redacted and reported.
  Any other value is the password keyword of a connection string and is redacted and reported, and so is any value
  after a `;` earlier on the same line, a value (bare or quoted, up to 1,000 characters, a closing quote allowed, up
  to 16 blanks or tabs allowed before the `;`) followed by `;` and then a character that is no blank and up to 64 more
  with a `=` among them (`PWD=...;UID=sa`, `PWD=... ;UID=sa`, `;User ID=sa`, `;[UID]=sa`), and a `PWD` with a blank
  around its `=`, which is no shell assignment. `PWD=/tmp; ls`, `PWD=/tmp ; ls`, `PWD=/home/me/project; CC=gcc make`,
  `PWD=/work/p;make`, `export PWD=/tmp`, `PWD=$HOME/src` and `cd "$OLDPWD"` stay readable; so does a connection
  string whose `PWD` value is over 1,000 characters, has a blank inside it, or is followed by more than 16 blanks
  before its `;`, one whose next name is over 64 characters, and one whose item follows a blank (`UID=sa PWD=...`).
  `PWD=/work/p;make CC=gcc` (a command word glued to the `;`, with a `=` after it) and `PWD = /x` are redacted.
- **Secrets are redacted before a cut, not after**: a script, a `.sql` file, the changes a push would send, the
  read-only preview and a file's diff are redacted whole, then cut, so a secret across the cut cannot show a piece of
  itself.
- **A project's own secret patterns are applied wherever the mod redacts** once the file is confirmed: what reviewers
  read, the debate pane, the operation key, the audit line (its key too), the refusal Claude reads and the dialog's
  second pass.
- **`/council rules` shows no character of an allowlisted secret**, to you or to Claude: an exact-string entry is `(an
  exact string, not shown)`; a `sha256:` fingerprint is still shown.

**What reviewers and you are shown**
- **Cut input keeps both ends, and reviewers are told what was left out.** Input over a limit keeps about two thirds
  from the start and one third from the end, with one line saying how many lines and characters are missing. Every
  reviewer's instructions say that what was left out has not been seen and is not to be assumed safe; a note from the
  council, outside the quoted material, says when and by how much a block was cut, so a marker typed into a command or
  a file means nothing.
- **Left-out context is named.** A `.sql` file outside the project, missing or unreadable (or past the three read),
  and a script the call runs that was not written through a file tool this session or could not be read, are said in
  one line of the prompt.
- **The names a call supplies are inside the fence.** The tool name and the file, script and SQL names are one data
  block, redacted with the call's patterns, and each reviewer is told they are data.
- **A push's preview and range diff show what is pushed.** The commits and changes are read per refspec (the first
  three), from its own source against the remote branch it lands on; a delete shows none. A refspec that cannot be
  named safely, a range git cannot read, no plain-name remote, or more than three refspecs is said in the preview and
  in a line every reviewer reads outside it, so they never take the checked-out branch's commits for the push's. A
  push of every branch or tag (`--all`, `--mirror`, `--tags`) says it sends more than the commits shown; one that
  follows another command of its call says the commits were read before the earlier commands ran.
- **The question shows call text behind a gutter.** Every row of the call and the preview starts with `  | `; control,
  invisible and direction-changing characters are removed; a reviewer's reason, a problem and a secret snippet are
  kept to one line; a call line wraps at 72 display columns (a wide character counts 2, a combining mark 0). Over its
  2,500-character cap, what a reviewer wrote is shortened first (at most 240 characters each), then the preview to its
  first and last line, then the middle of the call (its first 4 and last 4 lines always stay); the title, the rule
  line, every reviewer's verdict and the closing line stay.
- **A malformed verdict echoes less.** The unexpected field names of a reviewer's reply are capped (three, 40
  characters each, control characters removed) before they reach a dialog, a refusal or the log.

**The audit log**
- **The log records what the new paths decide:** `alsoRuleIds` for a file's rules that only added, tier `allow` for an
  allowed call refused for a secret or an unscannable text, the approve a cut command's refusal kept with its reason,
  and `chat-allow`, `chat-session` and `chat-deny`.

### Fixed
- **The audit log says when it fails.** The first audit line that could not be written in a session is said in the
  transcript with a toast, `/council status` shows how many lines failed, and a `.gitignore` that could not be written
  is tried again with the next line.
- **A hanging audit write no longer holds up later calls.** The audit line is queued and written in order after the
  call; a write that never returns holds back only the lines queued after it. `/council log` and `/council report` may
  not show a line still waiting.
- **The audit log rotates by bytes**, so multibyte text no longer rotates it without moving `.1` to `.2`.
- **A refusal text Claude reads said "You chose".** `reason.allowlistNotWritten` now says "The user chose".
- **The status line is cleared when its surface leaves.** A label set for a phone or VS Code stays no longer after
  that client detached; it is set again when one attaches.
- **A failed allowlist write is no longer a failed attempt.** The call stays blocked, with a reason that says the
  entry could not be written, but the failure is the mod's and counts toward no lockout. Cancelling the confirm still
  counts.
- **A malformed stored session no longer denies every call until `/clear`.** The record's shape is checked; a value of
  the wrong shape is read as a fresh session and the call is decided as usual.
- **A council check no longer outlives a failed review**: the project checks it had started end at once.
- **Parallel calls see each other's failed attempts and spent tokens**: the lockout and the token budget are decided
  on a fresh read of the session.
- **Claude Code's "Chat about this" counts as a dismissal**, documented; the mod cannot tell it from one. "Talk first"
  is the way to stop without one.
- **Two more automatic-denial wordings are recognised** ("This command requires approval", and a deny rule on a file
  read or edit), so they never count as a failed attempt.
- **A failure in the prompt hook no longer risks the mod**: its own error handler lets the prompt through as typed and
  the mod stays loaded.
- **The diff reviewer sees the whole change of an `Edit` with an `edits` array**; diffs read as git writes them (a new
  file at `-0,0`, CRLF files without stray `\r`, a change of line endings named, a missing final newline marked).
- **A reviewer's `safer_alternative` is cut to 400 characters**, as its reason already was.
- **Git previews follow a `cd`** into a folder inside the project (links resolved; a folder outside it is not used),
  including the diff the full council's diff reviewer reads and the branch a merge is checked against; `git push -o`,
  `--push-option` and `--receive-pack` values are read as values; a quoted delete target is previewed under its own
  name.

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
