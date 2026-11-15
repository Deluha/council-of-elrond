# Teach the shell parser a wrapper, a runner or a command form

## Preconditions

A wrapper (`timeout`, `nice`, `sudo`) or a runner (`npm exec`, `uv run`) carries another command;
the parser must find it.

- A change that could lower a tier is a loosening (R8): stop and ask.
- Read `references/domain-classifier.md`.

## Steps

1. Add a `Spec` for it to the tables in `hooks/rules/shell.ts` (`WRAPPERS`, the runner tables):
   which options take a value, which are flags, which change the directory or root, and which
   carry a command string. List them from the program's own help, not from memory: an option
   listed with the wrong arity makes the parser take the wrong word for the command.
2. An option the table does not list makes the part unresolved, which the shipped review rule
   `shell-runner-unresolved` catches. Its pattern in `hooks/config/defaults.ts` repeats the program
   names; the test "the review rule names every wrapper the parser reads" in
   `tests/rules.test.ts` fails if the two drift apart.
3. Test in `tests/rules.test.ts`: the inner command keeps its own tier through the wrapper (a
   blocked command stays blocked), each value option in its spaced, attached and clustered forms,
   a protected path named as an option's value still asks, and a harmless inner command stays
   allowed.

## Verification

Run `node scripts/verify.mjs` (`/verify-change`) on the pinned build (`references/qa-ci.md`) and read its table. The test "the review rule names every wrapper the parser reads" (`tests/rules.test.ts`) must pass.

Finish with the sweep against `main`.

For a path that decides whether a call runs, run the mutation check (R7, `references/testing.md`).

## Docs to update

The README's "Known gaps in shell parsing" if the change closes or narrows one, and its "Tiers" list if a rule changed (`mods/council-of-elrond/README.md`); `CHANGELOG.md` under "Unreleased"; a DESIGN decision if the brief did not settle the choice.

## Ask first

- **The classifier and shell parser** (`hooks/rules/shell.ts`): path-gated, the edit prompts.
- **Shipped rules** (`hooks/config/defaults.ts`, the `shell-runner-unresolved` pattern): path-gated, the edit prompts.
- **Any loosening**: stop and ask.
