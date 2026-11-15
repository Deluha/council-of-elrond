# Trust, the rules-file schema, state, audit and the retry brake

This file points, except for the data list below, which moved here from the maintainer guide.

## Trust and the rules-file schema

- Code: `hooks/config/trust.ts` (what a project rules file may do before it is confirmed; the trust record), `hooks/config/schema.ts`, `hooks/config/types.ts`, `hooks/config/write.ts`; the `trust`, `untrust` and `needsPerson` parts of `hooks/elrond/commands.ts`.
- Decisions: `mods/council-of-elrond/DESIGN.md#15-hardening-after-the-november-review` item 22, and `mods/council-of-elrond/DESIGN.md#16-hardening-round-2` items 1, 10, 21, 22 and 28. The rule they state: an unconfirmed or broken rules file can only add to the shipped decision.
- The user's view: `mods/council-of-elrond/README.md#trusting-a-projects-rules-file`; the threat: `SECURITY.md`.
- Tests: `tests/trust.test.ts`, `tests/broken.test.ts`, `tests/config.test.ts`, `tests/scopes.test.ts`.

## Session state

- `hooks/state.ts` and the contract in `types/index.d.ts` (R5). A new field goes in both and in `INITIAL_SESSION`; bump `v` when an old value must not be read as the new shape. Tests: `tests/state.test.ts`.
- How: `references/workflows/change-pipeline.md`.

## The audit line

- `hooks/audit.ts` and `finish()` in `hooks/register.ts`; each gated call writes exactly one line. Tests: `tests/audit.test.ts`. Decisions: DESIGN §16 item 25.

## The retry brake

- `hooks/elrond/operations.ts` (`outcomeOf`, `USER_REFUSAL`, `AUTOMATIC_DENIAL`). Decisions: `mods/council-of-elrond/DESIGN.md#15-hardening-after-the-november-review` item 20, `mods/council-of-elrond/DESIGN.md#16-hardening-round-2` items 7 and 24. Its open decisions, OD1 to OD7, are in section 6 of the roadmap and are the maintainer's. The denial wordings are read from the Claude Code binary: `references/workflows/upgrade-types.md`.

## Data the mod keeps

Two things are kept. The trust record is the plugin's own store (under the Claude Code
configuration folder, never in a repository): for each rules file a person confirmed with
`/council trust`, its real path and the SHA-256 of its content, at most 200 entries. `/council
untrust` removes the entries for the files in scope; uninstalling the plugin's data removes the
rest. It holds no file content.

The audit log is the only data the mod accumulates besides that. It holds hashes, tiers, rule ids, verdicts
and reasons (redacted), tokens and timings, your decisions, and for a full council each voice and
each check's status. It never holds file contents, diffs, check output or secrets. Three files of
1 MiB by default, rotated, gitignored by a file the mod writes. Users can delete the folder at any
time. If a contributor adds a field, check it against this list.
