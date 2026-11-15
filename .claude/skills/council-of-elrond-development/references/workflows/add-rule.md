# Add or change a shipped rule or a protected path

## Preconditions

- The brief says which way the change moves the gate. A change that lowers any tier is a loosening (R8): stop and ask before the commit.
- The category is on the board. A rule outside the roadmap's briefs is not started out of board order.
- Read `references/domain-classifier.md`.

## Steps

1. Add it to the array for its tier in `hooks/config/defaults.ts` (`BLOCK`, `ASK` or `REVIEW`): an
   `id`, a `tier`, `tools`, and either a `command`, `path` or `input` pattern or a `check:` naming
   a code check in `hooks/rules/checks.ts` (and in `CHECKS`, `hooks/config/types.ts`), with a
   `reason` the user will read, and `member` and `profile` for the review tier.
2. Mind the floor: a block rule can't be disabled or lowered by a project rule, so block only what
   is never right. Prefer review for anything a project might legitimately do.
3. Test it in `tests/rules.test.ts`: the call that should match, the near miss that should not,
   and the compound form.

## Verification

Run `node scripts/verify.mjs` (`/verify-change`) on the pinned build (`references/qa-ci.md`) and read its table. The call that should match, the near miss and the compound form are in the tests.

Finish with the sweep against `main` (R9, `references/domain-gate-direction.md`): no command may end up lower.

For a rule that decides whether a call runs, break the code on purpose and confirm the test fails (R7, `references/testing.md`).

## Docs to update

Document it in the README's "Tiers" list and in the CHANGELOG, and update "Known gaps in shell
   parsing" in the README if the rule closes or narrows one.

A decision the brief did not settle goes in `mods/council-of-elrond/DESIGN.md`, in the section for the current milestone or hardening pass (R8).

## Ask first

- **Shipped rules, protected paths and branches, big operations, built-in models** (`hooks/config/defaults.ts`): path-gated, the edit prompts.
- **The classifier** (`hooks/rules/`): path-gated, the edit prompts.
- **Any loosening**, even as a side effect: stop and ask.
