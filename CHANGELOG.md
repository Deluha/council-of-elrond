# Changelog

All notable changes to the mod are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/) and are the `version` field of
`mods/council-of-elrond/.claude-plugin/plugin.json`. Before 1.0.0, a minor bump may change
behaviour.

Each stage of the original build order (SPEC §20) landed as one pull request.

## [Unreleased]

### Added
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
  or test there, the same lines also go to Claude, fenced as the council's output and redacted line
  by line, with an instruction to repeat them to you in its next reply. A scoped exception to "command
  output never reaches Claude": no other subcommand, no command from a plugin or another session, and
  nothing at all where a surface draws. `/council rules` shows an exact-string allowlist entry to
  Claude as `(an exact string, not shown)`, not its first three characters. See "Where nothing
  draws" in the README.
- **A start notice where nothing draws.** The session starts with a row Claude reads, saying the
  council is active, that a call needing your approval is refused here with the reason, and how you
  can let it run (an allow rule in `rules.json` that you add yourself, or a terminal session).

### Changed
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
  rest answer from any origin. The SDK counts as a person for now.
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


### Security
- **Allowed calls are scanned for high-confidence secrets.** A literal key in an allowed `curl` or
  `echo` used to reach the network or the transcript unscanned; it is now refused, as on a gated
  call, and logged with tier `allow` so `/council report` counts it. Low-confidence findings on an
  allowed call still pass: the mod never asks on an allowed call.

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
