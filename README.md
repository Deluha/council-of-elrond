# council-of-elrond

A [Claude Code](https://code.claude.com/) mod that gates risky tool calls before they run.

Rules sort every tool call into a tier: **allow**, **review**, **ask** or **block**. Calls that
need a second opinion go to a small council of model reviewers, each with its own checklist:
destructive operations, diffs, git, databases. Big operations such as a `git push` convene the
full council and run your project's own tests. Anything uncertain, and anything a reviewer
refuses twice, comes to you. Secrets are scanned for and redacted, every decision is logged, and
the mod never takes part in Claude Code's own permission decision.

> The rules tier is the safety boundary. The model reviewers are a second opinion: they can catch
> what a pattern misses, but they never widen what the rules allow. This is not a sandbox or a
> security product. The limits are stated plainly in the
> [user manual](mods/council-of-elrond/README.md#what-it-does-not-protect-against).

**Status:** Stage 5 of 6 (version 0.4.0). Everything but the theme and its UI is in place, in
plain mode. See [ROADMAP.md](mods/council-of-elrond/ROADMAP.md).

## Quick start

Requires Claude Code 2.1.287 or later.

```sh
git clone https://github.com/Deluha/council-of-elrond
claude --plugin-dir ./council-of-elrond/mods/council-of-elrond
```

In the session: `/council` shows the status, `/council shadow on` makes the reviewers log without
refusing while you tune the rules, `/council test "rm -rf build"` shows how a command would be
classified. To install permanently:

```sh
claude plugin marketplace add Deluha/council-of-elrond
claude plugin install council-of-elrond@council-of-elrond
```

Full instructions, configuration, updating and removal: [docs/INSTALL.md](docs/INSTALL.md).

## Documentation

| For | Read |
| :- | :- |
| Users | [User manual](mods/council-of-elrond/README.md): tiers, reviewers, the full council, rules, models, options, commands, the secrets scan, escalation, the audit log, limits. [Installing and using](docs/INSTALL.md). |
| Contributors | [CONTRIBUTING.md](CONTRIBUTING.md), [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) (layout, conventions, tests, live checks, recipes), [ROADMAP.md](mods/council-of-elrond/ROADMAP.md) (status, next tasks, decisions, API facts). |
| Maintainers | [docs/MAINTENANCE.md](docs/MAINTENANCE.md) (Claude Code updates, releases, review, triage), [docs/GITHUB.md](docs/GITHUB.md) (workflows, hooks, repository settings), [docs/REVIEW-2026-10.md](docs/REVIEW-2026-10.md) (the Stage 5 review: findings and proposed amendments). |
| Design | [DESIGN.md](mods/council-of-elrond/DESIGN.md) (how it works, failure modes, every decision), [SPEC.md](mods/council-of-elrond/SPEC.md) (the original spec). |
| Security | [SECURITY.md](SECURITY.md): what counts as a bypass and how to report one privately. [SUPPORT.md](SUPPORT.md) for everything else. |

## Repository layout

```
mods/council-of-elrond/   the mod: manifest, hooks, tests, user manual, design, roadmap, spec
mods/types/               Claude Code's generated API types for the build it targets (2.1.291)
docs/                     install, development, maintenance guides and reviews
.claude-plugin/           marketplace manifest, so `claude plugin install` works from this repo
.claude/skills/           skills for Claude Code sessions working on this repo
.github/                  CI, release workflow, issue and pull request templates, CODEOWNERS
.githooks/ scripts/       pre-commit and commit-msg hooks, setup and hygiene scripts
```

```sh
claude plugin test mods/council-of-elrond       # run the tests
tsc -p mods                                    # typecheck
claude plugin validate mods/council-of-elrond  # validate the plugin
```

## Contributing

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). A command that
passes the gate when it should not is a security report: please use
[private vulnerability reporting](https://github.com/Deluha/council-of-elrond/security/advisories/new).

## Licence

[MIT](LICENSE).
