# Maintaining council-of-elrond

For whoever cuts releases, tracks Claude Code, and keeps the gate honest over time.

## What can rot

The mod sits on three things that move without it:

| Dependency | How it breaks | How you notice |
| :- | :- | :- |
| Claude Code's plugin API (`mods/types/claude-code.d.ts`) | A method changes shape or goes away; a new event the mod should handle appears. | `tsc -p mods` fails after regenerating the types; or behaviour changes with no type change (probe it). |
| Wording read from Claude Code's binary | The permission-prompt refusal text ("The user doesn't want to proceed with this tool use", "…take this action right now") and the automatic denial text ("… needs approval …", "This command requires approval", the deny-rule wording) change. The mod tells a user's refusal from a tool error by that wording. | A user's refusal at the permission prompt stops counting as a failed attempt; `outcome` in the audit log reads `error` where it should read `refused-by-user`. |
| Model aliases | `sonnet`, `opus`, `fable`, `haiku` resolve to the newest model the build knows; token caps, effort and deadlines are set per family in `hooks/elrond/models.ts`. A new family needs a profile; a slower model needs a longer deadline. | `/council model` probe fails; reviews time out. |

## When Claude Code updates

The procedure (compare versions, regenerate the types, measure the drift, re-verify the binary's wording, re-probe, record, move the pin) is a workflow: `.claude/skills/council-of-elrond-development/references/workflows/upgrade-types.md`. Run it monthly and before each release, not at every new build.

## Releasing

The procedure: `.claude/skills/council-of-elrond-development/references/workflows/release.md`. A session never pushes a tag; the maintainer does.

**When is it 1.0.0?** When every condition in ROADMAP M7 holds: among them the eval results
against the thresholds written before they were measured (M2), the support matrix (M5), the canary
and its probe suite on schedule for four weeks, a stated minimum version and a deprecation rule.
The release itself (M1) also needs the maintainer's shortened terminal check. Stage 6 and the final
deliverables are done; the definition of done (SPEC §22) is checked off (DESIGN.md §12.2).

## Reviewing a pull request

Beyond the template's checklist, read for these:

- **The gate's floor.** Any change to `SHIPPED.rules` block entries, protected paths or the
  classifier's fast allow path is a security change: look for the near miss the test doesn't cover.
- **A new `$` call** in register.ts shows up in `claude plugin validate`'s `calls:` line. Ask why
  it is needed and whether its failure refuses or passes.
- **A new process or a new reviewer input.** `.claude/skills/council-of-elrond-development/references/domain-reviewers.md` ("Review points").
- **Text.** New strings in `hooks/strings.ts`, plain variant free of theme words.
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

What the trust record and the audit log hold, and what they never hold: `.claude/skills/council-of-elrond-development/references/domain-state-and-trust.md`.

## Supported hosts

Tested: `claude -p` (headless, in the live checks), and a cloud session (Claude Code on the web)
with the mod installed by the environment's setup script. In the cloud it loads at session start
and enforces (rules, reviews, previews, the audit log) but draws nothing, since the web client is
not a render surface (`$.session.surfaces()` is empty), and every call that would come to the
user is refused as "nobody can be asked" (DESIGN.md §14; the cloud work items C3 to C6 are in docs/history/ROADMAP-v1.md, and the checks still pending are ROADMAP M5.2). Since C2
the model is the channel to the person there: a start notice, four `/council` outputs for a person's
own command and the refusal's details go through it (DESIGN.md §13.5). A
repository's settings do not load plugins there; the setup script or organization managed
settings do (docs/INSTALL.md, "Cloud sessions"). The terminal's interactive screens await the
maintainer's shortened check (ROADMAP M1.4). Expected to work with no drawing: the desktop
app, VS Code and JetBrains panels and the Agent SDK. Where `$.ui.ask` can't be shown it rejects,
which refuses the call; where no surface is attached, as in the cloud, the mod refuses without
trying it (DESIGN.md §14.1 probed it). Windows shells are not parsed (POSIX only). Say so in issues
rather than guessing.
