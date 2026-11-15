# Change the decision pipeline, the session state or the audit line

## Preconditions

- Read `references/architecture.md` and `references/host-api-facts.md`, then the rules R3 and R5.
- A change that lets a call through that used to ask, or stops a refusal counting, is a loosening (R8): stop and ask.

## Steps

### Change the pipeline in `hooks/register.ts`

`hooks/register.ts` keeps wiring; every decision lives in a sibling module that gets plain values (`references/architecture.md`). A new `$` call shows up in `claude plugin validate`'s `calls:` line: ask why it is needed and whether its failure refuses or passes.

- Every pass-through goes through `proceed()`; the `.catch` replays the real result if `next.called`, else refuses. Keep exactly one `tool.call` hook and never a `tool.check` hook.
- Every gated call writes exactly one audit line, through `finish()`. The line never holds file contents, diffs, check output or secrets.
- Every refusal is built by `refusalText`, every escalation by `questionText` (`references/recipes.md`).

### Change the session state

Add the field to `CouncilSession` in `types/index.d.ts` and to `INITIAL_SESSION`. If it is per
prompt, clear it in `resetForPrompt`. If an old value must not be read as the new shape, bump `v`
and the check in `sessionOf`. Writes to `$.state` are refused while drawing, so never set state
from a `ui.render` hook.

## Verification

Run `node scripts/verify.mjs` (`/verify-change`) on the pinned build (`references/qa-ci.md`) and read its table. Tests: `tests/pipeline.test.ts`, `tests/robustness.test.ts`, `tests/state.test.ts`, `tests/audit.test.ts`, `tests/operations.test.ts`, `tests/rounds.test.ts`. The pass-through, the catch and the retry brake decide whether a call runs: run the mutation check (R7, `references/testing.md`). The verify output must show no `tool.check` hook.

## Docs to update

Paste the `hooks:` and `calls:` lines from `claude plugin validate` into `mods/council-of-elrond/DESIGN.md` section 2 if they changed; add the failure path to its section 4; record a decision in the section for the current milestone or hardening pass; `CHANGELOG.md` under "Unreleased"; the manual if the change is user-visible.

## Ask first

- **The pass-through and the fail-closed catch**, the single `tool.call` hook: stop and ask (`hooks/register.ts`); a path rule would prompt too often.
- **Session state shape and migration** (`hooks/state.ts`, `types/index.d.ts`): stop and ask; bump `v` when an old value must not be read as the new shape.
- **The audit line format** (`hooks/audit.ts`, `finish()`): stop and ask.
- **The retry brake and the denial wordings** (`hooks/elrond/operations.ts`): stop and ask; its open decisions are the maintainer's.
