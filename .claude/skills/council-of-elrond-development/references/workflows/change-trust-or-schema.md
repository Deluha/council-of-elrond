# Change the trust rule or the rules-file schema

## Preconditions

- Read `references/domain-state-and-trust.md`.
- The rule to keep: a rules file nobody has confirmed can only add to the shipped decision, and a broken file keeps only what can only tighten. A change that lets an unconfirmed file loosen is a loosening (R8): stop and ask.

## Steps

1. Schema: add the field to `hooks/config/types.ts` and `hooks/config/schema.ts`, with its validation and caps. Decide whether the setting loosens; if it does, it waits for `/council trust` and is shown in the trust listing in full.
2. Trust: `hooks/config/trust.ts` decides what waits and what is recorded. Confirming covers everything the file switches on, and only what the person confirmed is recorded, including when the mod itself writes the file (`hooks/config/write.ts`).
3. Commands: a subcommand that loosens is in `needsPerson` in `hooks/elrond/commands.ts` and is refused for a non-person origin.
4. Tests: `tests/trust.test.ts`, `tests/broken.test.ts`, `tests/config.test.ts`, `tests/scopes.test.ts`: an unconfirmed file can only add; a broken file keeps its protections.

## Verification

Run `node scripts/verify.mjs` on the pinned build (`references/qa-and-ci.md`) and read its table. The tests above must show an unconfirmed file can only add. This path decides what a call is held to: run the mutation check (R7, `references/testing.md`).

## Docs to update

`mods/council-of-elrond/README.md` ("Trusting a project's rules file"), `SECURITY.md` if the boundary moved (path-gated), `CHANGELOG.md` under "Unreleased", a DESIGN decision (the existing ones are items of its sections 15 and 16).

## Ask first

- **The trust rule and the rules-file schema** (`hooks/config/trust.ts`, `hooks/config/schema.ts`): path-gated, the edit prompts. `hooks/config/types.ts`, `hooks/config/write.ts` and the `trust`, `untrust` and `needsPerson` parts of `hooks/elrond/commands.ts`: stop and ask.
- **Any loosening**: stop and ask.
