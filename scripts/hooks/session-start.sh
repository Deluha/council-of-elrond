#!/usr/bin/env bash
# SessionStart hook (wired in .claude/settings.json) for cloud sessions: gets the session ready
# to run the gates. It never fails the session start: any problem prints one line and the script
# still exits 0.
#
#   - runs only when CLAUDE_CODE_REMOTE is "true"; exits at once when COUNCIL_SKIP_SESSION_SETUP=1
#     (set it in any environment where an automated session clones this repository);
#   - installs the Claude Code build CI pins (@anthropic-ai/claude-code@X.Y.Z in
#     .github/workflows/ci.yml) and, when `tsc` is missing, typescript, into a cache folder outside
#     the repository: ${XDG_CACHE_HOME:-$HOME/.cache}/council-of-elrond/claude-<pin>; when a cached
#     binary's --version already equals the pin it installs nothing;
#   - makes COUNCIL_CLAUDE available: appended to $CLAUDE_ENV_FILE when that is set, and always
#     printed once as session context (stdout of a SessionStart hook reaches the model);
#   - sets git config core.hooksPath .githooks when it is unset;
#   - warns once if `claude plugin list` names council-of-elrond: the mod must never be loaded
#     into the session that develops it.
# The install is bounded at 240 s; the settings entry gives the whole hook 300 s.

set -u

[ "${CLAUDE_CODE_REMOTE:-}" = true ] || exit 0
[ "${COUNCIL_SKIP_SESSION_SETUP:-}" = 1 ] && exit 0

say() { printf 'session-start: %s\n' "$*"; }

within() { # within <seconds> <command...>: bounded when `timeout` exists
  local secs=$1
  shift
  if command -v timeout >/dev/null 2>&1; then timeout "$secs" "$@"; else "$@"; fi
}

main() {
  local root ci pin base cache bin have tsdir tsbin ctx
  root=${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}
  ci="$root/.github/workflows/ci.yml"
  [ -f "$ci" ] || { say "no $ci; nothing to set up"; return 0; }

  # The pin: the same read as scripts/pinned-claude.sh.
  pin=$(grep -o '@anthropic-ai/claude-code@[0-9][0-9.]*' "$ci" | head -1 | sed 's/.*@//')
  [ -n "$pin" ] || { say "could not read the pinned Claude Code version from .github/workflows/ci.yml"; return 0; }

  base="${XDG_CACHE_HOME:-${HOME:-/tmp}/.cache}/council-of-elrond"
  cache="$base/claude-$pin"
  bin="$cache/node_modules/.bin/claude"

  have=$("$bin" --version 2>/dev/null | head -1)
  case "$have" in
    "$pin" | "$pin "*) : ;;
    *)
      if ! command -v npm >/dev/null 2>&1; then
        say "npm not found; the pinned Claude Code $pin was not installed (set COUNCIL_CLAUDE yourself)"
        bin=""
      else
        mkdir -p "$cache" 2>/dev/null
        if ! within 240 npm install --prefix "$cache" "@anthropic-ai/claude-code@$pin" --no-audit --no-fund --loglevel=error >/dev/null 2>&1; then
          say "installing @anthropic-ai/claude-code@$pin failed or timed out; install the pinned build by hand and set COUNCIL_CLAUDE"
          bin=""
        else
          have=$("$bin" --version 2>/dev/null | head -1)
          case "$have" in
            "$pin" | "$pin "*) : ;;
            *) say "the install did not give Claude Code $pin (got: ${have:-nothing})"; bin="" ;;
          esac
        fi
      fi
      ;;
  esac

  # typescript, only when tsc is missing from PATH.
  tsbin=""
  if ! command -v tsc >/dev/null 2>&1; then
    tsdir="$base/typescript"
    tsbin="$tsdir/node_modules/.bin"
    if [ ! -x "$tsbin/tsc" ]; then
      if command -v npm >/dev/null 2>&1; then
        mkdir -p "$tsdir" 2>/dev/null
        within 240 npm install --prefix "$tsdir" typescript --no-audit --no-fund --loglevel=error >/dev/null 2>&1 \
          || { say "installing typescript failed or timed out; tsc -p mods will not run"; tsbin=""; }
      else
        tsbin=""
      fi
    fi
  fi

  # Make the binary available to the session.
  ctx=""
  if [ -n "$bin" ]; then
    ctx="COUNCIL_CLAUDE=$bin (Claude Code $pin, the build CI pins; scripts/verify.mjs reads it)"
    if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
      printf 'export COUNCIL_CLAUDE=%q\n' "$bin" >> "$CLAUDE_ENV_FILE" 2>/dev/null
    fi
  fi
  if [ -n "$tsbin" ] && [ -x "$tsbin/tsc" ]; then
    ctx="${ctx:+$ctx; }tsc is at $tsbin (add it to PATH)"
    if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
      printf 'export PATH=%q:"$PATH"\n' "$tsbin" >> "$CLAUDE_ENV_FILE" 2>/dev/null
    fi
  fi
  [ -n "$ctx" ] && say "export $ctx"

  # Git hooks.
  if [ -d "$root/.githooks" ] && git -C "$root" rev-parse --git-dir >/dev/null 2>&1; then
    if [ -z "$(git -C "$root" config --get core.hooksPath 2>/dev/null)" ]; then
      git -C "$root" config core.hooksPath .githooks 2>/dev/null && say "set core.hooksPath to .githooks"
    fi
  fi

  # The mod must never be loaded into the session that develops it.
  if command -v claude >/dev/null 2>&1; then
    if within 20 claude plugin list 2>/dev/null | grep -q 'council-of-elrond'; then
      say "WARNING: the council-of-elrond plugin is installed in this session; it must never be loaded into the session that develops it (R1)"
    fi
  fi
  return 0
}

main "$@" || say "unexpected error (ignored)"
exit 0
