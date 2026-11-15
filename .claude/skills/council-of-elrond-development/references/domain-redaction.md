# Redaction and the secrets scan

What reaches a model, a dialog, the pane or the audit log is redacted first. This file points; it does not repeat.

## Where the code is

- `hooks/redact.ts`: `redact` and the shipped secret patterns, also applied with a project's own patterns wherever the mod redacts.
- `hooks/members/gollum.ts`: the secrets scan, a code member with no model.
- Tests: `tests/gollum.test.ts`, `tests/secrets.test.ts`; fixtures in `tests/fixtures.ts` join a fake secret from two halves at run time.

## What to read

- The decisions: `mods/council-of-elrond/DESIGN.md#15-hardening-after-the-november-review` items 12 (redact before cutting), 16 (more secrets), and `mods/council-of-elrond/DESIGN.md#16-hardening-round-2` items 14 to 18 and 36 to 38 (project patterns everywhere, what the scan reads, a text too long to scan, allowlisted secrets, noise undone, a word dressed as a call, the seam of a long text).
- The user's view: `mods/council-of-elrond/README.md#secrets-scan`.
- What never reaches the audit log: `references/domain-state-and-trust.md`.

## Rules of the area

- Redaction happens before anything reaches a model, a dialog, the pane or the log (`references/style.md`).
- Less redaction is a loosening (R8): stop and ask before any commit, even when the change is meant to cut noise (DESIGN §16 item 18 undid a round's noise and no more).
- Every pattern has a linear-time test on adversarial input; a new or changed pattern joins it (`references/testing.md`).
- A fake secret in a test must not match a real provider's format exactly (R11).
- The sweep against `main` ends the change (R9).

## Do the task

`references/workflows/change-redaction.md`. The edits to `hooks/redact.ts` and `hooks/members/gollum.ts` prompt.
