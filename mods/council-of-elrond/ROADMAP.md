# council-of-elrond: roadmap (v2)

The plan from here to 1.0, written so a new dev session can pick up the next brief cold.

- **Where this came from:** the November review, [docs/REVIEW-2026-11.md](../../docs/REVIEW-2026-11.md)
  (findings R1 to P2, ideas 7.1 to 7.7), and an independent review of it,
  [docs/REVIEW-2026-11-INDEPENDENT.md](../../docs/REVIEW-2026-11-INDEPENDENT.md). The maintainer
  accepted both on 2026-11-13; they are recorded under "Decisions" and "Amendments after the
  independent review" below and are binding.
- **What was built before this:** Stages 0 to 6, the final deliverables, the v1 hardening briefs H1
  to H3 and the v1 cloud items C1 to C5 are done, and so is C6's code. C6's cloud check and C4's
  cloud run are pending (M5). The task lists and reasoning are kept in
  [docs/history/ROADMAP-v1.md](../../docs/history/ROADMAP-v1.md); the decisions in that file that
  stay binding are listed under "Carried over from v1" below, and its open items are placed in the
  milestones and in "Later".
- **The spec and the design:** [SPEC.md](./SPEC.md) (§ numbers refer to it) and
  [DESIGN.md](./DESIGN.md). Where they differ, this file and DESIGN.md win over the spec.
- **Ids:** a finding of the November review is always written with the word: "finding A2",
  "finding D3", "finding H1". "Decision D3" is a decision in the table below. "Approved decision 4"
  is one in "Approved decisions (after the spec)". "MA1" to "MA7" are maintainer actions and "AM1" to
  "AM9" the amendments. "v1 brief H1" is a brief in the v1 roadmap. "(was M3.6)" on a brief says
  where it stood in the first v2 numbering.

## Status

| Milestone | Goal | Status |
| :- | :- | :- |
| M0 | Green and current: the pinned build, the types, a scripted probe suite, the canary | In progress |
| M1 | Tightenings and the first release, 0.6.0, installable with one line | Not started |
| M2 | Measure the reviewers and write down the policy | Not started |
| M3 | Mechanical refactor: `register.ts` loses its effects | Not started |
| M4 | Right-size the gate | Not started |
| M5 | Hosts: headless, cloud, an honest support matrix | Not started |
| M6 | Documents | Not started |
| M7 | 1.0 | Not started |
| Later | After 1.0 | Backlog |

Each brief below has a checkbox. The pull request that finishes a brief ticks it and, when it is
the milestone's last, updates this table.

**Done outside the original briefs:** the hardening pull request that followed the independent
review: the call fingerprint, the classifier's shell forms, self-protection of the mod's own
plugin, the input the reviewers and the dialog see, and redaction. Every change in it tightens;
the decisions are in DESIGN.md §15. Findings and classes:
[docs/REVIEW-2026-11-INDEPENDENT.md](../../docs/REVIEW-2026-11-INDEPENDENT.md).

## How a dev session works

1. **Read** `CLAUDE.md`, then this file down to the first unticked brief. Read the review finding
   or idea the brief names; it holds the evidence and the reasoning.
2. **Check the ground.** `claude --version` against the version DESIGN.md's header names: a newer
   installed build is expected and is not a reason to upgrade mid-brief ("Resuming" below). Then
   check the mod is not loaded into this session: `/council` must not respond, and
   `claude plugin list` must not list `council-of-elrond`. If either does, stop: the mod must never
   be loaded into a session that develops it, and in such a session it also refuses edits to the
   workflow files. Tell the maintainer (maintainer action MA1).
3. **One brief, one branch, one pull request.** Briefs inside a milestone run in the order given
   unless they are marked independent. Do not start the next milestone unasked.
4. **The loop** (CLAUDE.md, "Orchestration"): the orchestrator writes the brief; `implementer`
   runs it; `reader` pre-checks the diff for what no CI check catches; the checks run; the
   orchestrator reads the diff and runs the gates itself.
5. **Tightening and loosening.** A brief marked **loosens** is already approved for exactly what
   it says. Anything beyond it that loosens goes to the maintainer before it is committed.
   Anything that tightens is decided, recorded in DESIGN.md and reported.
6. **At the end of a milestone:** the checkpoint summary (`/checkpoint`), then wait.

Commands, the hard-won API facts and the codebase conventions are in "Resuming: what to know
first" below. They were carried over from v1; M0.4 turns the re-probe of the facts into a script.

## Maintainer actions

Things only the maintainer can do. A session that needs one stops and asks.

| Id | Action | Needed by |
| :- | :- | :- |
| MA1 | A cloud environment for this repository whose setup script does **not** install the mod (the review session ran with it loaded: finding I4) | M0, every later session |
| MA2 | Create the `automation-failure` label (making the CI jobs required checks on `main` waits for the workflow split, Later M0.8) | M0.5 |
| MA3 | The shortened terminal check on the release build (the script M1.4 produces) | M1 |
| MA4 | Push the release tag (`claude plugin tag mods/council-of-elrond --push`) | M1 |
| MA5 | Approve the eval run's token spend, and run the cloud half of the shadow week | M2 |
| MA6 | A square PNG icon, 512 to 2048 px (or approve a generated one) | Later (M1.4's remainder) |
| MA7 | Live checks on desktop, mobile and VS Code | M5.2 (a matrix cell may say "untested") |

## Decisions (accepted 2026-11-13)

"I accept all your suggestions": the review's decisions 1 to 11 are settled as recommended. They
join the approved decisions further down, and win where the two differ. The amendments in the next
section win over this table where they differ.

| # | Decision | Settled as |
| :- | :- | :- |
| D1 | Order and freeze | M0 to M7 in the order of AM9. No feature work outside these briefs until M3 is done; AM1 extends the freeze to 1.0. |
| D2 | The default policy | Presets `observe`, `balanced`, `strict`, shipped in M4. `strict` is today's behaviour. AM2 amends the rest: `balanced` is opt-in, and the default changes only on the pre-registered thresholds and a separate decision. |
| D3 | The four loosening proposals | Approved, each as its own brief with its own tests: shell reads of protected paths match the file tools (finding F1); recursive delete under the system temp directory asks instead of blocking (finding F3); the production rule judges what runs a client, not text written to a file (finding F4); "nobody can be asked" is not a failed attempt (finding F5). **Loosens.** AM4 suspends the finding F5 part; AM5 confirms the other three. |
| D4 | The coverage list (review §2.5) | Every category is added as review or ask. Agent-control files become protected paths. Tightens. AM7 moves the unambiguous categories into M1, and `make` and `npm run` wait for M2's data. |
| D5 | Release | `main` is released as one 0.6.0 (the maintainer's decision of 2026-10-22) after a **shortened** terminal check: whatever a mounted-tree or headless test can cover moves into tests first (M1.4). |
| D6 | The refactor | Before 1.0, as M3, moves only. This replaces "after 1.0" in the v1 roadmap. The reducer (was M4.3) is Later. |
| D7 | `tool.check` | One probe of an ask-only hook is allowed (was M5.2, now Later). SPEC §7 and the CI step stay as they are until the probe's result is decided on. |
| D8 | Headless prompts | An `sdk` prompt sets the reviewers' "latest request" (M5.1). It still cannot run the subcommands that loosen the gate, and still cannot give a chat approval. The reset of rounds, failed attempts and lockouts is suspended by AM4. |
| D9 | Theme reach | Text relayed through Claude where nothing draws may carry the member's themed name and one line of voice, in themed mode only. Reviewer prompts, refusal reasons and the audit log stay plain. This amends approved decision 1. The theme pass itself (was M6.3) is Later. |
| D10 | Vendored types | Kept in the repository. CI is pinned to the version DESIGN.md names; a scheduled job runs the latest build and reports. Upgrades run on a schedule (monthly, and before each release), not at every build. |
| D11 | The ideas (review §7) | All accepted; those not in a milestone below are in Later. Four are accepted in the limited form the review recommended: the model-callable check (7.1 c) only after the briefing section has shipped and been measured, and off by default; the snapshot member (7.4 d) writes only under the mod's own folder, size-capped, and is opt-in; the triage model (7.3 d) is opt-in and built only if M2 shows cost is the problem; across sessions (7.6 b) only a never-offer list and a suggestion to add a rule are remembered, never an approval. |

On the same day the maintainer also accepted the additions made after the review (its §8) and the
recommendation on the item that was still open:

| # | Decision | Settled as |
| :- | :- | :- |
| D12 | Another plugin's `tool.check` denial | Recognised as an automatic denial, like a deny rule: nobody was asked and the tool did not fail, so it is not a failed attempt (approved decision 12 already treats automatic denials this way). Brief: M4.6 (was M3.4). **Loosens.** AM4 suspends it until the lockout is decided as a whole. |
| D13 | The additions in the review's §8 | The re-probe of the API facts (M0.4, now a script), the new API to look at (M0.2; the rest is Later), the cleanups (M3.2), and the borrowed process, which AM9 moves to Later except the canary (M0.5). |

**Still open**, because it cannot be decided before its evidence exists:

- What follows the probe of an ask-only `tool.check` (Later): keep the chat approval route, replace
  it with the engine's dialog, or both. The probe's brief ends by bringing this to the maintainer.

Also settled by the same acceptance: the development process borrowed from another, private project
of the maintainer. That project is proprietary; its **designs** are borrowed and every script and
document here is written fresh. Nothing is copied from it, and nothing about its domain is named in
this repository. AM9 moves most of it to Later.

## Amendments after the independent review (accepted 2026-11-13)

The maintainer accepted the recommendations of the independent review
([docs/REVIEW-2026-11-INDEPENDENT.md](../../docs/REVIEW-2026-11-INDEPENDENT.md)); these amendments
win over the decisions table above where they differ.

| # | Amendment | Settled as |
| :- | :- | :- |
| AM1 | Freeze (amends D1) | Until 1.0 the freeze means no new command, option or configuration file beyond the briefs kept below. Briefs moved to "Later" are not exceptions. |
| AM2 | The default policy (amends D2) | The presets ship in M4 (was M3) with `strict` as the default. `balanced` is opt-in. The default changes only if the pre-registered thresholds (AM3) are met, and then by a separate maintainer decision; it is not automatic. |
| AM3 | Thresholds, written before M2 runs | (a) Wrong-approve rate: on cases labelled must-not-approve, each reviewer approves at most 2%, measured on at least 100 such cases per reviewer, each case run three times and counted as approved if any run approves. (b) The rules tier lets through none of the bypass-regression corpus. (c) The policy table changes only where a brief declared it. (d) `balanced` may become the default only if (a) to (c) hold and the shadow data shows that at least half of the reviews `strict` held on ordinary edits were of changes later committed, so that the commit-time review would have seen them. The numbers are the maintainer's to change, but only before M2's data is read. M2.4 no longer writes targets after the data; it reports against these. |
| AM4 | The lockout (suspends the finding F5 part of D3, D8's reset, D12, and the M3.9 reset command) | These four changes to the retry brake are decided together in one brief (M4.6, rewritten), which first states what the lockout is for in each host (a person present; headless; cloud) and then brings one proposal to the maintainer. Until that is decided, approved decision 4 ("Nobody to ask: refuse, and it counts as a wipe") and DESIGN §14.3 stand as written. The parts of D8 that do not touch the brake (an `sdk` prompt sets the reviewers' "latest request") stay approved. |
| AM5 | Findings F1, F3, F4 (confirms D3 in part) | Approved as before, each its own brief with its own tests, after the coverage tightenings. |
| AM6 | Unlabelled gate changes | M3.1 (the briefing section, now Later) puts the protected list into the gated model's prompt against approved decision 1 and needs the maintainer's sign-off at its brief; M3.10's added reviewer context (Later) likewise (SPEC §12 says no transcript). M3.7 (user-level rules file, rule packs) and M4.4 (project-defined reviewers, a fourth model member) move to "Later"; SPEC §3's cap of three model members stands. A later reviewer must not be named "Boromir", which already names the proposer. |
| AM7 | Tightenings first | Review §2.5's unambiguous categories (an unparsed tool is reviewed, agent-control files are protected paths, credential reads) move ahead of the release, as a brief in M1 (M1.1). `make` and `npm run` wait for M2's data. |
| AM8 | Additions to 1.0 | A one-page threat model (who is defended against: a mistaken agent, a prompt-injected agent, a hostile repository; and what is out of scope): M1.2. A scripted headless probe suite run by the canary (a block rule refuses, a hook timeout fails closed, the denial wordings are still in the binary): M0.4 and M0.5, plus a one-line session-start notice when the host is newer than the last tested build: M0.6. A compatibility policy (the tested range and what happens outside it): M1.7. The policy table doubling as a bypass-regression corpus: M2.1. A trust rule for a repository-supplied rules file: M1.3. |
| AM9 | Order | The milestones are re-ordered as below. |

---

## The milestones

Every brief lists: what to do, the files, what must not change, how it is accepted, and the
finding or idea behind it (in docs/REVIEW-2026-11.md). Sizes: S is one implementer brief, M is two
to four, L is a planned sequence. "Gate" says which way the brief moves the gate.

### M0. Green and current

Goal: the three gates pass on a pinned Claude Code, `main` cannot go red without a commit, and the
facts about the host are checked by a script, not by hand. No behaviour change for users except
one session-start line (M0.6).

- [ ] **M0.1 Upgrade the types to the installed build, and move the CI pin with them** (S,
  neutral; finding R1, finding R2, decision D10). Run `/upgrade-types`. The vendored types are
  2.1.322's; the three failing tests come from 2.1.323. Files: `mods/types/claude-code.d.ts`, the
  version line and drift note at the top of `mods/council-of-elrond/DESIGN.md`,
  `.github/workflows/ci.yml` and `.github/workflows/release.yml` (the pin in both moves to the same
  version as the types), and `CHANGELOG.md`. Needs MA1 (workflow files are protected paths where
  the mod is loaded). **M0.1 and M0.2 land in one pull request:** on the newer build the three
  gates cannot pass between them. Accepted when `tsc -p mods` passes against the new types and both
  workflows pin the version the types are from.
- [ ] **M0.2 The band on the new contract** (S, neutral; finding R1). From 2.1.323 the band above
  the prompt stacks one row per plugin (`AbovePromptList`, `AbovePromptRow`) where a hook used to
  replace it. Read both components' docs in the types, then re-decide and test three cases: a row
  while a full council sits, no row when idle, and the survey case; honour `isCollapsed`, new on
  the band's props in 2.1.322. Files: `hooks/register.ts` (the `AbovePrompt` hook),
  `hooks/elrond/view.ts`, `tests/debate.test.ts`, `tests/view.test.ts`, `tests/fixtures.ts`. Never
  weaken an assertion to get green: if the engine's row now always shows, the tests say so.
  Accepted when all tests pass on the newly pinned build and DESIGN §11 records the new behaviour.
- [ ] **M0.3 Pin Claude Code in CI** (S, neutral; finding R3, decision D10), partly done.
  - [x] Both workflows install `@anthropic-ai/claude-code@<the version DESIGN.md names>`.
  - [ ] **Open remainder:** the two `/upgrade-types` skill steps. The skill gains a step that moves
    the pin, and one that re-checks whether `$.fs` has gained an append (the audit writer rewrites
    the whole file for each line until it does: finding A7). File:
    `.claude/skills/upgrade-types/SKILL.md`.
- [ ] **M0.4 A scripted probe suite** (M, neutral; finding A1; AM8). Replaces the one-off re-probe
  of the hard-won facts. The review (finding A1) found fact 1 no longer holds at validation time: a sibling
  module may take `$`, and so may a closure inside a hook. A script under `scripts/` runs one
  headless `claude -p` per behaviour, in a throwaway repository, and prints pass or fail for each:
  fact 1 first (at run time under the test kit and headless), then a block rule refuses, a hook
  that overruns its time is cut off and the call refused (it fails closed), and the denial wordings
  of "Resuming" fact 13 are still in the binary; then the other facts a run can show. Every fact
  carries the version it was last probed on ("holds on <version>" or corrected). A cloud session
  **can** start a headless child run (verified 2026-11-13); the last two type upgrades carried
  their probes over unrun because that was assumed not to work. Say in `/upgrade-types` and
  `/live-check` where the suite can and cannot run, and have `/upgrade-types` run it. Accepted
  when it runs from one command and every fact carries its version.
- [ ] **M0.5 The canary** (M, neutral; finding R3, finding P1; was M0.8, the canary only). Needs MA1
  and MA2. A workflow `ci-canary`: weekly and on demand, it runs the three gates and the M0.4
  probe suite on the **latest** Claude Code, and is never required. A reusable `notify-failure`
  workflow opens or comments on one `automation-failure` issue per failing workflow. Third-party
  actions in the new workflows are pinned by commit SHA with the version in a comment, and each has
  a concurrency group and a timeout. Accepted when a forced failure opens exactly one issue and the
  existing required jobs are unchanged.
- [ ] **M0.6 A notice when the host is newer than the last tested build** (S, neutral; AM8). At
  session start, when `claude --version` is newer than the version DESIGN.md's header names, one
  line says so, and enforcement continues unchanged. Where nothing draws it goes through the start
  notice (DESIGN §13.5). Strings in `strings.ts`; the manual and the changelog in the same brief.
  Accepted when a test shows the line for a newer host and no line for the tested one.

Done when: the three gates and `scripts/check-hygiene.sh` pass on the pinned build with M0.1 and
M0.2 merged; the probe suite passes headless; the canary has run once on the latest build; and a
session on a host newer than the tested build shows the notice. Checkpoint, then wait.

### M1. Tightenings and the first release: 0.6.0

Goal: the unambiguous tightenings, a threat model and a trust rule, then a tag, a GitHub release
and an install that is one line on a laptop and one block in the cloud. Findings R4, R5, I1 to I3,
I5, P1, S3.

- [ ] **M1.1 The tightenings that wait for nothing** (M, **tightens**; review §2.5, AM7; was part
  of M3.6). One brief; each category has tests that fail without it: a tool the mod does not
  parse is reviewed (the PowerShell tool is the known one); agent-control files (`CLAUDE.md`,
  `.claude/agents/`, `.claude/skills/`, hooks and MCP configuration) join the protected paths;
  reading credentials (the environment, key files, and `.env` through any tool) is reviewed or
  asked. The rest of the coverage list is M4.1; `make` and package-script targets wait for M2's
  data.
- [ ] **M1.2 A one-page threat model** (S, neutral; AM8). Who the mod defends against: a mistaken
  agent, a prompt-injected agent, a hostile repository; and what is out of scope. New file
  `docs/THREAT-MODEL.md`, linked from the manual and from `SECURITY.md`. Classes only, no
  reproduction steps.
- [x] **M1.3 A trust rule for a repository-supplied rules file** (S, tightens; AM8). Decided and built in the hardening pull request (DESIGN §15).
- [ ] **M1.4 Shorten the terminal check** (M, neutral; finding P1, decision D5; was M1.1). Go
  through the fifteen screens of the v1 check. Each one a mounted tree (`$.ui.mount`) or a headless
  stream can prove becomes a test. What is left becomes `docs/TERMINAL-CHECK.md`: numbered steps,
  the expected screen, ten minutes. Accepted when the script exists and each removed screen names
  the test that replaced it.
- [ ] **M1.5 Install in one line** (S, neutral; finding I1, finding I3; was M1.3). Everywhere an
  install is described: `/plugin install council-of-elrond --marketplace Deluha/council-of-elrond`
  at the prompt, `claude plugin install council-of-elrond --marketplace Deluha/council-of-elrond`
  from a shell, the desktop route (the + button, Plugins, Add marketplace), and one cloud block for
  a setup script with a pinned tag and the options a host that cannot ask should start with. The
  release workflow's notes use the same lines.
- [ ] **M1.6 The promise sentence** (S, neutral; finding I2, finding I5, finding S3; was M1.4, the
  promise only). The one-sentence promise in `plugin.json`, the marketplace entry and both
  READMEs: a second opinion and an audit trail beside Claude Code's own permissions, not a sandbox.
  The icon (MA6) and the single author name stay in Later.
- [ ] **M1.7 The compatibility floor and policy** (S, neutral; finding R5, AM8; replaces was M1.2).
  The floor is the pinned build; there is no search through older builds. One place states the
  tested range and what happens outside it: below the floor the mod says so at session start in one
  line and keeps enforcing; above the last tested build M0.6's notice appears. Every document that
  states a minimum version points to that place.
- [ ] **M1.8 Release** (S, neutral; finding R4; was M1.6). Move `[Unreleased]` to `[0.6.0]`, bump
  `plugin.json`, fix the changelog's compare links to real tags, and mark the pinned-tag lines in
  `docs/INSTALL.md` as available. Then MA3 and MA4. Accepted when the release workflow has
  published 0.6.0 and a fresh machine installs it with one line.

Done when: the release exists and INSTALL's cloud block names its tag. Checkpoint, then wait.

### M2. Measure

Goal: numbers for reviewer quality, against thresholds that were written before the data (AM3).
M4 changes policy and must not be done blind. Findings T1, T3.

- [ ] **M2.1 The policy table, its diff check and the bypass-regression corpus** (M, neutral;
  review §4.11 of the October review, the output-parity idea borrowed in M0; was M2.2; AM3 b, AM8).
  `tests/policy.table.ts`: several hundred rows of input, expected tier and expected rule, starting
  from the probe sets; it is also the bypass-regression corpus, so every bypass class fixed so far
  (DESIGN §10, §15) has rows under neutral names. `scripts/check-policy-diff.mjs` classifies the
  table on the base and the head of a pull request; every row whose tier changed must be declared
  in one line of the pull request's description (`policy: expect-different=<ids>`), and a row that
  got looser also needs the decision that approves it. This makes the tightening and loosening rule
  mechanical. Runs in the existing test job of CI. The brief also adds direct tests for the
  rules-file writer (`withRule`, `withAllowlistEntry`; October review §4.11).
- [ ] **M2.2 The eval suite** (M, neutral; finding T1; was M2.1). `mods/council-of-elrond/evals/`
  for `claude plugin eval`: labelled cases per reviewer (destructive and harmless commands,
  test-weakening and honest diffs, SQL with and without WHERE, pushes of unrelated commits,
  instructions hidden inside diffs and previews) and a council set. State the sample size and run
  each case three times (AM3 a asks for at least 100 must-not-approve cases per reviewer). Hold out
  cases the authors of the prompts did not see. Report wrong-approve separately from wrong-block.
  Out of CI; run by hand (MA5); results and the commit they were run on recorded in DESIGN.md.
- [ ] **M2.3 A shadow week** (maintainer and S; MA5; was M2.3). The released build in shadow mode in
  another repository, a terminal and a cloud session, a week of ordinary work; then
  `/council report`. Record: reviews per session, tokens, median and worst review time, what would
  have been refused, what was refused then allowed, and for AM3 d which reviews of ordinary edits
  `strict` held were of changes later committed.
- [ ] **M2.4 Report against the thresholds** (S, neutral; finding T3; was M2.4). From M2.2 and M2.3,
  DESIGN.md records each of AM3 a to d as met or not met, with the sample sizes. It writes no
  target of its own. It also records the wrong-block rate per reviewer, tokens per session and the
  time added to an allowed call, and adds a benchmark test for the allowed path's own time.
- [ ] **M2.5 The budget-guard test** (S, neutral; a v1 open item). A test that `proceed()` refuses
  when `next.budget.remainingMs` is under 1000, if the test kit can set it. If it cannot, record
  that in DESIGN.md and stop (the v1 decision was to skip the test unless the kit can).

Done when: DESIGN.md holds the eval results and the shadow data, each of AM3 a to d marked met or
not met. Checkpoint, then wait.

### M3. Mechanical refactor

Goal: `register.ts` loses its effects. Moves are verbatim, no behaviour change rides along, and a
difference found on the way is reported, not patched. Evidence: findings A1 to A6; decision D6. Before M3.2
starts, the orchestrator writes all of its briefs in one plan and shows it at a checkpoint: the
moves depend on each other, which is the kind of work the delegation loop handles worst (finding
P2).

- [ ] **M3.1 The layer rule** (S, neutral; was M4.1). Depends on M0.4's result. If sibling modules
  may take `$`: an effects layer, `hooks/effects/`, is the only place besides `register.ts` that
  touches `$`; pure modules stay pure; the direction is rules, then members, then elrond, then
  effects, then register. Written in `docs/DEVELOPMENT.md` and checked in review (a conventions
  checker is Later, M0.7). If M0.4 shows they may not, stop and re-plan M3 with the maintainer.
- [ ] **M3.2 Extract the effects** (L, neutral, one pull request each, in this order; was M4.2):
  rules loading and scopes; files and real paths; git inspections and previews; the model review
  and probe; the check runner and `convene`; the audit writer and its queue; dialogs, panes and the
  indicator; `/council` output. Each move keeps its tests green unchanged and gives the module
  state it uses one owner (finding A4). Along the way: drop the `as never` casts the tests use for
  `agentId` (the test kit's `$.tool.call` takes it from 2.1.308), and give the five pure modules
  that are tested only through their callers (`escalation`, `brief`, `checks`, `globs`, `paths`) a
  test file each (finding T2).

Done when: every moved effect lives under `hooks/effects/` with its state owned in one place, every
test and mutation check passes unchanged, and the policy table (M2.1) shows no row changed.
Checkpoint, then wait.

### M4. Right-size the gate

Goal: the defaults stop ordinary work less and stop risky work more. Every brief changes rows of
the policy table and declares them. Findings F1 to F5 and §2.5; decisions D2 to D4 as amended by
AM2, AM4, AM5 and AM7.

- [ ] **M4.1 The rest of the coverage list** (M, **tightens**; review §2.5, decision D4; was M3.6,
  without what moved to M1.1). Review or ask for: scheduled-job editors and session control;
  registry pushes, forced branch re-creation, copies that overwrite, opening a pull request;
  `make` and package-script targets whose recipe the mod can read and classify (else review), using
  M2's data; the missing MCP verbs; built-in tools that schedule or publish.
- [ ] **M4.2 Reads of protected paths** (M, **loosens**; finding F1, AM5; was M3.2). For shell
  commands, a part that only reads a protected path (a fixed list of read-only programs, and git's
  read-only subcommands) classifies as the file tools do. Anything not on the list still asks.
  `.env` and key files are the exception: M1.1 covers credential reads.
- [ ] **M4.3 Recursive delete under the temp directory** (S, **loosens**; finding F3, AM5; was
  M3.3, first half). A recursive delete under the system temp directory asks instead of blocking.
- [ ] **M4.4 Text written to a file** (S, **loosens**; finding F4, AM5; was M3.3, second half). The
  production DROP and TRUNCATE rule judges parts that run a database client and what is piped or
  redirected into one, not text being written to a file.
- [ ] **M4.5 Presets** (L, neutral while `strict` is the default; decision D2, AM2, ideas 7.1 b,
  7.2 c, 7.3 c; was M3.5). One option, `preset`, with `observe`, `balanced` and `strict`; every
  existing option stays as an override. `balanced`: an ordinary edit inside the repository passes;
  edits to sensitive files (CI, dependency manifests and lockfiles, tests, migrations,
  agent-control files) are still reviewed; the diff reviewer sits at `git commit` on the staged
  diff; the full council sits for a push or merge to a protected branch, a single git reviewer for
  a feature-branch push, and the project checks run for both. `strict` is today's behaviour
  exactly, proven by the policy table, and is the default. `balanced` is opt-in. Changing the
  default is not part of this brief: it needs AM3 a to d met and a separate maintainer decision.
- [ ] **M4.6 The lockout** (S, a decision brief; loosens if approved; AM4; was M3.4, rewritten).
  First states what the retry lockout is for in each host: a person present, headless, cloud. Then
  brings one proposal to the maintainer that settles together: whether "nobody can be asked" counts
  as a failed attempt (finding F5), whether another plugin's `tool.check` denial does (decision
  D12; the wording is recorded in DESIGN §12.7), whether an `sdk` prompt or a person's command
  resets rounds, failed attempts and lockouts (D8's reset, and the reset command of was M3.9), and
  what approved decision 4 then says. No code until the maintainer decides. Until then approved
  decision 4 and DESIGN §14.3 stand as written.

Done when: the policy table changed only where a brief declared it (AM3 c), the eval re-run on the
default models meets AM3 a and b, and the lockout is decided and recorded. Checkpoint, then wait.

### M5. Hosts

Goal: a row in a support matrix for each host, each backed by a test, a recorded live check or an
honest "untested". Findings H1 to H3; decision D8.

- [ ] **M5.1 Headless and SDK sessions** (M, neutral; finding H1, decision D8; was M5.1, without
  the reset). An `sdk` prompt sets the reviewers' latest request. It does not reset rounds, failed
  attempts or lockouts (that is part of M4.6), still cannot loosen the gate by command, and still
  cannot approve by chat.
- [ ] **M5.2 Finish the host checks** (maintainer and S; MA7; was M5.3). The pending cloud checks
  from v1: v1 brief C4's cloud run and v1 brief C6's cloud check (steps in DESIGN §14.6), and,
  where the maintainer can, drawing on desktop, mobile and VS Code. Each result is recorded in
  DESIGN §14.
- [ ] **M5.3 The support matrix** (S, neutral; finding H3; was M5.5, the matrix only). One table in
  the manual: host, what draws, how you are asked, what is tested. A cell may say "untested".

Done when: every cell of the matrix says what is tested and by what, or "untested", and C4's cloud
run and C6's cloud check are recorded in DESIGN §14. Checkpoint, then wait.

### M6. Documents

Goal: a newcomer finds what the system is and what is next in one place each. Findings D2 to D4,
S1.

- [ ] **M6.1 A quickstart** (S, neutral; was M6.2). The first screen of the manual: install, shadow
  mode, the first rule, the first report.
- [ ] **M6.2 DESIGN as the system is** (L, neutral; was M6.1, trimmed). DESIGN.md is split into a
  description of the current system (data flow, failure modes, concurrency, performance, hosts) and
  a numbered decision log in `docs/decisions/`, one entry per decision with its date and what it
  replaced. The version history at the top of DESIGN.md becomes a table. There are no per-folder
  READMEs under `hooks/`.
- [ ] **M6.3 Counts and version numbers out of prose** (S, neutral; replaces the checkers of was
  M0.6). Documents stop stating test counts, line counts and the Claude Code version; they point to
  DESIGN.md's header instead, which is the one place a version is stated.
- [ ] **M6.4 A deprecation rule** (S, neutral). A written rule for shipped rules and options, since
  after 1.0 a default cannot change in a minor release.

Done when: the manual's first screen holds install, shadow mode, the first rule and the first
report; DESIGN.md's header history is a table; and a search of the documents for test counts and
for a Claude Code version outside DESIGN.md's header and the changelog finds none. Checkpoint,
then wait.

### M7. 1.0

Done when all of these hold:

- Released tags, a pinned CI, and the canary and its probe suite have run on schedule for four
  weeks.
- Eval results that meet AM3 a and b on the default models, re-run on the release build.
- The support matrix complete.
- `register.ts` as wiring only; the conventions checker with no debt list. *(Open: both depend on
  briefs now in Later, M4.3 and M0.7. The maintainer decides whether this criterion stays.)*
- A stated minimum version (M1.7).
- No open **high** finding in either November review, as judged by the maintainer.
- A deprecation rule for shipped rules and options (M6.4), since after 1.0 a default cannot change
  in a minor release.
- Before the tag: the policy table diffed against the previous release with every change
  declared, as M2.1 does for a pull request.

### Later (after 1.0)

Briefs and ideas that wait, in rough order. Each needs its own Step 0 check against the types. Old
ids are those of the first v2 numbering; AM1 says none of them is an exception to the freeze.

- **M0.5** A lean CLAUDE.md and one routing skill (references, workflows, an ask-first list).
- **M0.6** Checks for the guidance, the facts and docs-sync (`check-guidance`, `check-facts`,
  `check-docs-sync`); M6.3 replaces the facts checker's job by removing the numbers.
- **M0.7** A conventions checker in place of the `reader` pre-check (finding A2, finding A3,
  finding A5, finding D3, finding T4). Until it exists the pre-check row in CLAUDE.md stays.
- **M0.8, beyond the canary** Git hooks by stage, workflows split by concern, `actionlint`, pinning
  the existing actions by commit SHA, making the CI jobs required checks on `main`.
- **M0.9** The pull request template's gate-direction line, CONTRIBUTING pointers and a dev
  container.
- **M1.4, beyond the promise sentence** The icon (MA6) and one author name (finding I2).
- **M1.5** `/council doctor` (idea 7.2 a).
- **M2.5** Report export, JSON and Markdown (idea 7.5 d).
- **M3.1** Brief Claude at the start (idea 7.1 a); needs the maintainer's sign-off at its brief
  (AM6).
- **M3.7** A user-level rules file, a schema and rule packs (ideas 7.2 d to f; AM6).
- **M3.8** `/council init` (idea 7.2 b).
- **M3.9** One approval route in a terminal, and a reset command (ideas 7.3 a, b, g); the reset is
  part of M4.6's decision (AM4).
- **M3.10** Cheaper, better-informed reviews (ideas 7.3 e, f); the added context needs sign-off
  (AM6).
- **M4.3** The decision pipeline as a reducer.
- **M4.4** Members as data (idea 7.4 a; AM6: SPEC §3's cap stands).
- **M4.5** Wording and the shell parser (finding A2, finding A6).
- **M5.2** Probe an ask-only `tool.check` (finding H2, decision D7), and its open question: keep the
  chat approval route, replace it, or both.
- **M5.4** Visibility on every surface (ideas 7.5 a, b).
- **M5.5, beyond the matrix** A documented `claude -p` setup for CI (idea 7.5 c) and a clear
  statement for Windows.
- **M6.3** The theme pass (idea 7.7, decision D9): themed preset names, a raid log, one line of
  voice per member, the theme in relayed text, a look at `$.theme.set`. Achievements and sounds are
  declined.
- **A `/config` switch for the allow-rule offer** (v1), only if feedback says the offer is noisy.
- **The `AskUserQuestion` re-entry terminal check** (v1): whether the mod's own question could
  arrive as re-entry, so that "Allow once" must still run the call. Whether it is still relevant is
  unknown: 2.1.304 removed the `re-entry` failure kind (DESIGN §12.6).
- **On-demand review** (7.4 b): `/council review` seats the diff reviewer on the working tree and
  runs the project checks.
- **Plan review** (7.4 c): one review of the plan when Claude leaves plan mode. Tightens.
- **A snapshot before destructive work** (7.4 d, "Samwise"), in D11's limited form.
- **A check Claude can call** (7.1 c), in D11's limited form.
- **A triage model** (7.3 d), in D11's limited form.
- **The never-offer list and rule suggestions across sessions** (7.6 b), in D11's limited form.
- **Telemetry for teams** (7.6 c) and **organisation policy** (7.6 d), when a team asks.

Declined on 2026-11-13: a fourth model member (the dependency reviewer, 7.4 e), and achievements
and sounds.

---

## Resuming: what to know first

### Commands

Run from the repository root, in this order:

```
claude plugin test mods/council-of-elrond                  # all tests
tsc -p mods                                                # strict typecheck against mods/types/claude-code.d.ts
claude plugin validate --strict mods/council-of-elrond     # copy its hooks:/calls: lines into DESIGN.md §2
scripts/check-hygiene.sh                                   # generated files, personal data, links
```

- **One rule for the Claude Code version.** CI and the local gates use the **pinned** build: the
  version both workflows install, which DESIGN.md's header names (its history of upgrades is
  there too). To get it locally, install it into a scratch folder and run that `claude`:
  `npm install --prefix <a scratch folder> @anthropic-ai/claude-code@<pinned version>`, then
  `<a scratch folder>/node_modules/.bin/claude`. Upgrades happen on a schedule, monthly and before a
  release (decision D10), through the `/upgrade-types` skill. A newer installed build is expected;
  it is not a reason to upgrade mid-brief.
- **Keep the mod out of the session building it.** Don't load it into your own dev session (the skill's hot-reload folder, or `--plugin-dir` on the session you work in): it would gate your own tool calls.
- **Live checks run headless.** Use `claude -p --plugin-dir ./mods/council-of-elrond "<prompt>"` with harmless commands, ideally in a throwaway `git init` folder, then clean it up along with the generated `.claude-plugin/types/` and `tsconfig.json` in the mod folder. `/council` output only shows with `--output-format stream-json --verbose` (as `system/ui_log`).

### Hard-won API facts (verified by probes; details in DESIGN.md)

1. **Only `hooks/register.ts` may touch `$`.** *(M0.4 re-probes this: finding A1 found it no longer holds at validation time.)*
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


### Carried over from v1

Decisions in [docs/history/ROADMAP-v1.md](../../docs/history/ROADMAP-v1.md) that stay binding. The
"Recommendations on the remaining open decisions" section of that file says the maintainer
approved every recommendation in it on 2026-10-13, and the approved decisions above are the first
twelve of its own list. One line each, with the place to read the reasoning:

- **C3's probe never ships as an option.** No `cloudAsk` option exists in any release: an ask with
  no timeout can hold a call indefinitely. v1, [Recommendations on the remaining open decisions](../../docs/history/ROADMAP-v1.md#recommendations-on-the-remaining-open-decisions-2026-10-13), table "The cloud work items' open choices", row "C3, how the probe ships".
- **C4, which prompts may approve.** `council allow` and `council deny` count only as a whole line
  from a person's origin (`composer`, `bridge`, and the kind the web client's prompts arrive with,
  which C3 showed to be `composer`); never from `peer`, `peer-send-message`, `plugin`, `channel`,
  `scheduled-trigger`, `task-notification`, `coordinator`, `observer`, `auto-continuation` or
  `unclassified`; `sdk` was dropped from the person's origins on 2026-10-20 (DESIGN §14.3). Same
  section, row "C4, which prompts may approve".
- **C4, the `session` allowance** is limited as the allow-rule offer is: never for a script, an
  expanding word, a multi-line or long command, a block rule, a protected path or any secrets
  finding. Same section, row "C4, the `session` allowance".
- **Where a rules file may sit.** Only at the top of a repository (a folder holding `.git`)
  directly below the session root, never at an arbitrary depth. Same section, row "C5, where a
  rules file may sit".
- **Protected paths are `**/`-prefixed** so they hold in every repository below a multi-repository
  root. Same section, row "C5, protected paths".
- **The origin rule for `command.run` (the v1 H2 brief).** The subcommands that loosen the gate
  (`off`, `shadow on`, `model`) need a person's origin; the others answer any origin. Same section,
  table "H2: pipeline robustness", row "§2.9 `command.run` origin".
- **The `exact` field in the rule schema is declined.** v1,
  [Decisions on the open items](../../docs/history/ROADMAP-v1.md#decisions-on-the-open-items-after-the-final-deliverables),
  row "An `exact` field in the rule schema". Same table, rows "An allow rule pins text, not the
  folder" (documented; pinning the working folder is declined), "Windows" (unsupported), "`isReadOnly`
  unused" (left unused) and "`$.ui.ask` in SDK and cloud hosts" (the mod refuses where no surface is
  attached).
- **What the H1 checkpoint approved on 2026-10-13:** redaction uses its own, narrower test of
  plainly-code values; the password warning follows a `kind` on each secret pattern; the
  compound-name prefix is capped at 64 characters; and the standing rule that a loosening is put
  to the maintainer before it is committed and a tightening is decided, recorded and reported
  (it is in CLAUDE.md). The paragraph "Approved after the H1 checkpoint" in the v1
  "Recommendations" section.
- **The remaining decisions from the October review.** The two-session audit race is documented
  only; the allowlist-oracle note is in the manual; the `register.ts` reducer refactor is Later
  (decision D6 moves only the effects). v1, table "The Stage 5 review's remaining decisions".
- **Test secrets are built at run time** from two halves (`tests/fixtures.ts`), so no committed line
  holds a well-formed token; the audit appender's whole-file re-read stays until latency shows.
  The paragraph "Also decided after the final deliverables" in v1 "Known follow-ups".

Open items in v1 that have no other home in v2, and where they now sit:

- **A `/config` switch for the allow-rule offer:** "Later".
- **The `AskUserQuestion` re-entry terminal check:** "Later"; whether it is still relevant is
  unknown.
- **C4's pending cloud run and C6's pending cloud check:** M5.2.
- **The `proceed()` budget-guard test:** M2.5.
- **The ~40-case live eval:** M2.2.
