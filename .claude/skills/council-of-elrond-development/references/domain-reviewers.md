# Reviewers and what reaches a model

The reviewers are one file each in `hooks/members/`, with `hooks/members/brief.ts` and `hooks/members/shared.ts`. This file points, except for the two review points below, which moved here from the maintainer guide.

## What to read

- The decisions: `mods/council-of-elrond/DESIGN.md#15-hardening-after-the-november-review` items 9 to 13 and 15 (cut input, what a cut means, a cut command, redact before cutting, context left out, a malformed verdict), and `mods/council-of-elrond/DESIGN.md#16-hardening-round-2` items 6 and 26 (a cut script or SQL file, the names a call supplies inside the fence).
- The user's view: `mods/council-of-elrond/README.md#reviewers`, `mods/council-of-elrond/README.md#long-input`, `mods/council-of-elrond/README.md#models`, `mods/council-of-elrond/README.md#read-only-preview`.
- The cap on model members: SPEC section 3 (`mods/council-of-elrond/SPEC.md`).
- Tests: `tests/members.test.ts`, `tests/galadriel.test.ts`, `tests/gandalf.test.ts`, `tests/aragorn.test.ts`, `tests/omission.test.ts`.

## Review points

- **A new process.** Only Galadriel's table and `gimli.commands` may start one. Anything else is
  a design change for the roadmap.
- **A new reviewer input.** Everything that reaches a model is session content; it must go through
  `untrusted(...)` and redaction, and the limits in the member's `LIMITS`.

## Rules of the area

- Everything that reaches a model is session content: fence it, redact it first, and cap it with the member's `LIMITS` (`references/domain-redaction.md`).
- The proposed command is never run by a preview: a test asserts it is never among `w.processes`.
- The files that decide what reaches a model or starts a process are ask-first: stop and ask before editing `hooks/members/shared.ts`, `hooks/members/brief.ts`, `hooks/members/galadriel.ts`, `hooks/elrond/escalation.ts`, `hooks/elrond/refusal.ts`, `hooks/elrond/suggest.ts` or `hooks/elrond/chat.ts`.

## Do the task

`references/workflows/change-reviewer.md`.
