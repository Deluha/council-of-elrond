# QA and CI

What runs, on which build, and what each result means.

## The verify command

`node scripts/verify.mjs` runs the checks a change needs and prints one table (check, result, time) and one summary line. It exits 0 only if nothing failed. In a session it is `/verify-change`. Modes:

- no flag: the current change (the merge base with `main`, plus staged, unstaged and untracked files);
- `--staged`: the staged files, as the pre-commit hook runs it;
- `--all`: everything. Run it once at the start of a cloud session and see it green before changing anything.

Results: `PASS`, `FAIL`, `SKIP` (with its reason) and `MANUAL`. A MANUAL row is a check the repository has no command for: do it by hand and say so in the summary. The summary line then reads "PASS, 2 manual checks outstanding", never a bare green. Two rows are manual today: the sweep against `main` and the mutation check (the sweep's tool is brief M2.1; OD17 may pull it forward).

If git fails (no merge base, not a repository, git missing), the table gets a `git` row marked `FAIL`, every check is selected and the exit code is non-zero. A build that is not the pinned one fails the gate rows unless `COUNCIL_ALLOW_UNPINNED=1` is set.

## What each check is, and when it is selected

| Change touches | Checks |
| :- | :- |
| Anything | hygiene (`scripts/check-hygiene.sh`); the guidance checker (`scripts/check-guidance.mjs`); the ask-first report |
| `mods/council-of-elrond/hooks/`, `mods/council-of-elrond/tests/`, `mods/council-of-elrond/types/` or `mods/council-of-elrond/.claude-plugin/`; `mods/tsconfig.json`; `mods/types/` | the pinned-build check; the tests; the typecheck; validate the plugin; no `tool.check` hook; the conventions check |
| `.claude-plugin/marketplace.json` or `mods/council-of-elrond/.claude-plugin/plugin.json` | validate the marketplace |
| `hooks/rules/`, `hooks/config/defaults.ts`, `hooks/redact.ts`, `hooks/members/gollum.ts` | the sweep row (MANUAL: R9) |
| `hooks/register.ts` hunks that touch `next(`, `.catch(`, `proceed(` or `deny:`; `hooks/rules/classify.ts`; `hooks/elrond/operations.ts` | the mutation-check row (MANUAL: R7) |
| `scripts/`, `.githooks/`, `.claude/`, `.github/` | `node --test scripts/tests/` (the tests of verify and of the guidance checker) |
| Documents only | hygiene and the guidance checker only |

The conventions check is the mechanical part of what a reader used to pre-check: a `$` parameter outside `hooks/register.ts` fails; a new `atom(` call fails; a `hooks/` change with no `tests/` change warns; a change to `hooks/strings.ts`, `userConfig` or `hooks/elrond/commands.ts` with no change to `mods/council-of-elrond/README.md` or `CHANGELOG.md` warns.

## The gate commands

Run from the repository root, in this order. This is the standard verify, and what the verify command runs for a change to the mod.

```
"${COUNCIL_CLAUDE:-claude}" plugin test mods/council-of-elrond                # all tests
tsc -p mods                                                                   # strict typecheck against mods/types/claude-code.d.ts
"${COUNCIL_CLAUDE:-claude}" plugin validate --strict mods/council-of-elrond   # copy its hooks:/calls: lines into DESIGN.md §2
scripts/check-hygiene.sh                                                      # generated files, personal data, links, the two pins agree
```

All four pass before every commit; the first three run on the Claude Code build CI pins (the next section).

## The pinned build

The three gates run on the Claude Code build CI pins: the `@anthropic-ai/claude-code@X.Y.Z` in the
install step of `.github/workflows/ci.yml` (the release workflow pins the same one, and DESIGN.md's
header names it). A newer build on your PATH can fail tests the pinned one passes, so
`scripts/setup.sh` and the pre-commit hook read the pin from `.github/workflows/ci.yml`, compare it with
`--version` of the binary they use and, in the hook, refuse the commit when they differ. The binary
is `${COUNCIL_CLAUDE:-claude}`. To get the pinned build, install it into a scratch folder and point
the variable at it:


```
. scripts/pinned-claude.sh && PIN=$(pinned_version)      # reads .github/workflows/ci.yml
npm install --prefix <a scratch folder outside the repository> @anthropic-ai/claude-code@$PIN
export COUNCIL_CLAUDE=<that folder>/node_modules/.bin/claude
```

`COUNCIL_ALLOW_UNPINNED=1` lets the hook run on another build. Use it only for a deliberate upgrade
brief (`/upgrade-types`), which moves the pin. `tsc` has no such pin; the vendored types are the
version. Upgrades are scheduled, not made at every new build (`docs/MAINTENANCE.md`).

## Pre-commit and CI

The three gates (the first three commands above), which `scripts/setup.sh` runs and the pre-commit hook runs again on every commit that
touches the mod.
All three must pass before every commit, on the pinned build (the section above). They run in CI too, along with `scripts/check-hygiene.sh`
(no generated files committed, no personal data, links resolve). The hooks live in `.githooks/`;
`scripts/setup.sh` points `core.hooksPath` at them. `git commit --no-verify` skips them when you must, and
CI catches what you skipped.

The pre-commit hook runs `node scripts/verify.mjs --staged`, so the choice of checks has one home. Where `core.hooksPath` is unset neither git hook runs; `scripts/setup.sh` sets it.

CI (`.github/workflows/ci.yml`) has two jobs. `hygiene` runs `scripts/check-hygiene.sh`. `checks` installs Node 22, the pinned build and `typescript`, then runs the tests, the typecheck, validate for the plugin and for the marketplace, and a step that fails if validate names a `tool.check` hook (the mod must never take part in the permission decision, SPEC §7 and §22). It also runs the guidance checker and `node --test scripts/tests/`. `.github/workflows/release.yml` runs on a tag `council-of-elrond--v*`, checks the tag against `mods/council-of-elrond/.claude-plugin/plugin.json` and `CHANGELOG.md`, and runs the gates with the same pin. The two pins must agree; hygiene checks it.

## Checks with no command

- **The sweep against `main`** (R9): MANUAL until brief M2.1. How: `references/domain-gate-direction.md`.
- **The mutation check** (R7): MANUAL. How: `references/testing.md`.
- **The terminal check**, `docs/TERMINAL-CHECK.md`: the maintainer's, in a terminal, for releases and dialog changes. Interactive UI cannot be checked headless.

## The ask rules and the two hooks

- **The `ask` and `deny` rules in `.claude/settings.json` are Claude Code permission rules on the developing session.** They are not the mod, which is never loaded there (R1); the mod's rules tier is unrelated. An Edit or Write to a listed path prompts. A shell edit (`sed -i`, `cp`) goes round a path rule, so every ask-first item has a second gate: a workflow step, a verify row and the reviewer. The allow list never allows `claude -p`, so a headless child run prompts by default (R13).
- **The post-edit hook**, `scripts/hooks/lint-edited.mjs`, runs after every Edit or Write. It is a small check: syntax, the `.editorconfig` rules and a single-file typecheck of the edited file and what it imports, reported as additional context. It never fails the edit and never crashes; the whole-project typecheck stays in the verify command.
- **The session-start hook**, `scripts/hooks/session-start.sh`, runs only in cloud sessions. It installs the pinned build into a cache folder outside the repository (and `typescript` if `tsc` is missing), exports `COUNCIL_CLAUDE`, warns if `claude plugin list` names `council-of-elrond` (R1), and never fails the session start. `COUNCIL_SKIP_SESSION_SETUP=1` turns it off; set it in an environment where an unattended session clones this repository.

## The guidance checker

`node scripts/check-guidance.mjs` runs in the verify command, in pre-commit and in CI. It checks that:

- a backticked path in a guidance file resolves from the repository root, else from `mods/council-of-elrond/`, else from the skill folder or its `references/`, and an anchor after a path matches a heading of that file;
- `CLAUDE.md` is within its line and byte budget, and no file under `references/` is over 10 KB;
- the routing table has one row for every reference file and names only existing files;
- each rule id is defined once, in `references/conventions.md`, and every id used elsewhere exists;
- rule files and command skills only point;
- model tier names appear only in agent frontmatter and the one table of `references/recipes-orchestration.md`;
- the ask paths in `.claude/settings.json`, the ask-first list in `CLAUDE.md` and the safety-boundary block of `.github/CODEOWNERS` agree;
- CI and the pre-commit path both invoke the checker and the script tests.

Its tests are `node --test scripts/tests/`.
