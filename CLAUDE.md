# council-of-elrond

A Claude Code mod (function-hooks plugin) in `mods/council-of-elrond` that gates risky tool calls.

- **Start here:** `mods/council-of-elrond/ROADMAP.md`. It holds the stage status, the next tasks, the approved decisions, the open questions and the hard-won API facts.
- **Spec:** `mods/council-of-elrond/SPEC.md`. Decisions in ROADMAP.md and DESIGN.md win over it.
- **Design and rationale:** `mods/council-of-elrond/DESIGN.md`.

Rules for working here:

- The generated types `mods/types/claude-code.d.ts` (Claude Code 2.1.289) are the API's source of truth, ahead of docs and the spec. Don't invent APIs.
- Stop at each stage checkpoint, give the summary SPEC §20 asks for, and wait for the user.
- Only `hooks/register.ts` touches `$`; everything else is pure and tested directly.
- Never load the mod into the session that is developing it. Test with `claude plugin test`, and run live checks headless with `claude -p --plugin-dir`.
- Before every commit: `claude plugin test mods/council-of-elrond`, `tsc -p mods` and `claude plugin validate mods/council-of-elrond` all pass.
