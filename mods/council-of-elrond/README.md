# council-of-elrond

A Claude Code mod that gates risky tool calls before they run. Rules sort every call into a tier.
Calls that need a second opinion go to a model reviewer, and anything uncertain comes to you.

> **The rules tier is the safety boundary.** The model reviewers are a second opinion: they can
> catch what a pattern misses, but they never widen what the rules allow. This is not a sandbox or a
> security product (see [What it does not protect against](#what-it-does-not-protect-against)).

Status: **Stage 1 of 6.** Available now: the rules, the destructive-operations reviewer, escalation
to you, fail-closed handling and the audit log, all in plain mode. Commands, the secrets scanner,
previews, rounds, shadow mode, the other reviewers and the theme follow in later stages
([DESIGN.md](./DESIGN.md)).

## Loading it

Requires Claude Code 2.1.287 or later (mods are on by default).

- **One session:** `claude --plugin-dir ./mods/council-of-elrond`
- **Where no flag can be given** (desktop app, SDK host): set `CLAUDE_CODE_PLUGIN_DIRS` to the folder's absolute path in the environment or in `~/.claude/settings.json` under `env`.

Check it loaded: `/plugin` shows the mods line, and `claude plugin validate ./mods/council-of-elrond`
lists its hooks.

## Tiers

| Tier | What happens |
| :- | :- |
| allow | Passes untouched, with no model call. Anything no rule matches is allowed. |
| review | A model reviewer gives a verdict: approve runs it, revise or block refuses it. |
| ask | Comes straight to you. |
| block | Refused, with the rule's reason. No model call, no question. |

Compound commands (`&&`, `;`, `|`, `$(...)`, backticks, subshells, `sh -c '...'`, `eval`, and
heredocs fed to a shell) are split, and the strictest part decides.

Shipped defaults:

- **Block:**
  - a recursive delete of `/`, your home directory, the project root, or anything outside the project;
  - a force push or delete of a protected branch;
  - DROP or TRUNCATE against a production-looking target;
  - raw disk writes.
- **Ask:**
  - `sudo`, `doas`, `su`;
  - anything touching a protected path: `.env*`, CI config, migrations folders, `.git/`, `.claude/council-of-elrond/`, `.claude/settings*.json`.
- **Review:**
  - file writes and edits;
  - deletes, moves, in-place edits, writes through a redirect;
  - git operations that change a remote or history, or discard work;
  - database clients and migrations;
  - infrastructure changes, network writes, publishing;
  - running scripts or inline code;
  - Bash with the sandbox disabled;
  - MCP tools whose names say they change something.

**Approve never pre-approves.** An approved call still goes through Claude Code's normal permission
check and prompt. The mod never takes part in the permission decision.

## Editing rules

Put project overrides in `.claude/council-of-elrond/rules.json`:

```json
{
  "schemaVersion": 1,
  "rules": [
    {
      "id": "allow-clean-build",
      "tier": "allow",
      "tools": ["Bash"],
      "command": "^rm -rf (build|dist)$",
      "reason": "Build output is disposable here."
    },
    {
      "id": "no-terraform-destroy",
      "tier": "block",
      "tools": ["Bash"],
      "command": "^terraform destroy",
      "reason": "Infrastructure is torn down by CI only."
    },
    {
      "id": "review-mcp-db",
      "tier": "review",
      "tools": ["mcp__db__*"],
      "reason": "Database MCP calls."
    }
  ],
  "disableRules": ["shell-move"],
  "protectedPaths": ["secrets/**"],
  "protectedBranches": ["staging"],
  "productionPatterns": ["\\bprd-"],
  "models": { "gandalf": "opus" }
}
```

**Rule fields:**
- `tools`: exact names, globs (`mcp__*`) or `/regex/flags`.
- `command`: a regex matched against each shell part, with quotes removed and wrappers such as `sudo`, `env` and `nice` stripped.
- `path`: a regex matched against the file path relative to the project root.
- `input`: a regex matched against the call's JSON.
- `member` and `profile`: who reviews (`gandalf`, `legolas`, `aragorn` with `git` or `database`).

**How overrides combine with the shipped rules:**
- **Overrides win.** A matching project rule decides before the shipped rules.
- **Two things can't be lowered.** No project rule goes below a shipped block rule or a protected path, and block rules can't be disabled.
- **Lists only grow.** Lists add to the shipped ones.

**A broken file is ignored whole.** The shipped rules stay in force, and the errors are listed by
field in the transcript.

The overrides file is itself a protected path, so Claude can't edit it without asking you.

## Models

| Reviewer | Built-in default |
| :- | :- |
| Destructive operations (Gandalf) | `sonnet` |
| Diffs (Legolas, Stage 3) | `sonnet` |
| Git and database (Aragorn, Stage 3) | `opus` |
| Full council (Stage 4) | `opus` |

Aliases resolve to the newest model of that family your Claude Code build knows. A reviewer's model
comes from the first of these that sets one:

1. A session switch (`/council model`, Stage 2).
2. Its row in `/config` ("Gandalf model": `default`, `sonnet`, `opus`, `fable` or `haiku`).
3. `models` in the project rules file, which also takes full model IDs.
4. The built-in default.

The token cap, effort and deadline follow the model automatically. "Review deadline" in `/config`
overrides the deadline.

## Options (`/config`)

| Option | Default |
| :- | :- |
| Gandalf enabled | on (off: its reviews come to you) |
| Gandalf model | `default` |
| Review deadline (seconds) | 0 (from the model) |
| Session token budget | 1,500,000 (spent: reviews come to you) |
| Audit log path | `.claude/council-of-elrond/audit/audit.jsonl` |
| Audit log size before rotation (KB) | 1024, three files kept |

## Escalation

When a call comes to you, the question shows the call (with secrets redacted), why it was gated,
and each reviewer's verdict. You can:

- **Allow once:** the call runs (and still meets the normal permission prompt).
- **Keep blocked:** it is refused.
- **Type an instruction:** it is refused and your text is passed to Claude.

Dismissing the question refuses the call. Where nobody can be asked (`claude -p`, nothing
attached), the call is refused with the reason.

## Audit log

One JSONL line per gated call: time, tool, fingerprint, tier, rule, member, model, verdict, reason,
your decision, outcome, latency and tokens. It never holds file contents, diffs or secrets: the
call itself appears only as a hash. A `.gitignore` beside it keeps it out of git.

## Expected token cost

A review sends roughly 1,000–4,000 input tokens (checklist, the call cut to 200 lines, your latest
prompt) and receives roughly 100–300 output tokens, plus thinking on Sonnet, Opus and Fable at low
effort. Allowed calls cost nothing. Check current prices for the models you choose.

## Known gaps in shell parsing

Parsing is best effort, by pattern, and not a shell.

- **Variables, globs and aliases aren't expanded.** `rm -rf $DIR` has an unknown target, so review decides. `cd $X` followed by a relative recursive delete is treated as if `$X` were `/`.
- **Earlier commands aren't tracked.** Shell functions and aliases defined in an earlier command are unknown.
- **Code inside interpreters isn't parsed.** `python -c "shutil.rmtree('/')"` is review (script execution); the reviewer sees the code, but no rule reads it.
- **Encoded or downloaded payloads** (`base64 -d | sh`, `curl | sh`) are caught only as "piped into a shell" (review).
- **Shell symbolic links aren't resolved.** File-tool paths are resolved to their real path; paths in shell commands are not.
- **POSIX only:** no Windows paths or PowerShell parsing.
- **Long commands aren't parsed.** Commands longer than 20,000 characters, or nested more than four levels deep, go to review.

## What it does not protect against

- Anything outside tool calls: what Claude says, files it reads, network requests other tools make.
- A mod that fails to load, a disabled mod, `disableAllHooks`, `--safe-mode` or `--bare`: then nothing is gated.
- A reviewer persuaded by content it reviews. All session content is marked as untrusted data and the prompt says to ignore instructions in it, but that is mitigation, not a guarantee.
- Rules you loosen, and calls you allow.
- A hook that overruns its time limit. The engine may run the call; Elrond refuses rather than pass with its budget nearly spent, but it can't act once it has run out.

## Tests

```
claude plugin test ./mods/council-of-elrond
claude plugin validate ./mods/council-of-elrond
tsc -p ./mods
```
