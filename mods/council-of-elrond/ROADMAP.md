# council-of-elrond: roadmap (v2)

The plan from here to 1.0, written so a new dev session can pick up the next brief cold.

- **Where this came from:** the November review, [docs/REVIEW-2026-11.md](../../docs/REVIEW-2026-11.md)
  (findings R1 to P2, ideas 7.1 to 7.7). The maintainer accepted its roadmap, decisions and ideas on
  2026-11-13; they are recorded under "Decisions" below and are binding.
- **What was built before this:** Stages 0 to 6, the final deliverables, the hardening briefs H1 to
  H3 and the cloud items C1 to C6 are done. Their task lists and reasoning are kept in
  [docs/history/ROADMAP-v1.md](../../docs/history/ROADMAP-v1.md); nothing in that file is open work.
- **The spec and the design:** [SPEC.md](./SPEC.md) (§ numbers refer to it) and
  [DESIGN.md](./DESIGN.md). Where they differ, this file and DESIGN.md win over the spec.

## Status

| Milestone | Goal | Status |
| :- | :- | :- |
| M0 | Green on the pinned build, CI that cannot break by itself, the development process | Not started |
| M1 | First real release, 0.6.0, installable with one line | Not started |
| M2 | Measure the reviewers, the cost and the friction | Not started |
| M3 | Right-size the gate | Not started |
| M4 | Modular core: `register.ts` becomes wiring | Not started |
| M5 | Every host: headless, cloud, desktop, mobile, VS Code | Not started |
| M6 | Documents and theme | Not started |
| M7 | 1.0 | Not started |
| Later | After 1.0 | Backlog |

Each brief below has a checkbox. The pull request that finishes a brief ticks it and, when it is
the milestone's last, updates this table.

## How a dev session works

1. **Read** `CLAUDE.md`, then this file down to the first unticked brief. Read the review finding
   or idea the brief names; it holds the evidence and the reasoning.
2. **Check the ground.** `claude --version` against the version DESIGN.md's header names. If the
   session says the council-of-elrond plugin is active, stop: the mod must never be loaded into a
   session that develops it, and in such a session it also refuses edits to the workflow files.
   Tell the maintainer (maintainer action A1).
3. **One brief, one branch, one pull request.** Briefs inside a milestone run in the order given
   unless they are marked independent. Do not start the next milestone unasked.
4. **The loop** (CLAUDE.md, "Orchestration"): the orchestrator writes the brief; `implementer`
   runs it; the checks run; the orchestrator reads the diff and runs the gates itself.
5. **Tightening and loosening.** A brief marked **loosens** is already approved for exactly what
   it says. Anything beyond it that loosens goes to the maintainer before it is committed.
   Anything that tightens is decided, recorded in DESIGN.md and reported.
6. **At the end of a milestone:** the checkpoint summary (`/checkpoint`), then wait.

Commands, the hard-won API facts and the codebase conventions are in "Resuming: what to know
first" below. They were carried over unchanged; M0.4 re-probes the facts on the current build.

## Maintainer actions

Things only the maintainer can do. A session that needs one stops and asks.

| Id | Action | Needed by |
| :- | :- | :- |
| A1 | A cloud environment for this repository whose setup script does **not** install the mod (the review session ran with it loaded: finding I4) | M0, every later session |
| A2 | Create the `automation-failure` label; make the new CI jobs required checks on `main` | M0.7 |
| A3 | The shortened terminal check on the release build (the script M1.1 produces) | M1 |
| A4 | Push the release tag (`claude plugin tag mods/council-of-elrond --push`) | M1 |
| A5 | Approve the eval run's token spend, and run the cloud half of the shadow week | M2 |
| A6 | A square PNG icon, 512 to 2048 px (or approve a generated one) | M1.4 |
| A7 | Live checks on desktop, mobile and VS Code | M5.3 |

## Decisions (accepted 2026-11-13)

"I accept all your suggestions": the review's decisions 1 to 11 are settled as recommended. They
join the approved decisions further down, and win where the two differ.

| # | Decision | Settled as |
| :- | :- | :- |
| D1 | Order and freeze | M0 to M7 in this order. No feature work outside these briefs until M3 is done. |
| D2 | The default policy | Presets ship in M3: `observe`, `balanced`, `strict`. `strict` is today's behaviour. `balanced` (ordinary edits pass; sensitive files are reviewed per edit; the diff reviewer sits at `git commit`) becomes the default once M2's numbers are in and M3's regression table shows exactly the intended changes. **Loosens.** |
| D3 | The four loosening proposals | All approved, each as its own brief with its own tests: shell reads of protected paths match the file tools (F1); recursive delete under the system temp directory asks instead of blocking (F3); the production rule judges what runs a client, not text written to a file (F4); "nobody can be asked" is not a failed attempt (F5). **Loosens.** |
| D4 | The coverage list (review §2.5) | Every category is added in M3 as review or ask; none waits. Agent-control files become protected paths. Tightens. |
| D5 | Release | `main` is released as one 0.6.0 (the maintainer's decision of 2026-10-22) after a **shortened** terminal check: whatever a mounted-tree or headless test can cover moves into tests first (M1.1). |
| D6 | The refactor | Before 1.0, as M4. This replaces "after 1.0" in the v1 roadmap. |
| D7 | `tool.check` | One probe of an ask-only hook is allowed (M5.2). SPEC §7 and the CI step stay as they are until the probe's result is decided on. |
| D8 | Headless prompts | An `sdk` prompt sets the reviewers' "latest request" and resets rounds, failed attempts and lockouts, as a person's prompt does. It still cannot run the subcommands that loosen the gate, and still cannot give a chat approval. **Loosens** (the reset). |
| D9 | Theme reach | Text relayed through Claude where nothing draws may carry the member's themed name and one line of voice, in themed mode only. Reviewer prompts, refusal reasons and the audit log stay plain. This amends approved decision 1. |
| D10 | Vendored types | Kept in the repository. CI is pinned to the version DESIGN.md names; a scheduled job runs the latest build and reports. Upgrades run on a schedule (monthly, and before each release), not at every build. |
| D11 | The ideas (review §7) | All accepted, placed as in the milestones below. Four are accepted in the limited form the review recommended: the model-callable check (7.1 c) only after the briefing section has shipped and been measured, and off by default; the snapshot member (7.4 d) writes only under the mod's own folder, size-capped, and is opt-in; the triage model (7.3 d) is opt-in and built only if M2 shows cost is the problem; across sessions (7.6 b) only a never-offer list and a suggestion to add a rule are remembered, never an approval. |

**Still open** (not covered by the acceptance; each loosens, so each waits for the maintainer):

- Recognising a plugin's own `tool.check` denial wording, so it is not counted as a failed attempt
  (DESIGN §12.7).
- What follows the M5.2 probe: keep the chat approval route, replace it with the engine's dialog,
  or both.

Also settled by the same acceptance: the development process borrowed from another, private project of the maintainer
(M0.5 to M0.9). That project is proprietary; its **designs** are borrowed and every
script and document here is written fresh. Nothing is copied from it, and nothing about its domain
is named in this repository.

---

## The milestones

Every brief lists: what to do, the files, what must not change, how it is accepted, and the
finding or idea behind it (in docs/REVIEW-2026-11.md). Sizes: S is one implementer brief, M is two
to four, L is a planned sequence. "Gate" says which way the brief moves the gate.

### M0. Green, pinned, and a process that checks itself

Goal: the three gates pass on a pinned Claude Code, `main` cannot go red without a commit, and the
rules a reviewer has been checking by hand are checked by scripts. No behaviour change for users.

- [ ] **M0.1 Upgrade the types to the installed build** (S, neutral; R1, R2). Run `/upgrade-types`.
  The vendored types are 2.1.322's; the three failing tests come from 2.1.323. Record the drift in
  DESIGN.md as usual. Accepted when `tsc -p mods` passes against the new types.
- [ ] **M0.2 The band on the new contract** (S, neutral; R1). From 2.1.323 the band above the prompt
  stacks one row per plugin (`AbovePromptList`, `AbovePromptRow`) where a hook used to replace it.
  Read both components' docs in the types, then re-decide and test three cases: a row while a full
  council sits, no row when idle, and the survey case. Files: `hooks/register.ts` (the
  `AbovePrompt` hook), `hooks/elrond/view.ts`, `tests/debate.test.ts`, `tests/view.test.ts`,
  `tests/fixtures.ts`. Never weaken an assertion to get green: if the engine's row now always
  shows, the tests say so. Accepted when all tests pass on the pinned build and DESIGN §11 records
  the new behaviour.
- [ ] **M0.3 Pin Claude Code in CI** (S, neutral; R3, D10). Both workflows install
  `@anthropic-ai/claude-code@<the version DESIGN.md names>`; `/upgrade-types` gains a step that
  bumps the pin. Needs A1 (workflow files are protected paths where the mod is loaded).
- [ ] **M0.4 Re-probe the hard-won facts** (M, neutral; finding A1). The review found fact 1 no
  longer holds at validation time: a sibling module may take `$`, and so may a closure inside a
  hook. Confirm it at run time under the test kit and headless (`/live-check`), then walk the other
  thirteen facts and mark each "holds on <version>" or correct it. The last two type upgrades
  carried their probes over unrun because a cloud session could not start a child `claude -p`;
  say in `/upgrade-types` and `/live-check` where they can and cannot run. Accepted when every fact
  carries the version it was last probed on.
- [ ] **M0.5 A lean CLAUDE.md and one routing skill** (M, neutral; findings D2, D3 and
  P2). CLAUDE.md keeps the contract only: what the project is, the hard rules in short
  form with a pointer each, the ask-first list, and a budget (at most 90 lines and 8 KiB, checked
  by M0.6). Everything else moves, unchanged in meaning, into a skill,
  `.claude/skills/council-development/`:
  - `SKILL.md`: a routing table, one row per task, naming the one file that holds its detail.
  - `references/architecture.md` (the module map and layers), `references/conventions.md` (the
    hard rules in full, each under a stable anchor), `references/api-facts.md` (the hard-won facts,
    their single home from now on), `references/qa-and-ci.md` (every check, hook and workflow, and
    the verify list), `references/recipes.md` (orchestration, the brief format, grep-before-coding,
    the Implementation Decision format with a confidence label).
  - `references/workflows/`: one checklist per recurring task, each with Preconditions, Steps,
    Verification, Docs to update and Ask first. To write now: `adding-a-member.md`,
    `adding-a-shipped-rule.md`, `adding-a-secret-pattern.md`, `adding-a-subcommand.md`,
    `adding-a-config-option.md`, `changing-the-pipeline.md`, `policy-change.md` (tightening and
    loosening), `modularizing-a-module.md` (M4 follows it), `releasing.md`.
  The existing skills (`checkpoint`, `live-check`, `upgrade-types`) stay and are routed from the
  table. The ask-first list names what never changes without the maintainer: the block floor,
  the shipped protected paths, anything that loosens, the verdict format, the audit record's
  fields, the session state's shape, removing or renaming an option, and every decision in this
  file. Accepted when each fact, rule and procedure has exactly one home and CLAUDE.md is inside
  its budget.
- [ ] **M0.6 Checks for the guidance and the documents** (M, neutral; D1, D3). Node scripts with no
  dependencies under `scripts/`, each a pure function over explicit paths with its own tests
  (`node --test`):
  - `check-guidance.mjs`: every backticked repository path and `file.md#anchor` in CLAUDE.md, the
    skill and the agent files resolves; CLAUDE.md is inside its budget; `SKILL.md` has valid
    frontmatter and routes every reference and workflow file exactly once; a rule id has one
    home; a bare `§n` with no document named fails.
  - `check-facts.mjs` (with `--fix`): the Claude Code version, the mod version and the minimum
    version are each stated from one source of truth (the types file's header, `plugin.json`, a
    constant) and every document that states them agrees. Test counts and line counts come out of
    the prose altogether.
  - `check-docs-sync.mjs`: a change in a documented area also touches its document, or the commit
    carries `[skip-docs]` on a line of its own. Areas, most specific first: `hooks/strings.ts`,
    `plugin.json` `userConfig` and `hooks/elrond/commands.ts` need the user manual and
    `CHANGELOG.md`; the rest of `hooks/` needs DESIGN.md, the manual, the changelog or the skill;
    the workflow files need `qa-and-ci.md`; `.claude/agents/` needs `recipes.md`. Dependabot is
    exempt for workflow files only. Two modes: `--staged <message file>` for the hook,
    `--base <ref> --actor <login>` for CI. A git failure exits 2, never green.
  Accepted when the three scripts pass on the repository and each has a test that fails when its
  rule is broken.
- [ ] **M0.7 A conventions checker in place of the reader pre-check** (M, tightens the process; A2,
  A3, A5, D3). `scripts/check-conventions.mjs`, deterministic, replacing the trial row in CLAUDE.md:
  `$` appears only where the layer rule allows (today `hooks/register.ts`; M4 widens it to the
  effects layer); no prose string literal under `hooks/` outside `strings.ts` and a written
  exemption list (rule reasons in `config/defaults.ts`, validation messages); `atom(` only in the
  state owner and `update($, session, ...)` only with an updater from `state.ts`; imports follow
  the layer order; no exported name is unused; no function is longer than a stated cap, with the
  existing long ones listed as debt that may shrink but not grow. Accepted when it passes with the
  debt list and the pre-check row is removed from CLAUDE.md.
- [ ] **M0.8 Hooks by stage, CI by concern** (M, neutral; R3, P1). Needs A1 and A2.
  - Git hooks (`.githooks/`): pre-commit runs only the fast checks (hygiene, conventions,
    guidance, facts, `tsc`); commit-msg checks the summary and runs docs-sync; a new pre-push runs
    the tests and validation. Today pre-commit runs everything, about forty seconds.
  - Workflows: `ci-checks` (hygiene, the M0.6 and M0.7 scripts and their tests, `actionlint`);
    `ci-tests` (the pinned build: tests, typecheck, strict validation, the marketplace manifest,
    no `tool.check`); `ci-docs-sync` (pull requests, full history); `ci-canary` (weekly and on
    demand: the three gates on the **latest** Claude Code, never required); a reusable
    `notify-failure` that opens or comments on one `automation-failure` issue per failing
    workflow, called by the canary. Third-party actions are pinned by commit SHA with the version
    in a comment; every workflow has a concurrency group and a timeout.
  Accepted when a pull request shows the three required jobs and a forced canary failure opens
  exactly one issue.
- [ ] **M0.9 The pull request template and CONTRIBUTING** (S, neutral). The template gains: "Gate
  direction: tightens, loosens or neutral" with, for a loosening, the decision that approves it;
  "Docs updated" (which, or why none); the checks run; and, from M2, the policy line (M2.2).
  CONTRIBUTING and `docs/DEVELOPMENT.md` point to the skill instead of repeating it. Sweep every
  document for references to sections of the v1 roadmap ("Final deliverables", "Before 1.0",
  "Known follow-ups", the C and H items, "the stage table") and point them at this file or at
  docs/history/ROADMAP-v1.md: `docs/MAINTENANCE.md`, the October review's banner and the
  `checkpoint` skill are known to have them.

Done when: every gate, hook and workflow above passes on the pinned build, and a session can find
any rule from the routing table. Checkpoint, then wait.

### M1. The first release: 0.6.0

Goal: a tag, a GitHub release, and an install that is one line on a laptop and one block in the
cloud. Findings R4, R5, I1 to I3, I5, P1.

- [ ] **M1.1 Shorten the terminal check** (M, neutral; P1, D5). Go through the fifteen screens of
  the v1 check. Each one a mounted tree (`$.ui.mount`) or a headless stream can prove becomes a
  test. What is left becomes `docs/TERMINAL-CHECK.md`: numbered steps, the expected screen, ten
  minutes. Accepted when the script exists and each removed screen names the test that replaced it.
- [ ] **M1.2 The real minimum version** (S, tightens; R5). Run the gates on older builds to find
  the oldest that passes; state it once (M0.6's facts check carries it everywhere); at session
  start below it, say so in one line and keep enforcing.
- [ ] **M1.3 Install in one line** (S, neutral; I1, I3). Everywhere an install is described:
  `/plugin install council-of-elrond --marketplace Deluha/council-of-elrond` at the prompt,
  `claude plugin install council-of-elrond --marketplace Deluha/council-of-elrond` from a shell,
  the desktop route (the + button, Plugins, Add marketplace), and one cloud block for a setup
  script with a pinned tag and the options a host that cannot ask should start with. The release
  workflow's notes use the same lines.
- [ ] **M1.4 Listing details** (S, neutral; I2, I5, S3). The icon (A6); one author name; the
  one-sentence promise in `plugin.json`, the marketplace entry and both READMEs: a second opinion
  and an audit trail beside Claude Code's own permissions, not a sandbox.
- [ ] **M1.5 `/council doctor`** (M, neutral; idea 7.2 a). One subcommand that checks: the Claude
  Code version against the floor, `git` on the PATH, that a model answers, which surfaces are
  attached and so how the user will be asked, that the rules file parses, that each project
  check's program exists, and that the mod is not loaded into its own repository. Relayed through
  Claude where nothing draws. Pure checks in `hooks/elrond/doctor.ts`; strings in `strings.ts`;
  the manual and the changelog in the same brief.
- [ ] **M1.6 Release** (S; R4). Move `[Unreleased]` to `[0.6.0]`, bump `plugin.json`, fix the
  changelog's compare links to real tags. Then A3 and A4. Accepted when the release workflow has
  published 0.6.0 and a fresh machine installs it with one line.

Done when: the release exists and INSTALL's cloud block names its tag. Checkpoint, then wait.

### M2. Measure

Goal: numbers for reviewer quality, cost and friction, and targets written from them. M3 changes
policy and must not be done blind. Findings T1, T3.

- [ ] **M2.1 The eval suite** (M, neutral; T1). `mods/council-of-elrond/evals/` for
  `claude plugin eval`: labelled cases per reviewer (destructive and harmless commands,
  test-weakening and honest diffs, SQL with and without WHERE, pushes of unrelated commits,
  instructions hidden inside diffs and previews) and a council set. Out of CI; run by hand (A5);
  results and the commit they were run on recorded in DESIGN.md.
- [ ] **M2.2 The policy table and its diff check** (M, neutral; review §4.11 of the October review,
  the output-parity idea borrowed in M0). `tests/policy.table.ts`: several hundred rows of input,
  expected tier and expected rule, starting from the probe sets. `scripts/check-policy-diff.mjs`
  classifies the table on the base and the head of a pull request; every row whose tier changed
  must be declared in one line of the pull request's description
  (`policy: expect-different=<ids>`), and a row that got looser also needs the decision that
  approves it. This makes the tightening and loosening rule mechanical. Runs in `ci-tests`.
- [ ] **M2.3 A shadow week** (maintainer and S; A5). The released build in shadow mode in another
  repository, a terminal and a cloud session, a week of ordinary work; then `/council report`.
  Record: reviews per session, tokens, median and worst review time, what would have been
  refused, what was refused then allowed.
- [ ] **M2.4 Targets** (S). From M2.1 and M2.3, written into DESIGN.md: the acceptable rate of
  wrong refusals and wrong approvals per reviewer, tokens per session, and time added to an
  allowed call. A benchmark test for the allowed path's own time.
- [ ] **M2.5 Report export** (S, neutral; idea 7.5 d). `/council report --json` and a Markdown
  form, so M2.3's numbers can be kept and shared.

Done when: DESIGN.md holds the results and the targets. Checkpoint, then wait.

### M3. Right-size the gate

Goal: the defaults stop ordinary work less and stop risky work more. Every brief changes rows of
the policy table and declares them. Findings F1 to F5 and §2.5; decisions D2 to D4.

- [ ] **M3.1 Brief Claude at the start** (M, neutral; idea 7.1 a). A session-scoped section added
  through `prompt.compose`, built from the loaded rules: what is protected, that shell reads of
  those paths should use the file tools, what a push triggers, the project checks, how the user
  approves on this host. Plain, a few hundred tokens, switchable off. Measure refusals per session
  against M2.3 before and after.
- [ ] **M3.2 Reads and writes of protected paths** (M, **loosens**; F1, D3). For shell commands,
  a part that only reads a protected path (a fixed list of read-only programs, and git's
  read-only subcommands) classifies as the file tools do. Anything not on the list still asks.
  `.env` and key files are the exception: see M3.6.
- [ ] **M3.3 Temp directory and written text** (M, **loosens**; F3, F4, D3). A recursive delete
  under the system temp directory asks instead of blocking. The production DROP and TRUNCATE rule
  judges parts that run a database client and what is piped or redirected into one, not text
  being written to a file.
- [ ] **M3.4 Nobody to ask is not a failed attempt** (S, **loosens**; F5, D3).
- [ ] **M3.5 Presets** (L, **loosens** as a default; D2, ideas 7.1 b, 7.2 c, 7.3 c). One option,
  `preset`, with `observe`, `balanced` and `strict`; every existing option stays as an override.
  `balanced`: an ordinary edit inside the repository passes; edits to sensitive files (CI,
  dependency manifests and lockfiles, tests, migrations, agent-control files) are still reviewed;
  the diff reviewer sits at `git commit` on the staged diff; the full council sits for a push or
  merge to a protected branch, a single git reviewer for a feature-branch push, and the project
  checks run for both. `strict` is today's behaviour exactly, proven by the policy table. The
  default flips to `balanced` in this brief's last pull request, only with M2's numbers attached.
- [ ] **M3.6 Coverage** (M, tightens; §2.5, D4). Review or ask for: scheduled-job editors and
  session control; registry pushes, forced branch re-creation, copies that overwrite, opening a
  pull request; `make` and package-script targets whose recipe the mod can read and classify
  (else review); reading credentials (the environment, key files, and `.env` through any tool);
  the PowerShell tool (review, since it is not parsed); the missing MCP verbs; built-in tools
  that schedule or publish. Agent-control files (`CLAUDE.md`, `.claude/agents/`,
  `.claude/skills/`, hooks and MCP configuration) join the protected paths.
- [ ] **M3.7 A user-level rules file, a schema and rule packs** (M; ideas 7.2 d to f). A rules
  file under the user's Claude configuration folder, merged between the shipped set and the
  project's, never below the block floor. A JSON Schema for `rules.json`, generated from or
  tested against `config/schema.ts`. Named rule packs in the repository, switched on in
  `rules.json`, as the home for stack-specific coverage.
- [ ] **M3.8 `/council init`** (M, neutral; idea 7.2 b). Proposes a starter `rules.json` from the
  repository (its test, lint and typecheck scripts as project checks, the remote's default branch
  as protected, migration folders), shows it, and writes it only on a yes.
- [ ] **M3.9 One approval route, and a reset** (M, **loosens** for the reset; ideas 7.3 a, b, g).
  `/council allow <code>` and `/council deny <code>` in a terminal, the same codes as the chat
  route; every refusal a person may override carries its code. `/council reset` (a person's
  command) clears rounds, failed attempts and lockouts. `/council log` is relayed where nothing
  draws.
- [ ] **M3.10 Cheaper, better-informed reviews** (M, neutral; ideas 7.3 e, f). The fixed part of
  each reviewer prompt goes out as a cacheable block. Reviewers also get a per-member `review`
  text from `rules.json` and the current task list or accepted plan where one exists, fenced as
  untrusted. Re-run M2.1 afterwards: no verdict may get worse.

Done when: the policy table changed only where a brief declared it, and M2.1 and a second shadow
week meet M2.4's targets. Checkpoint, then wait. The feature freeze (D1) ends here.

### M4. Modular core

Goal: `register.ts` is wiring. Follow `references/workflows/modularizing-a-module.md` (M0.5):
moves are verbatim, no behaviour change rides along, and a difference found on the way is reported,
not patched. Findings A1 to A6; decision D6.

- [ ] **M4.1 The layer rule** (S). Depends on M0.4's result. If sibling modules may take `$`:
  an effects layer, `hooks/effects/`, is the only place besides `register.ts` that touches `$`;
  pure modules stay pure; the direction is rules, then members, then elrond, then effects, then
  register. Written in `conventions.md`, enforced by M0.7's checker. If M0.4 shows they may not,
  stop and re-plan M4 with the maintainer.
- [ ] **M4.2 Extract the effects** (L, one pull request each, in this order): rules loading and
  scopes; files and real paths; git inspections and previews; the model review and probe; the
  check runner and `convene`; the audit writer and its queue; dialogs, panes and the indicator;
  `/council` output. Each move keeps its tests green unchanged and gives the module state it
  uses one owner (A4).
- [ ] **M4.3 The decision pipeline as a reducer** (L). A pure function from session state,
  classification and what the effects returned to one step: pass, refuse, ask, review, convene,
  finish. `register.ts` executes steps. The sixteen mutable locals of the `tool.call` hook become
  one value. Before starting, re-run every mutation check recorded in DESIGN.md and add a
  step-by-step test of the reducer for each pipeline order SPEC §4 lists.
- [ ] **M4.4 Members as data** (M, neutral; idea 7.4 a). A member is a registry entry: name,
  triggers, checklist prompt, model slot, profile. The shipped members become entries; a project
  may define its own in `rules.json` (a reviewer only: it can never approve what a shipped rule
  blocks). "Adding a member" in the manual becomes configuration.
- [ ] **M4.5 Wording and the shell parser** (M; A2, A6). Every prose string into `strings.ts`, or
  onto the written exemption list. `scan` and `coreOf` in `rules/shell.ts` split along their
  phases, with the policy table proving nothing moved.

Done when: `register.ts` holds only `register`, its `on(...)` calls and step execution; the
conventions checker has no debt list; every test and mutation check passes. Checkpoint, then wait.

### M5. Every host

Goal: a row in a support matrix for each host, each backed by a test or a recorded live check.
Findings H1 to H3; decisions D7, D8.

- [ ] **M5.1 Headless and SDK sessions** (M, **loosens** for the reset; H1, D8). An `sdk` prompt
  sets the latest request and resets the per-prompt state. It still cannot loosen the gate by
  command or approve by chat.
- [ ] **M5.2 Probe an ask-only `tool.check`** (S, a probe only; H2, D7). From 2.1.308 a hook's ask
  is always a person's and the input says whether a host or a person answers. In a throwaway
  branch and a throwaway cloud environment: does the web client show the engine's own permission
  dialog for such an ask, and can anything but a person answer it? Record the result in DESIGN
  §14 and bring the decision (keep the chat route, replace it, or both) to the maintainer.
- [ ] **M5.3 Finish the host checks** (maintainer and S; A7). The pending cloud checks from v1
  (C6), and drawing on desktop, mobile and VS Code.
- [ ] **M5.4 Visibility on every surface** (M, neutral; ideas 7.5 a, b). One quiet line under a
  reviewed call's own row (`ui.render` on `ToolUse`; a card on mobile), and a notification
  (`$.ui.notify`) when a call is waiting for an answer.
- [ ] **M5.5 The support matrix and a CI recipe** (S; H3, idea 7.5 c). One table in the manual:
  host, what draws, how you are asked, what is tested. A documented `claude -p` setup for CI:
  enforcing, never asks, the report as an artifact. A clear statement for Windows.

Done when the matrix has no empty cell. Checkpoint, then wait.

### M6. Documents and theme

Goal: a newcomer finds what the system is and what is next in one place each; the theme reaches
every host. Findings D2 to D4, S1; decision D9.

- [ ] **M6.1 DESIGN as the system is** (L). DESIGN.md is split into a description of the current
  system (data flow, failure modes, concurrency, performance, hosts) and a numbered decision log
  in `docs/decisions/`, one entry per decision with its date and what it replaced. The version
  history at the top of DESIGN.md becomes a table.
- [ ] **M6.2 A quickstart** (S). The first screen of the manual: install, shadow mode, the first
  rule, the first report.
- [ ] **M6.3 The theme pass** (M, neutral; idea 7.7, D9). Themed preset names (Rivendell, the
  Fellowship, the Black Gate; Leeroy mode stays) over the plain keys; a raid log at the end of a
  session from the report; one line of voice per member and verdict; the theme in relayed text
  where nothing draws; achievements and totals kept across sessions (`$.store`, idea 7.6 a);
  optional sounds from the mod's own original recordings, off by default; a look at
  `$.theme.set`, new in 2.1.322, for a themed backdrop. All behind plain mode; the plain-mode
  tests extend to each.

### M7. 1.0

Done when all of these hold:

- Released tags, a pinned CI and a canary that has caught at least one drift.
- Eval results that meet M2.4's targets on the default models, re-run on the release build.
- The support matrix complete.
- `register.ts` as wiring only; the conventions checker with no debt list.
- A stated minimum version.
- No open **high** finding in docs/REVIEW-2026-11.md.
- A deprecation rule for shipped rules and options, since after 1.0 a default cannot change in a
  minor release.
- Before the tag: the policy table diffed against the previous release with every change
  declared, as M2.2 does for a pull request.

### Later (after 1.0)

Accepted ideas that wait, in rough order. Each needs its own Step 0 check against the types.

- **On-demand review** (7.4 b): `/council review` seats the diff reviewer on the working tree and
  runs the project checks.
- **Plan review** (7.4 c): one review of the plan when Claude leaves plan mode. Tightens.
- **A dependency reviewer** (7.4 e, "Boromir"): new packages and lockfile changes. Tightens.
- **A snapshot before destructive work** (7.4 d, "Samwise"), in D11's limited form.
- **A check Claude can call** (7.1 c), in D11's limited form.
- **A triage model** (7.3 d), in D11's limited form.
- **The never-offer list and rule suggestions across sessions** (7.6 b), in D11's limited form.
- **Telemetry for teams** (7.6 c) and **organisation policy** (7.6 d), when a team asks.

---

## Resuming: what to know first

### Commands

```
cd mods/council-of-elrond && claude plugin test .     # all tests (675 with H3)
tsc -p mods                                           # strict typecheck against mods/types/claude-code.d.ts
claude plugin validate mods/council-of-elrond         # copy its hooks:/calls: lines into DESIGN.md §2
```

- **Check the Claude Code version.** Run `claude --version`; this was built on **2.1.289** and checked on **2.1.291** from stage 5, **2.1.294** from stage 6, and **2.1.296**, **2.1.299**, **2.1.304**, **2.1.308** and **2.1.322** after it (types regenerated each time; the drift was additive, DESIGN.md header; 2.1.299's probes found two semantic changes, DESIGN §12.5; 2.1.304 removed the `re-entry` failure kind the mod never relied on, DESIGN §12.6; 2.1.308 dropped `decider` from `tool.check`, which the mod never used, DESIGN §12.7; 2.1.322's drift is additive, DESIGN header). If it changed, regenerate the types by loading the `plugin-authoring` skill (it writes `types/claude-code.d.ts` under the skill's folder and names the path; don't write a mod folder, which would ask to hot-reload it into your session), copy them over `mods/types/claude-code.d.ts`, rerun `tsc`, and note any API drift in DESIGN.md.
- **Keep the mod out of the session building it.** Don't load it into your own dev session (the skill's hot-reload folder, or `--plugin-dir` on the session you work in): it would gate your own tool calls.
- **Live checks run headless.** Use `claude -p --plugin-dir ./mods/council-of-elrond "<prompt>"` with harmless commands, ideally in a throwaway `git init` folder, then clean it up along with the generated `.claude-plugin/types/` and `tsconfig.json` in the mod folder. `/council` output only shows with `--output-format stream-json --verbose` (as `system/ui_log`).

### Hard-won API facts (verified by probes; details in DESIGN.md)

1. **Only `hooks/register.ts` may touch `$`.**
   - Passing `$` to an imported function fails validation.
   - `$`-taking helpers must be **top-level functions in register.ts**, not closures inside a hook.
   - All decisions live in pure sibling modules.
2. **A hook that overruns its 10 s own-time budget is cut off from 2.1.299** (DESIGN §12.5): its `.catch` is asked with `kind` `timeout` and `called` false, and a later `next(e)` is refused. The test kit does not cut a hook off, so the guard below stays.
   - Every pass-through goes through `proceed()` in register.ts, which refuses when `next.budget.remainingMs < 1000`.
   - Keep the hook's own (non-`$`) work small and bounded.
   - A hook that blocks the hooks worker for 5 s without yielding has the worker replaced and its `.catch` asked (`kind` `throw`): keep a `.catch` on the gating hook.
3. **`$` calls don't count against the budget; `$.clock.sleep/after/every` do.**
   - Bound model calls with `timeoutMs` and processes with `timeoutMs`.
   - Build a shared deadline by passing *remaining* time into each call's `timeoutMs`, never with a clock timer.
4. **In `.catch`:** if `next.called`, then `next(e)` replays the real result without re-running the call. Otherwise refuse.
5. **`$.ui.ask` is an `AskUserQuestion` tool call** that skips the calling hook but **not the plugin's other `tool.call` hooks**.
   - Keep exactly one `tool.call` hook.
   - It rejects on dismiss, on "Chat about this", and in `-p`. In `-p` on 2.1.299 the rejection says the session has no `AskUserQuestion` tool. Dismiss and "Chat about this" reject with the same text (the call's result, cut to 120 characters), so the mod cannot tell them apart (DESIGN §12.4).
   - Guard it with `$.session.surfaces()` (empty means nobody can be asked: refuse).
   - In a cloud session in Auto mode, the host answered it with the first option and the person saw nothing (DESIGN §14.1): an answer is not proof that a person chose it. Never ask where `$.session.surfaces()` is empty.
   - The engine's own alternative is a `tool.check` hook's ask (`decider: 'person'` on 2.1.304; from 2.1.308 every hook's ask is a person's and `decider` is gone, DESIGN §14.2). On 2.1.304 no classifier, PermissionRequest hook, allow rule or `bypassPermissions` settled it (2.1.308's types name a PermissionRequest hook among what may answer it, not yet probed), and in `-p` it is a deny. But a host program's allow does settle it: in a hosted session, the host is told only to suppress an "always allow" rule (DESIGN §14.2).
6. **Command output reaches Claude.** A command's `{ text }` is read by Claude (approved decision 1: don't put council internals there). *(Amended by C2: where nothing draws, a person's `/council` status, report, rules and test also go to Claude as the result's `context`, redacted and fenced; DESIGN §13.5.)*
7. **`$.state` needs a contract.**
   - Every key must be declared in `types/index.d.ts` (`PluginState`).
   - Refs must be literals.
   - Writes are refused while drawing.
   - It survives reloads; `/clear`, `/resume` and `/branch` reset it.
8. **`userConfig` is flat:** string, number or boolean, `options` for a picker, `multiple` for string lists. Lists and structures go in `rules.json`.
9. **Tests:**
   - Stub every `$` noun the code touches with the test's `on(...)`; an unstubbed bottom throws.
   - The fixtures in `tests/fixtures.ts` already answer files, model, user, surfaces, logs and the tool itself.
   - `$.tool.call` input types drop `agentId`, but it arrives at runtime (cast `as never`). From 2.1.308 the test kit's `$.tool.call` takes `agentId`; the existing casts still compile.
   - Registering the same event twice in one test fails the load; use fixture switches instead.
10. **`--plugin-dir` writes generated files into the mod folder.** It writes `.claude-plugin/types/` and `tsconfig.json`, both gitignored.
11. **Drawing from register.ts without JSX:** call the global `h(Element, props, ...children)` with elements from `$.ui.resolve(e)` and cast the result to `RenderElement`; the file stays `.ts`.
12. **Test kit specifics (stage 2):** a `tool.call` bottom answer must carry `result` (an error is `{ result, isError: true, text }`); `$.session.start` needs `{ cwd, surface, isInteractive }` and a bottom hook returning `{ cwd }`; a `ui.render` hook that calls `next(e)` (SessionMode) needs a bottom `ui.render` hook in the test; `$.command.run` resolves `{ text: undefined, ref: undefined }` for a hook's `{}`.
13. **Claude Code's own denial wording.** Automatic (verified in `-p`): "`rm in '<path>' needs approval. … Claude Code asks before a shell command creates, changes or removes files there.`" The person refusing at the prompt (from the binary): "The user doesn't want to proceed with this tool use. …", optionally ending "To tell you how to proceed, the user said: …", or "The user doesn't want to take this action right now. …". All come back from `next(e)` as `isError: true`.
14. **`$.process.spawn` has no timeout** (stage 4, probed live in 2.1.289). End the loop with `stream.return()` from a `$.clock.after` timer.
    - Doing so kills the child, with no orphan.
    - A pending `after` cost the hook about 3 ms of budget while a spawn pull was in flight for 12 s: it does not burn the budget the way an awaited `$.clock.sleep` does.
    - After `return()`, `stream.result` settles `undefined`, so track "ended by us" in a flag.
    - In the test kit, a `process.spawn` bottom hook is an async generator returning `{ value: { code, signal } }` (or `{ deny }` for "can't start"). A generator stuck in an `await` never sees the consumer's `return()`, so a hanging stub must keep yielding.
    - `mock.clock(on)` answers `clock.now/after/sleep`; the fixtures take `isClockMocked: true` (and `w.modelDelays`) instead of their default real-time `clock.now`.

### Conventions in this codebase

- **Imports:** pure modules import siblings with `.js` suffixes (`./schema.js`); types come from `claude-code`.
- **No text in logic:** every user-facing string lives in `hooks/strings.ts` (plain now, themed in stage 6).
- **One state value:** session state is the single `$.state` value `council-of-elrond.session` (`CouncilSession` in `types/index.d.ts`), changed only through pure functions in `hooks/state.ts`. `resetForPrompt` is the one per-prompt reset; extend it rather than adding resets elsewhere.
- **Refusals:** every refusal is built by `refusalText` (`hooks/elrond/refusal.ts`), and every escalation by `questionText` (`hooks/elrond/escalation.ts`).
- **Audit:** each gated call writes exactly one audit line, via `finish()` in register.ts.
- **Comments:** short, saying why, never what.

---

## Approved decisions (after the spec)

From the Step 0 review and the model discussion. These are binding unless the user changes them.

1. **Command output stays out of Claude's context.** *(Amended by C2, approved 2026-10-13, a scoped exception: where `$.session.surfaces()` is empty, `/council` status, report, rules and test, typed by a person, also return their lines as `context` for Claude to relay, redacted and fenced; every other case is as below. DESIGN §13.5.)* `/council` subcommands draw in the pane where a surface draws, else `$.ui.log` (dim, not sent to the model). The `command.run` hook returns no Claude-readable text. This includes `/council off|on|shadow`. Verify where `ui.log` lines go in a plain `claude -p "/council report"` run.
2. **Models.**
   - No Haiku in any default; the latest Sonnet is the floor.
   - Built-in defaults: Gandalf `sonnet`, Legolas `sonnet`, Aragorn `opus`, full council `opus` (`BUILT_IN_MODELS` in `hooks/config/defaults.ts`).
   - Fable is selectable.
   - Layers, highest first: session switch (`/council model`) → `/config` row (picker: `default` / `sonnet` / `opus` / `fable` / `haiku`; `default` = unset) → project `rules.json` `models` (full IDs allowed) → built-in. Your `/config` choice beats the project file.
   - Token cap, effort and deadline follow the model family (`profileOf` in `hooks/elrond/models.ts`).
   - `/council model <member> <model>` switches for the session. `--save` writes the `/config` row via `$.config.set`, falling back to session-only with a message when the value isn't a picker option or the row is locked.
   - On a `/council model` change, send a one-token probe call to confirm the model works.
3. **Deadlines.**
   - Single member: from the model (Sonnet 30 s, Opus 45 s, Fable 90 s). Galadriel: 5 s per inspection command, up to 3 commands.
   - Full council: one shared model deadline.
   - **Gimli runs outside that deadline**, on its own per-command timeouts (default 120 s, max 600 s). It starts first and runs alongside the models via `$.process.spawn`, so Esc can kill it.
   - Overall council wait: the longer of the model deadline and Gimli's longest timeout.
4. **Unanswered escalations.**
   - Dismissing the dialog is "keep blocked" and **counts as a wipe**.
   - "Talk first" (themed "Parley: talk first"), the dialog's own fourth option, refuses, telling Claude to stop and ask, and is **not a wipe**. Claude Code's "Chat about this" counts as a dismissal. *(Amended 2026-10-13, approved by the user: this used to say "Chat about this", which the mod cannot tell from a dismissal, DESIGN §12.4.)*
   - Nobody to ask: refuse, and it counts as a wipe (a block).
   - Typed text is an instruction and resets the operation's rounds; labels compare exactly.
5. **Audit log** at `.claude/council-of-elrond/audit/audit.jsonl`, with a self-written `.gitignore` (`*`), 1 MiB × 3 files. *(Done.)*
6. **Shadow mode ships off** (enforcing). The README's first-days section recommends turning it on. While the audit log is empty, a one-time toast in the first session suggests it. An indicator by the prompt shows it whenever it's on.
7. **Unmatched MCP tools are allowed**, plus a shipped review rule for tool names containing mutating verbs (`mcp-mutating`). *(Done.)*
8. **Build in the repo** (`./mods/council-of-elrond`). Verify with tests, `tsc` and validate; the user runs live UI checks in a terminal with `--plugin-dir`.
9. **Config reload.** Load at session start, after the mod's own writes to `rules.json` (confirmed rules, allowlist entries), and on a new `/council reload`. Never by watching the file.
10. **Possible second prompt on the ask tier.** "Allow once" calls `next(e)`, and Claude Code may still ask. Accept it, and label the permission dialog with `$.ui.notice(e.tool_use_id, "Council: you allowed this once")`. *(Done.)*
11. **Operation keys (stage 2):** tool family + verb + normalised target set.
    - Paths are resolved to real paths under the root, flags dropped, targets sorted.
    - Push uses remote + branch; SQL uses the target database.
    - So `rm -rf ./build` and `rm -r build/` share a key.
    - A coarser per-verb counter (e.g. `git push`, any target) locks out at 5 wipes, to catch retries that change the target.

Stage 2's own decisions (the ones the spec didn't cover) are in [DESIGN.md §6](./DESIGN.md), Stage 3's in [§7](./DESIGN.md), Stage 4's in [§8](./DESIGN.md), Stage 5's in [§9](./DESIGN.md).

12. **Refusals at Claude Code's own permission prompt** (answered in stage 2). The person's own refusal there, after the council let the call through, counts as a failed attempt (as "keep blocked"); an automatic denial with nobody asked (`-p`, a deny rule) does not. Recorded as `outcome: "refused-by-user"` and `"denied-by-permission"` (`outcomeOf` in `elrond/operations.ts`). *(Done.)*

