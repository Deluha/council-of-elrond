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
- Opus orchestrates and reviews; Sonnet implements; Haiku reads, verifies and transcribes. Opus
  owns intent, design, briefs and review. Logic edits, their tests and the docs that describe
  them go to the implementer (Sonnet). Dictated edits and verify runs go to `scribe` (Haiku,
  `effort: high` pinned in `.claude/agents/scribe.md`). Sweeps and pre-checks go to the research
  agent (Haiku). Pin rule: an agent file pins `model` and `effort` in its frontmatter and the call
  passes neither; a built-in agent has no frontmatter, so its call passes `model: "haiku"` (or
  `"sonnet"`) and never `effort`. One brief per independent file set, at most 3 in parallel, each
  reviewed. Every agent stops rather than guess. Details: "Orchestration" below.

## Public repository

- Nothing personal or environment-specific in committed files: no emails, no local paths, no
  session links and no model names in code, comments or docs. Commit trailers added by the
  tooling are fine. Family names and aliases (Sonnet and `sonnet`, Opus, Haiku, Fable) are fine,
  and so is a full model id used as test data or a config example. Saying which model wrote
  something is not.
- Test fixtures use `/work`, `/home/me` and `example.com`. Fake secrets in tests must not match a
  real provider's format exactly (GitHub's push protection flags a well-formed `ghp_` token).
- A bypass of the rules tier is a security issue: don't describe reproduction steps in a public
  issue or commit message; see `SECURITY.md`.
- Commit messages: imperative summary under 72 characters, then why.

## Orchestration

Three lanes. Opus thinks and judges; Sonnet writes logic (the implementer); Haiku reads, verifies
and transcribes (the research agent for sweeps and pre-checks, `scribe` for dictated edits and
verify runs). A Sonnet or Haiku agent that hits ambiguity stops and reports rather than choosing.

| Role | Agent | Model | Effort |
| :- | :- | :- | :- |
| Orchestrator and reviewer | the main session | Opus | the session's |
| Implementer | built-in `general-purpose`, called with `model: "sonnet"` | latest Sonnet | not settable per call; the engine's choice |
| Research agent | built-in `Explore`, called with `model: "haiku"` | latest Haiku | not settable per call; the engine's choice |
| `scribe` | `.claude/agents/scribe.md`, the one agent file in this repo | latest Haiku | `high`, pinned in its frontmatter |

Who owns what:

| Work | Model | Note |
| :- | :- | :- |
| Intent, design, briefs, the review of every brief's result | Opus (orchestrator) | No agent reviews its own work; the reviewer never edits. |
| Decisions the spec doesn't cover, stage checkpoints | Opus (orchestrator) | Safer option picked and recorded in DESIGN.md; reported at the checkpoint. |
| Sweeps, greps, file reading | Haiku (research agent) | Findings with file:line, no recommendations; the orchestrator reads the files that matter. |
| Implementation with domain logic, tests, plus the docs that describe that logic | Sonnet (implementer) | Docs for new or changed logic ship in the implementer's brief, never in a parallel `scribe` brief. |
| Mechanical edits whose wording the brief dictates | Haiku (`scribe`) | Fully decided brief only; never an error-handling or return-path change. |
| Verify commands (the three gates, `scripts/check-hygiene.sh`) | Haiku (`scribe`) | Raw output pasted verbatim; missing output = fail. |
| Diff pre-check, limited to what no CI check catches: a parameter or import named `$` in a module other than `hooks/register.ts`; a new string literal under `hooks/` outside `strings.ts` and `members/`; a new `atom(` call, or an `update($, session, ...)` whose updater is not a function imported from `./state.js`; a `hooks/` change with no `tests/` change; a change to `strings.ts`, `plugin.json` `userConfig` or `elrond/commands.ts` with no change to `mods/council-of-elrond/README.md` or `CHANGELOG.md` | Haiku (research agent) | Findings with file:line, no verdict; runs before the Opus review. Trial step: the maintainer removes this row if it adds no findings over 3 PRs. |

The loop: Opus writes the brief; the implementer (`general-purpose` on Sonnet) or `scribe` runs
it; the research agent pre-checks the diff; Opus reviews.

A brief carries the goal, the "Read first" paths, the exact edits (for `scribe`, the wording), the
verify command, and what to stop on.

Haiku guardrails:

- Effort: the read-only research agent keeps whatever effort the engine gives a built-in agent
  (`medium`, as observed); `scribe` stays at its pinned `high`. Never `low`: with a long
  always-loaded instruction file, Haiku has been observed to stop before finishing at `low`. (The
  mod's own Haiku reviewer profile in `hooks/elrond/models.ts` is a separate setting.)
- At `medium`, Haiku has been observed to report a change done without running the check. Every
  brief demands the raw command output, and the orchestrator treats missing output as a fail.
- Haiku briefs carry zero open choices. Anything needing domain judgement in the implementation
  goes to Sonnet; open choices stay with the orchestrator.
- Corrections to a running Haiku agent go as a new message, never embedded in a tool result it
  will read.
