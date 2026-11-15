# Change redaction or the secrets scan

## Preconditions

- Read `references/domain-redaction.md`.
- Decide which way the change goes before editing. Less redaction, a narrower pattern or a wider allowlist is a loosening (R8): stop and ask before any commit.

## Steps

1. Make the change in `hooks/redact.ts` (the patterns and `redact`) or `hooks/members/gollum.ts` (the scan).
2. A new or changed pattern gets a linear-time test on adversarial input next to the existing ones (`tests/gollum.test.ts`, `tests/secrets.test.ts`).
3. Fake secrets in tests are joined from two halves at run time and must not match a real provider's format exactly (R11, `tests/fixtures.ts`).
4. Check that redaction still happens before anything reaches a model, a dialog, the pane or the log, and before a text is cut.

## Verification

Run `node scripts/verify.mjs` (`/verify-change`) on the pinned build (`references/qa-ci.md`) and read its table. Run the sweep against `main` (R9, `references/domain-gate-direction.md`): the pull request states "lower than `main`: none", or lists each line with its approval. A path that decides what leaves the process gets the mutation check (R7).

## Docs to update

`mods/council-of-elrond/README.md` ("Secrets scan"), `CHANGELOG.md` under "Unreleased", a DESIGN decision in the section for the current milestone or hardening pass. If the scope of what the mod protects changes, `SECURITY.md` (path-gated).

## Ask first

- **Redaction and the secrets scan** (`hooks/redact.ts`, `hooks/members/gollum.ts`): path-gated, the edit prompts.
- **Any loosening**: stop and ask.
