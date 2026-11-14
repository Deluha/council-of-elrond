# Independent review of the November review and ROADMAP v2 (2026-11-13)

> **Status: accepted 2026-11-13.** The maintainer accepted this review's recommendations. They are
> recorded in [ROADMAP.md](../mods/council-of-elrond/ROADMAP.md) under "Amendments after the
> independent review" and win over the decisions table there where they differ. This document stays
> as the evidence and reasoning behind them.

Date: 2026-11-13. It reviews [docs/REVIEW-2026-11.md](REVIEW-2026-11.md), the roadmap built from it
(ROADMAP v2) and the repository as they stood after the maintainer accepted that roadmap.

Coarse detail only for the code findings (section 4), per [SECURITY.md](../SECURITY.md): classes
are named, inputs are not.

## 1. What it was

Three independent, read-only reviewers on 2026-11-13: one for the code, one for the documentation,
one for the plan and its scope. A second pass followed: the modules the first pass had read only in
part, the repository's GitHub state (workflows, labels, releases, settings), and headless live runs
with real reviewers on the pinned build. Each significant finding was re-checked before it was
reported.

## 2. Findings on the plan

- **Loosening decisions were accepted before the evidence.** The decisions marked "Loosens" (D2,
  D3, D8, D12) were accepted the same day as the review, before the measurement milestone that was
  meant to inform them. M3's exit criterion depended on targets that M2.4 writes after the data has
  been read, so it could not fail.
- **The retry lockout was loosened four ways with no joint analysis:** finding F5, decision D8,
  decision D12 and the M3.9 reset command. Approved decision 4 ("Nobody to ask: refuse, and it
  counts as a wipe") was left as it was beside them.
- **Three briefs changed the gate without saying so.** M3.1 (a briefing section for the gated
  model), M3.7 (a user-level rules file and rule packs) and M4.4 (project-defined reviewers) were
  not labelled as changing the gate.
- **The plan is large for the project's history.** About 43 briefs, against 30 pull requests in
  the project's history, while finding S2 says the feature set has outrun its users.
- **Process ahead of the first release.** M0.5 to M0.9 put a rewrite of the guidance, three
  checkers, a conventions checker, a split of the hooks and workflows and a new template in front
  of the first tag.
- **Missing altogether:** a threat model; a recurring check for semantic host drift (the canary as
  planned sees only type drift); a compatibility policy; a trust statement for a rules file that a
  repository supplies.
- **The best-evidenced tightenings were scheduled late.** The unambiguous coverage categories sat
  in M3, behind measurement and the feature freeze.

## 3. Findings on the documentation

- `CLAUDE.md`, the root README and `docs/DEVELOPMENT.md` stated a vendored-types version that was
  several builds old; `docs/INSTALL.md` and `CONTRIBUTING.md` stated "checked on 2.1.294".
- `docs/DEVELOPMENT.md` described agent lanes that no longer match `CLAUDE.md` "Orchestration", and
  pointed at a "Known follow-ups" list that the roadmap no longer has. The root README repeated the
  outdated description of the scribe agent.
- The documents and the checks disagreed on `claude plugin validate`: CI and the pre-commit hook run
  it with `--strict`; the guides, the pull request template and the checkpoint skill did not.
- The `checkpoint` skill named a stage table row, "Known follow-ups" and "Decisions the spec did
  not cover (Stage N)", none of which the current roadmap and design documents have.
- The `upgrade-types` skill and `docs/MAINTENANCE.md` said to unpin CI, to run whenever versions
  differ, and that an overrunning hook "still runs `next(e)`"; since 2.1.299 the hook is cut off and
  the call refused (DESIGN §12.5). `docs/MAINTENANCE.md` also pointed its 1.0 criteria at v1
  roadmap sections ("Final deliverables", "Before 1.0", C3 to C6).
- Several documents said 0.5.0 was released, shipped or tagged. No tag exists; 0.5.0 and 0.6.0 are
  changelog headings on `main`.
- `docs/INSTALL.md` did not list the chat approval route as a way to let a refused call run where
  nothing draws, which the mod's manual does.
- The October review's banner pointed at roadmap sections that no longer exist, and the v1 roadmap's
  banner called v2 a proposal and said everything in it stays binding.
- `docs/REVIEW-2026-11.md` named the domain and tooling of a private project.
- The pull request template asked for a "Stage", and the feature request template pointed at "Stage
  6" and "Known follow-ups". The bug report template's version placeholder was one fixed build.
- Hard-won API fact 1 was repeated in `docs/DEVELOPMENT.md` as a hard rule although finding A1
  showed it no longer holds at validation time.

## 4. Findings on the code

Classes only. Fixed in the hardening pull request (DESIGN §15):

- The call fingerprint normalised whitespace in commands, so two different commands could share one.
- Shell forms hid a command from the classifier: wrappers, runners, expanding heredocs, program
  names fixed only at run time, code on an interpreter's standard input and attached inline-code
  flags.
- The mod did not guard its own plugin.
- Reviewers and the dialog saw only the head of long input.
- The dialog rendered call text without a gutter.
- The exemptions for redaction placeholders were too wide.

Further findings in the decision path are handled under [SECURITY.md](../SECURITY.md) and are
listed in DESIGN §15 as they are fixed. They are not described here.

## 5. What held

- Every reviewer error, timeout or malformed reply ends as no verdict, never an approve.
- One approve cannot outvote a block.
- The block floor and the protected paths cannot be lowered by a project rule.
- Chat approvals are parsed strictly, bound to one offer and spent once.
- No test is skipped.
- The block rule and the reviewer route behaved live as the unit tests say.

## 6. Corrections to the November review

- R3 (CI unpinned) was already fixed by the pull request that merged the roadmap.
- "33 shipped rule reasons" was 34.
- Headless child runs do work from a cloud session. M0.4 assumed they do not.
- The claim "redaction before truncation" held in two places and was reversed in five.

## 7. Limits

- No interactive host was exercised.
- Claude Code 2.1.323 fails three band tests unrelated to this work (finding R1).
- The eval of reviewer quality does not exist yet, so nothing here says how often a reviewer is
  right.
