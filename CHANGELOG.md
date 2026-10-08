# Changelog

All notable changes to the mod are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/) and are the `version` field of
`mods/council-of-elrond/.claude-plugin/plugin.json`. Before 1.0.0, a minor bump may change
behaviour.

Each stage of the original build order (SPEC §20) landed as one pull request.

## [Unreleased]

### Added
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

### Changed
- The default is now themed: `/council`, the dialog and the report name the characters, and the
  dialog's options read "Need: allow once" and "Pass: keep blocked". Turn on "Plain mode" in
  `/config` to keep the old text ("Allow once", "Keep blocked", role names).
- **README.** A "Modes" section (enforcing, shadow, bypass, plain), the install command under
  "Loading it", a note that subagents' calls are gated too, and bypass named among the limits.

### Security
- **Allowed calls are scanned for high-confidence secrets.** A literal key in an allowed `curl` or
  `echo` used to reach the network or the transcript unscanned; it is now refused, as on a gated
  call, and logged with tier `allow` so `/council report` counts it. Low-confidence findings on an
  allowed call still pass: the mod never asks on an allowed call.

### Fixed
- **A third automatic-denial wording is recognised.** Claude Code's "This command requires approval" (seen on 2.1.294 in `-p`) now reads as `denied-by-permission`, so it never counts as a failed attempt, instead of as an ordinary tool error.

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
