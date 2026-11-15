---
name: upgrade-types
description: Regenerate the vendored Claude Code API types (mods/types/claude-code.d.ts) after a Claude Code update, measure the drift against what the mod calls, re-verify the wording read from the binary, and record it. Use monthly and before a release (ROADMAP decision D10), not whenever `claude --version` differs from the version at the top of DESIGN.md; CI stays on its pin until this skill moves it.
---

# Upgrade the vendored types

- Regenerates the vendored Claude Code API types, measures drift and records it.
- Follow the workflow: `.claude/skills/council-of-elrond-development/references/workflows/upgrade-types.md`
