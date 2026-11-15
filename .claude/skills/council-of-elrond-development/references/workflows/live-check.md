# Run a headless live check

## Preconditions

The unit tests stand in for the engine. A live check runs the real one. Two rules:

1. **Never load the mod into this session (R1).** Not with `--plugin-dir` on the session you work in,
   not through the plugin-authoring skill's hot-reload folder. It would gate your own tool calls.
2. **Never probe inside this repository, and never load the mod from it.** Use a throwaway
   repository for the probe, so its audit log and rules.json don't land here, and run a copy of
   the mod from a scratch folder outside the repository, so the files loading generates don't
   land here either.

A review-tier probe makes a real model request on the reviewer's model. Keep probes to a handful,
prefer `/council test` (runs nothing, asks no model) for classification questions, and say in the
summary how many reviews ran.

A child run names a small model, a permission mode and a budget (R13). `claude -p` is never on the allow list in `.claude/settings.json`, so it prompts; that is intended.

## Steps

Each block below runs in its own shell call, and a shell call keeps no variables and may start outside the project, so every block after the first re-states its paths from the ones the first block printed, goes to the probe repository, and refuses to continue if a path is empty or the folder is inside this repository.

### Set up: copy the mod, make the probe repository, print the paths

From the repository root. `git archive` copies the last commit; `cp -r` copies the working tree, uncommitted changes included:

```sh
REPO=$(git rev-parse --show-toplevel) || exit 1
SCRATCH=$(mktemp -d)
git -C "$REPO" archive HEAD mods | tar -xf - -C "$SCRATCH"     # or: cp -r "$REPO/mods" "$SCRATCH"/
P=$(mktemp -d)/probe && mkdir -p "$P"
(cd "$P" && git init -q && echo hi > a.txt && mkdir build && echo x > build/out && git add . \
  && git -c user.name=probe -c user.email=probe@example.com commit -qm init)
printf 'REPO=%s\nSCRATCH=%s\nP=%s\n' "$REPO" "$SCRATCH" "$P"
```

`--plugin-dir` points at the copy in `$SCRATCH`, never at the repository's own mod folder. Add a .claude/council-of-elrond/rules.json to the probe if the check needs project rules or `gimli.commands`. In every later block, replace the three quoted placeholders with the three printed paths. A block whose placeholder is left in, or whose path is wrong, stops at its first guard line.

### Run a prompt

```sh
REPO=$(git -C '<REPO printed above>' rev-parse --show-toplevel)
SCRATCH='<SCRATCH printed above>'
P='<P printed above>'
MOD="$SCRATCH/mods/council-of-elrond"
[ -n "$REPO" ] && [ -n "$SCRATCH" ] && [ -n "$P" ] && [ -d "$P/.git" ] && [ -d "$MOD" ] || { echo "refusing: a path is empty or missing"; exit 1; }
cd "$P" || exit 1
case "$(pwd -P)" in "$REPO"|"$REPO"/*) echo "refusing to probe inside the repository"; exit 1;; esac
claude -p --plugin-dir "$MOD" --output-format stream-json --verbose \
  --model <a small model> --permission-mode <a mode> --max-budget-usd <an amount> \
  "Run exactly this shell command and report its result verbatim: rm -r build"
```

The three flags on the last lines are R13: the child run otherwise inherits the session's model, plugins and permission mode.

### Commands

```sh
REPO=$(git -C '<REPO printed above>' rev-parse --show-toplevel)
SCRATCH='<SCRATCH printed above>'
P='<P printed above>'
MOD="$SCRATCH/mods/council-of-elrond"
[ -n "$REPO" ] && [ -n "$SCRATCH" ] && [ -n "$P" ] && [ -d "$P/.git" ] && [ -d "$MOD" ] || { echo "refusing: a path is empty or missing"; exit 1; }
cd "$P" || exit 1
case "$(pwd -P)" in "$REPO"|"$REPO"/*) echo "refusing to probe inside the repository"; exit 1;; esac
claude -p --plugin-dir "$MOD" --output-format stream-json --verbose <the three flags> "/council test \"git push --force origin main\""
claude -p --plugin-dir "$MOD" --output-format stream-json --verbose <the three flags> "/council report"
```

In plain `-p` without stream-json, a command prints nothing: that is by design (command output
never reaches Claude).

### What a headless run does

- A refusal reaches Claude as the tool's error text. A question can't be answered in `-p`, so
  escalations refuse with "nobody can be asked"; that is the path you are testing.
- `/council …` output arrives as `system/ui_log` lines in stream-json; in plain `-p` it prints
  nothing. In `-p` nothing draws, so a start notice is appended for Claude. A `-p` prompt or
  command has origin `sdk`, which is not a person's, so `/council` returns no `context` there and
  `off`, `shadow on`, `model`, `reload` and `trust` (with or without a code) are refused; `untrust` is not,
  since it only tightens, and C4's chat lines are not read: those paths are covered by unit tests only
  (DESIGN §14.3).

## Verification

### Read the output for

Read the output for:

- the tool call's result: a refusal arrives as the tool's error text, as Claude sees it;
- `system/ui_log` lines: where `/council …` output and the mod's transcript lines go;
- the audit line, from a block of its own:

```sh
REPO=$(git -C '<REPO printed above>' rev-parse --show-toplevel)
SCRATCH='<SCRATCH printed above>'
P='<P printed above>'
MOD="$SCRATCH/mods/council-of-elrond"
[ -n "$REPO" ] && [ -n "$SCRATCH" ] && [ -n "$P" ] && [ -d "$P/.git" ] && [ -d "$MOD" ] || { echo "refusing: a path is empty or missing"; exit 1; }
cd "$P" || exit 1
case "$(pwd -P)" in "$REPO"|"$REPO"/*) echo "refusing to probe inside the repository"; exit 1;; esac
cat .claude/council-of-elrond/audit/audit.jsonl
```

What `-p` cannot do: answer a question. Every escalation refuses with "nobody can be asked", which
is itself a path worth checking. The dialog, the pane, the band and the mode label can only be seen
by the maintainer in a terminal; list them as unverified.

### Clean up

```sh
REPO=$(git -C '<REPO printed above>' rev-parse --show-toplevel)
SCRATCH='<SCRATCH printed above>'
P='<P printed above>'
[ -n "$REPO" ] && [ -n "$SCRATCH" ] && [ -n "$P" ] && [ -d "$P/.git" ] && [ -d "$SCRATCH/mods" ] || { echo "refusing: a path is empty or missing"; exit 1; }
PROBES=$(dirname "$P")
case "$(cd "$PROBES" && pwd -P):$(cd "$SCRATCH" && pwd -P)" in
  "$REPO"|"$REPO"/*|*":$REPO"|*":$REPO"/*) echo "refusing to remove anything inside the repository"; exit 1;;
esac
echo "removing $PROBES and $SCRATCH"
rm -rf -- '<P without its trailing /probe>' '<SCRATCH printed above>'
cd "$REPO" && git status --short   # nothing from the probe should show
```

The `rm` takes the two folders as literal paths, the same ones the guard just checked and echoed: Claude Code's own safety check stops an `rm -rf` through a variable and leaves it to a person. A placeholder left in removes nothing.

Loading writes .claude-plugin/types/ and tsconfig.json into the mod folder you pointed
`--plugin-dir` at. That is why it is a copy: they land in the scratch folder, never in the
repository. If `git status` shows anything from the probe, a run used the repository's mod folder:
remove what it wrote and don't commit it.

## Docs to update

In the checkpoint summary and, for anything that establishes an API fact, in DESIGN.md: what you
ran, on which Claude Code version (`claude --version`), and what you saw.

A new host fact goes in `references/host-api-facts.md` and in `mods/council-of-elrond/DESIGN.md`.

## Ask first

- **A headless child run that makes model requests** (`claude -p`): stop and ask the person before it runs; it costs money, and the allow list never allows it.
- **Loading the mod into this session**: never (R1).
- **Scheduled-routine or cloud-environment setup**: stop and ask.
