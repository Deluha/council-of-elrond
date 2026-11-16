# The guidance machinery

The permission rules of the developing session, the two Claude Code hooks, and the checker that keeps the guidance in step with the repository. The verify command and CI are in `references/qa-ci.md`.

## The ask rules and the two hooks

- **The `ask` and `deny` rules in `.claude/settings.json` are Claude Code permission rules on the developing session.** They are not the mod, which is never loaded there (R1). Probed on 2.1.322: an `ask` rule on a path prompts for the Edit and Write tools, but a shell write (`sed -i`, `cp`) to that path is not prompted, so every ask-first item has a second gate: a workflow step, the verify report and the reviewer. A `deny` rule on a path refuses the Edit tool, and a shell `cp` onto the path was refused too; other ways of writing it were not probed. The allow list holds exact commands (a prefix only for `node scripts/verify.mjs` and `node scripts/check-guidance.mjs`, which reject or only read their arguments) and never `claude -p`, so a headless child run prompts (R13).
- **The post-edit hook**, `scripts/hooks/lint-edited.mjs`, runs after every Edit or Write and checks syntax, the `.editorconfig` rules and a single-file typecheck, reported as context; it never fails the edit. The whole-project typecheck stays in the verify command.
- **The session-start hook**, `scripts/hooks/session-start.sh`, runs only in cloud sessions. It installs the pinned build into a cache folder outside the repository (and `typescript` if `tsc` is missing), exports `COUNCIL_CLAUDE` as soon as the pinned build is found or installed (before the optional `typescript` install), sets `core.hooksPath` to `.githooks` when it is unset, warns if `claude plugin list` names `council-of-elrond` (R1), and never fails the session start. Its steps are bounded at 200 s (pinned install), 60 s (`typescript`) and 10 s (plugin list), inside the hook's 300 s. `COUNCIL_SKIP_SESSION_SETUP=1` turns it off (set it where an unattended session clones this repository).

## The guidance checker

`node scripts/check-guidance.mjs` runs in the verify command, in pre-commit (through it) and in CI's `hygiene` job. It checks that:

- a backticked path in a guidance file resolves from the repository root, else from `mods/council-of-elrond/`, else from the skill folder or its `references/`, and an anchor after a path matches a heading of that file;
- `CLAUDE.md` is within its line and byte budget, and no file under `references/` is over 10 KB;
- the routing table has one row for every reference file and names only existing files;
- each rule id is defined once, in `references/conventions.md`, and every id used elsewhere exists;
- rule files and command skills only point;
- model tier names appear only in agent frontmatter and the one table of `references/recipes-orchestration.md`;
- the ask paths in `.claude/settings.json`, the ask-first list in `CLAUDE.md` and the safety-boundary block of `.github/CODEOWNERS` agree;
- pointers to `.claude/` and `scripts/` in `CONTRIBUTING.md`, `docs/DEVELOPMENT.md`, `docs/MAINTENANCE.md` and `docs/GITHUB.md` resolve (their other prose is not read); a token that starts with `./scripts/` or `./.claude/` counts, and so does the first argument of a backticked `node`, `bash` or `sh` command, in every file read; a backticked `/name` of a command skill (any folder under `.claude/skills/` except the development skill) has its `SKILL.md`; no code fence is unclosed;
- the wiring is written: CI has `run:` steps for the checker and for `node --test scripts/tests/` (a comment, a step name, or a step or job with `if: false` or `continue-on-error: true` does not count); pre-commit has a line that is exactly `node scripts/verify.mjs --staged`, optionally with a comment, that is `exec node ...`, or the last live line, or after a live `set -e`, and does not follow a line ending in a backslash (an `echo`, or a tail such as `|| true` or `; exit 0`, does not count); verify runs the checker (an import or a comment line does not). It does not prove the line is reachable: dead code and here-documents are not read (the header of `scripts/check-guidance.mjs` lists the limits).
