# The repository on GitHub

What the files under `.github/`, `.githooks/` and `scripts/` do, and the repository settings that
only the owner can switch on. Work through the settings checklist once; the files take care of the
rest.

## Files

| Path | Does |
| :- | :- |
| `.github/workflows/ci.yml` | On every push to `main` and every pull request: the three gates (`claude plugin test`, `tsc -p mods`, `claude plugin validate --strict`), the marketplace manifest, the "no `tool.check` hook" assertion, and the hygiene script. Needs no secrets: the tests stub everything. |
| `.github/workflows/release.yml` | On a tag `council-of-elrond--vX.Y.Z` (what `claude plugin tag` creates): checks the tag against `plugin.json` and `CHANGELOG.md`, re-runs the gates, publishes a GitHub release with that version's changelog section as the body. |
| `.github/PULL_REQUEST_TEMPLATE.md` | The checklist every pull request carries: gates, tests, docs, decisions, strings, `$` only in register.ts, the safety statement and what was verified live. |
| `.github/ISSUE_TEMPLATE/` | Bug report, rule gap or false positive, feature request, and a config that routes bypasses to private reporting and Claude Code problems upstream. |
| `.github/CODEOWNERS` | Review routing. The parser, classifier, shipped rules, redaction and `register.ts` are marked security-sensitive. |
| `.github/release.yml` | Categories for GitHub's generated release notes, by label. |
| `.github/labels.yml` | The labels the templates and release notes use. Created once with the commands below. |
| `.github/dependabot.yml` | Monthly updates for the actions the workflows use. There are no package dependencies. |
| `.githooks/pre-commit` | Runs the hygiene script on every commit, and the three gates when anything under `hooks/`, `tests/`, `types/` or the manifest is staged. |
| `.githooks/commit-msg` | Summary under 72 characters, imperative, no trailing full stop, blank line after it. |
| `scripts/setup.sh` | One-time contributor setup: tool check, `git config core.hooksPath .githooks`, the gates once. |
| `scripts/check-hygiene.sh` | Shared by the hook and CI: no generated files committed, no plugin-root `CLAUDE.md`, no session links or attribution trailers in files, no local paths or real emails, a warning on any well-formed fake token (the test fixtures build theirs from two halves, so there is none), and every relative markdown link resolves. |
| `.claude-plugin/marketplace.json` | Makes the repository a plugin marketplace, so `claude plugin marketplace add Deluha/council-of-elrond` works. Validated in CI. |
| `SECURITY.md`, `SUPPORT.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md` | Shown by GitHub in the repository's community profile and when someone opens an issue or pull request. |

## Settings checklist (owner)

Repository → Settings. None of this can be committed as a file.

**General**
- Description: "A council of specialist reviewers that gates risky Claude Code tool calls before they run." Website: the docs or the README.
- Topics: `claude-code`, `claude-code-plugin`, `mod`, `safety`, `tool-calls`, `code-review`, `typescript`.
- Features: Issues on; Discussions on if you want questions kept out of the issue tracker (then update `SUPPORT.md`); Wiki and Projects off unless used.
- Pull requests: allow squash merging only, default to the pull request title and description; "always suggest updating pull request branches"; "automatically delete head branches".

**Branches → Rulesets** (or classic branch protection) for `main`:
- Require a pull request before merging; one approval; dismiss stale approvals on new commits; require review from code owners.
- Require status checks to pass: `Test, typecheck, validate` and `Hygiene` (the job names in `ci.yml`); require branches to be up to date.
- Require linear history. Block force pushes. Restrict deletions.
- Optionally require signed commits.

**Tags**: a ruleset on `council-of-elrond--v*` that restricts creation to maintainers, so only a deliberate `claude plugin tag --push` can publish a release.

**Code security and analysis**
- Private vulnerability reporting: **on**. `SECURITY.md`, the issue template config and `SUPPORT.md` all point at it.
- Secret scanning and push protection: on. The test fixtures build their fake tokens from two halves at run time (`FAKE_AWS_KEY`, `FAKE_GITHUB_TOKEN` in `tests/fixtures.ts`), so no committed line holds a well-formed token; keep new fakes to that pattern rather than bypassing a block.
- Dependabot alerts and security updates: on (actions only).
- Code scanning: CodeQL supports TypeScript; optional. The mod has no build, so the default setup works.

**Actions**
- Allow actions: GitHub-owned, plus none others needed (the workflows use `actions/checkout` and `actions/setup-node` only).
- Workflow permissions: read-only by default; `release.yml` asks for `contents: write` itself.
- Approve the first Dependabot pull request manually; after that they run like any other.

**Labels**: create them once (needs the `gh` CLI, signed in):

```sh
python3 - <<'EOF' | sh
import yaml  # pip install pyyaml, or copy the names and colours from .github/labels.yml by hand
for l in yaml.safe_load(open('.github/labels.yml')):
    print(f"gh label create {l['name']!r} --color {l['color']} --description {l['description']!r} --force")
EOF
```

**Environments and secrets**: none. CI needs no API key: `claude plugin test` runs offline and
the tests stub the model.

## Release flow

1. Follow "Releasing" in [MAINTENANCE.md](MAINTENANCE.md): changelog section, version bump, gates,
   commit on `main`.
2. `claude plugin tag mods/council-of-elrond -m "council-of-elrond %s" --push`.
3. `release.yml` publishes the GitHub release. Check it, then announce.
4. Users update with `claude plugin marketplace update council-of-elrond` and
   `claude plugin update council-of-elrond@council-of-elrond`.

## Handling a bypass report

1. The report arrives as a draft security advisory (private). Reproduce it with `/council test`.
2. Fix on a private fork of the advisory, or on a short-lived branch whose commit message and pull
   request say what changed without the triggering input; put the input in a test with a neutral
   name.
3. Release a patch, publish the advisory with credit, add the fix to `CHANGELOG.md` under
   Security.
