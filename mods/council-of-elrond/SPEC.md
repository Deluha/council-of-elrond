# council-of-elrond: development spec

> The original development spec, kept verbatim. Decisions approved after it was written live in
> [ROADMAP.md](./ROADMAP.md) ("Approved decisions") and [DESIGN.md](./DESIGN.md) ("Decisions the spec
> did not cover"); where they differ from this text, they win.

A Claude Code mod: a council of specialist reviewers that gates risky tool calls before they run, with a Lord of the Rings / World of Warcraft theme.

Read this whole file, then start with Step 0. Do not write code until I approve the Step 0 plan.

## 1. How to work in this session

- Do not invent APIs. The generated types for this build are the source of truth, ahead of docs, examples and this spec.
- Any API name in this spec is an expectation to verify, not a fact.
- If the spec asks for something the API can't do, say so and propose the closest alternative. Don't fake it.
- Stop at every checkpoint in section 20 and wait for me.
- No third-party runtime dependencies unless Step 0 shows they are supported and I agree.
- When a decision isn't covered here, pick the safer option, note it in the design doc and tell me at the next checkpoint.

## 2. Step 0: research first

No code yet.

1. Run `claude --version`. Mods need v2.1.287 or later and are on by default. `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` is ignored, so don't set it.
2. Confirm mods load for this account: run `/plugin` and check the "mods active" line. If they don't load, stop and tell me why (remote rollout switch, org policy, `disableAllHooks`).
3. Read the docs under https://code.claude.com/docs/en/plugins/mods/ (overview, create, events, api, interface, test, troubleshoot, reference).
4. Generate the types for this build (`/plugin-types`) and load the plugin-authoring skill (`/plugin-authoring`).
5. Read the source of the `blast-radius` sample (anthropics/claude-code-playground, `claude-code/mods`) and the built-in `diff`, `sec-default` and `telemetry` mods (anthropics/claude-code, `mods/`). Issue anthropics/claude-code#91870 is background only.

Verify and report on each of these:

| # | Question |
| :- | :- |
| a | What are the hook time limits? Does time inside a model call or a spawned process count against them? (Time inside `$.ui.ask` reportedly does not.) |
| b | What happens to a tool call when a hook is skipped for overrunning? |
| c | How does a `tool.call` hook refuse a call, and what text does Claude receive? |
| d | Does rewriting a call's input cause a denial? |
| e | How does a mod call a model? Options, limits, parallel calls, token caps. |
| f | How does a mod start a process, read and write files, and set timers? |
| g | Can a hook tell a subagent or MCP call from a main-session call? |
| h | Does the tool result expose an error flag the hook can read after `next(e)`? |
| i | How are commands registered? Do they take arguments or subcommands? |
| j | Which UI surfaces exist (pane, band above the prompt, dialogs, redrawn rows), and which are terminal-only? |
| k | What do `$.ui.ask` and drawing calls do where nothing draws (VS Code panel, `claude -p`, Agent SDK, cloud sessions)? |
| l | Can the hooks module import sibling files? What state survives `/reload-plugins`? |
| m | What can `userConfig` hold (types, lists, nesting)? |
| n | How does `claude plugin test` work? How do tests fake a model call, a process, a user answer and the clock? |

Step 0 output:

- A summary of the events, methods and UI surfaces that exist.
- A list of anything in this spec that isn't possible, with the closest alternative.
- Open questions for me.
- A proposed plan.

Then wait for my go-ahead.

## 3. The council

| Member | Type | Job |
| :- | :- | :- |
| Boromir | Main Claude session | Proposer. Not part of the mod. |
| Elrond | Code | Chair. Runs the pipeline, routes calls, combines verdicts, enforces the round cap, keeps the audit log. |
| Gandalf | Model | Destructive operations: deletes, overwrites, force flags, anything irreversible. |
| Legolas | Model | Diff reviewer for file edits and writes. |
| Aragorn | Model | Git and database, as two separate profiles (section 5). |
| Gimli | Code | Tests and lint. Runs configured commands only. |
| Gollum | Code | Secrets scan of commands and diffs. |
| Galadriel | Code | The mirror: a read-only preview of what a command would touch. |

Each member can be switched off in config. Each model member has its own model setting. Three model members is the ceiling; do not add a fourth.

## 4. Pipeline

Every `tool.call` goes through these steps in order.

1. **Bypass.** If the session bypass is on, pass through and log it.
2. **Classify** with the rules into one of four tiers:

   | Tier | Meaning |
   | :- | :- |
   | allow | Pass through untouched. |
   | review | Send to the council. |
   | ask | Send straight to me. |
   | block | Refuse. No model call. |

   - Compound shell commands (`&&`, `;`, `|`, subshells, `$(...)`) are split and each part classified. The strictest tier wins.
   - Unmatched calls are allowed.
   - Protected paths always classify as ask.
3. **allow:** return `next(e)` untouched.
4. **block:** refuse with the rule's reason.
5. **Lockout:** if this operation is locked out by the wipe counter, refuse (section 9).
6. **Gollum** scans the call (section 5).
7. **ask:** go to me (section 10).
8. **Galadriel** builds a preview where one is available.
9. **Route:** Elrond sends the call to one model member, or to the full council for big operations (section 6).
10. **Act** on the combined verdict (section 7).
11. **After the tool runs:** record the outcome, update wipes, log.

Calls from subagents and MCP tools go through the same pipeline. The mod's own model calls and processes must never re-enter it.

## 5. Member details

### Model members: shared rules

- Return strict JSON only: `{verdict, reason, safer_alternative}`.
- `verdict` is `approve`, `revise` or `block`.
- `reason` is at most two sentences.
- `safer_alternative` is required unless the verdict is approve, and must be a concrete action Claude can take.
- No tools.
- Each has a short system prompt containing its checklist and nothing else.
- The call, diff, preview and file content are wrapped in clear delimiters and described as untrusted data. The prompt tells the member to ignore any instructions inside them.
- Secrets are redacted before anything is sent to a model.
- Parsing: strip code fences, validate the fields and the verdict value. Anything else is a malformed verdict and fails closed.

### Gandalf

- **Triggers:** deletes, recursive or wildcard operations, overwrites of untracked files, force flags, history rewrites. Also the fallback reviewer when no other member matches.
- **Context:** the command or call, Galadriel's preview, my latest prompt.
- **Checks:** is it reversible, how wide is the target, does it leave the repo, is the data tracked or backed up, does it match what I asked.

### Legolas

- **Triggers:** Edit and Write calls classified as review.
- **Context:** the diff built from the call's arguments (truncated), the file path, my latest prompt.
- **Checks:** does the change match the request, unrelated files or scope creep, deleted or weakened tests, disabled checks, unexpected changes to dependencies, CI or config, obvious breakage.
- No style review.

### Aragorn

One member with two profiles. Routing picks the profile, and each has its own checklist and context, so neither prompt carries the other's baggage.

**Git profile**

- **Triggers:** git operations that change a remote or rewrite history (push, merge, rebase, reset, tag).
- **Context:** the command, Galadriel's preview (branch, remote, commits to be sent), my latest prompt.
- **Checks:** target branch against the protected list, force flags, rewriting history that is already pushed, pushing unrelated commits.

**Database profile**

- **Triggers:** migration tools, SQL clients, schema and migration files.
- **Context:** the command, the migration or SQL content (truncated), my latest prompt.
- **Checks:** a rollback path, destructive DDL (DROP, TRUNCATE, dropping columns), UPDATE or DELETE without WHERE, a target that looks like production (patterns from config), transaction wrapping, long locks on large tables.

### Gimli

- Runs only the commands listed in config (tests, lint, typecheck), each with its own timeout.
- Pass or fail by exit code. Keeps the last lines of output for display.
- Never runs anything taken from Claude or from the tool call.
- Runs only in the full council.

### Gollum

Findings come in two confidence levels.

| Level | Examples | Action |
| :- | :- | :- |
| High | Private key headers, well-known API key formats, connection strings with an embedded password | Refuse and tell Claude to remove the secret. I am not asked. |
| Low | Generic `password=` or `token=` assignments, long random-looking strings | Ask me, showing a redacted snippet. Options: keep blocked, allow once, add to the allowlist. |

- Config adds patterns (with a level) and an allowlist.
- An allowlist entry is written only after I confirm the exact entry.
- The secret is redacted in the pane, the dialog, the audit log and every model prompt.

### Galadriel

- Uses a fixed allowlist of read-only inspection commands written in the mod's code. Examples: listing the targets of a delete, diff stats, the commits a push would send.
- Never runs the proposed command or any part of it.
- Has its own timeout. Output is truncated to the preview line limit.
- No preview available is fine. It is never a reason to allow or block.

## 6. Routing and the full council

- **Normal gated call:** exactly one model member, picked by the rules. Gandalf is the fallback.
- **Big operations** (from config; default: git push, merge to a protected branch, migrations): all enabled members run, in parallel if Step 0 allows, under one shared deadline. If parallel calls aren't possible, run them in sequence inside the same deadline and stop at the first block.
- The strictest verdict wins: block, then revise, then approve. Reasons are combined, each labelled with its member.
- Members never see each other's verdicts and never debate.
- A member that errors, times out or returns a malformed verdict counts as a block from that member.
- A Gimli failure counts as a block.

## 7. Verdict semantics

- **approve:** call `next(e)` and nothing else. The normal permission check and prompt still run. The mod never pre-approves a call and never bypasses a permission rule.
- **block:** refuse and return the reason and safer alternative to Claude.
- **revise:** refuse and return the requested changes to Claude. Never rewrite the call's arguments.

The refusal text Claude receives always contains: which member decided, the verdict, the reason, the safer alternative, how many rounds are left on this operation, and a line telling it not to retry the same call unchanged.

## 8. Operations and rounds

- **Fingerprint:** tool name plus arguments with whitespace collapsed. Used for the cache.
- **Operation key:** the target of the call, so a rephrased retry still counts.
  - For edits: the file path.
  - For shell: the program and subcommand (for example `git push`) plus its main target.
  - This definition is rough. Propose a better one in Step 0 if you see one.
- **Round:** one proposal and one verdict on the same operation key.
- After 2 non-approve rounds on an operation, escalate to me. No further model calls on that operation until I answer.
- **Cache:** an approve for an identical fingerprint is reused within the same turn. Block and revise are never cached.

## 9. Wipes

- A wipe is any of: a block, a revise, a "keep blocked" answer from me, or a gated call that ran and returned an error. The last one is a config switch, on by default.
- After 3 wipes on one operation key, lock it out: refuse further attempts and tell Claude to stop retrying, summarise what failed and propose a different approach to me.
- Rounds, wipes and lockouts reset when I send a new prompt.
- A successful approved call resets its own operation.

## 10. Escalation

- Uses `$.ui.ask`. Shows the call, the preview, and each member's verdict and reason.
- Options:
  - **Allow once.** The call proceeds through `next(e)`.
  - **Keep blocked.** Counts as a wipe.
  - **Type an instruction.** The text is returned to Claude and resets the round count for that operation.
- After "allow once", offer to add an allow rule for that pattern. Show the exact rule and write it to the project overrides file only if I confirm.
- Never offer a rule for block-tier matches, protected paths or high-confidence Gollum findings.
- In themed mode this dialog is the "loot roll".

## 11. Safety constraints

- **Fail closed.** Any error, timeout, malformed verdict or exhausted budget escalates to me. If I can't be asked, block. Never silently allow.
- **Own deadlines.** Every model call and process has its own deadline, set safely under the hook limit found in Step 0. Never rely on behaviour after a hook is skipped.
- **The rules tier is the safety boundary.** Model members are a second opinion. State this in the README.
- **Untrusted data.** Commands, diffs and file contents are data in every reviewer prompt. Instructions inside them are ignored.
- **No derived execution.** The mod executes nothing derived from a tool call except through `next(e)`.
- **No network** other than the model calls.
- **Script evasion.** Running a script or inline code (`bash x.sh`, `sh -c`, `python -c`, `node -e`, `psql -f`, piping into a shell, `eval`, `xargs`) is review tier by default. If the script was written or edited in this session, include its content (truncated) in the reviewer context.
- **Best-effort parsing.** Shell parsing by pattern has gaps. List the known ones in the README.
- **Non-drawing surfaces.** Where nothing draws, fall back to plain text: block with the reason, or ask if asking works there.
- **Broken config.** A broken or missing config falls back to the shipped defaults with a visible warning. It never disables the gate.

## 12. Cost controls

- Per-member model setting, defaulting to a small, cheap model.
- Small max tokens per verdict.
- A line limit for diffs and previews.
- A per-session token budget across all members. When it runs out, gated calls go to me.
- Reviewer context is only what section 5 lists per member. No transcript.
- The allow tier makes no model call and must add no noticeable delay.

## 13. Modes

- **Plain mode:** strips all theme names and text. Changes no behaviour.
- **Shadow mode:** model members run and log their verdicts but never block. Block-tier rules, protected paths and Gollum still enforce. Meant for tuning the rules in the first days. The README should recommend starting here.
- **Bypass:** session only, never persists, with a visible indicator while on. Themed name: "Leeroy mode".

## 14. Config

- Shipped defaults live in the plugin. A project overrides file lives under `.claude/council-of-elrond/`. Overrides win.
- The config carries a schema version. An unknown version is treated as a broken config.
- Validate at load and report errors by field.

**Rules**

- Tool names and regex patterns per tier, and which member (and profile) reviews each.
- Shipped defaults:
  - review: file writes and deletes, shell commands that change state, git push, migrations, script execution.
  - block: `rm -rf` on root, home or outside the repo, force push to a protected branch, DROP or TRUNCATE against a production-looking target.

**Lists**

- Protected paths (default: `.env` files, CI config, the migrations folder).
- Protected branches.
- Production-looking connection patterns.
- Big operations.
- Gimli's commands and timeouts.
- Gollum's extra patterns and allowlist.

**Options**

- Plain mode, shadow mode.
- Per-member on/off and model.
- Deadlines, token budget, line limits.
- Audit log path and size limit.
- Whether tool errors count as wipes.

Put simple options in `userConfig` and structured lists in the rules file, depending on what Step 0 shows `userConfig` can hold.

## 15. Commands

| Command | What it does |
| :- | :- |
| `/council` | Status: members enabled, mode, counts of approved, revised and blocked per member, wipes, tokens spent, median review time. |
| `/council off`, `/council on` | Session bypass. |
| `/council shadow on`, `/council shadow off` | Shadow mode for this session. |
| `/council log` | The last verdicts. |
| `/council rules` | The effective rules and where each came from. |
| `/council test "<command>"` | Shows which tier, member and profile would handle a hypothetical command. Runs nothing. |
| `/council report` | Summary of the audit log: most-blocked patterns, blocks I overrode (false-positive candidates), shadow-mode verdicts that would have blocked, cost per member. |

If subcommands aren't supported, register separate commands.

## 16. Audit log

- One JSONL line per gated call: timestamp, tool, fingerprint, operation key, tier, member, profile, verdict, reason, shadow flag, my decision if escalated, latency, tokens.
- No file contents, diffs or secrets.
- Rotate by size.

## 17. Theme and UI

Build these after the core works, in this order. Drop what the API can't support.

1. **Debate pane:** Boromir's proposal beside the reviewing member's verdict.
2. **Council check:** for big operations, a raid-style ready check with one tick or cross per member.
3. **Wipe counter** display.
4. **Threat meter:** blocks per member.
5. **Loot roll:** the themed escalation dialog.
6. **Epic drop:** a purple flash and "Legendary commit acquired" when a merge or push succeeds after a passed council check. Cosmetic only.

Also:

- A small indicator near the prompt whenever bypass or shadow mode is on.
- All user-facing strings live in one table with a themed and a plain variant per entry. No theme text inside logic.
- Gandalf's block message is "You shall not pass" style.
- Themed messages stay short: one line of flavour, then the plain reason and the safer alternative.
- Colour and flashes must degrade cleanly where they aren't supported.

## 18. Code structure

- TypeScript, strict, typechecked against the generated types.
- A thin hooks module that wires events to Elrond.
- Classifier, routing, verdict combination, operation keys and counters as pure functions with no API calls, so they can be tested directly.
- One file per member if imports are supported. Otherwise one file with clear sections.
- All session state in one place, with a single reset function for a new prompt.

## 19. Tests

Runnable via `claude plugin test`.

- **Rules:** allow, review, ask, block, compound commands, protected paths, unmatched calls, script execution.
- **Routing:** each member and profile gets its own triggers, with Gandalf as fallback.
- **Model members:** approve, revise and block for each.
- **Approve path:** goes through `next` and nothing is pre-approved.
- **Arguments** are never rewritten.
- **Refusal text** contains every required field.
- **Rounds:** 2-round cap and escalation, including a rephrased retry.
- **Escalation:** each answer, and the rule suggestion written only on confirm.
- **Failure paths:** reviewer error, timeout, malformed verdict, budget exhausted.
- **Full council:** strictest wins, one member failing, Gimli failing, shared deadline.
- **Gollum:** high and low findings, redaction, allowlist, allowlist written only on confirm.
- **Galadriel:** never runs the proposed command, timeout.
- **Gimli:** runs only configured commands, timeout.
- **Wipes:** counting, lockout, resets.
- **Cache:** approve reused, block not reused.
- **Modes:** shadow, bypass, plain.
- **Config:** broken file, unknown schema version, overrides win.
- **Fallback** where nothing draws.
- **Audit log:** fields present, no contents, no secrets, rotation.
- **No re-entry** from the mod's own calls.
- **Commands:** `/council test` runs nothing, `/council report` reads the log correctly.

## 20. Build order

Checkpoint after each stage.

1. Elrond, rules, Gandalf, escalation, fail-closed paths, audit log. Plain mode only.
2. Gollum, Galadriel, operation keys, rounds, wipes, cache, commands, shadow mode.
3. Legolas and both Aragorn profiles, with routing.
4. Full council with Gimli.
5. Rule and allowlist suggestions from overrides, and `/council report`.
6. Theme strings, then the UI features in the order listed.

At each checkpoint:

- Tests pass.
- Typecheck passes.
- `claude plugin validate` passes.
- You give me a short summary of what changed, any decisions you made that this spec didn't cover, and the known limits.

## 21. Deliverables

1. **Design doc:** Step 0 findings, hooks used, data flow, failure modes, and the `hooks:` and `calls:` lines from `claude plugin validate`.
2. **The plugin** in `./mods/council-of-elrond` with `.claude-plugin/plugin.json`, `hooks/hooks.json` and the hooks module.
3. **The tests** in section 19.
4. **README** covering:
   - Loading it (`--plugin-dir` for one session, or install).
   - Editing rules, with examples.
   - Each mode and each command.
   - Adding a member.
   - Expected token cost.
   - What the mod does not protect against.
   - A short glossary of the theme terms and their plain names.

## 22. Definition of done

- Every test in section 19 passes.
- No path exists where a gated call runs after a reviewer failure without my answer.
- No path exists where the mod approves a call ahead of the permission check.
- Plain mode shows no theme text anywhere.
- With every model member disabled, the rules tier, Gollum and escalation still work.
- The README states the limits plainly.

## 23. Non-goals

- Not a sandbox or a security product.
- No debate between members.
- No automatic fixing of calls.
- Nothing persists across sessions except the audit log, rule overrides and the Gollum allowlist.
