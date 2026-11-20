# Changelog

## 1.0.0

A rewrite. The mod is now three source files and one test file.

- Rules are plain patterns in one table (`hooks/rules.ts`); the shell parser is gone, and the README says plainly what that means.
- One reviewer per gated call: Gandalf, Aragorn, Gimli or Legolas, by the rule that matched. Gollum scans for secrets without a model.
- The loot roll (Need, Greed, Pass), wipes with a raid lockout, Leeroy mode, and loot on a commit.
- `/council`, `/council test`, `/council allow`, `/council leeroy`.
- Four options: the reviewer model, shadow mode, and one extra pattern each for the council and for blocking.
- Removed: per-project rules files and their trust model, the audit log on disk, the full council and project checks, read-only previews, plain mode, the development skills, agents and scripts.
- The mod is the repository root, so it installs with `/plugin install council-of-elrond --marketplace Deluha/council-of-elrond`.

Everything before this is in the git history, up to commit `9420d47`.
