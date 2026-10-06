# council-of-elrond

A Claude Code mod (function-hooks plugin) in `mods/council-of-elrond` that gates risky tool calls.
Public, MIT-licensed, open-source repository.

## Start here

- **Status, next tasks, approved decisions, hard-won API facts:** `mods/council-of-elrond/ROADMAP.md`.
- **How it works and why, per-stage decisions, failure modes:** `mods/council-of-elrond/DESIGN.md`.
- **The original spec:** `mods/council-of-elrond/SPEC.md`. ROADMAP.md and DESIGN.md win over it.
- **User manual:** `mods/council-of-elrond/README.md`.
- **Developer guide (layout, conventions, tests, live checks, recipes):** `docs/DEVELOPMENT.md`.
- **Maintainer guide (Claude Code updates, releases):** `docs/MAINTENANCE.md`.
- **Open findings and proposed amendments:** `docs/REVIEW-2026-10.md`.

## Rules

- `mods/types/claude-code.d.ts` (Claude Code 2.1.291) is the API's source of truth, ahead of docs
  and the spec. Don't invent APIs. Don't edit that file; regenerate it (`/upgrade-types`).
- Only `hooks/register.ts` touches `$`; everything else is pure and tested directly.
- Every user-facing string lives in `hooks/strings.ts`. No text in logic.
- Session state is the one `$.state` value, changed only through `hooks/state.ts`.
- Work in stages (SPEC §20). Stop at each stage checkpoint, give the summary SPEC §20 asks for
  (`/checkpoint` drafts it), and wait for the user. Don't start the next stage unasked.
- Decisions the spec doesn't cover: pick the safer option, record it in the current stage's
  section of DESIGN.md, and report it at the checkpoint. Decisions listed in ROADMAP.md are
  binding unless the user changes them.
- Never load the mod into the session that is developing it. Test with `claude plugin test`, and
  run live checks headless in a throwaway repository with `claude -p --plugin-dir` (`/live-check`).
- Before every commit: `claude plugin test mods/council-of-elrond`, `tsc -p mods` and
  `claude plugin validate mods/council-of-elrond` all pass.
- A behaviour change needs a test that fails without it. For a path that decides whether a call
  runs, break the code on purpose and confirm the test fails.
- Keep user-visible changes in the user manual and `CHANGELOG.md` ("Unreleased").

## Public repository

- Nothing personal or environment-specific in committed files: no emails, no local paths, no
  session links and no model names in code, comments or docs. Commit trailers added by the
  tooling are fine.
- Test fixtures use `/work`, `/home/me` and `example.com`. Fake secrets in tests must not match a
  real provider's format exactly (GitHub's push protection flags a well-formed `ghp_` token).
- A bypass of the rules tier is a security issue: don't describe reproduction steps in a public
  issue or commit message; see `SECURITY.md`.
- Commit messages: imperative summary under 72 characters, then why.
