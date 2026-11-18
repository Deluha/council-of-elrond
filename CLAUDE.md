# council-of-elrond

A Claude Code mod (function-hooks plugin) in `mods/council-of-elrond` that gates risky tool calls. Public, MIT.

## Operating principles

- Start ready: in cloud sessions the session-start hook installs the pinned build; run `/verify-change --all` once and see it green before changing anything.
- Load only what the task needs: open the `council-of-elrond-development` skill, find the task in its table, read the one file it names.
  The board of briefs is `mods/council-of-elrond/ROADMAP.md`.
- Roles: the orchestrator plans, briefs, reviews and verifies; the writer edits from a complete brief; the reader reads when more than three files are involved; the reviewer reviews and never edits.
- Small edits (one file, about 20 lines, no ask-first item, no new logic) the orchestrator makes itself. The full verify runs once, at the end.
- The safer side: a tightening is decided, recorded in `mods/council-of-elrond/DESIGN.md` and reported; a loosening is asked first.
- Stop rather than guess; stop at every checkpoint and wait.
- Every fact lives in one file; everything else points to it.

## Hard rules

Full form of each rule: the pointer after it.

- R1 Never load the mod into the session developing it. `.claude/skills/council-of-elrond-development/references/conventions.md#r1`
- R2 `mods/types/claude-code.d.ts` is the API; never edit it. `.claude/skills/council-of-elrond-development/references/conventions.md#r2`
- R3 Only `hooks/register.ts` touches `$`. `.claude/skills/council-of-elrond-development/references/conventions.md#r3`
- R4 No text in logic: strings live in `hooks/strings.ts`. `.claude/skills/council-of-elrond-development/references/conventions.md#r4`
- R5 Session state changes only through `hooks/state.ts`. `.claude/skills/council-of-elrond-development/references/conventions.md#r5`
- R6 The checks run on the pinned build, before every commit. `.claude/skills/council-of-elrond-development/references/conventions.md#r6`
- R7 A behaviour change has a test that fails without it; a path that decides whether a call runs is mutation-checked. `.claude/skills/council-of-elrond-development/references/conventions.md#r7`
- R8 A loosening goes to the maintainer before the commit. `.claude/skills/council-of-elrond-development/references/conventions.md#r8`
- R9 A classifier or redaction change ends with a sweep against `main`. `.claude/skills/council-of-elrond-development/references/conventions.md#r9`
- R10 Docs ship in the same brief as the change. `.claude/skills/council-of-elrond-development/references/conventions.md#r10`
- R11 Public repository: nothing personal; no bypass input in a commit, pull request or issue. `.claude/skills/council-of-elrond-development/references/conventions.md#r11`
- R12 Never stash, reset or check out over a tree another agent edits. `.claude/skills/council-of-elrond-development/references/conventions.md#r12`
- R13 A headless child run names a small model, a permission mode and a budget. `.claude/skills/council-of-elrond-development/references/conventions.md#r13`
- R14 One brief per pull request; never push to `main` or merge; roadmap decisions bind. `.claude/skills/council-of-elrond-development/references/conventions.md#r14`
- R15 Never weaken a test or a guard to get green. `.claude/skills/council-of-elrond-development/references/conventions.md#r15`

## Ask first

Edits prompt (path-gated in `.claude/settings.json`; the same paths head the safety-boundary block of `.github/CODEOWNERS`):

- Classifier and shipped rules: `/mods/council-of-elrond/hooks/rules/**` `/mods/council-of-elrond/hooks/config/defaults.ts`
- Trust and schema: `/mods/council-of-elrond/hooks/config/trust.ts` `/mods/council-of-elrond/hooks/config/schema.ts`
- Redaction: `/mods/council-of-elrond/hooks/redact.ts` `/mods/council-of-elrond/hooks/members/gollum.ts`
- Manifests: `/mods/council-of-elrond/.claude-plugin/plugin.json` `/.claude-plugin/marketplace.json`
- Automation: `/.github/**` `/.githooks/**` `/scripts/**`
- Policy and the guidance machinery: `/SECURITY.md` `/LICENSE` `/.claude/settings.json`

Stop and ask (behaviour-gated; a path rule would prompt too often):

- Any loosening: fewer calls ask or are refused, less is redacted, even as a side effect.
- The pass-through and the fail-closed catch in `hooks/register.ts`; one `tool.call` hook, never a `tool.check` hook.
- Session state shape and migration: `hooks/state.ts`, `types/index.d.ts`.
- The audit line format: `hooks/audit.ts`.
- The retry brake and the denial wordings: `hooks/elrond/operations.ts`.
- What reaches a model or starts a process: `hooks/members/shared.ts`, `hooks/members/brief.ts`, `hooks/members/galadriel.ts`, `hooks/elrond/escalation.ts`, `hooks/elrond/refusal.ts`, `hooks/elrond/suggest.ts`, `hooks/elrond/chat.ts`.
- A new `/council` command, option or configuration file: `hooks/elrond/commands.ts`.
- Binding decisions in the roadmap, and `mods/council-of-elrond/SPEC.md`.
- A version bump, a release heading in `CHANGELOG.md`, or a tag.
- A headless child run that makes model requests.
- Scheduled-routine or cloud-environment setup.
- Pushing to `main` or merging.
