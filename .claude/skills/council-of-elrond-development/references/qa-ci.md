# QA and CI

What runs, on which build, and what each result means.

## The verify command

`node scripts/verify.mjs` runs the checks a change needs and prints one table (check, result, time) and one summary line. It exits 0 only if nothing failed. In a session it is `/verify-change`. Modes:

- no flag: the current change (the merge base with `main`, plus staged, unstaged and untracked files);
- `--staged`: the staged files, as the pre-commit hook runs it;
- `--all`: everything. Run it once at the start of a cloud session and see it green before changing anything. Its green is `PASS (2 manual checks outstanding)`: `--all` selects the two MANUAL rows whether or not anything changed.

Results: `PASS`, `FAIL`, `WARN` (counted, never fails: a conventions warning, the pinned-build row under `COUNCIL_ALLOW_UNPINNED=1`, hygiene when `python3` is missing because its link check is then skipped), `SKIP` (with its reason), `MANUAL` and `INFO` (the ask-first report). A MANUAL row is a check with no command: do it by hand and say so in the summary. The summary line reads `PASS (2 manual checks outstanding)` or `PASS (1 warning, 2 changed files need the maintainer's eye)`, never a bare PASS with anything outstanding, and `FAIL (names)` with a failure.

A SKIP is acceptable only for a reason that is not a missing prerequisite. A missing prerequisite of a gate (the pinned build, or the binary a gate runs) is a SKIP marked as missing and fails the run (summary FAIL, exit 1); the pinned-build row is selected with every row that runs the Claude Code binary, so it is red then too. Hygiene's link check is the one optional part: without `python3` the hygiene row is a WARN, and CI always runs the check.

If git fails (no merge base, not a repository, git missing), the table gets a `git` row marked `FAIL`, every check is selected and the exit code is non-zero. A build that is not the pinned one fails the pinned-build row unless `COUNCIL_ALLOW_UNPINNED=1`.

## What each check is, and when it is selected

| Change touches | Checks |
| :- | :- |
| Anything | hygiene (`scripts/check-hygiene.sh`); the guidance checker (`scripts/check-guidance.mjs`); the ask-first report |
| `mods/council-of-elrond/hooks/`, `mods/council-of-elrond/tests/`, `mods/council-of-elrond/types/` or `mods/council-of-elrond/.claude-plugin/`; `mods/tsconfig.json`; `mods/types/` | the pinned-build check; the tests; the typecheck; validate the plugin; no `tool.check` hook; the conventions check |
| `.claude-plugin/marketplace.json` or `mods/council-of-elrond/.claude-plugin/plugin.json` | validate the marketplace, and the pinned-build check |
| the CI or release workflow in `.github/workflows/` (the pin may have moved) | the pinned-build check, the tests, the typecheck, validate the plugin, no `tool.check` hook, the conventions check and validate the marketplace; also `node --test scripts/tests/`, since the path is under `.github/` |
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

## The ask rules, the hooks and the guidance checker

- The `ask` and `deny` rules of the developing session, the post-edit hook and the session-start hook: `references/guidance-machinery.md`.
- What `node scripts/check-guidance.mjs` checks, and what it does not prove: `references/guidance-machinery.md`.
