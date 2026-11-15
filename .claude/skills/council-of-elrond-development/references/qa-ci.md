# QA and CI

What runs, on which build, and what each result means.

## The verify command

`node scripts/verify.mjs` runs the checks a change needs and prints one table (check, result, time) and one summary line. It exits 0 only if nothing failed. In a session it is `/verify-change`. Modes:

- no flag: the current change (the merge base with `main`, plus staged, unstaged and untracked files);
- `--staged`: the staged files, as the pre-commit hook runs it;
- `--all`: everything. Run it once at the start of a cloud session and see it green before changing anything.

Results: `PASS`, `FAIL`, `WARN` (counted, never fails: a conventions warning, the pinned-build row under `COUNCIL_ALLOW_UNPINNED=1`, hygiene when `python3` is missing because its link check is then skipped), `SKIP` (with its reason), `MANUAL` and `INFO` (the ask-first report). A MANUAL row is a check with no command: do it by hand and say so in the summary. The summary line reads `PASS (2 manual checks outstanding)` or `PASS (1 warning, 2 changed files need the maintainer's eye)`, never a bare PASS with anything outstanding, and `FAIL (names)` with a failure.

A SKIP is acceptable only for a reason that is not a missing prerequisite. A row that cannot run because the pinned build or a binary is missing is a SKIP marked as missing and fails the run (summary FAIL, exit 1). The pinned-build row is selected with every row that runs the Claude Code binary, so it is red then too.

If git fails (no merge base, not a repository, git missing), the table gets a `git` row marked `FAIL`, every check is selected and the exit code is non-zero. A build that is not the pinned one fails the pinned-build row unless `COUNCIL_ALLOW_UNPINNED=1`.

## What each check is, and when it is selected

| Change touches | Checks |
| :- | :- |
| Anything | hygiene (`scripts/check-hygiene.sh`); the guidance checker (`scripts/check-guidance.mjs`); the ask-first report |
| `mods/council-of-elrond/hooks/`, `mods/council-of-elrond/tests/`, `mods/council-of-elrond/types/` or `mods/council-of-elrond/.claude-plugin/`; `mods/tsconfig.json`; `mods/types/` | the pinned-build check; the tests; the typecheck; validate the plugin; no `tool.check` hook; the conventions check |
| `.claude-plugin/marketplace.json` or `mods/council-of-elrond/.claude-plugin/plugin.json` | validate the marketplace, and the pinned-build check |
| the CI or release workflow in `.github/workflows/` (the pin may have moved) | every row that needs the pinned build, and validate the marketplace |
| `hooks/rules/`, `hooks/config/defaults.ts`, `hooks/redact.ts`, `hooks/members/gollum.ts` | the sweep row (MANUAL: R9) |
| `hooks/register.ts` hunks that touch `next(`, `.catch(`, `proceed(` or `deny:`; `hooks/rules/classify.ts`; `hooks/elrond/operations.ts` | the mutation-check row (MANUAL: R7) |
| `scripts/`, `.githooks/`, `.claude/`, `.github/` | `node --test scripts/tests/` |
| Documents only | hygiene and the guidance checker only |

The conventions check covers four items of the old reader pre-check: a parameter or import named `$` outside `hooks/register.ts` fails; a new `atom(` call fails; a `hooks/` change with no `tests/` change warns; a change to `hooks/strings.ts`, `userConfig` or `hooks/elrond/commands.ts` with no change to `mods/council-of-elrond/README.md` or `CHANGELOG.md` warns. Two items have no mechanical check and stay with the reviewer (`references/recipes-orchestration.md`, "The review loop"): a new string literal under `hooks/` outside `hooks/strings.ts` and `hooks/members/`, and an `update($, session, ...)` whose updater is not a function imported from `./state.js`.

`--staged` limit: the gates and the guidance check read the working tree, so a commit made with unstaged changes present is checked as the tree stands.

## The gate commands

From the repository root, in this order; the verify command runs them for a change to the mod.

```
"${COUNCIL_CLAUDE:-claude}" plugin test mods/council-of-elrond                # all tests
tsc -p mods                                                                   # strict typecheck against mods/types/claude-code.d.ts
"${COUNCIL_CLAUDE:-claude}" plugin validate --strict mods/council-of-elrond   # copy its hooks:/calls: lines into DESIGN.md §2
scripts/check-hygiene.sh                                                      # generated files, personal data, links, the two pins agree
```

All four pass before every commit; the first three on the pinned build (below).

## The pinned build

The three gates run on the Claude Code build CI pins: the `@anthropic-ai/claude-code@X.Y.Z` in the
install step of `.github/workflows/ci.yml` (the release workflow pins the same one, and DESIGN.md's
header names it). A newer build can fail tests the pinned one passes, so `scripts/setup.sh`, the
pre-commit hook and verify read the pin, compare it with `--version` of `${COUNCIL_CLAUDE:-claude}` and
refuse on a difference. To get the pinned build, install it into a scratch folder and point the variable at it:

```
. scripts/pinned-claude.sh && PIN=$(pinned_version)      # reads .github/workflows/ci.yml
npm install --prefix <a scratch folder outside the repository> @anthropic-ai/claude-code@$PIN
export COUNCIL_CLAUDE=<that folder>/node_modules/.bin/claude
```

`COUNCIL_ALLOW_UNPINNED=1` runs on another build; use it only in an upgrade brief (`/upgrade-types`), which moves the pin. `tsc` has no pin; the vendored types are the version. Upgrades are scheduled (`docs/MAINTENANCE.md`).

## Pre-commit and CI

The pre-commit hook runs `node scripts/verify.mjs --staged`. The three gates must pass before every commit, on the pinned build (the section above); `git commit --no-verify` skips them when you must, and CI catches what you skipped. The hooks live in `.githooks/`; `scripts/setup.sh` points `core.hooksPath` at them, and the session-start hook does the same in cloud sessions when it is unset. Where `core.hooksPath` is unset neither git hook runs.

CI (`.github/workflows/ci.yml`) has two jobs. `hygiene` runs `scripts/check-hygiene.sh`, the guidance checker (`node scripts/check-guidance.mjs`) and the script tests (`node --test scripts/tests/`). `checks` installs Node 22, the pinned build and `typescript`, then runs the tests, the typecheck, validate for the plugin and for the marketplace, and a step that fails if validate names a `tool.check` hook (the mod never takes part in the permission decision, SPEC §7). `.github/workflows/release.yml` runs on a tag `council-of-elrond--v*`, checks it against the plugin manifest and `CHANGELOG.md`, and runs the gates with the same pin (hygiene checks that the pins agree).

## Checks with no command

- **The sweep against `main`** (R9): MANUAL until brief M2.1. How: `references/domain-gate-direction.md`.
- **The mutation check** (R7): MANUAL. How: `references/testing.md`.
- **The terminal check**, `docs/TERMINAL-CHECK.md`: the maintainer's, in a terminal, for releases and dialog changes (interactive UI cannot be checked headless).

## The ask rules and the two hooks

- **The `ask` and `deny` rules in `.claude/settings.json` are Claude Code permission rules on the developing session.** They are not the mod, which is never loaded there (R1). Probed on 2.1.322: an `ask` rule on a path prompts for the Edit and Write tools, but a shell write (`sed -i`, `cp`) to that path is not prompted, so every ask-first item has a second gate: a workflow step, the verify report and the reviewer. A `deny` rule on a path also refuses a shell command that writes it. The allow list holds exact commands (a prefix only for `node scripts/verify.mjs` and `node scripts/check-guidance.mjs`, which reject or only read their arguments) and never `claude -p`, so a headless child run prompts (R13).
- **The post-edit hook**, `scripts/hooks/lint-edited.mjs`, runs after every Edit or Write and checks syntax, the `.editorconfig` rules and a single-file typecheck, reported as context; it never fails the edit. The whole-project typecheck stays in the verify command.
- **The session-start hook**, `scripts/hooks/session-start.sh`, runs only in cloud sessions. It installs the pinned build into a cache folder outside the repository (and `typescript` if `tsc` is missing), exports `COUNCIL_CLAUDE` as soon as the pinned build is found or installed (before the optional `typescript` install), sets `core.hooksPath` to `.githooks` when it is unset, warns if `claude plugin list` names `council-of-elrond` (R1), and never fails the session start. Its steps are bounded at 200 s (pinned install), 60 s (`typescript`) and 10 s (plugin list), inside the hook's 300 s. `COUNCIL_SKIP_SESSION_SETUP=1` turns it off (set it where an unattended session clones this repository).

## The guidance checker

`node scripts/check-guidance.mjs` runs in the verify command, in pre-commit (through it) and in CI's `hygiene` job. It checks that:

- a backticked path in a guidance file resolves from the repository root, else from `mods/council-of-elrond/`, else from the skill folder or its `references/`, and an anchor after a path matches a heading of that file;
- `CLAUDE.md` is within its line and byte budget, and no file under `references/` is over 10 KB;
- the routing table has one row for every reference file and names only existing files;
- each rule id is defined once, in `references/conventions.md`, and every id used elsewhere exists;
- rule files and command skills only point;
- model tier names appear only in agent frontmatter and the one table of `references/recipes-orchestration.md`;
- the ask paths in `.claude/settings.json`, the ask-first list in `CLAUDE.md` and the safety-boundary block of `.github/CODEOWNERS` agree;
- pointers to `.claude/` and `scripts/` in `CONTRIBUTING.md`, `docs/DEVELOPMENT.md` and `docs/MAINTENANCE.md` resolve (their other prose is not read); a backticked `/name` of a command skill of this repository has its `SKILL.md`; no code fence is unclosed;
- the wiring is real: CI has `run:` steps for the checker and for `node --test scripts/tests/` (a comment or a step name does not count), pre-commit has a line that runs `node scripts/verify.mjs --staged` (an `echo` does not), and verify runs the checker (an import does not).
