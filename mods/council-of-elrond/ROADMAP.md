# council-of-elrond: roadmap (v3)

The plan from here to 1.0.0, written so that a dev session with no memory of earlier sessions can
open this file, find the next brief it may run, take it to a pull request and hand over. Repeating
that takes the project to 1.0.0.

## 1. What this file is

- **Read sections 1 to 6 before starting work.** They hold the protocol, what only the maintainer
  can do, the board of briefs and the open decisions. Sections 7 to 9 are the binding record
  (decisions, facts about the host, approved decisions); read the parts your brief names.
- **Where this came from:** the November review,
  [docs/REVIEW-2026-11.md](../../docs/REVIEW-2026-11.md) (findings R1 to P2, ideas 7.1 to 7.7); an
  independent review of it, [docs/REVIEW-2026-11-INDEPENDENT.md](../../docs/REVIEW-2026-11-INDEPENDENT.md);
  and two further rounds of adversarial review and planning,
  [docs/REVIEW-2026-11-ROUNDS-2-3.md](../../docs/REVIEW-2026-11-ROUNDS-2-3.md). The maintainer
  accepted their recommendations on 2026-11-13, 2026-11-14 and 2026-11-15 (section 7).
- **History of this file:** v1 is kept in
  [docs/history/ROADMAP-v1.md](../../docs/history/ROADMAP-v1.md) (Stages 0 to 6, the v1 hardening
  briefs H1 to H3, the cloud items C1 to C6). v2 (2026-11-13) set milestones M0 to M7 and was
  amended twice. v3 (2026-11-15) keeps v2's milestones, brief ids and decisions, adds the briefs
  the review rounds produced, and puts the protocol first.
- **The spec and the design:** [SPEC.md](./SPEC.md) (§ numbers refer to it) and
  [DESIGN.md](./DESIGN.md). Where they differ, this file and DESIGN.md win over the spec.
- **Ids.**
  - `P0` and `M#.#` are live briefs (the board, section 5). A brief id never changes once given;
    v3 added ids and renumbered none.
  - `L#` are the items of "Later (after 1.0)". "(was M3.6)" on a brief or an L item gives its id in
    the first v2 numbering, which [docs/REVIEW-2026-11.md](../../docs/REVIEW-2026-11.md) still uses.
  - `MA#` are maintainer actions (section 4). `OD#` are open decisions (section 6).
  - "Decision D3" is a row of the decisions table, `AM#` an amendment, "approved decision 4" a
    numbered item of "Approved decisions (after the spec)" (section 9).
  - A finding of the November review is always written with the word: "finding A2".
  - "v1 brief H1" is a brief of the v1 roadmap. `R2-…` ids name the briefs of hardening round 2
    and appear only in the history table of section 7.

## 2. Status

| Milestone | Goal | State |
| :- | :- | :- |
| P0 | A development process for this repository: lean guidance, one skill, one verify command | See the P0 brief (section 5, "Status") |
| M0 | Green, current, probed: the pinned build, the types, a scripted probe suite, the canary | In progress (M0.3 done) |
| M1 | Tightenings and the first release, 0.6.0, installable with one line | In progress (M1.3 done; M1.4 started) |
| M2 | Measure the reviewers and write down the policy | Not started |
| M3 | Mechanical refactor: `register.ts` loses its effects | Not started |
| M4 | Right-size the gate | Not started |
| M5 | Hosts: headless, cloud, an honest support matrix | Not started |
| M6 | Documents | Not started |
| M7 | 1.0.0 | Not started |
| Later | After 1.0 | Backlog |

**Done so far.**

- **v1:** Stages 0 to 6, the final deliverables, v1 briefs H1 to H3, cloud items C1 to C5 and C6's
  code. C6's cloud check and C4's cloud run are pending (M5.2).
- **The hardening pull request** (three review rounds, November 2026). Decisions are in DESIGN.md
  §15 and §16; one line per area:
  - the call fingerprint hashes a command exactly; approvals and the verdict cache are bound to
    the folder; a full-council approve, a call with a git part and a call that runs a script are
    not cached;
  - the classifier reads wrappers, runners, heredocs, option clusters, interpreters and command
    strings handed to other programs; block rules and pushes read abbreviated and indirect forms;
    a program word built at run time is reviewed;
  - the mod protects itself: plugin management and nested sessions ask, plugin folders are
    protected against writes, typing into another terminal asks;
  - reviewers and the person see both ends of long input; a cut command, script or SQL file goes
    to the person; the dialog puts call text behind a gutter;
  - redaction and the secrets scan cover more shapes and more tools, with a project's own
    patterns applied everywhere;
  - force pushes and push previews follow the branch and the refspecs actually pushed;
  - the retry brake counts each part of a compound command;
  - a project rules file's loosening settings wait for `/council trust`, whose listing shows every
    rule of the file; an unconfirmed or broken file can only add to the shipped decision (this is
    M1.3);
  - the roadmap amendments, the terminal check and the pinned-build scripts.
  A session that doubts whether one of these landed checks DESIGN §15 and §16 and the tests, not
  this list.

## 3. How a dev session works

The protocol for one session (set up and look first, run the brief, stop conditions, hand over) is in the development skill: [session-protocol.md](../../.claude/skills/council-of-elrond-development/references/session-protocol.md). The rules that keep sessions safe are R1 to R15 in [conventions.md](../../.claude/skills/council-of-elrond-development/references/conventions.md), among them the tightening and loosening rule (R8), the sweep (R9) and the list of what a session must never do. What stays here is what belongs to this board: how to choose a brief.

**Step 1. Choose the brief.**

- The board (section 5) lists every open brief in the order sessions should take them, with
  `Depends on`, `Needs` and `Parallel-safe with`.
- Take the **first** brief in board order whose state is open, whose dependencies are done, and
  whose `Needs` column is empty or already satisfied. A brief that is blocked is skipped, not
  waited for; say so in the hand-over.
- Before starting, list the open pull requests. A brief is claimed by a draft pull request whose
  title starts with the brief id. If the brief you would take is claimed, take the next one that
  is marked parallel-safe with it (their file sets are disjoint). Two sessions never run briefs
  that are not marked parallel-safe with each other.
- Claim yours the same way: open the draft pull request first.
- **P0 comes first.** Every other brief depends on it; its done-test and the stop rule are in the
  P0 brief (section 5, "Status").

## 4. Maintainer actions

Things only the maintainer can do. A session that needs one skips the brief that waits on it and
says so.

| Id | Action | Unblocks |
| :- | :- | :- |
| MA1 | A dev environment for this repository whose setup does **not** install the mod (finding I4) | Every session |
| MA2 | Create the `automation-failure` label | M0.5 |
| MA3 | Run [docs/TERMINAL-CHECK.md](../../docs/TERMINAL-CHECK.md) on the build to be released | M1.8, and every later release |
| MA4 | Push the release tag (`claude plugin tag mods/council-of-elrond --push`) | M1.8 |
| MA5 | Approve the eval run's token spend, and run the shadow weeks (a terminal and a cloud session) | M2.2, M2.3 |
| MA6 | A square PNG icon, 512 to 2048 px (or approve a generated one) | L6 |
| MA7 | Live checks on desktop, mobile and VS Code | M5.2 (a matrix cell may say "untested") |
| MA8 | Land the hardening pull request: run the terminal check on its head, tag the head `archive/hardening-2026-11` so the per-brief history stays reachable, then squash-merge (the repository is squash-only) | Everything below; `main` is what installed users follow, so the merge is a release for them |
| MA9 | Confirm that the dev environment can push changes to workflow files, or agree to make the two one-line pin edits by hand when M0.1 asks | M0.1, M0.5 |
| MA10 | Approve the development-process proposal (Phase 1 of P0). **Done 2026-11-15: proposal approved** | P0 Phase 2 (built) |
| MA11 | Answer the open decisions of section 6, the ones marked "before 0.6.0" first | The briefs each one names |

## 5. The board

Every open brief from here to 1.0.0, in the order sessions take them. Sizes: S is one writer
pass, M is two to four, L is a planned sequence. "Gate" says which way the brief moves the gate.
"Parallel-safe with" names briefs whose files are disjoint from this one's; an empty cell means
run it alone. Nearly every behaviour brief edits `hooks/register.ts`, `hooks/strings.ts`,
`CHANGELOG.md`, the manual and DESIGN.md, so those briefs run one at a time.

| # | Id | Brief | Size | Gate | Depends on | Needs | Parallel-safe with | State |
| -: | :- | :- | :- | :- | :- | :- | :- | :- |
| 1 | P0 | Development process | L | neutral | the hardening pull request merged | MA8 | none: it comes before any other brief | done when merged (see the brief) |
| 2 | M0.4 | The scripted probe suite | M | neutral | P0 | | M1.2, M0.7 | open |
| 3 | M0.7 | The audit line carries the prompt epoch and the lock | S | neutral | P0 | | M0.4, M1.2 | open |
| 4 | M1.2 | The threat model | S | neutral | P0 | | M0.4, M0.7 | open |
| 5 | M0.1 + M0.2 | Types to the current build, and the band on the new contract | S + S | neutral | M0.4 | MA9 (or its fallback), OD25 (default applies) | | open |
| 6 | M1.10 | Claim a round before the review | S | tightens | M0.1 | | | open |
| 7 | M1.1a | Agent-control files are protected paths | S | tightens | M0.1 | OD9 (default applies if unanswered) | | open |
| 8 | M1.9 | Denial wordings count on the first line only | S | tightens | M0.4 (probe 5), M0.1 | | | open |
| 9 | M0.6 | A notice when the host is newer than the tested build | S | neutral | M0.1 | | | open |
| 10 | M1.1b | A tool the mod does not parse is reviewed | S | tightens | M0.1 | | | open |
| 11 | M1.11 | `PATH` assignments are reviewed | S | tightens | M0.1 | | | open |
| 12 | M1.1c | Credential reads ask | M | tightens | M1.1b | OD10 | | open |
| 13 | M1.4 | The terminal check: the remaining v1 screens | M | neutral | M0.1 | | M1.5, M1.6 | started |
| 14 | M1.5 | Install in one line | S | neutral | M0.1 | | M1.4, M1.6 | open |
| 15 | M1.6 | The promise sentence | S | neutral | | | M1.4, M1.5 | open |
| 16 | M1.7 | The compatibility floor and policy | S | neutral | M0.6 | OD15 (default applies) | | open |
| 17 | M0.5 | The canary | M | neutral | M0.4, M0.1 | MA2, MA9 | | open |
| 18 | M1.8 | Release 0.6.0 | S | neutral | every M1 brief above | MA3, MA4 | | open |
| 19 | M2.1 | The policy table, its diff check and the bypass-regression corpus | M | neutral | M0.1 | | | open (OD17: may be pulled forward) |
| 20 | M2.2 | The eval suite | M | neutral | M1.8 | MA5 | M2.1 | open |
| 21 | M2.3 | A shadow week, and the replay script | S | neutral | M1.8, M0.7 | MA5 | | open |
| 22 | M2.4 | Report against the thresholds | S | neutral | M2.2, M2.3 | | | open |
| 23 | M2.5 | The budget-guard test | S | neutral | | | | open |
| 24 | M3.1 | The layer rule | S | neutral | M0.4, M2.1 | | | open |
| 25 | M3.2 | Extract the effects | L | neutral | M3.1 | | | open |
| 26 | M4.1 | The rest of the coverage list | M | tightens | M2.1, M2.3 | | | open |
| 27 | M4.2 | Reads of protected paths | M | loosens (approved) | M4.1 | | | open |
| 28 | M4.3 | Recursive delete under the temp directory | S | loosens (approved) | M4.1 | | | open |
| 29 | M4.4 | Text written to a file | S | loosens (approved) | M4.1 | | | open |
| 30 | M4.5 | Presets | L | neutral | M2.4 | | | open |
| 31 | M4.6 | The lockout | S + M | decision, then as decided | M2.4 | OD1 to OD4 | | open |
| 32 | M5.1 | Headless and SDK sessions | M | neutral | M4.6 | | | open |
| 33 | M5.2 | Finish the host checks | S | neutral | M1.8 | MA7 | | open |
| 34 | M5.3 | The support matrix | S | neutral | M5.2 | | | open |
| 35 | M6.1 | A quickstart | S | neutral | M1.8 | | M6.4 | open |
| 36 | M6.2 | DESIGN as the system is | L | neutral | M3.2 | | | open |
| 37 | M6.3 | Counts and version numbers out of prose | S | neutral | M6.2 | | | open |
| 38 | M6.4 | A deprecation rule | S | neutral | | | M6.1 | open |
| 39 | M7 | Release 1.0.0 | S | neutral | everything above | MA3, MA4, OD marked "before 1.0" | | open |

In every brief below, **Verify** means the verify command, `node scripts/verify.mjs`, described in
[qa-ci.md](../../.claude/skills/council-of-elrond-development/references/qa-ci.md), plus what the
brief adds. Paths are under `mods/council-of-elrond/` unless they start with `docs/`, `scripts/`,
`.github/` or `.claude/`. File lists name the paths as they stood when v3 was written: where P0
has since moved a piece of guidance (out of a skill, `docs/DEVELOPMENT.md` or `CONTRIBUTING.md`),
edit the file that now holds it.

### P0. Development process

- [ ] **P0 A development process for this repository** (L, neutral). Asked for by the maintainer
  on 2026-11-15, in two phases with their approval between.
  - **Phase 1**: a read-only survey of the repository's guidance, checks and workflows, and a
    proposal. It changed no file.
  - **Phase 2** was approved (MA10) and is built in the hardening pull request, with one commit per
    group:
    - (A) `CLAUDE.md` of at most 80 lines: a one-line description, the operating principles, the
      hard rules in short binding form with a pointer each, and the ask-first list;
    - (B) one development skill, `.claude/skills/council-of-elrond-development/`, whose `SKILL.md`
      is only a routing table, with `references/` split by topic (conventions, style,
      architecture, domain topics, QA and CI, recipes, and one workflow file per common task
      shaped Preconditions, Steps, Verification, Docs to update, Ask first); no file over about
      10 KB;
    - (C) agents: a writer, a read-only reader and a reviewer that never edits; guidance names
      roles, and model tiers appear only in agent frontmatter and one table; the orchestrator
      makes small edits itself and runs the full verify once at the end;
    - (D) one verify command that prints a single pass or fail table, reusing the existing
      checks, with tests for its selection logic;
    - (E) `.claude/settings.json`: allow the verify and check commands, ask before edits to
      ask-first files, a post-edit lint hook that cannot crash, and a session-start hook that
      installs dev dependencies in cloud sessions only, with an explicit opt-out variable;
    - (F) pointer-only path rules in `.claude/rules/`, and thin command skills for the top
      workflows plus a verify and a review command;
    - (G) a guidance checker in pre-commit and CI (paths and anchors resolve, `CLAUDE.md` in
      budget, one routing row per reference file, each rule id has one home, rules and command
      skills are pointer-only), each check tested;
    - (H) an evals file of about ten prompts and a "lessons" line in the pull request template.
  - **Status.** Phase 1 (survey and proposal) done and approved 2026-11-15; Phase 2 (groups A to H)
    built in the hardening pull request. **P0 is done when `scripts/verify.mjs` and
    `.claude/skills/council-of-elrond-development/SKILL.md` exist on `origin/main`**
    (`git fetch origin main && git cat-file -e origin/main:scripts/verify.mjs`). Nobody ticks it;
    the board row says so. Until the maintainer has run the terminal check and merged that pull
    request (MA8), no other brief starts: say so and stop, unless the maintainer says in the
    session to go on without it. Once P0 is done, the first brief a session takes is the next open
    one on the board.
  - **Every fact lives in exactly one file.** Section 3 of this file, "Resuming" (section 8),
    `docs/DEVELOPMENT.md`, `CONTRIBUTING.md` and the three existing skills are the sources to move
    from; what moves leaves a pointer behind.
  - **Supersedes** L1 to L5 (the process borrowed in v2: a lean CLAUDE.md with a routing skill,
    the checkers, hooks by stage, the dev container where it overlaps) and the "borrowed process"
    part of decision D13. Those items stay listed in "Later", marked superseded.
  - **Not decided here:** what is on the ask-first list, the wording of the hard rules, and which
    task workflows exist. They are the proposal's content and are the maintainer's (OD21).
  - Accepted when the guidance checker and the verify command pass in CI, `CLAUDE.md` is within
    its budget, and a fresh session can reach every rule from the routing table.

### M0. Green, current, probed

Goal: the gates pass on a pinned Claude Code that is the current one, `main` cannot go red
without a commit, and the facts about the host are checked by a script, not by hand.

- [ ] **M0.4 The scripted probe suite** (M, neutral; finding A1; AM8).
  - **Goal.** One command re-probes the facts about the host (section 8) and prints pass or fail
    for each, with the version it ran on.
  - **Files.** `scripts/probe-suite.sh` (new), `.claude/skills/upgrade-types/SKILL.md`,
    `.claude/skills/live-check/SKILL.md`, `docs/DEVELOPMENT.md`. Nothing under `mods/`.
  - **How it never loads the mod into the developing session.** It only starts child processes:
    `"${COUNCIL_CLAUDE:-claude}" -p … < /dev/null`, with the working directory in a `mktemp -d`
    repository. It loads either a small probe mod written into that folder, or a **copy** of
    `mods/council-of-elrond` made there, so generated files never land in the repository. It
    never writes under the user's Claude configuration and never passes `--plugin-dir` to anything
    but its children. It refuses to run when `claude plugin list` names `council-of-elrond`. It
    asserts from each child's `system/init` event that the expected plugin loaded, and removes the
    folder on exit.
  - **Flags on every child:** `--output-format stream-json --verbose --permission-mode default
    --model ${PROBE_MODEL:-haiku} --max-budget-usd 0.25 --no-session-persistence`. Without them a
    child inherits the session's model, plugins and permission mode: a probe can then pass for
    the wrong reason, or cost dollars.
  - **Probes.** "Log" is a line the probe mod writes with `$.ui.log`, read from `system/ui_log`.

    | # | Fact | Mod | Assertion |
    | -: | :- | :- | :- |
    | 1 | A sibling module, or a closure in a hook, may take `$` (fact 1, finding A1) | probe | `validate --strict` on two variants, and a run where the closure logs |
    | 2 | A block rule refuses in `-p` | a copy of the mod | the tool result is the refusal naming the rules; the audit line has `tier: block`, `outcome: refused`; the target still exists |
    | 3 | A hook that overruns is cut off and the call refused (fact 2) | probe | the log shows `.catch` asked with `kind` `timeout`; a marker the command would create is absent |
    | 4 | The denial wordings are in the binary (fact 13) | none | a search of the resolved binary for each wording and both wrappers, as written (capitalised) |
    | 5 | The shape of denial texts | probe that logs the start of `text` from `next(e)` | four runs: an ask in default mode; a deny rule; don't-ask mode; an allowed command that fails after printing a denial-like phrase. Records whether the text arrives bare or wrapped, and whether a failed command's text opens with an exit-code line |
    | 6 | `$.ui.ask` rejects in `-p`, and `$.session.surfaces()` is empty (fact 5) | probe | log |
    | 7 | `/council status` arrives as `ui_log` with no model turn (fact 6) | a copy of the mod | event kinds |
    | 8 | A `-p` prompt and a slash command arrive with origin `sdk` (DESIGN §14.3) | probe | log |
    | 9 | `$.session.cwd()` follows a `cd` between shell calls | probe | two calls, two folders logged |
    | 10 | `$.store` persists across sessions and `$.state` does not; **where the store's file lives**, and whether a write to that path is caught by a protected or write-protected path | probe, then the classifier | run 1 sets, run 2 reads; the path found is classified as a write by a file tool and by the shell |
    | 11 | `stream.return()` ends a spawned process with no orphan (fact 14) | probe | log, then a process check for a marker |
    | 12 | Where nothing draws, the mod's relayed row reaches the model | a copy of the mod with an unconfirmed rules file | the notice is in what the model is sent and in `ui_log` |
    | 13 | That notice carries counts only | same run | no text from the file appears |
    | 14 | `--plugin-dir` writes generated files into the mod folder (fact 10) | a copy of the mod | both exist in the copy; the repository is clean |
    | 15 | The mod's own refusal reaches the model inside an error wrapper | a copy of the mod | the tool result's shape |
    | 16 | What the engine does when classification is slow (the hook's own time) | probe that spins | cut off and refused, as probe 3 |
    | 17 | If a terminal multiplexer is available: whether keys sent to the session's pane reach the composer during a turn | probe | recorded as observed; skipped with a note where none is installed |

  - **Output.** A table of fact, pass or fail, version; exit 1 on any fail; `--only <n>` runs one
    probe; the script prints the total cost from each `result` event.
  - **Acceptance.** Runs from one command on the pinned build; every fact carries its version; the
    repository is clean afterwards.
  - **Mutation checks.** Flip the expected string of probe 2 and of one case of probe 5: the
    script reports a fail and exits 1.
  - **Record.** The results go into DESIGN §12 (a new subsection) and the version marks into
    `.claude/skills/council-of-elrond-development/references/host-api-facts.md` (section 8 here is now a pointer); if another brief is editing DESIGN, they ride in the next sequential brief.
    Probe 10's answer may make a brief: if the store's file is not caught, add a tightening brief
    to M1 and say so in the hand-over (do not describe the path in a public issue before it is
    fixed).
- [ ] **M0.7 The audit line carries the prompt epoch and the lock** (S, neutral).
  - **Why.** M2.3 measures the released build. Without a prompt boundary in the audit log, the
    replay that the lockout decision needs (M4.6) cannot be done.
  - **Files.** `hooks/audit.ts`, `hooks/register.ts`, `tests/audit.test.ts`,
    `tests/rounds.test.ts`, the manual (audit fields), DESIGN.md, `CHANGELOG.md`.
  - **Decided behaviour.** `AuditRecord` gains `epoch` (the prompt epoch the call belongs to). A
    locked-out line gains `lockKind` (`key` or `verb`) and `lockKey`, redacted as `opKey` is.
    Nothing else changes; no new option.
  - **Acceptance.** Each field appears on the lines named; a person's prompt raises `epoch`; an
    `sdk` prompt does not.
  - **Mutation.** Writing the session's current epoch in place of the call's fails the test where
    a new prompt arrives during a review.
- [ ] **M0.1 Upgrade the types to the current build, and move the CI pin with them** (S, neutral;
  finding R1, finding R2, decision D10). **Lands in one pull request with M0.2:** on a newer
  build the gates cannot pass between them.
  - **Facts.** The vendored types and both workflow pins are 2.1.322's. On 2026-11-15 the
    installed build was 2.1.325. Three band tests were known to fail from 2.1.323; how many fail
    on the current build is unverified, and the tests added by the hardening pull request have
    only ever run on 2.1.322.
  - **Steps.** Follow `/upgrade-types` exactly. Point `COUNCIL_CLAUDE` at the **new** build and
    set `COUNCIL_ALLOW_UNPINNED=1` for this brief only. Run the M0.4 suite on the old and the new
    build and record the differences.
  - **Files.** `mods/types/claude-code.d.ts` (regenerated, never edited), the header of DESIGN.md
    and a new §12 subsection, `.github/workflows/ci.yml` and `.github/workflows/release.yml` (the
    same version in both; `scripts/check-hygiene.sh` checks they agree), `CHANGELOG.md`.
  - **The workflow push.** Try the push of the brief's own branch. A refusal changes nothing
    remote, so the attempt is safe. If refused: push the branch without the two workflow edits
    and ask the maintainer to make the two one-line pin edits on that branch (MA9). CI on the
    branch stays red until then, which is expected.
  - **What may go wrong.** New lints in `validate --strict`; the test kit recording mounted trees
    differently; the denial wrappers moved (M1.9 depends on them); stubs for `$.store` or
    `$.session.cwd` differ. If more breaks than the band, stop, split the work and re-plan rather
    than patch tests.
  - **Acceptance.** `tsc -p mods` passes against the new types; both workflows pin the version the
    types are from; the standard verify is green on that build with M0.2.
- [ ] **M0.2 The band on the new contract** (S, neutral; finding R1). From 2.1.323 the band above
  the prompt stacks one row per plugin (`AbovePromptList`, `AbovePromptRow`) where a hook used to
  replace it.
  - **Files.** `hooks/register.ts` (the `AbovePrompt` hook), `hooks/elrond/view.ts`,
    `tests/debate.test.ts`, `tests/view.test.ts`, `tests/fixtures.ts`, DESIGN §11.
  - **Decided behaviour.** Read both components' docs in the types first. A row while a full
    council sits; no row of the mod's when idle; the survey case as today's test states it; when
    `isCollapsed`, at most one line. Never weaken an assertion: if the engine's own row now
    always shows, the tests say so, and the writer stops and reports.
  - **Acceptance.** All tests pass on the newly pinned build and DESIGN §11 records the behaviour.
- [x] **M0.3 Pin Claude Code in CI** (S, neutral; finding R3, decision D10). Done: both workflows
  install the pinned version; `/upgrade-types` moves the pin and re-checks whether `$.fs` has
  gained an append (finding A7).
- [ ] **M0.6 A notice when the host is newer than the tested build** (S, neutral; AM8).
  - **Files.** `hooks/elrond/version.ts` (new, pure: compare two dotted versions),
    `hooks/register.ts`, `hooks/strings.ts`, `tests/version.test.ts` (new), `tests/relay.test.ts`,
    the manual, DESIGN.md, `CHANGELOG.md`, `.claude/skills/upgrade-types/SKILL.md` (it moves the
    constant).
  - **Decided behaviour.** A `TESTED_BUILD` constant in the code (the mod cannot read DESIGN.md
    at run time). At session start read the host version (first step: confirm the shape of
    `$.session.version()` in the types). When the host is newer, one line through `warnOnce`, or
    through the start notice where nothing draws (DESIGN §13.5); enforcement is unchanged. A
    version that cannot be read shows no line and changes nothing.
  - **Acceptance.** Newer shows the line once; equal and older show none; a failed read shows
    none.
  - **Mutation.** Inverting the comparison fails two tests.
- [ ] **M0.5 The canary** (M, neutral; finding R3, finding P1; was M0.8, the canary only). Needs
  MA2 and MA9. A workflow `ci-canary`: weekly and on demand, it runs the three gates and the M0.4
  probe suite on the **latest** Claude Code, and is never required. A reusable `notify-failure`
  workflow opens or comments on one `automation-failure` issue per failing workflow. Third-party
  actions in the new workflows are pinned by commit SHA with the version in a comment, and each
  has a concurrency group and a timeout. The probe suite's model and budget are set explicitly in
  the workflow. Accepted when a forced failure opens exactly one issue and the existing jobs are
  unchanged.

Done when: the standard verify passes on a pinned build that is the current one; the probe suite
passes headless and its results are in DESIGN; the canary has run once; and a session on a host
newer than the tested build shows the notice. Checkpoint, then wait.

### M1. Tightenings and the first release: 0.6.0

Goal: the tightenings that wait for nothing, a threat model, then a tag, a GitHub release and an
install that is one line on a laptop and one block in the cloud. Findings R4, R5, I1 to I3, I5,
P1, S3.

- [ ] **M1.2 A one-page threat model** (S, neutral; AM8).
  - **Files.** `docs/THREAT-MODEL.md` (new) and `SECURITY.md` only; the manual's link rides in
    the next sequential brief.
  - **Content.** One page, classes only, no reproduction steps. Every claim cites a DESIGN
    section. It states only what the code does:
    - **A mistaken agent** (the main case): the rules tier, the reviewers, the retry brake,
      hooks that fail closed, the limits on the cache.
    - **A prompt-injected agent:** call-supplied text and names sit inside fenced blocks; cut
      input goes to a person; commands that loosen the gate and chat approvals need a person's
      origin; settings files, plugin folders, nested sessions and typing into another terminal
      are guarded; the trust code cannot be derived from the file.
    - **A hostile repository:** an unconfirmed rules file only adds; a broken file keeps its
      tightenings; its reasons are introduced as the project's; names and counts are capped; its
      checks and patterns wait for trust; the trust listing is complete or the file cannot be
      confirmed.
    - **Other plugins:** the mod has one `tool.call` hook and takes no part in the host's
      permission decision.
    - **The person's own mistakes:** the complete trust listing, the allow-rule offer that says
      what it allows, both ends of long input, a dismissal keeps the call blocked, `/council off`
      is logged.
    - **Out of scope,** as `SECURITY.md` says.
  - **A section "Not decided"** lists the questions of OD11 and points there.
- [ ] **M1.10 Claim a round before the review** (S, **tightens**). Today the rounds are read
  before a review and written after its verdict, so several calls in flight on one operation each
  get a reviewer (DESIGN §13.4 f, §16).
  - **Files.** `hooks/elrond/operations.ts`, `hooks/register.ts`, `tests/operations.test.ts`,
    `tests/rounds.test.ts`, DESIGN.md, `CHANGELOG.md`, the manual (the retry section).
  - **Decided behaviour.** New pure `claimRound` (the increments of a non-approve `noteRound`)
    and `releaseRound` (minus one on the same keys, never below 0). Immediately before a reviewer
    starts (single reviewer and full council; not in shadow), one state update either claims or
    finds the operation out of rounds; out of rounds goes to the person with no model request.
    After the review: an approve, no verdict, a failed review or an abort releases; a revise or a
    block keeps the claim and does not count again. A release happens only within the same prompt
    epoch; a hook that dies keeps its claim. It applies to every key family.
  - **Acceptance.** Three calls in flight on one operation with delayed model answers make
    exactly two model requests and the third gets the rounds question; an approve leaves two
    rounds; a failed review leaves two; one revise leaves one; shadow claims nothing; the council
    path behaves the same; the existing rounds tests are unchanged.
  - **Mutations.** Claiming after the review; no release on approve; counting a revise twice.
  - **Consequence to report.** For tools keyed by name alone (OD5) the third parallel call of one
    tool goes to the person. That is the price sequential calls already pay.
- [ ] **M1.1a Agent-control files are protected paths** (S, **tightens**; review §2.5, AM7; first
  part of M1.1).
  - **Files.** `hooks/config/defaults.ts`, `tests/rules.test.ts`, `tests/config.test.ts`, the
    manual, DESIGN.md, `CHANGELOG.md`.
  - **Decided behaviour** (the default of OD9): add to `protectedPaths`: `**/CLAUDE.md`,
    `**/CLAUDE.local.md`, `**/AGENTS.md`, `**/.claude/agents/**`, `**/.claude/skills/**`,
    `**/.claude/commands/**`, `**/.claude/hooks/**`, `**/.mcp.json`. A write by a file tool, or
    any shell mention, asks, as every protected path does. The settings files and the plugin
    folders are already covered.
  - **Acceptance.** One test per path for Write, Edit and a shell write; an unrelated
    `docs/CLAUDE-notes.md` is unchanged. The sweep (R9, `.claude/skills/council-of-elrond-development/references/conventions.md#r9`).
  - **Mutation.** Removing each entry fails its test.
  - **Consequence to report.** A shell read of these files asks (the alternative is the
    write-protected list: OD9). Developing this repository with the mod loaded would ask on every
    guidance edit; MA1 already forbids that setup.
- [ ] **M1.9 Denial wordings count on the first line only** (S, **tightens**). A command that ran
  and failed, and whose output resembles the host's automatic denial, is today recorded as a
  denial and so not counted as a failed attempt (DESIGN §16; the deny-rule wording alone is
  anchored).
  - **Precondition.** M0.4's probe 5 has run. If denial texts arrive wrapped, or a real denial
    has its phrase off the first line, **stop and report**: the rule below must be redesigned.
  - **Files.** `hooks/elrond/operations.ts`, `tests/operations.test.ts`, `tests/rounds.test.ts`,
    DESIGN.md, `CHANGELOG.md`, `.claude/skills/upgrade-types/SKILL.md` (its wording searches).
  - **Decided behaviour.** In the automatic-denial test: trim leading whitespace; a text that
    opens with an exit-code line is not a denial; the deny-rule pattern stays as it is; the other
    recorded wordings are tested against the first line only. No new wording is matched: the
    subagent wrapper and another plugin's deny stay counted, each pinned by a test whose comment
    names OD2.
  - **Acceptance.** A failed command's text is `error` whichever recorded phrase it prints after
    an exit-code line, on a later line with no such line, or on one line after an exit code; every
    recorded real denial stays `denied-by-permission` (approved decision 12).
  - **Mutations.** Testing the whole text again; removing the exit-code guard.
- [ ] **M1.1b A tool the mod does not parse is reviewed** (S, **tightens**; AM7). Any tool whose
  input holds a `command` string and that is not one of the shell tools the classifier parses
  gets a shipped review rule; the PowerShell tool is the known one and the test. Files:
  `hooks/config/defaults.ts`, `hooks/rules/classify.ts`, `tests/rules.test.ts`, the manual,
  DESIGN.md, `CHANGELOG.md`. The sweep (R9, `.claude/skills/council-of-elrond-development/references/conventions.md#r9`).
- [ ] **M1.11 `PATH` assignments are reviewed** (S, **tightens**). Extend the shipped
  `dangerous-env-assignment` rule to a `PATH` assignment that prefixes a command, to
  `export PATH=` and to `env PATH=`: it makes a reviewed program name mean another program.
  Files as M1.1b. The sweep must list every everyday command that becomes stricter; if ordinary
  work is hit hard, stop and bring OD8 to the maintainer.
- [ ] **M1.1c Credential reads ask** (M, **tightens**; AM7). Needs OD10.
  - A shipped list of credential paths (the session decides the list from OD10's answer; without
    an answer the brief waits). A read of one through the `Read` tool, or by a shell reader,
    asks.
  - **Dependency.** `Read` must first join the file-key family, or every gated read shares one
    operation key and one lockout (OD5). The brief does that first, with its own tests.
  - Reading the environment (`printenv`, a bare `env`) is reviewed.
- [x] **M1.3 A trust rule for a repository-supplied rules file** (S, tightens; AM8). Done in the
  hardening pull request: DESIGN §15 item 22, amended by §16 (the complete listing, the
  session-bound code, unconfirmed rules only add, a broken file keeps its tightenings).
- [ ] **M1.4 The terminal check: the remaining v1 screens** (M, neutral; finding P1, decision D5;
  was M1.1). Started: [docs/TERMINAL-CHECK.md](../../docs/TERMINAL-CHECK.md) and
  `tests/terminal.test.ts` exist and cover the dialog, the trust listing, a force push and typing
  into another terminal. What remains: go through the screens of the v1 terminal check (listed in
  [docs/history/ROADMAP-v1.md](../../docs/history/ROADMAP-v1.md), "Final deliverables"). Each one
  a mounted tree (`$.ui.mount`) or a headless stream can prove becomes a test; what is left
  becomes numbered steps in the terminal check. Accepted when each v1 screen names the test or
  the step that covers it, and the whole check still takes about fifteen minutes.
- [ ] **M1.5 Install in one line** (S, neutral; finding I1, finding I3; was M1.3). Everywhere an
  install is described: `/plugin install council-of-elrond --marketplace Deluha/council-of-elrond`
  at the prompt, `claude plugin install council-of-elrond --marketplace Deluha/council-of-elrond`
  from a shell (the `--marketplace` flag exists on 2.1.322; re-check it on the pinned build), the
  desktop route, and one cloud block for a setup script with a pinned tag and the options a host
  that cannot ask should start with. The release workflow's notes use the same lines.
- [ ] **M1.6 The promise sentence** (S, neutral; finding I2, finding I5, finding S3; was M1.4,
  the promise only). One sentence in `plugin.json`, the marketplace entry and both READMEs: a
  second opinion and an audit trail beside Claude Code's own permissions, not a sandbox.
- [ ] **M1.7 The compatibility floor and policy** (S, neutral; finding R5, AM8). The floor is the
  pinned build; there is no search through older builds. One place (OD15; default: a section of
  `docs/INSTALL.md`) states the tested range and what happens outside it: below the floor the mod
  says so at session start in one line and keeps enforcing; above the tested build M0.6's notice
  appears. Every document that states a minimum version points there; "2.1.287 or later" is
  replaced in the root README, `docs/INSTALL.md` and the manual.
- [ ] **M1.8 Release 0.6.0** (S, neutral; finding R4). The checklist, all of it:
  - every M1 brief above is merged, and so are M0.1, M0.2, M0.4, M0.6 and M0.7, so the types,
    both workflow pins and the DESIGN header name one build and the probe suite passes on it;
  - `docs/TERMINAL-CHECK.md` is run by the maintainer on the release commit (MA3); any v1 screen
    not yet mapped is listed as unverified in the release notes;
  - `[Unreleased]` becomes `[0.6.0]`; `plugin.json` says 0.6.0; the changelog's compare links
    point at real tags; the pinned-tag lines in `docs/INSTALL.md` and "Supported versions" in
    `SECURITY.md` are updated;
  - the release notes say plainly that no eval exists yet, reviewer accuracy is unmeasured,
    `strict` is the default and shadow mode is recommended for the first days. AM3's thresholds
    gate `balanced` and 1.0.0, not this tag, and nothing in the release claims a rate;
  - if M1.1c slipped (OD10 unanswered), the notes and the threat model say that reads of
    credential files are not gated in 0.6.0;
  - confirm with the maintainer that this reading is wanted: an `env -S` string that holds the
    program, or ends in an option that takes a value, is read as env reads it (the words after it
    are arguments or that value), where `origin/main` blocked on the command after it (class
    (iii), DESIGN §16 items 45 and 46);
  - decide whether an `env -S` string with two or more `${NAME}` expansions, some set and some
    not, needs more readings than the two made (DESIGN §16 item 46, "what remains unknown");
  - the maintainer pushes the tag (MA4); the release workflow is green; a fresh machine installs
    with the one-line command.

Done when: every M1 brief is ticked and 0.6.0 is tagged and installable by the one-line install.
Checkpoint, then wait.

### M2. Measure

Goal: numbers for reviewer quality, against thresholds written before the data (AM3). M4 changes
policy and must not be done blind. Findings T1, T3.

- [ ] **M2.1 The policy table, its diff check and the bypass-regression corpus** (M, neutral;
  October review §4.11; AM3 b, AM8; was M2.2).
  - `tests/policy.table.ts`: rows of input, expected tier and expected rule. It is also the
    bypass-regression corpus: every class fixed so far (DESIGN §10, §15, §16) has rows under
    neutral names.
  - **Seed it by generators, committed with it.** The sweeps of the hardening pull request (every
    wrapper and runner in the parser's tables with each option form, around protected paths,
    block-rule targets and pushes; several hundred everyday developer commands; forms naming a
    plugin folder) lived in scratch space and are gone. The brief writes
    `scripts/generate-policy-corpus.mjs`, which rebuilds them from the tables in
    `hooks/rules/shell.ts`, and commits a reviewed sample as the table; the full generated set
    runs as the sweep (R9, `.claude/skills/council-of-elrond-development/references/conventions.md#r9`).
  - `scripts/check-policy-diff.mjs` classifies the table on the base and the head of a pull
    request; every row whose tier changed must be declared in one line of the description
    (`policy: expect-different=<ids>`), and a row that got looser also needs the decision that
    approves it. Runs in the existing test job.
  - Also: direct tests for the rules-file writer (`withRule`, `withAllowlistEntry`).
- [ ] **M2.2 The eval suite** (M, neutral; finding T1; was M2.1). `evals/` for
  `claude plugin eval`: labelled cases per reviewer (destructive and harmless commands,
  test-weakening and honest diffs, SQL with and without WHERE, pushes of unrelated commits,
  instructions hidden inside diffs and previews, input cut for length) and a council set. State
  the sample size; run each case three times (AM3 a: at least 100 must-not-approve cases per
  reviewer); hold out cases the authors of the prompts did not see; report wrong-approve
  separately from wrong-block. Out of CI; run by hand (MA5); results and the commit they ran on
  go into DESIGN.md.
- [ ] **M2.3 A shadow week, and the replay script** (maintainer and S; MA5). The released build in
  shadow mode in another repository, a terminal and a cloud session, a week of ordinary work.
  Record: reviews per session, tokens, median and worst review time, what would have been
  refused, what was refused then allowed, and for AM3 d which reviews of ordinary edits were of
  changes later committed. The brief writes `scripts/replay-audit.mjs`: it replays the week's
  audit lines through the pure functions of `hooks/elrond/operations.ts` under today's retry
  policy and under the proposal of M4.6, and reports how many lines it could not place (it needs
  M0.7's `epoch`).
- [ ] **M2.4 Report against the thresholds** (S, neutral; finding T3). From M2.2 and M2.3,
  DESIGN.md records each of AM3 a to d as met or not met, with the sample sizes, and the
  measurements M4.6 asks for. It writes no target of its own. It also records the wrong-block
  rate per reviewer, tokens per session and the time added to an allowed call, and adds a
  benchmark test for the allowed path's own time.
- [ ] **M2.5 The budget-guard test** (S, neutral; a v1 open item). A test that `proceed()`
  refuses when `next.budget.remainingMs` is under 1000, if the test kit can set it. If it cannot,
  record that in DESIGN.md and stop.

Done when: DESIGN.md holds the eval results and the shadow data, each of AM3 a to d marked met or
not met. Checkpoint, then wait.

### M3. Mechanical refactor

Goal: `register.ts` loses its effects. It is about 2,450 lines after the hardening pull request.
Moves are verbatim, no behaviour change rides along, and a difference found on the way is
reported, not patched. The policy table (M2.1) guards it. Evidence: findings A1 to A6; decision
D6. Before M3.2 starts, the orchestrator writes all of its briefs in one plan and shows it at a
checkpoint: the moves depend on each other (finding P2).

- [ ] **M3.1 The layer rule** (S, neutral; was M4.1). Depends on M0.4's probe 1. If sibling
  modules may take `$`: an effects layer, `hooks/effects/`, is the only place besides
  `register.ts` that touches `$`; pure modules stay pure; the direction is rules, then members,
  then elrond, then effects, then register. Written in the developer guidance. If they may not,
  stop and re-plan M3 with the maintainer.
- [ ] **M3.2 Extract the effects** (L, neutral, one pull request each, in this order; was M4.2):
  rules loading, scopes and trust; files and real paths; git inspections and previews; the model
  review and probe; the check runner and `convene`; the audit writer and its queue; dialogs,
  panes and the indicator; `/council` output. Each move keeps its tests green unchanged and gives
  the module state it uses one owner (finding A4). Along the way: drop the `as never` casts the
  tests use for `agentId`; give the pure modules tested only through their callers a test file
  each (finding T2); fold the duplicated helpers the reviews listed (the script-rule list, the
  positional reader, `isObject`/`isRecord`, the two `withRule`).

Done when: every moved effect lives under `hooks/effects/` with its state owned in one place,
every test and mutation check passes unchanged, and the policy table shows no row changed.
Checkpoint, then wait.

### M4. Right-size the gate

Goal: the defaults stop ordinary work less and stop risky work more. Every brief changes rows of
the policy table and declares them. Findings F1 to F5 and §2.5; decisions D2 to D4 as amended.

- [ ] **M4.1 The rest of the coverage list** (M, **tightens**; review §2.5, decision D4; was
  M3.6). Review or ask, using M2's data to keep ordinary work moving, for:
  - scheduled-job editors and session control (`crontab`, `at`); registry pushes; forced branch
    re-creation (`git branch -f`, `git checkout -B`); copies that overwrite; `make` and
    package-script targets whose recipe the mod can read and classify (else review); `git pull`
    (OD8); the MCP verbs the shipped rule lacks (add, reply, forward, fork, comment); built-in
    tools that schedule or publish;
  - forms the review rounds found and left: input piped into a program that applies or schedules
    it (a patch applier, a job scheduler, an archive extractor); git options that name a program
    to run; the inner command of `xargs`; file-upload items of HTTP clients; workspace-wide
    runners; a user-switching wrapper with the command after the user; more package runners; the
    remote-control commands of terminal emulators (the same class as typing into another
    terminal).
  - Found by the fourth review: more terminal-multiplexer and terminal-emulator forms that type
    into another terminal or run an unread command: hooks set as options, format-string
    commands, more `screen -X` forms, emulator remote-control verbs (DESIGN §16 item 32,
    `isTerminalInput` and `command-unreadable` in `hooks/rules/shell.ts`).
- [ ] **M4.2 Reads of protected paths** (M, **loosens**, approved; finding F1, AM5; was M3.2).
  For shell commands, a part that only reads a protected path classifies as the file tools do.
  The reader list and the "reader piped to a writer" rule that the hardening pull request built
  for write-protected folders (DESIGN §16) are the base. Anything not on the list still asks.
  Credential files are the exception (M1.1c).
  - Found by the fourth review: a reader of a write-protected folder that feeds a writer through
    a command substitution, a loop or a subshell is not followed; only a top-level pipe is
    (DESIGN §16 item 30, `pipesIntoNonReader` in `hooks/rules/classify.ts`).
  - Found by the fourth review: `cd` into a protected folder by a glob, a substitution or a
    default expansion is not followed (DESIGN §16 item 29, `cwdTracker`/`cdTargetOf`).
- [ ] **M4.3 Recursive delete under the temp directory** (S, **loosens**, approved; finding F3,
  AM5). It asks instead of blocking.
- [ ] **M4.4 Text written to a file** (S, **loosens**, approved; finding F4, AM5). The production
  DROP and TRUNCATE rule judges parts that run a database client and what is piped or redirected
  into one, not text being written to a file.
- [ ] **M4.5 Presets** (L, neutral while `strict` is the default; decision D2, AM2). One option,
  `preset`, with `observe`, `balanced` and `strict`; every existing option stays as an override.
  `balanced`: an ordinary edit inside the repository passes; edits to sensitive files (CI,
  dependency manifests and lockfiles, tests, migrations, agent-control files) are still reviewed;
  the diff reviewer sits at `git commit` on the staged diff; the full council sits for a push or
  merge to a protected branch, a single git reviewer for a feature-branch push, and the project
  checks run for both. `strict` is today's behaviour exactly, proven by the policy table, and is
  the default. `balanced` is opt-in. Changing the default needs AM3 a to d met and a separate
  maintainer decision.
- [ ] **M4.6 The lockout** (a decision, then code as decided; AM4; was M3.4). The proposal the
  third round wrote is below. The session presents it with M2.4's measurements; the maintainer
  decides OD1 to OD4; then one brief per approved element.

  **What the retry brake is for.**
  - *A person present.* It bounds three things: how many independent samples of a fallible
    reviewer one operation can draw, how often a person can be pressed with the same question,
    and how many variants an agent can try against the classifier. The person's next prompt is
    the reset, and it is cheap.
  - *Headless.* Nobody reads a dialog and no prompt ever resets, so a lockout lasts the run. The
    brake bounds reviewer samples and classifier probing, and tells the agent to stop and report.
    Its cost is collateral: a locked kind also refuses calls a reviewer would have approved.
  - *Cloud with a relay.* A person exists but answers later, through a prompt or a `council
    allow` line; both reset. Between messages the session behaves as headless.

  **One rule:** count the cause, hand back only on evidence, and never let the agent's own action
  lower a count it did not raise.

  | # | Element | Direction | Where |
  | -: | :- | :- | :- |
  | 1 | A round is claimed before the review and released on an approve or no verdict | tightens | M1.10 |
  | 2 | The loosely matched denial wordings count on the first line only | tightens | M1.9 |
  | 3 | The audit line records the prompt epoch and the lock | neutral | M0.7 |
  | 4 | A success hands back to each part exactly what that call itself added, never more | loosens | OD1 |
  | 5 | A refusal decided by a rule (a block, an ask, nobody to ask) counts on the parts whose rule decided it; a reviewer's verdict and a tool error still count on every part | loosens | OD1 |
  | 6 | Tools other than shell and file get a key per input, with the tool name as the kind key | loosens | OD5 |
  | 7 | An automatic denial by the host is not a failed attempt: another plugin's deny (decision D12) and the no-prompts wrapper, each matched only at the start of the text | loosens | OD2 |
  | 8 | File tools keep the whole-tool kind key for now | unchanged | OD6 |
  | 9 | Nobody to ask still counts, an `sdk` prompt still does not reset, and there is no reset command | unchanged | OD3 |

  **What M2's data must show before each loosening** (from `scripts/replay-audit.mjs`, M2.3):
  - *Elements 4 and 5:* at least 30 brake events in the week (a lockout or an out-of-rounds
    question), at least 20% of them collateral (the call had no part that was ever refused on its
    own, or its compound later succeeded); and no retry sequence of the bypass-regression corpus
    draws more reviewer samples under the new policy.
  - *Element 6:* the same 20% among events of that key family, and AM3 a met. It raises the most
    reviewer samples a rephrased input can draw from 2 to 5; at a 2% wrong-approve rate that is
    about 9.6% against 4.0%, so it is not acceptable before the eval exists.
  - *Element 7:* no week of data; one probe showing each wording opens the text, and M1.9 in
    place.
  - *Rows 8 and 9:* revisit only if the cloud half shows headless sessions ending with a kind
    locked purely by nobody-to-ask refusals while later calls of that kind were approvable, in
    more than one session in five.

  **Friction measured in the review rounds,** which the decision should weigh: a failure counts on
  every part of a compound, so five failures of one compound of several gated verbs lock all of
  them until the person's next prompt; two revises on a compound leave each part out of rounds
  even after the compound succeeds; a compound of more than eight gated parts goes to the person
  and is refused where nobody can be asked; a script over the reviewer's limit goes to the person
  on every run (OD13); a force push after a command that may move the branch asks (OD12).

Done when: the policy table changed only where a brief declared it (AM3 c), the eval re-run on the
default models meets AM3 a and b, and the lockout is decided and recorded. Checkpoint, then wait.

### M5. Hosts

Goal: a row in a support matrix for each host, each backed by a test, a recorded live check or an
honest "untested". Findings H1 to H3; decision D8.

- [ ] **M5.1 Headless and SDK sessions** (M, neutral; finding H1, decision D8). An `sdk` prompt
  sets the reviewers' latest request. It does not reset rounds, failed attempts or lockouts (that
  is M4.6), cannot loosen the gate by command, and cannot approve by chat.
- [ ] **M5.2 Finish the host checks** (maintainer and S; MA7; was M5.3). The pending cloud checks
  from v1 (C4's cloud run, C6's cloud check; steps in DESIGN §14.6), and where the maintainer
  can, drawing on desktop, mobile and VS Code. Each result is recorded in DESIGN §14.
- [ ] **M5.3 The support matrix** (S, neutral; finding H3). One table in the manual: host, what
  draws, how you are asked, what is tested. A cell may say "untested".

Done when: every cell says what is tested and by what, or "untested", and the v1 cloud checks are
recorded. Checkpoint, then wait.

### M6. Documents

Goal: a newcomer finds what the system is and what is next in one place each. Findings D2 to D4,
S1.

- [ ] **M6.1 A quickstart** (S, neutral). The first screen of the manual: install, shadow mode,
  the first rule, the first report.
- [ ] **M6.2 DESIGN as the system is** (L, neutral; was M6.1, trimmed). DESIGN.md is split into a
  description of the current system (data flow, failure modes, concurrency, performance, hosts)
  and a numbered decision log in `docs/decisions/`, one entry per decision with its date and what
  it replaced. Sections 3 and 4 are the current truth; §5 onward becomes the log, with an index.
  The hardening pull request may have started this (an index for §16); the brief finishes it and
  does not repeat it. The changelog's 0.6.0 entry is grouped by topic and written as the
  difference from 0.5.0, if the release brief did not already do so.
- [ ] **M6.3 Counts and version numbers out of prose** (S, neutral). Documents stop stating test
  counts and line counts, and state the tested build and the floor in one place each (DESIGN.md's
  header; the compatibility policy of M1.7). Version numbers that record a probe's result stay.
- [ ] **M6.4 A deprecation rule** (S, neutral). A written rule for shipped rules and options,
  since after 1.0 a default cannot change in a minor release.

Done when: the manual's first screen holds install, shadow mode, the first rule and the first
report; DESIGN.md describes the current system with the decisions in a log; a search of the
documents for test counts finds none; the tested build and the floor are each stated in one
place. Checkpoint, then wait.

### M7. Release 1.0.0

Each of these is checkable; the release brief records the evidence for each.

- Released tags, a pinned CI, and the canary and its probe suite have run on schedule for four
  weeks.
- The eval meets AM3 a and b on the default models, re-run on the release build; or the default
  stays `strict` and the release notes give the measured rates.
- The support matrix is complete (a cell may say "untested").
- The terminal check has been run on the release build (MA3).
- The compatibility policy states the floor and the tested range (M1.7).
- The threat model's "Not decided" list is answered or explicitly deferred (OD11).
- No open decision in section 6 is marked "before 1.0".
- A deprecation rule exists (M6.4).
- The policy table is diffed against the previous release with every change declared.
- `register.ts` is wiring only (M3.2). Whether the reducer (L14) and a conventions checker (L3)
  are also required is OD14; the default is that they are not.

### Later (after 1.0)

Briefs and ideas that wait, in rough order. Each needs its own Step 0 check against the types.
AM1 says none of them is an exception to the freeze.

- **L1** (was M0.5) A lean CLAUDE.md and one routing skill. *Superseded by P0.*
- **L2** (was M0.6) Checks for the guidance, the facts and docs-sync. *Superseded by P0 (the
  guidance checker); M6.3 removes the numbers a facts checker would guard.*
- **L3** (was M0.7) A conventions checker in place of the `reader` pre-check (finding A2, finding
  A3, finding A5, finding D3, finding T4). *Superseded by P0 where its reviewer agent and checker
  cover it; what remains is OD14.*
- **L4** (was M0.8, beyond the canary) Git hooks by stage, workflows split by concern,
  `actionlint`, pinning the existing actions by commit SHA, making the CI jobs required checks on
  `main`. *Hooks by stage are superseded by P0; the rest stays.*
- **L5** (was M0.9) The pull request template's gate-direction line, CONTRIBUTING pointers and a
  dev container. *Superseded by P0 where they overlap (the template line, the session-start
  hook).*
- **L6** (was M1.4, beyond the promise sentence) The icon (MA6) and one author name (finding I2).
- **L7** (was M1.5) `/council doctor` (idea 7.2 a).
- **L8** (was M2.5) Report export, JSON and Markdown (idea 7.5 d).
- **L9** (was M3.1) Brief Claude at the start (idea 7.1 a); needs the maintainer's sign-off at its
  brief (AM6).
- **L10** (was M3.7) A user-level rules file, a schema and rule packs (ideas 7.2 d to f; AM6). A
  user-level file must itself be a protected path, and its allow rules need a person's
  confirmation.
- **L11** (was M3.8) `/council init` (idea 7.2 b).
- **L12** (was M3.9) One approval route in a terminal (ideas 7.3 a, b). *Its reset command (idea
  7.3 g) is recommended for dropping (OD3): where a person is present any prompt already resets,
  where none is it cannot be allowed, and it would be a new command under AM1.*
- **L13** (was M3.10) Cheaper, better-informed reviews (ideas 7.3 e, f); the added context needs
  sign-off (AM6).
- **L14** (was M4.3) The decision pipeline as a reducer.
- **L15** (was M4.4) Members as data (idea 7.4 a; AM6: SPEC §3's cap stands).
- **L16** (was M4.5) Wording and the shell parser (finding A2, finding A6).
- **L17** (was M5.2) Probe an ask-only `tool.check` (finding H2, decision D7), and its open
  question (OD16).
- **L18** (was M5.4) Visibility on every surface (ideas 7.5 a, b).
- **L19** (was M5.5, beyond the matrix) A documented `claude -p` setup for CI (idea 7.5 c) and a
  clear statement for Windows.
- **L20** (was M6.3) The theme pass (idea 7.7, decision D9). Achievements and sounds are declined.
- **L21** A `/config` switch for the allow-rule offer (v1), only if feedback says the offer is
  noisy.
- **L22** The `AskUserQuestion` re-entry terminal check (v1). Whether it is still relevant is
  unknown: 2.1.304 removed the `re-entry` failure kind (DESIGN §12.6).
- **L23** On-demand review (7.4 b).
- **L24** Plan review (7.4 c). Tightens.
- **L25** A snapshot before destructive work (7.4 d), in D11's limited form.
- **L26** A check Claude can call (7.1 c), in D11's limited form.
- **L27** A triage model (7.3 d), in D11's limited form.
- **L28** The never-offer list and rule suggestions across sessions (7.6 b), in D11's limited
  form.
- **L29** Telemetry for teams (7.6 c) and organisation policy (7.6 d), when a team asks.
- **L30** A static check for runaway regexes in a rules file. Probably never: a runaway regex
  stalls the hook, which refuses the call, and a static detector is unreliable; the length and
  count caps exist (DESIGN §16). Its scope is a threat-model question (OD11).
- **L31** Reading from disk a script the call runs that was not written through a file tool in
  this session, so the reviewer sees it and the cut-script rule applies to it (today such a
  script is unseen, with a note in the prompt).
- **L32** The cache keyed also by the content of files the call depends on, in place of the
  blanket "a call that runs a script is not cached".
  - Found by the fourth review: the cache still serves calls whose behaviour lives in a file they
    read (apply, upgrade and compose-style commands, `-f file` forms) and misses many project
    runners, while inline code is never cached; both directions need a decision (DESIGN §16 item
    35, `isCacheable` in `elrond/operations.ts`).

Declined: a fourth model member (the dependency reviewer, 7.4 e), and achievements and sounds
(2026-11-13).

### Found by the fourth review, not scheduled

Gaps no brief above covers. Classes only, no example inputs (R11). Each names its DESIGN §16 item
and the code it concerns; a session that takes one writes it a brief first.

- The "matches every call" note in the trust listing depends on a rule having no matcher, not on
  what its pattern matches (DESIGN §16 item 28, `trust.matchesAll`).
- The capital-callee redaction rule raises findings on ORM type calls not in its known-type list;
  relaxing it loosens, so it is the maintainer's decision (DESIGN §16 item 37, `hooks/redact.ts`).
- The dialog's display-width table misses some wide ranges (DESIGN §16 item 39, the row-width code
  in the dialog).
- `cleanText` misses some invisible code points (DESIGN §16 item 28, `cleanText`).
- The 6-character segment rule of the `PWD` exemption redacts ordinary directories named with
  letters and digits (DESIGN §16 item 43); loosening it is the maintainer's decision.

## 6. Open decisions

One list. Each has the question, the recommendation, the **default that holds until the
maintainer answers** (always the stricter one), what it blocks, and when it is needed. A session
never decides one of these; it applies the default.

| Id | Question | Recommendation | Default until answered | Blocks | Needed |
| :- | :- | :- | :- | :- | :- |
| OD1 | The retry brake, elements 4 and 5 of M4.6: hand back to each part what a success itself added; count a rule's refusal only on the parts whose rule decided it | Approve once M2's replay shows the collateral the proposal names | Today's counting: a failure counts on every part, resets are narrow | M4.6 | before 1.0 |
| OD2 | Element 7: is the host's automatic denial through another plugin's deny (decision D12), or through the no-prompts wrapper, a failed attempt | Not a failed attempt, once M1.9 is in and one probe shows each wording opens the text | It counts | M4.6 | before 1.0 |
| OD3 | Row 9: does "nobody can be asked" count (finding F5); does an `sdk` prompt reset (decision D8); is there a reset command (L12) | Keep counting; no reset by `sdk`; drop the reset command | Approved decision 4 and DESIGN §14.3 as written | M4.6, M5.1 | before 1.0 |
| OD4 | What approved decision 4 says after OD1 to OD3 | Rewrite it once, in M4.6 | Unchanged | M4.6 | before 1.0 |
| OD5 | Operation keys for tools other than shell and file: key on the input too | Yes, with the eval in hand (element 6) | One key per tool name | M4.6, M1.1c in part | before 1.0 |
| OD6 | Whole-tool kind keys for file tools (five failed edits lock every edit) | Keep until presets (M4.5) change the base, then re-measure | Unchanged | M4.6 | before 1.0 |
| OD7 | Wider resets on compound commands (a success or a typed instruction also clearing the parts) | No change; element 4 replaces it | Narrow resets | M4.6 | before 1.0 |
| OD8 | `git pull` as review | Yes, in M4.1, with M2's data | Allowed | M4.1 | before 1.0 |
| OD9 | Where agent-control files go: protected paths proper (any shell mention asks) or write-protected (reads pass) | Protected paths proper for 0.6.0; move to write-protected if the shadow week shows read friction | Protected paths proper | M1.1a | before 0.6.0 |
| OD10 | The list of credential paths for M1.1c, and whether 0.6.0 may ship without it | The session proposes a list (key files, cloud credential files, `.env` variants) and the maintainer confirms; allow it to slip to 0.6.1 | M1.1c waits; reads of credential files stay ungated and the release notes say so | M1.1c | before 0.6.0 |
| OD11 | The threat model's "Not decided" questions: is denial of service in scope (a runaway regex, a deliberate lockout); is a hostile MCP server; are subagents and peers the same adversary as the agent; is the cloud host trusted, given it can answer the mod's question itself (DESIGN §14.1); is confidentiality in scope at all (reads and fetches are mostly allowed); does a later plugin's hook see or change the call after the review; the integrity of the audit log; the supply chain of installs from `main`; what wrong-approve rate is acceptable before the eval exists | Answer them in M1.2's review; each answer may add a brief | Each is out of scope until answered, and the threat model says so | M1.2's final form, L30 | before 1.0 |
| OD12 | A force push after a command in the same call that may move the branch (a rebase, a pull, a script) always asks | Keep for 0.6.0; consider reading the branch again after such a command | It asks | nothing | any time |
| OD13 | A script over the reviewer's limit, written in the session and then run, goes to the person on every run | Keep; revisit with L31 and L32 | It goes to the person | nothing | any time |
| OD14 | Do the 1.0.0 criteria include the reducer (L14) and a conventions checker (L3) | No | Not required | M7 | before 1.0 |
| OD15 | Where the compatibility policy lives | A section of `docs/INSTALL.md` | That | M1.7 | before 0.6.0 |
| OD16 | What follows the probe of an ask-only `tool.check` (L17): keep the chat approval route, replace it with the engine's dialog, or both | Decide after the probe | The chat route stays | L17 | any time |
| OD17 | Pull M2.1 (the policy table) forward, ahead of the classifier briefs of M1 | Yes: two review rounds found a loosening only by sweeping, and M1.1b, M1.11 and M1.1c change the classifier again | Board order (M2.1 after the release); the sweep (R9) stands in | M2.1's place | before 0.6.0 |
| OD18 | Should a confirmed file's project rules be able to lower a shipped decision at all (a confirmed review rule can replace a shipped ask), or only add, as an unconfirmed file's do | Only add, for every file: it loosens nothing and removes the need for the listing's warning | Today: a confirmed file's rules decide first, and the trust listing says so | nothing | before 1.0 |
| OD19 | `/council off` and the secrets scan on an allowed call | Keep: an allowed call holding a high-confidence secret is refused even under bypass | Kept | nothing | any time |
| OD20 | Redaction noise that remains (a templated variable reference; an unquoted command substitution cut at a space), and `/council rules` and `/council test` showing a project reason unmarked | Fix in one small brief after 0.6.0 | As is | nothing | any time |
| OD21 | The development-process proposal (P0 Phase 1): the ask-first list, the hard rules, the task workflows | The maintainer reviews the proposal | Answered 2026-11-15 by MA10 (proposal approved; Phase 2 built) | P0 | now |
| OD22 | The scope of "typing into another terminal": is reading another pane's screen in scope, and are terminal emulators' remote-control commands | Reading is out of scope for 0.6.0; remote control joins M4.1 | Sending keys asks; reading is allowed | M4.1 in part | before 1.0 |
| OD23 | AM3's numbers | Keep | As written; they may change only before M2's data is read | M2.4 | before M2.2 runs |
| OD24 | A static check for runaway regexes (L30), and claiming a round for tools keyed by name before OD5 is decided (M1.10 does it) | Never for the first; accept the second | No static check; M1.10 as written | nothing | any time |
| OD25 | The deny rule on `mods/types/claude-code.d.ts`: keep it a deny rule, or make it an ask rule (the upgrade replaces the file by a copy, and a deny rule also refuses the shell copy; probed on 2.1.322) | Ask: a hand edit still prompts, and the upgrade's replacement becomes a deliberate approved step | Deny stays; the upgrade brief M0.1 needs the maintainer for the replacement | M0.1 | before M0.1 |

## 7. Decisions

Binding unless the maintainer changes them. The amendments win over the first table where they
differ; "Rounds 2 and 3" wins over both.

### Decisions (accepted 2026-11-13)

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
| D6 | The refactor | Before 1.0, as M3, moves only. This replaces "after 1.0" in the v1 roadmap. The reducer (L14, was M4.3) is Later. |
| D7 | `tool.check` | One probe of an ask-only hook is allowed (L17, was M5.2). SPEC §7 and the CI step stay as they are until the probe's result is decided on. |
| D8 | Headless prompts | An `sdk` prompt sets the reviewers' "latest request" (M5.1). It still cannot run the subcommands that loosen the gate, and still cannot give a chat approval. The reset of rounds, failed attempts and lockouts is suspended by AM4. |
| D9 | Theme reach | Text relayed through Claude where nothing draws may carry the member's themed name and one line of voice, in themed mode only. Reviewer prompts, refusal reasons and the audit log stay plain. This amends approved decision 1. The theme pass itself (L20, was M6.3) is Later. |
| D10 | Vendored types | Kept in the repository. CI is pinned to the version DESIGN.md names; a scheduled job runs the latest build and reports. Upgrades run on a schedule (monthly, and before each release), not at every build. |
| D11 | The ideas (review §7) | All accepted, except idea 7.4 e (a fourth model member), declined by AM6; those not in a milestone below are in Later. Four are accepted in the limited form the review recommended: the model-callable check (7.1 c) only after the briefing section has shipped and been measured, and off by default; the snapshot member (7.4 d) writes only under the mod's own folder, size-capped, and is opt-in; the triage model (7.3 d) is opt-in and built only if M2 shows cost is the problem; across sessions (7.6 b) only a never-offer list and a suggestion to add a rule are remembered, never an approval. |

On the same day the maintainer also accepted the additions made after the review (its §8) and the
recommendation on the item that was still open:

| # | Decision | Settled as |
| :- | :- | :- |
| D12 | Another plugin's `tool.check` denial | Recognised as an automatic denial, like a deny rule: nobody was asked and the tool did not fail, so it is not a failed attempt (approved decision 12 already treats automatic denials this way). Brief: M4.6 (was M3.4). **Loosens.** AM4 suspends it until the lockout is decided as a whole. |
| D13 | The additions in the review's §8 | The re-probe of the API facts (M0.4, now a script), the new API to look at (M0.2; the rest is Later), the cleanups (M3.2), and the borrowed process, which AM9 moved to Later except the canary (M0.5). *The borrowed process is superseded by brief P0 (2026-11-15), which the maintainer asked for in its place.* |

**Still open**, because it cannot be decided before its evidence exists:

- What follows the probe of an ask-only `tool.check` (L17): keep the chat approval route, replace
  it with the engine's dialog, or both (OD16). Every other open decision is in section 6.

Also settled by the same acceptance: the development process borrowed from another, private project
of the maintainer. That project is proprietary; its **designs** are borrowed and every script and
document here is written fresh. Nothing is copied from it, and nothing about its domain is named in
this repository. AM9 moved most of it to Later; brief P0 supersedes it.

### Amendments after the independent review (accepted 2026-11-13)

The maintainer accepted the recommendations of the independent review
([docs/REVIEW-2026-11-INDEPENDENT.md](../../docs/REVIEW-2026-11-INDEPENDENT.md)); these amendments
win over the decisions table above where they differ.

| # | Amendment | Settled as |
| :- | :- | :- |
| AM1 | Freeze (amends D1) | Until 1.0 the freeze means no new command, option or configuration file beyond the briefs kept below. Briefs moved to "Later" are not exceptions. The one exception made: M1.3 added two subcommands (`trust`, `untrust`), one option (`trustProjectRules`) and a stored record, as AM8 named it; there is no other. |
| AM2 | The default policy (amends D2) | The presets ship in M4 (was M3) with `strict` as the default. `balanced` is opt-in. The default changes only if the pre-registered thresholds (AM3) are met, and then by a separate maintainer decision; it is not automatic. |
| AM3 | Thresholds, written before M2 runs | (a) Wrong-approve rate: on cases labelled must-not-approve, each reviewer approves at most 2%, measured on at least 100 such cases per reviewer, each case run three times and counted as approved if any run approves. (b) The rules tier lets through none of the bypass-regression corpus. (c) The policy table changes only where a brief declared it. (d) `balanced` may become the default only if (a) to (c) hold and the shadow data shows that at least half of the reviews `strict` held on ordinary edits were of changes later committed, so that the commit-time review would have seen them. The numbers are the maintainer's to change, but only before M2's data is read. M2.4 no longer writes targets after the data; it reports against these. "(a) per reviewer" means each of the three model members. (d) needs the shadow week's audit lines matched to later commits, by hand or by a script M2.3 writes, since the audit log holds only a hash and an operation key. |
| AM4 | The lockout (suspends the finding F5 part of D3, D8's reset, D12, and the reset command of L12) | These four changes to the retry brake are decided together in one brief (M4.6, rewritten), which first states what the lockout is for in each host (a person present; headless; cloud) and then brings one proposal to the maintainer. Until that is decided, approved decision 4 ("Nobody to ask: refuse, and it counts as a wipe") and DESIGN §14.3 stand as written. The parts of D8 that do not touch the brake (an `sdk` prompt sets the reviewers' "latest request") stay approved. |
| AM5 | Findings F1, F3, F4 (confirms D3 in part) | Approved as before, each its own brief with its own tests, after the coverage tightenings. |
| AM6 | Unlabelled gate changes | L9 (the briefing section, was M3.1) puts the protected list into the gated model's prompt against approved decision 1 and needs the maintainer's sign-off at its brief; L13's added reviewer context (was M3.10) likewise (SPEC §12 says no transcript). L10 (user-level rules file, rule packs; was M3.7) and L15 (project-defined reviewers, a fourth model member; was M4.4) are in "Later"; SPEC §3's cap of three model members stands. A later reviewer must not be named "Boromir", which already names the proposer. |
| AM7 | Tightenings first | Review §2.5's unambiguous categories (an unparsed tool is reviewed, agent-control files are protected paths, credential reads) move ahead of the release, as a brief in M1 (M1.1). `make` and `npm run` wait for M2's data. |
| AM8 | Additions to 1.0 | A one-page threat model (who is defended against: a mistaken agent, a prompt-injected agent, a hostile repository; and what is out of scope): M1.2. A scripted headless probe suite run by the canary (a block rule refuses, a hook timeout fails closed, the denial wordings are still in the binary): M0.4 and M0.5, plus a one-line session-start notice when the host is newer than the last tested build: M0.6. A compatibility policy (the tested range and what happens outside it): M1.7. The policy table doubling as a bypass-regression corpus: M2.1. A trust rule for a repository-supplied rules file: M1.3. |
| AM9 | Order | The milestones are re-ordered as below. |

### Rounds 2 and 3 (accepted 2026-11-14 and 2026-11-15)

The maintainer asked for two further rounds of review and planning and accepted their
recommendations. The record is
[docs/REVIEW-2026-11-ROUNDS-2-3.md](../../docs/REVIEW-2026-11-ROUNDS-2-3.md).

| # | Accepted | Settled as |
| :- | :- | :- |
| R1 | The fixes of round 2 | Everything in the history table below; DESIGN §16 items 1 to 27. |
| R2 | The fixes of round 3 | The trust listing shows every rule of a file, and the mod's own write no longer confirms an unconfirmed file; a write-protected folder reached through `cd` with a variable, or by a reader piped to a writer, asks; typing into another terminal asks; three option tables corrected; a slow path in the parser bounded; a call that runs a script is not cached; the `PWD` exemption covers path values only; the scan's seam closed; the dialog keeps both ends of the call and cuts reviewer prose first. DESIGN §16, the items after 27. |
| R3 | Declared loosenings, all approved | Plugin folders are protected against writes only (reads and running a plugin's own script are decided as on `main`). Redaction noise undone: a plain word needs six letters, and call expressions, subscripts, positional defaults and small bare numbers are read as code. Two runner options wrongly treated as unknown no longer cause a review. One parser correction lowers a tier that `main` gave by misreading an option. Each is recorded in DESIGN §16 with its sweep. |
| R4 | How the hardening pull request lands | Squash-merge, after the maintainer runs the terminal check on its head; the head is tagged first (MA8). |
| R5 | The order after landing | The development process (P0), then the probe suite, the types upgrade, and the board of section 5. |
| R6 | The retry brake | Only the three elements that tighten or are neutral land now (M1.10, M1.9, M0.7); the loosenings wait for measurement (M4.6, OD1 to OD7). |
| R7 | The development process | Two phases with the maintainer's approval between (brief P0). It supersedes L1 to L5 and the "borrowed process" part of decision D13. |

**History: the briefs of round 2.** All done in the hardening pull request except the probe suite.

| Id | What | Gate | DESIGN §16 item |
| :- | :- | :- | :- |
| R2-F2 | The complete trust listing and the session-bound code | tightens | 1 |
| R2-R1 | Approvals bound to the folder; a full-council approve never cached; a call with a git part not cached; state read afresh | tightens | 2 to 5 |
| R2-F5 | Cut scripts and long compounds are held; the verb counter is bounded; a force push keeps its own retry count | tightens | 6, 7 |
| — | A push preview that may be stale says so | tightens | 8 |
| R2-H1, R2-F1 | Protected paths on every word; wrapper and runner options read in full (this fixed round 1's regression) | tightens | 9 |
| R2-B2, R2-F3 | Unconfirmed rules only add to the shipped decision | tightens | 10 |
| R2-F4 | Plugin folders are write-protected only | loosens, approved | 11 |
| R2-H2, R2-H3 | Block-rule misses; pushes; interpreters; command strings handed to other programs; nested sessions | tightens | 12 |
| R2-U1 | The allow-rule offer says what it allows and is withheld for globs and big operations | tightens | 13 |
| R2-R2, R2-R3 | Project redaction patterns everywhere; the scan reads more; a partial scan is not passed silently | tightens | 14 to 17 |
| R2-F6 | The redaction noise undone | loosens, approved | 18 |
| — | The dialog: wrapping, hidden characters, the size cap | tightens | 19, 20 |
| R2-R4 | A broken rules file keeps its tightening entries; `/council reload` needs a person; size caps | tightens | 21 to 23 |
| R2-O1 | A deny-rule wording counts only when it opens the text (the other wordings: M1.9) | tightens | 24 |
| R2-L1 | The audit log says when a write fails | neutral | 25 |
| R2-K1 | Call-supplied names inside the fenced block | tightens | 26 |
| R2-K2 | Strings and dead code | neutral | 27 |
| R2-T1 | Tests for what the person is handed; the terminal check | neutral | none |
| R2-V2 | The scripted probe suite | neutral | open: this is M0.4 |

The item numbers are as DESIGN §16 stood when round 2 closed; a session that needs one checks the
section's index.

## 8. Resuming: what to know first

The facts live in the development skill, each in one file; this section only points.

- **The commands (the standard verify), the pinned build and the one rule for the Claude Code version:** [qa-ci.md](../../.claude/skills/council-of-elrond-development/references/qa-ci.md).
- **What the hardening sessions established (2026-11), and the hard-won API facts** (verified by probes; details in DESIGN.md): [host-api-facts.md](../../.claude/skills/council-of-elrond-development/references/host-api-facts.md). Brief M0.4 re-probes them and writes the version beside each in that file.
- **Keeping the mod out of the session building it, and headless live checks** (a small model, a permission mode and a budget named on the command line): R1 and R13 in [conventions.md](../../.claude/skills/council-of-elrond-development/references/conventions.md#r1), and [live-check.md](../../.claude/skills/council-of-elrond-development/references/workflows/live-check.md).
- **Conventions in this codebase:** [style.md](../../.claude/skills/council-of-elrond-development/references/style.md).

---

## 9. Approved decisions (after the spec)

From the Step 0 review and the model discussion. These are binding unless the user changes them.

1. **Command output stays out of Claude's context.** *(Amended by C2, approved 2026-10-13, a scoped exception: where `$.session.surfaces()` is empty, `/council` status, report, rules and test, typed by a person, also return their lines as `context` for Claude to relay, redacted and fenced; every other case is as below. DESIGN §13.5.)* `/council` subcommands draw in the pane where a surface draws, else `$.ui.log` (dim, not sent to the model). The `command.run` hook returns no Claude-readable text. This includes `/council off|on|shadow`. Verify where `ui.log` lines go in a plain `claude -p "/council report"` run.
2. **Models.**
   - No Haiku in any default; the latest Sonnet is the floor.
   - Built-in defaults: Gandalf `sonnet`, Legolas `sonnet`, Aragorn `opus`, full council `opus` (`BUILT_IN_MODELS` in `hooks/config/defaults.ts`).
   - Fable is selectable.
   - Layers, highest first: session switch (`/council model`) → `/config` row (picker: `default` / `sonnet` / `opus` / `fable` / `haiku`; `default` = unset) → project `rules.json` `models` (full IDs allowed) → built-in. Your `/config` choice beats the project file. *A project file's `models` now wait for trust (DESIGN §15 item 22), which wins where they differ: until the file is confirmed that layer is skipped.*
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
   - Nobody to ask: refuse, and it counts as a wipe (a block). *Stands as written until the lockout is decided (AM4, OD3).*
   - Typed text is an instruction and resets the operation's rounds; labels compare exactly.
5. **Audit log** at `.claude/council-of-elrond/audit/audit.jsonl`, with a self-written `.gitignore` (`*`), 1 MiB × 3 files. *(Done.)*
6. **Shadow mode ships off** (enforcing). The README's first-days section recommends turning it on. While the audit log is empty, a one-time toast in the first session suggests it. An indicator by the prompt shows it whenever it's on.
7. **Unmatched MCP tools are allowed**, plus a shipped review rule for tool names containing mutating verbs (`mcp-mutating`). *(Done.)*
8. **Build in the repo** (`./mods/council-of-elrond`). Verify with tests, `tsc` and validate; the user runs live UI checks in a terminal with `--plugin-dir`.
9. **Config reload.** Load at session start, after the mod's own writes to `rules.json` (confirmed rules, allowlist entries), and on a new `/council reload`. Never by watching the file. *`/council reload` needs a person's origin since the hardening pull request (DESIGN §16), which wins.*
10. **Possible second prompt on the ask tier.** "Allow once" calls `next(e)`, and Claude Code may still ask. Accept it, and label the permission dialog with `$.ui.notice(e.tool_use_id, "Council: you allowed this once")`. *(Done.)*
11. **Operation keys (stage 2):** tool family + verb + normalised target set.
    - Paths are resolved to real paths under the root, flags dropped, targets sorted.
    - Push uses remote + branch; SQL uses the target database.
    - So `rm -rf ./build` and `rm -r build/` share a key.
    - A coarser per-verb counter (e.g. `git push`, any target) locks out at 5 wipes, to catch retries that change the target.
    - *Added by the hardening pull request (DESIGN §15 item 20, §16), which wins where they differ: each gated part of a compound command also has its own key and verb; a force or delete push has a key of its own; the verb counters are bounded; a call of more than eight gated parts goes to the person. What stays open is in section 6 (OD1 to OD7).*

Stage 2's own decisions (the ones the spec didn't cover) are in [DESIGN.md §6](./DESIGN.md), Stage 3's in [§7](./DESIGN.md), Stage 4's in [§8](./DESIGN.md), Stage 5's in [§9](./DESIGN.md).

12. **Refusals at Claude Code's own permission prompt** (answered in stage 2). The person's own refusal there, after the council let the call through, counts as a failed attempt (as "keep blocked"); an automatic denial with nobody asked (`-p`, a deny rule) does not. Recorded as `outcome: "refused-by-user"` and `"denied-by-permission"` (`outcomeOf` in `elrond/operations.ts`). *(Done. How a denial is told from a failed command's own output: M1.9; whether more of the host's automatic denials belong here: OD2.)*


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
  finding; and, since the hardening pull request, never for a command with an unquoted glob, brace
  or tilde, nor for a big operation (DESIGN §16). Same section, row "C4, the `session` allowance".
- **Where a rules file may sit.** Only at the top of a repository (a folder holding `.git`)
  directly below the session root, never at an arbitrary depth. Same section, row "C5, where a
  rules file may sit".
- **Protected paths are `**/`-prefixed** so they hold in every repository below a multi-repository
  root. Same section, row "C5, protected paths".
- **The origin rule for `command.run` (the v1 H2 brief).** The subcommands that loosen the gate
  (`off`, `shadow on`, `model`, `trust` with or without a code (added by M1.3), and `reload` (DESIGN
  §16)) need a person's origin; `untrust`, which only tightens, and the others answer any origin. Same section,
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

Open items in v1 and where they now sit:

- **A `/config` switch for the allow-rule offer:** "Later" (L21).
- **The `AskUserQuestion` re-entry terminal check:** "Later" (L22); whether it is still relevant is
  unknown.
- **C4's pending cloud run and C6's pending cloud check:** M5.2.
- **The `proceed()` budget-guard test:** M2.5.
- **The ~40-case live eval:** M2.2.
