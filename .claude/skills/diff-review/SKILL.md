---
name: diff-review
description: Hand the whole diff to the reviewer agent before a pull request, then fix what holds up. Use when a brief's change is done and verified, or when asked for a review of the diff.
---

# Review the diff

- Give the reviewer agent the whole diff against `main`, not one file, and the brief it answers.
- Fix each finding that holds up; record each one declined with the reason.
- Run the verify command again, then review the fixes with the reviewer agent once more.
- The reviewer never edits; the orchestrator or a writer applies the fixes.
- Roles, the brief template and the review loop: `.claude/skills/council-of-elrond-development/references/recipes-orchestration.md`
