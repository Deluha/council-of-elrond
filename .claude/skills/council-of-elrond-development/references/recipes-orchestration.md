# Orchestration: roles, briefs and the review loop

A rewrite of the former "Orchestration" section of `CLAUDE.md` for the current roles. Guidance names roles; the one table below is the only place a model tier is named.

## Roles

| Role | Agent file | Tier | Effort | Tools | Use for |
| :- | :- | :- | :- | :- | :- |
| Orchestrator | the main session | the session's own | the session's own | all | intent, design, briefs, review, verification, checkpoints, small edits |
| Writer | `.claude/agents/writer.md` | sonnet | medium; high per task (see Effort) | Read, Grep, Glob, Edit, Write, Bash | edits from a complete brief: logic, tests and the docs that describe them |
| Reader | `.claude/agents/reader.md` | haiku | medium | Read, Grep, Glob | read-only work over more than three files: sweeps, greps, "find every place" |
| Reviewer | `.claude/agents/reviewer.md` | inherits the session's | the session's own | Read, Grep, Glob, Bash | reviews the whole diff against the rules and the ask-first list; never edits |

- Always name the agent explicitly when delegating: edits go to the writer, reads over more than three files to the reader, the whole-diff review to the reviewer. Never send edit work to `general-purpose`.
- The writer edits only the files the brief names, runs the targeted checks the brief names, pastes their raw output, stops on ambiguity and never prints a secret value (it names the key or the file).
- The reader is read-only and returns findings with file:line.
- The reviewer uses Bash only for `git diff`, `git log`, `git show` and `node scripts/verify.mjs`.
- Built-in agents: `Explore` is denied in `.claude/settings.json` because it runs on the session's model and would bypass the reader. `Plan` stays enabled. `general-purpose` stays enabled but never receives edit work. A fork inherits the whole conversation; use one only when a task needs that context.

## Who does what

| Work | Owner |
| :- | :- |
| Intent, design, briefs, decisions the spec does not cover, checkpoints | orchestrator |
| Small edits: one file, about 20 lines, no ask-first item, no new logic; single-file lookups | orchestrator |
| Logic with its tests, and the docs that describe that logic (R10) | writer |
| Edits to a tracked document whose wording the brief dictates | writer |
| Sweeps, greps and reading across more than three files | reader |
| Reading the whole diff before a pull request | reviewer |
| The verify command, once at the end, and the actual diff | orchestrator |
| Internal notes and session logs | orchestrator or writer |

No agent reviews its own work, and the reviewer never edits. An agent that hits ambiguity stops and reports rather than choosing.

## The brief

Every delegation brief carries:

- the **goal**;
- the **files** in scope, exactly, and the "Read first" paths;
- the **constraints**: what not to touch, what to stop on, and the rules (by id, `references/conventions.md`) that apply. An edit brief also says to reuse the shared helpers (`references/recipes.md`) and the patterns its workflow names, never to weaken a guard or a test to get green (R15), and never to commit unless it says so;
- the **acceptance**: the observable result;
- the **verify**: the commands that must pass, with raw output pasted.

## Effort

Pass `effort: "high"` to the writer for bug fixes in existing code, migrations and edge-case-heavy work; leave it at medium otherwise. Never pass a model, and never make `xhigh` or `max` a default.

## Parallel work

Independent reads and edits run in parallel: several agent calls in one message, at most three. Edit briefs that run together get disjoint file sets. Nearly every behaviour brief touches the same five files: `hooks/register.ts`, `hooks/strings.ts`, `CHANGELOG.md`, `mods/council-of-elrond/DESIGN.md` and `mods/council-of-elrond/README.md`, so those briefs run one at a time. Dependent steps run in sequence.

## The review loop

The orchestrator writes the brief; the writer runs it; the reviewer reads the whole diff and reports; the orchestrator reads the actual diff, runs `node scripts/verify.mjs` once at the end and decides. A subagent's summary, or the output it pasted, is never enough on its own.

### What no check covers: the reviewer's checklist

`node scripts/verify.mjs` checks four items of the diff mechanically (`references/qa-ci.md`). Read the diff by hand for these two:

- a new string literal under `hooks/` outside `hooks/strings.ts` and `hooks/members/` (R4);
- an `update($, session, ...)` whose updater is not a function imported from `./state.js` (R5).

## When a result is wrong

If the agent skipped files, skipped tests or stopped early, rerun it at higher effort. If it had full context, clearly tried and was still wrong, the orchestrator takes the task over.

## Guardrails for the cheaper tiers

- Never run the reader at `low` effort: with a long always-loaded instruction file it has been observed to stop before finishing. (The mod's own reviewer profiles in `hooks/elrond/models.ts` are a separate setting.)
- At medium effort it has been observed to report a change done without running the check. So no reader runs verify commands or edits tracked files; the orchestrator runs the checks.
- Briefs to the reader carry zero open choices. Anything needing domain judgement goes to the writer; open choices stay with the orchestrator.
- Corrections to a running reader go as a new message, never embedded in a tool result it will read.
