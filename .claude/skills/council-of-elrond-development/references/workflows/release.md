# Cut a release

## Preconditions

Versions are the `version` field in `mods/council-of-elrond/.claude-plugin/plugin.json`. Before
1.0.0, a minor bump may change shipped rules or defaults; a patch bump never does.

The maintainer cuts a release. A session prepares it only when the brief says so; it never pushes a tag (MA4).

## Steps

1. Bump `version` in `mods/council-of-elrond/.claude-plugin/plugin.json`. The marketplace manifest reads it from there.
2. Run `docs/TERMINAL-CHECK.md` on the build to be released, in a terminal, and put
   its record in the release notes (ROADMAP maintainer action MA3).
3. Run the three checks, commit, then tag with Claude Code's own tool, which checks that
   `mods/council-of-elrond/.claude-plugin/plugin.json` and the marketplace entry agree:
   ```sh
   claude plugin tag mods/council-of-elrond --dry-run
   claude plugin tag mods/council-of-elrond -m "council-of-elrond %s" --push
   ```
   It creates a `council-of-elrond--v0.6.0` tag. Pushing it runs `.github/workflows/release.yml`,
   which checks the tag against `mods/council-of-elrond/.claude-plugin/plugin.json` and `CHANGELOG.md`, re-runs the gates and publishes
   the GitHub release with that version's changelog section as its body. Nothing is built.

## Verification

Run `node scripts/verify.mjs` (`/verify-change`) on the pinned build (`references/qa-ci.md`) and read its table. The tag command checks that the plugin manifest and the marketplace entry agree; run it with `--dry-run` first. The release workflow checks the tag against the manifest and `CHANGELOG.md`, re-runs the gates and publishes.

## Docs to update

Move CHANGELOG's "Unreleased" under the new version with the date. Credit security reporters.
Update the README's status line and the token-cost figures if a milestone changed them.
Users on the marketplace get it with `claude plugin marketplace update` and
`claude plugin update`.

## Ask first

- **A version bump, a release heading in `CHANGELOG.md`, a tag**: stop and ask.
- **`.claude-plugin/marketplace.json` and `mods/council-of-elrond/.claude-plugin/plugin.json`**: path-gated, the edit prompts.
- **Pushing the tag** (`--push`): the maintainer, never a session.
