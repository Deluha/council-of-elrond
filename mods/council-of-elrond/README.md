# council-of-elrond

A Claude Code mod that gates risky tool calls before they run. Rules sort every call into a tier.
Calls that need a second opinion go to a model reviewer, and anything uncertain comes to you.

> **The rules tier is the safety boundary.** The model reviewers are a second opinion: they can
> catch what a pattern misses, but they never widen what the rules allow. This is not a sandbox or a
> security product (see [What it does not protect against](#what-it-does-not-protect-against)).

Status: **Stage 5 of 6, hardened in 0.5.0.** Available now: the rules; three model reviewers
(destructive operations, diffs, and git and databases) with routing between them; the full council
with your project's own checks for big operations; the secrets scan, read-only previews, review
rounds and lockout, the approve cache, escalation to you, allow rules offered after "allow once",
`/council` and `/council report`, shadow mode and bypass, fail-closed handling and the audit log,
all in plain mode. The 0.5.0 release closed the rules-tier and pipeline findings of the Stage 5
review ([docs/REVIEW-2026-10.md](../../docs/REVIEW-2026-10.md)). The theme and its UI follow in the
last stage.
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

## Reviewers

A review-tier call goes to exactly one model reviewer, the one its rule names (`member` and
`profile` in a rule), unless it is a big operation (see [The full council](#the-full-council)).
Each reviewer has a short checklist of its own and sees only what that checklist needs.

| Reviewer | Takes | Sees | Checks |
| :- | :- | :- | :- |
| Destructive operations (Gandalf, `gandalf`) | deletes, moves, overwrites, scripts, infrastructure, anything no rule names | the call, the preview, scripts Claude wrote this session | reversibility, width, reach, backups, intent |
| Diffs (Legolas, `legolas`) | Write, Edit, NotebookEdit | a diff built from the call against the file as it stands (cut to the diff line limit), the file's git status | matches the request, scope creep, weakened tests, disabled checks, dependency/CI/config changes, obvious breakage. No style review. |
| Git (Aragorn, `aragorn`, profile `git`) | push, merge, rebase, reset, tag, amend and other history changes | the command, the branch, remote and commits it would send or bring in, recent history with remote branches marked, your protected branches | protected target, force, rewriting pushed history, unrelated commits |
| Database (Aragorn, `aragorn`, profile `database`) | SQL clients, migrations, `.sql` files | the command, SQL from `-c`/`-e`/heredocs, `.sql` files it names inside the project, or a SQL file's diff; which production patterns match | rollback path, destructive DDL, UPDATE/DELETE without WHERE, production-looking target, transactions, long locks |

**Gandalf is the fallback.** A call goes to Gandalf when its rule names nobody, when the named
reviewer is switched off, when a compound command's parts name different reviewers (one specialist
would judge only its own part), or when a rule names the diff reviewer for something with no file.
If Gandalf is off too, the call comes to you. `/council test "<command>"` shows who would review and
why.

## The full council

**Big operations** go to every enabled reviewer at once instead of one. By default they are a
`git push`, a merge into a protected branch (`git merge` while a protected branch is checked out, or
`gh pr merge`) and a database migration.

- **Who sits:** every enabled reviewer with something of the call to review.
  - The destructive-operations reviewer always sits.
  - The git and database reviewer sits once for each profile the call touches, so `git push && psql …` gets both.
  - The diff reviewer sits for a file change, and for a push or merge. There it reviews the changes the push would send or the merge would bring in, read by one fixed, read-only `git diff`.
- **One model:** every member sits on the council's model (`opus` by default), not its own.
- **One deadline:** every member runs under one shared deadline from that model (Opus 45 s, or "Review deadline" in `/config`). By default they run in parallel. "Full council one at a time" asks them in turn instead, each getting what is left of the deadline, and stops at the first block.
- **Strictest wins:** block, then revise, then approve. Every objection is labelled with the reviewer who raised it. A reviewer that errors, times out or answers malformed counts as a block from that reviewer.
  - Blocked only for want of verdicts (nobody actually objected, every check passed): the call comes to you, as a single reviewer's failure does.
  - Any real objection or failed check: Claude gets the refusal.
- **Independent:** reviewers never see each other's verdicts.

**Project checks** (Gimli, `gimli`) run alongside: your tests, lint and typecheck, from
`gimli.commands` in `rules.json`:

```json
{
  "schemaVersion": 1,
  "gimli": {
    "commands": [
      { "name": "tests", "argv": ["npm", "test"], "timeoutMs": 300000 },
      { "name": "lint", "argv": ["npx", "eslint", "."] }
    ]
  },
  "bigOperations": ["publish", "/^kubectl\\s+apply(\\s|$)/"]
}
```

- **Only these commands run.** They run by argument vector with no shell, in the project root, and nothing comes from Claude or the call. `rules.json` is a protected path, so Claude can't add a command without asking you.
- **Pass or fail by exit code.** A failure, a timeout or a command that can't start is a block. Claude gets the check's last 20 lines (redacted) so it can fix the cause; the audit log keeps none of them.
- **Each command has its own timeout:** 120 s unless `timeoutMs` says otherwise, at most 600 s. It runs outside the reviewers' deadline, so a council can take as long as the longer of the two.
- **Stopping early:** Esc ends them. Once a reviewer has blocked, a check still running is stopped, since it can only add a block.
- **Make them non-interactive.** No watch mode or prompts; standard input is closed. For example, `["env", "CI=1", "npm", "test"]`.

**Changing what counts as big:** `bigOperations` in `rules.json` adds rule ids,
`/regex/flags` matched against each shell part, or `merge-to-protected`; it only adds to the shipped
list. Only calls the rules already send to review can be big operations: a blocked call stays
refused, and an ask-tier call still comes to you. To send big operations to one reviewer like any other call, turn off "Full council for big
operations" in `/config`. `/council test "<command>"` shows when a call would go to the full council,
who would sit and which checks would run.

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
| Diffs (Legolas) | `sonnet` |
| Git and database (Aragorn, both profiles) | `opus` |
| Full council (every member, for big operations) | `opus` |

Aliases resolve to the newest model of that family your Claude Code build knows. A reviewer's model
comes from the first of these that sets one:

1. A session switch (`/council model gandalf opus`). Each switch is checked with one tiny request first.
2. Its row in `/config` ("Gandalf model", "Legolas model", "Aragorn model", "Full council model": `default`, `sonnet`, `opus`, `fable` or `haiku`).
3. `models` in the project rules file, which also takes full model IDs.
4. The built-in default.

The token cap, effort and deadline follow the model automatically. "Review deadline" in `/config`
overrides the deadline.

## Options (`/config`)

| Option | Default |
| :- | :- |
| Gandalf enabled | on (off: calls only it would review come to you) |
| Gandalf model | `default` |
| Legolas enabled | on (off: its reviews go to Gandalf) |
| Legolas model | `default` |
| Aragorn enabled | on (off: its reviews go to Gandalf) |
| Aragorn model | `default` |
| Full council for big operations | on (off: big operations go to one reviewer) |
| Full council model | `default` |
| Full council one at a time | off (members in parallel) |
| Project checks enabled | on (runs `gimli.commands` for big operations) |
| Review deadline (seconds) | 0 (from the model) |
| Session token budget | 1,500,000 (spent: reviews come to you) |
| Audit log path | `.claude/council-of-elrond/audit/audit.jsonl` |
| Audit log size before rotation (KB) | 1024, three files kept |
| Shadow mode | off |
| Plain mode | off (themed). On: no theme text anywhere |
| Secrets scan enabled | on |
| Read-only preview enabled | on |
| Preview line limit | 80 |
| Diff line limit | 200 |
| Tool errors count as failed attempts | on |

## Theme and plain mode

By default the council speaks in its theme. The "Plain mode" option in `/config` switches every
theme word off; behaviour is identical in both modes.

What is themed, for you only:

- The names: `/council`, the dialog and the report say Gandalf, Legolas, Aragorn (git or
  databases), Gimli, Gollum, Galadriel, Elrond and the Council of Elrond where plain mode says the
  role ("the destructive-operations reviewer", "the full council").
- The escalation dialog is a loot roll: headed "Loot roll", with the options "Need: allow once",
  "Pass: keep blocked" and, for one possible secret, "Greed: add to allowlist".
- Bypass is Leeroy mode (`council: Leeroy mode` by the prompt, and in `/council`).
- `/council` counts wipes where plain mode says "refused or failed attempts".
- Each member's one line of flavour in the debate pane, once that pane lands.

What is never themed: what Claude reads. Refusals, the full council's reasons and the rule reason
written to your rules file are plain in both modes, and name the role, not the character. Member
ids you type (`/council model gandalf opus`) are config keys and stay as written. The dialogs that
confirm exact data you agree to write (the allowlist entry, an allow rule) keep their plain text.

| Theme term | Plain name |
| :- | :- |
| Gandalf | The destructive-operations reviewer |
| Legolas | The diff reviewer |
| Aragorn | The git and database reviewer |
| Gimli | The project checks |
| Gollum | The secrets scan |
| Galadriel | The read-only preview |
| Elrond | The council's chair: the gate itself |
| The Council of Elrond | The full council |
| Loot roll | The escalation dialog |
| Need, Pass, Greed | Allow once, keep blocked, add to allowlist |
| Leeroy mode | Bypass (`/council off`) |
| Wipe | A refused or failed attempt |
| Lockout | Three wipes on one operation |

"Council" stays in plain mode: it is the product's name.

## Commands

Everything `/council` prints is for you only: it draws in a pane where a surface draws one, else as
dim transcript lines. Claude never reads it. In a plain `claude -p "/council"` run nothing prints;
use `--output-format stream-json`, where the lines arrive as `ui_log` messages.

| Command | What it does |
| :- | :- |
| `/council` | Status: mode, each member with its state, model and verdict counts, the full council and the project checks, failed attempts since your last prompt, tokens spent, median review time. |
| `/council off`, `/council on` | Bypass for this session: gated calls pass unreviewed and are logged. Never persisted. The label `council: bypass` (`council: Leeroy mode` when themed) shows by the prompt. |
| `/council shadow on`, `/council shadow off` | Shadow mode for this session, over the `/config` setting. |
| `/council log [n]` | The last *n* gated calls (default 10) from the audit log. |
| `/council rules` | Every effective rule with its source (`shipped` or `project`), and the lists. |
| `/council test "<command>"` | Which tier, rule, reviewer (and profile, and why it fell back to Gandalf if it did) and operation key a shell command would get. For a big operation it shows the full council's seats, model and checks. Runs nothing, so a merge is assumed to land on a protected branch. |
| `/council model [<member> <model> [--save]]` | Lists each slot's model and where it came from, or switches one for this session (`default` clears the switch). `--save` also writes the `/config` row when the model is one of its picker values. |
| `/council reload` | Reads `rules.json` again. |
| `/council report` | A summary of the audit log, rotated files included (see below). |

### `/council report`

Read the report after a few days in shadow mode to tune the rules. It has four parts:

- **Most refused:** the rules behind the most refusals, each with who refused (the rules, a reviewer, you, the secrets scan, a lockout), and the operations refused most.
- **Stopped, then allowed by you:** calls the council stopped and you then allowed once (or allowlisted), by rule, with examples. These are the false-positive candidates. It also lists the allow rules you added that way.
- **Shadow verdicts that would have refused:** per reviewer, how many blocks and revises it logged in shadow mode, and under which rules.
- **Cost per reviewer:** tokens per reviewer, with its share of full councils (taken from each member's own tokens in the council), the full council's sittings, and the median review time. Review times are logged from Stage 5 on; older lines count for tokens only.

A line that doesn't parse is skipped and counted; a log file that can't be read is named and left out.

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
- **`git merge`:** the current branch and the commits it would bring in.
- **`git reset`, `git rebase`, `git commit --amend`:** recent commits, marked with the remote branches that point at them, and uncommitted changes.
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

- **Allow once** (themed: "Need: allow once"): the call runs, and still meets Claude Code's normal permission prompt, which then carries the line "Council: you allowed this once".
- **Keep blocked** (themed: "Pass: keep blocked"): it is refused.
- **Type an instruction:** it is refused and your text is passed to Claude.

Dismissing the question refuses the call. Where nobody can be asked (`claude -p`, nothing
attached), the call is refused with the reason.

### Allow rules after "allow once"

Once a call you allowed once has run, a second question offers an allow rule for it, showing the
exact JSON. It is written to `rules.json` (after your own rules, keeping your file's key order)
only if you choose **Add the rule**, and the rules are then reloaded. **Not now**, or dismissing
the question, writes nothing, and the same rule isn't offered again this session. For
`sudo apt update`:

```json
{
  "id": "allow-apt-update",
  "tier": "allow",
  "tools": ["Bash"],
  "command": "^apt update$",
  "input": "\"command\":\" *sudo +apt +update *\"",
  "reason": "You allowed this exact call after the council stopped it, and added this rule."
}
```

The rule is as narrow as the call. `command` names the part that was gated, and `input` pins the
whole command, so `sudo`, a redirect (`> file`) or another command chained on can't ride along.
Only the same command passes (spacing may differ). A file edit gets that tool on that path; an MCP
tool gets that tool by name. Before offering it, the council checks that the rule would really let
this call through. If one of your own rules would still decide first, nothing is offered.

No rule is offered for:

- a call the rules block, or one touching a protected path;
- a call the secrets scan flagged at any level (an allow rule would skip the scan);
- a script or inline code (what runs isn't in the command);
- a command whose words expand when it runs (`$VAR`, `$(…)`, backticks), one over several lines, or one over 300 characters;
- a call you then refused at Claude Code's own prompt, or one that didn't run.

A broken `rules.json` is never rewritten: the rule isn't written, and a transcript line says why.
Secrets get their own confirm-then-write path, the allowlist (see [Secrets scan](#secrets-scan)).

## Audit log

One JSONL line per gated call: time, tool, fingerprint, operation key, tier, rule, member, model,
verdict, reason, shadow and bypass flags, your decision, outcome, latency (the whole call), the
review's own time (`reviewMs`), tokens, and the id of an allow rule you added for it (`ruleAdded`).
A full council
adds what made the call big, each member's own verdict and tokens, and each check's result and time. The outcome
tells apart a call you refused at Claude Code's permission prompt (`refused-by-user`), one that
check denied with nobody asked (`denied-by-permission`), and one that ran and errored (`error`). It never holds file contents, diffs or secrets: the
call itself appears only as a hash. A `.gitignore` beside it keeps it out of git.

## Expected token cost

A review sends roughly 1,000–4,000 input tokens (checklist, the call or diff cut to its line limit,
the preview, your latest prompt) and receives roughly 100–300 output tokens, plus thinking on
Sonnet, Opus and Fable at low effort. In a live check, small reviews took about 1,000 tokens each:
a one-line file write (diffs, Sonnet) in 1.6 s, a `git tag` (git, Opus) in 2.8 s and a `psql -c`
(database, Opus) in 2.4 s.

A **full council** costs one review per seat, on the council's model (Opus by default): typically
three for a push (about 3,000 tokens in all, about 2 s in a live check, in parallel), two for a
migration. Project checks cost no tokens, only their run time. Allowed calls cost nothing. Check
current prices for the models you choose.

## Known gaps in shell parsing

Parsing is best effort, by pattern, and not a shell. The parser does unwrap function and `case`
bodies, package and process wrappers, `$'…'` escapes and empty substitutions, so the command they
hold is classified (0.5.0); the gaps that remain:

- **Variables and runtime expansions aren't resolved.** `rm -rf $DIR` has an unknown target, so review decides. `cd $X` followed by a relative recursive delete is treated as if `$X` were `/`. A protected file named only through a variable (`X=.env; cat $X`) is not recognised as protected.
- **A `cd` inside a subshell or an inline script isn't tracked.** `(cd / && rm -rf *)` and `bash -c 'cd / && rm -rf *'` resolve the target against the project root, so they are review rather than block. A `cd` in the top-level command is tracked.
- **Code inside interpreters isn't parsed.** `python -c "shutil.rmtree('/')"` is review (script execution); the reviewer sees the code, but no rule reads it.
- **Encoded or downloaded payloads** (`base64 -d | sh`, `curl | sh`) are caught only as "piped into a shell" (review).
- **Shell symbolic links aren't resolved.** File-tool paths are resolved to their real path; paths in shell commands are not.
- **Two-sided glob intersection isn't computed.** A glob that names a protected file directly (`cat .en*`) is caught, but a glob with a wildcard in a middle segment against a protected `**` glob (`cat .github/*/ci.yml`) may not be.
- **Not every program that changes things is named.** The shipped rules cover the common ones; a cloud or database CLI, an HTTP write or an interpreter route they don't list may pass. Add a project rule, or propose a default.
- **POSIX only:** no Windows paths or PowerShell parsing.
- **Long commands aren't parsed.** Commands longer than 20,000 characters, or nested more than four levels deep, go to review.

## What it does not protect against

- Anything outside tool calls: what Claude says, files it reads, network requests other tools make.
- A mod that fails to load, a disabled mod, `disableAllHooks`, `--safe-mode` or `--bare`: then nothing is gated.
- **Diffs are built from the call, not from git.** The diff reviewer sees the change the call describes against the file as it stands when the hook runs; a file over 4 MiB, or one it can't read, is shown as the call's own text only, and the prompt says so.
- **The project checks run your project's code.** Claude can edit the tests and scripts they run (file edits go to the diff reviewer, not to you), so a passing check is only as good as the code it runs. They run as you, with your environment.
- **A push of a branch the remote doesn't have yet** has no range to diff: the diff reviewer sits out of that council, and the preview shows no commits.
- **The database reviewer sees only the SQL it can find**: inline `-c`/`-e`, heredocs, and `.sql` files named in the command and inside the project. A migration tool's own migration files (`prisma migrate deploy`) are not looked up.
- A reviewer persuaded by content it reviews. All session content is marked as untrusted data and the prompt says to ignore instructions in it, but that is mitigation, not a guarantee.
- Rules you loosen, and calls you allow. An allow rule you add skips review, the ask tier and the secrets scan for that exact command; it does not follow a `cd` earlier in another command, so `rm -r build` is allowed in whichever folder Claude runs it.
- **Secrets in allowed calls.** The secrets scan reads gated calls only: it sits after the allow step, as the spec orders it. A `curl` GET with a key in a header, or a `git commit`, is not scanned.
- **Secrets the patterns don't know.** The scan is patterns plus a randomness check. Low-confidence findings skip values that look like code (`process.env.X`, `getToken()`, `string`) and hashes (`sha512-…`), so a password with no digit in a plain assignment can slip through.
- **Operation keys are best effort.** A retry through a different tool (a script instead of `rm`) is a different operation; the per-kind counter catches only retries of the same verb.
- A hook that overruns its time limit. The engine may run the call; Elrond refuses rather than pass with its budget nearly spent, but it can't act once it has run out.

## Adding a member

The council is three model reviewers (destructive operations, diffs, git and databases) and three
code members (the secrets scan, the read-only preview, the project checks). The spec caps the
model members at three, so adding one means replacing one, or adding a code member. The steps,
file by file, are in the developer guide:
[docs/DEVELOPMENT.md, "Add a member"](../../docs/DEVELOPMENT.md#add-a-member). In short: a member
supplies only its checklist (`system(nonce)`) and its prompt (`prompt(context, nonce)`); the
request, the deadline, token accounting and the strict verdict parse are shared, and every piece
of session content it sees is wrapped as untrusted data.

## Glossary

The mod's output is in plain words. The names below are the project's own vocabulary, used in the
code, the design documents and (from Stage 6) the themed mode.

| Name | Plain meaning |
| :- | :- |
| The council | The mod as a whole: the gate on tool calls. |
| Elrond | The chair: the code that classifies, routes, combines verdicts, escalates and logs. Not a reviewer. |
| Boromir | The proposer: the Claude session whose tool calls are gated. Not part of the mod. |
| Gandalf | The destructive-operations reviewer, and the fallback for anything no other reviewer takes. |
| Legolas | The diff reviewer, for file writes and edits. |
| Aragorn | The git reviewer and the database reviewer: one member with two profiles. |
| Gimli | The project checks: your tests, lint and typecheck, run alongside the full council. |
| Gollum | The secrets scan. |
| Galadriel | The read-only preview ("the mirror") of what a call would touch. |
| Full council | Every enabled reviewer at once, for a big operation. |
| Ready check, council check | The full council's per-member tick or cross (Stage 6 UI). |
| Round | One proposal and one verdict on the same operation. Two refusals, and the call comes to you. |
| Wipe | A failed attempt: a refusal, your "keep blocked", a call that ran and errored. |
| Lockout | Three failed attempts on one operation, or five on one kind: Claude is told to stop retrying. |
| Loot roll | The escalation question (allow once, keep blocked, type an instruction) in themed mode. |
| Leeroy mode | Session bypass (`/council off`). |
| Shadow mode | Reviewers log their verdicts but never refuse. |
| Threat meter | Blocks per reviewer (Stage 6 UI). |
| Epic drop | The "Legendary commit acquired" banner after a push or merge passes the full council (Stage 6 UI). |
| Plain mode | Every string in its plain variant; no theme names anywhere. Behaviour is identical. |

## Tests

```
claude plugin test ./mods/council-of-elrond
claude plugin validate ./mods/council-of-elrond
tsc -p ./mods
```

Contributor setup, conventions and recipes: [docs/DEVELOPMENT.md](../../docs/DEVELOPMENT.md).
Installing, configuring and removing: [docs/INSTALL.md](../../docs/INSTALL.md).
