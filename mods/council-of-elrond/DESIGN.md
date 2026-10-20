# council-of-elrond: design

Status: **final deliverables** (SPEC §21–22, §12 below), after Stage 6 (themed strings and plain mode; the debate pane, the council check, the wipe counter, the threat meter and the epic drop).
What's next, and the decisions approved after the spec: [ROADMAP.md](./ROADMAP.md). The original spec: [SPEC.md](./SPEC.md).
Targets Claude Code **2.1.304** (built on **2.1.289**, checked on **2.1.291** from Stage 5, **2.1.294** from
Stage 6, and **2.1.296**, **2.1.299** and **2.1.304** after it). The generated API types are vendored at `mods/types/claude-code.d.ts` (now 2.1.304's) and
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
The 2.1.294 → 2.1.296 drift is additive for every signature the mod calls: `$.ui.notify` (a
terminal notification, with its `ui.notify` event), `requestMeta` on a `tool.call` input (the
`_meta` of an MCP server's request), `meta` on MCP tool results, `children` on `Button`,
`autoCompactWindow` on agent definitions, and new built-in tool fields (`Read`'s `allow_large`, a
web search result's `snippet`). One semantic change: a `deny` returned after the tool answered
without error now withholds that result (the model reads "`<tool>` ran, and a plugin withheld its
result: …") where it used to leave it as the answer. Elrond only denies before `next(e)`, so
nothing changes for it. The wording re-read from the binary is in §12.4.
The 2.1.296 → 2.1.299 drift is additive for every signature the mod calls: `$.session.identity`,
`$.prompt.media` (a submission's attachments), `command` (the slash command a submission runs) and
`isMeta` on `prompt.submit`'s input, a skill's frontmatter and source on `skill.prompt`, spacing
tokens (`Space`) and text sizes and weights on elements, and new built-in tool fields. Two semantic
changes were found by probe rather than in the types (§12.5): a hook that overruns its own-time
budget is now cut off, its `.catch` asked with `kind` `timeout`, and a `next(e)` it makes afterwards
is refused; and a hook that blocks the hooks worker for 5 s has the worker replaced and its `.catch`
asked with `kind` `throw`. Elrond's handler refuses in both cases, so both fail closed.
The 2.1.299 → 2.1.304 drift is additive for every signature the mod calls. The additions:
- a `prompt.change` event (the prompt box's text changed by history, undo, a plugin or the app);
- `$.ui.view`, which shows an agent's transcript;
- a key-or-layers form of `$.settings.read`;
- a result from `$.env.set` (`{ deny? }`);
- `isUnverified` on instruction files;
- `decider` (`host` or `person`) on a `tool.check` verdict;
- new element props and built-in tool fields.

One removal: `HookFailure` no longer has the `re-entry` kind or its `cause`. A hook that the engine does not run, because the event was raised beneath its own frame, is now skipped without its `.catch` being asked; the C3 cloud log on 2.1.303 shows exactly that (§14.1). Elrond never relied on that path. The wording and the probes are in §12.6.

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
hooks: session.start, session.detach, session.attach, prompt.submit, command.run{command=council},
       ui.render{component=Pane, requestId=council}, ui.render{component=Pane, requestId=council-debate},
       ui.render{component=AbovePrompt}, ui.render{component=SessionMode}, tool.call
calls: $.clock.after (via epicDrop, runCheck), $.clock.now, $.command.register,
       $.config.set (via councilModel), $.env.get (via loadContext), $.fs.exists,
       $.fs.list (via previewOf), $.fs.read (via appendAudit, councilOutput, fileDiffOf, loadRules,
       reportFrom, scriptsOf, sqlFilesOf, writeOverrides), $.fs.stat (via loadChild, loadContext,
       previewOf, realPathOf, sqlFilesOf), $.fs.write (via appendAudit, writeOverrides),
       $.model.complete (via probeModel, review), $.process.run (via currentBranchOf,
       runGitInspection), $.process.spawn (via runCheck), $.session.append (via announce), $.session.cwd,
       $.session.root (via loadContext),
       $.session.surfaces (via announce, escalate, offerRule, openDebatePane, relayOf, show, showDebate,
       syncIndicator),
       $.state.get, $.state.set, $.ui.ask (via confirmAllowlist, escalate, offerRule), $.ui.log,
       $.ui.notice, $.ui.open (via openDebatePane, show, showDebate), $.ui.resolve,
       $.ui.status (via syncIndicator), $.ui.toast (via epicDrop, warnOnce)
env reads: HOME
state: council-of-elrond.session, council-of-elrond.panel
```

Re-run after C2 (§13.5): `session.detach` and `session.attach` hooks, and `$.session.append`
(via `announce`); `relayOf` joins the `$.session.surfaces` callers. Re-run for the final
deliverables on 2.1.294: the lines were unchanged. Re-run on 2.1.296: unchanged
but for `$.process.run`, now reached through `runGitInspection` (the push-range change after the
final deliverables). Re-run on 2.1.299: unchanged. Re-run for C5 (§14.5): `loadContext`'s file read
goes through `loadRules`, and `loadChild` joins the `$.fs.stat` callers.

There is no `tool.check` hook: the mod never takes part in the permission decision. The processes it
starts are read-only `git` commands from Galadriel's table (§6, §8), and, for a big operation, the
project checks the user listed in `rules.json` (`gimli.commands`, §8).

## 3. Data flow

```
tool.call ─► classify (pure, rules only; against each repository the call touches under a
             │             multi-repository root, the strictest wins: §14.5)
             │ allow ─► high secret? refuse (audited) · else next(e)     (no state read or written)
             │ gated: fingerprint, operation key ───────────────────────── audit, count
             │ bypass ─► next(e)
             │ block ──► refuse (rule reason)                            failed attempt
             │ locked out (3 on the key / 5 on the verb) ─► refuse, "stop retrying"
             │ Gollum: high ─► refuse ("remove the secret")              failed attempt
             │         low ──► ask ─► allow once / allowlist (confirm, write, reload) ─► continue
             │ ask ─────► escalate ─► allow once ──► notice, next(e) ─► ran? offer an allow rule (pure,
             │                     │                 checked by classify) ─► add: write, reload
             │                     └► keep blocked / dismissed (or Chat about this) / nobody ─► refuse  failed attempt
             │                     └► instruction ─► refuse, rounds reset; talk first ─► refuse
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
- **State.** The session value `council-of-elrond.session` (`types/index.d.ts`, shape version 4), plus `council-of-elrond.panel`, the lines the `/council` pane draws. `resetForPrompt` is the single reset, run on every prompt a person sends (composer or bridge origin) except a `/council` command: it clears rounds, failed attempts, lockouts and the cache. Any other prompt, `sdk` included, clears only the cache (§14.3).
- **Config.** The shipped defaults are a TS module. Project overrides live at `.claude/council-of-elrond/rules.json`, read once per load, after the mod's own writes (an allowlist entry, an allow rule), and on `/council reload` (never by watching the file). Both writes go through `editOverrides` (`config/write.ts`). Where the session root is the parent of several repositories, each repository's own file is read the same way, once per repository, and a call is classified against the repositories it touches (§14.5).

## 4. Failure modes

| Failure | Behaviour |
| :- | :- |
| Hook throws before the call runs | `.catch` refuses ("fails closed"). |
| A high-confidence secret in an allowed call | Refused, audited with tier `allow`; no rounds, no failed attempt, no state write. |
| Hook throws after the call ran | `.catch` replays the real result (`next.called`); the call is not re-run and Claude isn't told a call that ran was refused. |
| A `tool.call` raised beneath the hook's own frame (`re-entry`, from 2.1.294) | `.catch` answers with `called` false and refuses. A subagent's calls do not arrive this way, in the background or the foreground (verified live, §12.1). |
| Hook overruns its 10 s own-time budget | **From 2.1.299 the engine cuts the hook off** (probed headless, §12.5): its `.catch` is asked with `kind` `timeout` and `called` false, and refuses; a `next(e)` the hook makes afterwards is refused by the engine. The Stage 0 probe found the test kit does not cut a hook off, even with `.catch`, so calls still pass only through `proceed()`, which refuses when `next.budget.remainingMs` < 1 s. The hook's own work is bounded to make an overrun unlikely: commands over 20,000 characters aren't parsed (review), parse depth ≤ 4, ≤ 200 parts. |
| A hook blocks the hooks worker (no yield for 5 s) | From 2.1.299 the engine replaces the worker, keeps the plugin loaded and asks the hook's `.catch` with `kind` `throw` and `called` false: refused (probed headless, §12.5). `session.start` runs again in the new worker. |
| The `prompt.submit` hook fails (throws, times out, or blocks the worker) | Its `.catch` passes the prompt through unchanged and the mod stays loaded; the per-prompt reset is skipped for that prompt (§13.6). |
| Model error, timeout (`timeoutMs`), empty reply, malformed verdict, request refused | Escalate to you; "keep blocked" refuses. |
| Token budget spent / no enabled member can take the call (the named one and Gandalf off) | Escalate without a model call. |
| The file a diff needs can't be read (over 4 MiB, permissions) | The diff shows the call's own text and the prompt says so; the review goes on. |
| A `.sql` file the call names is missing, unreadable, or lands outside the project (by name or real path) | Left out of the database reviewer's context; the review goes on. |
| Nobody can be asked (no surface) | Refuse, naming the operation, the rule and the reviewers' names (never their reasons) and the way to let it run; a failed attempt (§13.5 e). |
| The start notice can't be appended (`$.session.append` rejects, or resolves `{ deny }`) | A debug line (`notice.appendFailed`); `session.start` goes on and returns `next(e)`. Nothing is retried; the refusal still tells Claude why (§13.5 d). |
| The status sync after a roster change fails (`session.attach`, `session.detach`) | Caught where it is made; the hook returns what `next(e)` gave. The status line keeps its last value until the next sync (§13.5 f). |
| `$.ui.ask` dismissed / "Chat about this" | Refuse, a failed attempt (recorded as `dismissed`; the two cannot be told apart, §12.4). "Talk first" refuses without counting (recorded as `chat`). |
| Overrides file broken, unknown version, invalid field | Ignored whole; shipped rules enforce; a transcript line lists errors by field, plus a toast. Each repository's file under a multi-repository root is checked on its own and warns once (§14.5). |
| Audit write fails | Logged to the debug log (`notice.auditFailed`); never changes a decision, and the queue goes on to the next line. Nothing waits for the queue: a write that never returns holds back only the lines queued after it, never a decision or a later call (§13.4 d). `/council log` and `/council report` read the files, so they may not show a line still queued. |
| Two Claude Code sessions in one project share the audit log | `$.fs` has no lock and no append, so each write reads the whole file and writes it back: lines of the two sessions can interleave, and a line can be lost when two writes cross. Each session's own writes are queued in order. `/council report` skips any line it cannot parse (§13.4 e). |
| A preview inspection fails or times out (5 s) | That inspection is left out; no preview is never a reason to allow or block. |
| Writing the allowlist fails, or `rules.json` is broken | Nothing is written (a broken file is never rewritten); the call stays blocked, with a transcript line. It is not a failed attempt: the failure is the mod's, not Claude's, so it counts toward no lockout. Cancelling the confirm still is one (§13.4 h). |
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
| Esc during a review or a council | The model requests abort and the check processes are killed with the dispatch (and `convene` ends its own checks on the dispatch's signal too). The mod then refuses plainly, whatever the partial answers were (§10.9): no dialog opens on the abandoned dispatch, no round and no failed attempt is counted, no tokens or verdict counts are added, the debate is closed `aborted`, and the call is audited as `refused` with verdict `aborted` and no decision. |
| A check outlives a council that throws | Not any more: `convene` ends its checks in a `finally`, so a throw (a `$` call rejecting between members) ends them at once instead of at their own timeouts. The call is then refused, as any throw before the call runs (§13.4 b). |
| The stored session record has the wrong shape | Read as a fresh session (`sessionOf` checks the shape, not only the version), so the call is decided as usual; one debug line (`notice.sessionMalformed`) is logged per gated call that reads such a value, and the first write that follows replaces it (§13.4 g). |
| A `$.state` write fails in a path that is not wrapped (a count, a round, a wipe) | Before the call ran: the hook throws and the call is refused ("fails closed"). After it ran: the `.catch` replays the real result and the call is not run again. The debate, panel and epic writes are wrapped and only drop. No code path writes state while a `ui.render` hook draws (those hooks only read it), so there is no refused write-while-drawing to deny a call. |
| Looking at a directory below the root fails (`$.fs.exists` rejects) | The lookup of that repository is not cached and the call throws, so it is refused ("fails closed"). A `$.fs.stat` that fails is read as "not a repository" (cached). Both only under a multi-repository root (§14.5). |
| `$.session.root()`, `$.session.cwd()` or `$.env.get('HOME')` fails | Every call is refused, the allow tier included, with "fails closed": the project folder cannot be classified against, so nothing is passed. Kept as fail-closed. The context is not cached on failure, so the next call tries again. `fs.stat(root)` failing is the exception: it is tolerated (the real path is taken to be the root itself). |
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
8. **What counts as a failed attempt.** It counts: a block-tier refusal, a high secret, a reviewer's revise or block, keep blocked, dismissed, nobody to ask, and a cancelled allowlist confirm. A gated call that ran and errored also counts (`toolErrorsAreWipes`). It doesn't count: a lockout refusal, "Talk first" (the dialog's own option; the engine's "Chat about this" is a dismissal and counts), a typed instruction. A successful run (approved, allowed once, cached or bypassed) clears its own key. The per-verb counter clears only on a new prompt.
9. **The cache lives until your next prompt** (keyed on the prompt epoch, not `turn.start`'s `turnId`, which subagent turns would complicate). A config reload clears it too.
10. **Shadow mode** shadows the second opinion only. Verdicts are logged with `shadow: true` and use no rounds or failed attempts; a reviewer failure, a switched-off reviewer or a spent budget passes (logged). Rules, protected paths, the ask tier, the secrets scan and lockouts still enforce. The session switch wins over the `/config` setting.
11. **`/council model`.** A one-request probe (16 tokens) checks the model first. `--save` writes only the `gandalf` row (the only `/config` model row so far) and only picker values; anything else stays session-only and says so.
12. **`/council` output** is drawn in a pane (`$.ui.open` from the command, so it seats at any width) where a surface draws, else as `ui.log` lines. Verified live: a plain `claude -p "/council …"` prints nothing, and in stream-json the lines arrive as `system/ui_log` messages; the command's result carries no text.
13. **The mode label** is added to `SessionMode` (terminal and desktop). `$.ui.status` carries it only when a surface without that site (VS Code, mobile) is attached, so the terminal doesn't show it twice.
14. **Permission-check outcomes, told apart by wording** (ROADMAP decision 12). Your refusal at Claude Code's own prompt ("The user doesn't want to proceed with this tool use…", "…take this action right now", read from the 2.1.289 binary) is `refused-by-user` and counts as a failed attempt, whatever `toolErrorsAreWipes` says. An automatic denial ("… needs approval …", verified live in `-p`; deny-rule wording ("Permission to use|edit|read … has been denied", the edit and read forms read from the 2.1.296 binary); and "This command requires approval", seen on 2.1.294 for a `git push` in `-p`, §12.1 item 4) is `denied-by-permission` and never counts. Text matching neither is an ordinary tool error. The user-refusal wording is checked first.
15. **Redaction fixes.** The assignment pattern now matches JSON-escaped quotes (`\"hunter2\"`), which Stage 1 missed in file-tool call text, and leaves an already-redacted value alone, so redacting twice is stable (a test in `tests/gollum.test.ts` redacts every shipped pattern's sample twice).
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
| Fallback where nothing draws | **Owner:** `done.test.ts › fallback where nothing draws` (3). Also `pipeline.test.ts › where nothing draws, nobody is asked…`, `commands.test.ts › its output is not the command text…` (and `relay.test.ts`, §13.5), `debate.test.ts › where nothing draws it is not opened…` |
| Audit log: fields, no contents, no secrets, rotation | `pipeline.test.ts › audit log › records every field, and never contents or secrets`, `› rotates by size`; `operations.test.ts › a secret in a target never reaches the key`; `council.test.ts › a failing check blocks… none of its output reaches the audit log` |
| No re-entry from the mod's own calls | **Owner:** `done.test.ts › no re-entry from the mod's own calls` (3: questions; previews and model requests; project checks and writes), each with a project rule blocking `AskUserQuestion`. Also `pipeline.test.ts › the mod's own question does not re-enter the gate`. Live: §12.1. |
| Commands: `/council test` runs nothing, `/council report` reads the log | `commands.test.ts › test classifies only: no process, no model, nothing runs`; `council.test.ts › /council test names the full council… and runs nothing`; `report.test.ts` (11, over rotated files, unparseable lines and an unreadable file) |

### 12.4 Wording re-read from the 2.1.296 binary

Read with `grep -a` from the installed binary (`/upgrade-types` step 5), not live; the minified code
around a string was read where the string alone did not settle the question.

- **User refusal: unchanged.** "The user doesn't want to proceed with this tool use" and "The user
  doesn't want to take this action right now" are both in the binary, and `USER_REFUSAL` matches
  them. This settles the roadmap's terminal-check item on these wordings.
- **Automatic denial: unchanged, plus two.** "… needs approval …", "This command requires
  approval", "requested permissions to edit / read from …", "… but you haven't granted it yet" and
  "Permission to use … has been denied" are all there and matched. The binary also has "Permission
  to edit … has been denied." and "Permission to read … has been denied." for a deny rule on a
  file, which no pattern matched; `AUTOMATIC_DENIAL` now matches them (§6.14).
- **"Chat about this": the `/chat/i` match in `interpretRejection` is wrong.** Picking the option
  denies the `AskUserQuestion` call with the feedback "The user wants to clarify these questions.
  …"; "chat" appears only in the option's label and its internal value. `$.ui.ask` then rejects
  with `<plugin>: $.ui.ask: no answer (<the call's deny or result text, cut to 120 characters>)`.
  The result text of a call denied with feedback should open with "The user doesn't want to
  proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string
  was NOT written to the file)." (151 characters), as a dismissal's does, so the 120 characters
  left would be the same for both. Even if the feedback reached the mod uncut, it holds
  "clarify", not "chat". Either way `interpretRejection` returns `dismissed` for "Chat about this",
  which counts as a failed attempt, against ROADMAP decision 4 ("not a wipe"). The tests pass
  because the fixture fakes the rejection as "The user chose to chat about this instead", text the
  engine never sends. Decided 2026-10-13 (ROADMAP decision 4, amended): the dialog has its own
  "Talk first" option, which is a real answer and not a failed attempt; the engine's "Chat about
  this" counts as a dismissal.

### 12.5 Re-read and re-probed on 2.1.299

The `/upgrade-types` run for 2.1.299: the binary read with `grep -a`, and one headless
`claude -p --plugin-dir` run per behaviour, with a throwaway probe mod (not Elrond) in a throwaway
repository.

- **Refusal wordings: unchanged.** Both user-refusal wordings are in the binary and `USER_REFUSAL`
  matches them. Every automatic-denial wording found is matched by `AUTOMATIC_DENIAL`, including two
  not recorded before: "The <name> connector requires approval for this call." and "Permission for
  this tool use was denied. It requires approval, and this session has no approval surface …".
  `$.ui.ask`'s rejection is unchanged: `<plugin>: $.ui.ask: no answer (<the call's deny or result
  text, cut>)`, or "the dialog was dismissed".
- **A hook that overruns its own-time budget is cut off.** A `tool.call` hook that spent 11 s in
  `$.clock.sleep` had its `.catch` asked at about 10 s, with `next.error.kind` `timeout` and
  `next.called` false. Its later `next(e)` was refused by the engine ("next() after it settled;
  refused"), and the call did not run. This replaces the Stage 0 finding for the live engine (§4);
  `proceed()` stays as the guard the test kit needs.
- **A hook that blocks the hooks worker.** A `tool.call` hook spinning without yielding for over 5 s:
  the engine got no heartbeat, replaced the worker, kept the plugin loaded and asked its `.catch`
  with `kind` `throw` and `called` false. The call did not run. The plugin's `session.start` ran
  again in the new worker.
- **`$.ui.ask` in `-p` rejects** at once, now because a `-p` session has no `AskUserQuestion` tool
  ("`$.tool.call: no tool named "AskUserQuestion" in this session`"). Elrond never reaches it there:
  `escalate` checks `$.session.surfaces()` first.
- **`$.process.spawn` ends on `return()`.** A `sleep` ended by `stream.return()` from a
  `$.clock.after` timer after 1.5 s was gone 0.5 s later, with no orphan.
- **A slash command in `-p` raises no `prompt.submit`.** `/probe hello` reached `command.run`
  (origin `sdk`) only; a plain `-p` prompt raised `prompt.submit` with origin `sdk` and no `command`.
  Whether a slash command typed in a terminal raises `prompt.submit` with the new `command` field
  set is not checked. If it does, a person's `/council` command no longer runs the per-prompt
  reset (§13.6).
- **Skipped:** `/council` output as `ui_log` in stream-json, already checked live on 2.1.299 in C2
  (§13.5 h).

### 12.6 Re-read and re-probed on 2.1.304

The `/upgrade-types` run for 2.1.304 read the binary with `grep -a` and made one headless `claude -p --plugin-dir` run per behaviour. The runs used a throwaway probe mod (not Elrond) in a throwaway repository, except the last, which ran Elrond.

- **Refusal wordings: unchanged.** Both user-refusal wordings are in the binary and `USER_REFUSAL` matches them. Every automatic-denial wording found is matched by `AUTOMATIC_DENIAL`.
- **A hook that overruns its own-time budget is still cut off.** A `tool.call` hook that spent 11 s in `$.clock.sleep` had its `.catch` asked with `kind` `timeout` and `called` false. Its later `next(e)` was refused ("next() after it settled; refused").
- **`$.process.spawn` ends on `return()`.** A `sleep 30` ended by `stream.return()` from a `$.clock.after` timer finished after 1.5 s, with no orphan.
- **`$.ui.ask` in `-p` rejects at once** with "`$.tool.call: no tool named "AskUserQuestion" in this session`".
- **`/council status` in stream-json** arrives as `ui_log` events, with `num_turns: 0`.
- **Not probed:** a hook that blocks the hooks worker. The types still say its worker is replaced and its `.catch` asked with `kind` `throw`.
- **Worth a look for C4: `decider` on `tool.check`.**
  - A `tool.check` hook that answers `ask` with `decider: 'person'` makes the ask one that only a person settles. The types say: "No machine's allow settles it, and any machine's refusal still refuses: the classifier's block, a PermissionRequest hook's deny … Where nobody can be asked it is a deny."
  - That is the guarantee the C3 probe found `$.ui.ask` lacks (§14.1).
  - Probed headless for C4 in §14.2: it holds against every machine inside the engine, but a host program's allow settles it. The cloud is still unchecked.

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

3. **H1: the secrets scan and protected paths** (`hooks/redact.ts`, `hooks/members/gollum.ts`, `hooks/rules/globs.ts`, `hooks/config/defaults.ts`). Compound names, more vendor formats, redaction that keeps code, and protected paths that hold below the session root.
   - **(a) The assignment prefix is any run of letters, digits and `_`.** The roadmap row says a name "ending in `_`", but `PGPASSWORD`, which the same row names, has no `_`. The safer option catches it. The pattern is still `low`, and it stays linear: one `\b`, a class capped at 64 characters (`{0,64}`), then the keyword, so a long run of word characters costs one pass per start and no more (the table-wide timing test in (i) scans 200,000 of them). A name prefix longer than 64 characters is not matched.
   - **(b) `db/migrate/**` is prefixed with `**/` too,** though the C5 row omits it: a migrations folder of a nested repository is as much a protected path as its CI config. `**/migrations/**` already was.
   - **(c) A `kind` per pattern drives the password warning.** `SecretPattern.kind` is `'password'` or `'token'` (absent means `token`). Shipped as `password`: `assignment`, `mysql-password`, `connection-string-empty-user` and `connection-string-password`; everything else, `random-token` included, is a token. A short password is guessable from its `sha256:` fingerprint, so for a `password` finding the allowlist confirm adds a line (`ask.confirmAllowlistPassword`, plain text). `GollumFinding.kind` is filled from the pattern, and `warnsPasswordFingerprint` in `members/gollum.ts` is `finding.kind === 'password'`; `register.ts` only composes the question. A pattern in `rules.json` `gollum.patterns` may set `kind` too (`"password"` or `"token"`, anything else is a validation error), so a project's own password format gets the warning.
   - **(d) Indexing is a code reference for redaction only.** `isPlaceholder` moved from `members/gollum.ts` to `redact.ts` (one copy, exported with `LONG_TOKEN`) and is the scan's test, unchanged from before H1: `token = tokens[0]` is a finding again. Redaction uses its own `isCodeReference` (see (g)), which accepts an indexed lookup. `redact` leaves a low match whose secret part is a code reference as written. Redaction stays idempotent (§6.15): a test redacts a text holding every shipped pattern's sample twice.
   - **(e) A leading `**/` keeps the directory itself protected.** The matcher's `prefix` is the literal head before the first wildcard, which a leading `**/` makes empty. `protectedMatcher` now reads the prefix from the glob with that `**/` removed and records `anyDepth`; for such a glob a candidate that equals the prefix or ends with `/` + prefix matches, case-insensitively. So `rm -rf app/.git` and `rm -rf app/.claude` ask, as `rm -rf .git` and `rm -rf .claude` do at the root. The `sample` is unchanged (it already drops `**/`).
   - **(f) Also decided.** `**/migrations/**` and `**/.env` now get the same any-depth directory protection (`rm -rf app/migrations` asks); the prefix comparison is case-insensitive like the rest of the matcher; the `mysql-password` pattern bounds its lazy run to 200 characters (`{0,200}?`), so a long line of repeated `mysql` words costs linear time; the new low patterns are placed after the high ones and after `assignment`, which changes nothing since each pattern scans the original text and findings are de-duplicated by fingerprint. The table-wide timing test (i) found the scheme of the two connection-string patterns quadratic on a long run of scheme characters with no `://` (`sk-ant-` repeated took seconds), so a match starts at the first character of any run of scheme characters, `(?<![a-z0-9+.-])([a-z0-9+.-]+:\/\/`, and each run is walked once: linear, with no cap on the scheme's length (a test uses a 40-character scheme, an `x-postgres://` prefix, a `1x://` scheme and a `-foo://` run). The match covers every string the old `\b[a-z]` form did, from an earlier start (a run may now start with a digit, `+`, `.` or `-`).
   - **(g) Redaction errs toward hiding; the scan may miss.** Redaction uses its own, narrower `isCodeReference`, applied only to a low pattern with a name before the value (`keep`), so a format with no name, such as a JWT (dotted words), is always redacted. A value is left readable only when it: starts with one of `$ % < { ( * [`; contains `(`; is a dotted identifier path (`process.env.API_TOKEN`); is an identifier path with indexes (`tokens[0]`, `config.keys[name]`); is a type or literal word (`string`, `number`, `boolean`, `bigint`, `symbol`, `object`, `any`, `unknown`, `never`, `void`, `null`, `undefined`, `none`, `str`, `int`, `float`, `bool`, `bytes`, `true`, `false`, case-insensitive, optionally followed by `[]` or `?`); or is one character repeated (a mask). Any other value, an all-letter word such as `correcthorse` included, is redacted even though the scan does not flag it: the scan's `isPlaceholder` still treats an identifier without a digit as code, so detection may miss an ambiguous value, but redaction never shows one. The redaction test in `tests/gandalf.test.ts` keeps its original `correcthorse`.
   - **(h) Absolute paths outside the root.** With the `**/` prefixes, an absolute path outside the session root that holds one of these entries (another repository's `.git/...`, `~/.claude/settings.json`) now asks too, since paths outside the root are matched by their absolute form. This is the safer side, kept.
   - **(i) One timing test across the table.** A test iterates `SECRET_PATTERNS` and, for each pattern, scans and redacts adversarial inputs of 200,000 characters (a run of one word character, the pattern's prefix repeated, repeated with spaces, with a long run after it, with a long run before it) in under 1,000 ms. A hand-written map gives each shipped id its prefix, and a pattern with no entry fails the test, so a new pattern must add one.
   - **(j) Approved 2026-10-13:** decisions 1 to 7 above and the narrower redaction test were approved by the user after the H1 checkpoint.

4. **H2: pipeline robustness** (`hooks/register.ts`, `hooks/state.ts`, `hooks/audit.ts`, `hooks/elrond/commands.ts`, `hooks/strings.ts`). The findings are REVIEW-2026-10 §2.5 to §2.11; the rows are ROADMAP's "H2" table.
   - **(a) `command.run` needs a person for what loosens the gate** (§2.9). `needsPerson(command)` in `elrond/commands.ts` is true for `off` (bypass on), `shadow on` and `model` (a switch or clearing one, a bad member or usage included: the kind decides, so `model` with a bad slot is also refused). `on`, `shadow off`, the `model` listing (`models`), `reload` and every other subcommand answer any origin. The hook checks `needsPerson` and then `HUMAN_ORIGINS` (`composer`, `bridge`, `sdk`: the set `prompt.submit` already uses, not a second list); a refusal changes nothing and shows one line (`cmd.needsPerson`) through `show()`. `sdk` counts as a person until C3 shows which kind the web client's commands arrive with (ROADMAP C3) (dropped 2026-10-20, §14.3); a `plugin`, `peer`, `scheduled-trigger` and `task-notification` origin do not. Test kit: `$.command.run` in a test takes the whole `command.run` input, and a call without `origin` reaches the hook with none, so the tests' `council()` helper (`tests/fixtures.ts`) sends `{ kind: 'composer' }` and the presentation by default, and a test passes another origin to try it.
   - **(b) The checks end with the council** (§2.6). The body of `convene` after `stop` is created runs in a `try`/`finally`: `stop.abort()` and removing the listener run on every exit, so a throw no longer leaves a check to its own timeout (up to 600 s). The dispatch's `signal` is chained into `stop` (abort at once if it is already aborted), so an Esc ends the checks through the mod's own path as well as the engine's. A `$.model.complete` rejection does not reach it (`review` catches that and returns a failed voice); the test makes a `$.clock.now()` read between two members fail, which does.
   - **(c) The log rotates by bytes** (§2.7). `isRotation(current, line, maxBytes)` in `audit.ts` compares UTF-8 sizes (`byteLength`) and both `appendAudit` (whether to read `.1`) and `appendPlan` (whether to rotate) use it, so the two can no longer disagree. Before, `appendAudit` compared characters, so with multibyte text it skipped reading `.1` and the log rotated with `.2` never written.
   - **(d) Nothing waits for the audit queue** (§2.7). `audit()` queues the line and returns; `finish()` and the allowed-call refusal no longer await it. The queue keeps its order and its `.catch` (a failed write is logged to debug with `notice.auditFailed` and the queue goes on). The kit showed that a `$.fs.write` started by the hook still lands after the hook has returned, in order, a few event-loop turns later, so every line is still written. A write that never returns holds back only the lines queued after it; a decision, the call, and the next gated call are not delayed. Two consequences: a `/council log` or `/council report` run straight after a call may not see its line yet, and the tests read the log through `auditLines(w)`, which is now asynchronous and first calls `settled(w)` (it takes zero-delay event-loop turns, or settles the mocked clock, until the fixture's file calls stop; no fixed wait). A direct read of the log file from `w.files` does the same first. A test with an audit-file write that never resolves (`w.writeHangs`) checks the next gated call still returns its result.
   - **(e) Two sessions on one log** (§2.7): documented only (README, near the audit log and in its limits; §4). `$.fs` has no lock and no append, so two sessions in one project can interleave or lose lines; `/council report` already skips lines it cannot parse.
   - **(f) The concurrency model, and one snapshot per call** (§2.5).
     - *The model.* The session is one `$.state` value changed only by `update`, which reads, applies a pure function and writes with `ifVersion`, retrying on a miss. So every counter (tokens, rounds, failed attempts, verdict counts) is exact however many calls run together. What can be a read behind is a decision made from a value read earlier.
     - *Which checks re-read.* A gated call takes one snapshot at the top and uses it for bypass, shadow, the cache hit, the out-of-rounds check, the latest prompt, the written paths, the model switches and the prompt epoch. Two checks read again, just before they decide, and decide on the fresh value: the lockout (step 5) and each token-budget check (`holdCouncil` and the single-member review). They are the limits another call moves while this one waits (its preview and git reads sit between the snapshot and the budget check), and a miss passes a call that should have been stopped. `refuse` already read afresh for the rounds left.
     - *Last reader wins.* Everything else stays on the snapshot: two calls with the same fingerprint running together each see the cache empty and are each reviewed (a cost, never a wrong decision); both can pass the out-of-rounds check and each verdict then adds its round; the cache and rounds are written by whichever finishes last, atomically. Nothing is locked.
     - *A caveat.* The types say "every `get` of one dispatch reads one moment, whatever is written meanwhile". The test kit does not behave so within a call (`refuse` reads the rounds an `update` just wrote, and the tests rely on it), and `update` could not retry if it did. Whether the engine holds one moment per dispatch is not verified live; if it does, the re-read is harmless and changes nothing. A test pins the reads by number (read 2 is the lockout's, read 3 the budget's) through `watchState` in `tests/fixtures.ts`, so a change to the number of reads before them moves those tests with it.
   - **(g) The session is validated by shape** (§2.9). `isSession(value)` in `state.ts` checks the version, every top-level field's type, and the elements of every container the pipeline indexes into: each `ops` entry (`rounds`, `wipes`), `counts` entry, `models` value, `verbWipes` value, string array, review time and `debates` entry (and its voices and checks, with their statuses). `sessionOf` returns `INITIAL_SESSION` for anything that fails, so the call is decided normally (before, `v === 4` alone let a broken record throw in `opOf` and deny every gated call until `/clear`). The updaters stay pure. The debug line is logged in the `tool.call` hook, once for the snapshot of a gated call whose stored value is defined and fails the check (`notice.sessionMalformed`); the first write replaces the record, which ends it. A value of another version fails the check too, so it logs the line once as well. The status lists it compares against (debate kinds, statuses and verdicts; voice and check statuses) are copied from `types/index.d.ts` and checked against it at compile time in both directions (`satisfies` for an extra entry, a `never` assertion for a missing one), because a status missing from a list would make every stored record fail the check and reset the session, lockouts included, on each read. The check costs one pass over small containers (the caps are 8 debates, 100 paths, 200 times and 200 operations).
   - **(h) A failed allowlist write is not a failed attempt** (§2.9). In `putToUser`'s allowlist branch, when `writeOverrides` reports `ok: false` the call is refused with `isWipe = false`; a declined second confirm stays a failed attempt. The refusal Claude reads has a reason of its own, `reason.allowlistNotWritten` ("You chose to add this finding to the allowlist, but the entry could not be written, so the call stays blocked."; plain only, as the whole `reason.` family), instead of `reason.userKeptBlocked`, which says the user chose to keep it blocked. The audit decision stays `keep-blocked`.
   - **(i) Times come from `$.clock.now()`** (§2.9). `started`, `latencyMs`, `reviewStarted`, `councilMs` and `memberMs` use it, and so does the audit line's `ts` (`new Date(now).toISOString()`: the result is milliseconds since the epoch, per the types). Under the mocked clock the line reads 1970-01-01 plus the mocked time, which the tests use to check the latency. In a real session `$.clock.now()` is the system time.
   - **(j) Performance notes** (§2.8). `shownCall` is built on first use (a memoized function, with the redacted call text it wraps shared with the debate record), so block, lockout and cached paths, which never show it, no longer stringify and redact the whole input; a write of several megabytes was the case that mattered. No caps: the fingerprint and `classify` still read the whole input, and the review paths still build the call text for the brief (`briefOf` and the council's range read build their own). Revisit if latency shows. There is no test of the laziness: the call text it avoids is not observable except as time. The `ui.render` hooks (the `/council` pane, the debate pane, the band and the mode label) only read state, so drawing costs the dispatch nothing and no state is written while drawing.
   - **(k) Literals moved into `strings.ts`** (§2.9): the `/council` command's description and argument hint (`cmd.description`, `cmd.argumentHint`; plain only) and the audit-write-failed debug line (`notice.auditFailed`). The command's usage line (`cmd.help`) already held the same hint and is unchanged.
   - **(l) §4 rewritten to match the code** (§2.10): the Esc, allowlist and audit rows, and new rows for a check outliving a throw, a malformed session, a failed state write, `session.root`/`cwd`/`env.get` failing (fail-closed, allow tier included, kept) and two sessions on one log. The review's "a refused `$.state` write while drawing denies" has no row of its own: no path writes state in a `ui.render` hook, so it cannot happen; the row on an unwrapped write failing says what does.
   - **(m) Tests added** (§2.11). `tests/robustness.test.ts` (the snapshot reads, a malformed session, the `.catch` replay after the call ran, a prompt during an in-flight review, Esc mid-review and mid-council, a check ended with a throwing council, the allowlist write, the audit log, the clock, `/council reload` clearing the cache), `tests/state.test.ts` and `tests/audit.test.ts` (the pure checks), and the origin tests in `tests/commands.test.ts`. Esc is made in the kit by a plugin loaded above the mod (`plugins: [ESC]`, tier `prepend`) that answers after five mocked seconds without waiting for the mod: the engine then aborts the dispatch beneath it, and the test reads what the mod did meanwhile; the fixture's `model.complete` answers "aborted" at once when its request is aborted, as the engine's does. The call's own result is the plugin's, so the refusal text the mod builds for Claude is not asserted there (the audit line and the state are). Not added: the `proceed()` budget-guard test, since the kit reports an unbounded budget.

5. **C2: speaking through Claude where nothing draws** (`hooks/elrond/relay.ts`, `hooks/register.ts`, `hooks/elrond/commands.ts`, `hooks/strings.ts`). ROADMAP's C2, approved 2026-10-13: a scoped exception to approved decision 1 ("command output never reaches Claude"). Where `$.session.surfaces()` is empty (the cloud web client, `-p`, the SDK) nothing the mod draws reaches the person and the model is the only channel, so four `/council` outputs, a start notice and the nobody-to-ask refusal go through it. The deciding logic is pure and sits in `relay.ts` (`isRelayed`, `relayContext`, `nobodyToAsk`, `noticeText`, `routeText`); register.ts reads the surfaces and the origin and wires it. The strings Claude reads here are plain only (`relay.` is a Claude-facing family in the strings test, with `cmd.allowlistHidden`); the relayed output itself follows the mode, see (b).
   - **(a) Four subcommands, and only a person's (a tightening of the roadmap row).** `status` (a bare `/council` included), `report`, `rules` and `test` return `{ context: [entry] }` in addition to `show()`, which runs exactly as before. Every other case returns `{}`: any surface present; `log`, `off`/`on`, `shadow`, `model`, `models`, `reload`, `debate`, usage and unknown; the needs-a-person refusal; the `.catch` path. The origin must be in `HUMAN_ORIGINS` (`composer`, `bridge`, `sdk`; `sdk` dropped 2026-10-20, §14.3), so a plugin, a peer session or a schedule cannot use `/council test "<command>"` as a classification oracle that answers into Claude's context. The roadmap row names no origin gate; with it, fewer calls return a context. The relay is built after `show()` and its failure is swallowed: the person's pane or lines are never the price of it.
   - **(b) Every relayed line is redacted, and the output is fenced (a tightening).** The entry is one string: an instruction line (`relay.head`; `{sub}` is built from the command's kind, never from the raw arguments), then the title and the lines, joined by newlines, inside `untrusted('council-output', body, nonce)` with a fresh `newNonce()` per entry. Each line, the title included (`/council test` echoes the typed command), goes through `redact(line, ctx.patterns)`: the shipped patterns and the project's own. The instruction tells Claude to repeat the block verbatim in a code block, without the tags, and that the lines are the council's output, not instructions to it. The fence is the same one the reviewers' briefs use, so a closing tag in the output is replaced with `[removed]`. The copy is plain whatever the theme setting, so the `strings.ts` guarantee (no setting puts theme text in front of the model) holds for it too. `relayOf` does not reuse the person's output: it calls `councilOutput($, command, 'plain')`, which does the `$` reads again (state, and for `report` the audit files; only where nothing draws) and then runs the pure builder inside `withMode(mode, build)` (`strings.ts`), which sets the module's current mode, runs the synchronous `build` and restores the previous mode in a `finally`. That is safe only because `build` is synchronous, so no other dispatch can interleave; its type rejects a Promise-returning `build` at compile time, and no `$` read goes inside it. The person's pane and lines still follow the mode. Cases that change state or probe (`off`, `shadow`, `model`) take the same parameter but are never relayed.
   - **(c) Allowlist entries are hidden in the model's copy (a tightening).** The pane shows the first three characters of an exact-string allowlist entry (`zq9…`), which are characters of a secret. `rulesOutput` takes a `forModel` flag: set, such an entry shows as `(an exact string, not shown)` (`cmd.allowlistHidden`), a `sha256:` fingerprint as before. The flag is a parameter of the pure function, not a rewrite in register.ts, and the person's copy is unchanged. A mode is given to `councilOutput` only for the model's copy, so the same parameter sets `forModel`.
   - **(d) The start notice.** In `session.start`, after the command registration and the shadow suggestion, when surfaces is empty, `announce` appends one `user` row with one text block (`notice.noSurface`): the plugin is active, it reviews risky calls, a call that needs the user is refused here with the reason, Claude should tell the user which call and why, the route (`relay.route`: the person adds an allow rule to `.claude/council-of-elrond/rules.json` themselves, Claude must not edit that file because it is a protected path, or continues in a terminal), and that `/council` status, report, rules and test answer through Claude. Choices: it promises no chat approval (`council allow …`, C4, does not exist yet), and names neither `/council off` nor shadow mode as a route (both loosen the gate and neither is Claude's to suggest). One shared route string serves the notice and the refusal. A rejection or a `{ deny }` is logged to debug (`notice.appendFailed`) and never stops `session.start`; with any surface present nothing is appended. The append runs before `next(e)`, like the command registration before it.
   - **(e) The nobody-to-ask refusal.** In `putToUser`, the `unavailable` branch is split from `dismissed` (which is unchanged). `nobodyToAsk` builds the reason: the generic why-it-came-to-the-user sentence, then `Operation: <operation.key>` (already capped and redacted in `operations.ts`; register.ts redacts it once more with the project's patterns), then `Behind it:` the rule id (`decided.ruleId`, left out if `decided` is undefined) and, when there are opinions, the reviewers by name only (`text(opinion.who)` in plain, each once), joined from `strings.ts` pieces; with neither, `the council`. The alternative (`alternative.noSurface`) tells Claude to tell the user the call was refused and why, with the route. Never in it: the call text (`shownCall()`), the preview, a secrets finding's label or snippet, a diff, a reviewer's reason or problem. It is still built by `refusalText`, still `refuse(…, true)` (a failed attempt), `decision` is still `unavailable`, and the audit line is unchanged. `unavailable` arises only in `escalate`, and only when surfaces is empty, so the branch needs no surface check of its own. The `why` sentence for a low secrets finding says "may be a secret": generic, no label.
   - **(f) The status line follows the roster** (the H2 row "§2.9 `$.ui.status` never cleared", folded into C2). `syncIndicator` now calls `$.ui.status(label)` only while a surface other than `terminal` or `desktop` is present, and `$.ui.status(undefined)` otherwise, so a line set for a phone or VS Code does not outlive it (a terminal alone now clears, which sets nothing visible). New `session.detach` and `session.attach` hooks call `next(e)`, then `syncIndicator`, caught, and return the result; a detach with reason `end` skips the sync because it runs inside `session.end`'s short bound. `session.attach` was added for symmetry: a client that joins gets the label back. There is still exactly one `tool.call` hook.
   - **(g) Tests** (`tests/relay.test.ts`; fixtures stub `session.append` into `w.appended`, with `appendFails` making it resolve `{ deny }`, and echo `session.attach` and `session.detach`). The kit skips a hook that throws, so an append that *rejects* cannot be made; `announce`'s `catch` is defensive and untested. A bottom `session.append` hook must call `next(e)`: the engine pins `role` and `isMeta` on the row, so `w.appended` rows carry them. Two existing tests that asserted no `context` for `/council` with surfaces empty now assert the relayed entry (`commands.test.ts`, `done.test.ts`). The plain-mode and "refusal reads plain" guards now strip the plugin's own name before matching the theme words, since the start notice and the rules path say `council-of-elrond`: an identifier, like a member id, not theme text (`withoutPluginName` in the fixtures). A themed-mode test seeds a reviewer's block in the audit log and checks that the relayed status, report, rules and test carry no theme word while the person's lines in the same run do. Mutation-checked: dropping the surfaces condition, the origin condition, the redaction of the context lines, the detach sync, relaying the person's themed output, and putting `shownCall()` into the refusal each fail a named test.
   - **(h) Checked live, and what is not.** Headless, on Claude Code 2.1.299, with `claude -p --plugin-dir` in a throwaway repository and the default (themed) mode:
     - *The start notice is appended in `-p`.* The run's transcript holds it as a hidden user row (`isMeta`) before the first prompt, so `session.append` works before `session.start`'s `next(e)` resolves.
     - *A command's `context` starts no model turn.* `/council status` ended with `num_turns: 0`, its lines going out as `ui_log` events (themed: "Gandalf") and its context recorded as a hidden user message after the command row (plain: "the destructive-operations reviewer"). So Claude relays it in its reply to the person's next message, not at once.
     - *Claude relays it.* After `/council test "git push --force origin main"`, a resumed run with the prompt "Go on." had Claude repeat the four lines verbatim in a code block, then add one sentence.
     - *The nobody-to-ask refusal.* `sudo -n true` was refused with the rule (`privileged`), the operation and the route, and Claude told the user which call was refused, why, and both ways to let it run. The audit line reads `decision: unavailable`. The operation key drops `sudo` (`shell:true`, as the audit log has always keyed it), so for such a call the rule id carries the meaning. Changing the key is H3's, not C2's.
     - *Not checked live:* the cloud web client itself; whether `$.session.surfaces()` already leaves out a detaching client when `session.detach`'s `next(e)` resolves (if not, the label stays until the next sync); and whether a remote client can attach after `session.start`, which would leave a stale notice (the refusal and the relay re-read surfaces per call). `-p` and SDK runs now get the notice too, as checked above.

6. **`prompt.submit` hardening, after the 2.1.299 types** (`hooks/register.ts`, `hooks/elrond/commands.ts`). Approved by the maintainer on 2026-10-14; both are tightenings.
   - **(a) The hook has a `.catch` that passes the prompt through.** A hook that fails without a `.catch`
     is skipped, and one that blocks the hooks worker can cost the plugin for the session; with a
     `.catch` the plugin stays loaded (probed headless on 2.1.299, §12.5). The `.catch` answers
     `next(e)` whether or not `next.called`: the prompt enters as typed, is never dropped or
     rewritten, and the handler makes no `$` call and no state write, since it gets only 1,000 ms.
     On that path the per-prompt reset is skipped, which can only mean stale counters and so more
     refusals, never fewer (a tightening). A test makes the state write fail and reads, through a
     plugin above the mod, that the engine settled the hook as `caught`, not `skipped`.
   - **(b) A person's `/council` command no longer resets the per-prompt state.** When `e.command` names
     `/council` (`isCouncilCommand` in `elrond/commands.ts`), the hook skips `resetForPrompt` and
     passes `e` down unchanged (`command` is pinned). Only `/council`: a skill or prompt command
     (`/review the diff`) starts a new task and still resets, while `/council` never asks the model.
     The rounds, failed attempts, cached approvals and the prompt the reviewers see therefore stay
     as they were, so a `/council status` between two refused attempts can no longer clear a
     lockout (a tightening). Whether a slash command typed in a terminal raises `prompt.submit` at
     all is not checked (in `-p` it does not, §12.5), so this guard may never fire there.

## 14. Cloud sessions

The first use of the mod in a cloud session: Claude Code on the web, two repositories in one environment, the mod installed by the environment's setup script at a pinned ref. The findings come from that session's engine debug log and from the 2.1.294 types. The work items they raise are C2 to C6 in [ROADMAP.md](./ROADMAP.md) ("Cloud sessions: findings and work items"); the user's guide is docs/INSTALL.md, "Cloud sessions".

| Finding | Evidence |
| :- | :- |
| A setup-script install (`claude plugin marketplace add` at a pinned ref, then `claude plugin install`) loads the mod at session start; no restart is needed. | The engine's debug log: the hooks module loaded at tier `user` and `/council` was registered before the first prompt. |
| The mod enforces in the cloud: rules, model reviews, previews and the audit log all ran. | Two single reviews of about 2 s each, one refusal, audit lines written. |
| The web client is not a render surface. `$.session.surfaces()` is `[]`, so nothing the mod draws reaches the person: no pane, no status line, no toast, no `/council` output. | `RenderSurface` is `terminal`, `desktop`, `mobile` or `vscode` (the types); the log said "nothing attached draws". `$.ui.log` lines go out as `ui_log` events, which the web client does not show. |
| `$.ui.ask` is never attempted in the cloud: `escalate` returns `unavailable` when surfaces is empty, before any ask. So whether the web client could answer the question is unknown. | `register.ts`, `escalate`. The types say the ask rejects "in a `-p` run"; a cloud session is a stream-json session with a remote client, not `-p`, and `AskUserQuestion` is in its tool list. |
| Every call that would come to the user is refused with "nobody can be asked", and each counts as a failed attempt toward the lockout. The refusal text reaches Claude only. | A read of the audit log in that session was refused this way. |
| Project settings are not read for `pluginConfigs`: a repository cannot turn shadow mode on for its cloud sessions. | The log: "no pluginConfigs[...] in user, --settings or managed settings (project settings are not read); every option is its default". |
| With two repositories in one environment, `$.session.root()` is their parent, so the project's `.claude/council-of-elrond/rules.json` is never found: its project checks, protected paths and production patterns do not apply, and the audit log is written outside the repository (lost when the container is reclaimed). The types offer no API that lists workspace roots. | `loadContext` resolves `OVERRIDES_PATH` against the root only. The only root-like APIs are `session.root`, `session.cwd`, `session.repo` and the `DirectoryAdded` hook input. |
| The only text channel that reaches the web client is the model. | A `tool.call` deny's text is the model's error result; a `command.run` result may carry `context` for the model; `$.session.append` with `type: "user"` adds a model-readable row. `$.ui.log` is "not sent to the model" (the types). |

C2 ([§13.5](#13-decisions-after-the-final-deliverables)) acts on the last two findings of the table: where nothing draws, the model is the channel, and a few `/council` outputs, a start notice and the refusal now go through it. The rows above are the state before it.

**The install, checked against the CLI** (2.1.296, in a throwaway home folder). `claude plugin marketplace add 'Deluha/council-of-elrond#<ref>'` declares the marketplace in the user settings with that `ref`. The ref is handed to `git clone --branch`, so it is a branch or a tag; a commit is refused ("Remote branch … not found"). `claude plugin install council-of-elrond@council-of-elrond` installs at user scope by default, matching the trial's "tier `user`", and each `--config KEY=VALUE` lands in `pluginConfigs["council-of-elrond@council-of-elrond"].options` in the same file, the one place a cloud session reads the options from. No confirmation flag is needed, as the marketplace declares no command.

Decisions in recording it:

1. **The guide leads with the setup script**, the route that was tried; organization managed settings stay as the untried alternative. The `SessionStart` hook route is no longer offered: it was never tried, and such a hook does not run in a multi-repository session.
2. **The guide shows `#main` and says to pin a release tag** once releases are tagged (`council-of-elrond--v<version>`, docs/MAINTENANCE.md "Releasing"): a gate that follows every merge changes under a team without its review.
3. **The one-repository limit is in the guide now**, ahead of C5, since a second repository silently drops the project's rules and the audit log.
4. **The README's "nothing is lost" note** now names the cloud as a place where `/council`'s transcript lines are not shown either.

### 14.1 C3: `$.ui.ask` where nothing draws

ROADMAP C3, run on 2026-10-19.

**The probe.** A probe build ran on a branch that was never merged (`probe/c3-cloud-ask-DO-NOT-MERGE`).
- Where `$.session.surfaces()` is empty, it attempted the escalation ask, with no timeout. On a rejection it fell back to the nobody-to-ask refusal.
- It logged the ask, the hook's remaining own-time budget, the prompt and command origins, and the roster. The lines went to a file at the session root and to the debug log, with every string redacted.

**The runs.**
- **The cloud session.** The maintainer ran it once in a cloud session:
  - Claude Code on the web, Claude Code 2.1.303, permission mode Auto;
  - one repository, with the mod installed by the environment's setup script;
  - one gated call, `sudo -n true` (rule `privileged`, ask tier, no reviewer).
- **The terminal.** A second check ran `main` with the same call in a terminal (a GitHub Codespace, 2.1.303, Auto mode).

| Question | Result |
| :- | :- |
| The roster in a cloud session | `surfaces: []`, `surface: null` and `isInteractive: false` at every session start, as in the first trial (the table above). |
| The web client's prompts | Origin `composer`, `isMeta` false, no `command`. Not `bridge`, not `sdk`. |
| Whether the ask reaches the person | **No.** The web client did not show the question. The engine sent the `AskUserQuestion` permission request to the remote host. The host answered 35.8 s later with the first option, "Need: allow once". The answer came back as a `control_response` with no device attestation, and the debug log reads "Slow permission decision: 35750ms for AskUserQuestion (mode=auto, behavior=allow)". The call ran (audit `decision: allow-once`, `outcome: ran`). The person saw nothing and chose nothing. |
| The budget | A pending ask holds the call and does not count against the hook's own-time budget. `remainingMs` was 9989 when the ask started and 9988 when it was answered 35.8 s later. No `.catch` was asked, and the `tool.call` hook settled in 36,054 ms. This is ROADMAP fact 3, confirmed live. |
| Re-entry | The engine skipped the mod's own `tool.call` hook for its `AskUserQuestion` (`skipped: re-entry`), as the types say (§12.1). |
| The start notice | Claude read C2's notice as part of the person's first message, not as a row of its own. It said it could not tell whether the plugin was running. |
| A terminal in Auto mode (`main`) | The question was shown and waited for the person, who answered it after about six minutes (`latencyMs` 365,433). Auto mode does not answer it there. |
| Not measured | The run stopped once the ask had been answered without the person, so these were not measured: the origin of a `/council` command typed in the web client; whether such a command raises `prompt.submit` with `command` set; and the rejection message for a dismissal in the web client. Also not tried: a permission mode other than Auto in the cloud, and the desktop, VS Code and mobile surfaces in Auto mode. |

Decisions:

1. **Never ask where nothing draws.**
   - An answer from `$.ui.ask` does not prove a person chose it: in a cloud session the host answered for them.
   - `escalate` keeps returning `unavailable` before any ask when surfaces is empty, so `main` is unchanged, and no `cloudAsk` option exists.
   - The C3 alternative, mapping a rejection to `unavailable`, does not arise.
2. **C4 goes ahead.** The ROADMAP item was to be skipped only if the client answered the dialog for the person, and it does not: the question never reaches them. A person's prompt in the web client has origin `composer`, which is already in C4's list.
3. **`sdk` in `HUMAN_ORIGINS` is reviewed with C4.**
   - It counted as a person's until C3 named the web client's kind, and C3 named `composer`.
   - Dropping `sdk` would be a tightening. `-p` and Agent SDK turns would then no longer:
     - reset the per-prompt state;
     - run `/council off`, `shadow on` or `model`;
     - get the C2 relay.
   - It changes code, so it goes with C4 and is not made here.
   - *Decided 2026-10-20 (the maintainer): dropped, with the cache rule in §14.3.*
4. **The probe build was installable** by anyone who named its branch while the branch existed. The branch is to be deleted once these results are recorded.
5. **The types are 2.1.299; the run was on 2.1.303.** Regenerate them (`/upgrade-types`) before C4.

### 14.2 C4: `tool.check` and `decider`

ROADMAP C4, step 1, run on 2026-10-20 on Claude Code 2.1.304.

**The probes.** The probe was a throwaway mod, not Elrond, with one `tool.call` hook and one `tool.check` hook. It ran headless with `claude -p --plugin-dir` in a throwaway repository.
- It gated only `echo` commands that carried a marker. For a marked call, the `tool.call` hook noted the call's `tool_use_id`. The `tool.check` hook then answered one of three ways: `{ decision: 'ask', decider: 'person', reason }` (a person ask), a plain `{ decision: 'ask', reason }` as the control, or `decider: 'host'`.
- A host was emulated with `--input-format stream-json --permission-prompt-tool stdio` and a script that answered each `can_use_tool` request.
- A PermissionRequest command hook that always allows came from `--settings`.
- Every log line was redacted.

| Question | Result |
| :- | :- |
| The order | `tool.check` runs inside the `tool.call` hook's `next(e)`: the `tool.call` hook first, then `tool.check`, then `next(e)` resolves. Both carry the same `tool_use_id`, so a `tool.call` hook can pass what it decided to its own `tool.check` hook. A `$.tool.check` query from inside `tool.call` runs the plugin's own `tool.check` hook too, with no `tool_use_id`. |
| `-p`, with nobody to answer | A person ask is a deny in every mode tried: default, `auto`, `bypassPermissions`, `dontAsk`, and default with `--permission-prompts none`. The model reads "Permission to use Bash denied by plugin decider-probe: <reason>". A plain ask in default mode reads "Bash needs approval (asked by plugin decider-probe: <reason>)". Both come back from `next(e)` as `isError: true`. |
| The classifier | In `auto` mode the classifier settled a plain ask, and the call ran. It did not settle a person ask: with nobody to answer, that was a deny; with a host, it went to the host. |
| A PermissionRequest hook | An allowing hook settled a plain ask. For a person ask its allow was ignored, and a host that denied 4 s later decided. Without the delay, the host and the hook race. |
| Allow rules and bypass | An allow rule for the whole tool (`--allowedTools Bash`, core's verdict `allow` with `rule: "Bash"`) did not settle a person ask, and neither did `bypassPermissions`. |
| A host | **A host program's allow settles a person ask:** the call ran. The `can_use_tool` request for a person ask differs from a plain one only by `suppress_always_allow_rule: true`. No field names a person, and nothing in the host's answer shows that one chose. In default mode the request carries the hook's reason (`decision_reason`, with `decision_reason_type: "hook"`). In `auto` mode it carried neither the reason nor the hook (`decision_reason_type: "other"`). A host's deny reached the model as the host's own message, verbatim. |
| `decider: 'host'` from a hook | It behaved as a plain ask, as the types say. |
| The budget | A host answer that took 4 s held the call without counting against the `tool.call` hook's own-time budget (`remainingMs` 9998 afterwards). |
| Prompt origins | Prompts in `-p` and in stream-json input both arrive as `sdk`. So does a slash command in `-p`, at `command.run`. |

Conclusions:

1. **The engine keeps every machine but the host out of a person ask.**
   - The classifier, a PermissionRequest hook, an allow rule and `bypassPermissions` cannot settle it.
   - Where nobody can be asked, it is a deny.
   - That is the guarantee `$.ui.ask` lacks inside the engine.
2. **The host is trusted with a person ask, and told little about it.**
   - In a hosted session, the host's permission callback answers a person ask like any other ask. All it is told is to suppress an "always allow" rule.
   - In a cloud session, that host is the program that answered the C3 question without the person (§14.1).
   - So whether a person ask reaches a person in the web client in Auto mode depends on the cloud host. Only a cloud run can show it, and the mod cannot check it per call.
3. **The mod would still have exactly one `tool.call` hook.**
   - A `tool.check` hook is a separate event. It does not re-enter `tool.call` and raises no `AskUserQuestion`.
   - A design using it would note the decision for the call's `tool_use_id` in `tool.call` and answer it in `tool.check`.
   - If that lookup misses, the hook falls back to core's verdict, which can be `allow`. So such a design would first check with a `$.tool.check` query, and refuse unless the query comes back as a person ask.
4. **What a person sees is the engine's prompt, not the council's question.**
   - The options are the engine's own: never "Talk first", the allowlist, or the allow-rule offer.
   - In Auto mode, the reason may not reach the host.
   - The `-p` denial wording is not one that `isAutomaticDenial` matches.
5. **Pending:** a cloud run of a probe build, and the maintainer's decision on what this changes in C4 (ROADMAP C4).

### 14.3 `sdk` is not a person's

Decided by the maintainer on 2026-10-20, as §14.1 decision 3 left open.

**What changed, and why.**
- `HUMAN_ORIGINS` in `hooks/register.ts` is now `composer` and `bridge`. `sdk` is out.
- The types describe `sdk` as the SDK host's own turn (`claude -p`, the Agent SDK), not typed at a terminal.
- §14.1 found that the cloud web client arrives as `composer`, so `sdk` no longer stood in for it.
- §14.2's origins row confirmed that `-p` and stream-json prompts, and a slash command in `-p`, all arrive as `sdk`.
- `needsPerson` and the C2 relay (§13 items 4(a) and 5(a)) keep using `HUMAN_ORIGINS`, so they now refuse `sdk`: `off`, `shadow on` and `model` change nothing, and `/council` output is not relayed to Claude.

**The cache rule (a tightening for every non-person origin).**
- `resetForPrompt` is what keeps the approve cache to "until the next prompt". A prompt that is not a person's no longer runs it, so without a rule an approval would carry across `sdk` turns. That would be a loosening.
- So `prompt.submit` now clears the cache for any origin outside `HUMAN_ORIGINS`: `sdk`, `peer`, `plugin`, `task-notification`, `scheduled-trigger`, `unclassified` and any kind not known yet. It uses `clearCache` through the same updater as `/council reload`; no new state function.
- A person's prompt is unchanged: it resets, except for a `/council` command, which neither resets nor clears (§13 item 6(b)).
- The hook's `.catch` is unchanged: no `$` call, no state write.

**What deliberately stays.**
- A non-person prompt does not reset rounds, failed attempts, lockouts, wipes, `latestPrompt` or `promptEpoch`.
- So reviewers in `-p` and SDK sessions see no prompt, and a lockout lasts until `/clear`. That is more refusals, never fewer.

**The cost.**
- A headless live check (`claude -p`) can no longer reach the person-only paths: the C2 relay, `off`, `shadow on`, `model`, and C4's typed approvals once built.
- Unit tests cover those paths instead, with an explicit origin.

**Tests and mutation checks.**
- `tests/commands.test.ts` and `tests/relay.test.ts` move `sdk` to the not-a-person lists.
- `tests/rounds.test.ts` has three new tests: an `sdk` prompt and a `task-notification` prompt each clear a cached approval (the reviewer is asked again), and an `sdk` prompt leaves rounds, a lockout, `latestPrompt` and `promptEpoch` as they were while a `composer` prompt resets them.
- Mutation (i): with `sdk` back in `HUMAN_ORIGINS`, the three `commands.test.ts` refusal tests, the relay test for non-person origins and the `sdk` lockout test fail.
- Mutation (ii): with the cache-clearing branch removed, the `sdk` and `task-notification` cache tests fail.

### 14.4 C4: approving in chat

ROADMAP C4, approved 2026-10-20 as the typed route (§14.1 decision 2, §14.2 conclusion 5). Where `$.session.surfaces()` is empty, a person approves or refuses a refused call by typing a line in their next message. The deciding logic is pure: `elrond/chat.ts` (the line parser, the call key, the eligibility test) and `state.ts` (offers, allowances, denials, and their lifetimes). `register.ts` gains effects only: the `prompt.submit` branch, the `unavailable` branch of `putToUser`, and the debug line for an unreadable record.

**How it works.**
- A nobody-to-ask refusal of an eligible call carries a code and records an **offer** in the session. The refusal text is `alternative.noSurfaceChat` in place of `alternative.noSurface`; the reason is unchanged, and it is still a failed attempt.
- The person's next message may hold `council allow <code>`, `council allow <code> session` or `council deny <code>`. `prompt.submit` answers each line against the offers, records the grants, strips every such line from the text and adds one acknowledgement per line to the prompt's `context` (`chat.*`).
- The next gated call with that key meets the grant in `putToUser`'s `unavailable` branch and runs (`chat-allow` or `chat-session`, exactly as the dialog's "allow once" would) or is refused (`chat-deny`).

**Decisions.** Each is a tightening, or neutral; none loosens.
1. **The code is over the exact call, less `description`** (tighter than the roadmap's operation key). `callKey` is `fingerprintOf(tool, input)` with a shell tool's `description` removed, since it only labels the call; every other field stays, `dangerouslyDisableSandbox`, `timeout` and `run_in_background` included. The roadmap's operation key drops flags and paths, so one code would have stood for calls that differ. The code is its first six hex characters; state holds the full 16.
2. **Eligibility is `suggestRule`'s opening test.** A call with `isProtected`, a `block` tier or a `block` finding has no code and no offer, and its refusal is exactly what it was. A high-confidence secret is refused before `putToUser`, so it never reaches this.
3. **`session` has the allow-rule offer's limits.** An offer's `canSession` is `suggestRule(call, classification, compiled, where, { hadSecret, declined: [] }).kind === 'rule'` (a declined rule is the person's own choice and does not bear on eligibility). `council allow <code> session` on an offer that cannot has no effect: nothing is recorded and Claude is told (`chat.noSession`). The refusal offers the session form only when `canSession` is true.
4. **Offers live one person's prompt.** An offer holds the `promptEpoch` it was made in, and a person's prompt answers only the offers of the epoch now ending. `resetForPrompt` then clears them, so a code is good for the next message only; a further message makes it unknown. A prompt that is not a person's keeps them. An offer is recorded only if the session is still in the prompt the call began in (`noteOffer`'s `epoch` argument), so a refusal that lands after a new prompt leaves no offer.
5. **A `once` allowance ends at any prompt.** `resetForPrompt` clears every `once` allowance, and so does a new state function, `forOtherPrompt`, which replaces `clearCache` in `prompt.submit`'s non-person branch (it clears the cache and the `once` allowances; offers, denials and `session` allowances stay). `clearCache` itself is unchanged, since `/council reload` uses it. Denials end at a person's prompt.
6. **Consulted only in the `unavailable` branch.** Where a surface draws, the person is asked as before, even if an allowance exists. The branch checks, in order: a denial for the call (consumed; refusal with `reason.chatDenied`, not a failed attempt, decision `chat-deny`); an allowance (`once` consumed, `session` kept; decision `chat-allow` or `chat-session`; returns `allowed`, so `askUser` calls `allowOnce()` and the low-secrets path carries on to its tier step); otherwise the nobody-to-ask refusal with an offer. A denial wins over an allowance for the same call.
7. **Spending is atomic.** `useChat` finds and removes the denial or the `once` allowance inside one `update`; the call counts it as used only if that write removed it, so two identical calls running together cannot both spend one allowance. `register.ts` reads first (`holdsChat`) only to skip the write when the person has answered nothing for this call.
8. **A shared code is unknown.** If two offers of this prompt share a six-character code (24 bits; rare), the code records nothing and is answered as unknown, rather than picking one.
9. **New audit decisions.** `Decision` gains `chat-allow`, `chat-session` and `chat-deny`; `chat` stays "Talk first". `/council log` prints any decision as it is. `/council report` counts `chat-allow` and `chat-session` with `allow-once` and `allowlist` under "Stopped, then allowed by you", and `chat-deny` among the refusals "by you" (every decision other than `unavailable` already is).
10. **The record is version 5, migrated.** `CouncilSession` gains `chatOffers`, `chatAllowances` and `chatDenials`, validated down to their elements. `sessionOf` reads a valid version 4 value as 5 with the three fields empty (it validates `{ ...value, v: 5, chatOffers: [], ... }`), so an upgrade mid-session keeps rounds and lockouts; any other version still resets. The "unexpected shape" debug line now fires on `!isReadable(stored)`, so a migrated record is not reported as malformed.
11. **Only a person's lines count.** The branch that runs `resetForPrompt` (an origin in `HUMAN_ORIGINS` that is not a `/council` command) is the only one that parses. A `council allow` line from any other origin is ordinary text: it is not stripped and records nothing.
12. **A chat line is a whole line** that, trimmed, begins `council allow` or `council deny` (`/^council\s+(allow|deny)\b/i`). Valid forms have exactly a six-hex code (an optional `council:` prefix; any case, normalised to lower), and `session` only for `allow`. Any other such line is malformed: removed and answered `chat.malformed`. Text that merely contains the words mid-line is not a chat line. The remaining lines are joined unchanged and the trailing newlines trimmed; `rest` can be empty. The reviewers' latest prompt is the redacted `rest`.
13. **Every chat line is stripped, at most 10 are acted on.** Lines beyond ten are removed and answered as malformed, one acknowledgement each. Offers are capped at 20 (the newest, deduplicated by call), allowances and denials at 50 each (the newest). A later command for the same call in one message wins, and an allowance and a denial for one call replace each other.
14. **Acknowledgements echo only the validated code** (and `allow` or `deny`), never the person's line. They are `context` entries, so Claude reads them and the person sees nothing added. A message with no chat line is passed to `next(e)` untouched. The hook's `.catch` is unchanged: on a failure the prompt enters as typed and nothing is recorded, which fails closed.
15. **A prompt with a slash command is never parsed for chat lines** (a tightening). The types say a rewrite of `text` is not applied when `command` is set, so the line would stay visible to Claude while a grant was recorded. `prompt.submit` then takes the existing path (`resetForPrompt` with `e.text`, then `next(e)`) and records nothing; a `/council` command is skipped as before.
16. **The start notice and the refusal tell Claude the route.** `notice.noSurface` gains `relay.chatRoute` (give the user a code exactly as written, and the line to type). The chat alternative tells Claude to make the same call again once the user allows it. The refusal's closing line, `refusal.noRetry` ("Do not retry the same call unchanged"), is the shared template's and is left as it was; the alternative's instruction is the more specific one. This is how the contradiction was resolved: the general rule stays, and the chat alternative names its one exception ("Do not retry it before they answer; if they allow it, make the same call again with the same arguments, the one exception to not retrying it unchanged").

**Not done.**
- No `/council` subcommand lists the offers or allowances.
- Not checked live: the cloud web client, and whether a `context` entry on an emptied prompt reaches Claude there. A headless probe on 2.1.304 showed an empty prompt with `context` enters and Claude reads the context.

**Tests** (`tests/chat.test.ts`; `tests/state.test.ts` for the pure state functions and the shape check; `tests/report.test.ts`). In the fixtures' `surfaces: []` world, with `submit`-style prompts from an explicit origin:
- the refusal carries `council:` and six hex characters equal to the key's first six, with one offer; a protected path and a block rule carry none;
- `council allow` runs the call once (audit `chat-allow`, outcome `ran`), a second identical call is refused with a new offer, and a retry with a different `description` runs;
- the allowance is gone after a person's prompt and after a `task-notification` prompt; `session` runs again after more prompts (audit `chat-session`) and survives a non-person prompt; `session` for a multi-line command or a low secrets finding records nothing and is answered `chat.noSession`;
- `council deny` refuses the next identical call with `reason.chatDenied`, adds no failed attempt and audits `chat-deny`;
- parsing, pure: the valid forms, case, the `council:` prefix, spacing, the malformed forms, a chat line among other lines, mid-line text, the ten-line cap;
- through the hook: a malformed line and an unknown code are answered in `context`, stripped and recorded as nothing; a prompt with no chat line passes unchanged;
- a slash command (`/review`) whose text holds a valid line for a live offer records nothing, and the call is still refused;
- origins: the same line from `sdk`, `peer`, `plugin` and `task-notification` (and the other non-person kinds) records nothing and is left as text;
- an offer from an earlier person's prompt is unknown; a block rule, a protected path and a high-confidence secret are refused after any allow;
- with a surface present the dialog is still asked after an allowance;
- two identical calls after one `once` allowance, run with `Promise.all`: one runs, one is refused. (The kit does interleave them: making the spend non-atomic fails this test.);
- a stored version 4 record reads as 5 with its lockout, pure and through the pipeline.

**Mutation checks** (each broken on purpose, the failing tests named, then restored):
- (i) the origin check removed, so a chat line is parsed for every origin: the three origin tests in `chat.test.ts` fail, and the `sdk` reset test in `rounds.test.ts`;
- (ii) the eligibility check removed, so a protected path gets an offer: "a protected path and a block rule: today's refusal, no code, no offer" and "a block rule and a protected path are refused after any allow";
- (iii) a `once` allowance not consumed: "lets the same call run once; … refused again", the parallel test, and the `useChat` state test;
- (iv) `once` allowances not cleared by `resetForPrompt`: "the allowance is gone after the next person's prompt" and the `resetForPrompt` state test.
- (v) the slash-command guard removed: "a slash command is never parsed: …";

### 14.5 C5: rules per repository

ROADMAP C5, approved 2026-10-20. When the session root is the parent of several repositories (a cloud environment with two attached, a workspace folder), each repository directly below it may have its own `.claude/council-of-elrond/rules.json`, and a call is decided by the repositories it touches. The deciding logic is pure: `rules/classify.ts` (`cwdAfter`, `targetsOf`), `rules/scopes.ts` (everything else below), `audit.ts` and `elrond/chat.ts` (the optional scope tag on a key). `register.ts` finds which candidate directories are repositories (`$.fs.stat`, `$.fs.exists`), loads and caches their files, and wires the results.

**The probe.** A headless run on 2.1.304 with a throwaway mod and a session root holding two `git init` folders:
- `$.session.cwd()` follows a shell `cd` between Bash calls: after `cd repoA`, the next call's cwd was `<root>/repoA`.
- `$.session.root()` stayed the parent.
- `$.session.repo()` followed the cwd: the repository's root inside it, null at the parent.
- A `cd` inside one command does not move `$.session.cwd()` for that call, so the classifier's own `cd` tracking is what places the later parts.

**How it works.**
- *Terms.* The **session root** is `$.session.root()`. A **repository** is a direct child `<root>/<name>` that is a real directory (`$.fs.stat` without following: `isLink` false, kind `dir`) holding `.git` (a directory or a file, `$.fs.exists`). A **scope** is a repository, or the **root scope**: the session root with the root's own config, which is today's context.
- *Mode.* The per-call lookup is on only when the root holds no `.claude/council-of-elrond/rules.json` and no `.git`. Otherwise every call uses the root scope, exactly as before. It is decided in `loadContext` (`Context.isMulti`).
- *The cache.* One entry per child directory, repository or not (a negative result is cached too), in module state beside the root context: a `Map<string, Promise<Scope | undefined>>`. A failed load is not cached, as for the root. `/council reload` clears the map and the root context; the mod's own write to a repository's file reloads that entry alone (and clears the verdict cache, as `reloadContext` does). A repository's file is loaded like the root's (`loadRules`, the same `loadConfig`), keyed per repository so a broken file warns once (`notice.configBroken` with the repository-relative path).
- *A call's targets* (`targetsOf`, pure). Shell tools: the **working directory** each part runs in (the session's, moved by an earlier non-nested `cd` or `pushd`; an unknowable target lands at `/`) and every path word of every part, resolved against that part's directory (the **path targets**). File tools: the file's absolute path, and its real path when known, both as working directories. Any other tool: the session cwd. `cwdAfter` is the one copy of the `cd` logic, used by `classify` and `targetsOf`.
- *The scopes a call touches* (`scopesTouched`, pure). A target below a repository, or equal to it, brings in that repository. A working directory in no repository (the root, a plain child, outside the root, `/`) brings in the root scope; a path target in none brings in nothing. The first target's scope comes first, then first-seen order, each once; if nothing was brought in, the root scope. `register.ts` asks for the candidate children (`candidateChildren`), looks each up through the cache (in parallel), and passes the set that are repositories. With the lookup off the list is the root scope alone.
- *Classification.* `classify` runs once per touched scope, with that scope's config and `root` set to the scope's directory. `combineClassifications` (pure) takes the strictest tier (a tie goes to the earliest scope); `isProtected` is any scope's, `scriptPaths` the union; the winning scope is the **deciding scope**. With one scope the classification is returned unchanged. The operation key, the preview, Legolas's paths, `sqlFilesOf` and `realPathOf` keep the session root, so two repositories' keys never meet.
- *What the rest of the call uses* (`CallContext`: the root context with the deciding scope's `loaded`, and `scopes`, `gitDir`, `allowlist`, `writeDir`). Models, big operations, protected branches and routing: the deciding scope's. Secret patterns, for the scan and every redaction in the call: the union of the root's and every touched scope's, each id once. The secrets allowlist: the intersection of the touched scopes' lists. Git (previews, a range diff, the current branch): the deciding scope's directory. Project checks: those of every touched scope in scope order, each run in its own directory, capped at `MAX_GIMLI_COMMANDS` (8) in all (`checksOf`); the debate record and `/council test` list the same checks. Audit: the one line goes to the log of every touched repository, or to the root's when none was touched (`auditDirsOf`; one file named by an absolute path is written once), and the self-written `.gitignore` is checked once per log folder (a set replaces the boolean).
- *Offers.* The allow-rule offer, the dialog's allowlist option and its write are available only when `writeDirOf` names a directory: the root when the lookup is off, the one repository when the call touched exactly one. Otherwise there is no offer and the dialog does not carry the option. A mod write can therefore never create a root rules file, which would switch the lookup off.
- *Keys.* When the touched scopes are anything other than exactly the root scope, `scopeTagOf` (their directories, sorted, joined with a newline) is mixed into the verdict cache key (`fingerprintOf(tool, input, scope)`) and the chat call key (`callKeyOf(call, scope)`), so an approval in one repository never applies in another. With the root scope alone both keys are byte-identical to before, so existing state and tests are unaffected. The audit line's `fingerprint` stays the plain one.
- *`/council`.* `log`, `report`, `rules` and `models` use the scope of the session cwd (its repository, else the root scope); so does the start-up shadow suggestion. `test` classifies like a real Bash call (all touched scopes, combined) and lists the combined checks. `prompt.submit` and the start-notice relay keep the root context.

**Decisions.** Those marked *approved 2026-10-20* were put to the maintainer and decided; the rest are mine, each with the safer side taken.
1. **Where a rules file may sit** (ROADMAP's C5 row): only at the top of a repository directly below the root. A file in a plain child, or at depth two (`app/sub/`, even with its own `.git`), is never read (the plain-folder and depth-two test, and mutation (i), pin it).
2. **A root rules file wins, and a root that is a repository turns the lookup off** *(approved 2026-10-20)*. Either keeps today's single scope. The lookup is on for any root with neither, even one holding no repository.
3. **The shell target** *(approved 2026-10-20)*: working directories and path words as in "A call's targets". A part runs in the directory before its own `cd`, and its words resolve there too (`cd app` names `<dir>/app`); `classify` itself keeps resolving a `cd` part's words against the directory after it, as before.
4. **The strictest repository decides, and the checks run per repository, eight in all** *(approved 2026-10-20)*. `rm -rf ../lib` and `rm -rf /work/lib` run in `app` are blocked by `rm-recursive-outside-repo`, which measures against the scope's directory (mutation (v)): deleting a repository is like `rm -rf .`.
5. **Outside every repository** *(approved 2026-10-20)*: a working directory in none brings in the root scope, a path merely named in none brings in nothing (`cmd > /dev/null` in `app` stays `app`'s call alone; mutation (iv)). Nothing at all: the root scope.
6. **Audit and commands** *(approved 2026-10-20)*: the line goes to every touched repository's log, else the root's; `/council log`, `report`, `rules` and `models` read the cwd's scope.
7. **Git runs in the repository** *(approved 2026-10-20; two loosening side effects)*. Under a parent root, git in the root fails (it is no repository), so the preview showed nothing and a merge's current branch was unknown, which counts as a merge into a protected branch. Now the preview, a push's range diff and the current branch are read in the deciding scope, so a merge into a branch that is not protected is no longer treated as one, and a reviewer now gets a diff it did not get. The fixtures' default world makes `/work` a repository, so every existing test still runs the lookup off.
8. **Offers only for one scope** (as in the brief). Where it applies, `offerRule` is given the scope's own `where` (its root is the repository), because `suggestRule` classifies again with the rule in place.
9. **An unknowable `cd`** (`cd $X && make` from `app`) lands the later parts at `/`, outside every repository, so the root scope's defaults are brought in beside `app`'s (a working directory in no repository).

*Interpretations, confirmed by the maintainer 2026-10-20.*
- **Audit with the root scope and a repository.** "Every touched repository" is read literally: `cd app && make` from the root touches the root scope and `app`, and writes only `app`'s log. The root's log gets the line only when no repository was touched.
- **`status` and `reload`** still use the root context (the brief lists `log`, `report`, `rules`, `models`, `test` and the suggestion). `status` therefore shows the root scope's models and check count, `models` the cwd scope's.
- **The chat `canSession` flag** is computed against the deciding scope, as `suggestRule` does for the one-scope case, even for a call that gets no allow-rule offer: the session allowance writes nothing, and its key carries the scope tag.
- **A command too long or too complex to parse** has no parts to follow, so only the session cwd is a target (it is still reviewed at least).
- **Two repositories' checks with the same name** keep their names (the debate record finds a check by name, so both show the status of the last result).
- **A plain root** (no repository below it, no file, no `.git`) has the lookup on, so a call outside any repository is offered no allow rule and no allowlist entry; `{"schemaVersion": 1}` at the root turns the lookup off and brings them back. The existing offer tests needed the fixture root to be a repository for this reason (12 failed without it, all offers and allowlist writes).
- **Looking up costs file calls.** Each distinct child named by a call is statted once per load (a `$.fs.stat` and an `$.fs.exists`), in parallel. `targetsOf` parses the command a second time.

**Not done.**
- The prompt's redaction (`prompt.submit`) still uses the root's patterns, as does the relay.
- A repository created after the session started is seen only after `/council reload`; there is no watching.
- No `$.session.repo()` use: it follows the cwd and cannot name the repositories a command names.
- Checked live headless on 2.1.304 (`claude -p --plugin-dir`, a throwaway root holding `app`, whose rules file has an ask rule for `echo deploy-marker` and the protected path `config/secret/**`, and `lib`, with none). `/council test "cd app && echo deploy-marker"` gave ask by the project rule; the same in `lib` gave allow. A Write to `app/config/secret/key.txt` was refused as a protected path and logged in `app`'s audit log. The same Write in `lib` was not protected (the shipped `file-write` review, one Sonnet review, which asked to revise) and was logged in `lib`'s. `cd app && echo deploy-marker` run from the root was refused by `app`'s rule and logged in `app`'s log only. A Write to the root's `.claude/settings.json` was refused as a protected path and logged in the root's log. Each repository got its `.gitignore`. Not checked live: a cloud session with two repositories.

**Tests** (`tests/scopes.test.ts`; `multiRepo: true` in `tests/fixtures.ts` makes `/work` a parent of `app` (a repository with a rules file: an allow rule for `npm publish`, the protected path `config/secret/**`, one check) and `lib` (a repository, no file); the fixtures record the working folder of every process and spawned check):
- pure: `targetsOf` (the `cd` before a part, an unknowable `cd`, a nested `cd`, quotes and `~`, a file tool's real path), `scopesTouched`, `candidateChildren`, `combineClassifications` (strictest, tie, protection, scripts, one scope unchanged, none an error), `scopeTagOf` and the keys with an empty tag, `unionById`, `intersection`, `checksOf`, `auditDirsOf`, `writeDirOf`;
- the roadmap's case: an edit in `app` resolves its protected path, an edit in `lib` the defaults, a command run in `lib` the defaults (and `npm publish` is allowed in `app` only);
- a file in a plain child and one at depth two are ignored; a root file, or a root `.git`, turns the lookup off; a link is not a repository and a `.git` file is;
- shell targets: `cd app && …` from the root, `cd $X && …`, a path in another repository, `> /dev/null`;
- the strictest wins; `rm -rf ../lib` and `rm -rf /work/lib` are blocked; a protected path anchors at its repository; a file edit through a link into `lib` touches both;
- checks run in the repository, eight across two, listed by `/council test`; git runs in the repository (push, merge, the root and `lib` as controls);
- audit: the line in `app`'s log with its `.gitignore`, one line in each of two logs, the root's log as before, one absolute file once, `/council log` reading the cwd's;
- offers: none for two repositories or the root alone, the rule written to `app`'s file and honoured on the next call (and not in `lib`), the allowlist option and write likewise, the allowlist as an intersection;
- keys: an approval in `app` is not used in `lib`, the root-scope keys equal the plain ones, the chat code differs per repository;
- reload: a changed file is read only after `/council reload`, and so is a folder that became a repository; a broken file warns once with the relative path; `/council rules` and `test` read the cwd's repository.

**Mutation checks** (each broken on purpose, the failing tests named, then restored):
- (i) a rules file accepted in any child without `.git` (the `.git` check in `loadChild` removed): "a rules file in a plain folder, or deeper than a repository's top, is ignored", "a call outside every repository is logged at the root, as before", "the allowlist option only where one repository's file can take the entry" and "the root scope alone keeps today's keys; a repository's are tagged with its directory";
- (ii) the first scope taken instead of the strictest: "the strictest tier wins, and its scope decides", the two shell-target tests, "two repositories: the strictest decides", the two-log audit test, the absolute-log test and "/council in a repository";
- (iii) the scope tag dropped from the cache key: "an approval in app does not carry over to the same command in lib", "the root scope alone keeps today's keys; …" and the plain-folder test (its second call reused the first's approval);
- (iv) a path target outside every repository bringing in the root scope: "a working directory in no repository brings in the root scope; a named path in none brings in nothing" and "shell targets: a path in another repository brings it in; a path in none does not bring in the root";
- (v) `rm-outside-repo` measured against the session root instead of the scope's directory: "rm -rf of another repository is blocked: …", "a file edit in app resolves app's rules; …", "a project protected path is anchored at its repository" and the `/dev/null` test;
- (vi) the link check removed from `loadChild`: "a link to a repository is not one; a folder whose .git is a file (a worktree) is".
