# Sourced by scripts/setup.sh and .githooks/pre-commit, from the repository root. Not run on its own.
# The three gates run on the Claude Code build CI pins (docs/DEVELOPMENT.md, "The pinned build").

# The version in the install step of the CI workflow: @anthropic-ai/claude-code@X.Y.Z.
pinned_version() {
  grep -o '@anthropic-ai/claude-code@[0-9][0-9.]*' .github/workflows/ci-tests.yml | head -1 | sed 's/.*@//'
}

# Sets CLAUDE_BIN (COUNCIL_CLAUDE, else claude) and PINNED. Returns 0 when that binary is the
# pinned build; otherwise prints why and the two ways forward, and returns 1.
check_pinned_claude() {
  CLAUDE_BIN=${COUNCIL_CLAUDE:-claude}
  PINNED=$(pinned_version)
  if [ -z "$PINNED" ]; then
    echo "Could not read the pinned Claude Code version from .github/workflows/ci-tests.yml."
    return 1
  fi
  have=$("$CLAUDE_BIN" --version 2>/dev/null | head -1)
  case "$have" in
    "$PINNED" | "$PINNED "*) return 0 ;;
  esac
  echo "The gates run on the Claude Code build CI pins: $PINNED."
  echo "  $CLAUDE_BIN reports: ${have:-nothing (not found, or it failed to run)}"
  echo "Ways forward:"
  echo "  1. Install the pinned build in a scratch folder and point COUNCIL_CLAUDE at it:"
  echo "       npm install --prefix <folder> @anthropic-ai/claude-code@$PINNED"
  echo "       export COUNCIL_CLAUDE=<folder>/node_modules/.bin/claude"
  echo "  2. For a deliberate upgrade brief only (/upgrade-types), set COUNCIL_ALLOW_UNPINNED=1."
  echo "See docs/DEVELOPMENT.md, \"The pinned build\"."
  return 1
}
