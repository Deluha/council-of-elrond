# council-of-elrond

A Claude Code mod that gates risky tool calls before they run. Rules sort every call into a tier.
Calls that need a second opinion go to a model reviewer, and anything uncertain comes to you.

> **The rules tier is the safety boundary.** The model reviewers are a second opinion: they can
> catch what a pattern misses, but they never widen what the rules allow. This is not a sandbox or a
> security product (see [What it does not protect against](#what-it-does-not-protect-against)).

Status: **Stage 2 of 6.** Available now: the rules, the destructive-operations reviewer, the
secrets scan, read-only previews, review rounds and lockout, the approve cache, escalation to you,
`/council`, shadow mode and bypass, fail-closed handling and the audit log, all in plain mode. The
diff, git and database reviewers, the full council and the theme follow in later stages.
See [ROADMAP.md](./ROADMAP.md) for what's left, [SPEC.md](./SPEC.md) for the original spec and
[DESIGN.md](./DESIGN.md) for how it works.

## Your first days: shadow mode

Turn on **shadow mode** while you tune the rules: `/council shadow on` for one session, or "Shadow
mode" in `/config`. Reviewers still run and log their verdicts to the audit log, but they never
refuse. The block tier, the ask tier, protected paths and the secrets scan still enforce. The label
`council: shadow` shows by the prompt while it is on. Until the audit log has a line, a one-time
toast at session start suggests it.

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

1. A session switch (`/council model gandalf opus`). Each switch is checked with one tiny request first.
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
| Shadow mode | off |
| Secrets scan enabled | on |
| Read-only preview enabled | on |
| Preview line limit | 80 |
| Tool errors count as failed attempts | on |

## Commands

Everything `/council` prints is for you only: it draws in a pane where a surface draws one, else as
dim transcript lines. Claude never reads it. In a plain `claude -p "/council"` run nothing prints;
use `--output-format stream-json`, where the lines arrive as `ui_log` messages.

| Command | What it does |
| :- | :- |
| `/council` | Status: mode, members and their models, verdict counts, failed attempts since your last prompt, tokens spent, median review time. |
| `/council off`, `/council on` | Bypass for this session: gated calls pass unreviewed and are logged. Never persisted. The label `council: bypass` shows by the prompt. |
| `/council shadow on`, `/council shadow off` | Shadow mode for this session, over the `/config` setting. |
| `/council log [n]` | The last *n* gated calls (default 10) from the audit log. |
| `/council rules` | Every effective rule with its source (`shipped` or `project`), and the lists. |
| `/council test "<command>"` | Which tier, rule, reviewer and operation key a shell command would get. Runs nothing. |
| `/council model [<member> <model> [--save]]` | Lists each slot's model and where it came from, or switches one for this session (`default` clears the switch). `--save` also writes the `/config` row when the model is one of its picker values. |
| `/council reload` | Reads `rules.json` again. |

`/council report` arrives in Stage 5.

## Secrets scan

Every gated call is scanned for secrets in what it would write or run: the shell command (heredocs
included), Write content, an Edit's new text, a notebook cell, an MCP call's input.

- **High confidence** (private keys, AWS, GitHub, Anthropic, OpenAI, Slack, Google and Stripe keys, passwords in connection strings): refused without asking you. Claude is told to remove the secret.
- **Low confidence** (`password=…`-style assignments, long random-looking tokens): comes to you with a redacted snippet. Allow once, keep blocked, type an instruction, or **add to allowlist**. The allowlist asks a second time, showing the exact entry: a `sha256:` fingerprint of the secret, never the secret. Only then is it written to `rules.json` under `gollum.allowlist`.

Add your own patterns in `rules.json`:

```json
{
  "schemaVersion": 1,
  "gollum": {
    "patterns": [{ "id": "acme-key", "level": "high", "regex": "ACME-[0-9]{8}", "label": "Acme key" }],
    "allowlist": ["sha256:0123456789abcdef"]
  }
}
```

Allowlist entries are exact strings or fingerprints, never regexes. Your patterns are also used to
redact the dialog, reviewer prompts and the audit log.

## Read-only preview

Before a review, the mod runs a few fixed, read-only inspections and shows the result to the
reviewer and to you. The commands come from a table in the mod; the call's targets are passed only as
data, and the proposed command never runs.

- **Deletes** (`rm`, `find -delete`): what each target is, and a folder's entries (no process).
- **`git push`:** the current branch, the remote's URL (redacted) and the commits it would send.
- **`git reset`, `git rebase`:** recent commits and uncommitted changes.
- **Write, Edit:** the file's diff stat against `HEAD`, and whether git tracks it.

Each inspection has 5 seconds. No preview is never a reason to allow or block.

## Rounds, failed attempts and lockout

An **operation** is what a call tries to do, not its exact text: the tool family, the verb, and its
targets with flags dropped and paths resolved. `rm -rf ./build` and `rm -r build/` are one
operation. A push keys on its remote and branch, and SQL on its database.

- **Rounds:** after a reviewer refuses the same operation twice, further attempts come to you without another model call. Typing an instruction starts the rounds over.
- **Failed attempts:** a refusal by a rule, a reviewer or the secrets scan, your "keep blocked" (or a dismissed question, or nobody to ask), your refusal at Claude Code's own permission prompt, and a gated call that ran and errored all count. "Chat about this" does not, nor does Claude Code denying a call on its own with nobody asked (in `claude -p`, or by a deny rule).
- **Lockout:** three failed attempts on one operation, or five on one kind of operation (say `git push` to any target), lock it out. Claude is told to stop retrying, tell you what failed and propose another approach.
- A call that runs successfully clears its own operation. Everything resets when you send a new prompt.
- **Cache:** a reviewer's approve is reused for the identical call until your next prompt. A block or revise never is.

## Escalation

When a call comes to you, the question shows the call (with secrets redacted), why it was gated,
the read-only preview when there is one, and each reviewer's verdict. You can:

- **Allow once:** the call runs, and still meets Claude Code's normal permission prompt, which then carries the line "Council: you allowed this once".
- **Keep blocked:** it is refused.
- **Type an instruction:** it is refused and your text is passed to Claude.

Dismissing the question refuses the call. Where nobody can be asked (`claude -p`, nothing
attached), the call is refused with the reason.

## Audit log

One JSONL line per gated call: time, tool, fingerprint, operation key, tier, rule, member, model,
verdict, reason, shadow and bypass flags, your decision, outcome, latency and tokens. The outcome
tells apart a call you refused at Claude Code's permission prompt (`refused-by-user`), one that
check denied with nobody asked (`denied-by-permission`), and one that ran and errored (`error`). It never holds file contents, diffs or secrets: the
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
- **Secrets in allowed calls.** The secrets scan reads gated calls only: it sits after the allow step, as the spec orders it. A `curl` GET with a key in a header, or a `git commit`, is not scanned.
- **Secrets the patterns don't know.** The scan is patterns plus a randomness check. Low-confidence findings skip values that look like code (`process.env.X`, `getToken()`, `string`) and hashes (`sha512-…`), so a password with no digit in a plain assignment can slip through.
- **Operation keys are best effort.** A retry through a different tool (a script instead of `rm`) is a different operation; the per-kind counter catches only retries of the same verb.
- A hook that overruns its time limit. The engine may run the call; Elrond refuses rather than pass with its budget nearly spent, but it can't act once it has run out.

## Tests

```
claude plugin test ./mods/council-of-elrond
claude plugin validate ./mods/council-of-elrond
tsc -p ./mods
```
