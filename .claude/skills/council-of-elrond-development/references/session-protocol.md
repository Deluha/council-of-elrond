# Session protocol

How a session runs one brief. Which brief to take is the board's job: `mods/council-of-elrond/ROADMAP.md` (its section 3 says how to choose and claim one; its section 5 is the board).

## Set up and look before changing anything

1. Read `CLAUDE.md`, then sections 1 to 6 of `mods/council-of-elrond/ROADMAP.md`, then the header of DESIGN.md and the
   index of its §15 and §16 (or, where no index exists yet, their numbered item titles).
2. Check the mod is not loaded into this session: `claude plugin list` must not name
   `council-of-elrond`. If it does, stop and tell the maintainer (MA1): the mod would gate the
   session's own tool calls.
3. Get the pinned build. The gates run on the Claude Code build CI pins, not on whatever is
   installed; a newer installed build is expected and is not a reason to upgrade.
   The command and its variables: `references/qa-ci.md` (The pinned build).
4. Run the **standard verify** once and see it green: `node scripts/verify.mjs --all` (`/verify-change`; what it runs is in `references/qa-ci.md`). With `--all` the expected green is `PASS (2 manual checks outstanding)`, because `--all` selects the two MANUAL rows (the sweep and the mutation check) whether or not anything changed; nothing is owed for them unless the change touches such a file. If it is red on a clean checkout, stop and report; do not fix forward inside another brief.

## Run one brief

- The brief in section 5 gives the goal, the files, the decided behaviour, the acceptance and the
  mutation checks. The orchestrator turns it into a delegation brief (`references/recipes-orchestration.md`):
  the writer runs it, the reviewer reads the whole diff, and the orchestrator runs the verify
  command itself. Where a brief says "the session decides", the safer option is
  picked and recorded.
- One brief, one branch, one pull request (R14). A change to a path that decides whether a call runs needs its mutation check (R7). A headless live check where the brief asks for one names a small model, a permission mode and a budget (R13).

## The rules that keep a session safe

The full forms are in `references/conventions.md`: R1 (the mod is never loaded into this session), R8 (a loosening is asked first), R9 (the sweep), R11 (no bypass input in public text), R12 (no stash, reset or check out over another agent's tree), R13 (child runs), R14 (never push to `main` or merge) and R15 (never weaken a test or a guard).

## Stop conditions

Stop and report, without working round it, when: a loosening is needed that
no brief approved; a brief's stated precondition fails; a maintainer action is needed; the
standard verify is red on a clean checkout; or the brief turns out to need a decision listed in
section 6 of the roadmap.

## Hand over, then stop

- Tick the brief on the board and in its section; update the milestone's state in section 2 of the roadmap when
  it is the milestone's last.
- Record decisions in DESIGN.md (the section for the current milestone or hardening pass), and
  user-visible changes in the manual and `CHANGELOG.md` ("Unreleased").
- Anything found and not done goes to "Later" or to "Open decisions" with the brief id that found
  it.
- The pull request description follows the template and says what was verified live and what was
  not.
- One brief per session unless the maintainer said otherwise. At the end of a milestone, the
  checkpoint summary (`/checkpoint`), then wait.

Keep the checkpoint discipline: finish the milestone, pass the checks, write the summary, wait. The
maintainer decides scope; ROADMAP's "Later" is where ideas wait for a decision.
