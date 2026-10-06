#!/usr/bin/env bash
# Repository hygiene checks shared by the pre-commit hook and CI.
#
#   scripts/check-hygiene.sh            check every tracked file
#   scripts/check-hygiene.sh --staged   check only the files staged for commit
#
# Exits 1 and prints every problem found. Needs git, grep and python3 (for the
# link check); no other tools.

set -u
cd "$(git rev-parse --show-toplevel)" || exit 2

mode=all
[ "${1:-}" = "--staged" ] && mode=staged

if [ $mode = staged ]; then
  files=$(git diff --cached --name-only --diff-filter=ACMR)
else
  files=$(git ls-files)
fi
[ -z "$files" ] && exit 0

# report <label>: reads lines from stdin and prints each as a failure. It runs at the
# end of pipelines (a subshell), so failures are counted in a marker file, not a variable.
marker=$(mktemp)
trap 'rm -f "$marker"' EXIT
report() {
  local label=$1 line
  while IFS= read -r line; do echo "hygiene: $label: $line" >&2; echo 1 >> "$marker"; done
  return 0
}

# 1. Generated files the engine writes into the mod folder on load must never be committed.
echo "$files" | grep -E '^mods/council-of-elrond/(\.claude-plugin/types/|tsconfig\.json$)' \
  | report "generated file staged (gitignored; unstage it)"

# 2. A CLAUDE.md at the plugin root is not loaded by Claude Code and fails strict validation.
echo "$files" | grep -x 'mods/council-of-elrond/CLAUDE.md' \
  | report "plugin-root CLAUDE.md is never loaded; put the text in the root CLAUDE.md or a skill"

# 3. Nothing personal or environment-specific in committed text files:
#    session links and attribution trailers, local absolute paths, real-looking emails.
#    This script and the generated types are excluded (they contain the patterns themselves).
text_files=$(echo "$files" | grep -Ev '\.(png|jpg|jpeg|gif|ico|woff2?|zip)$' \
  | grep -Ev '^(mods/types/claude-code\.d\.ts|scripts/check-hygiene\.sh)$')
for f in $text_files; do
  [ -f "$f" ] || continue
  grep -nE 'claude\.ai/code/session_|Claude-Session:|Co-Authored-By:' "$f" 2>/dev/null \
    | sed "s|^|$f:|" | report "session or attribution trailer in a file"
  grep -nE '(^|[^A-Za-z0-9_])/(home|Users)/[A-Za-z0-9._-]+/' "$f" 2>/dev/null \
    | grep -vE '/home/(me|you)/' \
    | sed "s|^|$f:|" | report "local absolute path"
  grep -noE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' "$f" 2>/dev/null \
    | grep -vE '@([a-z0-9.-]+\.)?(example\.(com|org|net)|users\.noreply\.github\.com|anthropic\.com|github\.com)$' \
    | grep -vE '\.(prod|local|test|example|invalid|internal)$' \
    | sed "s|^|$f:|" | report "email address"
done

# 4. Fake secrets in tests must not have a real provider's exact shape (push protection flags them).
#    A warning, not a failure: the existing fixtures are known.
echo "$files" | grep -E '^mods/council-of-elrond/tests/.*\.ts$' | while read -r f; do
  [ -f "$f" ] || continue
  grep -cE '\bghp_[A-Za-z0-9]{36}\b|\bsk-ant-[A-Za-z0-9_-]{80,}|\bxox[bpa]-[0-9]{10,}-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16}' "$f" \
    | grep -vx 0 | sed "s|^|$f: |" | sed 's|$| well-formed fake token(s); may trip secret scanning|' \
    | while read -r line; do echo "hygiene (warning): $line" >&2; done
done

# 5. Relative links in markdown must resolve.
md_files=$(echo "$files" | grep -E '\.md$')
if [ -n "$md_files" ] && command -v python3 >/dev/null; then
  echo "$md_files" | python3 -c '
import os, re, sys
bad = 0
for f in sys.stdin.read().split():
    if not os.path.isfile(f): continue
    text = open(f, encoding="utf-8").read()
    for m in re.finditer(r"\]\(([^)\s]+)\)", text):
        t = m.group(1)
        if t.startswith(("http://", "https://", "mailto:", "#")): continue
        path = t.split("#")[0]
        if path and not os.path.exists(os.path.normpath(os.path.join(os.path.dirname(f), path))):
            print(f"hygiene: broken link in {f}: {t}", file=sys.stderr); bad = 1
sys.exit(bad)
' || echo 1 >> "$marker"
fi

[ -s "$marker" ] && exit 1
exit 0
