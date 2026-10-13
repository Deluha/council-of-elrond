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

- `mods/types/claude-code.d.ts` (Claude Code 2.1.296) is the API's source of truth, ahead of docs
  and the spec. Don't invent APIs. Don't edit that file; regenerate it (`/upgrade-types`).
- Only `hooks/register.ts` touches `$`; everything else is pure and tested directly.
- Every user-facing string lives in `hooks/strings.ts`. No text in logic.
- Session state is the one `$.state` value, changed only through `hooks/state.ts`.
- Work in stages (SPEC §20). Stop at each stage checkpoint, give the summary SPEC §20 asks for
  (`/checkpoint` drafts it), and wait for the user. Don't start the next stage unasked.
- Decisions the spec doesn't cover: one that tightens (more calls ask or are refused, more text
  is redacted) is decided by picking the safer option, recorded in the current stage's section
  of DESIGN.md, and reported at the checkpoint. One that loosens (fewer findings, less
  redaction, a call that used to ask now passing), even as a side effect of an approved change,
  goes to the user before it is committed. Decisions listed in ROADMAP.md are binding unless
  the user changes them.
- Never load the mod into the session that is developing it. Test with `claude plugin test`, and
  run live checks headless in a throwaway repository with `claude -p --plugin-dir` (`/live-check`).
- Before every commit: `claude plugin test mods/council-of-elrond`, `tsc -p mods` and
  `claude plugin validate mods/council-of-elrond` all pass.
- A behaviour change needs a test that fails without it. For a path that decides whether a call
  runs, break the code on purpose and confirm the test fails.
- Keep user-visible changes in the user manual and `CHANGELOG.md` ("Unreleased").
- Opus orchestrates, reviews and verifies; Sonnet implements; Haiku reads and takes notes.
  Implementation, its tests and every doc a user reads go to `implementer`; multi-file reads go to
  `reader`; internal notes go to `scribe`. Never send implementation to `general-purpose`;
  `Explore` is denied. One brief per independent file set, at most 3 in parallel, each reviewed.
  Every agent stops rather than guess. Details: "Orchestration" below.

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

These rules mirror the shared user-level setup (`~/.claude/CLAUDE.md`, `~/.claude/agents/`,
`~/.claude/settings.json`). Cloud sessions have no user-level config, so this repo carries a copy:
the three files in `.claude/agents/` are identical to the user-level ones, and
`.claude/settings.json` repeats the main model, its effort and the `Explore` deny. Keep the copies
identical, and put anything specific to this repo in this section, not in the agent files.

The main session (Opus, high effort) plans, decides, delegates and verifies; it does not implement
non-trivial changes itself. Quick single-file lookups it does directly. An agent that hits
ambiguity stops and reports rather than choosing.

| Role | Agent | Model | Effort | Tools | Use for |
| :- | :- | :- | :- | :- | :- |
| Orchestrator | main session | `opus` | `high`, from `modelSettings` | all | intent, design, briefs, review, verification, checkpoints |
| Implementer | `implementer` | `sonnet` | `medium`; `high` passed per task (rule 3) | Read, Grep, Glob, Edit, Write, Bash | logic, tests, and every doc a user reads (READMEs, `CHANGELOG.md`, `docs/`, `mods/council-of-elrond/*.md`), dictated wording included |
| Reader | `reader` | `haiku` | `medium` | Read, Grep, Glob | reads that span several files: sweeps, greps, the diff pre-check |
| Scribe | `scribe` | `haiku` | `medium` | Read, Write | internal notes, session logs, changelog drafts, summaries; never code, tests or a doc a user reads |
| Plan research | built-in `Plan` | inherits `opus` | inherits the session's | built-in | planning research |

Built-in agents: `Explore` is denied (`Agent(Explore)` in `permissions.deny`) because it runs on
the main model and would bypass `reader`. `Plan` stays enabled. `general-purpose` stays enabled but
never receives implementation work. Forks inherit Opus and the full conversation; use one only
when a task genuinely needs that context.

Rules:

1. Always name the subagent type explicitly. Implementation goes to `implementer`, multi-file
   reading to `reader`, notes to `scribe`. Never send implementation to `general-purpose`.
2. Every delegation brief includes:
   - the goal;
   - the exact files in scope, and the "Read first" paths;
   - the constraints: what not to touch, what to stop on, and the rules of this file that apply.
     Edit briefs also say: reuse the shared helpers (`refusalText`, `questionText`, `redact`,
     `untrusted`, `untrustedRules`, `ANSWER_FORMAT`, `finish()`) and the patterns
     `docs/DEVELOPMENT.md` says to copy rather than re-deriving them; never weaken a guard or a
     test to get green;
   - explicit acceptance criteria: the observable result;
   - how to verify: the commands that must pass, with raw output pasted.
3. Pass `effort: "high"` to `implementer` for bug fixes in existing code, migrations, and
   edge-case-heavy work; leave it at medium otherwise. Never pass a model, and never make `xhigh`
   or `max` a default.
4. Before a task is declared done, the orchestrator reads the actual diff and runs the tests
   itself: the three gates and `scripts/check-hygiene.sh`. A subagent's summary, or the output it
   pasted, is never enough on its own.
5. When a subagent's result is wrong: if it skipped files, skipped tests or stopped early, rerun
   it at higher effort; if it had full context, clearly tried and was still wrong, the
   orchestrator takes the task over.
6. Independent reads and edits run in parallel (several Agent calls in one message, at most 3);
   edit briefs that run together get disjoint file sets. Dependent steps run in sequence.

Who owns what:

| Work | Owner | Note |
| :- | :- | :- |
| Intent, design, briefs, the review of every brief's result | orchestrator | No agent reviews its own work; the reviewer never edits. |
| Decisions the spec doesn't cover, stage checkpoints | orchestrator | A tightening: safer option picked, recorded in DESIGN.md, reported at the checkpoint. A loosening: put to the user before the commit. |
| Verify commands (the three gates, `scripts/check-hygiene.sh`) | orchestrator | Run by the orchestrator itself before a task is declared done and before every commit. |
| Sweeps, greps, reading across files | `reader` | Findings with file:line, no recommendations; the orchestrator reads the files that matter. |
| Implementation with domain logic, tests, plus the docs that describe that logic | `implementer` | Docs for new or changed logic ship in the same brief as the logic. |
| Edits to tracked docs whose wording the brief dictates | `implementer` | Fully decided brief; never an error-handling or return-path change. |
| Internal notes, session logs, changelog drafts, summaries | `scribe` | Drafts only; the tracked `CHANGELOG.md` entry goes to `implementer`. |
| Diff pre-check, limited to what no CI check catches: a parameter or import named `$` in a module other than `hooks/register.ts`; a new string literal under `hooks/` outside `strings.ts` and `members/`; a new `atom(` call, or an `update($, session, ...)` whose updater is not a function imported from `./state.js`; a `hooks/` change with no `tests/` change; a change to `strings.ts`, `plugin.json` `userConfig` or `elrond/commands.ts` with no change to `mods/council-of-elrond/README.md` or `CHANGELOG.md` | `reader` | Findings with file:line, no verdict; runs before the Opus review. Trial step: the maintainer removes this row if it adds no findings over 3 PRs. |

The loop: Opus writes the brief; `implementer` runs it; `reader` pre-checks the diff; Opus reads
the diff, runs the three gates and reviews.

Haiku guardrails:

- Effort: `reader` and `scribe` run at `medium`, their model's default. Never `low`: with a long
  always-loaded instruction file, Haiku has been observed to stop before finishing at `low`.
  (The mod's own Haiku reviewer profile in `hooks/elrond/models.ts` is a separate setting.)
- At `medium`, Haiku has been observed to report a change done without running the check. So no
  Haiku agent runs verify commands or edits tracked files; the orchestrator runs the checks.
- Haiku briefs carry zero open choices. Anything needing domain judgement goes to `implementer`;
  open choices stay with the orchestrator.
- Corrections to a running Haiku agent go as a new message, never embedded in a tool result it
  will read.
