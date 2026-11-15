# The second and third review rounds (2026-11-14 and 2026-11-15)

> **Status: accepted.** The maintainer accepted the recommendations of both rounds. What was built
> is recorded in [DESIGN.md](../mods/council-of-elrond/DESIGN.md) §16; what was decided, and what
> stays open, is in [ROADMAP.md](../mods/council-of-elrond/ROADMAP.md) (sections 5 to 7). This
> document is the evidence and the reasoning.

It continues [REVIEW-2026-11-INDEPENDENT.md](REVIEW-2026-11-INDEPENDENT.md), which records the
first round. Code findings are given by class only, per [SECURITY.md](../SECURITY.md): classes are
named, inputs are not.

## 1. What the rounds were

Each round had the same three parts, all read-only: an adversarial review of the code the round
before had written, a review of the documents and the plan as they then stood, and a planner that
turned everything known and not done into briefs. Each significant code finding was re-run by
hand before it was reported. The fixes were then written as briefs, one commit each, with a test
that fails without the change and the code broken on purpose to see the test fail.

- **Round 1** (2026-11-13) is the independent review and the first hardening pass: DESIGN §15.
- **Round 2** (2026-11-14) reviewed round 1's code and closed what round 1 left open: DESIGN §16
  items 1 to 27.
- **Round 3** (2026-11-15) reviewed round 2's code: DESIGN §16, the items after 27.

The reviews also ran headless sessions with real reviewers on the pinned build, in throwaway
repositories, with the mod copied from the branch.

## 2. What round 2 found

**A regression that round 1 introduced.** Round 1 taught the parser to look through wrappers and
runners to the command they carry. In doing so it stopped showing the protected-path check the
values of those wrappers' own options, so a protected path named as such a value passed where
`main` had asked. Round 1 had described itself as tightening only. The fix checks protected paths
on every word as written; a sweep of generated wrapper and runner forms then found none below
`main`.

**Confirming a rules file could confirm what the person was not shown.** The listing stopped after
a fixed number of items of each kind, cut long values, redacted values (so the file's author chose
what was blanked) and left some fields out; the code that confirmed it could be worked out from
the file alone and typed without the listing having been shown.

**An unconfirmed file could replace a review with a question.** A rule from a file nobody had
confirmed decided before the shipped rules. One broad rule of the "ask" tier therefore replaced
the reviewers, the preview and the full council with a bare question carrying the file's own
reason.

**Approvals travelled.** The verdict cache and the chat approval were keyed by the call's text
and not by where it ran, so an approve given in one folder was reused in another; a cached approve
also skipped the full council for a repeated big operation.

**Fixes that did not fully hold.** A force push after a branch switch in the same call was judged
against the branch read before the call; the retry brake could be stepped past by a compound of
many parts; a script cut for the reviewer could be approved by a model and then run; a program
word built by the shell from a pattern was not treated as unknown.

**Friction and noise.** Real options of two runners were unknown to the tables, so ordinary
commands were reviewed. Any shell mention of a plugin folder asked, including reads and running a
plugin's own script. Redaction's lower length limit and narrower placeholder test blanked
ordinary code.

**Smaller.** Project redaction patterns were not applied everywhere the mod writes text; the
secrets scan did not read every tool's input and passed over-long text silently; a broken rules
file lost its own protections; the dialog showed long call lines without the gutter on wrapped
rows; block rules and push flags missed abbreviated spellings; more interpreters, inline-code
flags and command strings handed to other programs.

## 3. What round 3 found

**Three defects that round 2 introduced.**

- *Confirmation again covered rules the listing did not show.* Round 2 let the review rules of an
  unconfirmed file apply at once, adding only; the listing then no longer showed them. Once the
  file was confirmed its rules decided first, so rules the person had never been shown could lower
  a shipped decision. A second route existed through the mod's own write to a file that had
  nothing waiting.
- *A write-protected folder could be entered and then written.* Round 2 made plugin folders
  protected against writes only and exempted a change of directory as a read. When the directory
  was named through a variable, the write that followed was not judged inside the folder.
- *An exemption in redaction was wider than declared.* Round 2 stopped treating the shell's own
  working-directory variables as secret keywords. The exemption applied to any value, and one of
  those names is also a password keyword in database connection strings.

**Older, and now closed.** A terminal multiplexer could be used to type into the session's own
pane, which reaches the composer with a person's origin; three wrappers' option tables had a wrong
arity, which hid the inner command; one parser path was quadratic on crafted input (it failed
closed); a secret lying across the scan's internal boundary was missed; an approved script could
be changed and run again from the cache; an allow rule with no pattern listed as harmless lines
though it matches everything; the dialog's size cap dropped call text before reviewer prose.

**In the documents.** The terminal check had expectations that could not pass; the changelog
contradicted itself after many commits; the roadmap described round 2 as tightening only while
listing its loosenings; a fresh session would have stopped at the first brief; this record did
not exist.

## 4. Declared loosenings

Each is recorded in DESIGN §16 with the sweep that bounds it, and was approved by the maintainer.

| Id | What | Relative to |
| :- | :- | :- |
| R2-F4 | Plugin folders are protected against writes only: shell reads, and running a plugin's own script, are decided as on `main` | an earlier commit of the same pull request |
| R2-F6 | Redaction noise undone: a plain word needs six letters; call expressions, subscripts, positional defaults and small bare numbers are read as code. Below `main` only for path values assigned to the shell's working-directory variables, and the scan's flag on a subscript | an earlier commit; and `main` as stated |
| R2-H1 | Two runner options that round 1 wrongly treated as unknown no longer cause a review | an earlier commit; equal to `main` |
| — | A parser correction: an option that `main` misread, which made it review a harmless form, is now read correctly | `main` |

## 5. What held under attack

- A reviewer error, timeout or malformed reply never becomes an approve; one approve cannot
  outvote a block; the block floor and protected paths cannot be lowered by a project rule.
- An unconfirmed or broken rules file never yields a lower tier than no file, in any combination
  of tiers, parts and repositories tried.
- The trust code needs a listing shown in the same session, is spent on use and is not relayed to
  the model.
- Approvals are bound to the folder; a symlinked spelling is only stricter.
- A sweep of several hundred thousand generated wrapper and runner commands found no shell command
  below `main` from a wrong reading, apart from the declared cases.
- No test is skipped, and no personal data, local path or real-format secret was found in the
  changes.

## 6. What stays open

The single list is [ROADMAP.md](../mods/council-of-elrond/ROADMAP.md), section 6, and the briefs
are on its board (section 5). In short: how the host's own denial is told from a failed command's
output that resembles one (M1.9, after a live probe); the retry brake as a whole, whose stricter
counting can stop ordinary work sooner (M4.6); where the plugin's own store keeps its file and
whether a write to it is caught (M0.4); the categories of commands not yet covered (M4.1); the
threat model's unanswered questions (M1.2); and the fact that no interactive host has yet been
exercised ([TERMINAL-CHECK.md](TERMINAL-CHECK.md)).

## 7. What the rounds teach

- A change described as tightening was a loosening in two rounds of three. Reading the change did
  not find it; classifying a generated set of commands before and after, against `main`, did. The
  roadmap now requires that sweep of every classifier and redaction change, and M2.1 makes it a
  check.
- A fix reviewed by its author's session holds less well than one attacked by a session that did
  not write it. Each round's review found defects in the round before.
- An approval given as a whole ("all recommendations") is not the same as a decision on each
  loosening. The roadmap keeps one list of open decisions with the stricter default in force until
  each is answered.
