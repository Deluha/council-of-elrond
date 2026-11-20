#!/usr/bin/env bash
# One-time contributor setup: checks the tools, installs the git hooks, runs the gates once.
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2
# shellcheck source=scripts/pinned-claude.sh
. scripts/pinned-claude.sh

ok=1
need() {
  if command -v "$1" >/dev/null; then
    printf '  %-8s %s\n' "$1" "$($1 --version 2>/dev/null | head -1)"
  else
    printf '  %-8s MISSING: %s\n' "$1" "$2"; ok=0
  fi
}
echo "Tools"
need "${COUNCIL_CLAUDE:-claude}" "install the Claude Code build CI pins (see .github/workflows/ci-tests.yml; https://code.claude.com/docs/en/setup)"
need tsc    "npm install -g typescript"
need git    "install git"
# Optional: only the markdown link check of scripts/check-hygiene.sh uses it.
command -v python3 >/dev/null && printf '  %-8s %s\n' python3 "$(python3 --version 2>/dev/null | head -1)" \
  || printf '  %-8s not found (optional: the markdown link check is skipped without it)\n' python3
[ $ok = 1 ] || { echo "Install the missing tools, then run scripts/setup.sh again."; exit 1; }

echo "Git hooks"
chmod +x .githooks/* scripts/*.sh
git config core.hooksPath .githooks
echo "  core.hooksPath = .githooks (pre-commit runs the gates; commit-msg checks the summary; pre-push runs the script tests)"

echo "Gates"
# On another build the gates fail for reasons that are not yours: stop before running them.
if ! check_pinned_claude && [ "${COUNCIL_ALLOW_UNPINNED:-}" != 1 ]; then
  echo "The gates were not run. Follow one of the two ways above, then run scripts/setup.sh again."
  exit 1
fi
claude="${COUNCIL_CLAUDE:-claude}"
"$claude" plugin test mods/council-of-elrond && tsc -p mods && "$claude" plugin validate --strict mods/council-of-elrond \
  && echo "All gates pass. Read docs/DEVELOPMENT.md next." \
  || { echo "A gate failed on a clean checkout; see CONTRIBUTING.md and docs/MAINTENANCE.md (Claude Code version drift)."; exit 1; }
