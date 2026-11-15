# The classifier and the shell parser

What decides a call's tier, and where to read about each decision. This file points; it does not repeat.

## Where the code is

- `hooks/rules/shell.ts`: the parser (wrappers, runners, heredocs, option clusters, command strings handed to other programs).
- `hooks/rules/classify.ts`: the classifier. `hooks/rules/checks.ts`: the code checks a rule names with `check:`. `hooks/rules/push.ts`: the one parser of `git push` arguments. `hooks/rules/globs.ts`, `hooks/rules/paths.ts` and `hooks/rules/scopes.ts`: patterns, paths and rules per repository.
- `hooks/config/defaults.ts`: the shipped rules, the protected paths and branches. `hooks/config/types.ts`: the names a rule's `check:` may use.
- Tests: `tests/rules.test.ts` (tables through `expectCases`), `tests/scopes.test.ts`.

## What to read

- The decisions: `mods/council-of-elrond/DESIGN.md#15-hardening-after-the-november-review` items 1 to 7 (heredocs, wrappers, multi-call binaries, computed program names, interpreters, inline-code flags, the mod protecting itself), 17 and 19 (pushes), and `mods/council-of-elrond/DESIGN.md#16-hardening-round-2` items 9, 12 and 29 to 35 (protected paths on every word, more gaps, `cd`, readers, typing into another terminal, option arities, a stall on crafted input, scripts never cached).
- The live list of what still passes: `mods/council-of-elrond/README.md#known-gaps-in-shell-parsing` and the tiers: `mods/council-of-elrond/README.md#tiers`.
- How rules are written and merged: `mods/council-of-elrond/README.md#editing-rules`.

## Rules of the area

- A block rule cannot be disabled or lowered by a project rule. Block only what is never right; prefer review for anything a project might legitimately do.
- A wrapper or an option the parser does not know makes the part unresolved, and the shipped review rule `shell-runner-unresolved` catches it. A wrong option arity hides a command: list options from the program's own help.
- Input is untrusted: a crafted command must classify in linear time (DESIGN §16 item 34).
- Any change that could lower a tier is a loosening (R8) and ends with the sweep (R9): `references/domain-gate-direction.md`.

## Do the task

`references/workflows/add-rule.md` for a rule or a protected path; `references/workflows/teach-parser.md` for a wrapper, a runner or a command form. The edits to `hooks/rules/` and `hooks/config/defaults.ts` prompt.
