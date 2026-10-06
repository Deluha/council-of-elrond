# Maintaining council-of-elrond

For whoever cuts releases, tracks Claude Code, and keeps the gate honest over time.

## What can rot

The mod sits on three things that move without it:

| Dependency | How it breaks | How you notice |
| :- | :- | :- |
| Claude Code's plugin API (`mods/types/claude-code.d.ts`) | A method changes shape or goes away; a new event the mod should handle appears. | `tsc -p mods` fails after regenerating the types; or behaviour changes with no type change (probe it). |
| Wording read from Claude Code's binary | The permission-prompt refusal text ("The user doesn't want to proceed with this tool use", "…take this action right now") and the automatic denial text ("… needs approval …") change. The mod tells a user's refusal from a tool error by that wording. | A user's refusal at the permission prompt stops counting as a failed attempt; `outcome` in the audit log reads `error` where it should read `refused-by-user`. |
| Model aliases | `sonnet`, `opus`, `fable`, `haiku` resolve to the newest model the build knows; token caps, effort and deadlines are set per family in `hooks/elrond/models.ts`. A new family needs a profile; a slower model needs a longer deadline. | `/council model` probe fails; reviews time out. |

## When Claude Code updates

Run this whenever `claude --version` differs from the version at the top of DESIGN.md. The
`/upgrade-types` skill in this repository walks through it.

1. **Regenerate the types.** Load the `plugin-authoring` skill in a Claude Code session; it writes
   `types/claude-code.d.ts` under the skill's folder and prints the path. Do not point it at a mod
   folder (it would offer to hot-reload the mod into your session). Copy the file over
   `mods/types/claude-code.d.ts`.
2. **Diff the drift.** `git diff --stat` and a read of the hunks that touch anything in DESIGN.md
   §2's `calls:` line. Classify the drift: additive (nothing the mod calls changed), changed
   signature, or removed method.
3. **Typecheck and test.** `tsc -p mods`, `claude plugin test mods/council-of-elrond`,
   `claude plugin validate mods/council-of-elrond`.
4. **Re-verify the binary-derived wording.** Search the installed binary for the strings in
   DESIGN.md §6.14 and ROADMAP API fact 13:
   ```sh
   BIN=$(readlink -f "$(command -v claude)")
   grep -a -o "The user doesn't want to [a-z ]*" "$BIN" | sort -u
   grep -a -o "needs approval[^\"]*" "$BIN" | sort -u | head
   ```
   If the wording changed, update `hooks/elrond/operations.ts` (`outcomeOf`) and its tests.
5. **Re-probe what the tests can't.** The behaviours established by live probes (DESIGN.md §1,
   §4): the own-time budget not cutting a hook off, `$.ui.ask` rejecting in `-p`, `$.process.spawn`
   ending on `return()`, `ui_log` lines in stream-json. One headless run per behaviour, in a
   throwaway repo.
6. **Record it.** The version line at the top of DESIGN.md, the drift in one sentence, and any
   changed decision. Mention the version in CHANGELOG.
7. **Pin CI if needed.** `.github/workflows/ci.yml` installs the latest `@anthropic-ai/claude-code`.
   If a newer release breaks the vendored types before you have time to upgrade, pin the version
   there (`npm install -g @anthropic-ai/claude-code@2.1.291`) and open an issue.

## Releasing

Versions are the `version` field in `mods/council-of-elrond/.claude-plugin/plugin.json`. Before
1.0.0, a minor bump may change shipped rules or defaults; a patch bump never does.

1. Move CHANGELOG's "Unreleased" under the new version with the date. Credit security reporters.
2. Bump `version` in `plugin.json`. The marketplace manifest reads it from there.
3. Update the README's status line and the token-cost figures if a stage changed them.
4. Run the three checks, commit, then tag with Claude Code's own tool, which checks that
   `plugin.json` and the marketplace entry agree:
   ```sh
   claude plugin tag mods/council-of-elrond --dry-run
   claude plugin tag mods/council-of-elrond -m "council-of-elrond %s" --push
   ```
   It creates a `council-of-elrond--v0.5.0` tag. A GitHub release with the changelog section as
   its body is enough; nothing is built.
5. Users on the marketplace get it with `claude plugin marketplace update` and
   `claude plugin update`.

**When is it 1.0.0?** When Stage 6 and the final deliverables (ROADMAP) are done, the definition of
done (SPEC §22) is checked off, and the shipped rules have had a few weeks of shadow-mode reports
from real projects without a change.

## Reviewing a pull request

Beyond the template's checklist, read for these:

- **The gate's floor.** Any change to `SHIPPED.rules` block entries, protected paths or the
  classifier's fast allow path is a security change: look for the near miss the test doesn't cover.
- **A new `$` call** in register.ts shows up in `claude plugin validate`'s `calls:` line. Ask why
  it is needed and whether its failure refuses or passes.
- **A new process.** Only Galadriel's table and `gimli.commands` may start one. Anything else is
  a design change for the roadmap.
- **A new reviewer input.** Everything that reaches a model is session content; it must go through
  `untrusted(...)` and redaction, and the limits in the member's `LIMITS`.
- **Text.** New strings in `strings.ts`, plain variant free of theme words.
- **The audit line.** New fields are fine; contents, diffs, output or secrets are not.
- **Decisions.** If the pull request picked between options the spec leaves open, DESIGN.md has
  the decision and the reason.

## Triage

- A command that passed when it should not have is handled privately (SECURITY.md): reproduce
  with `/council test`, fix with a test, release a patch, credit the reporter.
- Over-gating goes through the "Rule gap" template. Fix in the shipped rules if most projects
  would agree; otherwise document the project-rule workaround in the README.
- Requests that touch SPEC §23's non-goals (debate between members, auto-fixing calls, a fourth
  model member) are declined with a link to the spec, unless the maintainer changes the spec.

## Data the mod keeps

The audit log is the only data the mod accumulates. It holds hashes, tiers, rule ids, verdicts
and reasons (redacted), tokens and timings, your decisions, and for a full council each voice and
each check's status. It never holds file contents, diffs, check output or secrets. Three files of
1 MiB by default, rotated, gitignored by a file the mod writes. Users can delete the folder at any
time. If a contributor adds a field, check it against this list.

## Supported hosts

Tested: the terminal (interactive, by the maintainer) and `claude -p` (headless, in the live
checks). Expected to work with no drawing: the desktop app, VS Code and JetBrains panels, the
Agent SDK, cloud sessions, where `$.ui.ask` may or may not be answerable (it rejects where it
can't be shown, which refuses the call). Windows shells are not parsed (POSIX only). Say so in
issues rather than guessing.
