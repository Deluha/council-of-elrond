# Gate direction and the sweep

Which way a change moves the gate, and how to show it. The rules are R8 (a loosening is asked first) and R9 (the sweep); their full forms are in `references/conventions.md`.

## Which way a change goes

- A change **tightens** when more calls ask or are refused, or more text is redacted.
- A change **loosens** when fewer findings are reported, less is redacted, or a call that used to ask now passes. A side effect counts: a refactor, a wording change or a fix to a test can loosen a path nobody meant to touch.
- The order of the tiers, strictest last: allow, review, ask, block. A compound command is split and the strictest part decides.
- A brief on the board says which way it moves the gate ("Gate" column). A brief marked "loosens (approved)" is approved for exactly what it says; everything else that loosens goes to the maintainer before the commit.
- `mods/council-of-elrond/DESIGN.md` marks each decision of its sections 15 and 16 as a tightening, a loosening or neutral. A decision that was wrong is amended in place with a pointer, never rewritten.

## The sweep (R9)

Until the policy table of brief M2.1 exists, the sweep is by hand:

1. Take the generated command sets the brief names. If it names none, build a set from the rule's family: the command, its option spellings, the wrappers and runners that can carry it, and its compound forms.
2. Classify the whole set on `main`, in a separate copy (`git worktree` or `git archive` into scratch space, R12), and on the branch, through the same entry point. The tests in `tests/rules.test.ts` call the classifier directly; `/council test` classifies a command in a headless run without running it or asking a model (`references/workflows/live-check.md`).
3. Compare the tiers. Every command whose tier is lower on the branch is a line to report.
4. The pull request states "lower than `main`: none", or lists each line with the decision that approves it.

The verify command selects the sweep row for a change to `hooks/rules/`, `hooks/config/defaults.ts`, `hooks/redact.ts` or `hooks/members/gollum.ts`; the row is MANUAL (`references/qa-ci.md`).

## What a sweep finds

A sweep finds what a review does not. Classifying a generated set of commands before and
after a change, against `main`, found a loosening in two of three rounds (R9).

The ask-first items that touch this file's subject: any loosening (stop and ask); the shipped rules, protected paths and the classifier (the edit prompts); redaction (the edit prompts).
