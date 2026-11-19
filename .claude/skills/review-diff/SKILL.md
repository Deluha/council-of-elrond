---
name: review-diff
description: Hand the whole diff to the reviewer agent before a pull request, then fix what holds up. Use when a brief's change is done and verified, or when asked for a review of the diff.
disable-model-invocation: true
argument-hint: "[diff range, default origin/main...HEAD plus the working tree]"
---

# Review the diff

- Give the reviewer agent the whole diff in the range of $ARGUMENTS (with no argument, `origin/main...HEAD` plus the working tree), not one file, and the brief it answers: the goal and the acceptance criteria, never the author's reasoning.
- Verify each finding against the code before relaying it, most severe first.
- Fix each finding that holds up; record each one declined with the reason.
- Run the verify command again, then review the fixes with the reviewer agent once more.
- The reviewer never edits; the orchestrator or the implementer applies the fixes.
- Roles, the brief template and the review loop: `.claude/skills/council-of-elrond-development/references/recipes-orchestration.md`
