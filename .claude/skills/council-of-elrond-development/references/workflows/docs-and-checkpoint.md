# Update the documents and reach a checkpoint

## Preconditions

The project stops at every milestone checkpoint (SPEC §20) and waits for the maintainer. A checkpoint
is: the three gates pass, DESIGN.md and ROADMAP.md are current, and the maintainer gets a short
summary. Do these steps in order; stop and report at the first failure.

## Steps

### Gates

Run `node scripts/verify.mjs --all` (`/verify-change`) from the repository root: the checks of `references/qa-ci.md`, on the pinned build.

The gates run with the Claude Code build CI pins (the explanation is in `references/qa-ci.md`,
"The pinned build"). All four must pass. Paste the test count. If `validate` prints new `hooks:` or `calls:` lines
(compare with DESIGN.md §2), update that section with the new lines.

### The documents

Check each document in "Docs to update" and fix what is stale.

### The summary

Write it for the maintainer, in this order, each part a few lines:

1. **What changed**, by feature, in the user's terms.
2. **Decisions the spec didn't cover**, numbered as in DESIGN.md, each with the reason.
3. **Known limits** introduced or discovered, and the follow-ups added to the roadmap.
4. **What was verified live** (headless probes, with the command) and **what was not** (anything
   needing a terminal: dialogs, panes, bands, labels).
5. **Gate results**: the test count, `tsc` clean, `validate` passed, hygiene exit 0.

Then stop and wait for the go-ahead. Do not start the next milestone.

## Verification

### Hygiene

- Only `hooks/register.ts` imports or touches `$`; `validate`'s `calls:` line names every helper.
- No new user-facing text outside `hooks/strings.ts`.
- No generated files staged: mods/council-of-elrond/.claude-plugin/types/ and
  mods/council-of-elrond/tsconfig.json are gitignored, and nothing from a throwaway probe repo.
- No session links, model names or personal paths in anything committed (this is a public
  repository).

The pull request description follows `.github/PULL_REQUEST_TEMPLATE.md`, including its gate line and its lessons line.

## Docs to update

Check each and fix what is stale:

- `mods/council-of-elrond/DESIGN.md`: the status line at the top; a numbered decision in its
  section for the current milestone or hardening pass, for every choice this milestone made that
  SPEC.md and ROADMAP.md did not already settle; the failure-mode table (§4) for any new failure path; §2's `hooks:` and
  `calls:` lines.
- `mods/council-of-elrond/ROADMAP.md`: the "Status" table (the milestone's status, a pull request
  link once it exists); the milestone's briefs ticked; new follow-ups under "Later" with the
  brief they came from.
- `mods/council-of-elrond/README.md`: every user-visible change; the status paragraph.
- `CHANGELOG.md`: the change under "Unreleased".
- `mods/council-of-elrond/.claude-plugin/plugin.json`: `version` bumped only at a release, when
  the "Unreleased" entries move under the new version (`references/workflows/release.md`); never at a
  checkpoint.
- CI green on the branch (the "Hygiene" and "Test, typecheck, validate" jobs) before the
  checkpoint is reported.

## Ask first

- **Binding decisions** in the roadmap (its sections 6, 7 and 9) and `mods/council-of-elrond/SPEC.md`: stop and ask before changing one. Ticking a brief and updating the board and the status table are not decisions.
- **`SECURITY.md`, `LICENSE`, `.github/CODEOWNERS`**: path-gated for `SECURITY.md` and `LICENSE`; the edit prompts.
- **A version bump, a release heading in `CHANGELOG.md`, a tag**: stop and ask (`references/workflows/release.md`).
