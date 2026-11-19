# Conventions: the hard rules

The fifteen hard rules, each in full under its id, and the simplicity audit that closes every pull request. `CLAUDE.md` carries the short forms; every other file points here, for example `references/conventions.md#r1`.

## R1

Never load the mod into the session that is developing it. Test with `claude plugin test`, and
run live checks headless in a throwaway repository, from a copy of the mod, with `claude -p --plugin-dir` (`/live-check`).
It would gate your own tool calls.
Keep the mod out of the session building it. Not through the plugin-authoring skill's
hot-reload folder, not with `--plugin-dir` on the session you work in.
How to check: `references/workflows/live-check.md`.

## R2

`mods/types/claude-code.d.ts` (the version named at the top of DESIGN.md) is the API's source of truth, ahead of docs
and the spec. Don't invent APIs. Don't edit that file; regenerate it (`/upgrade-types`).
If the types are out of date: `references/workflows/upgrade-types.md`.

## R3

Only `hooks/register.ts` touches `$`; everything else is pure and tested directly.
Why, and how `hooks/register.ts` is built: `references/architecture.md`.

## R4

Every user-facing string lives in `hooks/strings.ts`. No text in logic.
What counts as a string, and the two places text may live outside it: `references/style.md`.

## R5

Session state is the one `$.state` value, changed only through `hooks/state.ts`.
How to add a field: `references/workflows/change-pipeline.md`.

## R6

Before every commit: `claude plugin test mods/council-of-elrond`, `tsc -p mods` and
`claude plugin validate --strict mods/council-of-elrond` all pass, run with the Claude Code build CI pins.
The single command, the build and its pin: `references/qa-and-ci.md`.

## R7

A behaviour change needs a test that fails without it. For a path that decides whether a call
runs, break the code on purpose and confirm the test fails.
How to run the mutation check: `references/testing.md`.

## R8

Decisions the spec doesn't cover: one that tightens (more calls ask or are refused, more text
is redacted) is decided by picking the safer option, recorded in DESIGN.md, in the section
for the current milestone or hardening pass, and reported at the checkpoint. One that loosens (fewer findings, less
redaction, a call that used to ask now passing), even as a side effect of an approved change,
goes to the user before it is committed. A brief marked loosens is approved for exactly what it says.
How to tell which way a change goes: `references/domain-gate-direction.md`.

## R9

Sweep before you finish. Every change to the classifier (`hooks/rules/`,
`hooks/config/defaults.ts`) or to redaction (`hooks/redact.ts`, `hooks/members/gollum.ts`) ends
with a before-and-after comparison against `main`: the policy table once M2.1 exists; until
then, generated command sets as the brief names them. The pull request states "lower than
`main`: none", or lists each line with the decision that approves it. Two of the three review
rounds found a loosening that its author had described as a tightening; this rule exists
because of that.
How to run it: `references/domain-gate-direction.md`.

## R10

Keep user-visible changes in the user manual and `CHANGELOG.md` ("Unreleased").
Docs for new or changed logic ship in the same brief as the logic.
Which documents: `references/workflows/docs-and-checkpoint.md`.

## R11

Nothing personal or environment-specific in committed files: no emails, no local paths, no
session links and no model names in code, comments or docs. Commit trailers added by the
tooling are fine. Family names and aliases of models are fine, and so is a full model id used as test data or a config example. Saying which model wrote
something is not.
Test fixtures use `/work`, `/home/me` and `example.com`. Fake secrets in tests must not match a
real provider's format exactly (GitHub's push protection flags a well-formed `ghp_` token).
A bypass of the rules tier is a security issue: don't describe reproduction steps in a public
issue or commit message; see `SECURITY.md`.
Never quote an input that gets past the rules tier in a commit message, a pull request or a public issue (`SECURITY.md`). If a change fixes a bypass, keep the triggering input out of the title and description; put it in a test with a neutral name.

## R12

Never stash, reset or check out over a tree another agent is editing. Test in a separate
copy (`git worktree` or `git archive` into scratch space).

## R13

A headless child run (`/live-check`, where a brief asks for one) names a small model, a
permission mode and a budget on its command line (`--model`, `--permission-mode`, a budget flag),
because a child run otherwise inherits the session's model, plugins and permission mode, and
costs real money. Single runs in the hardening sessions cost from about 0.2 to 0.7 USD on the
session's own model.
How: `references/workflows/live-check.md`.

## R14

Work in milestones (ROADMAP.md), one brief per pull request. Stop at each milestone's
checkpoint, give the summary SPEC §20 asks for (`/checkpoint` drafts it), and wait for the user.
Don't start the next milestone unasked.
One brief, one branch, one pull request. The stated exceptions are in the briefs themselves
(M0.1 lands with M0.2).
Decisions listed in ROADMAP.md are binding unless the user changes them.
A session must never push to `main` or merge a pull request, and must never change a decision recorded in sections 6, 7 or 9 of the roadmap without the maintainer.
The protocol for one brief: `references/session-protocol.md`.

## R15

Never weaken a test or a guard to get green. A failing test is evidence: read it, then fix the code or ask.

## Simplicity

Every pull request leaves the files it touches clearer, shorter and more modular than it found them. Before a diff is final, audit each touched file and the files it points at, and fix each finding or say why it stays:

1. Dead imports, unused variables and unused exports.
2. Commented-out code: delete it; git keeps the history.
3. Duplicated logic: reuse the existing helper (`references/recipes.md`, grep before coding) rather than a second copy.
4. Helpers nobody calls any more.
5. Functions that have grown past one screen: split them into named helpers.
6. Speculative parameters, options or abstractions no caller needs.
7. Magic numbers and strings: a named constant, defined once (user-facing text in `hooks/strings.ts`, R4).
8. Patterns that differ from the rest of the codebase without a recorded reason: align them.
9. Comments that restate the code (`references/style.md`): say why, or delete them.

A fix that is mechanical and inside the diff's own files is made. A fix that would change behaviour, a public shape or an ask-first path (`CLAUDE.md`) is not bundled in: report it to the orchestrator as a separate item. A smaller, surgical change beats a wide refactor.
