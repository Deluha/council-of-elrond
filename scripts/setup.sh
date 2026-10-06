#!/usr/bin/env bash
# One-time contributor setup: checks the tools, installs the git hooks, runs the gates once.
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2

ok=1
need() {
  if command -v "$1" >/dev/null; then
    printf '  %-8s %s\n' "$1" "$($1 --version 2>/dev/null | head -1)"
  else
    printf '  %-8s MISSING: %s\n' "$1" "$2"; ok=0
  fi
}
echo "Tools"
need claude "install Claude Code 2.1.287 or later (https://code.claude.com/docs/en/setup)"
need tsc    "npm install -g typescript"
need git    "install git"
need python3 "needed only for the markdown link check"
[ $ok = 1 ] || { echo "Install the missing tools, then run scripts/setup.sh again."; exit 1; }

echo "Git hooks"
chmod +x .githooks/* scripts/*.sh
git config core.hooksPath .githooks
echo "  core.hooksPath = .githooks (pre-commit runs the gates; commit-msg checks the summary)"

echo "Gates"
claude plugin test mods/council-of-elrond && tsc -p mods && claude plugin validate --strict mods/council-of-elrond \
  && echo "All gates pass. Read docs/DEVELOPMENT.md next." \
  || { echo "A gate failed on a clean checkout; see CONTRIBUTING.md and docs/MAINTENANCE.md (Claude Code version drift)."; exit 1; }
