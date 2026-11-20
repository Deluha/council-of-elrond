# Developing council-of-elrond

For contributors and for Claude Code sessions that work on the mod. The guidance is one skill, `.claude/skills/council-of-elrond-development/`: its `SKILL.md` is a routing table, and each file under its `references/` holds one topic, so that every fact lives in one file. Read `CONTRIBUTING.md` for setup and pull requests, `mods/council-of-elrond/ROADMAP.md` for what is next and the decisions already taken, and `mods/council-of-elrond/DESIGN.md` for how the mod works and why.

## Where to look

| To know | Read |
| :- | :- |
| The hard rules, in full | `.claude/skills/council-of-elrond-development/references/conventions.md` |
| Code, test and document style; commit messages | `.claude/skills/council-of-elrond-development/references/style.md` |
| The layout; how `hooks/register.ts` is built | `.claude/skills/council-of-elrond-development/references/architecture.md` |
| What the host API does that its types do not say | `.claude/skills/council-of-elrond-development/references/host-api-facts.md` |
| How tests are written; the mutation check | `.claude/skills/council-of-elrond-development/references/testing.md` |
| The verify command, CI, the pinned build | `.claude/skills/council-of-elrond-development/references/qa-and-ci.md` |
| How a session runs a brief | `.claude/skills/council-of-elrond-development/references/session-protocol.md` |
| One task, step by step (rule, parser, reviewer, command, pipeline, redaction, trust, types, live check, checkpoint, release) | `.claude/skills/council-of-elrond-development/references/workflows/` |

## The pinned build

The gates run on the Claude Code build CI pins, not on the one on your PATH. How to get it, and what `COUNCIL_CLAUDE` and `COUNCIL_ALLOW_UNPINNED` do: `.claude/skills/council-of-elrond-development/references/qa-and-ci.md`, section "The pinned build".

## Live checks

A live check runs the real engine, headless, in a throwaway repository and a copy of the mod, and never loads the mod into the session developing it. The procedure: `.claude/skills/council-of-elrond-development/references/workflows/live-check.md`.

## Add a member

A new reviewer, step by step: `.claude/skills/council-of-elrond-development/references/workflows/change-reviewer.md`.
