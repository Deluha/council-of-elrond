# Contributing

Thanks for helping. This file covers how to set up, how we work, and what a pull request needs.
The user manual is [`mods/council-of-elrond/README.md`](mods/council-of-elrond/README.md); the
developer guide is [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## Before you start

- **Bypasses are security reports.** If you found a command that the rules tier classifies as
  `allow` when it should not, or a way past a block rule or a protected path, please follow
  [SECURITY.md](SECURITY.md) instead of opening a public issue.
- **Check the roadmap.** [`mods/council-of-elrond/ROADMAP.md`](mods/council-of-elrond/ROADMAP.md)
  lists what is planned and the decisions already taken. Open an issue before starting work that
  changes behaviour, so the design can be agreed first.
- **Small and focused.** One change per pull request. Documentation fixes are welcome on their own.

## Setup

You need the Claude Code build CI pins (see `.github/workflows/ci-tests.yml`; the setup script and the
pre-commit hook check it, and [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md#the-pinned-build) says how
to install it) and a TypeScript compiler (`npm install -g typescript`, or use `npx tsc`). There are no runtime
dependencies and no `node_modules`.

```sh
git clone https://github.com/Deluha/council-of-elrond
cd council-of-elrond
scripts/setup.sh                               # checks the tools, installs the git hooks, runs the gates once
```


The checks, the pinned build, the pre-commit hook and the headless live checks are in the development skill: `.claude/skills/council-of-elrond-development/references/qa-and-ci.md` and `.claude/skills/council-of-elrond-development/references/workflows/live-check.md`. Run `node scripts/verify.mjs` before every commit. Never load the mod into the Claude Code session you develop it in (R1, `.claude/skills/council-of-elrond-development/references/conventions.md`).

## How the code is organised

The layout, the conventions and the reasons behind them are in `.claude/skills/council-of-elrond-development/references/architecture.md`, `.claude/skills/council-of-elrond-development/references/style.md` and the hard rules R1 to R5 in `.claude/skills/council-of-elrond-development/references/conventions.md`.

## Tests

How tests are written, and the mutation check for safety paths: `.claude/skills/council-of-elrond-development/references/testing.md` (R7).

## Pull requests

1. Branch from `main`. Keep the pull request to one topic.
2. Run `node scripts/verify.mjs`. Paste the `hooks:` and `calls:` lines from
   `claude plugin validate` into `DESIGN.md` §2 if they changed.
3. If you took a decision the spec or the roadmap does not cover, add it to `DESIGN.md`, in the
   section for the current milestone or hardening pass, and mention it in the pull request.
4. Update the user manual for any user-visible change, and `CHANGELOG.md` under "Unreleased".
5. Fill in the pull request template. Say what you verified live, if anything, and what you did
   not. Label it (`rules`, `reviewers`, `pipeline`, `ui`, `docs`, `bug`, `ci`); the labels feed the
   release notes.
6. A change to the security-sensitive files, the safety-boundary block of `.github/CODEOWNERS`, needs the code owner's review. If it fixes a bypass, keep the triggering input out of the title and description (R11).

## Commit messages

An imperative summary line under 72 characters, then why the change was made; the `commit-msg` hook checks the summary. The full form is in `.claude/skills/council-of-elrond-development/references/style.md#commit-messages`. Nothing in a message may quote a bypass input (R11, `.claude/skills/council-of-elrond-development/references/conventions.md`).

## Writing style for docs

`.claude/skills/council-of-elrond-development/references/style.md`.

## Licence

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
