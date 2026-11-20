---
name: verify
description: Run the project's verify command on the current change and read its table. Use before a commit or a pull request, when asked "does it pass", or once at the start of a cloud session with --all.
disable-model-invocation: true
argument-hint: "[--staged | --all]"
---

# Verify the change

- Run `scripts/verify.mjs` with node, passing $ARGUMENTS. Modes: no flag checks the current change, `--staged` the staged files (pre-commit), `--all` everything.
- Read the table: PASS, FAIL, SKIP (with its reason) and MANUAL. Fix every FAIL; the exit code is non-zero if any check failed.
- A MANUAL row means do that check by hand (the sweep against `main`, the mutation check) and say so in the summary; PASS with MANUAL rows outstanding is not a bare green.
- An unpinned build fails the gate rows. Use the pinned build, not a bare `claude`.
- What each check is, the pinned build and CI: `.claude/skills/council-of-elrond-development/references/qa-and-ci.md`
