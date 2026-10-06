---
name: live-check
description: Run the mod headless against the real Claude Code engine in a throwaway repository, without ever loading it into the current session. Use to verify a behaviour the unit tests only simulate (a refusal's wording, a /council command's output, an audit line, a preview).
---

# Headless live check

The unit tests stand in for the engine. A live check runs the real one. Two rules:

1. **Never load the mod into this session.** Not with `--plugin-dir` on the session you work in,
   not through the plugin-authoring skill's hot-reload folder. It would gate your own tool calls.
2. **Never probe inside this repository.** Use a throwaway folder, so the probe's audit log and
   `rules.json` don't land here.

## Set up a probe repository

```sh
P=$(mktemp -d)/probe && mkdir -p "$P" && cd "$P"
git init -q && echo hi > a.txt && mkdir build && echo x > build/out && git add . && git commit -qm init
```

Add a `.claude/council-of-elrond/rules.json` there if the check needs project rules or
`gimli.commands`.

## Run a prompt

```sh
MOD=/absolute/path/to/council-of-elrond/mods/council-of-elrond
claude -p --plugin-dir "$MOD" --output-format stream-json --verbose \
  "Run exactly this shell command and report its result verbatim: rm -r build"
```

Read the output for:

- the tool call's result: a refusal arrives as the tool's error text, as Claude sees it;
- `system/ui_log` lines: where `/council …` output and the mod's transcript lines go;
- the audit line: `cat .claude/council-of-elrond/audit/audit.jsonl` in the probe repo.

What `-p` cannot do: answer a question. Every escalation refuses with "nobody can be asked", which
is itself a path worth checking. The dialog, the pane, the band and the mode label can only be seen
by the maintainer in a terminal; list them as unverified.

## Commands

```sh
claude -p --plugin-dir "$MOD" --output-format stream-json --verbose "/council test \"git push --force origin main\""
claude -p --plugin-dir "$MOD" --output-format stream-json --verbose "/council report"
```

In plain `-p` without stream-json, a command prints nothing: that is by design (command output
never reaches Claude).

## Model calls cost tokens

A review-tier probe makes a real model request on the reviewer's model. Keep probes to a handful,
prefer `/council test` (runs nothing, asks no model) for classification questions, and say in the
summary how many reviews ran.

## Clean up

```sh
rm -rf "$(dirname "$P")"
cd /path/to/council-of-elrond && git status --short   # nothing from the probe should show
```

Loading writes `.claude-plugin/types/` and `tsconfig.json` into the mod folder; both are
gitignored. If `git status` shows them, the ignore file is broken: fix that, don't commit them.

## Record it

In the checkpoint summary and, for anything that establishes an API fact, in DESIGN.md: what you
ran, on which Claude Code version (`claude --version`), and what you saw.
