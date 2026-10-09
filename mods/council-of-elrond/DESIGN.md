# council-of-elrond: design

Status: **final deliverables** (SPEC §21–22, §12 below), after Stage 6 (themed strings and plain mode; the debate pane, the council check, the wipe counter, the threat meter and the epic drop).
What's next, and the decisions approved after the spec: [ROADMAP.md](./ROADMAP.md). The original spec: [SPEC.md](./SPEC.md).
Targets Claude Code **2.1.294** (built on **2.1.289**, checked on **2.1.291** from Stage 5 and **2.1.294** from
Stage 6). The generated API types are vendored at `mods/types/claude-code.d.ts` (now 2.1.294's) and
are the source of truth over docs, samples and the spec. The 2.1.289 → 2.1.291 drift was additive: a
new `prompt.mention` event, a `Color` type (theme keys or raw colours) for paint props, a `ceiling`
on tool-check inputs, teammate record fields, and doc wording. The 2.1.291 → 2.1.294 drift is
additive for every signature the mod calls: a `prompt.autocomplete` event, text blocks (with
caching) accepted as a model request's `prompt` and `system` beside plain strings, a registered
tool's spec type, a `workflow` field on agent records, and a test-kit `mock.session`. One semantic
addition: a `.catch` handler is now also asked, with `next.error.kind` `re-entry` and `called`
false, where the engine does not run a hook because the event was raised beneath that hook's own
frame. Elrond's handler refuses whenever `called` is false, so such a call fails closed; a
subagent's gated call does not arrive this way: it is reviewed (verified live, §12.1). Whether the
mod's own `$.ui.ask` (an `AskUserQuestion` call) ever does is for the maintainer's terminal check.

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
| j | UI surfaces | Pane (raised on every surface: terminal, desktop, VS Code and mobile; unasked only from 144 columns), band above the prompt (`AbovePrompt`) and mode labels (`SessionMode`) (terminal + desktop only), status line, toast, transcript log line, a notice line under the permission dialog, the AskUserQuestion dialog. Terminal only: progress, turn-duration and info-notice sites; raster and image elements. A mod cannot draw the permission dialog. |
| k | Where nothing draws | Hooks run; what a surface doesn't raise doesn't show: the band and the mode label on VS Code and mobile, and every drawing in `-p`, the SDK and cloud. The types, which win, list `vscode` as a surface that draws a `Pane`, so the Step 0 note that VS Code shows no drawings at all is superseded; whether VS Code paints the pane is for the maintainer's live check. `$.session.surfaces()` is empty in plain `-p`. `$.ui.ask` rejects when dismissed, on "Chat about this", and in `-p`. |
| l | Imports, reload | Static relative imports of plugin files work. Passing `$` to an imported function fails validation. `$.state` survives hot reload and `/reload-plugins`; `/clear`, `/resume`, `/branch` reset it. Module variables and timers don't survive a reload. |
| m | userConfig | Flat fields: string, number, boolean, directory, file; `options`, `multiple` (string list), `default`, `min`, `max`. No objects or nesting. |
| n | Tests | `claude plugin test` runs `*.test.ts`; the test's `on` hooks sit beneath the plugin and stand for the engine. Fake a model with `on('model.complete')`, a process with `on('process.run')`, a user answer with a `tool.call` hook on `AskUserQuestion`, the clock with `mock.clock(on)`. Each test gets 5 s by default. |

## 2. Hooks used (from `claude plugin validate`)

```
hooks: session.start, prompt.submit, command.run{command=council},
       ui.render{component=Pane, requestId=council}, ui.render{component=Pane, requestId=council-debate},
       ui.render{component=AbovePrompt}, ui.render{component=SessionMode}, tool.call
calls: $.clock.after (via epicDrop, runCheck), $.clock.now, $.command.register,
       $.config.set (via councilModel), $.env.get (via loadContext), $.fs.exists,
       $.fs.list (via previewOf), $.fs.read (via appendAudit, councilOutput, fileDiffOf, loadContext,
       reportFrom, scriptsOf, sqlFilesOf, writeOverrides), $.fs.stat (via loadContext, previewOf,
       realPathOf, sqlFilesOf), $.fs.write (via appendAudit, writeOverrides),
       $.model.complete (via probeModel, review), $.process.run (via currentBranchOf, previewOf,
       rangeDiffOf), $.process.spawn (via runCheck), $.session.cwd, $.session.root (via loadContext),
       $.session.surfaces (via escalate, offerRule, openDebatePane, show, showDebate, syncIndicator),
       $.state.get, $.state.set, $.ui.ask (via confirmAllowlist, escalate, offerRule), $.ui.log,
       $.ui.notice, $.ui.open (via openDebatePane, show, showDebate), $.ui.resolve,
       $.ui.status (via syncIndicator), $.ui.toast (via epicDrop, warnOnce)
env reads: HOME
state: council-of-elrond.session, council-of-elrond.panel
```

Re-run for the final deliverables on 2.1.294: the lines are unchanged.

There is no `tool.check` hook: the mod never takes part in the permission decision. The processes it
starts are read-only `git` commands from Galadriel's table (§6, §8), and, for a big operation, the
project checks the user listed in `rules.json` (`gimli.commands`, §8).

## 3. Data flow

```
tool.call ─► classify (pure, rules only)
             │ allow ─► high secret? refuse (audited) · else next(e)     (no state read or written)
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
             │ debate record (watching only, never alters a decision): openDebate before a model
             │   review or the council sits; noteVoice / noteCheck as each answers; closeDebate with
             │   the verdict (aborted on Esc)
             └─ any throw before next ─► .catch ─► refuse
/council ─► parse (pure) ─► output lines ─► pane (where a surface draws) or ui.log; never Claude
/council debate ─► the council-debate pane (opened at any width), else its rows as ui.log lines
ui.render Pane council-debate ─► state ─► debateRows(view.agentId) (pure) ─► Text rows   (reads only)
ui.render AbovePrompt ─► survey? pass · state + clock ─► bandRows (pure) ─► rows, or pass when idle
finish() ─► ran, full council approved, push or merge, themed ─► epicUntil + toast + timer (redraw only)
/council report ─► audit.jsonl.2, .1, current (read) ─► report (pure) ─► the same
```

- **Files.** `hooks/register.ts` is the only file that touches `$`. Rules (`rules/`), config (`config/`), members (`members/`: one file per member, `brief.ts` pairing each member and profile with its prompts, `gimli.ts` the checks' outcomes), routing, the full council's seats (`elrond/council.ts`) and its verdict (`elrond/combine.ts`), escalation, refusal, model choice, the allow rule offered after "allow once" (`elrond/suggest.ts`), the report (`elrond/report.ts`) and the rows the debate pane and the band draw (`elrond/view.ts`) (`elrond/`), state (`state.ts`), audit (`audit.ts`), redaction and strings are pure modules.
- **State.** The session value `council-of-elrond.session` (`types/index.d.ts`, shape version 4), plus `council-of-elrond.panel`, the lines the `/council` pane draws. `resetForPrompt` is the single reset, run on every prompt you send (composer, bridge or SDK origin): it clears rounds, failed attempts, lockouts and the cache.
- **Config.** The shipped defaults are a TS module. Project overrides live at `.claude/council-of-elrond/rules.json`, read once per load, after the mod's own writes (an allowlist entry, an allow rule), and on `/council reload` (never by watching the file). Both writes go through `editOverrides` (`config/write.ts`).

## 4. Failure modes

| Failure | Behaviour |
| :- | :- |
| Hook throws before the call runs | `.catch` refuses ("fails closed"). |
| A high-confidence secret in an allowed call | Refused, audited with tier `allow`; no rounds, no failed attempt, no state write. |
| Hook throws after the call ran | `.catch` replays the real result (`next.called`); the call is not re-run and Claude isn't told a call that ran was refused. |
| A `tool.call` raised beneath the hook's own frame (`re-entry`, from 2.1.294) | `.catch` answers with `called` false and refuses. A subagent's calls do not arrive this way, in the background or the foreground (verified live, §12.1). |
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
| A debate write fails (the state write, the pane open) | Dropped: every one is caught where it is made, and none can delay or alter `proceed()`. The decision, the audit line and the result are the same; the pane shows less. |
| A dispatch throws or is cut off while a review sits | Its debate stays `sitting` (the band keeps its rows) until the next prompt you send, when `resetForPrompt` settles it as aborted. |
| The epic drop's state write, toast or timer fails | Caught in `finish()`; the call's result is unchanged. A reload that cancels the timer leaves the row to hide itself by its time at the next draw. |
| The debate pane is refused (no room, a hook, no surface) | Ignored and not retried; `/council debate` falls back to transcript lines. |
| A council member errors, times out or answers malformed | Counts as that member's block. With no real objection and every check passed, the call comes to you; beside a real block, Claude is refused. |
| The council's deadline has passed before a member is asked (one at a time) | That member gives no verdict (a block); no request is sent. |
| A project check fails, times out or can't start | A block, with its last 20 lines (redacted) for Claude; none of its output in the audit log. |
| A project check ignores being ended | The council stops waiting at its timeout and calls `return()` on the stream, which kills the child (verified live). |
| The current branch can't be read for a `git merge` | The merge counts as one into a protected branch (full council). |
| The range a push or merge would change can't be read (a bad ref; a new branch with no remote named, or a remote with no `<remote>/HEAD`) | For a push that names a remote, the table's fallback against `<remote>/HEAD` is tried once (§13.1). If that can't be read either, the diff reviewer sits out of that council; the others decide. |
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

1. **The secrets scan reads gated calls only.** It sits after the allow step, as SPEC §4 orders it, so allowed calls stay free of work. A `curl` GET with a key in a header or a `git commit` is not scanned. Scanning every call is cheap (patterns only) and could be turned on if you prefer. *Superseded by §13.2.*
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
14. **Permission-check outcomes, told apart by wording** (ROADMAP decision 12). Your refusal at Claude Code's own prompt ("The user doesn't want to proceed with this tool use…", "…take this action right now", read from the 2.1.289 binary) is `refused-by-user` and counts as a failed attempt, whatever `toolErrorsAreWipes` says. An automatic denial ("… needs approval …", verified live in `-p`; deny-rule wording; and "This command requires approval", seen on 2.1.294 for a `git push` in `-p`, §12.1 item 4) is `denied-by-permission` and never counts. Text matching neither is an ordinary tool error. The user-refusal wording is checked first.
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
   - A new branch's push (a range git can't read) falls back to the remote's default branch: §13.1.
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

## 11. Decisions the spec did not cover (Stage 6)

1. **One mode, set at registration.** `strings.ts` holds a module-level mode, `setMode` sets it
   from the `plainMode` option as `register` starts, and `text()` defaults to it. No user-facing call site
   passes a mode, so a new string cannot forget to follow the setting; only the Claude-facing builders pass 'plain'. The mode never changes
   within a session.
2. **What Claude reads is plain in both modes, enforced twice.** A themed refusal would put
   character names into the model's context and invite it to role-play, and a themed reason would
   be written into the audit log and the rules file. So `refusalText`, `combine` and `suggest`
   ask for `'plain'` explicitly, and the key families Claude can read, plus the notices and the report, which stay plain by choice (`refusal.`, `reason.`,
   `alternative.`, `council.`, `gimli.`, `escalate.`, `route.`, `suggest.`, `notice.`, `report.`,
   and the dialog lines that confirm exact data) have no themed variant, which a test asserts.
   `escalate.*` is shown in the dialog but is also embedded in the "nobody to ask" refusal, so it
   stays plain too.
3. **What is themed** is only what the user reads and the spec names: the `who.*` names, the
   loot roll (header, title, closing line and the three labels), Leeroy mode (label, status and
   the `/council off` line), wipes in the status, and one flavour line per member and verdict
   (plain variant empty; read through `flavourOf`, which is undefined in plain mode and for an
   unknown pair). The dialogs that confirm exact data (the allowlist entry, an allow rule) keep
   the plain header and text.
4. **Ids and "council" are not theme text** (§6.16 stands). Plain mode still prints the member ids a
   user types (`[gandalf]`), because they are config keys, and "council" is the product's plain
   name. The plain-mode tests strip bracketed ids before scanning for theme words.
5. **The loot roll's labels compare exactly in the mode in use.** `escalate` reads the mode once
   and uses that one value both to offer the options and to interpret the answer. Reading it twice,
   or interpreting in plain while offering themed labels, would turn "Need: allow once" into an
   instruction for Claude and refuse the call; a test covers it, and the other direction (plain
   labels typed in themed mode are an instruction, not a decision) is tested too.
6. **No `ui.render` hook on `AskUserQuestion`.** The review's amendment (§5 item 5) drops it: the
   dialog is themed through the question, options and header passed to `$.ui.ask`, which already
   fit the tool's schema, and a rewrite hook would add a second path to keep in step with them.
7. **One state value, shape version 4.** The debate pane, the band, the epic drop and the
   open-once rule all read the one session value, so there is no second atom to keep in step with
   `resetForPrompt` and no way for two views of a review to disagree. It gained `debates` (the
   newest eight, newest last; a review is a few hundred characters, so the cap bounds the value),
   `epicUntil` and `debateOpened`. Version 4 means an older value reads as a fresh session, as
   every earlier bump did. The updaters in `state.ts` are pure and applied only as
   `update($, session, value => fn(sessionOf(value), …))`, which retries on a miss, so two
   calls in flight cannot overwrite each other's debate. `resetForPrompt` settles any debate
   still `sitting` as `aborted` but keeps the history (the pane is a record, not a per-prompt
   scratch) and leaves `epicUntil` alone (the row hides itself by its time). A voice that is
   still waiting when a debate closes becomes "no verdict" and a check still running becomes
   "stopped", so no row says "reviewing" for a review that is over. Reasons are redacted in
   register.ts before they are stored, then cut to 400 characters on one line in `state.ts`; the
   call text is redacted by `callText` and cut to 300.
8. **What is drawn is data first** (`elrond/view.ts`). The pane and the band are built from rows
   (`text`, a theme colour key, bold, dim) by two pure functions, so every case is tested without
   mounting and register.ts only turns a row into a `Text`. Colours are theme keys, never raw
   colours, and every symbol comes with a word (`✓ approve`, `✗ no verdict`, `… reviewing`), so a
   terminal without colour loses nothing. Decisions the brief left open, taken as the safer
   reading: a council debate that is done also gets a plain `Verdict:` row (the combined verdict
   is the one fact the member rows don't carry, and plain mode would otherwise show no verdict at
   all); a failed, timed-out or unstartable check gets Gimli's flavour line in themed mode; the
   blank rows between sections are empty `Text` rows, which the mount accepts.
9. **The debate pane is its own pane id, `council-debate`,** so the `/council` command's output
   (id `council`) keeps the user's last command and the two show as tabs. A single hook per pane
   id draws it, and it reads state only: a pane that wrote while drawing would be refused, and a
   draw may run many times a second. It draws for `view.agentId`, because the engine keeps one
   pane instance across a switch of the transcript in view; without the filter a subagent's
   review would sit in the main conversation's pane, and the other way round. It is opened
   unasked once per session, at the first model review or full council, with no `focus` (the
   person's keys are not ours to take) and `rows: 12` for inline placement; the mod never
   measures the terminal, because the engine already keeps an unasked open undrawn below 144
   columns. The flag is claimed before the open, so a parallel call does not open it too, and a
   refused open is not retried: a pane the person closed by hand stays closed. `/council debate`
   answers the person's command, so it is placed at any width; where nothing draws or places it,
   the same rows go to `ui.log`, as every other `/council` output does.
10. **Recording a review is watching, never deciding.** Everything is keyed by the call's
    `tool_use_id`, with the call's `agentId`, so two calls in flight (batched calls, subagents)
    each keep their own debate. A single review opens its debate just before `review()` and
    settles it when the verdict, the failure or Esc is known. A full council opens its debate
    before `convene`, which reports each voice and each check as it resolves through a callback
    and waits for those writes before it returns, so `closeDebate` always lands last. Every write
    is caught where it is made, none touches `proceed()` or the order of the pipeline's
    decisions, and the `.catch` of `tool.call` is as it was; a test breaks the state write on
    purpose and confirms the verdicts and results do not change.
11. **The wipe counter and the threat meter are in the pane, not the band.** A permanent band row
    would take a row of the screen all session for a number that rarely matters; in the pane it
    is read when asked for. The counter uses the same three numbers `/council` shows (the
    per-verb wipes, the operations they fell on, those locked out), through one helper
    (`attemptsOf`) used by both, so the two can't disagree after a success clears an operation.
    The meter lists only reviewers that have blocked, most first, as a bar of up to ten blocks
    with the exact number beside it.
12. **What is themed here.** Plain variants describe; themed variants only for the band header
    ("Ready check"), the pane title ("The debate"), the wipe counter, the threat meter and the
    epic drop. The new keys are `debate.*`, `band.*` and `epic.*`, none in a family Claude reads,
    which the existing test holds to no themed variant. The epic's plain variants are empty,
    because plain mode never reads them (and a plain string may not hold the theme's words).
13. **The epic drop is cosmetic, themed only, and cannot touch a result.** It needs all of: the
    call ran, a full council sat for this very call and approved it (a cached approve, a failed
    council allowed once, and a shadow-mode block do not count), it was a push or a merge
    (`rangeOf`), and the mode is themed. `finish()` stores `epicUntil` (the clock reading plus
    eight seconds), raises the toast and arms a timer that clears it. The timer is only a redraw
    trigger: a hot reload cancels pending timers, so the band hides the row on any draw at or
    after `epicUntil`, and `clearEpic` clears the stored time only once it has passed (an early
    timer cannot cancel a newer drop). All of it is caught, so a failure never changes what
    `finish()` returns. No flash primitive exists, so none is faked.
14. **The band is the full council's, and passes otherwise.** The `AbovePrompt` hook returns
    `next(e)` while a survey holds the band, when no council of this view sits, and when no epic
    row is due, so it takes no row it does not need. Single-member reviews never draw there. It
    reads the clock, which is a `$` call and costs no hook budget, and the band is the same under
    either transcript, so the sitting is matched to `view.agentId` like the pane; the epic row
    belongs to the session, so either view shows it.
15. **Surfaces, from the types.** `Pane` is raised on every surface; `AbovePrompt` and
    `SessionMode` on terminal and desktop only (§1 rows j and k are corrected to say so). The
    tests mount the pane on all four surfaces and the band on terminal and desktop. A mounted
    drawing re-reads on its own after a `$.state` write (the `read` in a render hook subscribes
    it), so a test mounts once and reads again. The kit mounts one instance per pane id.
    Whether VS Code paints the pane is for the maintainer's live check.
16. **No approval ahead of the permission check** (SPEC §22), as the review proposed (§5, item 8):
    the mod registers no `tool.check` hook, which `claude plugin validate` shows and CI fails on,
    and a test asserts that `$.tool.check` resolves to exactly what the bottom hook answers for an
    allow, a review and a block call, with no review, question or process on the way.

## 12. Final deliverables (SPEC §21–22)

### 12.1 Live checks on 2.1.294 (headless)

Run with `claude -p --plugin-dir … --output-format stream-json --verbose` in a throwaway
`git init` repository, on Claude Code 2.1.294, with default permissions.

1. **A subagent's gated call is reviewed, not refused by the `re-entry` path.** The main
   conversation called the `Agent` tool (allowed, so Elrond passed it through `next(e)`); the
   subagent ran `ls` and then `rm -r build`. `ls` ran. `rm -r build` reached Elrond's `tool.call`
   hook, was classified (`shell-delete`, review), reviewed by the destructive-operations reviewer
   on Sonnet (approve, 980 tokens, 1.9 s), passed to `next(e)`, and was then denied by Claude
   Code's own permission check, as `-p` denies with nobody asked (`outcome:
   "denied-by-permission"`). The audit line carries the subagent's `agentId`. The same held with
   the subagent explicitly in the foreground (`run_in_background: false`, the engine reporting
   `is_backgrounded: false`): reviewed (987 tokens, 2.5 s), then denied by the permission check.
   So a subagent's call is not raised "beneath" the hook's own frame: the `.catch` handler's
   refusal on `re-entry` did not fire, and nothing in the handler changes.
2. **A new branch's push reads its range against `<remote>/HEAD`** (§13.1). In a probe repository
   with a bare `origin` and a `feature` branch the remote did not have: with `origin/HEAD` unset
   (a `git remote add`, not a clone), the diff reviewer sat out (`skipped`) and the other two
   approved (1,896 tokens); with `origin/HEAD` set (`git remote set-head origin main`), all three
   sat and approved, the diff reviewer on the fallback range (3,036 tokens, 1.9 s). Both pushes
   were then stopped by Claude Code's own permission check, as `-p` stops a push with nobody to ask.
3. **An allowed call with a high-confidence secret is refused** (§13.2). `echo token=<a fake AWS
   key>` is allow-tier; it came back as the secrets scan's refusal with the key redacted, no model
   was asked, and the audit line reads `tier: "allow"`, `member: "gollum"`, `verdict: "block"`,
   `outcome: "refused"`, `opKey: null`.
4. **A denial wording the mod does not know.** The permission check's refusal of the push in `-p`
   read "This command requires approval", which matches neither the user-refusal nor the
   automatic-denial patterns (§6.14), so the line's outcome is `error` rather than
   `denied-by-permission`, and it counts as a failed attempt under the default setting. The `rm`
   probe above was denied with the known "needs approval" wording. Fixed: the wording is now an
   automatic denial (§6.14).
5. Five model reviews ran in all (about 6,900 tokens).

What this does **not** settle: whether the mod's own `$.ui.ask` (an `AskUserQuestion` call raised
inside the hook) ever reaches the `.catch` as `re-entry`. `-p` has no surface, so the mod refuses
before asking, and that path cannot be reached headless. The test kit runs the escalation tests
unchanged, and `done.test.ts` proves the question never reaches the gate (a project rule blocking
`AskUserQuestion` does not stop it). The maintainer's terminal check ("Allow once" runs the call)
settles it live.

### 12.2 Definition of done: evidence

| Item (SPEC §22, with the end-of-Stage-5 amendments) | Evidence |
| :- | :- |
| Every §19 test passes | The table in §12.3; `claude plugin test` passes (413 tests across 18 files). |
| No path where a gated call runs after a reviewer failure without your answer (enforcing) | `done.test.ts`, "in enforcing mode, a reviewer failure never runs a gated call without your answer": every failure kind × every answer that is not "allow once", the full council blocked only for want of verdicts, a spent budget and a switched-off reviewer with nobody to ask; plus `.catch` refusing before `next` (`pipeline.test.ts`, "the hook failing before the call runs refuses it") and Esc (§10.9). Mutation-checked: making the dismissed, chat and nobody-to-ask answers allow the call failed 41 tests, these among them. Shadow mode passes by design (§6.10). |
| No approval ahead of the permission check | §11.16: no `tool.check` hook (CI), and `debate.test.ts`, "$.tool.check resolves to exactly what the bottom hook answers". |
| Plain mode shows no theme text | §11.2–4: `theme.test.ts`, `view.test.ts`, `debate.test.ts` (plain mode). |
| With every model member disabled, the rules, the secrets scan and escalation still work | `done.test.ts`, "with every model member disabled, …": block, allow, ask, protected path, review shell call, Edit, `psql`, `git push` (big operation), a high and a low secret, no model request. Mutation-checked: making "keep blocked" allow the call failed 37 tests, every keep-blocked case here among them. |
| The README states the limits plainly | README "Known gaps in shell parsing" and "What it does not protect against" (bypass added). |

### 12.3 SPEC §19, bullet by bullet

Test names are given as `file › describe › test`. `done.test.ts` holds the owner tests added for
the final deliverables.

| §19 bullet | Covered by |
| :- | :- |
| Rules: allow, review, ask, block, compound, protected paths, unmatched calls, script execution | `rules.test.ts › tiers` (allow: read-only commands and unmatched calls pass; review: state-changing commands; review: script execution, inline code and evaluation; ask: privileges and protected paths; block: recursive deletes…, force pushes…, DROP or TRUNCATE…; compound: the strictest part wins, nested parts included); `rules.test.ts › protected paths: …` (4); `pipeline.test.ts › allow`, `› block` |
| Routing: each member and profile gets its triggers, Gandalf as fallback | `routing.test.ts › each member gets its own triggers` (4), `› Gandalf is the fallback` (6), `› in the pipeline › a switched-off member falls back to Gandalf`, `› with the member and Gandalf off, the call comes to the user` |
| Model members: approve, revise, block for each | `routing.test.ts › in the pipeline › <member>: approve runs the call unchanged`, `› <member>: revise and block refuse, naming the member` (per member and profile); `pipeline.test.ts › review by Gandalf` (approve, revise, block); `gandalf.test.ts › verdict parsing › approve, revise and block parse` |
| Approve path goes through `next`, nothing pre-approved | `pipeline.test.ts › review by Gandalf › approve: the call goes through next with its arguments unchanged`; `› allow › the mod adds no permission decision of its own`; `debate.test.ts › no approval ahead of the permission check` |
| Arguments never rewritten | `pipeline.test.ts › approve: … arguments unchanged`, `› escalation › ask tier: allow once runs the call unchanged`; `council.test.ts › every member sits on the council model, in parallel, and approve runs the call unchanged`; `routing.test.ts › <member>: approve runs the call unchanged` |
| Refusal text contains every required field | `pipeline.test.ts` (`REFUSAL_FIELDS` asserted on block, revise and reviewer block); `rounds.test.ts › two refusals use the rounds…` (rounds left); `theme.test.ts › refusalText names the role, never the character` |
| Rounds: 2-round cap and escalation, rephrased retry | `rounds.test.ts › rounds › two refusals use the rounds; a rephrased retry then goes to the user, not the model`, `› a typed instruction resets the rounds`; `operations.test.ts › two non-approve verdicts use up the rounds; approve uses none` |
| Escalation: each answer; the rule suggestion written only on confirm | `pipeline.test.ts › escalation` (allow once, typed text, dismissed, nobody to ask); `done.test.ts › "Chat about this"`; `theme.test.ts › the loot roll` (Need, Pass); `suggest.test.ts › the offer after "allow once"` (written only on "Add the rule"; "Not now"; dismissing) |
| Failure paths: reviewer error, timeout, malformed verdict, budget exhausted | `pipeline.test.ts › fail closed` (API error, timeout, empty reply, malformed verdict, refused request; token budget spent; budget of zero; Gandalf off; the hook failing); `done.test.ts › in enforcing mode, a reviewer failure never runs a gated call without your answer` (62) |
| Full council: strictest wins, one member failing, Gimli failing, shared deadline | `council.test.ts › combining verdicts` (4), `› the full council in the pipeline › strictest wins…`, `› one member failing blocks…`, `› one member failing beside a real block refuses…`, `› the project checks › a failing check blocks…`, `› the shared deadline` (3) |
| Gollum: high and low, redaction, allowlist, written only on confirm | `gollum.test.ts › the scan` (7), `› in the pipeline › a high finding is refused without asking anyone, and nothing leaks`, `› a low finding asks with a redacted snippet…`, `› the allowlist is written only after the second confirm, then honoured`, `› cancelling the confirm writes nothing and refuses` |
| Galadriel: never runs the proposed command, timeout | `galadriel.test.ts › in the pipeline › never runs the proposed command; the preview reaches the reviewer`, `› a timeout gives no preview, and the review goes on`; `› the plan comes from the table alone` (7) |
| Gimli: only configured commands, timeout | `council.test.ts › the project checks › only the configured commands run, by argv, in the project root, and only for big operations`, `› a check past its own timeout is ended and blocks…` |
| Wipes: counting, lockout, resets | `rounds.test.ts › failed attempts and lockout` (7); `operations.test.ts › three failed attempts lock the key; five lock the verb`, `› success clears its own operation, and a new prompt clears them all` |
| Cache: approve reused, block not reused | `rounds.test.ts › cache › an approve is reused for the identical call this prompt…`, `› a block or revise is never reused` |
| Modes: shadow, bypass, plain | `commands.test.ts › shadow mode` (4), `› bypass › /council off passes gated calls unreviewed and logged…`; `theme.test.ts › the strings table › plain mode carries no theme text`, `› plain mode (the plainMode option)` (3); `debate.test.ts › plain mode`; `view.test.ts › plain rows carry no theme text…` |
| Config: broken file, unknown schema version, overrides win | `config.test.ts › a file that is not JSON falls back…`, `› an unknown schema version is a broken config`, `› a valid file merges: project rules first…`; `pipeline.test.ts › config › a broken overrides file warns and the shipped rules still enforce`; `rules.test.ts › project overrides` (4) |
| Fallback where nothing draws | **Owner:** `done.test.ts › fallback where nothing draws` (3). Also `pipeline.test.ts › where nothing draws, nobody is asked…`, `commands.test.ts › its output never reaches Claude…`, `debate.test.ts › where nothing draws it is not opened…` |
| Audit log: fields, no contents, no secrets, rotation | `pipeline.test.ts › audit log › records every field, and never contents or secrets`, `› rotates by size`; `operations.test.ts › a secret in a target never reaches the key`; `council.test.ts › a failing check blocks… none of its output reaches the audit log` |
| No re-entry from the mod's own calls | **Owner:** `done.test.ts › no re-entry from the mod's own calls` (3: questions; previews and model requests; project checks and writes), each with a project rule blocking `AskUserQuestion`. Also `pipeline.test.ts › the mod's own question does not re-enter the gate`. Live: §12.1. |
| Commands: `/council test` runs nothing, `/council report` reads the log | `commands.test.ts › test classifies only: no process, no model, nothing runs`; `council.test.ts › /council test names the full council… and runs nothing`; `report.test.ts` (11, over rotated files, unparseable lines and an unreadable file) |

## 13. Decisions after the final deliverables

1. **A new branch's push has a range** (`orElse` in `members/galadriel.ts`, `runGitInspection` in `hooks/register.ts`). A push of a branch the remote doesn't have yet has no `<remote>/<branch>` ref, so `git log <remote>/<branch>..HEAD` and the council's `git diff` failed: no commits in the preview, and the diff reviewer sat out.
   - **The table.** A git `Inspection` may carry `orElse`, a second fixed entry (label and argv) tried only when the first exits non-zero or fails. Nothing else is ever run; the fallback is as fixed as the first entry.
   - **Why `<remote>/HEAD`.** It is the remote's default branch, which a new branch is almost always cut from, so it is the nearest range git can read that says what the push adds. It exists only if the clone set it (a normal `git clone` does).
   - **Two dots for the log, three for the diff.** The log is `<remote>/HEAD..HEAD`: the commits on this branch that the default branch lacks. The diff is `<remote>/HEAD...HEAD`: the changes since the branch point, which is what the push adds, and it does not show unrelated work the default branch has gained since.
   - **Only with a named remote.** `pushRange` returns the fallback only when the push names a remote that passes the ref check. A push with no remote has no known remote (the upstream could be anywhere), so it has none, and a name that would read as an option gets neither range nor fallback. A merge gets none.
   - **Not a fourth step.** The fallback is an alternative to one step, not a step: it does not count against the three-inspection cap, so a preview starts at most one extra process. `previewOf` and `rangeDiffOf` share `runGitInspection`, which runs the first argv, then (when it exits non-zero or throws) `orElse.argv` once with the same working folder, environment and 5 s timeout. The fallback's label stands only if it succeeds; if it fails too, the outcome is as before (no commits in the preview; the diff reviewer sits out, "the changes could not be read").
   - **Legolas's brief** carries the range that was read as its `path`, so the reviewer sees `origin/HEAD...HEAD`; its prompt needed no change.
   - `/council test` runs nothing and is unchanged.

2. **Allowed calls are scanned for high-confidence secrets** (the `allow` branch of the `tool.call` hook in `hooks/register.ts`). Before an allowed call passes, `scanCall` runs with the shipped and configured patterns and the allowlist; a high finding refuses the call with the same refusal as a gated one (`who.gollum`, `reason.secretHigh`, `alternative.removeSecret`). A low finding is ignored there.
   - **Why now.** The spec put the scan after the allow step so that allowed calls stay free of work. A pattern scan of the call's text is cheap, and a literal key in an allowed `curl` or `echo` reached the network or the transcript unscanned.
   - **High only.** A question on an allowed call would turn every `echo` with a token into a dialog; the mod never asks on an allowed call.
   - **Audited.** A refusal writes one line (`tier: allow`, `member: gollum`, `verdict: block`, `outcome: refused`, `opKey: null`, `decision: null`, the labels as the reason, `agentId` when a subagent made the call), so `/council report` counts it among the refusals, "by the secrets scan". A clean allowed call still writes nothing.
   - **No state.** An allowed call has no operation, so there are no rounds, no failed attempt, no lockout and no wipe, and nothing is read from or written to the session state: §5.9 holds.
   - **Every mode.** The branch runs before shadow mode and bypass are read, so the scan enforces in shadow mode, as the gated scan does (§6.10). Switching the secrets scan off turns it off here too.
   - **The offered allow rule** is unchanged: still never offered for a call with any secrets finding, since the low finding you allowed once would otherwise pass unseen.
