# council-of-elrond: design

Status: **Stage 5, hardened in 0.5.0** (Stage 4 plus allow rules offered after "allow once", and
`/council report`; then the 0.5.0 hardening of §10; plain mode).
What's next, and the decisions approved after the spec: [ROADMAP.md](./ROADMAP.md). The original spec: [SPEC.md](./SPEC.md).
Built against Claude Code **2.1.289**, checked against **2.1.291** from Stage 5 and **2.1.294** from
Stage 6. The generated API types are vendored at `mods/types/claude-code.d.ts` (now 2.1.294's) and
are the source of truth over docs, samples and the spec. The 2.1.289 → 2.1.291 drift was additive: a
new `prompt.mention` event, a `Color` type (theme keys or raw colours) for paint props, a `ceiling`
on tool-check inputs, teammate record fields, and doc wording. The 2.1.291 → 2.1.294 drift is
additive for every signature the mod calls: a `prompt.autocomplete` event, text blocks (with
caching) accepted as a model request's `prompt` and `system` beside plain strings, a registered
tool's spec type, a `workflow` field on agent records, and a test-kit `mock.session`. One semantic
addition: a `.catch` handler is now also asked, with `next.error.kind` `re-entry` and `called`
false, where the engine does not run a hook because the event was raised beneath that hook's own
frame. Elrond's handler refuses whenever `called` is false, so such a call fails closed; whether
the mod's own `$.ui.ask` (an `AskUserQuestion` call) ever arrives this way is unverified live (the
test kit's escalation tests pass unchanged). Tracked in ROADMAP.md, "Known follow-ups".

## 1. Step 0 findings

Environment: 2.1.289 (mods need 2.1.287+). The remote switch is on: `claude plugin test` in an empty
folder does not say "hooks modules are turned off in this process". No `disableAllHooks`, no managed
settings. The interactive `/plugin` "mods active" line can't be read from a headless session.

| # | Question | Finding |
| :- | :- | :- |
| a | Hook time limits | 10,000 ms of the hook's **own** time per dispatch (`HookBudget.ms`); a `.catch` gets 1,000 ms. Time inside `next(e)` or any `$` call is free (model calls, processes, `$.ui.ask`), except `$.clock.sleep/after/every`. Own promises count. |
| b | A skipped hook | The hook is treated as absent and `next(e)` runs: **the call runs**. See §4 for what the probes showed. |
| c | Refusing | Return `{ deny: text }` without `next`. Claude reads the text as the tool's error result; no permission prompt appears. Whether Claude Code wraps the text is undocumented and not observable in tests. |
| d | Rewriting input | `next({...e, x})`. Permission check still runs; auto mode denies a rewrite. Not used: the mod never rewrites. |
| e | Model calls | `$.model.complete({ model, prompt, system, maxTokens (default 1024, max 64,000), effort, timeoutMs }, { signal })` resolves `{isAnswered, text, usage}` or `{isAnswered:false, reason: api-error / empty-reply / aborted}`; rejects only a request it won't send. No tools, no history. No documented concurrency limit; the probe ran two in parallel (peak 2). |
| f | Processes, files, timers | `$.process.run(argv, {cwd, env, stdin, timeoutMs})` (no shell; 30 s default, 10 min max; git with repo hooks off). `$.fs.read/write/list/exists/stat/ancestors` (4 MiB per read, no append, non-atomic write). `$.clock.now/sleep/after/every`. Permission rules do not apply to a mod's own `$.fs`/`$.process`. |
| g | Subagents, MCP | `e.agentId` is set inside a subagent's loop. MCP tools are `mcp__<server>__<tool>`. A chain raised through `$` skips the calling hook; model calls and processes raise their own events, never `tool.call`. `$.ui.ask` is an `AskUserQuestion` tool call that skips the calling hook. |
| h | Error flag | After `next(e)`: `{ isError: true, text, result }`, or `{ deny }` from beneath, or `isReadOnly`. |
| i | Commands | `$.command.register({ name, description, argumentHint, immediate })`; the handler gets `e.args` as a raw string; no subcommands. `{ text }` is shown **and read by Claude**. |
| j | UI surfaces | Pane (all surfaces; unasked only from 144 columns), band above the prompt and mode labels (terminal + desktop), status line, toast, transcript log line, a notice line under the permission dialog, the AskUserQuestion dialog. Terminal only: progress, turn-duration and info-notice sites; raster and image elements. A mod cannot draw the permission dialog. |
| k | Where nothing draws | Hooks run; drawings don't show (VS Code panel, `-p`, SDK, cloud). `$.session.surfaces()` is empty in plain `-p`. `$.ui.ask` rejects when dismissed, on "Chat about this", and in `-p`. |
| l | Imports, reload | Static relative imports of plugin files work. Passing `$` to an imported function fails validation. `$.state` survives hot reload and `/reload-plugins`; `/clear`, `/resume`, `/branch` reset it. Module variables and timers don't survive a reload. |
| m | userConfig | Flat fields: string, number, boolean, directory, file; `options`, `multiple` (string list), `default`, `min`, `max`. No objects or nesting. |
| n | Tests | `claude plugin test` runs `*.test.ts`; the test's `on` hooks sit beneath the plugin and stand for the engine. Fake a model with `on('model.complete')`, a process with `on('process.run')`, a user answer with a `tool.call` hook on `AskUserQuestion`, the clock with `mock.clock(on)`. Each test gets 5 s by default. |

## 2. Hooks used (from `claude plugin validate`)

```
hooks: session.start, prompt.submit, command.run{command=council},
       ui.render{component=Pane, requestId=council}, ui.render{component=SessionMode}, tool.call
calls: $.clock.after (via runCheck), $.clock.now (via convene, runCheck), $.command.register,
       $.config.set (via councilModel), $.env.get (via loadContext), $.fs.exists,
       $.fs.list (via previewOf), $.fs.read (via appendAudit, councilOutput, fileDiffOf, loadContext,
       reportFrom, scriptsOf, sqlFilesOf, writeOverrides), $.fs.stat (via loadContext, previewOf,
       realPathOf, sqlFilesOf), $.fs.write (via appendAudit, writeOverrides),
       $.model.complete (via probeModel, review), $.process.run (via currentBranchOf, previewOf,
       rangeDiffOf), $.process.spawn (via runCheck), $.session.cwd, $.session.root (via loadContext),
       $.session.surfaces (via escalate, offerRule, show, syncIndicator), $.state.get, $.state.set,
       $.ui.ask (via confirmAllowlist, escalate, offerRule), $.ui.log, $.ui.notice, $.ui.open (via show),
       $.ui.resolve, $.ui.status (via syncIndicator), $.ui.toast (via warnOnce)
env reads: HOME
state: council-of-elrond.session, council-of-elrond.panel
```

There is no `tool.check` hook: the mod never takes part in the permission decision. The processes it
starts are read-only `git` commands from Galadriel's table (§6, §8), and, for a big operation, the
project checks the user listed in `rules.json` (`gimli.commands`, §8).

## 3. Data flow

```
tool.call ─► classify (pure, rules only)
             │ allow ──────────────────────────────► next(e)            (no I/O beyond cwd/stat)
             │ gated: fingerprint, operation key ───────────────────────── audit, count
             │ bypass ─► next(e)
             │ block ──► refuse (rule reason)                            failed attempt
             │ locked out (3 on the key / 5 on the verb) ─► refuse, "stop retrying"
             │ Gollum: high ─► refuse ("remove the secret")              failed attempt
             │         low ──► ask ─► allow once / allowlist (confirm, write, reload) ─► continue
             │ ask ─────► escalate ─► allow once ──► notice, next(e) ─► ran? offer an allow rule (pure,
             │                     │                 checked by classify) ─► add: write, reload
             │                     └► keep blocked / dismissed / nobody ─► refuse   failed attempt
             │                     └► instruction ─► refuse, rounds reset; chat ─► refuse
             │ review ─► cached approve this prompt? ─► next(e)
             │           Galadriel preview (fixed table, read-only, 5 s each, ≤ 3)
             │           out of rounds (2) ─► escalate (shadow: pass)
             │           big operation? (pure; a git merge reads the current branch) ─► full council:
             │              seats (pure): Gandalf · Legolas (file diff, or push/merge range) ·
             │                            Aragorn per profile; all on the council model
             │              checks: gimli.commands spawned first, own timeouts, run alongside
             │              members: parallel (or one at a time) under one deadline (time left)
             │              combine (pure): strictest wins; no verdict = block; failed check = block
             │                 approve ─► cache, next(e) · revise/block ─► refuse, labelled
             │                 blocked only for want of verdicts ─► escalate (shadow: pass)
             │           route (pure): the rule's member and profile, else Gandalf
             │           nobody on / budget spent ─► escalate (shadow: pass)
             │           brief: Gandalf (call, preview, scripts) · Legolas (diff, git status)
             │                  Aragorn git (command, preview, protected branches)
             │                  Aragorn database (command, SQL, production matches)
             │           review ($.model.complete, the member's own prompts, own deadline)
             │              approve ─► cache, next(e)
             │              revise / block ─► refuse (verdict, rounds left)  round, failed attempt
             │                              (shadow: logged, next(e))
             │              error / timeout / malformed ─► escalate (shadow: pass)
             │ after next(e): ran ─► clears its operation; error ─► failed attempt (setting);
             │                you refuse at Claude Code's prompt ─► failed attempt;
             │                automatic denial (nobody asked) ─► recorded, not counted
             └─ any throw before next ─► .catch ─► refuse
/council ─► parse (pure) ─► output lines ─► pane (where a surface draws) or ui.log; never Claude
/council report ─► audit.jsonl.2, .1, current (read) ─► report (pure) ─► the same
```

- **Files.** `hooks/register.ts` is the only file that touches `$`. Rules (`rules/`), config (`config/`), members (`members/`: one file per member, `brief.ts` pairing each member and profile with its prompts, `gimli.ts` the checks' outcomes), routing, the full council's seats (`elrond/council.ts`) and its verdict (`elrond/combine.ts`), escalation, refusal, model choice, the allow rule offered after "allow once" (`elrond/suggest.ts`) and the report (`elrond/report.ts`) (`elrond/`), state (`state.ts`), audit (`audit.ts`), redaction and strings are pure modules.
- **State.** The session value `council-of-elrond.session` (`types/index.d.ts`, shape version 3), plus `council-of-elrond.panel`, the lines the `/council` pane draws. `resetForPrompt` is the single reset, run on every prompt you send (composer, bridge or SDK origin): it clears rounds, failed attempts, lockouts and the cache.
- **Config.** The shipped defaults are a TS module. Project overrides live at `.claude/council-of-elrond/rules.json`, read once per load, after the mod's own writes (an allowlist entry, an allow rule), and on `/council reload` (never by watching the file). Both writes go through `editOverrides` (`config/write.ts`).

## 4. Failure modes

| Failure | Behaviour |
| :- | :- |
| Hook throws before the call runs | `.catch` refuses ("fails closed"). |
| Hook throws after the call ran | `.catch` replays the real result (`next.called`); the call is not re-run and Claude isn't told a call that ran was refused. |
| Hook overruns its 10 s own-time budget | **Probe result: the engine did not cut the hook off in the test kit, even with `.catch`.** A hook that overran and then called `next(e)` ran the call. Elrond therefore passes calls only through `proceed()`, which refuses when `next.budget.remainingMs` < 1 s. The hook's own work is bounded to make this unlikely: commands over 20,000 characters aren't parsed (review), parse depth ≤ 4, ≤ 200 parts. |
| Model error, timeout (`timeoutMs`), empty reply, malformed verdict, request refused | Escalate to you; "keep blocked" refuses. |
| Token budget spent / no enabled member can take the call (the named one and Gandalf off) | Escalate without a model call. |
| The file a diff needs can't be read (over 4 MiB, permissions) | The diff shows the call's own text and the prompt says so; the review goes on. |
| A `.sql` file the call names is missing, unreadable, or lands outside the project (by name or real path) | Left out of the database reviewer's context; the review goes on. |
| Nobody can be asked (no surface) | Refuse, saying why. |
| `$.ui.ask` dismissed / "Chat about this" | Refuse (recorded as `dismissed` / `chat`). |
| Overrides file broken, unknown version, invalid field | Ignored whole; shipped rules enforce; a transcript line lists errors by field, plus a toast. |
| Audit write fails | Logged to the debug log; never changes a decision. |
| A preview inspection fails or times out (5 s) | That inspection is left out; no preview is never a reason to allow or block. |
| Writing the allowlist fails, or `rules.json` is broken | Nothing is written (a broken file is never rewritten); the call stays blocked, with a transcript line. |
| Writing an allow rule fails, `rules.json` is broken, or the rule's id was taken since it was offered | Nothing is written; a transcript line says why. The call already ran: it was allowed once. |
| The rule offer is dismissed, or its question fails | Declined for the session; nothing is written. |
| An audit file can't be read for `/council report` | Named in the report and left out; the other files are reported. Unparseable lines are counted and skipped. |
| `/council` registration refused (32-command cap) | A transcript line; the gate is unaffected. |
| `/council` handler throws | The usage line is logged; the command returns no text. |
| A council member errors, times out or answers malformed | Counts as that member's block. With no real objection and every check passed, the call comes to you; beside a real block, Claude is refused. |
| The council's deadline has passed before a member is asked (one at a time) | That member gives no verdict (a block); no request is sent. |
| A project check fails, times out or can't start | A block, with its last 20 lines (redacted) for Claude; none of its output in the audit log. |
| A project check ignores being ended | The council stops waiting at its timeout and calls `return()` on the stream, which kills the child (verified live). |
| The current branch can't be read for a `git merge` | The merge counts as one into a protected branch (full council). |
| The range a push or merge would change can't be read (a new branch, a bad ref) | The diff reviewer sits out of that council; the others decide. |
| Esc during a council | The model requests abort and the check processes are killed with the dispatch. |
| `/council model` probe gets an API error | The switch is refused. A timeout switches with a warning; a failing model then fails closed per review. |
| `$.ui.notice` refused (no dialog open) | Ignored; the call still runs as allowed. |
| Module fails to load, mod disabled, `disableAllHooks`, `--safe-mode`, `--bare` | **No gate at all.** Outside the mod's reach. |

## 5. Decisions the spec did not cover (Stage 1)

1. **Precedence of project rules.** Per command part, a matching project rule decides before shipped rules (overrides win). Shipped block rules and protected paths are a floor no project rule lowers, and block rules can't be disabled. Lists (protected paths, branches, production patterns) only add to the shipped ones.
2. **The overrides file is protected** (`.claude/council-of-elrond/**`), as are `.claude/settings*.json` and `.git/**`. Claude can't loosen the gate or change the models without your approval.
3. **Protected paths apply to any shell mention**, reads included (`cat .env` asks). The Read tool is not gated.
4. **Recursive delete of the project root itself is blocked** (`rm -rf /work`, `rm -rf .` at the root). A glob over its contents (`rm -rf ./*`) is review.
5. **`cd` inside a compound command** moves where later parts' paths land. An unknown target (`cd $X`) is treated as `/`, so a later relative recursive delete is blocked rather than guessed at.
6. **Running a program by path** (`./deploy.sh`) is script execution (review), along with interpreters running files.
7. **Models.** Built-in defaults are `sonnet` (Gandalf, Legolas), `opus` (Aragorn, full council), with no Haiku in any default. Aliases track the newest model of the family this Claude Code build knows. Layers, in order: session switch (Stage 2), `/config` row, project file, built-in. Settings follow the family: Sonnet 2,000 tokens / low effort / 30 s, Opus 2,000 / low / 45 s, Fable 4,000 / low / 90 s, Haiku 400 / no effort / 20 s.
8. **Stage 1 routing.** Every review went to Gandalf until Legolas and Aragorn existed (superseded in Stage 3, §7). The audit log records the member that actually reviewed.
9. **Allow before bypass.** The classifier runs first; the allow tier passes before the state is read, so allow adds no state or audit I/O. Bypass then applies to gated calls only. The behaviour is the same as the spec's order.
10. **Plain-mode notices say "Council:"**, not the plugin's name, which contains a theme word. The engine labels toasts with the plugin's name itself; that is outside the mod's reach.

## 6. Decisions the spec did not cover (Stage 2)

1. **The secrets scan reads gated calls only.** It sits after the allow step, as SPEC §4 orders it, so allowed calls stay free of work. A `curl` GET with a key in a header or a `git commit` is not scanned. Scanning every call is cheap (patterns only) and could be turned on if you prefer.
2. **Allowlist entries are fingerprints.** The dialog offers `sha256:` plus 16 hex digits of the secret, so the secret never lands in `rules.json`. Hand-written exact strings (6+ characters) are honoured too. The entry is written only after a second question showing it, and only for a single finding. Cancel keeps the call blocked, which counts as a failed attempt.
3. **Low-confidence heuristics.** Assignment values that look like code (`$X`, `process.env.X`, `getToken()`, a digit-free identifier such as `string`) and hashes (`sha512-…`, `integrity`) are not findings, so code doesn't trigger a question per write.
4. **One question for a secret on the ask tier.** Allowing at the secrets dialog also answers the ask tier, since the dialog already showed the call and its rule. A secret on the review tier still goes to the reviewer after you allow it.
5. **Previews on the review tier only.** SPEC §4 puts the ask step before Galadriel. Preview commands come only from the table in `members/galadriel.ts`. Git refs and remotes are validated (no leading `-`, no `..`), a `git -C`/`--git-dir`/`--work-tree` call gets no preview, and git runs with `GIT_OPTIONAL_LOCKS=0`, no prompts and no pager. The preview is redacted before it reaches a model or the dialog. File writes show `git diff --stat HEAD`.
6. **Operation keys** (`elrond/operations.ts`). Shell keys use each gated part's verb (program plus subcommand for git, npm, docker, kubectl and similar) and its sorted targets. Arguments of path programs (`rm`, `mv`, `chmod`, …) and redirect targets are resolved lexically under the root; shell symbolic links are not resolved, as in the classifier. File tools share the `file:` family on the real path. The verb key drops the targets.
7. **Rounds are counted, not flagged.** "Out of rounds" is `rounds ≥ 2` on the key, so no separate `awaitingUser` flag exists. "Keep blocked" leaves the rounds used up, so the next attempt asks you again; a typed instruction resets them.
8. **What counts as a failed attempt.** It counts: a block-tier refusal, a high secret, a reviewer's revise or block, keep blocked, dismissed, nobody to ask, and a cancelled allowlist confirm. A gated call that ran and errored also counts (`toolErrorsAreWipes`). It doesn't count: a lockout refusal, "chat about this", a typed instruction. A successful run (approved, allowed once, cached or bypassed) clears its own key. The per-verb counter clears only on a new prompt.
9. **The cache lives until your next prompt** (keyed on the prompt epoch, not `turn.start`'s `turnId`, which subagent turns would complicate). A config reload clears it too.
10. **Shadow mode** shadows the second opinion only. Verdicts are logged with `shadow: true` and use no rounds or failed attempts; a reviewer failure, a switched-off reviewer or a spent budget passes (logged). Rules, protected paths, the ask tier, the secrets scan and lockouts still enforce. The session switch wins over the `/config` setting.
11. **`/council model`.** A one-request probe (16 tokens) checks the model first. `--save` writes only the `gandalf` row (the only `/config` model row so far) and only picker values; anything else stays session-only and says so.
12. **`/council` output** is drawn in a pane (`$.ui.open` from the command, so it seats at any width) where a surface draws, else as `ui.log` lines. Verified live: a plain `claude -p "/council …"` prints nothing, and in stream-json the lines arrive as `system/ui_log` messages; the command's result carries no text.
13. **The mode label** is added to `SessionMode` (terminal and desktop). `$.ui.status` carries it only when a surface without that site (VS Code, mobile) is attached, so the terminal doesn't show it twice.
14. **Permission-check outcomes, told apart by wording** (ROADMAP decision 12). Your refusal at Claude Code's own prompt ("The user doesn't want to proceed with this tool use…", "…take this action right now", read from the 2.1.289 binary) is `refused-by-user` and counts as a failed attempt, whatever `toolErrorsAreWipes` says. An automatic denial ("… needs approval …", verified live in `-p`; deny-rule wording) is `denied-by-permission` and never counts. Text matching neither is an ordinary tool error. The user-refusal wording is checked first.
15. **Redaction fixes.** The assignment pattern now matches JSON-escaped quotes (`\"hunter2\"`), which Stage 1 missed in file-tool call text, and leaves an already-redacted value alone, so redacting twice is stable.
16. **Identifiers stay as written.** Plain-mode output names member ids where you type them (`/council model gandalf …`, `[gandalf]` in the status), since they are config keys. The string table itself holds no theme text (tested).

## 7. Decisions the spec did not cover (Stage 3)

1. **Routing** (`elrond/routing.ts`). A review-tier call goes to the member its rule names; Aragorn's profile comes from the rule. Gandalf takes it instead when the rule names nobody, the named member is off (`disabled`), the call's review parts name different members (`mixed`: one specialist would judge only its own part, and Gandalf's checklist is the general one), or the diff reviewer is named for a call with no file (`no-diff`). With the member Gandalf would replace and Gandalf both off, the call comes to you ("its reviewer is switched off"). Gandalf being off never stops an enabled specialist. `/council test` prints the fallback and why.
2. **Aragorn named without a profile** (a project rule) takes the git profile for a `git` command and the database profile for anything else.
3. **One `review()` for every member.** `review($, brief, model, deadline, signal)` in register.ts: a `Brief` (`members/brief.ts`) carries the member, its profile and the context together, so a context can't reach another member's prompt. Members supply only `system(nonce)` and `prompt(context, nonce)`. The request, deadline, token accounting and strict verdict parse are shared.
4. **The diff is built from the call** (`members/legolas.ts`). Edit: the replacement applied in memory to the file as it stands (`replace_all` honoured), shown as unified hunks with 3 lines of context. Write: the new content against the current file (a new file is all added). NotebookEdit: the cell's source, by `cell_id`, for replace, insert and delete. The text not found, or a file that can't be read, gives the call's own text with a note in the prompt. The diff is bounded so the hook's own time stays small: the common head and tail are trimmed and only a middle under 250,000 line pairs is matched line by line; anything larger is one removed block and one added block. Cut to `diffLines` (default 200), redacted. Legolas also gets Galadriel's file preview (diff stat, whether git tracks it).
5. **The database profile's SQL** (`members/aragorn.ts`): per client, its inline options (`psql -c`, `mysql -e`, `mongosh --eval`, `clickhouse -q`, `sqlcmd -Q`, `cqlsh -e`), heredocs, and `.sql` files (or `-f` files) the database parts name, at most 3, 150 lines each. A file is read only when it is inside the project both by name and by real path, so a link can't pull in a file from elsewhere. The configured production patterns are matched in code and the matches named in the prompt. A SQL file write (`sql-file-write`) gets its diff instead.
6. **The git profile's context** adds the protected branches. Galadriel's table gained `git merge` (the current branch and the commits it would bring in; the values of `-m`, `-s`, `-X` and similar are never read as the ref) and `git commit --amend` (recent history). The history log is decorated with remote branches (`--decorate=short`), so "already pushed" is visible to the reviewer.
7. **Who decided.** Aragorn's refusals say "the git reviewer" or "the database reviewer"; status counts both profiles under `aragorn`. The audit line's `member` and `profile` are the ones that reviewed (or the ones the route wanted, when nobody could); in Stage 2 `profile` came from the rule.
8. **`/config` rows** for Legolas and Aragorn (enabled, model) and `diffLines`, so `/council model legolas|aragorn … --save` writes them. The full council's row arrives with it in Stage 4; until then `--save` for `council` stays session-only and says so.
9. **A reason containing a file name was cut** (`notes.txt`, `v1.2`): the two-sentence limit (Stage 1) split on any `.`. It now ends a sentence only at `.`, `!` or `?` followed by whitespace. Found in the live check.

## 8. Decisions the spec did not cover (Stage 4)

1. **Big operations** (`bigOperations` in `rules.json`, `elrond/council.ts`). Entries are rule ids, `/regex/flags` matched against each shell part's core (as rule `command` patterns are), or the named check `merge-to-protected`. The roadmap named only the first two; a merge's target is the checked-out branch, which no pattern sees.
   - The defaults: `/^git\s+push(\s|$)/`, `merge-to-protected` and `database-migration`.
   - Like the other lists, project entries only add to the shipped ones. "Full council for big operations" in `/config` (on by default) turns the council off as a whole; big operations then go to their routed member.
   - Only the review tier can be big: block and ask decide first.
   - A project rule may not take a check's name, and the `g`/`y` regex flags are refused (for `tools` patterns too), since one RegExp is tested again and again.
2. **Merge into a protected branch.** `git merge <ref>` (not `--abort`, `--quit` or `--continue`) is big when the checked-out branch matches `protectedBranches`; register.ts reads it with one `git rev-parse --abbrev-ref HEAD`, only for a call that has a git merge. An unreadable branch, or a detached `HEAD`, counts as protected. `gh pr merge` always counts, since its base isn't in the command. `/council test` runs nothing, so it assumes a protected branch and says so.
3. **Who sits** (`councilSeats`). Every enabled model member with something of this call to review:
   - Gandalf always.
   - Aragorn once per profile the call's review parts ask for (both, for `git push && psql …`), so neither prompt carries the other's baggage. A big operation that is neither git nor database (a project's `kubectl apply`) gets no Aragorn.
   - Legolas for a file tool's diff, or for a push or merge: the changes it would send (`<remote>/<branch>..HEAD`, or `@{upstream}..HEAD`) or bring in (`HEAD...<ref>`), read by one `git diff --no-color --no-ext-diff --no-textconv <range> --` from Galadriel's table (refs validated as before). It is cut to the diff limit and redacted, and only runs while the preview is on. A range git can't read (a branch the remote doesn't have yet) seats nobody: Legolas sits out.
   - Legolas's system prompt now names both kinds of change, and the prompt says which it is.
   - Each seat gets its own brief from the shared `briefOf`, and every seat runs on the `council` model slot.
4. **One deadline, by the clock's reading.** `convene` reads `$.clock.now()` (a `$` call, free of the hook's budget) and passes each request the deadline minus the time spent, so the deadline is never a timer.
   - In parallel, every member gets nearly the whole deadline.
   - One at a time ("Full council one at a time", off by default), each gets what is left, and the first block (a block verdict or a member without one), or a failed check, stops the rest. They read as skipped.
   - A member with no time left gives no verdict and sends nothing.
   - The deadline is the council model's (Opus 45 s), or "Review deadline".
5. **Gimli's runner.** `$.process.spawn` has no timeout, so each command's own timeout is a `$.clock.after` that ends the loop with `return()`, which kills the child. A probe in 2.1.289 settled the cost: a pending `after` cost the hook about 3 ms of its 10 s budget while a spawn pull was in flight for 12 s, and a 3 s `after` killed a `sleep 30` on time with no orphan.
   - Once ended, the runner returns at once even if the stream is slow to close.
   - The checks run in parallel with each other, all in the project root, by argv with no shell, with standard input closed.
   - The first failing check stops the others, and a member's block stops any still running: a check can only add a block, so its result can no longer change the outcome. A revise does not stop them, since a failed check still raises it to a block.
   - Esc kills them through the dispatch's signal.
   - Commands are validated: a name, a non-empty argv, a timeout of 1–600 s (default 120 s), and at most 8 commands.
   - `gimliEnabled` (on) switches them off. No commands configured, no checks.
6. **Combining** (`elrond/combine.ts`). Strictest wins. Claude reads every voice that didn't approve, one per line and labelled ("the git reviewer (block): …"), with the alternatives labelled the same way. A failed check adds its last 20 lines; a stopped one adds nothing.
   - **Blocked only for want of verdicts** (members failed, nobody objected, every check passed): the call comes to the user, as a single reviewer's failure does (§11 of the spec), instead of telling Claude a timeout was a verdict.
   - **Beside a real objection or a failed check**, a failure is just that member's block, and Claude is refused.
   - **Nobody reviewed** (every seat sat out): the user decides. The project checks never approve alone: with no model member on, a big operation comes to the user.
7. **Accounting.** A council is one review: one round on the operation (none when blocked only for want of verdicts), one failed attempt on a refusal, and its approve is cached like any other. Each member's own verdict counts under its name, and the council's under `council`, the checks' under `gimli`. The audit line's `member` is `council`, with a `council` field: the entry that made it big, each voice's verdict and tokens, and each check's status and time. Its `reason` leaves out check output, so the log holds none.
8. **Shadow mode** shadows the council too, the project checks included: they run, their result is logged, and the call goes on. Only the rules, protected paths, the ask tier, the secrets scan and lockouts enforce in shadow.
9. **Mixed compound commands** (the Stage 3 follow-up). A mixed call that contains a big operation (`git push && psql …`) now goes to the full council, where each specialist reviews it with its own checklist and Aragorn sits once per profile. Other mixed calls (`git rebase && rm -rf build`) stay with Gandalf: sending every mixed call to the council would run the project checks, minutes long, for a cleanup command.
10. **`/config` rows.** "Full council model" (the same picker as the others) joins `CONFIG_ROWS`, so `/council model council … --save` writes it. Also new: "Full council for big operations", "Full council one at a time" and "Project checks enabled".

## 9. Decisions the spec did not cover (Stage 5)

1. **When the rule is offered.** After "allow once", once the call has run (outcome `ran`), as a second question (`offerRule` in register.ts). A call you then refused at Claude Code's own prompt, or one that errored, gets no offer. One question both shows the exact JSON and confirms it ("Add the rule" / "Not now"): the spec's "show the exact rule, write only if I confirm" needs no second step, unlike the allowlist, whose first dialog had three choices. Dismissing, or "Not now", declines that pattern for the session (`declinedRules` in state, shape version 3); it is never re-offered until a new session. Claude waits for this answer before reading the call's result.
2. **The rule is as narrow as the call** (`elrond/suggest.ts`). A part's core alone would be too wide: a project rule decides a part before shipped rules, and the core drops wrappers and redirects, so `^rm -r build$` alone would later allow `sudo rm -r build` (no ask tier) and `rm -r build > file`. So a shell rule has two patterns:
   - `command`: each gated part's core, escaped and anchored (an alternation when several parts were gated). It names what was gated, as `/council rules` shows it.
   - `input`: the whole command, word by word, as it appears in the call's JSON (`"command":" *rm +-r +build *"`), so nothing else can ride on it. Only spacing may differ.
   - A file tool gets that tool and its project-relative path, anchored. Any other tool (MCP) gets that tool by its exact name: nothing narrower is meaningful for an arbitrary input.
3. **Offered only if it works.** The call is classified again with the rule in place (last among the project's rules, where it is written). If it wouldn't be `allow`, nothing is offered: for example, when your own earlier project rule still decides, or a floor (block rule, protected path) applies.
4. **Never offered** for a block-tier match, a protected path (`classification.isProtected`), any secrets-scan finding (high or low: an allow rule skips the scan, so the low finding you allowed once would pass unseen from then on), a script or inline code (`script-*` rules: what runs isn't in the text), a command whose words expand at run time (`$`, backticks), a multi-line command or one over 300 characters, or a command the parser didn't follow (`command-too-long`, `command-too-complex`).
5. **Where it goes in `rules.json`.** Appended after the file's own rules, so rules you wrote keep deciding first. The id is `allow-<the core, slugged>`, numbered past ids in use. The reason says it was added after "allow once".
6. **One way to write `rules.json`** (`editOverrides` in `config/write.ts`), for the allowlist and for rules. Read fresh at write time, parse, validate the file as it is (a broken or invalid file is never rewritten), apply the change, validate the result with `validateOverrides`, write it back pretty-printed (2 spaces). Spreading the parsed object keeps your key order; new keys go last. Comments or custom spacing in the file are not kept (JSON has no comments; the file is rewritten whole). Then the config reloads (decision 9).
7. **The allowlist path** (Stage 2) needed no change in behaviour: it already asked a second question with the exact entry, wrote only on "Add it" and reloaded. It now shares the writer above.
8. **The report** (`elrond/report.ts`) reads `audit.jsonl.2`, `.1`, then the current file. A line missing `ts`, `tool` or `outcome` is skipped and counted, as are lines that don't parse.
   - *Most refused*: outcome `refused`, by rule id and by operation key, each rule saying who refused (rules, a reviewer, you, nobody to ask, a lockout, the secrets scan).
   - *Stopped, then allowed by you*: decision `allow-once` or `allowlist`, by rule, with example operations, plus the rules added that way (`ruleAdded`).
   - *Shadow verdicts that would have refused*: `shadow` with verdict `block` or `revise`, per reviewer and profile.
   - *Cost*: a model review ran when the line has a model and isn't a cached approve. A single review's tokens go to its member (Aragorn per profile). A full council's tokens go to each member from `council.voices[].tokens`, and the council row counts its sittings and total.
   - Top 5 per list.
9. **Review time in the audit line.** `latencyMs` covers the whole call (the tool's run and your answers included), so it can't give a reviewer's latency. Lines now carry `reviewMs`, the model review alone (the single member, or the whole council sitting), and the report's medians use it. Lines from before Stage 5 have none and count for tokens only. A council sitting's time isn't split per member.
10. **`/council report` output** follows decision 1, like every subcommand: pane or `ui.log`, never Claude. Verified live: in `-p` with stream-json it arrives as `system/ui_log` lines, and the result carries no text and no model usage.


## 10. The 0.5.0 hardening (the Stage 5 review)

The end-of-Stage-5 review ([docs/REVIEW-2026-10.md](../../docs/REVIEW-2026-10.md)) found commands
that reached a weaker tier than intended. The rules tier is the safety boundary, so these were
fixed before Stage 6. The decisions:

1. **Unwrap, don't only pattern-match.** `coreOf` (`rules/shell.ts`) now strips a function or
   `case`/`coproc` header, package-manager runners (`npm exec`, `poetry run`, …), process wrappers
   (`setsid`, `strace`, `chroot`, `flock`, `nsenter`, …), `env -`/`-S`, the npx family, and the
   global options before a kubectl/helm/docker/terraform subcommand, so the command they wrap is
   what the rules see. A privilege-changing wrapper (`gosu`, `runuser`, `setpriv`, `run0`, `chpst`,
   `pkexec`) is stripped and also marks the part privileged (ask). The scanner decodes `$'…'`
   escapes, treats `$"…"` as the quoted string, and drops an empty substitution so a split or
   disguised program name resolves.
2. **Three new code checks** (`rules/checks.ts`): `git-config-write` (writing `.git/config`),
   `git-config-injection` (a dangerous `git -c` key, `--config-env`, `--exec-path`, `bisect run`),
   and `dangerous-env-assignment` (a leading `LD_PRELOAD`, `GIT_SSH_COMMAND`, `NODE_OPTIONS` and
   the like). A fourth, `raw-disk-write`, replaced the old regex and covers a redirect to a device
   and `cp`/`tee`/`shred`/`blkdiscard`/the mkfs family, not just `dd`/`mkfs`.
3. **Protected paths** (`rules/globs.ts`, `protectedMatcher`/`touchesProtected`) match the
   protected directory itself, match case-insensitively, and match a targeted glob (`.en*`,
   `*.env`) whose language includes a protected file. A match-everything segment (`*`) and an
   unrelated short name (a `db` host) are not treated as protected, so `rm -rf *` stays review and
   ordinary reads pass. Two-sided glob intersection is not computed (documented gap).
4. **Force-push** blocks `--mirror`, `--prune` and a glob-destination refspec; **rm** expands
   brace flags (`-{r,f}`) before the recursive test; **`sh -c --`** reveals the command after the
   `--`; the part cap already degrades to review.
5. **Operation keys are redacted** before they reach the audit log (`elrond/operations.ts`), since
   a key can hold a target a command named verbatim (a push URL with a token).
6. **The approve-cache fingerprint** (`audit.ts`) collapses whitespace only for fields where it
   has no meaning (a shell `command`); a file's content is hashed exactly, so a re-indented write
   is not reused unreviewed.
7. **The allow rule offered after "allow once"** (`elrond/suggest.ts`) forbids the
   sandbox-disabled variant of the command, and the offer is withheld if the rule cannot be made
   safe.
8. **Reviewer prompts** sanitise call-derived labels with `label()` (`members/shared.ts`), so a
   path or SQL label full of newlines cannot forge prompt lines outside the untrusted-data block.
9. **Esc during a review** refuses plainly (no failed attempt, no round, no dialog on the
   abandoned dispatch); a prompt sent mid-review cannot have a round, wipe or cached approve
   written into it, because those writes are guarded by the prompt epoch captured when the call
   began (`register.ts`, `thisPrompt`).

What the review raised and 0.5.0 did **not** change, by decision: a `cd` inside a subshell or
inline script still resolves against the root (review, not block); two-sided glob intersection is
not computed; and the breadth of the shipped rule set (which cloud, database and interpreter
programs are named by default) is left to grow as real reports come in, with project rules as the
workaround. These are in the README's "Known gaps" and the review's §4.9.
