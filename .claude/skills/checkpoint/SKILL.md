---
name: checkpoint
description: Run the mod's three gates (tests, typecheck, validate) and draft the stage checkpoint summary SPEC §20 asks for. Use at the end of a stage, before a commit, or when asked "are we ready to commit / checkpoint".
---

# Stage checkpoint

The project stops at every stage checkpoint (SPEC §20) and waits for the maintainer. A checkpoint
is: the three gates pass, DESIGN.md and ROADMAP.md are current, and the maintainer gets a short
summary. Do these steps in order; stop and report at the first failure.

## 1. Gates

Run from the repository root:

```sh
claude plugin test mods/council-of-elrond
tsc -p mods
claude plugin validate mods/council-of-elrond
```

All three must pass. Paste the test count. If `validate` prints new `hooks:` or `calls:` lines
(compare with DESIGN.md §2), update that section with the new lines.

## 2. Documents

Check each and fix what is stale:

- `mods/council-of-elrond/DESIGN.md`: the status line at the top; a numbered section "Decisions the
  spec did not cover (Stage N)" holding every choice this stage made that SPEC.md and ROADMAP.md
  did not already settle; the failure-mode table (§4) for any new failure path; §2's `hooks:` and
  `calls:` lines.
- `mods/council-of-elrond/ROADMAP.md`: the stage table row (status, pull request link once it
  exists); the stage's checklist ticked; new follow-ups under "Known follow-ups" with the stage
  they came from.
- `mods/council-of-elrond/README.md`: every user-visible change; the status paragraph.
- `CHANGELOG.md`: the change under "Unreleased".
- `mods/council-of-elrond/.claude-plugin/plugin.json`: `version` bumped if this is a release.

## 3. Hygiene

- Only `hooks/register.ts` imports or touches `$`; `validate`'s `calls:` line names every helper.
- No new user-facing text outside `hooks/strings.ts`.
- No generated files staged: `mods/council-of-elrond/.claude-plugin/types/` and
  `mods/council-of-elrond/tsconfig.json` are gitignored, and nothing from a throwaway probe repo.
- No session links, model names or personal paths in anything committed (this is a public
  repository).

## 4. The summary

Write it for the maintainer, in this order, each part a few lines:

1. **What changed**, by feature, in the user's terms.
2. **Decisions the spec didn't cover**, numbered as in DESIGN.md, each with the reason.
3. **Known limits** introduced or discovered, and the follow-ups added to the roadmap.
4. **What was verified live** (headless probes, with the command) and **what was not** (anything
   needing a terminal: dialogs, panes, bands, labels).
5. **Gate results**: the test count, `tsc` clean, `validate` passed.

Then stop and wait for the go-ahead. Do not start the next stage.
