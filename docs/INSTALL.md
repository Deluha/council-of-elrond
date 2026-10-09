# Installing and using council-of-elrond

This is the operator's guide: getting the mod loaded, keeping it loaded, configuring it, reading
what it writes, and removing it. What the mod does once loaded (tiers, reviewers, commands,
options) is in the [user manual](../mods/council-of-elrond/README.md).

## Requirements

- Claude Code **2.1.287 or later**. The mod was built on 2.1.289 and checked on 2.1.294; see the
  top of [DESIGN.md](../mods/council-of-elrond/DESIGN.md) for the version it currently targets.
  Mods ("function hooks") are on by default; nothing has to be enabled.
- `git` on the PATH, for the read-only previews. Without it, previews are left out and nothing
  else changes.
- Model access for the reviewers. They use your Claude Code account through the plugin API; no
  separate key.
- **A POSIX system** (Linux, macOS, WSL). Windows is unsupported: the shell parser reads POSIX
  shells only, paths are resolved against `HOME`, and PowerShell is not parsed.

## Try it for one session

```sh
git clone https://github.com/Deluha/council-of-elrond
claude --plugin-dir ./council-of-elrond/mods/council-of-elrond
```

Then, in the session, `/council` prints the status, and `/plugin` lists the mod. Start with
shadow mode on (`/council shadow on`): reviewers log their verdicts but never refuse, so you can
read `/council report` after a few days and tune the rules before enforcing.

## Install it permanently

### From this repository as a marketplace

The repository declares itself as a plugin marketplace
(`.claude-plugin/marketplace.json`), so Claude Code can install from it directly:

```sh
claude plugin marketplace add Deluha/council-of-elrond
claude plugin install council-of-elrond@council-of-elrond
```

Updates:

```sh
claude plugin marketplace update council-of-elrond
claude plugin update council-of-elrond@council-of-elrond
```

Installed plugins live under `~/.claude/plugins/`. Use `--scope project` on `marketplace add` to record the marketplace in the project's settings instead of your user settings. That turns the mod on for the team but does not download it: each collaborator runs `claude plugin install council-of-elrond@council-of-elrond --scope project` once, and Claude Code asks them to trust the folder before it applies the project's marketplace.

### From a local checkout

Where no flag can be given (the desktop app, an SDK host), or when you want a checkout you edit:

```sh
git clone https://github.com/Deluha/council-of-elrond ~/src/council-of-elrond
export CLAUDE_CODE_PLUGIN_DIRS="$HOME/src/council-of-elrond/mods/council-of-elrond"
```

Put the export in your shell profile, or in `~/.claude/settings.json` under `env`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/home/you/src/council-of-elrond/mods/council-of-elrond" } }
```

Several paths are separated with `:` (`;` on Windows). Loading from a folder writes two generated,
gitignored files into it (`.claude-plugin/types/` and `tsconfig.json`); that is expected.

## Cloud sessions

A repository's `.claude/settings.json` does not load plugins in a cloud session. Anthropic's documentation says `enabledPlugins` and `extraKnownMarketplaces` in a repository are not applied there, and neither are plugins from your user settings. What the documentation offers for the cloud:

- **Organization server-managed settings** (Owner role: Organization settings, Claude Code, Managed settings). Put the same entries there; they apply to every user in the organization:

  ```json
  {
    "extraKnownMarketplaces": {
      "council-of-elrond": {
        "source": { "source": "github", "repo": "Deluha/council-of-elrond" }
      }
    },
    "enabledPlugins": { "council-of-elrond@council-of-elrond": true }
  }
  ```

- **A setup script or a `SessionStart` hook** that runs `claude plugin marketplace add Deluha/council-of-elrond` and `claude plugin install council-of-elrond@council-of-elrond --scope project`. This is not confirmed: the documentation does not say whether the plugin then loads in the same session or needs a restart. A session can fetch only the repositories attached to it, so attach `Deluha/council-of-elrond` to the session if the clone is refused. A `SessionStart` hook does not run in a multi-repository session.

Nothing is drawn in a cloud session, and where nobody can be asked the mod refuses the call. The mod has not been run in a cloud session yet (see [MAINTENANCE.md](MAINTENANCE.md#supported-hosts)). If you try it, report what happened in an issue.

## Check it loaded

- `/plugin` shows the mod in the mods line.
- `/council` prints the status pane (or dim transcript lines where no pane draws).
- `claude plugin validate <folder>` lists the hooks it registers and the API calls it makes.

If none of that happens, see [Troubleshooting](#troubleshooting).

## First configuration

Everything has a shipped default. The two places to change things:

1. **`/config`** for simple options: each reviewer on or off and its model, the full council, the
   project checks, shadow mode, the secrets scan, the preview, line limits, the review deadline,
   the token budget, the audit log path and size. Listed in the manual under
   [Options](../mods/council-of-elrond/README.md#options-config).
2. **`.claude/council-of-elrond/rules.json`** in the project, for structured things: your own
   rules, disabled shipped rules, protected paths and branches, production patterns, big
   operations, the project checks (`gimli.commands`), secrets patterns and the allowlist, and
   per-reviewer models by full ID. Examples in the manual under
   [Editing rules](../mods/council-of-elrond/README.md#editing-rules). Reload with
   `/council reload` after editing by hand.

Recommended first week:

- Turn **shadow mode** on (in `/config`, or `/council shadow on` per session).
- Add your **project checks** (`gimli.commands`) so a push or migration runs your tests.
- After a few days read **`/council report`**: the "stopped, then allowed by you" list is your
  false-positive candidates; add allow rules for them (or accept the offer the mod makes after an
  "allow once").
- Turn shadow mode off.

## What it writes, and where

| Path | What | Keep out of git? |
| :- | :- | :- |
| `.claude/council-of-elrond/rules.json` | Your project overrides. Written by the mod only when you confirm an allow rule or an allowlist entry. | Commit it: it is the team's policy. The allowlist holds fingerprints, never secrets. |
| `.claude/council-of-elrond/audit/audit.jsonl` (`.1`, `.2`) | One line per gated call: hashes, tiers, verdicts, tokens, timings. No file contents, diffs or secrets. 1 MiB each by default, three kept. | The mod writes a `.gitignore` beside it. |
| `~/.claude/settings.json` | Your `/config` choices, under the plugin's keys. | Personal. |

Delete the audit folder whenever you like; the mod recreates it. A `.gitignore` in the folder
keeps it out of your repository.

## Cost

Allowed calls cost nothing: no model call, no I/O beyond a path check. A single review is
roughly 1,000 tokens on the reviewer's model (Sonnet by default for destructive operations and
diffs, Opus for git and databases). A full council costs one review per seat on Opus, typically
three for a push. A session token budget (1,500,000 by default) stops reviews and sends gated calls
to you instead when spent. Details in the manual under
[Expected token cost](../mods/council-of-elrond/README.md#expected-token-cost).

## Updating

- Marketplace install: `claude plugin marketplace update council-of-elrond` then
  `claude plugin update council-of-elrond@council-of-elrond`.
- Local checkout: `git pull`. A running session picks the change up on `/reload-plugins`.

Read [CHANGELOG.md](../CHANGELOG.md) before updating across a minor version: before 1.0.0 a minor
bump may change shipped rules or defaults. Your `rules.json` carries a `schemaVersion`; a version
the mod doesn't know is treated as a broken file (ignored whole, shipped rules enforce, errors
listed in the transcript), never as a reason to drop the gate.

## Removing it

- One session: start Claude Code without the flag.
- Marketplace install: `claude plugin disable council-of-elrond@council-of-elrond` to keep it but
  stop it loading, or `claude plugin uninstall council-of-elrond@council-of-elrond`.
- Local checkout: remove the path from `CLAUDE_CODE_PLUGIN_DIRS`.

Then, if you want a clean project: delete `.claude/council-of-elrond/` (overrides and the audit
log) and the plugin's keys from `~/.claude/settings.json`. Nothing else is written.

## Troubleshooting

**Nothing is gated, `/council` is unknown.** The mod didn't load. Check `claude --version`
(2.1.287+), that the path points at the folder holding `.claude-plugin/plugin.json`, and run
`claude plugin validate <folder>`. `--safe-mode`, `--bare` and `disableAllHooks` in settings turn
every hook off.

**Every gated call comes to you with "its reviewer is switched off" or "budget spent".** A
reviewer and Gandalf are both off in `/config`, or the session token budget is spent. `/council`
shows which.

**A review timed out, and the call came to you.** The model's deadline (Sonnet 30 s, Opus 45 s) ran
out. That is the fail-closed path working. Raise "Review deadline" in `/config`, or pick a faster
model with `/council model <member> sonnet`.

**The rules file is ignored.** The transcript lists the errors by field; `/council rules` shows what
is in force. Fix the file and `/council reload`. Common causes: a missing `schemaVersion: 1`, a rule
without an `id`, a regex with the `g` or `y` flag.

**`/council` prints nothing in `claude -p`.** By design: command output never reaches Claude, and
there is no pane in headless mode. Use `--output-format stream-json --verbose`; the lines arrive as
`system/ui_log` messages.

**Claude keeps retrying a refused command.** After three failed attempts on one operation (five on
one kind) the mod locks it out and tells Claude to stop and ask you. Everything resets on your next
prompt.

**The mod gates its own developer.** If you are working on the mod itself, never load it into that
session. See [DEVELOPMENT.md](DEVELOPMENT.md).

For anything else, open an issue with the template; for a command that passed when it should not
have, use [SECURITY.md](../SECURITY.md).
