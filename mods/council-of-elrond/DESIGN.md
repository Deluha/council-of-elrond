# council-of-elrond: design

Status: built through Stage 6 (themed strings and plain mode; the debate pane, the council check, the wipe counter, the threat meter and the epic drop), the final deliverables (SPEC §21–22, §12 below), the v1 hardening and cloud work (§13, §14), and the hardening after the November reviews (§15, then §16 in three passes: round 2, round 3 and a last classifier correction). Nothing is tagged yet: 0.5.0 is a changelog heading, and the work since is under "Unreleased". §3 and §4 state how the mod works now; §5 onward is the decision log, and the indexes at the head of §15 and §16 say which items are current.
What's next, and the decisions approved after the spec: [ROADMAP.md](./ROADMAP.md). The original spec: [SPEC.md](./SPEC.md).
Targets Claude Code **2.1.322** (built on **2.1.289**, checked on **2.1.291** from Stage 5, **2.1.294** from
Stage 6, and **2.1.296**, **2.1.299**, **2.1.304**, **2.1.308** and **2.1.322** after it). The generated API types are vendored at `mods/types/claude-code.d.ts` (now 2.1.322's) and
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

The 2.1.304 → 2.1.308 drift is additive for every signature the mod calls. The additions: `part` on a keyed `Markdown` leaf; a ceiling on a docked pane's `columns` (at most 45% of the terminal's columns, at least 24); `approver` (`host` or `person`, set by the engine) on a `tool.check` input; `plugin` (the plugin whose hook made an ask, set by the engine) on a `tool.check` verdict; and, in the test kit, a `$.tool.call` typed to take `agentId`. One removal: `decider` on a `tool.check` verdict is gone. A hook's ask is now always a person's, and the types now name a PermissionRequest hook among what may answer it (§14.2). Elrond has no `tool.check` hook and reads neither field, so nothing changes for it. The wording re-read from the binary is in §12.7.

The 2.1.308 → 2.1.322 drift is additive for every signature the mod calls. The additions: `$.theme.set` and `$.theme.clear` with a `Backdrop` component; `$.ui.place` with a `Placed` component; `$.prompt.paint`; `$.ui.cancelNotify` and scheduling fields on `$.ui.notify`; `backgroundColor` on `$.ui.open`; `isCollapsed` on `AbovePrompt`'s props; `isTextDisplayOnly` on a `command.run` result (read only for plugins bundled with Claude Code); `effort` on a `$.model.complete` result and on a fork; and new built-in tool fields. `TargetTier` now admits `user`, and an HTTP request's `body` takes an `HttpBody` and a `compress` option. One semantic change, in the doc of a call the mod does not make: `$.tool.call` now runs the permission check with no dialog and no classifier, so an ask beyond the rules is a deny, and a hook that re-issues the model's call this way answers for its input. Elrond only calls `next(e)`, so nothing changes for it. The wording re-read from the binary is in §12.7.

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
       $.fs.list (via previewOf, rulesDirsInScope), $.fs.read (via appendAudit, councilOutput,
       fileDiffOf, loadRules, readRulesFiles, reportFrom, scriptsOf, sqlFilesOf, writeOverrides),
       $.fs.stat (via loadChild, loadContext, previewOf, realDirInside, realPathOf, rulesKeyOf,
       sqlFilesOf),
       $.fs.write (via appendAudit, writeOverrides),
       $.model.complete (via probeModel, review), $.process.run (via currentBranchOf,
       runGitInspection), $.process.spawn (via runCheck),
       $.session.append (via announce, noticeUntrusted), $.session.cwd,
       $.session.root (via loadContext),
       $.session.surfaces (via announce, escalate, noticeUntrusted, offerRule, openDebatePane, relayOf,
       show, showDebate, syncIndicator),
       $.state.get, $.state.set, $.store.get (via readTrust), $.store.set (via saveTrust),
       $.ui.ask (via confirmAllowlist, escalate, offerRule), $.ui.log,
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
goes through `loadRules`, and `loadChild` joins the `$.fs.stat` callers. Re-run for the rules-file
trust rule (§15 item 22): `$.store.get` and `$.store.set` are new (the trust record), `$.fs.list`
gains `rulesDirsInScope`, `$.fs.read` gains `readRulesFiles`, `$.fs.stat` gains `rulesKeyOf`, and
`noticeUntrusted` joins the `$.session.append` and `$.session.surfaces` callers; the hooks line is
unchanged.

There is no `tool.check` hook: the mod never takes part in the permission decision. The processes it
starts are read-only `git` commands from Galadriel's table (§6, §8), and, for a big operation, the
project checks the user listed in `rules.json` (`gimli.commands`, §8).

## 3. Data flow

```
config load (session start, /council reload, after the mod's own write) ─► rules.json per repository
             │ validate ─► broken: what can only tighten still applies (§16 item 21); unreadable: ignored whole, shipped rules enforce
             │ confirmed (path + SHA-256 in the trust record) or trustProjectRules = always ─► in force in full
             │ unconfirmed ─► split (pure): ask, block and review rules (adding only, §16.10), protected lists,
             │                bigOperations apply; allow rules, disables, models, patterns, allowlist and
             │                project checks are held back, counted, told once per file (§15.22)
             │ confirm ─► `/council trust` (a person) lists every setting, or says the file cannot be confirmed
             │            from the session; `trust <code>` confirms only content listed in this session (§16.1, 28)
tool.call ─► classify (pure, rules only; against each repository the call touches under a
             │             multi-repository root, the strictest wins: §14.5)
             │ allow ─► high secret, or a text too long to scan in full? refuse (audited) · else next(e)
             │          (no state read or written)
             │ gated: fingerprint, operation key ───────────────────────── audit, count
             │ bypass ─► next(e)
             │ block ──► refuse (rule reason)                            failed attempt
             │ locked out (3 on the key / 5 on the verb) ─► refuse, "stop retrying"
             │ Gollum: high ─► refuse ("remove the secret")              failed attempt
             │         low ──► ask ─► allow once / allowlist (confirm, write, reload) ─► continue
             │         partial scan (over 600,000 characters) ─► ask like a low finding, never remembered,
             │                      no allow rule offered; nobody to ask: refuse (§16.16, 38)
             │ ask (shipped ask rules: privileged, plugin-manage, claude-session, terminal-input,
             │      force-push-unknown-branch; protected paths; a project ask rule on a call nothing else gates)
             │ ask ─────► escalate ─► allow once ──► notice, next(e) ─► ran? offer an allow rule (pure,
             │                     │                 checked by classify) ─► add: write, reload
             │                     └► keep blocked / dismissed (or Chat about this) / nobody ─► refuse  failed attempt
             │                     └► instruction ─► refuse, rounds reset; talk first ─► refuse
             │ review ─► cached approve this prompt, in the same folder? ─► next(e)
             │           (never cached: a git part, a script or a project's runner, more than eight gated
             │            parts, an ask rule after the review, the full council's approve: §16.2 to 4, 35)
             │           more than eight gated parts ─► the person, no model request (nobody to ask: refuse;
             │              never cached, §16.7)
             │           Galadriel preview (fixed table, read-only, 5 s each, ≤ 3)
             │           out of rounds (2) ─► escalate (shadow: pass)
             │           big operation? (pure; a git merge reads the current branch) ─► full council:
             │              seats (pure): Gandalf · Legolas (file diff, or push/merge range) ·
             │                            Aragorn per profile; all on the council model
             │              checks: gimli.commands spawned first, own timeouts, run alongside
             │              members: parallel (or one at a time) under one deadline (time left)
             │              combine (pure): strictest wins; no verdict = block; failed check = block
             │                 approve ─► cache, next(e) · revise/block ─► refuse, labelled
             │                 approve with a cut shell command, script or SQL file in any seat ─► the person
             │                    (§15.11, §16.6)
             │                 blocked only for want of verdicts ─► escalate (shadow: pass)
             │           route (pure): the rule's member and profile, else Gandalf
             │           nobody on / budget spent ─► escalate (shadow: pass)
             │           brief: Gandalf (call, preview, scripts) · Legolas (diff, git status)
             │                  Aragorn git (command, preview, protected branches)
             │                  Aragorn database (command, SQL, production matches)
             │           review ($.model.complete, the member's own prompts, own deadline)
             │              approve ─► cache, next(e)
             │              approve of a cut shell command, script or SQL file ─► the person (nobody to ask:
             │                 refuse), not cached, no round (§15.11, §16.6)
             │              approve while an unconfirmed project ask rule matched ─► the person, with the rule's
             │                 reason as the project's text; not cached; a revise or block stands (§16.10)
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
/council ─► parse (pure) ─► output lines ─► pane (where a surface draws) or ui.log; not to Claude, except
            where nothing draws: a person's status, report, rules and test go to Claude as `context`
            to relay (redacted, fenced; §13.5, §14)
/council debate ─► the council-debate pane (opened at any width), else its rows as ui.log lines
ui.render Pane council-debate ─► state ─► debateRows(view.agentId) (pure) ─► Text rows   (reads only)
ui.render AbovePrompt ─► survey? pass · state + clock ─► bandRows (pure) ─► rows, or pass when idle
finish() ─► ran, full council approved, push or merge, themed ─► epicUntil + toast + timer (redraw only)
/council report ─► audit.jsonl.2, .1, current (read) ─► report (pure) ─► the same
```

- **Files.** `hooks/register.ts` is the only file that touches `$`. Rules (`rules/`), config (`config/`), members (`members/`: one file per member, `brief.ts` pairing each member and profile with its prompts, `gimli.ts` the checks' outcomes), routing, the full council's seats (`elrond/council.ts`) and its verdict (`elrond/combine.ts`), escalation, refusal, model choice, the allow rule offered after "allow once" (`elrond/suggest.ts`), the report (`elrond/report.ts`) and the rows the debate pane and the band draw (`elrond/view.ts`) (`elrond/`), state (`state.ts`), audit (`audit.ts`), redaction and strings are pure modules.
- **State.** The session value `council-of-elrond.session` (`types/index.d.ts`, shape version 6), plus `council-of-elrond.panel`, the lines the `/council` pane draws. `resetForPrompt` is the single reset, run on every prompt a person sends (composer or bridge origin) except a `/council` command: it clears rounds, failed attempts, lockouts and the cache. Any other prompt, `sdk` included, clears only the cache (§14.3). Two fields last the whole session and no prompt resets them: the trust nonce and the content hashes `/council trust` has listed (§16 item 1).
- **Config.** The shipped defaults are a TS module. Project overrides live at `.claude/council-of-elrond/rules.json`, read once per load, after the mod's own writes (an allowlist entry, an allow rule), and on `/council reload` (never by watching the file). Both writes go through `editOverrides` (`config/write.ts`). Where the session root is the parent of several repositories, each repository's own file is read the same way, once per repository, and a call is classified against the repositories it touches (§14.5).

## 4. Failure modes

| Failure | Behaviour |
| :- | :- |
| Hook throws before the call runs | `.catch` refuses ("fails closed"). |
| Project checks held back for an unconfirmed rules file | Counted as a check that could not start: a big operation's council blocks ("not run: the rules file is not trusted", §15.22). |
| Project checks of a rules file with errors | The same: held back whole, counted as a check that could not start, and the council blocks ("not run: the project rules file has errors", §16 item 21). A file that cannot be read at all names none that can be counted. |
| A high-confidence secret in an allowed call | Refused, audited with tier `allow`; no rounds, no failed attempt, no state write. |
| Hook throws after the call ran | `.catch` replays the real result (`next.called`); the call is not re-run and Claude isn't told a call that ran was refused. |
| A `tool.call` raised beneath the hook's own frame (`re-entry`, from 2.1.294) | `.catch` answers with `called` false and refuses. A subagent's calls do not arrive this way, in the background or the foreground (verified live, §12.1). |
| Hook overruns its 10 s own-time budget | **From 2.1.299 the engine cuts the hook off** (probed headless, §12.5): its `.catch` is asked with `kind` `timeout` and `called` false, and refuses; a `next(e)` the hook makes afterwards is refused by the engine. The Stage 0 probe found the test kit does not cut a hook off, even with `.catch`, so calls still pass only through `proceed()`, which refuses when `next.budget.remainingMs` < 1 s. The hook's own work is bounded to make an overrun unlikely: commands over 20,000 characters aren't parsed (review), parse depth ≤ 4, ≤ 200 parts. |
| A hook blocks the hooks worker (no yield for 5 s) | From 2.1.299 the engine replaces the worker, keeps the plugin loaded and asks the hook's `.catch` with `kind` `throw` and `called` false: refused (probed headless, §12.5). `session.start` runs again in the new worker. |
| The `prompt.submit` hook fails (throws, times out, or blocks the worker) | Its `.catch` passes the prompt through unchanged and the mod stays loaded; the per-prompt reset is skipped for that prompt (§13.6). |
| Model error, timeout (`timeoutMs`), empty reply, malformed verdict, request refused | Escalate to you; "keep blocked" refuses. |
| Token budget spent / no enabled member can take the call (the named one and Gandalf off) | Escalate without a model call. |
| The file a diff needs can't be read (over 4 MiB, permissions) | The diff shows the call's own text and the prompt says so; the review goes on. |
| A `.sql` file the call names is missing, unreadable, or lands outside the project (by name or real path) | Left out of the database reviewer's context, with a one-line note in its prompt saying so (§15.13); the review goes on. |
| A gated call whose text is too long for the secrets scan to read in full (over 600,000 characters; the middle is not read) | Put to the person with `escalate.secretPartial` after the high-confidence check; the answer is not remembered and no allow rule is offered; refused where nobody can be asked, a failed attempt. Shadow mode does not change it; bypass passes it with the rest of the gated path (§16 item 16). |
| An allowed call whose text is too long for the secrets scan to read in full | Refused, audited with tier `allow` and member `gollum`; no rounds, no failed attempt, no state write; bypass does not change it (§16 item 16). |
| A shell call with more than eight gated parts | No reviewer: the keys cover only the first eight, so a locked or spent part could be among the rest. It goes to the person (`escalate.tooManyParts`), or is refused where nobody can be asked, a failed attempt; never cached (§16 item 7). |
| The shell command (over 200 lines or 12,000 characters; 40 and 4,000 for the push command a diff reviewer quotes), or a script, `.sql` file or inline SQL the call runs, was cut for its reviewer, and the verdict is an approve | The approve does not stand: the call goes to the person (`escalate.commandCut`), or is refused where nobody can be asked, a failed attempt; never cached, no round; the audit line keeps the approve and says why. A revise or a block stands. In the full council it applies when every seat approves and any one saw a cut (§15 item 11, §16 item 6). |
| A call the approve cache may not serve, or may not be written to | The call is reviewed again each time: it has a git part (gated or not), runs a script or code (a shipped `script-*` rule matched any part), runs a project's runner or `make`-style program, has more than eight gated parts, was approved only after an unconfirmed project `ask` rule asked, or is too long or complex to split; the full council's approve is never written. The key is the call's text and the folder it runs in, so the same call elsewhere is reviewed again too (§16 items 2 to 4, 7, 10, 35). |
| More than 200 distinct verb keys have failed | A new verb counts on one shared key (`shell:(other verbs)`), read for any verb with no entry of its own; it locks at the verb cap. Nothing stored is evicted (§16 item 7). |
| A push follows another command of its call | The preview and range diff are kept and carry a trusted note that the commits were read before the earlier commands ran (§16 item 8). |
| Nobody can be asked (no surface) | Refuse, naming the operation, the rule and the reviewers' names (never their reasons) and the way to let it run; a failed attempt (§13.5 e). |
| The start notice can't be appended (`$.session.append` rejects, or resolves `{ deny }`) | A debug line (`notice.appendFailed`); `session.start` goes on and returns `next(e)`. Nothing is retried; the refusal still tells Claude why (§13.5 d). |
| The status sync after a roster change fails (`session.attach`, `session.detach`) | Caught where it is made; the hook returns what `next(e)` gave. The status line keeps its last value until the next sync (§13.5 f). |
| `$.ui.ask` dismissed / "Chat about this" | Refuse, a failed attempt (recorded as `dismissed`; the two cannot be told apart, §12.4). "Talk first" refuses without counting (recorded as `chat`). |
| Overrides file is not JSON, not an object, or of another `schemaVersion` | Ignored whole; the shipped rules enforce; a transcript line lists the error, plus a toast, and where nothing draws one row through the relay with the error count (§16 item 21). `/council status` and `rules` say "ignored: not readable". Each repository's file under a multi-repository root is checked on its own and warns once (§14.5). |
| Overrides file of this version with an invalid field (an unknown key, a bad rule, a rule, pattern or check name over 64 characters or outside `[A-Za-z0-9._-]`, a regex over 1,000 characters, more than 200 rules or patterns) | Partly applied: the entries that validate on their own and that `FIELD_TRUST` and `TIER_TRUST` class as applying at once (protected paths and branches, valid production patterns and big operations, valid block, ask and review rules) still apply, read as an unconfirmed file's are (they only add to the shipped decision), whatever the file's trust and the option; everything else in it, and every invalid entry, is ignored. The line, the toast, the relayed row, `/council status` and `rules` say so, with the error count (§16 item 21). Its project checks are held back (next row). |
| The trust record cannot be read (`$.store.get` rejects, or the stored value is not the expected shape) | Nothing is trusted by it: a rules file with settings that wait for confirmation is held back, exactly as with no record. The tightening part of the file still applies. `/council trust <code>` then confirms nothing and says the record could not be read or saved (§15 item 22). With `trustProjectRules` at `always` the store is never read. |
| A rules file that cannot be listed in full or safely read (more than 40 settings waiting, a value over 400 characters after cleaning, a value `redact()` would change, a value that held a control, invisible or direction-changing character, or more than 20 files waiting) | Listed as far as it can be, each such value named and marked, with the line "This file cannot be confirmed from the session because …" in place of a code. Its hash is never noted as listed, so `/council trust <code>` for it confirms nothing and says the same (§16 item 1). The way out is to fix the file, or the option at `always`. |
| `/council trust <code>` for content that was not listed in this session (before any listing, or a file edited after its listing), or whose listing a confirmation already used up | Confirms nothing; says to run `/council trust` first and read what it lists (`trust.notListed`), or, when the code fits no file now, that none has it (`trust.noMatch`). |
| The trust record cannot be saved (`$.store.set` rejects) | `/council trust <code>` confirms nothing and says why. After the mod's own write (the rule or allowlist offer the person answered), the new content is simply not trusted: a transcript line (`notice.trustNotSaved`) says to run `/council trust`. |
| A project `ask` rule of a file nobody confirmed matches a call the shipped rules review | The shipped decision runs as it would with no file (reviewer or full council, preview, checks); only an approve is then put to the person with the project's reason as the project's text, a revise or a block stands, a failed or absent review goes to the person anyway, and where nobody can be asked the call is refused. Never cached (§16 item 10). |
| A rules file's content differs from the one confirmed (any byte; a copy at another path; a link that now points elsewhere) | Untrusted: the hash, or the real path, no longer matches the record. Its settings that wait for confirmation are held back at the next load (session start, `/council reload`, or when a call first reaches a repository below a multi-repository root); a session already running keeps the content it loaded and confirmed. |
| Audit write fails | Counted (`/council status` shows "Audit lines that could not be written this session"), logged to the debug log (`notice.auditFailed`), and the first failure of the session is also one transcript line and a toast (`notice.auditFailedFirst`); never changes a decision, and the queue goes on to the next line. The audit folder's `.gitignore` is marked as seen only once it exists or was written, so a failed write of it is tried again with the next line (§16 item 25). Nothing waits for the queue: a write that never returns holds back only the lines queued after it, never a decision or a later call (§13.4 d). `/council log` and `/council report` read the files, so they may not show a line still queued. |
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
| The branch a force push overwrites is unknown or may have moved (`git push -f`, `-f origin HEAD`, `origin +HEAD`: git fails or times out, a detached HEAD, git pointed elsewhere, a folder outside the project or past the third; a destination or remote computed at run time; an earlier part of the same call that may switch the branch) | The push is the ask tier, rule `force-push-unknown-branch`: the user is asked, or the call is refused where nobody can be asked. A protected branch read before the call still blocks. Never allowed and never hangs: the lookup has the previews' 5 s timeout and their git protections (§15.17, §16 item 12). |
| The command's own text is over 200 parts or 4 levels deep (what `origin/main`'s parser read: the parts, `-c` strings, `$(...)`, subshells, `<(...)`, `eval`, heredoc bodies fed to a shell, the wrapper chain); or a redirect operator has no word after it at the end of a part (`cat >`, a pipe or `;` straight after it) | The parse is cut: `command-too-complex` (review), exactly as on `origin/main`. What was found before the cut stays found, so a block already seen still blocks; a redirect never takes the first word of the next part as its target. Nothing the parser adds beside the text is counted in these bounds (§16 items 41 and 45). |
| The readings the parser adds beside the text (`nsenter -S`/`-G` read as taking the next word, each spliced `env -S` string read again by the shell scanner and alone, the strings past the eighth read as env and as a shell reads them, a string holding a `${NAME}` read with the expansions replaced by nothing and the words after it alone (§16 item 46), `origin/main`'s reading of a part with an `env -S` string (§16 item 47), and every script nested in one of those) use up their own budget: 400,000 characters scanned, 400 parts or 4 levels deep, none shared with the text's | **Block** (`command-too-complex-to-read`), never a review: the extras stop being read, and the call is refused with "The command repeats wrapper options or split strings more often than the parser reads; it is refused. Write the command plainly." A block the text's own parts found names its own rule (a tie goes to the part). Only a crafted command, or an honest but extreme one (more than 200 commands inside one `env -S` string or inside the script of a command behind ambiguous `nsenter` options; four or more scripts nested inside one; four `env -S` strings that each hold a `${NAME}` followed by a nested script, or five followed by anything; 81 commands of one such string each joined in one call, or 134 of one string without one (the depth and the parts are shared with the nested scripts that follow, §16 item 47): write the command plainly or put it in a script file), reaches an extra budget, and a cut can never lower a tier (§16 items 45, 46 and 47). |
| A shell option the tables cannot place: one a wrapper or runner does not list, a separate word after `nsenter -S` or `-G` whose role depends on the installed util-linux, an `env -S` string that holds a `${NAME}` (its value is not known), or more than eight `env -S` strings in one command | Reviewed (`shell-runner-unresolved`) and evaluated also from `/`. The words are classified as they stand; for `nsenter -S`/`-G` both readings are classified (the word as the option's value, and as the program), and the strictest tier wins, so a block in either still blocks. Past the eighth `env -S` string the strings are not spliced: they are read together with the words after them, as env splits them and as a shell reads them (§15 item 3, §16 items 9, 34, 40, 42 and 45). |
| Typing into another terminal (`tmux send-keys`, `screen -X stuff`, `xdotool type` and the like), or starting a nested Claude Code session (`claude -p`, `--bare`, `--settings`, `--plugin-dir`, a permission bypass, `claude mcp add`) | The ask tier (`terminal-input`, `claude-session`): the user is asked, or the call is refused where nobody can be asked. What is typed is still classified, so a block still blocks. A key sequence, command file or tmux option the mod cannot read is reviewed (`command-unreadable`) (§16 items 12 and 32). |
| A failed command whose own output reads like Claude Code's automatic denial | A deny-rule wording ("Permission to use|edit|read … has been denied") counts only at the start of the text. Some other automatic-denial wordings are still read from their phrase alone, so such a failure may be recorded as a denial and not counted as a failed attempt. A known limit; ROADMAP M1.9 and open decision OD2 (§16 item 24). |
| `/council trust`, `trust <code>` or `reload` typed by something that is not a person (a plugin, another session, a schedule, `claude -p`, the SDK) | Refused with one line; nothing is read or changed. `untrust` runs from any origin, as it only tightens (§16 item 23, §14.3). |
| A range a push would send can't be named (a source or destination that is no plain ref name, no remote that is a plain name) or can't be read (git fails, times out), or the push names more than three refspecs | That refspec has no commit list and no diff. The preview says so, and every reviewer's prompt carries a trusted `Note:` line outside the data blocks, so the checked-out branch's commits are never read as the push's (§15.18). A diff reviewer with no readable range sits out (`council.noRange`). |
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

§3 and §4 state how the mod works now. §5 onward is the decision log: text that a later decision superseded is flagged in place, and the indexes at the head of §15 and §16 say what is current.

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
9. **The cache lives until your next prompt** (keyed on the prompt epoch, not `turn.start`'s `turnId`, which subagent turns would complicate). A config reload clears it too. *Amended by §16 items 2 to 5, 7, 10 and 35: the key holds the folder the call runs in; the full council's approve, a call with a git part, a script or a project's runner, one with more than eight gated parts and one asked about after its review are never cached; the cache test is read afresh. §3 and §4 list the conditions as they stand.*
10. **Shadow mode** shadows the second opinion only. Verdicts are logged with `shadow: true` and use no rounds or failed attempts; a reviewer failure, a switched-off reviewer or a spent budget passes (logged). Rules, protected paths, the ask tier, the secrets scan and lockouts still enforce. The session switch wins over the `/config` setting.
11. **`/council model`.** A one-request probe (16 tokens) checks the model first. `--save` writes only the `gandalf` row (the only `/config` model row so far) and only picker values; anything else stays session-only and says so.
12. **`/council` output** is drawn in a pane (`$.ui.open` from the command, so it seats at any width) where a surface draws, else as `ui.log` lines. Verified live: a plain `claude -p "/council …"` prints nothing, and in stream-json the lines arrive as `system/ui_log` messages; the command's result carries no text.
13. **The mode label** is added to `SessionMode` (terminal and desktop). `$.ui.status` carries it only when a surface without that site (VS Code, mobile) is attached, so the terminal doesn't show it twice.
14. **Permission-check outcomes, told apart by wording** (approved decision 12). Your refusal at Claude Code's own prompt ("The user doesn't want to proceed with this tool use…", "…take this action right now", read from the 2.1.289 binary) is `refused-by-user` and counts as a failed attempt, whatever `toolErrorsAreWipes` says. An automatic denial ("… needs approval …", verified live in `-p`; deny-rule wording ("Permission to use|edit|read … has been denied", the edit and read forms read from the 2.1.296 binary); and "This command requires approval", seen on 2.1.294 for a `git push` in `-p`, §12.1 item 4) is `denied-by-permission` and never counts. Text matching neither is an ordinary tool error. The user-refusal wording is checked first.
15. **Redaction fixes.** The assignment pattern now matches JSON-escaped quotes (`\"hunter2\"`), which Stage 1 missed in file-tool call text, and leaves an already-redacted value alone, so redacting twice is stable (a test in `tests/gollum.test.ts` redacts every shipped pattern's sample twice).
16. **Identifiers stay as written.** Plain-mode output names member ids where you type them (`/council model gandalf …`, `[gandalf]` in the status), since they are config keys. The string table itself holds no theme text (tested).

## 7. Decisions the spec did not cover (Stage 3)

1. **Routing** (`elrond/routing.ts`). A review-tier call goes to the member its rule names; Aragorn's profile comes from the rule. Gandalf takes it instead when the rule names nobody, the named member is off (`disabled`), the call's review parts name different members (`mixed`: one specialist would judge only its own part, and Gandalf's checklist is the general one), or the diff reviewer is named for a call with no file (`no-diff`). With the member Gandalf would replace and Gandalf both off, the call comes to you ("its reviewer is switched off"). Gandalf being off never stops an enabled specialist. A mixed call (`mixed`) with Gandalf off comes to you, though a specialist is on: no one reviewer would see the whole call, and a specialist judging only its own part is the less safe choice, so the call goes to the user. The fallbacks are checked in the order `mixed`, `disabled`, `no-diff`, so a switched-off diff reviewer named for a shell command reports `disabled`. `/council test` prints the fallback and why.
2. **Aragorn named without a profile** (a project rule) takes the git profile for a `git` command and the database profile for anything else.
3. **One `review()` for every member.** `review($, brief, model, deadline, signal)` in register.ts: a `Brief` (`members/brief.ts`) carries the member, its profile and the context together, so a context can't reach another member's prompt. Members supply only `system(nonce)` and `prompt(context, nonce)`. The request, deadline, token accounting and strict verdict parse are shared.
4. **The diff is built from the call** (`members/legolas.ts`). Edit: the replacement applied in memory to the file as it stands (`replace_all` honoured), shown as unified hunks with 3 lines of context. Write: the new content against the current file (a new file is all added). NotebookEdit: the cell's source, by `cell_id`, for replace, insert and delete. The text not found, or a file that can't be read, gives the call's own text with a note in the prompt. The diff is bounded so the hook's own time stays small: the common head and tail are trimmed and only a middle under 250,000 line pairs is matched line by line; anything larger is one removed block and one added block. Cut to `diffLines` (default 200), redacted. Legolas also gets Galadriel's file preview (diff stat, whether git tracks it).
5. **The database profile's SQL** (`members/aragorn.ts`): per client, its inline options (`psql -c`, `mysql -e`, `mongosh --eval`, `clickhouse -q`, `sqlcmd -Q`, `cqlsh -e`, `sqlite3 -cmd`), heredocs, and `.sql` files (or `-f` files) the database parts name, at most 3, 150 lines each. `sqlite3 DATABASE SQL`: the second positional is SQL too (options that take values are skipped); `-init FILE` is a file. A `.sql` file's content is never read by the block rules (classification reads no files): a destructive file against production is reviewed, with the file's SQL shown to the database reviewer, not blocked. A file is read only when it is inside the project both by name and by real path, so a link can't pull in a file from elsewhere. The configured production patterns are matched in code and the matches named in the prompt. A SQL file write (`sql-file-write`) gets its diff instead.
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
   - Legolas for a file tool's diff, or for a push or merge: the changes it would send (per refspec, `<remote>/<destination>..<source>`, or `@{upstream}..HEAD` for a push that names none; §15.18) or bring in (`HEAD...<ref>`), read by `git diff --no-color --no-ext-diff --no-textconv <range> --` from Galadriel's table, one per range (refs validated as before). It is cut to the diff limit and redacted, and only runs while the preview is on. A range git can't read (a branch the remote doesn't have yet) seats nobody: Legolas sits out.
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
   is not reused unreviewed. *A shell command is hashed exactly too since §15 item 8.*
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
  which counts as a failed attempt, against approved decision 4 ("not a wipe"). The tests pass
  because the fixture fakes the rejection as "The user chose to chat about this instead", text the
  engine never sends. Decided 2026-10-13 (approved decision 4, amended): the dialog has its own
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

### 12.7 Re-read on 2.1.308 and 2.1.322

The `/upgrade-types` runs for 2.1.308 and 2.1.322 read the binary with `grep -a`. No headless probe ran for either: in this cloud session the auto-mode classifier refused a child `claude -p` run with the session's own wiring removed from its environment, so the behaviours below are carried over from §12.6 unprobed.

- **Refusal wordings: unchanged.** Both user-refusal wordings are in the binary and `USER_REFUSAL` matches them. Every automatic-denial wording the skill's searches find is matched by `AUTOMATIC_DENIAL`, among them "… needs approval in this session before it runs: …" and "… will be denied the same way for the rest of this session". On 2.1.322 the searches also find "… has been denied" wordings that name a command, a clamp or a listing scope, all matched by the deny-rule pattern.
- **A plugin's `tool.check` deny is still not matched.** "Permission to use <tool> denied by plugin <name>: <reason>", seen in §14.2 on 2.1.304 and still in the 2.1.322 binary, reads as an ordinary tool error, so it counts as a failed attempt when `toolErrorsAreWipes` is on. Matching it would count fewer failed attempts (a loosening), so it is left for the maintainer.
- **A remote tool's refusal note is not matched.** 2.1.322 answers a refused remote-tool approval card with "The refusal was recorded on <target> — nothing ran." as the tool's content. It is not one of Claude Code's permission-prompt wordings, and no pattern matches it; it is left as is.
- **Not probed on 2.1.308 or 2.1.322:** the own-time budget cut-off, `$.ui.ask` rejecting in `-p`, `$.process.spawn` ending on `return()`, and `/council` output as `ui_log` in stream-json. They were last probed on 2.1.304 (§12.6).

## 13. Decisions after the final deliverables

1. **A new branch's push has a range** (`orElse` in `members/galadriel.ts`, `runGitInspection` in `hooks/register.ts`). A push of a branch the remote doesn't have yet has no `<remote>/<branch>` ref, so `git log <remote>/<branch>..HEAD` and the council's `git diff` failed: no commits in the preview, and the diff reviewer sat out.
   - **The table.** A git `Inspection` may carry `orElse`, a second fixed entry (label and argv) tried only when the first exits non-zero or fails. Nothing else is ever run; the fallback is as fixed as the first entry.
   - **Why `<remote>/HEAD`.** It is the remote's default branch, which a new branch is almost always cut from, so it is the nearest range git can read that says what the push adds. It exists only if the clone set it (a normal `git clone` does).
   - **Two dots for the log, three for the diff.** The log is `<remote>/HEAD..HEAD`: the commits on this branch that the default branch lacks. The diff is `<remote>/HEAD...HEAD`: the changes since the branch point, which is what the push adds, and it does not show unrelated work the default branch has gained since.
   - **Only with a named remote.** `pushRange` returns the fallback only when the push names a remote that passes the ref check. A push with no remote has no known remote (the upstream could be anywhere), so it has none, and a name that would read as an option gets neither range nor fallback. A merge gets none.
   - **Not a fourth step.** The fallback is an alternative to one step, not a step: it does not count against the three-inspection cap, so a preview starts at most one extra process. `previewOf` and `rangeDiffOf` share `runGitInspection`, which runs the first argv, then (when it exits non-zero or throws) `orElse.argv` once with the same working folder, environment and 5 s timeout. The fallback's label stands only if it succeeds; if it fails too, the outcome is as before (no commits in the preview; the diff reviewer sits out, "the changes could not be read").
   - **Legolas's brief** carries the range that was read as its `path`, so the reviewer sees `origin/HEAD...HEAD`; its prompt needed no change.
   - `/council test` runs nothing and is unchanged.
   - *The ranges above (`<remote>/<branch>..HEAD`, `<remote>/HEAD..HEAD`) are superseded by §15 items 18 and 19: every refspec is read with its own range and fallback, and the push-argument reader is `rules/push.ts`.*

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
   - **(a) `command.run` needs a person for what loosens the gate** (§2.9). `needsPerson(command)` in `elrond/commands.ts` is true for `off` (bypass on), `shadow on` and `model` (a switch or clearing one, a bad member or usage included: the kind decides, so `model` with a bad slot is also refused). `on`, `shadow off`, the `model` listing (`models`), `reload` and every other subcommand answer any origin. *(Amended by §16 item 23: `reload` needs a person.)* The hook checks `needsPerson` and then `HUMAN_ORIGINS` (`composer`, `bridge`, `sdk`: the set `prompt.submit` already uses, not a second list); a refusal changes nothing and shows one line (`cmd.needsPerson`) through `show()`. `sdk` counts as a person until C3 shows which kind the web client's commands arrive with (ROADMAP C3) (dropped 2026-10-20, §14.3); a `plugin`, `peer`, `scheduled-trigger` and `task-notification` origin do not. Test kit: `$.command.run` in a test takes the whole `command.run` input, and a call without `origin` reaches the hook with none, so the tests' `council()` helper (`tests/fixtures.ts`) sends `{ kind: 'composer' }` and the presentation by default, and a test passes another origin to try it.
   - **(b) The checks end with the council** (§2.6). The body of `convene` after `stop` is created runs in a `try`/`finally`: `stop.abort()` and removing the listener run on every exit, so a throw no longer leaves a check to its own timeout (up to 600 s). The dispatch's `signal` is chained into `stop` (abort at once if it is already aborted), so an Esc ends the checks through the mod's own path as well as the engine's. A `$.model.complete` rejection does not reach it (`review` catches that and returns a failed voice); the test makes a `$.clock.now()` read between two members fail, which does.
   - **(c) The log rotates by bytes** (§2.7). `isRotation(current, line, maxBytes)` in `audit.ts` compares UTF-8 sizes (`byteLength`) and both `appendAudit` (whether to read `.1`) and `appendPlan` (whether to rotate) use it, so the two can no longer disagree. Before, `appendAudit` compared characters, so with multibyte text it skipped reading `.1` and the log rotated with `.2` never written.
   - **(d) Nothing waits for the audit queue** (§2.7). `audit()` queues the line and returns; `finish()` and the allowed-call refusal no longer await it. The queue keeps its order and its `.catch` (a failed write is logged to debug with `notice.auditFailed` and the queue goes on). The kit showed that a `$.fs.write` started by the hook still lands after the hook has returned, in order, a few event-loop turns later, so every line is still written. A write that never returns holds back only the lines queued after it; a decision, the call, and the next gated call are not delayed. Two consequences: a `/council log` or `/council report` run straight after a call may not see its line yet, and the tests read the log through `auditLines(w)`, which is now asynchronous and first calls `settled(w)` (it takes zero-delay event-loop turns, or settles the mocked clock, until the fixture's file calls stop; no fixed wait). A direct read of the log file from `w.files` does the same first. A test with an audit-file write that never resolves (`w.writeHangs`) checks the next gated call still returns its result.
   - **(e) Two sessions on one log** (§2.7): documented only (README, near the audit log and in its limits; §4). `$.fs` has no lock and no append, so two sessions in one project can interleave or lose lines; `/council report` already skips lines it cannot parse.
   - **(f) The concurrency model, and one snapshot per call** (§2.5).
     - *The model.* The session is one `$.state` value changed only by `update`, which reads, applies a pure function and writes with `ifVersion`, retrying on a miss. So every counter (tokens, rounds, failed attempts, verdict counts) is exact however many calls run together. What can be a read behind is a decision made from a value read earlier.
     - *Which checks re-read.* A gated call takes one snapshot at the top and uses it for bypass, shadow, the cache hit, the out-of-rounds check, the latest prompt, the written paths, the model switches and the prompt epoch. Two checks read again, just before they decide, and decide on the fresh value: the lockout (step 5) and each token-budget check (`holdCouncil` and the single-member review). *Amended by §16 item 5: the cache hit and the out-of-rounds check now read again too; the snapshot keeps the rest.* They are the limits another call moves while this one waits (its preview and git reads sit between the snapshot and the budget check), and a miss passes a call that should have been stopped. `refuse` already read afresh for the rounds left.
     - *Last reader wins.* Everything else stays on the snapshot: two calls with the same fingerprint running together each see the cache empty and are each reviewed (a cost, never a wrong decision); both can pass the out-of-rounds check and each verdict then adds its round; the cache and rounds are written by whichever finishes last, atomically. Nothing is locked. *Amended by §16 item 5: the cache test and the out-of-rounds check read the session afresh, so two calls in flight see each other's approve and spent rounds where the engine serialises state; what is left on the snapshot is as listed above.*
     - *A caveat.* The types say "every `get` of one dispatch reads one moment, whatever is written meanwhile". The test kit does not behave so within a call (`refuse` reads the rounds an `update` just wrote, and the tests rely on it), and `update` could not retry if it did. Whether the engine holds one moment per dispatch is not verified live; if it does, the re-read is harmless and changes nothing. A test pins the reads by number (read 2 is the lockout's, read 3 the budget's) through `watchState` in `tests/fixtures.ts`, so a change to the number of reads before them moves those tests with it. *Amended by §16 item 5: reads 3 and 4 are now the cache test's and the rounds check's, and the budget's is read 5.*
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
   - **(c) Allowlist entries are hidden in the model's copy (a tightening).** The pane shows the first three characters of an exact-string allowlist entry (`zq9…`), which are characters of a secret. `rulesOutput` takes a `forModel` flag: set, such an entry shows as `(an exact string, not shown)` (`cmd.allowlistHidden`), a `sha256:` fingerprint as before. The flag is a parameter of the pure function, not a rewrite in register.ts, and the person's copy is unchanged. *(Amended by §16 item 17: the person's copy hides it too, and the flag is gone.)* A mode is given to `councilOutput` only for the model's copy, so the same parameter sets `forModel`.
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

7. **H3: review accuracy** (`hooks/members/legolas.ts`, `hooks/members/shared.ts`, `hooks/members/galadriel.ts`, `hooks/register.ts`, `hooks/rules/checks.ts`, `hooks/elrond/operations.ts`, `hooks/members/aragorn.ts`, `hooks/elrond/routing.ts`, `hooks/elrond/report.ts`). The findings are REVIEW-2026-10 §2.9 (the `edits` array), §3.4, §3.7 and §3.8; the rows are ROADMAP's "H3" table.
   - **(a) An `Edit` with an `edits` array is diffed whole** (`callDiff` in `hooks/members/legolas.ts`). The 2.1.304 types have no `edits` field on the `Edit` input, so the handling is defensive, matching the secrets scan (`scannedText` in `hooks/members/gollum.ts`), which already reads one. When `input.edits` is an array the diff builder starts from the file's text, applies the top-level `old_string`/`new_string`/`replace_all` first (only if `old_string` is a non-empty string), then each entry in order on the running text, each exactly as the single edit is applied (`replace` with a function replacer, `split`/`join` for `replace_all`). One step whose `old_string` is missing, empty, not a string or not found, or an entry that is not an object, gives the not-found outcome (the call shown only, with the `not-found` note), never a partial diff. So does an `edits` array that is empty with no top-level edit. Without an `edits` array nothing changes. The result is one `textDiff` of the original text against the final text, so the diff reviewer sees the whole change instead of an empty or partial one. Test: `an Edit with an edits array diffs every edit in order, and one that does not apply gives the not-found outcome` (`members.test.ts`: chained entries where the second depends on the first; each kind of bad step; top-level plus entries; empty top-level `old_string`; `replace_all` in an entry; empty array). Mutations (each fails that test): dropping the loop (`steps` = the call only), keeping a partial result when a step fails (also fails the existing `replace_all` test), skipping the top-level edit, ignoring `replace_all`.
   - **(b) A hunk side with no lines starts at the line before** (`unified` in `hooks/members/legolas.ts`). Git writes `@@ -0,0 +1,N @@` for a new file and `+0,0` for a deleted one; the builder wrote `-1,0`. The start is now `line - 1` on a side whose count is 0. Context always surrounds a change in the middle of a file, so in practice the rule shows for a new, emptied or whole-file-deleted file. The test that pinned `-1,0` (`members.test.ts`, the `Write` test) now pins `-0,0`. Test: `a hunk side with no lines starts at the line before, as git writes it` (new file, empty file, whole-file deletion, `unified` called directly for a pure insertion and a pure deletion, a mid-file insertion that keeps its counts). Mutations: reverting the old side, reverting the new side (each fails that test and the `Write` test or the no-newline test).
   - **(c) CRLF** (`linesOf`, `textDiff` in `hooks/members/legolas.ts`). A trailing `\r` is stripped from each line before it is compared or shown; a `\r` inside a line is left alone. Lines that are equal once stripped but differ as written (only the `\r`) are counted: with no hunks the body reads `(only line endings change, on N lines)` (`on 1 line` for one) instead of `(no change)`; with hunks one final line `(line endings also change on N lines)` is appended. N counts every such line, including ones that appear as context. The appended line is part of the body, so `maxLines` cuts it with the rest. Test: `CRLF lines show without the carriage return, and a change of line endings alone is named`. Mutations: keeping the `\r`, never counting, always writing `lines`.
   - **(d) "\ No newline at end of file"** (`linesOf`, `unified` in `hooks/members/legolas.ts`). As in git, the last line of a text that does not end in `\n` compares unequal to the same text with a newline (the compared key carries a `\n` suffix, which a line cannot hold), and wherever such a line is printed in a hunk (`-`, `+` or context) the next line is `\ No newline at end of file`. `textDiff(p, 'a\n', 'a', ...)` is `-a`, `+a`, the marker, no longer `(no change)`. An empty text has no lines. The call's own text, shown when the edit is not found or the file is unreadable, and a `NotebookEdit` cell source, are a snippet and a cell, not a file's end, so the module-level `whole()` ends their last line first and no marker shows (the existing test pins `-zzz`/`+yyy` adjacent; `a notebook cell is not a file: no "no newline" marker on its diff` pins the cells). `maxLines` and the header lines are unchanged. The markers are reviewer-prompt text, so they stay in `legolas.ts` with `(no change)`. Test: `a last line with no newline is marked, and differs from the same line with one` (`'a\n'`/`'a'` both ways, both sides without a newline with the last line unchanged as context, last line changed, a new file, an emptied file). Mutations: no distinction, no marker printed, snippets marked, cells not normalised (fails the notebook test).
   - **(e) `safer_alternative` is capped** (`parseVerdict` in `hooks/members/shared.ts`). Trimmed, then cut to `MAX_REASON_CHARS` (400) characters the way `twoSentences` cuts (the first 399 then `…`; one shared `capChars`). It is not cut to two sentences, since an alternative is often a command. A reviewer can no longer put a page of text into the refusal Claude reads, the question and the audit line. Test: `safer_alternative is capped at 400 characters, not cut to sentences; a missing one is fine on approve only` (`gandalf.test.ts`). Mutations: no cap, cut to two sentences.
   - **(f) A missing `safer_alternative` stays accepted on `approve`** (`parseVerdict`). Unchanged behaviour; the doc comment said the object has "exactly" the three keys and now says the keys may be only those three, and `safer_alternative` may be left out on `approve` only. The same test pins it: a missing one parses on `approve` (as `''`) and stays malformed on `block` and `revise`. Mutation: requiring it on `approve` fails the parsing tests.
   - **(g) Where git would run (`runsElsewhere` in `hooks/members/galadriel.ts`).** The one pure test behind every git read the mod makes. A shell part "would run elsewhere" when a word of the part is `-C`, `-c`, `--git-dir`, `--work-tree` or `--namespace` (bare or `=value`); or when the call's command text assigns a git location variable anywhere (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_INDEX_FILE`, `GIT_NAMESPACE`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`: a word boundary, optional `export`, then `NAME=`), or the part's words hold such an assignment (the parsed words catch a quoted `env 'GIT_DIR=/x'`, which has no word boundary in the raw text); or when the part's working directory (the finding's `cwd`, after any `cd`) is outside the root (`relativeTo(cwd, root) === undefined`), which includes the `/` an unknowable `cd $X` lands at. Reading the whole command text catches an earlier `export GIT_DIR=...;` part; erring toward "elsewhere" is the intended side (a message that merely contains `GIT_DIR=` also loses its preview). `gitArgs` returns nothing for such a part, so `planPreview` and `rangeDiffInspection` both give no inspection, as `-C` always did. Tests: "a part git would run elsewhere gets no git inspection and no range diff" (`tests/galadriel.test.ts`), "a location variable: no git runs, and the diff reviewer sits out" and "a cd outside the root, or to an unknowable place" (`tests/gitcwd.test.ts`). Mutations: dropping the command-text test fails the first two; dropping the parsed-word test fails the first (the quoted `env` forms); dropping the outside-root test fails the first (the register-level tests still pass, because the real-path check in (i) refuses a folder outside the root a second time); dropping `--namespace` from the options fails the first.
   - **(h) A `cd` inside the root carries its folder** (`Inspection.cwd`, `inFolder` and `planPreview` in `galadriel.ts`). A git part whose finding `cwd` differs from the session's working directory (an in-command `cd` to a folder inside the root) has its inspections tagged with that folder. A part working where the session does gets no tag, so every call without a `cd` runs git exactly where it did (`ctx.gitDir`, the deciding scope's directory). Path inspections are unchanged. The one-of-each key now includes the folder, so the same command in two folders is two inspections. `rangeDiffInspection` takes the call, the plan context and the part's folder and applies the same rule; `rangeOf` (in `elrond/council.ts`) is unchanged, so `register.ts` finds the part's finding (`classification.findings.find(finding => finding.part === range.part)`) for its `cwd`. A call that would run elsewhere gets no range inspection, and the diff reviewer sits out with `council.noRange` ("not asked: the changes could not be read"), exactly as `git -C` did. Tests: "a cd inside the root tags the git inspections with that folder; none leaves them untagged" (`galadriel.test.ts`), "a cd inside the root: the previews and the range diff run in that folder" (`gitcwd.test.ts`, which reads the folder each process ran in). Mutations: not tagging (`inFolder` returns the steps as they are) fails six tests; leaving the folder out of the key fails the first; not passing the part's folder to `rangeDiffInspection` in `holdCouncil` fails five.
   - **(i) `runGitInspection` resolves the folder** (`gitDirOf` in `hooks/register.ts`). A step with a `cwd` is first resolved with `$.fs.stat(cwd, { resolve: true })`; if that fails, or its `realPath` is not the real root or inside it (`ctx.realRoot`, as `sqlFilesOf` and `realPathOf` measure), the inspection does not run and counts as failed (no preview line, as any failure). Otherwise it, and its `orElse`, run with `cwd: realPath`; a step with no `cwd` runs in `ctx.gitDir` as before. The choice sits in `runGitInspection`, so `previewOf` and `rangeDiffOf` share it. The root itself counts as inside (`cd ..` back to the root from a subfolder), where `sqlFilesOf`'s strict `isInside` would not; `realPathOf` makes the same exception. Tests: "a cd into a link that lands outside the root: no git runs, and the diff reviewer sits out", "a cd into a link that stays inside the root runs git at its real folder" (`gitcwd.test.ts`). Mutation: running in the lexical folder without the stat fails these two and the merge test of the same name.
   - **(j) The merge's current branch follows the same rule** (`mergePlace` in `galadriel.ts`, the `needsCurrentBranch` site in `register.ts`). If any merge part of the call would run elsewhere the branch is not read: it is unknown, which already counts as a merge into a protected branch (a council sitting, `isBranchAssumed`). Otherwise it is read in the first merge part's folder: its in-command `cd`, real-path checked by `gitDirOf`, else `ctx.gitDir` when that part works where the session does. A failed real-path check is unknown. `needsCurrentBranch` and `bigOperationOf` are unchanged (`elrond/council.ts`); `/council test` still reads nothing. Tests: "read in the first merge part's folder", "a merge git would run elsewhere has an unknown branch", "one merge part that would run elsewhere is enough", "a cd into a link that lands outside the root: the branch is unknown" (`gitcwd.test.ts`). Mutation: dropping the elsewhere loop in `mergePlace` fails the second and third.
   - **(k) Push option values are values** *(superseded by §15 items 18 and 19: the range is per refspec, and `PUSH_OPTIONS_WITH_ARG` now lives in `rules/push.ts`, read by `parsePush`)* (`pushRange` in `galadriel.ts`). The word after any option in `PUSH_OPTIONS_WITH_ARG` (`checks.ts`, now exported: one table for the force-push rule and for the preview) is skipped, so `git push -o ci.skip origin main` reads remote `origin`, branch `main`, range `origin/main..HEAD`. `--opt=value` was already dropped as an option. Test: "the value of a push option is not the remote or the branch" (four spellings, preview and range diff). Mutation: not skipping the value fails it.
   - **(l) No configured program starts in an inspection** (`GIT_ENV` in `register.ts`, the write preview in `galadriel.ts`). `git diff --stat` in the write preview gets `--no-ext-diff` and `--no-textconv` before `HEAD` (the range diff already had both). `GIT_ENV` gains `GIT_CONFIG_COUNT=2` with `core.fsmonitor=false` (a configured fsmonitor hook would run on `git status` and `git diff`) and `log.showSignature=false` (with it set, `git log` runs the configured gpg program: a tightening of the same kind). Every git process the mod runs, the previews, the range diff and the current branch, goes through `GIT_ENV` (there are two `$.process.run` sites, `runGitInspection` and `currentBranchOf`). The test kit's `process.run` hook now records each process's `env` (`World.processEnvs`). Tests: "every git process the mod runs carries the config overrides" (`gitcwd.test.ts`), "no configured program starts: the write diff turns off external diff and textconv" (`galadriel.test.ts`). Mutations: removing `GIT_CONFIG_COUNT` fails the first; removing the two flags fails the last two.
   - **(m) `unquote` dropped from the delete preview** (`planPreview`). `ShellPart.coreWords` is built from the parser's words, "every word, quotes removed" (`shell.ts`: the scanner appends a quoted span's content without its quotes, for `'...'`, `"..."`, `$'...'` and `$"..."`), so the second strip only ever removed quote characters that were part of the text (`rm -r '"x"'` now previews the folder named `"x"`, which is what the shell removes). No word source keeps quotes, so `unquote` is gone. Test: "a quoted delete target is the same as an unquoted one" (`rm -r "build dir"`, `rm -r 'x'`), which passes before and after, as a regression guard.
   - **(n) Inline SQL is not a target** (`sqlTargets` in `hooks/elrond/operations.ts`, `CLIENT_OPTIONS` in `hooks/members/aragorn.ts`; REVIEW §3.4). The key of a SQL client read the first positional when no option named a database, so for `psql -c "DELETE FROM users"` the target was the statement itself and every rephrase (`delete from users where 1=1`) was a new operation, with its own rounds and its own failed attempts. `sqlTargets` now drops the value of each inline-SQL option of the client before it looks for a target, in both forms (`-c "…"` and `--command=…`). The options come from Aragorn's `CLIENT_OPTIONS` (now exported), the table that already says which options carry SQL for the database reviewer, so there is one table and the two cannot drift. File options (`-f drop.sql`) are not skipped: a file is a thing the call names. So `psql -c "DELETE FROM users"` keys `shell:psql`, `psql -d staging -c "select 1"` still keys `shell:psql staging`, `mysql -e "…"` keys `shell:mysql`. The key is wider (more calls share it), which is the safer side: the rounds and the lockout follow the target, not the wording. Test: `operations.test.ts › operation keys: accuracy (H3) › inline SQL is not a target…`. Mutation: with the skip removed, the test fails (`shell:psql DELETE FROM users`).
   - **(o) `-n` is not a value-taking option** (`SQL_TARGET_OPTIONS`). `psql -n` (no readline) takes no value, so `psql -n -d prod -c x` read `-d` as its value and keyed on `-d`; the key now names `prod`. Test: `› psql -n takes no value…`.
   - **(p) A redirect write keys on the written file** (`partOperation`, its last `return`). A part of a program in none of the special sets (not a path program, SQL client, git or subcommand program) that writes through a redirect now has the written files as its only targets, so `echo x > out.txt` and `echo y > out.txt` share `shell:echo out.txt`: the operation is the write, not the text it carries. Without a redirect write the targets are its positionals, as before; `2>&1` and `/dev/null` are not writes. `PATH_PROGRAMS`, SQL clients, git and subcommand programs are unchanged. Test: `› a redirect write keys on the written file…`. Mutation: restoring the positionals beside the file fails it.
   - **(q) `git push` reads `HEAD` as the current branch, and skips a push option's value** (`pushTargets`). After the existing cut at `:`, the `+` and `refs/heads/` stripping, a destination of exactly `HEAD` or `@` becomes `(current branch)` (the placeholder an absent refspec already gets), so `git push origin HEAD` and `git push origin` share a key; `git push origin HEAD:main` still keys on `main`. The value word after any option in `PUSH_OPTIONS_WITH_ARG` (`-o`, `--push-option`, `--repo`, `--receive-pack`, `--exec`; exported from `rules/checks.ts`, the table the force-push check uses) is skipped, so `git push -o ci.skip origin main` keys like `git push origin main` instead of reading `ci.skip` as the remote. Tests: `› git push reads HEAD as the current branch…`. Mutations: with the `HEAD` and `@` reading removed, or with the option skip removed, it fails.
   - **(r) `unquote` is gone from `operations.ts`** (REVIEW §3.8). The shell parser removes quotes as it builds each word (`scan` in `rules/shell.ts`: single, double and `$'…'` quotes), and a redirect target is built by the same code as any other word, so neither `coreWords` nor a redirect target ever holds the quotes the command had; `unquote` stripped nothing from them. It is dropped everywhere in `operations.ts`, including `normalPath`, whose other input, a file tool's `file_path`, is a path string in the call, not shell text. The one change is for a word that holds a quote character the shell escaped (`echo \"x\"` is the word `"x"`): its key now spells the quotes, so it no longer shares a key with `echo x`; they are different arguments. Test: `› quoted words key as they did…` pins the keys of `rm -r "build dir"`, `psql -d 'staging'`, `git push 'origin' "main"`, `rm -r build > "log file.txt"`, `echo x > "out.txt"` and others, computed before the change.
   - **(s) sqlite3 in the database profile** (`CLIENT_OPTIONS` in `hooks/members/aragorn.ts`; REVIEW §3.8). `sqlite3` takes SQL as `-cmd` (inline, run before the main commands), `-init FILE` (a file of SQL) and as the positional after the database file (`sqlite3 app.db "DROP TABLE x"`). The table gains two optional fields, used only by `sqlite3`: `sqlArgAt` (the 1-based positional that is SQL, here 2) and `valueOptions` (the other options that take values, with how many words each takes: `-separator`, `-newline`, `-nullvalue`, `-vfs`, `-maxsize`, `-mmap`, `-escape` take one; `-heap`, `-pagecache` and `-lookaside` take two, SIZE and N), so an option's value is not counted as the database or the SQL. Every other client's entry is unchanged. The second positional becomes an inline piece labelled `sqlite3 argument`. In the key, `sqlite3 -cmd "x" app.db` and `sqlite3 app.db "DROP TABLE x"` both key on `app.db`. **Not changed:** the production block rule. A `.sql` file's content stays out of the block rules (classification reads no files): `sqlite3 prod.db < drop.sql` and `psql -h prod-db -f drop.sql` are reviewed, with the file's SQL in front of the database reviewer, not blocked. Listed in the README's known gaps. The option list is from memory of `sqlite3 -help` (the binary was not available to check); sqlite3 also accepts every option with two dashes, so each entry (inline, file and value options) is listed in both spellings (`--cmd`, `--init`, `--separator`, ...). Only the second positional is read as SQL: `sqlite3 db "sql1" "sql2"` runs both, but a third word is not read as an inline piece (the call text still reaches the reviewer). Tests: `tests/aragorn.test.ts`.
   - **(t) Routing: `disabled` before `no-diff`** (`route` in `elrond/routing.ts`). A switched-off diff reviewer named for a shell command was reported as `no-diff` ("there is no file to diff"), hiding that it was off. The checks now run `mixed`, then `disabled`, then `no-diff`; the member that reviews is Gandalf either way. Tests: `routing.test.ts › a switched-off diff reviewer named for a shell command reports disabled…`. Mutation: with the order reversed, it fails.
   - **(u) The report: a council line without readable voices adds no cost** (`entryOf` and the cost loop in `elrond/report.ts`; REVIEW §3.8). A line with a `council` field, or with `member` `council`, whose `voices` is not an array used to be counted as an ordinary review under its `member` (a member named `council` showed up as a reviewer, with the sitting's tokens). It now sets `councilUnreadable` on the entry and the cost loop skips it: no `council` sitting, no member, no tokens. Everything else the report counts for the line (refusals, verdicts, timings, overrides) is unchanged. A valid `voices` array, even one that filters to nothing, is counted as before. A `council` field that is `null` reads as absent. Tests: `report.test.ts › a council line without a readable voices list…` and `› a council line with a valid voices list is counted as before…`. Mutation: removing the skip fails the first.
   - **(v) Existing stored keys.** The keys of the changed forms differ from the ones an earlier version stored; nothing is migrated. The counters live in the session value and a person's next prompt or `/clear` resets them anyway, so an old key simply stops matching.
   - **(w) Decisions the roadmap did not cover (tightenings, decided and recorded):**
     - The `edits` handling is defensive: the 2.1.304 types have no `edits` field, and the secrets scan already reads one.
     - A line-ending-only change is named rather than shown as "(no change)".
     - A notebook cell and a not-found snippet get no "no newline" marker.
     - `safer_alternative` is capped by characters, not cut to sentences.
     - The git location variables go beyond `GIT_DIR` and `GIT_WORK_TREE` (the full list in (g)) and are read from the whole command text.
     - `--namespace` joins the options that point git elsewhere.
     - `log.showSignature` is switched off with `core.fsmonitor`, and the write preview's `git diff --stat` also gets `--no-textconv`.
     - A merge that git would run elsewhere (`-C` included) has an unknown current branch.
     - The push option values are skipped in the operation key too, not only in the preview.
     - `@` reads as `HEAD`.
     - sqlite3's options are listed in both spellings, from memory of its help (the binary was not available), and only its second positional is read as SQL.
     - A line whose `member` is `council` but has no `council` field also adds no cost.
     - The session root itself counts as inside for the real-path check of a git folder.
   - **(x) Side effects that loosen, put to the maintainer at the H3 checkpoint (approved 2026-10-21):**
     1. A merge's current branch may now be known where it was unknown, so a merge that used to count as into a protected branch (git read in the deciding scope's folder, or failing there) may no longer: `cd sub && git merge feature` with `sub` a nested repository on a topic branch, or `cd app && git merge feature` from a multi-repository root.
     2. A key is narrower for a word holding a literal quote character the shell escaped: `echo \"x\"` no longer shares a key with `echo x`; they are different arguments.
     - Decision: both approved by the maintainer on 2026-10-21.
   - **(y) Not done.**
     - The operation key still drops `sudo` (seen in §13.5 (h); not in the H3 table).
     - A hook body that keeps running after its budget cut-off (not in the H3 table).
     - The `/council TEST` upper-case finding of REVIEW §2.9 does not reproduce: the subcommand is lower-cased only for the switch, and the argument is sliced from the text as typed.

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

*2.1.308 (§12.7, from the types; not probed): `decider` is gone. Every ask a `tool.check` hook makes is now a person's, and the verdict's `plugin` names the hook's plugin (set by the engine). The types now say such an ask is answered by "the dialog, the host's callback or a PermissionRequest hook", where on 2.1.304 a PermissionRequest hook's allow was ignored (the table above). Conclusion 1 is therefore established for 2.1.304 only, until it is probed again. 2.1.322 changes none of this.*

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

### 14.6 C6: small things seen in the log

ROADMAP C6.

**`$.session.surfaces()` never rejects.** The 2.1.304 types say so ("Empty in a plain -p run; never rejects"), and a hook on `session.surfaces` that fails is skipped, with the hooks beneath and core answering in its place (`EngineEventOf`), so another plugin cannot make it reject either. The six `.catch(() => [])` wrappers on it in `register.ts` were dead and are gone. Nothing changes, so no test: the fixtures answer `session.surfaces` and none rejects.

**A project check whose binary is missing.** Checked live headless on 2.1.304 (`claude -p --plugin-dir`, a throwaway repository with a local bare remote, `git push origin main` convening the full council; one `/council test`, then two councils, six reviews on Opus):
- *A bare missing binary* (`["c6-no-such-binary", "--check"]`): `$.process.spawn` rejects its first pull, as the types say; the engine's debug log reads `failed to start: ENOENT: Executable not found in $PATH: "c6-no-such-binary"`. The check ended in 12 ms with status `error`, and Claude read `"bare" could not be started.` among the reasons for the block. No hang. The engine's message was not passed on then: `runCheck` dropped the rejection.
- *The same binary behind `env`* (`["env", "CI=1", "c6-no-such-binary", "--check"]`, the README's form for a non-interactive check): `env` starts and exits 127, so the check ended in 22 ms with status `failed`, and Claude read `"wrapped" failed with exit code 127. Its last lines:` followed by `env: 'c6-no-such-binary': No such file or directory`.
- With both in one rules file, the first one's block stopped the `env` one (status `stopped`, 24 ms), as §8 step 5 says: the first failing check stops the others. The README said only a reviewer's block does; it now says both.

**The unit test.** "a check that cannot start blocks" (`tests/council.test.ts`) pins the first case: the fixtures' `process.spawn` answers `{ deny }`, which rejects the first pull as the engine does. Mutation: `statusOf` returning `stopped` instead of `error` for a run with no exit fails it and "a check keeps the last 20 lines, and passes on exit code 0 only". The second case is a non-zero exit like any other, covered by "a failing check is a block, with its last lines". No new test is needed.

**The cloud check** (for the maintainer; not run here, it needs a cloud environment). It confirms that a cloud container's `PATH` lookup fails the same way, at once, and not by hanging.
1. A throwaway GitHub repository (never this one, never one that holds the mod's checkout) with one commit, including `.claude/council-of-elrond/rules.json`:
   ```json
   {
     "schemaVersion": 1,
     "gimli": {
       "commands": [
         { "name": "probe", "argv": ["c6-no-such-binary", "--check"], "timeoutMs": 60000 }
       ]
     }
   }
   ```
   One check only: with two, the first to fail stops the other.
2. A cloud environment holding only that repository, whose setup script installs the mod at the branch or tag under test (docs/INSTALL.md, "Cloud sessions").
3. In a new session, one prompt: `Run exactly this shell command once with the Bash tool and report its result verbatim; do not retry: git push origin HEAD:refs/heads/c6-probe`. The push convenes the full council (three reviews on Opus); the check makes it a block, so nothing is pushed.
4. Note the refusal Claude relays, and the time from sending the prompt to the refusal. Expected: `"probe" could not be started. The error: council-of-elrond: $.process.spawn(c6-no-such-binary) failed to start: ENOENT: Executable not found in $PATH: "c6-no-such-binary"` among the reasons, after the reviewers' few seconds. A hang would read `"probe" did not finish within 60 s and was ended.` after a minute.
5. Don't try to read the audit line from inside the session: `.claude/council-of-elrond/` is a protected path, and a protected path gets no chat code (§14.4), so where nothing draws the read is refused. The refusal from step 4 is the record.
6. Record the result here and tick C6 in ROADMAP.md.

**Passing the message on** *(approved 2026-10-20)*. `runCheck` keeps the rejection's message and returns it as `GimliRun.problem`, only when the final status is `error`: a run the clock or the council ended never carries one. Where the council's runs are redacted, the message is redacted too, with the call's patterns, and only then cut to one line of `PROBLEM_CHARS` (400) characters, so a cut cannot split a secret. `withTail` puts it after the status line and before the tail, in the reason Claude reads (`The error: …`); the audit `summary`, the `opinions` and the debate record are built from `runLine` and carry none of it, like the tail. Tests: "a check that cannot start blocks" (error in the refusal, none in the audit line), the redaction and cap test (a project's own pattern, which the refusal's own shipped-pattern redaction would miss), and a `combine` test. Mutations: dropping the problem from `withTail` fails those three; dropping `redact` on it fails the redaction test alone. Checked live headless on 2.1.304 with the same probe (one council, three reviews): Claude read `"bare" could not be started. The error: council-of-elrond: $.process.spawn(c6-no-such-binary) failed to start: ENOENT: Executable not found in $PATH: "c6-no-such-binary"`, and the audit line held no `ENOENT`.

## 15. Hardening after the November review

An independent audit of the rules tier found forms that reached a weaker tier than intended: a
command the parser did not see, or a program it did not know. The rules tier is the safety
boundary, so each was closed the same way as in §10. Every decision below is a **tightening**: more
calls are reviewed, asked about or blocked, and none moves down a tier. *This was wrong for one case: a
protected path named as the value of a wrapper or runner option passed where it used to ask, which §16
item 9 found and corrected.* They are recorded here as
decided; the live list of what still passes is the README's "Known gaps in shell parsing".

**Index.** Direction is against the state before the item. "Current" means the item still describes
the mod; where a later item amended it, the item is named, and the amended sentence carries an italic note
in place.

| Item | Topic | Direction | Amends | Status |
| :- | :- | :- | :- | :- |
| 1 | Unquoted heredoc bodies scanned for substitutions | tightens | none | current |
| 2 | Wrappers with a positional or a split string (`chrt`, `taskset`, `setarch`, `exec -a`, `env -S`) | tightens | none | arities corrected by §16 items 9, 33, 40 |
| 3 | Multi-call binaries and runners; unknown options reviewed | tightens | none | amended by §16 items 9, 33, 34, 40 |
| 4 | A program name computed at run time; `$IFS` | tightens | none | widened by §16 item 9 |
| 5 | Interpreters fed code without a flag (`script-stdin`) | tightens | none | widened by §16 item 12 |
| 6 | Attached and clustered inline-code flags | tightens | none | current |
| 7 | The mod protects itself (`plugin-manage`, plugin folders) | tightens | none | amended by §16 item 11 (writes only), widened by item 12 |
| 8 | Commands are hashed exactly | tightens | §10 item 6 | the key also holds the folder, §16 item 2 |
| 9 | Cut input keeps both ends | tightens | none | current |
| 10 | Reviewers are told what a cut means | tightens | none | current |
| 11 | A cut shell command is never approved by a model alone | tightens | none | widened by §16 item 6 |
| 12 | Redact before cutting | tightens | none | current |
| 13 | Context left out is said so | tightens | none | current |
| 14 | The dialog renders call text behind a gutter | tightens | none | amended by §16 items 19, 28, 39 |
| 15 | A malformed verdict echoes less | tightens | none | current |
| 16 | More secrets are redacted | tightens | none | narrowed by §16 items 18, 36, 37; seam of long text by item 38 |
| 17 | A force push of the current branch meets the protected-branch block | tightens | none | widened by §16 item 12 |
| 18 | A push's preview and range diff show what is pushed | tightens | §13 item 1 | extended by §16 item 8 |
| 19 | One reading of push arguments | tightens | none | current |
| 20 | The retry brake follows each part of a compound command | tightens | none | amended by §16 item 7 |
| 21 | A push of every branch or tag says so | tightens | none | current |
| 22 | A project's rules file is trusted only after a person confirmed it | tightens | none | amended by §16 items 1, 10, 21, 28 |

1. **Unquoted heredoc bodies are scanned for substitutions.** A heredoc whose delimiter has no
   quote or backslash (`<<EOF`, `<<-EOF`) is expanded by the shell, so `$(...)` and backticks in the
   body run. `takeHeredocs` (`rules/shell.ts`) now records, per heredoc, whether the delimiter was
   quoted, and for an expanding one passes each substitution found in the body (`substitutionsIn`:
   a backslash escapes the next character, `$((...))` is searched inside) to the nested scan, so it
   becomes a part like any other. A body fed to a shell was already scanned whole; a quoted
   delimiter keeps the body as data. Decided: a substitution in an expanding body counts even when
   the heredoc feeds a program that only prints it, because the shell runs it first.
2. **Wrappers that carry a positional or a split string.**
   - `chrt` (priority), `taskset` (mask or list) and `setarch` (architecture) skip that word
     before the command. For `chrt` and `taskset`, a pid form (`-p`, `--pid`, in a cluster too)
     runs no command, so nothing is skipped and nothing is invented: the words parse as they always
     did, which is why `taskset` keeps `-p` as a value option. `setarch` skips its first word only
     when it is a known architecture name, so a command is never taken for one.
   - `exec` reads a cluster ending in `-a` (`-la name`, `-cla name`) as taking the next word.
   - `env -S` is read attached (`-S'cmd'`), in a cluster of `i`, `v` and `0` (`-vS`), and as
     `--split-string=`; the words after the string are appended to it as its arguments before it is
     classified.
3. **Multi-call binaries and runners.**
   - `busybox` and `toybox` are wrappers, so the applet is the command (`busybox sh -c` still reads
     its script).
   - `fakeroot`, `firejail` and `systemd-run` are wrappers. `fakeroot` and `systemd-run` have every
     option listed, so an option they do not know cannot be skipped by guesswork.
   - `op run`, `doppler run` and `mise exec`/`x` are runners, with `mise`'s `tool@version`
     words read before its `--`.
   - `script -c`, `nix-shell --run|--command` and `tmux new-session|new-window|split-window|
     respawn-pane` (and their short names) are not stripped: their command string is classified
     as `sh -c` is, from `inlineScriptOf`, so the program's own arguments stay visible to the
     protected-path check. `script FILE COMMAND` (the BSD form) reads what follows the file.
   - The two-word runners' option skipping assumed every option took a value, so a flag
     (`npm exec --yes`) swallowed the command. Each runner now has the options it takes a value
     for, a shared list of flags, and optional script options (`npm exec -c`, `doppler run
     --command`, `mise exec -c`). **An option in neither list is read as taking a value, as every
     option was before**, so no command that was seen is lost, and the call is also classified as
     it stands: `coreOf` returns the words from the runner on as `unresolved`, `endPart` adds them as
     a part, and the review rule `shell-runner-unresolved` matches it. The inner command keeps its
     own tier when that is stricter (a block still blocks). This is the "cannot reliably find the
     inner command: review" decision; the cost is a review for a rare valued option the tables lack,
     and the fix is to add it to the table. *Amended by §16 item 9 (every wrapper and runner has a
     table read by getopt rules, and an unlisted option makes the part unresolved), item 33 (three
     tables corrected), item 34 (`env -S` splicing is bounded) and item 40 (`nsenter -S` and `-G`
     followed by a separate word are read both ways).*
   - The rule's pattern repeats the runner names in `rules/shell.ts`; the two are kept in step by
     hand, and the rule's comment says so.
4. **A program name computed at run time.** After assignments and wrappers are stripped, a first
   word that contains `$` (a variable, `${...}`, a substitution; backticks and `$(...)` leave a
   placeholder) is a program nobody can name: the review rule `shell-dynamic-program`. It is a
   review, not an ask or a block, because a script that runs `"$@"` is ordinary, and a stricter rule
   (block, ask, or another review that matched) still decides. A quoted `'$X'` is indistinguishable
   after parsing and is reviewed too. Separately, an unquoted `$IFS` or `${IFS}` (with the empty `$9`
   trick that follows it) ends the word, as whitespace, before classification, so `rm${IFS}-rf${IFS}~`
   reaches the `rm` rule; inside double quotes it is data, as in the shell. The review rule is the
   floor if a form of `IFS` slips past the separator.
5. **Interpreters fed code without a flag.** The review rule `script-stdin` uses a new code check,
   `interpreter-stdin` (`rules/checks.ts`; a name in `CHECKS`, so a project rule can name it too).
   It holds for `python`, `python3`, `pythonX.Y`, `node`, `nodejs`, `deno`, `bun`, `perl`, `ruby`,
   `php`, `Rscript` and `lua` when standard input is a pipe (`ShellPart.isPiped`, set by the scanner
   for the part after `|` or `|&`), a heredoc, a here-string or a `<` redirect (not to
   `/dev/null`), and no word names a script, module or subcommand, and none is a module (`-m`),
   version or help flag. Decided: a pipe into a named script, `python3 -m json.tool` and
   `bun run build` stay as they were. An explicit `-` and `-c` are the inline-code rule's.
6. **Attached and clustered inline-code flags.** `script-inline` keeps its pattern for a code flag
   anywhere in the arguments and gains branches for the attached and clustered forms, matched only
   among the options before the script, so `python3 -m pytest -rA` and `node app.js --print=x` are
   not read as inline code. The perl and ruby clusters name the switches that take no value
   (`-ne`, `-pe`, `-0777ne`); `-Mfeature=say` is not one.
7. **The mod protects itself.** `plugin-manage` (ask) covers `claude plugin|plugins`
   `disable|uninstall|remove|rm|update|install|enable` and `plugin marketplace add|remove|rm|update`,
   through wrappers and a path to the binary. Ask, not block, because the user may do it on purpose.
   `claude plugin test|validate|list|eval` are not matched. The protected paths gain
   `**/.claude/plugins/**`; the user-level `~/.claude/settings.json` and `settings.local.json` were
   already covered by the existing `**/` entries, which match a path outside the root by its absolute
   form. A glob cannot name a home folder, so the entry is not limited to `~/.claude/plugins/`: a
   `.claude/plugins/` folder in a repository is protected too, the same breadth the settings
   entries have. A read of a plugin file asks as well, as a read of `.env` does.
   *Amended by §16 item 11: the plugin folders are protected against writes only; a plain read of
   them, and a run of a script they hold, are judged by the ordinary rules again.*
8. **Commands are hashed exactly.** The verdict cache and chat approvals match a command exactly,
   not after collapsing whitespace (this supersedes the shell-command half of §10 item 6).
   A newline separates commands, and whitespace inside quotes is data, so no normalisation is safe
   without parsing the command, and the parse cannot be the cache key's. A reformatted command is
   reviewed again; the cost is one more review for a command retyped with different spacing.
   *The key also carries the working folder, §16 item 2.*
9. **Cut input keeps both ends** (a tightening). `truncate` kept the start and dropped the end, so
   the end of a command, a script or a diff was never seen. `cut` (`members/shared.ts`) keeps about
   two thirds of each limit from the start and one third from the end, on line boundaries (a line
   longer than its share is cut inside), with one marker line, `[... N lines, M characters omitted
   ...]`. Every place a reviewer's input, or the dialog's call text, was cut now uses it, and the
   call's own redaction runs first. Where a text is cut twice (the preview: by the `previewLines`
   setting, then by the reviewer's own limit; a diff cut while it is built) the amounts add up in
   the note. Decided: a script and a `.sql` file are no longer cut in `register.ts` but redacted
   whole and cut by the prompt, so one limit decides and the note can say how much; the production
   patterns therefore match against the whole SQL, not its cut (more matches, never fewer). The
   range diff is no longer pre-sliced to four times its limit before redaction: the engine already
   caps a process's output at 4 MiB, and slicing first would drop the true end of the diff without
   a word.
10. **Reviewers are told what a cut means** (a tightening). The marker sits inside the data block,
    where the call's own text can write the same line, so it proves nothing. Every system prompt
    (`OMISSION_RULES`) says: content that was left out has not been seen and is not to be assumed
    safe; approve only if what is visible and the nature of the call make the rest low-risk,
    otherwise revise and ask for smaller pieces; a marker-like line with no cut notice after its
    block is just content. The prompt builder writes that notice (`fenced`, `Cut notice: ...`)
    outside the fence, after a block that was really cut, with the amount; text inside the fence can
    imitate it, but not outside it, so the one place that is trusted is the one the call cannot
    reach. Notes for context left out of a brief (item 13) are written the same way.
11. **A cut shell command is never approved by a model alone** (a tightening). A command that is cut
    hides code that will run, unlike a file or a diff, whose reviewer judges what it sees and is
    told the rest is missing. *Widened by §16 item 6 (renamed `isRunCut`): a script or SQL it runs counts too.* When the command text of a shell call (`isCommandCut`, `members/
    brief.ts`: the call limits of the general and the git and database reviewers; the range
    command's own 40 lines and 4,000 characters for the diff reviewer) is past its reviewer's limit
    and the verdict is an approve, the call is treated as one with no verdict: `askUser` with
    `escalate.commandCut`, so it comes to the person where one can be asked and is refused where not
    (`nobodyToAsk`, a failed attempt). A revise or a block stands. Nothing is cached, counts as no
    round, and the audit line keeps the reviewer's `approve` with the reason. In shadow mode a
    verdict never enforces, so the call runs and is not remembered. In the full council the rule
    applies to a combined approve when any seat's command was cut; an objection from any seat
    decides as before. A file tool's call text (its content) is never this: only a shell tool's
    command.
12. **Redact before cutting** (a tightening). A script, a `.sql` file, the changes a push would
    send, the read-only preview and a file's diff were redacted after the cut, so a secret across
    the cut no longer matched its pattern and a piece of it was shown. Each is redacted whole, then
    cut, as the full council's check tail already is and the dialog's call and preview are. `callDiff` and
    `formatPreviewCut` take the redaction as a function, so the order is theirs to keep.
13. **Context left out is said so** (a tightening). A `.sql` file outside the project, missing or
    unreadable (or past the three read) and a script not written through a file tool this session or
    unreadable were dropped without a word; the reviewer now gets a one-line note, as the diff
    reviewer already did for a file it could not read. The note counts; it names no path, so it
    carries nothing the call wrote.
14. **The dialog renders call text behind a gutter** (a tightening). The call and the preview came
    out as lines of the question, so a command could contain a line that looked like the dialog's own
    (a reviewer's verdict, a heading). Every line of the call and the preview now starts with the
    gutter (`ask.gutter`) and has its control characters, C1 controls and Unicode line separators
    replaced by a space *(§16 item 19: invisible and direction-changing characters go too, and a long line
    wraps with the gutter on every row)*; the dialog's own omission marker starts with two spaces and no bar, which a
    line of the call never does. A reviewer's reason, a failure's problem and a secret's label and
    snippet are put on one line the same way. `questionText` is still the one builder, and the
    excerpt keeps its 12 lines and 600 characters (15 and 900 for the preview), now from both ends.
15. **A malformed verdict echoes less** (a tightening). `parseVerdict` printed every unexpected key
    the reviewer chose, uncapped, into a dialog, a refusal and the log. It names at most three, each
    cut to 40 characters with control characters removed (`label`), and counts the rest.
16. **More secrets are redacted** (a tightening). A value counts as a placeholder only when all of it
    is one; a literal that merely starts with such a character is redacted and reported. Quoted
    passwords with spaces, shorter values, `curl -u user:password`, `--password` for the known
    database clients, and the `Authorization: Token`, `X-Api-Key` and `X-Auth-Token` headers are
    covered, and text past the scan limit has its end scanned. *Amended by §16 item 18: what is
    redacted and flagged is narrower again where the first version raised noise.*
17. **A force push of the current branch meets the protected-branch block** (a tightening).
    `forcePushProtected` (`rules/checks.ts`) only read refspecs that name a branch, so a force push
    that names none (`git push --force`, `-f`, `-f origin`) or only `HEAD` (`-f origin HEAD`,
    `origin +HEAD`), which overwrites whatever branch is checked out, was only a review even with
    `main` checked out. The check context gains an optional `currentBranch`
    (`CheckContext`, so `ClassifyContext` too); `forcesCurrentBranch(part)` is the one test for such a
    push (no refspec and a force flag, or a refspec landing on `HEAD` or `@` with a force flag or a
    `+`; `--all`, `--mirror` and `--prune` stay `forcePushProtected`'s whole). With a force of the
    current branch:
    - the branch is a protected one (`protectedBranches`, globs included): the block rule
      `force-push-protected-branch` fires;
    - the branch is unknown (not supplied, empty, or `HEAD`, a detached checkout): the new shipped ask
      rule `force-push-unknown-branch` (check `force-push-unknown-branch`, in `CHECKS`) fires. Ask,
      not block, as the branch may be a feature branch; a project rule can still decide a call, but
      cannot lower the block, and `disableRules` can switch the ask rule off like any shipped ask rule;
    - the branch is known and not protected: unchanged (review).
    *Amended by §16 item 12: a force push whose destination or remote is computed asks, and so does
    one that follows a part of the same call that may have switched the branch; a protected branch
    read before the call still blocks.*
    A destination-only delete, a refspec naming a protected branch (`+HEAD:refs/heads/main`), `--all`
    and `--mirror` keep their handling. `git push.default` and other config are not read.
    - **Who reads the branch.** `register.ts` (`pushBranchOf`), before the call is classified, and
      only for a call with a part `forcesCurrentBranch` is true for (`forcePushPlaces` in
      `rules/classify.ts`, a walk over the parts with each part's folder after any `cd`, the same
      `cwdAfter` the classifier uses). Any other call starts no process. Decided: this is narrower
      than "any call with a `git push` part", so an ordinary push, which cannot change the outcome,
      pays no extra git process and no existing process count moved. The read is `git rev-parse
      --abbrev-ref HEAD` through `currentBranchOf`: `GIT_ENV` (no locks or prompts, `core.fsmonitor` and
      `log.showSignature` off) and the 5 s inspection timeout. The session's own folder is used as
      it is; a folder a `cd` leads to is resolved and must lie inside the real root (`realDirInside`,
      the check `gitDirOf` makes).
    - **Unknown, never allow.** A part git would run elsewhere (`runsElsewhere`: `-C`, `--git-dir`,
      a location variable, a folder outside the root or one `cd` cannot name), a folder that resolves
      outside the root, a git failure, a timeout, empty output, a detached `HEAD`, or pushes in more
      than three distinct folders, leave the branch unknown: the call asks.
    - **Pushes in several folders.** `currentBranch` is one value, so when one call forces the current
      branch in folders on different branches, a branch the root's protected branches match is the
      answer (the block then covers each of them: the safer side), else unknown (ask).
    - `/council test` runs nothing, so it reads no branch: such a push shows as asked about, as a
      merge is assumed to land on a protected branch.
    - `--force-if-includes` counts as a force flag. It only modifies `--force-with-lease`, so this goes
      one step past git; a tightening, and the shared parser (item 19) takes any `--force-...` option.
    Tests: `rules.test.ts` (the block, review and ask matrix with the branch supplied, unknown,
    detached and empty; `forcePushPlaces`), `pipeline.test.ts` (through `register`: block, review,
    git failing, timing out, detached, empty, allow once, nobody to ask, no lookup for another call,
    a `cd`, git pointed elsewhere, two folders, more than three folders). Mutations: ignoring
    `currentBranch` in the check fails the block tests; treating an unknown branch as review fails
    the ask tests.
18. **A push's preview and range diff show what is pushed** (a tightening). Galadriel read the first
    refspec's destination only and always took `HEAD` as the source, so `git push origin
    other:main`, `git push origin other` and `git push origin a b` showed the checked-out branch's
    commits as what would be sent. Every refspec is now read (`pushPlan` in `members/galadriel.ts`),
    at most `MAX_PUSH_REFSPECS` (3): its range is `<remote>/<destination>..<source>` (a bare name is
    its own source), the log and the council's diff both, each with its own `orElse` against
    `<remote>/HEAD` for a branch the remote lacks (`<remote>/HEAD..<source>`, and three dots for the
    diff). A push that names no refspec is the current branch, `@{upstream}..HEAD`, as before.
    - **Nothing is shown for what cannot be named.** A source or destination that is not a safe ref
      (`SAFE_REF`: a space, `..`, a wildcard, a leading `-`), or any named refspec when the remote is
      not a plain name (a URL), has no range; a delete (`:old`, `--delete`, `-d`) sends no commits and
      has none, and no note. A range git cannot read (also after the fallback) counts as unseen.
    - **Said, trusted.** The count of refspecs with no range and the number past the cap become
      `note` steps of the plan (not counted against the cap; shown in the preview, so the person sees
      them), and a commit list that read nothing adds one more line (`unreadCommitsNote`). Every
      reviewer's prompt then carries each as a `Note:` line after its preview, outside any data block
      (`noteLines` in `members/shared.ts`, the same place `Cut notice:` and the unseen-script and SQL
      notes stand), in the general, git and diff reviewer's contexts (`notes`). The diff reviewer
      gets its own note for a range of the council's diff that could not be read; with none readable it
      sits out as before. Decided: a push with no readable range shows no commit list and no
      checked-out branch's commits in its place.
    - **Several ranges, one cap.** A push lists up to three commit lists beside the branch and the
      remote, so the plan's cap (3, `.claude/skills/council-of-elrond-development/references/workflows/change-reviewer.md`) rises by one per extra list (at most 5 for a
      push); every other kind of preview keeps 3. The council's diff of several ranges shares the
      diff limits (each range gets an equal share, then each sits under `# <range>` in one diff).
    - **Labels.** `commits it would send (<range>)` and the fallback's label name the range actually
      computed, per refspec, so the text of a push's labels changed (`origin/feature..feature`, where
      it read `origin/feature..HEAD`).
    - **Broad pushes (done in item 21).** `--all`, `--mirror` and `--tags` with no refspec still show
      the current branch's commits (`@{upstream}..HEAD`, labelled as such), though the push sends
      more than that; item 21 adds a trusted note saying so.
    `rangeDiffInspection` became `rangeDiffInspections` (a list and the notes). Tests:
    `galadriel.test.ts` ("what a push shows is what it pushes", and the pipeline tests that follow
    it), `gitcwd.test.ts` and `council.test.ts` for the changed range text. Mutation: taking `HEAD`
    as the source again fails the preview and council tests.
19. **One reading of push arguments** (`parsePush`, `rules/push.ts`). The force-push check, the
    operation key (`pushTargets`, `elrond/operations.ts`) and the preview (`pushPlan`) each had their
    own loop over the words after `push`. They now share one: it skips the value of an option in
    `PUSH_OPTIONS_WITH_ARG` (moved here from `rules/checks.ts`, which §13.7 (k) and (q) name), reads
    the force, delete and every-ref flags, and returns the remote and each refspec as source and
    destination (`+` and `refs/heads/` stripped from the destination; an empty source is a delete).
    `rules/` is the one folder `elrond/` and `members/` both already import, so no new cross-folder
    import. Operation keys are unchanged: every key `operations.test.ts` pins holds, and the new
    tests pin more forms. An empty word is dropped for the key and the preview and kept for the
    force-push check (`keepEmpty`), as each always read it, so no call that was blocked is read
    differently. Differences that tighten, by design: a `+` after the colon (`a:+main`) is stripped
    before the protected-branch test; any `--force-` option counts as force (item 17).
20. **The retry brake follows each part of a compound command** (a tightening). An operation's key
    and verb key were built from every gated part of a shell call joined together, so a part that
    was locked out or out of rounds came back under a new key, and a new verb key, once another
    gated part was added to the command: fresh rounds, no lockout, and every new combination the
    same. `Operation` (`elrond/operations.ts`) now also holds `partKeys` (each gated part's own key,
    exactly what a call of that part alone gets, redacted and capped alike) and `partVerbKeys` (each
    part's verb key). For a call of one part, a file tool or another tool they hold just `key` and
    `verbKey`, so those are counted and reset as before. Every reader goes through a helper that
    takes the `Operation`, so no caller checks a bare key (`roundsLeft`, `isOutOfRounds`,
    `noteRound`, `resetRounds`, `resetOperation`, `noteWipe`, `lockoutOf`, `lockedVerbOf`).
    - **Counting.** A failed attempt counts on the whole key, on each part key that differs from it,
      and on each distinct part verb key; the joined verb key is not counted any more (the per-verb
      counters replace it). A review round counts on the whole key and each part key.
    - **Checking.** Locked out: the whole key or any part key has 3 failed attempts, or any part
      verb key has 5. Out of rounds (the next attempt goes to the person, with no model call): the
      whole key or any part key has used its 2 rounds. The refusal's "rounds left" is the fewest
      across those keys. The lockout reason names the verb that reached its cap.
    - **Resets stay narrow.** A call that ran clears its whole key only; its part keys and the verb
      counters stay. The person's typed instruction gives the whole key its rounds back, not its part
      keys', so a compound whose part is out of rounds still goes to the person after it (and so does
      that part alone). For a call of one part, a file tool or another tool the whole key is the only
      key, so these resets are what they were. A new person's prompt resets everything, as before.
      The wider resets (a success or an instruction also clearing the part keys) were considered and
      left to the maintainer: they could lower a count a call of that part alone had earned, which is
      a loosening.
    - **State.** The stored shape is unchanged (version 5): `ops` and `verbWipes` hold the extra keys,
      so nothing is migrated and no lockout is lost. A joined verb key already stored (from a
      version that counted it) is still read: a call whose joined verb key equals it is locked out
      by it until the next prompt, so an upgrade drops no lockout. It is no longer written.
    - **Bounded.** Only the first `MAX_PART_KEYS` (8) gated parts of a call get part keys and part
      verb keys. A call with more is decided by its whole key plus those eight, and a failed attempt
      records at most nine keys, so a huge compound command cannot grow the session record (`ops`
      stays capped at 200 entries as before). *Amended by §16 item 7: a call with more is no longer
      reviewed by a model, and the verb counters are bounded too.*
    - **The status** (`attemptsOf`, the pane and `/council`) counts a verb at its cap as locked out,
      so it cannot say "0 locked out" while a verb is locked. Side effects of the keys sharing one
      map: "operations" counts every tracked key, part keys included; "attempts" is the sum of the
      verb counters, so a command with two kinds counts once on each; "locked out" counts keys and
      verbs, so one locked compound can show as more than one.
    - **Left as it was.** The lockout text for a part's key still reads "the same operation" (a part
      of this call is the same operation). A retry through another tool or verb is still another
      operation.
    Tests: `operations.test.ts` (keys, counting, checking, resets, the stored joined verb key, the
    status, and single-part, file and tool operations pinned to explicit state), `rounds.test.ts`
    (through `register`: a locked part refuses a compound with no model request or question; an
    out-of-rounds part sends it to the person with no model request; the typed instruction). Mutations:
    checking only the whole key fails the lockout tests, counting a failed attempt only on the whole
    key fails the counting and pipeline tests, ignoring part keys in `isOutOfRounds` fails the rounds
    tests, resetting the part keys too (on a success or an instruction) fails the reset tests, leaving
    verb lockouts out of the status fails its test.
21. **A push of every branch or tag says so** (a tightening). `git push` with `--all`, `--mirror` or
    `--tags` and no refspec still previews the current branch's `@{upstream}..HEAD`, as item 18 left
    it, and its plan now carries a trusted `note` step (`broadPushNote`, `members/galadriel.ts`) saying the
    push sends more branches or tags than the commits shown. It is in the preview the person reads
    and in the `Note:` line every reviewer's prompt carries outside any data block, and in the notes
    of the council's diff. A note is not counted against the preview's cap. A push that names a
    refspec is read per refspec, as before, and has no such note. The shipped rules block `--all` and
    `--mirror` (`force-push-protected-branch`), so in practice the note shows for `--tags`; the
    plan and its tests cover all three. Test: `galadriel.test.ts`.
22. **A project's rules file is trusted only after a person confirmed it** (a tightening; ROADMAP M1.3,
    amendment AM8). A rules file arrives with a cloned repository and was honoured in full with
    nobody confirming it: it could allow any tool, switch shipped review rules off, choose models,
    blank what reviewers see with its own patterns, allowlist secrets and name commands the mod
    spawns outside Claude Code's permission check. Decided by the maintainer on 2026-11-13: the
    settings that loosen the gate or run code take effect only after a person has confirmed that
    exact file content; until then they are ignored, and the settings that can only tighten still
    apply, so an untrusted file can never make the gate weaker than no file.
    - **The split** is one pure function, `splitByTrust` (`config/trust.ts`), driven by the table
      `FIELD_TRUST` (a `Record` over every field of the schema, so a field added without a
      classification fails the typecheck, and `trust.test.ts` compares the table with `TOP_KEYS`,
      `GOLLUM_KEYS` and `GIMLI_KEYS`):

      | Field | Held back until confirmed? | Why |
      | :- | :- | :- |
      | `rules` with tier `allow` | yes | lets a call through |
      | `rules` with tier `review` | yes | see below |
      | `rules` with tier `ask`, `block` | no | at or above every tier a project rule displaces |
      | `disableRules` | yes | gates fewer calls |
      | `protectedPaths`, `protectedBranches`, `productionPatterns` | no | lists that only add to the shipped ones |
      | `bigOperations` | no | sends more calls to the full council |
      | `models` | yes | names a model the mod sends the call to |
      | `gollum.patterns` | yes | runs on call text and blanks what reviewers see |
      | `gollum.allowlist` | yes | lets a secret through the scan |
      | `gimli.commands` | yes | starts processes outside the permission prompts |

      *Amended by §16 item 10: `review` rules no longer wait, and none of the rules of a file nobody has
      confirmed replaces a shipped decision; they only add to it. The table and the paragraph below are the
      original decision; the table in force is in the README's "Trusting a project's rules file".*

      **`review` rules wait too (a tightening over the brief's first list).** A project rule decides
      before the shipped non-block rules do (`classify`), so a project `review` rule that matches
      what a shipped `ask` rule matches lowers it to a review: `sudo ls` under a project review rule
      for `ls` is a review where the shipped rules ask. Tightening-only could not be shown for it,
      so it is held back with the `allow` rules. `ask` and `block` rules cannot loosen anything
      (block rules are a floor), so they apply at once. With the allow and review rules removed the
      remaining project rules keep their order, and what they uncover is only ask or block.
      `loadConfig(text, shipped, isTrusted)` merges only `split.always` when `isTrusted` is false
      and reports the rest as `needsTrust` (counts and a summary). Held-back settings are not in
      the compiled config (`compileConfig` gets only `split.always`), so no held-back pattern is
      ever run on call text and no held-back model id is ever sent a request. They are not
      untouched: `validateOverrides` builds a `RegExp` from each pattern once, to report a bad one,
      before the split, so a held-back pattern is parsed at load (a secret pattern is also matched once
      against the empty string, to refuse one that matches empty text), but never matched against call
      text.
    - **The record** is one value in the plugin's own store (`$.store`, key `trustedRules`):
      `{ v: 1, files: [{ path, hash }] }`, oldest first, at most 200 (`TRUST_CAP`; the oldest is
      dropped). `path` is the file's real path (`$.fs.stat` with `resolve`; the path as given when it
      cannot be resolved) and `hash` the SHA-256, in hex, of the exact text as `$.fs.read` returned
      it, the same text that is parsed, so what was hashed is what is enforced. A file is trusted
      when its current hash equals the one stored for its path. Any change to the file, or a copy at
      another path, is untrusted. A store that cannot be read, or holds another shape, trusts
      nothing. The record lives outside the repository and outside session state.
    - **The option.** `trustProjectRules` (`/config`): `confirm` (default) or `always`; any other value
      is `confirm`. `always` trusts every file and reads no record (today's behaviour), for a host whose
      owner controls which repositories it opens (cloud, CI). It is the user's configuration and is
      never read from a rules file. Tests run with the manifest default, so those whose fixture holds
      settings that wait set `{ options: { trustProjectRules: 'always' } }` on the test itself: the
      shared fixture cannot set a default (the kit takes options per test): 31 tests in `council`,
      `debate`, `done`, `gollum`, `pipeline`, `relay`, `robustness` and `scopes`, each with a project
      file of allow rules, models, patterns, an allowlist or checks.
    - **Project checks never silently drop.** A big operation whose touched scopes hold held-back
      `gimli.commands` runs none of them (no process is spawned) and gets in their place one check
      result, `project checks`, status `error`, problem `not run: the rules file is not trusted ...`
      (`notRunCheck`), which `combine` counts as a check that could not be started: a block, with
      the reason to Claude. With Gimli switched off in `/config` nothing is dropped, so nothing is
      said. A trusted scope's checks in the same call still run. `/council test` says the council
      would block.
    - **The person is told** once per session per file content (`warnOnce` under `trust:<path>:<hash>`):
      a transcript line and a toast with counts only, and, where nothing draws, one model-readable row
      through the relay (`relay.rulesUntrusted`, like the start notice) that holds counts and no text
      from the file. `/council rules` and `status` show per file: trusted (confirmed), trusted by the
      option, or not trusted with the counts ignored, and say that no allow rule or allowlist entry is
      offered meanwhile.
    - **Confirming.** *(Amended by §16 item 1: the listing is complete or the file is not confirmable by code, the
      code is derived from a per-session secret, and it works only for a listing shown in this session. What
      follows describes the first version.)* `/council trust` lists, per untrusted file in scope (the root's, or each
      repository below a multi-repository root, §14.5), the counts and every allow or review rule
      (id, tools, patterns), disabled rule id, model, check (its argv) and pattern id, then the
      file's code, the first 8 hex characters of its hash. Allowlist entries are counted, never
      shown (an entry may be the secret). Every value is redacted with the shipped patterns,
      stripped of control characters (C0, C1, U+2028 and U+2029) so it is one line, capped at 300
      characters and printed after the dialog's gutter (`ask.gutter`); ten items per kind, then
      "and N more"; twenty files. `/council trust <code>` re-reads and re-hashes every file in
      scope at that moment and confirms the ones whose hash starts with the code (8 to 64 hex
      characters), records them, reloads the config and says what is now in force. No match, or
      matches with different content, confirms nothing and says so; several files with the very same
      content share a code and are confirmed together (decided: the person saw that content listed
      for each). `/council untrust` removes the record of every file in scope and reloads. `trust`
      (both forms) needs a person (`needsPerson`: `composer` or `bridge`, like `off`); `untrust`
      only tightens and runs from any source. `/council reload` reads the record and trusts nothing.
      The listing is not relayed where nothing draws (the relay's four subcommands stay four): such a
      host sets the option.
    - **The mod's own writes.** After the person answered "Add the rule" or confirmed an allowlist
      entry, the content just written is recorded as trusted when the file was trusted before the
      write, held nothing that waits, or did not exist (the person confirmed exactly that change). No
      other path records trust. The offers themselves are skipped for a file that is held back (the
      entry would not take effect), and `writeOverrides` re-reads and refuses the same case, so a
      file that changed meanwhile is never rewritten. With the option at `always` nothing is recorded.
    - **Project text is shown as the project's** (decided with the above). A project rule's
      reason reached reviewers after "Flagged because" and the dialog as if it were the mod's own
      words. `reasonsOf` (`members/shared.ts`) keeps the shipped rules' reasons as written and puts
      the project's, cleaned (one line, control characters stripped, 200 characters), in their own
      `projectReasons`: each reviewer's prompt shows them inside a `project-rule-reason` data block
      under a lead-in that says they are the project's text, and the dialog shows them after the
      gutter under "the project's own words". This applies to a trusted file as well.
    - **Not covered.** *(Amended by §16 item 1: the reason is now introduced as the project's text in both.)*
      The reason of a project block or ask rule is still part of the refusal Claude
      reads and of the audit line, as before. A project regex in an `ask` or `block` rule, or in
      `bigOperations`, is compiled and run on call text before trust, as before: it can only tighten,
      but a pattern that backtracks without end could stall the hook (the engine's own 10 s budget
      cuts the hook off from 2.1.299).
    Tests: `trust.test.ts` (the table against the schema, the split per field, `loadConfig` held
    back and never looser than no file, the record, the listing's redaction, caps and gutter, the
    prompts and the dialog, and through `register` every effect before and after confirming, the
    wrong and the stale code, an edited file, the `sdk` origin, `untrust`, the option, a failing
    store, the mod's own writes, two repositories). Mutations: treating every file as trusted fails 22
    tests; dropping `trust` from `needsPerson` fails the origin tests; comparing only the path fails
    the edited-file and record tests; running the checks of an untrusted file fails the spawn test;
    reading review rules as tightening fails the table and the never-looser test; dropping the
    not-run check fails its test; offering the rule for an untrusted file fails the offer tests.

## 16. Hardening, round 2

This section is the hardening after §15, in three passes. **Round 2 (items 1 to 27)** began with an
adversarial review of the confirmation in §15 item 22, which found that a person could be led to confirm
settings they had not been shown, and went on to the decision path (approvals, the cache, the retry brake),
protected paths, redaction and the dialog. **Round 3 (items 28 to 39)** is the third review's: items 28, 29
and 36 correct defects the previous round introduced (items 10, 11 and 18), items 30 and 31 finish the plugin
folder reads of item 11, items 32 to 35 close classifier gaps, a stall and a cache hole, and items 37 to 39
are redaction, the seam of a long scan and the dialog. **The last passes (items 40 to 46)** correct one reading of
item 33 (item 40), then the third review's defects: a redirect that took the next command's program (item 41), two
readings that item 40 and item 34 left open and a bound on the copies scanned (item 42), the `PWD` exemption of item 36 (item 43),
and tests (item 44); item 45 replaces the bound of item 42, which lowered blocks to reviews in both of its versions, by budgets for
the readings the parser adds, and finishes the `PWD` continuation; item 46 closes a `${NAME}` in an `env -S` string, which
every earlier item had read as a plain word, and narrows the `PWD` exemption to where a shell reads an assignment word.
They are recorded as decided.

Most items are tightenings: nothing can be confirmed that could not be before, `trust` still needs a person,
and `trustProjectRules=always` behaves as it did. The ones that are not, by number: **item 11** loosens one
thing against the commit before it (reads of the plugin folders); **item 18** undoes redaction noise the
commits before it added (§15 item 16); **item 31** restores two of the reads item 11 had made ask (`[[ ]]`
and `git -C <path> <read>`); all three as the maintainer approved. **Item 33** reads three option tables
right, which lowers some commands the old reading misread (item 40 takes back the `nsenter -S` and `-G`
part of that). **Items 20, 25 and 27** change wording or logging only. Each loosening goes nowhere below
`origin/main`, except the lines item 18 names (narrowed by item 36) and the commands item 33 reads right *(and the classes that item 46 lists as still lower than `origin/main`)*.

**Index.** Direction is against the state before the item ("restores" puts back what an earlier item of the
same work took away). "Amends" names what the item changes in an earlier decision. A status other than
"current" names the item that amended it; the amended sentence carries an italic note in place.

| Item | Topic | Direction | Amends | Status |
| :- | :- | :- | :- | :- |
| 1 | Confirming a rules file confirms only what was listed in full in this session; derived code; short names; the project's reason as the project's text | tightens | §15 item 22 | listing and what the mod's own write records amended by item 28 |
| 2 | An approval is bound to the folder the call runs in | tightens | §15 item 8, §14.5 keys | current |
| 3 | The full council's approve is never cached | tightens | §6 item 9 | current |
| 4 | A call with a git part is never served from the cache | tightens | §6 item 9 | widened by item 35 |
| 5 | The cache test and the out-of-rounds check read the session afresh | tightens | §13.4 (f) | current |
| 6 | A cut script or SQL file is not approved by a model alone | tightens | §15 item 11 | current |
| 7 | The retry brake with many parts and its counters | tightens | §15 item 20 | current |
| 8 | A push preview that may be stale says so | tightens | §15 item 18 | current |
| 9 | Protected paths on every word; wrapper and runner options read in full | tightens | the opening of §15 | tables corrected by items 33, 40 |
| 10 | A rules file nobody has confirmed adds protection and never replaces a shipped decision | tightens | §15 item 22 | wording done by item 20; listing and the mod's own write amended by item 28 |
| 11 | The plugin folders ask for a write, not a read | loosens (against the previous commit; never below `origin/main`) | §15 item 7 | amended by items 20, 29, 30, 31 |
| 12 | More classifier gaps closed (block rules, pushes, interpreters, command lines handed to other programs, self-protection) | tightens | none | amended by items 32 to 34 |
| 13 | The allow rule offered after "allow once" is narrower | tightens | §10 item 7 | current |
| 14 | A project's own patterns are applied wherever the mod redacts | tightens | none | current |
| 15 | The scan reads what a call carries, whatever the tool | tightens | §13.2 | seam of a long text by item 38 |
| 16 | A text too long to scan in full is not passed silently | tightens | none | amended by item 38 |
| 17 | `/council rules` shows no character of an allowlisted secret | tightens | §13.5 (c) | current |
| 18 | Redaction noise this release added is undone | loosens (against §15 item 16 as first made) | §15 item 16 | amended by items 36 and 37 |
| 19 | The dialog: invisible characters, wrapped rows, the size cap | tightens | §15 item 14 | amended by items 28 and 39 |
| 20 | Wording | neutral | the follow-up remark of item 10, the "Not done" of item 11 | extended by item 28 |
| 21 | A rules file with errors keeps what can only tighten | tightens | none | current |
| 22 | Validation caps | tightens | none | current |
| 23 | `/council reload` needs a person | tightens | §13.4 (a) | current |
| 24 | A command that ran and failed is not read as a permission denial | tightens | §6 item 14 | current; a class of wordings is open (ROADMAP M1.9, OD2) |
| 25 | The audit log says when it fails | neutral | none | current |
| 26 | The names a call supplies sit inside the fence | tightens | none | current |
| 27 | Strings, dead code, documents | neutral | none | current |
| 28 | Confirming covers everything it switches on; the mod's own write records trust only for what the person confirmed | tightens | items 1 and 10 | current |
| 29 | A `cd` through `$HOME`, or into a folder the text names, is followed | tightens | item 11 | current |
| 30 | A reader's output is followed through a pipe; `yq -s` is no reader | tightens | item 11 | current |
| 31 | `[[ ]]` and `git -C <path> <read>` are readers again | restores (never below `origin/main`) | item 11 | current |
| 32 | Typing into another terminal asks | tightens | item 12 | current |
| 33 | Option arities found wrong | tightens in intent; lowers some misread commands | item 9, item 12 | `nsenter -S` and `-G` amended by item 40 |
| 34 | A stall on crafted input (`env -S` splicing bounded) | tightens | none | past the bound amended by items 42 and 45 |
| 35 | A call that runs a script or a project's runner is never served from the cache | tightens | item 4 | current |
| 36 | `PWD=` and `OLDPWD=` are exempt from redaction only for a directory | tightens | item 18 (b) | amended by item 43 |
| 37 | A word dressed as a call is a secret again | tightens | item 18 (c) | current |
| 38 | The scan no longer misses a token at the seam of a long text | tightens | item 16 | current |
| 39 | The question's size cap and row width (72 display columns) | tightens | item 19 | current |
| 40 | `nsenter -S` and `-G` followed by a separate word are read both ways | tightens | item 33 | the second reading made in one pass by item 42, as one extra part per part by item 45 |
| 41 | A process substitution used as a redirect target is the target; scanner state does not cross a part | tightens | none (older than item 40) | current |
| 42 | Many ambiguous `nsenter` options, `env -S` past its bound, and a bound on the copies scanned (never on the text the command holds) | tightens | items 34 and 40 | the bound amended by item 45 (it lowered blocks in both versions); the rest stands |
| 43 | `PWD` and `OLDPWD` are exempt only as a shell assignment of a path-shaped value; never after a `;` and never before a `;name=` | tightens | item 36 | continuation and spaces amended by item 45; the context before the name and the blanks before the `;` by item 46 |
| 44 | Tests the review found missing; timing ceilings that hold under load | neutral | none | current |
| 45 | The readings the parser adds have budgets of their own and a budget used up refuses the call; `env -S` strings split as GNU env splits them; the `PWD` continuation | tightens (lowers only the classes it names, which item 46 corrects) | items 34, 40, 42 and 43 | the classes it lists as lowered are corrected by item 46; a `${NAME}` in a string amended by item 46; class (iii) removed and the `env -S` refusal counts restated by item 47 |
| 46 | A `${NAME}` in an `env -S` string is read three ways and reviewed; `PWD` and `OLDPWD` are exempt only where a shell reads an assignment word, and blanks may stand before a connection string's `;` | tightens | items 43 and 45 | class (iii), "why these suffice", "the third reading" and the counts of the cost amended by item 47; the blank before `PWD` by item 47 |
| 47 | `origin/main`'s reading of a part with an `env -S` string is always also made; env's own words (`--` then `-`, any word with a `=`, `${NAME}=v`, the words after a string) are read as env reads them; the context before `PWD` is a space, a tab or a line feed | tightens | items 34, 42, 45 and 46 | current |

1. **Confirming a rules file confirms only what was listed in full in this session** (a tightening;
   brief of the second review round). What was wrong:
   - the listing showed ten items per kind and "and N more", and `trust <code>` confirmed all of them;
   - each shown value was redacted and cut to 300 characters, so the file's author chose what was
     blanked or pushed off the line;
   - a held-back rule's `check`, `member`, `profile` and `reason` were not shown;
   - `trust <code>` worked with no listing, and the code (a prefix of the content hash) can be worked
     out by anyone who can read the file, the gated model included, which could then ask the person to
     type it;
   - an unconfirmed file's `block` or `ask` rule reason reached Claude in the refusal in the gate's own
     voice.

   Decided, in order:
   - **The listing is complete, or the file cannot be confirmed by code.** `/council trust` lists every
     held-back setting, no cap per kind. *(Amended by item 28: it lists every setting of the file, in two
     groups, not only the held-back ones.)* The summary (`TrustSummary`) now holds each item whole (a
     rule, a check and a pattern as the schema validated them), and `trustListing` (`elrond/commands.ts`)
     prints one line per field by iterating the schema's own key lists (`RULE_KEYS`,
     `GIMLI_COMMAND_KEYS`, `GOLLUM_PATTERN_KEYS`, now exported), so a field added to the schema is listed
     without anyone remembering it; `trust.test.ts` fails when a key list and its fixture differ. A list
     (`tools`, `argv`) has a line per element, in JSON string form (`argv[1]: "run test"`), so where one
     argument ends is not in doubt. Every line is after the gutter. Decided beyond the brief: `reason`,
     a pattern's `kind` and a check's `timeoutMs` are listed too (they are fields); the allowlist stays a
     count and counts towards the 40; a model and a disabled rule show their one value.
   - **What the listing shows of a value** (`inspectValue`, `config/trust.ts`): the value cleaned, whole,
     neither cut nor redacted. Cleaning replaces C0, DEL, C1 (U+0085 too), U+2028 and U+2029 with a
     space and removes bidi and zero-width characters: U+200B to U+200F, U+202A to U+202E, U+2066 to
     U+2069, U+FEFF (the brief's set), and, decided as a tightening, U+061C, U+2060 to U+2064 *(item 28
     removes more: soft hyphen, fillers, invisible operators, variation selectors, tag characters and
     every Unicode space but the plain one)*. The file's
     folder, which is the person's own path and not a setting, is cleaned, redacted and cut to 300
     as before.
   - **Limits that make a file unconfirmable in the session** instead of hiding anything: more than 40
     held-back items in total (`MAX_ITEMS`; the first 40 are printed; *item 28: the 40 count the items
     of both groups*); a value longer than 400
     characters after cleaning (`MAX_VALUE_CHARS`; the first 400 are printed, marked with the length);
     a value that `redact()` with the shipped patterns, or with the patterns now in force, would change
     (shown as "[not shown: looks like a secret]"); a value that held a character the cleaning removed
     or replaced (marked on its line). Each is counted per value and named in the closing line, "This
     file cannot be confirmed from the session because …; shorten or fix the file, or set
     `trustProjectRules` to `always` if you control which repositories this host opens", which takes the
     place of the code. More than 20 files waiting: the 21st on is not listed and says so. A false
     positive of the redaction test (a long mixed-case token in a regex source) costs a confirmation
     from the session, not safety.
   - **A code works only for a listing shown in this session.** The session record (version 6, migrated
     from 4 and 5 with both fields empty, so rounds, lockouts and chat records survive) gains
     `trustListed`, the content hashes the listing printed in full (newest last, at most 20; never a
     file that cannot be confirmed), noted through `noteListed` before the listing is shown. `trust
     <code>` confirms a file only if its current hash is in the list and the file is confirmable now;
     otherwise it confirms nothing. Decided beyond the brief: a confirmation removes the hash
     (`withoutListed`), so each listing authorises one confirmation. Neither field is reset by a prompt.
   - **The code cannot be worked out from the file.** It is the first 8 hex characters of SHA-256 over
     a 128-bit nonce and the content hash (`codeOf`, async, `config/trust.ts`, which takes the nonce as
     an argument and stays pure). `register.ts` makes the nonce on first use from `newNonce()` (the
     source of the reviewers' data-tag nonces, `crypto.getRandomValues`) called twice, keeps it in
     `trustNonce` in the session record (`withTrustNonce` keeps the first), and it appears in no output,
     log, audit line, file or relayed text (a test searches every recorded output of a trust flow for
     it). The stored trust record is unchanged: a path and the content hash. A typed code is exactly 8
     hex characters; the old 8-to-64 form is gone. Two files with the same content share a code and are
     confirmed together; two with different content and the same code (about 2^-32) confirm nothing.
   - **The names a file gives are short and plain** (`config/schema.ts`). A rule id, a secret pattern's
     id and a check's name are at most 64 characters of `[A-Za-z0-9._-]`, checked on the name as
     written (the check's name was trimmed before; a padded one is now invalid). The existing rules
     (required, unique, not a shipped id, not a big-operation check name) stay. A file that breaks it is
     invalid, like any other error (the file is then partly applied, §16 item 21). The ids the mod writes itself (`suggest.ts`) are
     within it. The rule id is the one project string that reaches Claude in the nobody-to-ask refusal,
     so it can no longer carry text there.
   - **A project rule's reason is introduced as the project's** (`refusal.ts`). In the refusal and in
     the audit line, the reason of a rule whose source is `project`, trusted or not, goes through
     `projectReasonText`: redacted, control, invisible and direction-changing characters gone, on one
     line, capped at 200 characters (`label`), after the new string `refusal.reasonProject` ("The
     project's rules file says (its text, not the council's): …"), never after "Reason:". `Refusal`
     gains `isProjectReason`; `refusalText` is still the one builder. A shipped rule's reason, and every
     other refusal, is byte for byte as before. Where Claude can read a reason today it is the block
     rule's; an ask rule's reaches the audit line and the dialog (which already marked it), and Claude
     is told only the rule's id where nobody can be asked.
   - **The mounted pane** draws every line it is given as a column of `Text`; its scroll is the engine's
     (`Pane`'s `scroll.bodyRows`, moved by the person's keys), so a listing of 40 items, a few hundred
     lines at most, is reachable by scrolling and the cap in B needs no lowering. `terminal.test.ts`
     draws a 40-item listing and finds its last item and the code; the paint is
     `docs/TERMINAL-CHECK.md` C10.

   Not covered. The dialog's own one-line cleaner (`escalation.ts`) strips controls but not bidi or
   zero-width characters; the project's reason there is shown after the gutter on one line, as before.
   *(Done by item 19: `oneLine` uses `cleanText`, which item 28 widened, so invisible and
   direction-changing characters are gone from the dialog too.)*
   `/council rules` and `/council test` print a project rule's reason as before (relayed to Claude only in
   a redacted data block where nothing draws). A person who confirms without reading is out of
   reach of any listing; the limits only make what cannot be read in full unconfirmable.

   Tests: `trust.test.ts` (the listing of 11 rules and of every field, the schema-key guard, 40 and 41
   items, a value of 400 and of 401 characters, a value redaction changes, each hidden character, files
   past the twentieth, the code against the nonce, no code before a listing, after an edit and after a
   confirmation, two sessions, the nonce in no output, the id caps, the reason of a block rule and an ask
   rule trusted and not, shipped reasons unchanged), `terminal.test.ts` (the pane), `state.test.ts`
   (version 6, the migration of 4 and 5, the helpers). Changed to the stricter behaviour, each for its
   reason: the old "and N more" tests (the listing is complete); the redaction-in-the-listing tests (a
   secret is not shown and the file is unconfirmable); the 8-hex-prefix-of-the-hash code tests (the code
   is derived and needs a listing); the hostile fixtures that put text in a rule id, a pattern id or a
   check name (those names are now capped, so the hostile text moved to fields the schema leaves free);
   the state tests that pinned version 5. Mutations, each confirmed to fail the suite and reverted:
   restoring ten per kind with "and N more" still confirmable (5 tests); accepting a code with no
   listing (3); deriving the code from the hash alone (4); redacting in the listing and still allowing
   confirmation (3); printing the project's reason with no introduction in the refusal (3), in the audit
   line (4) and by emptying the string (5); also printing the nonce (1), not counting hidden characters
   (3), long values (4), dropping either id cap (1 each) and the 40 limit (2).

   *Amended by item 28: the listing now covers every setting of the file, in two groups, and what the mod's own write records is narrowed; the code and the nonce are unchanged.*
2. **An approval is bound to where the call runs** (a tightening; a review of the decision path). The
   verdict cache key and the chat approval key were the tool, the input and a scope tag that exists
   only under a multi-repository root. The session's working directory follows a `cd` between Bash
   calls (§14.5's probe; the types: `$.session.cwd()` is "the directory the session runs in"), so an
   approved `rm -rf build` in one folder was reused in another, and so was a chat `once` or `session`
   allowance. Decided:
   - **The scope string is the tag plus the folder.** `placeScopeOf(scopeTag, cwd)` (`audit.ts`) is the
     tag, a NUL and the working directory the hook read for this call (`$.session.cwd()`, read inside
     the hook: the types say a timer that outlives its hook reads the session's, and a subagent has
     its own), or just the folder when the tag is empty. `register.ts` passes it to `fingerprintOf`
     for the cache key and to `callKeyOf` for chat approvals (the offer, the use of an allowance and
     the code). The code a person types is derived from the key, so it differs per folder.
   - **Unchanged.** The audit line's `fingerprint` is the plain one, in its old format. `fingerprintOf`
     and `callKeyOf` keep their signatures and behave as before for the scope they are given. The
     stored shape is unchanged, so nothing is migrated: a key written before is simply never matched
     (the cache lasts one prompt; a held chat allowance of an older key no longer applies, which is
     the stricter side).
   - **The root scope's keys are no longer byte-identical to the old ones** (§14.5's "Keys" bullet): the
     folder is always in them. The same call in the same folder is still served from the cache (one
     model request).
   Tests: `approvals.test.ts` (another folder is reviewed again; the same folder is still cached; the
   key is `placeScopeOf(tag, cwd)`; the audit fingerprint is the plain one), `chat.test.ts` (a once and
   a session allowance given in one folder do not run the call in another, which gets a code of its
   own; the allowance still holds for the first), `scopes.test.ts` (the keys under a multi-repository
   root). Changed to the stricter behaviour: the chat and scope tests that computed a key with no
   folder now give it one (`placeScopeOf('', ROOT)`), because the key they pin now holds it.
   Mutations: dropping the folder from the cache key fails 4 tests (the two folder tests in `approvals.test.ts`, the read-afresh cache test, and the key test in `scopes.test.ts`); dropping it from the chat key fails 4 (the code test in `chat.test.ts`, its once and session folder tests, and the two-codes test in `scopes.test.ts`).
3. **The full council's approve is never cached** (a tightening). A big operation convenes the council
   and runs the project's checks, and a cached approve skipped both for the identical call later in the
   prompt. `holdCouncil`'s approve path no longer writes the cache, so a repeated big operation sits
   again and runs the checks again. The single reviewer's approve is cached as before *(amended by items
   4, 7, 10 and 35: not for a call with a git part, a script or a project's runner, more than eight gated
   parts, or an ask rule after the review)*. Tests:
   `approvals.test.ts` ("the same big operation again convenes the council again, and runs the checks
   again", with a check and `npx prisma migrate deploy`, which has no git part; "a second identical push in
   one prompt …", asserting model requests and spawns); `council.test.ts` and `debate.test.ts` changed
   to the stricter behaviour (an identical push now sits again: six requests, and its approve earns its
   own epic drop; the "cached approve gets none" half of the debate test had nothing left to pin).
   Mutations: caching the council's approve fails "the same big operation again convenes the council again, and runs the checks again".
4. **A call with a git part is never served from the cache, and its approve is not cached** (a
   tightening). The checked-out branch, the index and the history are not in the key, so the same words
   can mean another thing the next time (`git reset --hard` after a commit). `hasGitPart`
   (`elrond/operations.ts`) splits the command (`splitShell`, pure; no git process) and is true when any
   part, gated or not (`git status && rm -rf build`, `sudo git push`, `(cd x && git checkout main)`), has
   `git` as its program. Decided beyond the brief: the brief said to use the parts already split, which
   are only the gated parts of the classification, so a git part that is not gated would have been
   missed; the parse is repeated instead, as `targetsOf` already does. A command too long or too complex
   to split is read as text (`\bgit\b`), the careful side. `register.ts` computes `isCacheable` once; it
   guards the cache test and the single reviewer's cache write (the council writes none, item 3).
   *(Amended by item 35: `isCacheable` is also false for a call that runs a script or a project's runner,
   for more than eight gated parts and for an ask rule after the review.)*
   Tests: `approvals.test.ts` ("an approved git reset --hard is reviewed again on repeat, and its approve is not
   written to the cache", "even a cache that holds its key does not serve it" (seeded through a read),
   "a git part that is not itself gated counts too", and "an identical ordinary review call in the same
   folder is served from the cache: one request"), `operations.test.ts` (`hasGitPart`).
   Mutations: serving a git-part call from the cache fails "even a cache that holds its key does not serve it"; caching a git-part call's approve fails "an approved git reset --hard is reviewed again on repeat, and its approve is not written to the cache". (The two guards are tested apart, because with the write guard alone nothing would ever be there to serve.)
   *Amended by item 35: a call that runs a script, or a project's runner or `make`, is not cached either.*
5. **The cache test and the out-of-rounds check read the session afresh** (a tightening; amends §13.4 f).
   Both used the snapshot taken at the hook's start, so a call in flight beside this one could not see
   the other's approve or spent rounds. Each now reads just before it decides (`cacheState`,
   `roundsState`), always, so the reads keep a fixed order: 1 the snapshot, 2 the lockout, 3 the cache
   test, 4 the rounds check, 5 the token budget's. Where the engine serialises state, two calls see
   each other's result; if it holds one moment per dispatch (the types' wording, not verified live) the
   re-read is harmless. The snapshot still serves bypass, shadow, the latest prompt, the written paths,
   the model switches and the epoch. Tests pinned by number moved with it, the assertion unchanged:
   `robustness.test.ts` "tokens spent by reviews that finished after the first read …" and "and the full
   council" (the budget's read 3 became 5); new in `approvals.test.ts`: an approve that landed after the
   snapshot is served (read 3), rounds spent after it send the call to the person (read 4). Mutations:
   using the snapshot for the rounds check fails "rounds spent after the snapshot send the call to the person"; using it for the cache test fails "an approve that landed after the snapshot is served from the cache".
6. **A cut script or SQL file is not approved by a model alone** (a tightening; widens §15 item 11).
   `isCommandCut` looked only at the call's own command. A script the call runs (`scripts[]` of the
   general reviewer, cut at 120 lines or 8,000 characters), or a `.sql` file or inline SQL it executes
   (the database reviewer's `sql[]`, 150 lines or 8,000 characters), that was cut is also code that
   will run and that no reviewer saw in full. `isRunCut` (renamed; `members/brief.ts`) is true for a
   shell tool when the command, any script or any SQL piece is over its reviewer's limit (the same
   `cut` test the prompt applies, so the two never disagree); such a call follows the cut-command path:
   the person, or a refusal where nobody can be asked, never cached, and the audit reason is
   `escalate.commandCut`, whose text now reads "The command, or a script or SQL file it runs, was too
   long to review in full, so a reviewer's approval of it does not count." (the old phrase "too long to
   review in full" is still in it). Decided: an inline SQL piece (`-c`, a heredoc) counts, as the brief
   says, even when the call text that holds it was shown whole; a script that is missing or unreadable
   is not "cut" (it is the existing "could not be shown" note). A file tool's own content and a diff
   are unchanged: a write is not a run. Tests: `omission.test.ts` (`isRunCut` at the limits, one cut script
   among whole ones, SQL by lines and by characters, a file tool is not a run; through the pipeline: a
   cut script goes to the person, is refused where nobody can be asked with the reason, is not
   remembered, a script under the limit runs and is remembered, a revise stands, a cut `.sql` file, the
   full council). Mutations: ignoring a cut script fails 4 tests (the `isRunCut` script test and three pipeline tests); ignoring a cut SQL piece fails 2 (the `isRunCut` SQL test and the cut `.sql` file pipeline test).
7. **The retry brake with many parts, and its counters** (a tightening; amends §15 item 20).
   - **More than eight gated parts go to the person.** Only the first `MAX_PART_KEYS` gated parts get
     keys, so a locked-out or spent part placed ninth was neither locked nor out of rounds. `Operation`
     gains `hasTooManyParts` (present only when true, so the shape of every other operation is what it
     was); `operationOf` still returns the first eight's keys, for counting a failed attempt. In
     `register.ts`, at the out-of-rounds check, such a call (not in shadow, as that check is) goes to
     `askUser('escalate.tooManyParts')`: the person, or a refusal where nobody can be asked (`nobodyToAsk`,
     a failed attempt), never a model request and never cached (the cache test excludes it too). The
     audit reason says why. It comes before the full council's routing, so a big operation of this size
     is not convened either.
   - **The verb counters are bounded.** `verbWipes` had no cap. At `MAX_VERB_KEYS` (200) distinct verb
     keys a new verb counts on `OTHER_VERBS_KEY` (`shell:(other verbs)`); the lockout check also reads
     it for a part's verb that has no entry of its own. It locks at the verb cap like any verb. Nothing
     stored is evicted, so at most 201 entries. Decided: each new verb of a call counts once on the
     shared key (a call of three new verbs adds three), the stricter side of one count per call; the
     joined verb key is not given the shared key's count. A verb that has an entry is judged by it alone.
   - **A force or delete push keeps its own count.** Its `partKeys` also hold its part key plus
     `FORCE_SUFFIX` (` !force`), counted and checked like any part key (rounds, failed attempts, lockout,
     out of rounds). `isForcePush` reads the part with the shared parser (`rules/push.ts`, import only): a
     force flag, a delete, a `+refspec` or an empty source (`:branch`), as the force-push check reads
     them. A successful call clears its whole key only, as item 20 says, so a plain push of the same
     target does not clear the variant. The whole key, the verb keys and the audit `opKey` are unchanged,
     and so is every key `operations.test.ts` pins. The variant is in the first eight parts only, like
     the keys it follows.
   Tests: `operations.test.ts` (nine gated parts and eight; 250 verbs leave 200 entries and the shared
   key, nothing evicted, the shared key locks at five, a verb with an entry is not locked by it, a call of
   several new verbs; the variant for each force and delete form, in a compound, behind `-C` and a
   wrapper; a plain success does not clear it, for rounds and for failed attempts; `hasGitPart`),
   `approvals.test.ts` (a locked force push is refused among the first eight, and as the ninth goes to
   the person with no model request; nobody to ask refuses with the reason and the audit line says it;
   allowed once it runs and is never cached; eight parts are still reviewed; two revised force pushes, a
   plain push, then a third force push goes to the person with no model request). Mutations: not marking a nine-part compound fails 4 tests (three in `approvals.test.ts` and the marker test in `operations.test.ts`); evicting the oldest verb entry instead of using the shared key fails 4 (all of the verb-counter tests); clearing the force variant when a plain push succeeds fails 2 (the rounds-and-failed-attempts test and the three-pushes pipeline test).
8. **A push preview that may be stale says so** (a tightening). When a push part follows any other part
   of its call (`git commit -am x && git push`, `git checkout main && git push`), the preview and the
   range diff are read before the earlier parts run. The preview is kept and a `note` step (the existing
   mechanism; `noteLines` for the reviewers, outside every data block) says: "The commits shown were
   read before the earlier commands of this call ran, so they may not be what is pushed."
   (`stalePushNote`, `members/galadriel.ts`). `followsOtherPart` splits the command again and asks
   whether a part with the same text sits after the first position, so a lone push, and a push that
   comes first, get none; a `cd` before the push counts as another part (the brief said "any other
   part"; the preview is read in the folder the `cd` leads to, but a `cd` is still a part that ran).
   The note is a line, not a step, and counts against no cap; it joins the other push notes. Tests:
   `galadriel.test.ts` (both forms and a lone push, for the preview and the range diff; it joins the
   broad-push note; in the pipeline, every council member's prompt carries it outside any data block, and
   a lone push says nothing). Mutations: making `followsOtherPart` always false fails 3 tests (the preview and range diff test, the joined-notes test and the pipeline test).
9. **Protected paths on every word, and wrapper and runner options read in full** (a tightening;
   corrects the opening of §15; landed in "Check protected paths on every word; read wrapper options
   fully" before this record). §15 said no change of that pass lowered a tier. One did: the wrappers
   and runners it added took their option values out of the words the protected-path check reads, so a
   protected path named as such a value (`op run --env-file=.env`, `mise x -C .git`, `fakeroot -s
   .env`, `firejail --profile=.env`) passed where it used to ask. Decided:
   - **Candidates are every word as written**, plus the value side of `name=value` and `--opt=value`,
     plus values glued to an option (`-C.git`, `--dir=x`; `ShellPart.optionValues`). So `uv run
     --env-file`, `npm exec --userconfig`, `pnpm exec --dir`, `dd of=` and `NAME=path` ask too.
   - **Options are read by getopt rules**, with a table per wrapper and per runner (which options take
     a value, which are flags, which change the directory or the root, which name a script): clusters
     letter by letter (`timeout -vs KILL 5`, `env -iu NAME`), long options by unique prefix, global
     options before a runner's subcommand (`pnpm -r exec`, `npm -s exec`, `yarn workspace web exec`,
     `uv -q run`). An option the tables do not list makes the part unresolved (`shell-runner-unresolved`,
     review), and an unresolved part is also evaluated at `/`. `uv run -m` and `poetry run -v` were wrongly
     unknown and no longer cause a review. *(Three tables were found wrong by item 33; item 40 reads
     `nsenter -S` and `-G` both ways.)*
   - **A wrapper that changes the directory or the root** (`env -C`, `sudo -D`/`-R`, `chroot`, `nsenter`,
     `mise -C`, `npm --prefix`, `pnpm --dir`, `uv --directory`) is evaluated additionally at `/`, never
     instead of the folder that is followed.
   - **Parts carry a nesting level** (`ShellPart.scope`, `parentScope`), and `cd` is tracked per level: a
     `cd` inside a subshell, a group or `$(…)` moves the folder for the later commands of that level. Both
     the followed and the earlier reading are evaluated, so nothing lowers.
   - **A program word the shell builds at run time** by a glob, a bracket or a brace list, as well as by
     a variable, is reviewed (`shell-dynamic-program`). A brace list in the program position is expanded
     when it is flat and literal (at most 16 words) and read as the commands it expands to, with the review
     rule as the floor. `env -S` splices its words into env's own argv. A command substitution inside
     unquoted `$(( … ))` is classified.
   - **A known limit.** The scope selection for a multi-repository root (`targetsOf`, §14.5) does not
     follow a `cd` inside a subshell.
   The tests for this item are in `rules.test.ts`, written with the change. The README's "Known gaps in
   shell parsing" and its tier list say the same in the user's words.
10. **A rules file nobody has confirmed adds protection and never replaces a shipped decision** (a
    tightening; amends §15 item 22). A project rule decides before the shipped non-block rules
    (`classify`), and the ask tier returns before the preview, the reviewers and the full council
    (`register.ts`). So an `ask` rule of a file nobody confirmed (applied at once, as the tiers that
    cannot loosen) turned every review-tier call into a bare question: no reviewer, no preview, no
    council, a short excerpt and the file's own reason, and on a tie its reason and rule id replaced
    the shipped ones. No tier dropped, yet the person lost the review. A `review` rule could not be
    applied at once for the same reason in the other direction (it lowers a shipped `ask`). Decided:
    - **The shipped decision is computed first, as if the file had no rules, and it stands**: its
      tier, rule id, reason, findings, routing (one reviewer, the full council, the checks) and
      preview. `classifyBase` (`rules/classify.ts`) is `classify` without the file's rules, which it
      sets apart (`unconfirmed`, each with the part and folder it matched in); `applyAdditions` puts
      them on top, **on the call as a whole, not per part** (a part the shipped rules allow, in a call
      they review, must not take that review away: `curl … | sh` under a catch-all `ask` rule found
      it). `classify` is the two together, so its callers are unchanged.
    - **What a rule may add**: `block` blocks when the shipped decision is below it (a tie goes to the
      shipped rule), shown as the project's text; `ask` on a call the shipped rules let through
      makes it an ask, on a review is handed back as `Classification.alsoAsk`, on an ask or a block
      changes nothing; `review` raises an allow to a review (one reviewer, by the routing of an
      unmatched review or the rule's own member) and changes nothing else. A rule that did not decide
      the tier is in `Classification.added`.
    - **The mark.** `CompiledRule.isUnconfirmed`, set by `loadConfig(text, shipped, false)` for every
      project rule of the file (`compileConfig`'s third argument); a rule of a confirmed file or of the
      option `always` is unmarked and decides first, exactly as before. `register.ts` loads a file that
      way when its state is `untrusted`, and also when it is `nothing` (no setting waits) unless the
      option is `always`: **decided beyond the brief, because it is needed** — with `review` rules
      applied at once, a file holding only review rules has nothing waiting, and read as confirmed it
      would let a project `review` rule lower a shipped `ask`; the same holds for a file of `ask`
      rules, which nobody can confirm, so it would be the bare-question case again.
      `TIER_TRUST.review` is now `always`.
    - **After the review** (`register.ts`): an approve of the single reviewer or of the full council
      goes to the person through the path of an approve of a cut command (`escalate.commandCut`):
      `askUser`, with the project rule's cleaned reason shown as the project's text; where nobody can
      be asked the call is refused (`nobodyToAsk`), a failed attempt. The wording is the existing
      `escalate.askTier` ("A rule sends this call straight to you."); a string that says "after its
      review" would be better and is left to the maintainer. *(Done by item 20: `escalate.askProject`.)* A revise or a block stands and the person
      is not asked on top. A review that gave no verdict, or an unavailable one, goes to the person
      as before (one question). Never cached: `isCacheable` is false for such a call, and the
      approve is not written, so a repeat is reviewed and asked again. In shadow mode the verdict is
      only logged and the ask rule still enforces (`passShadowed` asks where `passInShadow` would
      pass). A person already asked about a possible secret is not asked a second time, as for an ask
      tier. The audit reason is the project's cleaned reason. A cut command's approve is asked once,
      with `escalate.commandCut` as the reason and the shipped rule's text.
    - **Several repositories**: each scope is read with `classifyBase`, the shipped decisions are
      combined (`combineClassifications`), and the additions of every scope go on the combined one
      (`applyAdditions`), so one scope's `ask` rule cannot take another scope's review away.
    - **The audit line** keeps the shipped `ruleId`. No field recorded a rule that matched without
      deciding, so `alsoRuleIds` (the ids, once each, present only when there are some) is added to
      `AuditRecord`.
    - **The listings.** `/council trust` lists what waits, so review rules are no longer in it *(item 28:
      it lists every tier again, in two groups)*; the
      status and notice lines count only allow rules there. The words of `trust.count.rules` ("allow or
      review"), `notice.rulesUntrusted` and `trust.state.untrusted` ("its block and ask rules … apply")
      were not changed in this pass and still name the old split: a follow-up for `strings.ts`. *(Done by
      item 20.)*
    - **Not changed**: a person's own "Add the rule" or allowlist answer still records the file's new
      content as trusted (§15 item 22), so for a file with nothing waiting it confirms the file's
      other rules too. *(Narrowed by item 28: the write records trust only for a file that was not there,
      whose previous content was confirmed, or that holds no setting at all.)*
    Tests: `trust.test.ts` (the tier table; the marks; an ask rule on a let-through call, on a review,
    on an ask and on a pipe whose one part the shipped rules allow; block; review, raising an allow
    and leaving `sudo ls` an ask; the confirmed ordering; for every sample call the tier is never
    lower and, where the shipped decision is a review, the routing, the preview and the council are
    the same; a file with nothing waiting; the option `always`; through `register`: a push convenes
    the council, builds the preview and asks after the approve with the project's reason as the
    project's text, is not cached, is audited with `alsoRuleIds`; the not-run check blocks and the
    person is not asked on top; a revise stands; a single review asks and "keep blocked" refuses;
    nobody to ask refuses; shadow mode asks; `ls` asks; `sudo ls` keeps the shipped reason and id;
    a block rule blocks; the confirmed file decides first; one scope's ask rule leaves another's
    review). Changed to the new behaviour, each for its reason: the tier-table and split tests (review
    no longer waits; the counts are of allow rules), the listing tests (an `EVERY_RULE` fixture is an
    allow rule, the thing that waits), the held-back test of `terraform apply` (the shipped review
    stands, the ask rule is handed back; a project check of the same file was moved out of the
    pipeline test, since an unconfirmed check blocks the council). Mutations, each confirmed to fail
    the suite and reverted: an unconfirmed ask rule replacing a shipped review (11 tests); a project
    rule deciding first whatever its file (16); skipping the ask after an approve, single reviewer (2)
    and council (3); asking on top of a revise (1); an unconfirmed review rule displacing a shipped
    ask (4); the ask rule lost where the call, not the part, is reviewed (11); an unconfirmed file read
    as confirmed at load (17); a file with nothing waiting not marked (1).
    *Amended by item 28: an unconfirmed file's rules still only add, but they are all listed and a file of rules alone can now be confirmed; `/council trust` lists every tier, and the "Not changed" bullet (the mod's own write records the file as trusted) is narrowed.*
11. **The plugin folders ask for a write, not a read** (a loosening against the commit that protected
    them, approved by the maintainer; never below `origin/main`; amends §15 item 7). `**/.claude/plugins/**`
    was a protected path, so every shell mention of it asked, plain reads (`cat ~/.claude/plugins/x/README.md`,
    `ls ~/.claude/plugins/`, `grep -r foo ~/.claude/plugins/marketplaces`) and the run of a plugin skill's
    own script included; on `origin/main` those were allow or review. Decided:
    - **A second shipped list, internal**: `WRITE_PROTECTED_PATHS` in `config/defaults.ts`, compiled into
      `CompiledConfig.writeProtectedPaths`. It is not a field of the rules file, nor of `Config`, so a
      project can neither add to it nor empty it; `**/.claude/plugins/**` moved to it from
      `protectedPaths`.
    - **File tools**: `Write`, `Edit` and `NotebookEdit`, which all write, ask as for a protected path
      (rule `protected-path`, `isProtected` set, so no allow rule is offered); `Read` is not looked at,
      as before.
    - **Shell**: a part that names such a path asks unless `isReadOrRun` (`rules/classify.ts`) finds it
      a read or a run. A read: the program is one of the fixed list (README "Tiers"), bare (no `/`),
      resolved (no unread wrapper option), with none of its own writing options, and the path is one
      of its operands. A run: the path is the program word written as a path, or the script an
      interpreter or shell is given (the ordinary `script-file` or `script-shell` rule matched, and
      neither `script-inline` nor `script-stdin` did). Then the ordinary rules decide (review for a
      script, as on `origin/main`). Every other part naming the path asks.
    - **Decided as tightenings**, beyond the brief's list: `find -okdir`; `sort -o`, `--output` and `-T`;
      `tree -o`; `less -o` and `-O`; `file -C`; `uniq` with a second operand (its output file) are
      writing, so a part using them asks; a word that also appears as a redirect target, in a wrapper's
      words or in an assignment is never an operand (`cat p > p`, `time -o p cat p`, `X=p cat p`); a bare
      program word that the shell resolves against a `cd` into the folder (`cd ~/.claude/plugins/x &&
      make`) is exempt only for a reader or an interpreter running a script, so `make` asks; a script
      operand with whitespace or a shell metacharacter is not a script.
    - **A note.** `rm -rf` of a plugin folder is still a block (`rm-recursive-outside-repo`, a floor), and
      `bash -c 'cp x ~/.claude/plugins/a'` asks twice over (the outer part holds the path in a word that is
      not a script, the nested part is a `cp`).
    - **Sweeps** of about 10,000 commands from the earlier sweeps and 84,000 generated ones that name a
      plugin path (every reader and writer, wrappers, `cd`, redirects, runners): none is below `origin/main`
      except `watch -d ls <path>` (six forms), which the previous commit's parse of `watch -d` made an allow
      for any path (`origin/main` read the `ls` as `-d`'s value and reviewed the path as a program), and
      the only commands below the previous commit are reads and runs under a plugin folder.
    - **Not done**: `/council rules` lists `protectedPaths`; the plugin folders are no longer in that line
      and have none of their own (it needs a string). *(Done by item 20: `/council rules` has a line,
      "Protected against writes". Which reads and runs pass was amended by items 29 to 31.)*
    Tests: `rules.test.ts` (the reads and runs of the brief, with their rule ids; a list of asks; every
    file tool; a protected path proper unchanged; the list is not a schema field and not emptied by a
    project), `config.test.ts`. Mutations, each confirmed to fail the suite and reverted: every shell
    mention asking (1 test); `cp` as a reader (2); a redirect target ignored (1, after a test where the
    same word is read and written); a wrapper's option value ignored (1, likewise); `sort -o` not
    writing (1); `find -delete` as a reader (1); a bare program word exempt (1); the list emptied (3).
    One guard is defensive and has no test that fails without it: an unresolved wrapper copy's program
    word is the wrapper's own name, which is never a reader.
    *Amended by items 29 to 31: a `cd` through `$HOME` or a named folder is followed, a reader's output is followed through a pipe, `yq -s` is no reader, and `[[ ]]` and `git -C <path> <read>` are readers again.*
12. **More classifier gaps closed** (a tightening; recorded here for "Close more classifier gaps:
    checks, pushes, interpreters, self-protection", which landed with its tests in `rules.test.ts` and
    without this record). What it did, verified against `rules/*.ts` and `config/defaults.ts`:
    - **Block rules read what the programs read.** Recursive `rm` is blocked when `--recursive` or
      `--no-preserve-root` is written as a unique prefix (`--rec`, `--no-pres`), for another user's home
      (`~root`) and for a defaulted home expansion (`${HOME:-/}`). A write to a disk device is blocked
      when the device is spelt with extra slashes or dots, or relative to a folder the command first
      enters.
    - **Pushes.** The force and delete flags of `git push` are read as git reads them: short clusters
      with digits or other letters, and long options by unique prefix (`--forc`, `--del`). A force push
      whose destination or remote is computed asks (`force-push-unknown-branch`). A force push of the
      current branch asks when an earlier part of the same call may have moved HEAD (a checkout, a
      switch, a reset and the like, a git subcommand the mod does not know, or code it does not read);
      a protected branch read before the call still blocks. `git send-pack` and `hub push` are read like
      `git push`; `git subtree push`, `git lfs push` and `jj git push` are reviewed.
    - **Interpreters.** Code fed through `/dev/stdin`, a descriptor path, a process substitution or
      `<&0` is reviewed (`script-stdin`); the option tables of the interpreters were completed, and an
      option the tables do not know on a fed interpreter is reviewed; more interpreters and inline-code
      flags are covered; `python -m` of a module that runs the code it is given (`code`, `asyncio`,
      `timeit`, `pdb`, `runpy`, `idlelib`, `IPython`, `ptpython`, `bpython`) is reviewed.
    - **Command lines handed to other programs** are classified as `sh -c` is: tmux (`send-keys`,
      `run-shell`, `if-shell`, `respawn-window` and the other commands that start one, `display-popup`,
      `pipe-pane`, `set-hook`, `confirm-before`, `bind-key`, lists joined with `\;`, a command by any
      unique prefix), screen, zellij, `nix develop|shell|run`, `git submodule foreach`, `git bisect
      run`, `git rebase --exec`, the filters of `git filter-branch`, `find -exec`, `-execdir`, `-ok` and
      `-okdir`, `entr` and `parallel`. A key sequence or a command file that cannot be read is
      reviewed (`command-unreadable`).
    - **More forms are reviewed**: `curl` data options attached or clustered and methods other than
      GET, `wget` bodies, HTTPie bodies, `gh` writes, more `git rm`, `git checkout` of paths,
      `git switch --discard-changes` and `git branch -df`, `awk` and `sed` that run commands or write
      files, more cloud deletes, and `tar` or `unzip` extracting outside the project
      (`extract-outside-project`).
    - **Self-protection.** `plugin-manage` sees global options before `plugin`, options between its
      words, the CLI's short aliases and `npx …@<version>`; the new ask rule `claude-session` covers a
      nested session (`-p`, `--bare`, `--settings`, `--plugin-dir`, a permission bypass or mode,
      `CLAUDE_*` assignments) and `claude mcp add|remove`, `claude config set`.
    - **One shipped pattern that was slow on long input is now linear.**
    Decisions recorded: `--no-preserve-root` counts from `--n` (rm has no other long option starting
    so, and `--r` likewise counts as `--recursive`); "HEAD may have moved" (`mayMoveHead`) is any git
    subcommand that switches or rewrites the checked-out branch, `git stash pop|apply|branch`,
    `git branch -m|-M|-f|-F`, a git subcommand the mod does not list as leaving the branch alone (it may
    be an alias), an unresolved wrapper, a program word known only at run time, an interpreter or shell,
    and a program run by its path; an option the tables do not know on a fed interpreter means code may
    run, so it is reviewed; `nix run` is read by the app name only (`nix run nixpkgs#curl -- x` is
    `curl x`); `tar` and `unzip` are reviewed only when extracting; a tmux binding (`bind-key`) only
    registers its command, so the command it would run is read but a file it would load is not a
    finding; an ambiguous tmux prefix (tmux refuses it) is reviewed if any command it could be runs
    something.
    *Amended by items 32 to 34: typing into another terminal asks, three option tables are corrected, and `env -S` splicing is bounded; `tmux send-keys 'ls' Enter` is no longer allowed.*
13. **The allow rule offered after "allow once" is narrower, and the question says what it allows** (a
    tightening; amends §10 item 7). Verified against `elrond/suggest.ts`:
    - A shell rule allows that exact command text, in any folder, without review. A file tool's rule pins
      the tool and the path, so it allows every later write to that file by that tool, whatever it
      writes. A rule for any other tool allows that tool with exactly the same arguments: its input is
      pinned as the escaped JSON text, no offer over 300 characters, and the call is classified again
      with the rule in place before it is offered.
    - No rule is offered for a shell command with an unquoted `*`, `?`, `[`, `{` or `~` (any one counts,
      paired or not; a quoted or escaped one is still offered), nor for a big operation (a rule would
      skip the full council; with no current branch known, every merge counts as big).
    - `council allow <code> session` is unavailable in the same cases, because a session allowance has
      the offer's limits (`canSession` is whether a rule would be offered).
    - The question and the rule's `reason` come from the kind of call (`suggest.question.*`,
      `suggest.reason.*`). Tests are in `suggest.test.ts`.
14. **A project's own patterns are applied wherever the mod redacts** (a tightening). A rules file's
    `gollum.patterns` (once the file is confirmed; they wait for trust until then) were applied to
    what reviewers read and to the debate pane, but five other places redacted with the shipped
    patterns only. Each now takes the call's patterns, defaulting to the shipped ones, and
    `register.ts` passes them at every call: the operation key (`operationOf`, `partOperation`,
    every `redact(` in `operations.ts`), the audit line (`auditLine` redacts the reason and now the
    `opKey` too, which a file tool's path could hold a token in), the refusal Claude reads
    (`refusalText`, `projectReasonText`: a reviewer's reason, alternative and instruction, a project
    rule's reason), and the dialog's second pass (`questionText`: the call, the preview, a reviewer's
    line, a project rule's reason, a secret's snippet). With no project pattern every pinned key and
    line is byte-identical. The redaction of a file-tool operation key (`file:<path>`) is left to the
    audit line and the refusal; the key in session state is never shown.
15. **The scan reads what a call carries, whatever the tool** (a tightening). `scannedText` read a
    shell command, a Write's content, an Edit's new text, a notebook cell and an MCP call's input.
    Now: a shell call's `description` and its command; a file tool's path and what it writes; every
    other tool, whatever its name (a fetch's URL, an agent's prompt, a search pattern, a read's
    path), its whole input as canonical JSON (`canonical`, `audit.ts`, keys sorted). An Edit's old
    text is still not read. The cost is the scan's own: `scanText` caps what it reads at 500,000
    characters from the start and 100,000 from the end whatever the tool *(item 38 moves the seams: a text
    up to 600,000 characters is read whole)*, and every allowed call is
    now scanned, but the input of most is a few hundred characters.
16. **A text too long to scan in full is not passed silently** (a tightening). `GollumScan.partial`
    was set when the middle of a text over 600,000 characters went unread *(item 38: a text up to 600,000
    is read whole, and a longer one is read 512 characters past each seam)*, and nothing used it. Now,
    on a gated call, it puts the call to the person after the high-confidence check, like a low
    finding (`escalate.secretPartial`, or `escalate.secretLowPartial` when a low finding is also
    there): the person's answer is not remembered, no allow rule is offered for the call
    (`hadSecret`), and where nobody can be asked it is refused (`nobodyToAsk`, a failed attempt). On
    an allowed call it refuses, as a high-confidence finding does, with one audit line (tier
    `allow`, member `gollum`, verdict `block`, the reason `escalate.secretPartial`; no rounds, no
    failed attempt, no state write), and Claude is told to make the call shorter
    (`alternative.shorterCall`). **Decided: shadow mode and bypass do what they do for a
    finding.** The scan enforces in shadow mode (§6.10), so a partial scan is asked about or refused
    there too; under bypass a gated call passes (the scan is part of the gated path) and an allowed
    call is still refused (§13.2). A reading of "shadow passes it" would make the scan weaker in
    shadow than it is for a finding, so the safer option was taken. The README says exactly this
    for bypass in both places it used to say the scan passes.
    *Amended by item 38: the head and the tail of a text over 600,000 characters reach 512 characters into the skipped middle, and a text up to 600,000 is scanned whole.*
17. **`/council rules` shows no character of an allowlisted secret** (a tightening; amends §13.5 c).
    The person's copy showed the first three characters of an exact-string allowlist entry
    (`zq9…`), which are characters of a secret and reach the terminal's scrollback and anything that
    records it. Both copies now show `(an exact string, not shown)` (`cmd.allowlistHidden`); a
    `sha256:` fingerprint is still shown. `rulesOutput` lost its `forModel` flag, since the two
    copies no longer differ. **Decided: no length class** (short, medium, long) is shown with it: the
    length of a password narrows a guess, and a count of entries is what the listing needs.
18. **Redaction noise this release added is undone, and no further** (a loosening against §15
    item 16 as first made, approved by the maintainer; goes nowhere below `origin/main`, except the
    lines listed below). The 4-character minimum and the narrowed placeholder test blanked ordinary
    code (`{ token: token }`, `this.token = token`, `passwd: files systemd`, `// TODO token: move
    to env`, a commit message "fix password: reset flow", `PWD=/tmp`, `z.string().min(8)`) and raised
    questions about it. Decided (`redact.ts`, one `isNoise` test on the assignment pattern, read by
    `redact` and `scanText`, and a wider `isWholeReference`):
    - **(a) The minimum depends on the value.** 4 characters only when the value holds a digit or
      any character outside letters, `_` and `.`; a plain word of those needs 6, as on `origin/main`.
    - **(b) Paths, substitutions and the shell's own variables.** A name that is exactly `PWD` or
      `OLDPWD` (capitals; `pwd` stays a keyword in any other name) is not a secret keyword *(amended by
      item 36: only when its value is a directory; any other value after `PWD` is redacted)*. An
      absolute or home-relative path, a backtick substitution or the cut start of a subscript
      (`ENV[` of `ENV["TOKEN"]`) is no secret **only when it is under 6 characters** (`/tmp`,
      `~/x`, `` `pwd` ``): the shortest value `origin/main` read, so a longer path (`pwd=/work/x`)
      is redacted exactly as it was there. Exempting every path would have gone below
      `origin/main` for a password that happens to start with `/`; one constant (`SHORT_VALUE`) is
      the whole difference. A whole `$(...)` was already a reference.
    - **(c) Code expressions are whole references** *(narrowed by item 37: a word dressed as a call is a
      secret again)*. A call expression `name(.name)*(...)`, with
      `await` or `new` in front and any chain of `.name`, `.name(...)` and `[...]` after it, is one
      when its arguments hold no quoted string and no run of 8 or more letters, digits, `_` and `-`
      holding both a letter and a digit (`z.string().min(8)`, `crypto.randomBytes(32)`, `uuid4()`,
      `response.json()["token"]`, `await getToken(user)`). A value the bare pattern cut at a space, a
      comma or a quote is an open call (`getToken(user`, `Column(String(128)`, `response.json()[`):
      one only when its names hold no digit and its rest holds only names (digits and commas only
      inside a nested parenthesis). A subscript chain (`tokens[0]`) is exempt from the scan as
      redaction already left it readable. `${1:-default}` is a variable. A bare number under 6
      digits (`"token": 1234`) is no secret; a quoted one is a string and stays one. A call with a
      trailing character (`Sup3r(Secret)9`), a literal argument (`Secret(abcd1234)`) or a digit in
      the name of an open call (`Sup3r(Secret9`) is not one.
    - **(d) Kept.** `$ecret123!`, `Sup3r(Secret)9`, `<realkey12345>`, `(hunter2xyz)`,
      `PASSWORD=abc12`, quoted passphrases with spaces, `curl -u user:pass1234`, `--password=VALUE`
      and the header forms are still redacted and flagged.
    - **Below `origin/main`, by this item's own rules (four lines of the 231 compared; *item 36 narrows
      the first*):** `PWD=` or
      `OLDPWD=` followed by a path of 6 characters or more (b: the name), and the scan's flag, not
      the redaction, of `token = tokens[0]` and `const token = data.items[0]` (c: `origin/main`
      flagged any subscript, and redaction already left it readable). Everything else that
      `origin/main` redacted or flagged still is.
    - **Noise left, not decided here:** a Terraform-style `${var.token}` (a dotted name inside
      braces; `origin/main` left it readable), and a value cut at its first space such as
      `PASSWORD=$(vault read ...)`. Both are as noisy as in the first version of §15 item 16.
    *Amended by items 36 and 37: `PWD`/`OLDPWD` are exempt only for a directory, and a word dressed as a call is a secret again.*
19. **The dialog: invisible characters, wrapped rows and the size cap** (a tightening; amends §15
    item 14). (a) `oneLine` and the excerpt's per-line cleaning stripped control characters only;
    both now use `cleanText` (`config/trust.ts`, already imported by `refusal.ts` and `commands.ts`,
    so the layering is unchanged), which also removes direction marks and overrides, isolates,
    zero-width and joining characters and the byte order mark. A run of control characters is one
    space each, not one for the run. (b) A call line of a few hundred characters was one long line
    whose wrapped rows had no gutter. The excerpt budget (12 lines, 600 characters; 15 and 900
    for the preview) is applied first, then every gutter-prefixed line is hard-wrapped so that a row,
    gutter included, is at most 100 characters *(item 39: 72 display columns)*, each continuation row with the gutter too. A project
    rule's reason wraps the same way. (c) The total cap was a slice of the whole question, which
    cut the closing lines and the last reviewers. Now, over 2,500 characters *(item 39 changed the order
    of the cuts)*: lines go from the
    end of the call excerpt first (its first line always stays), then from the end of the
    preview's, each said by one marker line (joined to the one already there); then each reviewer's
    reason and failure, then each secret's snippet, is cut to its share of what is left in
    proportion to its length, ending in `ask.reasonCut`. The title, why it came, the rule line, every
    reviewer's verdict line and the closing line are never cut.
    *Amended by item 39: rows wrap at 72 display columns, and the order of what is cut over the size cap changed.*
20. **Wording** (no change in what is decided). `trust.count.rules` counts allow rules only, since a
    review rule of an unconfirmed file applies at once (item 10); `notice.rulesUntrusted` and
    `trust.state.untrusted` say that the file's block, ask and review rules apply and only add to
    the shipped decision; the question after a review approved because an unconfirmed project rule
    asks has its own text (`escalate.askProject`, "The project's rules file asks you about this call
    too, after its review.") instead of `escalate.askTier`; `/council rules` lists the paths protected
    against writes (`cmd.list.writeProtected`, "Protected against writes") apart from the protected
    paths. *(Extended by item 28: `notice.rulesUnconfirmed`, `trust.state.unconfirmed` and
    `relay.rulesUnconfirmed` say the same for a file of rules alone.)*

21. **A rules file with errors keeps what can only tighten** (a tightening). Before, a file with any
    validation error was ignored whole: its own block and ask rules and protected paths vanished with
    one transcript line and a toast, and where nothing draws nobody was told. Now, in
    `loadConfig` (`config/schema.ts`):
    - **Readable but invalid** (a JSON object with `schemaVersion` 1, one or more errors).
      `inspectOverrides` validates every entry on its own and leaves an invalid one out (a rule with a
      bad tier, a duplicate or shipped id, a regex that does not compile or is too long; a bad
      production pattern; a bad big-operation entry). What is left is split by the same table as a
      file nobody confirmed (`splitByTrust`: `FIELD_TRUST`, `TIER_TRUST`) and only its `always` part is
      used: `protectedPaths`, `protectedBranches`, valid `productionPatterns` and `bigOperations`, and
      valid `block`, `ask` and `review` rules. Those rules are marked unconfirmed whatever the file's
      trust and the `trustProjectRules` option, so they only add to the shipped decision (item 10): a
      broken file is never read as confirmed and never weaker than no file. Allow rules, `disableRules`,
      `models`, `gollum.patterns`, `gollum.allowlist` and `gimli.commands` are ignored, as are all
      invalid entries. The errors stay in `errors`, and the config origin reads `shipped+project
      (partly applied)`. Nothing of it waits for confirmation (`needsTrust` is not set): there is
      nothing to confirm from a file with errors, so `/council trust` does not list it.
    - **Not readable** (not JSON, not an object, another `schemaVersion`, or a file that could not be
      read): the shipped defaults, as before.
    - **The person is told, both ways.** The transcript line and the toast are as before, with
      their own words for "partly applied". Where nothing draws, one row goes through the relay
      (`relay.ts`, `brokenNotice`, as `untrustedNotice` does) with the number of errors and nothing from
      the file, once per file content (the key is the file's real path and its hash; reading the rules
      again does not repeat it). `/council status` and `/council rules` show the state ("partly
      applied: N error(s)", "ignored: not readable") as counts, and `/council rules` lists the errors
      as before.
    - **The checks are held back.** A broken file that names project checks (`gimli.commands`, valid or
      not: the raw count) has them counted as checks that could not be started
      (`LoadedConfig.broken.checks`, `brokenChecksOf`, `ignoredChecksOf`): a big operation's council
      blocks with "not run: the project rules file has errors", the same path an unconfirmed file's
      checks take. A file that cannot be read at all names no checks the mod can count, so none are
      counted for it (the shipped defaults carry none).
    - **Decided where the brief left a choice (the safer one).** A list over its cap (item 22) is read
      up to the cap, so the first 200 rules still apply and the rest are dropped with the error; a
      rule's cross-checks (a duplicate id, a shipped id, a big-operation check's name) drop the later
      rule and keep the first.
22. **Validation caps** (a tightening; denial of service only). A regex source in a rules file (a rule's
    `command`, `path` and `input`, a `/regex/` in `tools` or `bigOperations`, a production pattern, a
    secret pattern's `regex`) is at most 1,000 characters; a file holds at most 200 rules and 200
    secret patterns. Over a cap is a validation error like any other, so by item 21 the rest of the
    file's tightening entries still apply. The cap is checked before the regex is compiled.
23. **`/council reload` needs a person** (a tightening; amends §13.4 a). `reload` reads the rules file
    again, so a file changed since the session began, and, where the option trusts files, every setting
    in it, takes effect. It is in `needsPerson` with `trust`, so from `sdk`, `peer`, `plugin`,
    `scheduled-trigger` and `task-notification` it is refused with `cmd.needsPerson`; `composer` and
    `bridge` run it (`HUMAN_ORIGINS`, §14.3).
24. **A command that ran and failed is not read as a permission denial** (a tightening; amends §6
    item 14, approved decision 12). `outcomeOf` matched the automatic-denial wordings anywhere in a
    failed call's text, so a shell command that ran and failed with such a wording in its own output
    was recorded as `denied-by-permission`, which is not a failed attempt, and escaped the retry
    count. A denial is the engine's whole message, so its words open the text, while a command's own
    output follows an exit-code line or its earlier output. The wording is now anchored at the start
    of the text (whitespace allowed) where the recorded wording is documented as opening it: the
    deny-rule wording "Permission to use|edit|read … has been denied" (§6.14, §12.4).
    **Left open, as a class.** The other automatic-denial wordings, which the engine words with a
    subject before the phrase (the approval and connector wordings recorded in §12.5, §12.7 and §14.2),
    are still read from their phrase alone, anywhere in the text, so no start can be named for them.
    A failed command whose own output resembles one of them may still be recorded as a denial and so
    escape the retry count. Narrowing them needs a decision on how much of the text may come before the
    phrase and a probe of how each wording opens; both are open: ROADMAP brief M1.9 and open decision
    OD2. The user-refusal patterns are untouched (narrowing them would count fewer attempts in one
    configuration). §12.7 records deny-rule wordings from 2.1.322 that do not say how they open; they
    are matched by the anchored deny-rule pattern, so a wording of that family that does not open with
    "Permission to" would read as an error (counted) until it is recorded.
25. **The audit log says when it fails** (neutral). Two things were silent: the folder's `.gitignore`
    was marked as looked at before it was written, so a failed write was never tried again, and a
    failed append went only to the debug log. Now the folder is marked after the `.gitignore` exists
    or was written, so the next line tries again; the first failed audit write of the session shows
    one transcript line and a toast (`notice.auditFailedFirst`, `warnOnce`); every failure is counted,
    and `/council status` shows the count since the session began ("Audit lines that could not be
    written this session: N"). The count is module state beside `gitignoreChecked` and `warned`
    (it starts over with the module, as they do), not a field of the `$.state` session record, so the
    record's shape and version are unchanged. Writes stay unawaited (§13.4 d); a failed `.gitignore`
    write still costs that line.
26. **The names a call supplies sit inside the fence** (a tightening). The reviewers' prompts printed the
    tool name and the file, script and SQL labels in the prompt's own voice, outside the nonce-fenced
    blocks. `label()` cleaned and capped them, but a one-line path can still carry instruction-like text.
    Now one block of kind `call-names` (`callNames` in `members/shared.ts`, built with `fenced`) holds
    them, one `Tool:`, `File:`, `Changes:`, `Script n:` or `SQL n:` line each, cleaned to one line and
    capped at 200 characters, and redacted with the call's patterns where `briefOf` builds the context.
    The prompt's own lines refer to a name by its role and number only ("Script 1 it runs, written in
    this session (named in the call-names block)"). `untrustedRules`, which every reviewer's system
    prompt carries, gains one sentence saying that the names in that block are data. Shipped rule
    reasons and the mod's own notes stay outside, as they were. Not call-supplied, and so left as they
    are: the protected branches line (the project's configuration) and the production hits.
27. **Strings, dead code, documents** (no change in what is decided). `reason.allowlistNotWritten`,
    text Claude reads, says "The user chose…" and not "You chose…"; the comment by the report strings
    says the relay sends the report where nothing draws; four unused definitions were removed
    (`reason.failure`, `WHO_OF_SLOT`, `longestTimeout`, `stricter`); the developer guide's layout list
    names every module and test file.
28. **Confirming a rules file covers everything it switches on; the mod's own write records trust only for what the person confirmed** (a tightening; **corrects defects of the previous round**, §16 items 1 and 10). Item 10 let the `review`, `ask` and `block` rules of an unconfirmed file apply at once, and so dropped them from `/council trust`, whose listing item 1 had made complete. But once a file is confirmed, every one of its rules decides before the shipped non-block rules (`classify`), so a `review` rule that was never listed could lower a shipped `ask` to a review or move a call from its shipped reviewer: confirming switched on what the person had not been shown. Item 10 also left a file of rules alone (nothing waits) in a state between: read as unconfirmed, yet with nothing to list and no code. And the mod's own "Add the rule" and allowlist writes recorded the file's new content as trusted for any file that was not waiting, so they could confirm an unlisted rule. Decided:
    - **What is confirmable.** `loadConfig` sets `needsTrust` when a setting waits **or** the file holds a rule of any tier (`isConfirmable`; `TrustCounts` gained `appliedRules` and `appliedLists`, and `total` is everything listed). A file of lists alone has nothing to confirm (state `nothing`), as before. A file of review, ask or block rules is now `untrusted` until confirmed, through the same path: the notice (`notice.rulesUnconfirmed`, `relay.rulesUnconfirmed`), the status line (`trust.state.unconfirmed`) and `/council trust` say that its rules apply now and only add and that confirming lets them decide first; with settings that wait too, the old wording gained "Once you confirm the file, all of its rules decide before the shipped ones."
    - **The listing has two groups** (`trust.group.applied`, `trust.group.held`): "Applies now and only adds to the shipped rules" (every rule that is not an allow rule, then protected paths, protected branches, production patterns and big operations, each entry a line after the gutter) and "Switched on by confirming" (allow rules, disabled rules, models, checks, patterns, the allowlist count). `TrustSummary` gained `applied`. Every rule of every tier is listed whole, with every field, rules numbered through both groups. After the first group's rules, when it holds a rule, one sentence (`trust.decideFirst`): after you confirm, these rules decide before the shipped ones, so a review rule here can replace a shipped question. A heading is printed only for a group that has something in it; the sentence only when a rule is in the first group (lists decide nothing).
    - **The limits cover both groups.** 40 items in all (`counts.total`: rules of every tier, list entries, allowlist entries), 400 characters a value, no value `redact()` would change, no cleaned character, and "cannot be confirmed from the session" apply to the whole listing; the first 40 items across the groups are printed.
    - **A rule that matches everything says so.** Under a rule with no `command`, `path`, `input` **or `check`** (decided: a check is a matcher, so a rule with only a check would be described wrongly by "every call of the tools it names"), one line from the mod, not the file's text (`trust.matchesAll`); a rule whose `tools` hold an entry that matches 15 plain tool names (`*`, `/.*/`, `/./`) says `trust.allTools`. Both apply to every tier.
    - **More characters are hidden** (`cleanText`): U+00AD, U+034F, U+115F, U+1160, U+3164, U+2800, U+206A to U+206F, variation selectors U+FE00 to U+FE0F and U+E0100 to U+E01EF, tag characters U+E0000 to U+E007F, and every Unicode space but U+0020 (U+00A0, U+1680, U+2000 to U+200A, U+202F, U+205F, U+3000) are removed and make a value, and so a file, unconfirmable. The dialog's `oneLine` and the refusal's cleaning use the same function, so those characters are gone there too (a no-break space no longer joins two words: it is removed, not replaced).
    - **The mod's own write** (`writeOverrides`, `recordTrust`) records the new content as trusted only if the file was not there, or its previous content was confirmed, or it holds no setting at all (`hasSettings`, `RulesFile.holdsSettings`). Any other file (waiting, rules alone, lists alone) is not offered a rule or an allowlist entry (`writableDir` uses `isHeldBack`, now also true for state `nothing` with settings), and a write that reaches `writeOverrides` for one anyway (the file changed while the person answered) is refused (`trust.writeRefused`, reworded: "has not been confirmed"), so nothing is written or recorded. With `trustProjectRules=always` nothing is recorded, and a file of lists is not held.
    - **Decided beyond the brief:** a check is a matcher for the note; headings and the sentence as above; a refused write for a file that is `nothing` with settings, not only `untrusted` (the brief said it stays unconfirmed and is not offered; refusing is the same outcome and covers the race); `holdsSettings` is unset under `always`.
    Tests: `trust.test.ts` (the split's counts and `summary.applied`; each tier confirmable and lists alone not; the listing's groups, order, sentence, numbering; one allow rule and one review rule matching `sudo`; forty and forty-one across both groups, a list entry that looks like a secret or is long; review rules alone listed and confirmable; the matches-everything and every-tool lines; each newly hidden character; the notice, status and relay for a file of rules alone and for one with a check; a review rule lowering `sudo ls` once confirmed; writes: no setting, lists only, each tier alone, a confirmed file keeps trust through a rule and an allowlist entry, a file edited while the person answers), `terminal.test.ts` (the pane's first line). Changed to the decided behaviour: the split tests (counts, `needsTrust` of a file with rules), the listing tests (first line, "settings to list", the first group listed, the old "not listed" assertions), "a file with nothing that waits is writable" (now: no setting at all is writable; lists alone or rules alone are not), `done.test.ts` "its questions never reach the gate" (runs with the option `always`, since its file's block rule is now unconfirmed and no rule is offered for it). Mutations, each confirmed to fail the suite and reverted: listing only the held-back group (7 tests); dropping the deciding-first sentence (4); recording trust after a write to an unconfirmed file, by removing the refusal (1, the file edited while the person answers); `isHeldBack` ignoring a file with settings that nobody can confirm (1).
29. **A `cd` through `$HOME`, or into a folder the text names, is followed** (a tightening; **corrects a defect of the previous round**, §16 item 11). `cd $HOME/.claude/plugins/x && cp /tmp/e hooks/register.ts` was `allow`: `cdTargetOf` read any target holding `$` as unknown (`/`), so the later parts were never judged inside the folder, though `cd ~/.claude/plugins/x` asked. Decided:
    - **`$HOME`, `${HOME}` and `~` in a `cd` or `pushd` target are expanded** with the context's home before the target is resolved.
    - **A target that still holds an expansion** (`$X/.claude/plugins/y`, `$D/.git`, a substitution, backticks) is split at its expansions; a literal run that touches a protected or write-protected path (`touchesProtected` over both lists) is where the folder is taken to be, rooted at `/`, so what later parts name is judged inside it. Otherwise it is `/`, as before.
    - **Only ever an addition.** `cwdTracker` takes the matchers and follows both readings, the old one (an unknown target is `/`, a `$HOME` target too) and the new one, and a part is judged in the union of the folders (the strictest wins), so `cd $HOME/project && npm test` and `cd $DIR && npm test` are unchanged by construction, and a call is never judged more leniently than before. `cwdAfter` (scope selection under a multi-repository root) and `forcePushPlaces` keep the old reading.
    Tests: `rules.test.ts` (the `$HOME`, `${HOME}`, quoted and `pushd` forms with `cp`, `touch`, `npm install`, `git pull`; subshells; targets with expansions that name a place; the unchanged calls; a context whose home is itself inside a protected place, which only the expansion sees). Mutations: leaving `$HOME` unexpanded (1); dropping the literal-text place (1).
30. **A reader's output is followed through a pipe, and `yq -s` is not a reader** (a tightening). `ls ~/.claude/plugins | xargs rm -rf` and `find ~/.claude/plugins -type f | xargs sed -i …` were allowed or only reviewed as a script: the reader names the folder and reads it, and the program it feeds names nothing. A shell part that is a read of a write-protected path (`readOrRun` now says `read` or `run`; a run is a script the path names) asks when the parts that follow it through consecutive pipes include one that is not a reader (`pipesIntoNonReader`, the same `READERS` and writing options as the read test). `sed`, `awk`, `tr` and `xargs` are not readers, so `cat ~/.claude/plugins/x/a | sed …` asks; that friction is the brief's. `yq -s` and `--split-exp` write one file per result: `WRITING_OPTIONS.yq` matches them (clusters holding `s`, and `--sp…`). Tests: `rules.test.ts` (the two pipe forms, a chain through `sort`, `| sh`, `| tee`, `git -C … | xargs`; readers piped into readers; the `yq` forms). Mutations: letting a reader piped to `xargs` pass (1); `yq -s` a reader (1).
31. **`[[ ]]` and `git -C <path> <read>` are readers again** (**restores reads**; a loosening against the previous round, never below `origin/main`, as item 11). The previous round made both ask for a plugin path: `[[` was not in `READERS`, and `git -C` was not read at all (the words before the command made `isReadOrRun` give up). `[[` joins `READERS`. `git -C <path>` followed by `status`, `log`, `diff`, `show`, `rev-parse`, `ls-files`, `branch` (no argument, or only `--show-current`, `-a`, `-r`, `-v`), `remote` (none, or `-v`), `describe`, `blame` or `cat-file` is a read (`isGitRead`). Decided as tightenings inside it: a `-C` is required (a bare `git status` after a `cd` is judged as any program is; found by the sweep, where it lowered below the previous round and was outside the brief); no global option other than `-C <path>`, `--no-pager` and `--no-optional-locks` (`-c` can run a program); `branch` and `remote` only with the listed options; no long option that is a unique prefix (three characters at least) of `--output`, `--ext-diff`, `--textconv`, `--filters`, `--open-files-in-pager`, `--exec`, and no `-O…`; no redirect that names the path; a wrapper before `git` is not read. Sweeps, against `origin/main` and the previous round (about 4,200 commands built for this brief, and the earlier lists of 3,000, 5,000, 10,000, 84,000 and 437,000): none below `origin/main` except the commands the earlier rounds already lowered (`watch -d ls <path>`, the runner and wrapper parses of §16 items 9 and 12) and the ones item 33 changes by reading an option right *(item 40 takes back the `nsenter -S` and `-G` part)*; below the previous round, only `[[` and `git -C <read>` of a plugin path, alone or piped on into readers, and the item 33 commands. Tests: `rules.test.ts` (every read allowed; every write, program and other subcommand still asking).
32. **Typing into another terminal asks** (a tightening; the one test it changes: `tmux send-keys 'ls' Enter` was pinned as `allow`, and is now `ask`). A new shipped ask rule `terminal-input` (`config/defaults.ts`, check `terminal-input`, `ShellPart.isTerminalInput`, set where `inlineOf` reads the command, through wrappers and `sh -c` as any rule): `tmux` `send-keys`/`send` (every form, `-X` and `-H` too), `paste-buffer`, `pipe-pane -I`, `command-prompt`, any unique command-name prefix, and `load-buffer` or `set-buffer` in a tmux command line that also pastes or sends (in a separate part, the paste part asks by itself); `screen -X stuff|paste|readbuf|process`; `zellij action write|write-chars`; `kitty @`/`kitten @` `send-text|send-key`; `wezterm cli send-text`; `xdotool type|key|keydown`; `ydotool type|key`; `wtype`; `osascript` with `keystroke` or `key code`. The inner command of a send is classified as before, so a block still blocks; an ambiguous tmux prefix keeps its review. The tmux forms that run a command line nobody can read are reviewed through `command-unreadable`: `set`/`set-option`/`set-window-option` of `default-command`, `default-shell`, `lock-command` (also by a unique prefix of four characters or more, `status` itself excepted), `status-left` and `status-right`, or of any option whose value holds `#(`; `-f <file>` on the tmux command line; `detach-client -E` (its command is also classified); `display-message` with `#(`; `choose-*` with a command template (which is also read as the tmux command it is); `lock-server` and `lock-session` in a line that sets `lock-command`. **Decided where the brief left a choice (the safer one):** `status-left` and `status-right` are reviewed whatever their value (the brief's wording could be read as "when the value holds `#(`"); `command-prompt`'s template is read as a tmux command; `tmux -C` (control mode, commands on standard input) is **not** covered and is named in the README's known gaps. Unchanged: `tmux new -d 'npm run dev'`, `ls`, `capture-pane -p`, `kill-session -t x`, `attach`, `set -g mouse on`. Tests (`rules.test.ts`): every form, through wrappers and `bash -c`, the blocks kept, the near misses, the reviewed forms; the tests that pinned `send-keys` and `screen -X stuff` as allow, `zellij action write` and `send-keys -H` as review, changed to ask. Mutation: the rule set to `allow` (6 tests).
33. **Option arities found wrong** (a tightening in intent: each hid a command from the rules; **a consequence below `origin/main` for commands the old reading misread**). `systemd-run --expand-environment` takes a value (`=v` or a separate word); `nsenter -S`/`--setuid` and `-G`/`--setgid` take only a glued or `=` value (`optional` in the table, so a following word is the command; *amended by item 40: whether a separate word is their value depends on the installed util-linux, so both readings are classified and the part is reviewed*); `nsenter -W`/`--wdns` takes a value; `pnpm -c`/`--shell-mode`, as a global option or after `exec` or `dlx` (also in a cluster of pnpm's flag letters), makes the words that follow one shell string, classified as `sh -c` is. Acceptance: `systemd-run --user --expand-environment no rm -rf /home/me` and `nsenter -t 1 -a -S rm -rf /home/me` and `nsenter -t 1 -W /x rm -rf /home/me` block; `pnpm exec -c 'cat .env'` and `pnpm -c exec 'echo x > .git/hooks/pre-commit'` ask. **Stated plainly, because the sweep shows it:** reading these options right also lowers commands that were read wrongly in the other direction: `nsenter -S x rm -rf /` was a block (`x` read as the option's value) and is now an allow, since it runs a program named `x` with arguments, which is what nsenter does *(wrong for some util-linux versions: item 40 makes it a block again, with the part reviewed)*; `nsenter -t 1 -W /x ls` was a review (`/x` read as the program) and is now `ls`; `systemd-run --expand-environment rm -rf /` reads `rm` as the value. Tests: `rules.test.ts`. Mutations: reverting each (1 test each for the `systemd-run` and the `nsenter` table (the same test) and for the `pnpm` shell string).
34. **A stall on crafted input** (a tightening). `env ` + `-Senv ` × 3,000 + `ls` (18,006 characters) took about 38 seconds to classify: every `env -S` splice copies the words after it, and every splice made a nested script of them, each classified again. Decided: more than eight `-S` splices in one command (`MAX_ENV_SPLICES`, counted per command, nested scripts count anew) are not spliced; each such string is classified alone as a nested script, so a block in it still blocks, and the part is marked unresolved (`shell-runner-unresolved`, review). *(Amended by item 42: classified alone dropped the words that follow the string, so a string holding only the program was read as that program with no arguments; past the bound the strings are now read together with the words that follow them, as one script. Amended again by item 45: past the bound the strings are read two ways, as env splits them and as a shell reads them, and each string is also read alone as `origin/main` read it, all as extra readings with budgets of their own.)* The words of an unresolved copy are made only the first time (`markUnresolved` takes a function), which also removes a second quadratic (`sudo ` + `--pr ` × 4,000 took 270 ms and is 25 ms). The same input classifies in about 130 ms. **Re-timed at 20,000 characters** (about 60 shapes of the earlier rounds plus the new ones: tmux lists and `set`, `cd` chains, pipe chains of readers, `git -C` runs): the worst is the 3,000-splice input at about 130 ms, every other shape under 100 ms; a chain of `pnpm -c exec` took 20 s until its shell string was read once and not stripped of wrappers again. `rules.test.ts` gains a timing test (ceiling 3 s, because the suite runs beside other work; the failure it exists for is 38 s). Mutation: removing the bound (3 tests, two of them the timing tests, which then take two minutes and more).
35. **A call that runs a script or a project's runner is never served from the cache** (a tightening; amends item 4). The cache key is the call's text and folder, so an approved `bash deploy.sh`, edited, was served again unreviewed in the same prompt. `isCacheable` (`elrond/operations.ts`, pure, beside `hasGitPart`) is false for: a git part (item 4), more than eight gated parts, an ask rule after the review (item 10), any call whose classification says a part matched a shipped `script-*` rule (`Classification.isScript`, set from every matching rule, not only the deciding one: `./deploy.sh > out.log` is decided by the redirect rule, which ties and wins on order), a part whose program or wrapper is a project runner or `make`-style program (`PROJECT_RUNNERS`: `make`, `just`, `npm`, `yarn`, `pnpm`, `bun`, `cargo`, `go`, `gradle`, `mvn`, `npx`, `uv`, `poetry`, `mise`, `bundle`, `deno` and the like), gated or not, and a command too long or too complex to split. The brief's "simplest correct form" (every gated part decided outside the script family) misses the tie and the ungated runner (`make deploy && curl -X POST …`), so both are covered. Tests: `operations.test.ts` (the helper), `approvals.test.ts` (nine calls reviewed again on repeat, nothing written to the cache, a held key not served, an ordinary call still cached once); `omission.test.ts` "a script within the limit … is remembered" changed to "is not remembered". Mutations: caching a script-running call (9 tests); caching a runner call (5 tests).
36. **`PWD=` and `OLDPWD=` are exempt from redaction only for a directory** (a tightening; amends item 18 b; **corrects a defect of the previous round**, below `origin/main`). Any value after those names was exempt, but `PWD` is also the password keyword of ODBC-style connection strings (`Server=x;PWD=hunter2xyz`). Now the exemption needs a value that starts with `/`, `~` or `$`, is `.` or `..` or starts with `./` or `../`, or is a whole backtick substitution, and holds no `;`. Residual, as a class: a bare value that starts with `/` and ends at a `;` stays exempt (the pattern cuts a bare value at `;`). Tests in `secrets.test.ts`, written with the change. *(Amended by item 43: the exemption was wider than this item decided, since a value that only starts with one of those characters was exempt; it now needs a shell assignment and a value shaped like a path, and never applies after a `;` earlier on the line or before a directly following `;name=`, which narrows the residual named here but does not end it: a bare value that starts with `/` and ends at a `;`, with the name first on the line, stays exempt unless a `;name=` follows it directly, so `PWD=/x;` at the end of a text, or a `;` and a space, is still left readable. Residual, as a class.)*
37. **A word dressed as a call is a secret again** (a tightening; amends item 18 c). A value written like a call whose callee starts with a capital letter, is not a known type name and has a digit in its name or a digit-led first argument (`Winter(2024)`, `Passw0rd()`, `Monkey(1)`) is a literal; lower-case calls, known type names (`String(128)`, `Numeric(10)`, `Uint8Array(32)`, `VARCHAR(64)`) and constructors with a name argument (`Token(options)`, `Config()`) stay code. Tests in `secrets.test.ts`.
38. **The scan no longer misses a token at the seam of a long text** (a tightening; amends item 16). A token straddling the 500,000-character mark was cut in two by the head and the tail joined with a line break, and missed while the scan reported it had read everything. A text up to 600,000 characters is scanned whole; a longer one is read from its start, 512 characters past the 500,000 mark, and from its end, 512 characters before the last 100,000, so a token at either seam is whole. The middle past that is still unread and still sends the call to the person. Tests in `gollum.test.ts`.
39. **The question's size cap and row width** (a tightening for what the person sees; amends item 19). Rows wrap at 72 display columns, gutter included (it was 100 characters): a wide character counts 2, a combining mark 0, and a character that does not fit goes to the next row. Over 2,500 characters the order of cuts changed: each reviewer's reason is cut first (at most 240 characters, from a shared budget of 1,200), then the preview to its first and last line, then the middle of the call, whose first 4 and last 4 lines always stay (the old order cut the end of the call first and could take its last lines), and only then what is still over comes out of the reasons and each secret's snippet. A line says what was cut each time. The title, why it came, the rule line, every verdict line and the closing line are never cut. `galadriel.test.ts` "more than three refspecs" now asserts a fragment that fits one row. Tests in `terminal.test.ts`, written with the change.
40. **`nsenter -S` and `-G` followed by a separate word are read both ways** (a tightening; amends item 33; the last pass of the hardening). Item 33 read `-S`/`--setuid` and `-G`/`--setgid` as taking only a glued or `=` value, so `nsenter -S x rm -rf /home/me` read `x` as the program and the call fell from a block (on `origin/main`, where `x` was the option's value) to an allow. Whether a separate word is the option's value depends on the installed util-linux version, so neither reading is safe. Decided: when `-S` or `-G` (or `--setuid`, `--setgid`, by any unique prefix) is followed by a separate word that does not start with `-` and has no glued or `=` value, `coreOf` (`rules/shell.ts`, `NSENTER_AMBIGUOUS`) (a) marks the part unresolved, so `shell-runner-unresolved` (review) fires and the part is also evaluated from `/`, and (b) classifies both readings: the word as the program (the part as it stands) and the word as the option's value, the words after it being run as nsenter's command (a nested script made of `nsenter` and those words, which is read like any other, with the nesting depth bound of every nested script). The strictest tier wins. With an attached value (`-S0`), an `=` value (`--setuid=0`), no word after the option or an option after it (`-S -a`), there is nothing to read two ways and the part is read as before. Acceptance: `nsenter -S x rm -rf /home/me` and `nsenter -t 1 -a -S 0 rm -rf /home/me` block (`rm-recursive-outside-repo`); `nsenter -t 1 -S 0 ls` is a review (`shell-runner-unresolved`), never an allow; `nsenter --setuid=0 -t 1 ls` is an allow, as the unambiguous wrapped `ls`. Tests: `rules.test.ts` ("nsenter -S and -G followed by a separate word: both readings are classified, and the part is reviewed"). Mutations, each confirmed to fail the suite and reverted: classifying only the as-written reading (the nested script left out) fails that test (1); leaving out the unresolved mark fails it (1). The reading where the word is the value only is item 33's earlier reading of `-S rm -rf`, still covered by the same table of cases. Sweeps of about 550,000 commands from the earlier lists and 1,729 `nsenter` forms built for this item (every `-S`, `-G`, `--setuid` and `--setgid` form before a list of dangerous and ordinary commands): nothing is below `origin/main` that DESIGN does not already record (the `watch -d` and plugin-folder reads, and the commands whose option an earlier item reads right: `sudo`, runner and `nsenter -W`/`--wdns`/`--target` prefixes, item 33); nothing with `nsenter -S`, `-G`, `--setuid` or `--setgid` is below `origin/main`, and the commands that item 33 had lowered are back at or above it. *(Amended by item 42: the second reading made one nested script for each such option, so five of them in one command reached the nesting bound and the call fell from a block to a review; both readings are now made in one pass, whatever the number of options. Amended by item 45: that pass was a nested script per link of a chain of `nsenter` options and used up the room of the text; the second reading is now one extra part for the whole part, read as the whole chain taking its values.)*
41. **A process substitution used as a redirect target is the target, and no scanner state crosses a part** (a tightening; **a defect older than the previous passes**). When a redirect operator (`<`, `>`, `>>` and the like) was followed by `<(...)` or `>(...)`, the scanner pushed the substitution as an ordinary word and left the redirect waiting for a target; the end of a part did not clear it, so the first word of the next part, across `;`, `&&`, `||`, `|` and a newline, became that target and the part was read without its program word. A command the block rules exist for was read as arguments and allowed. Decided:
    - **(a) The substitution is the redirect's target.** It is taken as a word (`<(...)`), so the redirect is recorded with that target and nothing waits any more; the command inside it is still a part of its own, as before. So a command that follows a redirect onto a process substitution, after `;`, `&&`, `||`, a pipe, `&` or a newline, keeps its own tier (a block stays a block, an ask an ask). The everyday loop that reads from a substitution is unchanged (allow), and a substitution whose own command is blocked blocks.
    - **(b) A part never ends with a redirect waiting.** `endPart` always clears it. A redirect operator that has no word after it at the end of a part (a `>` or `<` straight before a separator, or at the end of the text) cuts the parse as the part bound does (`out.isCut`, `command-too-complex`, review), and is not dropped in silence. Chosen over a per-part mark because the unresolved copy of a part is reviewed through `shell-runner-unresolved`, a pattern that names wrappers, and a part with no program has none; the cut reviews every call, whatever else is in it, and what was found before it stays found (a block already seen still blocks). A shell reads such a line as a syntax error, so what it makes stricter is text that is not a command: in the sweeps, only a pasted placeholder such as `council allow <code>` or `<token>` used as a command (162 of the 16,000 cases built for this item, all of them a redirect with nothing after it; seven texts of that kind among the earlier lists, from the redaction tests, none an everyday command).
    - **(c) The audit of the scanner's state, each variable and where it is reset.** `words`, `redirects`, `input` and `heredocTags` by `endPart`; `word`, `hasWord`, `isWordQuoted` and `isWordEscaped` by `endWord`; `partStart` at a separator, a newline and a subshell; `pendingTarget` by `endWord` once a word comes, and now by `endPart`; `pendingHeredocs` is kept across parts on purpose until the next newline, and a heredoc is queued only for a part that was made (checked: no leak that hides a command; the body of a heredoc whose part was not made is scanned as commands, the stricter side); `isPipeNext` by `endPart`; `Builder` state (`parts`, `isCut`, `lastScope`) is shared by design. Two more leaks were found by reading and fixed, both tightenings. The descriptor branch (a digit before a redirect operator) cleared `word` and `hasWord` but not `isWordEscaped`, so after an escaped digit the next heredoc delimiter was read as quoted, its body was taken as plain data and a command substitution in it was never scanned; it is cleared there. And `isPipeNext` was cleared by the empty part a line ending in `|` makes at the newline, so the command on the next line was not marked as fed by the pipe, and a reader of a write-protected folder piped into a writer across a line break was a review where the same pipe on one line asks; the flag now stays across an empty part at a newline.
    Sweeps (about 550,000 commands from the earlier lists and 16,000 built for this item: every redirect form with a process substitution or with no target, every separator, 16 following commands): nothing below the previous commit; below `origin/main` only what the earlier items record. Tests: `rules.test.ts` ("what follows a redirect, a pipe or a part boundary is read on its own": seven redirect forms, six separators and four following commands; the recorded redirect; the loop; a redirect with no target and its neighbours; the escaped digit; the pipe over a newline). Mutations, each confirmed to fail the suite and reverted: the substitution pushed as a word again (2 tests; the table of following commands still passes, since the reset at the end of a part alone keeps their program and sends the call to the review); no reset at the end of a part (1); the reset without the review cut (1); both of the first two reverted (3, the table among them); the escaped-digit flag left set (1); the pipe flag cleared at a newline (1).
42. **Many `nsenter -S` options, `env -S` past its bound, and a bound on the copies scanned** (a tightening; amends items 34 and 40; **corrects defects of the last commits, among them a loosening of the first version of this item, below**; ***amended by item 45: the bound on the copies below, in both its versions, each lowered some blocks to reviews, and is replaced by budgets of the extra readings that refuse the call when they run out; the reading of `nsenter` in one pass and the strings past the bound read together stand, as item 45 reads them***). Three things.
    - **`nsenter` is read in one pass (item 40).** Item 40 made a nested script for each `-S` or `-G` followed by a separate word, so every one cost a nesting level and at five the depth bound cut the command to a review where `origin/main` blocked. The two readings differ only at the first such option followed by a word that is no option: the word is the program (reading B, which the parse goes on with, since after the program nothing is an nsenter option), or every such option takes the next word and the command comes after the last of them (reading A). Reading A is made once, from that first option (`nsenterCommandIfValues`, which skips the later ones and stops at the command or `--`), as one nested script led by `nsenter --` (so the root it moves still makes the part be judged from `/` too, as the earlier nested script was, and nothing after the `--` is read as an option); the part is still marked unresolved (review); the strictest wins. No extra depth, whatever the number of options. A first version of the pass left out the `nsenter --` lead; the sweep found commands below the previous commit (a relative delete, judged inside the repository and not from `/`); the lead is covered by a test.
    - **`env -S` past the bound (item 34).** More than eight `-S` strings in one command were each pushed alone as a nested script, so a string that held only the program was read as that program with no arguments: a split string that held only the program, after eight others, was a review where the command before the bound was a block. Past the bound the strings are now read together, in order, with the words between them and the words that follow, as one script led by `env` (so an `env` option between or after the strings, such as `-i`, is read as one and not as the program), classified once; the part stays unresolved (review). **Each string is split as env splits it** (`envStringWords`: its blanks, quotes, `\_` as a separator, `\c` as the end and a `#` at the start of a word as a comment) and each word quoted, so the shell scanner does not read it again its own way; the first version of this pass put the raw string into the script, so the escapes env reads were lost and a command written with them was a review where the spliced reading blocks it. One script for the whole call (an earlier form built one for each `env` in a chain of them, each holding all the words after it, which is quadratic and was only hidden by the bound).
    - **The copies of spliced strings are bounded, and nothing else is** (`MAX_SCANNED_CHARS`, 20 times `MAX_COMMAND_CHARS`; `MAX_COPY_PARTS`, 200). Each of the first eight `env -S` strings is read twice: by env's own splitting (its words are in the part itself) and again by the shell scanner, as a nested script made of the string and every word after it (`copyScripts`). A crafted command makes copies of copies, which cost seconds (the 20,000-character nested `env -S '` shape took 2.5 s). Only these **copies**, and what is nested inside a copy, are counted against the bound on text and have parts of their own; past either the parse is cut as at `MAX_PARTS`: review, what was found stays found. **The first version of this bound (one commit earlier) was one counter for the whole call, spent depth first, and lowered a block to a review:** an expensive part early in a call used the whole budget, so the nested scripts of a *later* part (a `-c` string, `$(...)`, `<(...)`, `eval`, a heredoc body fed to a shell) were never classified, and a block in them became a review where `origin/main` blocked. It was corrected as follows.
        - *What the cut cannot hide.* Every script the command's own text holds is scanned at least once, whatever the copies before it cost: a nested script of any top-level part, and nested text written literally in the command at any depth up to `MAX_DEPTH`: `-c` strings, command substitutions, subshells, process substitutions, `eval`, heredoc bodies fed to a shell, option values that are scripts, the strings past the eighth `env -S` read together (their first reading is not a copy), and the second reading of `nsenter`. Nothing the text holds is charged to the bound; the parts of the text and the parts of copies are counted apart, so copies cannot use up the room of the text.
        - *What the cut can hide.* Only the second reading, by the shell scanner, of the first eight `env -S` strings of a call, once the copies of the call have used 400,000 characters or 200 parts (env's own reading of each is in the part itself, so it is classified); and, as before this item, text nested deeper than `MAX_DEPTH` (4) and the parts after the 200th of the command's own text. Each of these makes the call a review at least.
    The mechanism was chosen as the simplest that meets the timings: a flag on the scan that is set for copies and inherited by everything nested in one, so a nested script is free or charged by where it came from, not by how much came before. Deduplicating copies by text was not enough (each copy differs, being the string and the words after it) and a budget for each origin needs the same flag.
    Timings at 20,000 characters (best of three, the machine otherwise idle): the 3,000-splice shape 90 to 130 ms, the nested `env -S '` shape (2,498 of them) 75 to 100 ms, 3,990 `nsenter -S 0` about 25 ms, 1,990 `-S 0 -G 0` pairs about 25 ms, 3,300 empty `-S ""` strings 65 to 85 ms, the same shapes with a script after them 55 to 130 ms; the ceiling of the brief is 300. Sweeps (R9): a new set of 4,189 commands (eight expensive-part shapes, each before, between and after, with 16 following commands in six nesting forms (plain, `bash -c`, `$(...)`, `<(...)`, `eval`, a heredoc fed to a shell), the strings past the eighth `env -S` with env's escapes, and `PWD` lines) and the earlier lists (about 550,000 commands, and the 16,000 of item 41 and 42), on `origin/main`, the commit before the bound (`9233b27^`), the commit with the first bound, and this tree. **Lower than the commit before the bound: none, in any list. Lower than `origin/main`: none in the new set**; in the earlier lists only the classes already recorded (item 33's `nsenter -W`, `--wdns` and `--target`; `watch -d`; the runner, wrapper and `sudo` option arities; `env -S` given a string that holds the program, 189 of the 16,000 and 15 of the largest list: class (iii) of item 46). **Stricter than the commit with the first bound: 599 of the new set** (a block after an expensive part, which that commit had lowered to a review, is a block again), and none in the earlier lists, which that commit had not lowered. Tests: `rules.test.ts` ("an expensive part never hides the text the command holds after or before it": three expensive shapes, each before, between and after seven forms of what the text holds and a past-bound string; the copies' own parts; what is cut), ("past the bound a string is split as env splits it"; the earlier ones for the strings past the bound, the scan bound and the timing shapes). Mutations, each confirmed to fail and reverted (the first rows are those of the first version of this item): charging every scan (4 tests); the parts of copies and of the text counted together (1, the test with two lines of strings that each make a hundred and fifty parts); the copies not charged (4); the strings past the bound charged as copies (3); the strings past the bound not split as env splits them (1); and, from the earlier version, only reading B (4); only reading A (2); no unresolved mark (2); reading A not skipping the later options (4); no `nsenter --` lead (1); the raw string pushed alone (2); no `env` lead (1); a later string dropped (2).
43. **`PWD` and `OLDPWD` are exempt from redaction only as a shell assignment of a path-shaped value, and never after a `;` or before a `;name=`** (a tightening; amends item 36; **corrects a defect of the previous round**, below `origin/main`; *the `;name=` continuation and the blanks around the `=` amended by item 45: the continuation missed a next name with a space or a bracket, a value over 200 characters and a closing quote before the `;`, and a blank around the `=` was let through; **amended by item 46:** the exemption also needed a shell's assignment context before the name (`db.PWD=`, `--PWD=`, `&PWD=`, `,PWD=`, `#PWD=` and `$PWD=` were exempt), and a connection string's `;` may follow blanks*). Item 36 exempted a value that starts with `/`, `~`, `./`, `../` or `$`, so a password that merely starts with one of them was left readable where `origin/main` redacted it. Decided, the exemption holds only when all of these are true:
    - **The form.** The name is exactly `PWD` or `OLDPWD` and it is assigned with `=` (`PWD=`, `export PWD=`, `declare -x PWD=`, `env PWD=... cmd`, a quote around the value is fine); a quote before the `=` makes it a key and a `:` is no assignment, so `"PWD": "..."`, `'PWD': '...'` and `PWD: ...` are the password keyword's; so are the names that only end in `PWD`.
    - **The value is path-shaped** (`isPathShaped`). It starts `/`, `~/`, `./`, `../` or `$`, or is `.`, `..` or `~`, or is a whole `$(...)` or backtick substitution of plain words; every other character is a letter, a digit or one of `. _ / ~ + @ % -`, and `$ { }` for an expansion; so no `; ! : & ? #`, quote or space. No segment between slashes (and no word inside a substitution) is a word of 6 or more characters that mixes letters and digits (`isLiteralSegment`: at least one letter and at least one digit, once the punctuation a path holds is dropped). **This is 6 and not the 8 of `looksLiteral`**, the stated reading: the acceptance named `PWD=./s3cr3t` and `PWD=../hunter2` as passwords, which are 6 and 7 characters. `~name` with no slash after it is not path-shaped (`PWD=~secret9` is redacted).
    - **No `;` earlier on the line.** `redact` and the scan hand a pattern's `isNoise` only the kept text and the value, not what comes before, so this is its own shipped pattern: `connection-string-pwd` (low, kind password) matches `PWD` or `OLDPWD` with a `;` up to 400 characters back on the same line (a look-behind, tried only where the name stands, so each name costs a bounded amount), and the same value forms as `assignment`; a plain word, a number or a path under 6 characters is noise there as everywhere. So `Server=x;UID=sa;PWD=/home/me/project;` is a password; `cd /work; export PWD=/work/project` is flagged, a cost the brief accepted. Residual, as a class: a `;` more than 400 characters back on the same line is not seen.
    - **A value directly followed by `;` and the next `name=`** (decided in the next review; a tightening): a `PWD` or `OLDPWD` assignment whose value (any, 4 to 200 characters, bare or in quotes) is followed directly by `;` and a name and `=` (`PWD=/x;UID=sa`) is the first item of a connection string, and is redacted and flagged though the name is first on its line: the pattern `connection-string-pwd-continued`, which has the same noise rule as the other (a plain word, a number or a path under 6 characters stays quiet). A shell command after a `;` has a space (`PWD=/tmp; CC=gcc make` is quiet), or no `=` (`PWD=/work/p;make` is quiet). Every length in it is bounded, since a start that does not match is not consumed. Residual, as a class: a connection string whose first item is a path-shaped `PWD` followed by a `;` and a space, or by the end of the text, is still readable. **Not done, and not decided here:** the brief asked that `cd /x; export PWD=/work/p; make` stay quiet. It is redacted and flagged at the previous commit and on `origin/main`, by the rule of this item that a `;` earlier on the line makes `PWD` the keyword; keeping it quiet would loosen that and drop the rule, which is the maintainer's to decide.
    What it makes stricter, beyond the connection strings: `PWD="/home/me/my project"` (a space), `{"PWD": "/work/x"}` and `PWD: /work/x`, a directory named like `app2` or `python3.11` (6 or more characters mixing letters and digits), and `PWD=/tmp/tmp.aB3dE5fG`. In the corpus of 261 lines (187 ordinary, 74 with secrets, 30 of them added for this item) nothing is left readable that `origin/main` redacted except shell assignments of a path-shaped value to `PWD` or `OLDPWD` (`PWD=/home/me/project`, `OLDPWD=/work/project`, `PWD=~/work`, `PWD=../x/y`, `declare -x PWD=...`, `env PWD=... make`) and `token = tokens[0]` and `data.items[0]`, which item 18 had already let go; nothing is left readable that the previous commit redacted; 15 lines the previous commit left readable are redacted. The pattern is added to the table of linear-time tests (its own test: `;PWD=` prefixes, and runs of `;PWD...` with the `;` far behind the name). Tests: `secrets.test.ts` ("(b)": the old test's lines kept, 22 passwords, 14 quiet shell forms, 7 with a `;`, 8 with a `;name=` after the value, 8 quiet near them, 3 quiet by line), `gollum.test.ts` (the pattern's prefix). Mutations, each confirmed to fail and reverted: the old exemption back (1 test); the quoted-key and `:` test left out (1); the segment test left out (1); no `;` pattern (1); `~name` accepted (1); any character accepted in the value (1); the `;name=` pattern not matching a bare value (1), a quoted value (1), or matching any `;` (1). The corpus gains 16 lines for the `;name=` form (277 in all, three trees): nothing is less redacted than the commit before; the 8 lines of a connection string that it left readable are redacted; and what is readable that `origin/main` redacted is still only shell assignments of a path-shaped value to `PWD` or `OLDPWD` (among them `PWD=/tmp; CC=gcc make` and `PWD=/work/p;make`, which stay quiet) and the two lines item 18 let go.
44. **Tests the review found missing, and timing ceilings that hold under load** (neutral; no behaviour changes). Each mutation the review made that no test caught now fails one: the redirect guard of `isGitRead` (a git read of a plugin folder redirected onto it), the `-O…` refusal, `--open-files-in-pager` and `--exec` in the list of writing options (each its own case, asked for as the `protected-path` ask and not only "not an allow", since a review rule catches a redirect or an inline option anyway), `key code` in the terminal-input test of `osascript`, and `holdsSettings` being unset under `trustProjectRules=always` (`trust.test.ts`, a file of lists alone is written under the option and not without it). The timing ceilings (`SLOW_MS` 3,000 ms in `rules.test.ts`, 1,000 to 2,000 ms in `secrets.test.ts` and `gollum.test.ts`) are where they were, and what they prove is stated in a comment (growth in the length of the text, which costs tens of seconds, not a speed). They now time the classify or redact call alone, not the building of the input, and repeat a run (at most three) while it is over the ceiling, so one slow run on a loaded machine does not fail them and a stall that is slow every time still does. **The maintainer should see this change:** a repeated run relaxes the assertion in one respect, since a test passes when any of its (at most three) runs is under the ceiling; a consistent regression is slow in all three and still fails, and each such test says so in its comment. The ceilings themselves, and what is timed, are as above. Mutations, each confirmed to fail and reverted: no redirect guard in `readOrRun` (1 test); no `-O…` refusal (1); `--open-files-in-pager` and `--exec` each taken out of the list (1 each); `key code` taken out of the `osascript` test (1); `holdsSettings` set under `always` (1). *(Amended after CI: one redaction input took 1,516 ms against its 1,500 ms ceiling on the CI runner. In `secrets.test.ts` and `gollum.test.ts` (where a second input took 1,009 ms against 1,000 on the next run) an input that is over the ceiling in all three runs is now measured for growth: the same text at a quarter of the length; it passes only if the full length takes under 8 times as long (linear work takes about 4, quadratic about 16) and under ten times the ceiling. The ceiling is not raised. Checked by mutation: one look-behind made unbounded fails three tests. The maintainer should see this change too.)*
45. **The readings the parser adds have budgets of their own, and a budget used up refuses the call** (a tightening; amends items 34, 40, 42 and 43; **corrects defects of the last commits, below `origin/main`**; ***amended by item 46: the sweep below said "lower than `par`: none" and named the classes lower than `origin/main`; both are corrected there, and a `${NAME}` in a split string, which this item kept as a plain word, is read three ways***). The bound of item 42 failed twice. Its first version was one counter for the whole call and spent in the order of reading: an expensive part early used the room of a later part's nested scripts, and a block there became a review. Its second version charged only the copies of spliced `env -S` strings, but kept the cut a review, let a second reading of `nsenter` (one nested script for each `nsenter` link of a chain) use up the 200 parts of the text, and read the strings past the splice bound in one way only (env's, with a split that dropped words env keeps), so a crafted `nsenter -S nsenter …` chain of 173 characters left the next command unread (review where `origin/main` blocks) and at 20,000 characters took 5 s. Each patch left a hole because each decided case by case what a cut may hide. This item decides the principle once.
    - **The principle: what this parser adds may only add readings; it may never use up a bound that `origin/main` had; and when its own bound runs out the call is blocked, not reviewed.** Two classes of scanned text. *The command's own text* is what `origin/main`'s parser read: the parts of the command, `-c` strings, `$(...)`, subshells, `<(...)`, `eval`, heredoc bodies fed to a shell, the wrapper chain, the option-value scripts of wrappers and runners. It keeps `MAX_PARTS` (200) and `MAX_DEPTH` (4) and its cut (`isCut`, `command-too-complex`, review) exactly as on `origin/main`, and is never charged to anything new. *The extra readings* are everything this parser adds beside the text: the second reading of an ambiguous `nsenter -S`/`-G` (below), the shell scanner's second reading of each spliced `env -S` string (the copy), each such string read alone as `origin/main` read it, the readings past the splice bound, the first versions' reading of a string, and every script nested inside one of those: the flag is set where the extra is made (`makePart` and `coreOf`'s `extraScripts`, `rules/shell.ts`) and inherited by `nested`, so a script in an extra is an extra at any depth. The extras have budgets of their own and share none with the text: 400,000 characters scanned (`MAX_EXTRA_CHARS`, 20 times the longest command), 400 parts (`MAX_EXTRA_PARTS`) and 4 levels (`MAX_EXTRA_DEPTH`, counted from where the extra starts, so it does not use the text's depth). Parts and depth made inside an extra never count against `MAX_PARTS` or `MAX_DEPTH`. When an extra budget runs out, the scanning of extras stops, `splitShell` reports `isExhausted`, and `classify` adds a **block** finding, `command-too-complex-to-read` ("The command repeats wrapper options or split strings more often than the parser reads; it is refused. Write the command plainly."), after the parts' own findings, so a block a part found names its own rule (`strictest` keeps the first of equals). It is a finding of the classifier written beside `command-too-long` and `command-too-complex` in `rules/classify.ts` (not a rule of `defaults.ts`, as they are not: a rule matches a part, and this is a property of the call; a project's rules cannot lower it and no allow rule is offered for a block). (`splitShell(command, extraChars)` takes the character budget as an optional second argument only so that a test can show it: no command of 20,000 characters reaches 400,000 before it reaches the depth or the parts, the widest known using about 300,000, so the budget is a backstop that the tests exercise with a smaller one.) **Why block:** only a crafted command reaches an extra budget (no everyday command repeats `env -S` nine times, chains ambiguous `nsenter` options, or holds a split string of hundreds of commands), so refusing costs nothing, and a cut can then never lower a tier: the one place this parser could have hidden a command from the rules is now a refusal. The parts of the text are cut as before (review); an extra is never cut to a review.
    - **`nsenter` is read as two readings of the whole part, not one nested script for each link** (amends items 40 and 42). A util-linux version holds for every link of a chain, so there are only two candidate command lines: every ambiguous option of every link takes the next word, or the first ambiguous word is the program. The loop in `coreOf` is the second (the part as written, the word as the program, the chain stripped link by link, reviewed as one not read for sure); the first is the same loop run again with `isReadingA` (an ambiguous option takes the next word) and made **one extra part** for the part, with the part's words, redirects and input, whatever the number of options and links (it also keeps a redirect the old `nsenter --` script dropped). Its scripts are extras. The chain of F3 (`nsenter -S nsenter` × 8, 173 characters) and the chain of 1,000 links (19,000 characters) cost one extra part and about 10 ms, and the command after it keeps its tier.
    - **`env -S` strings are split as GNU env 9.4 splits them, and read three more ways** (amends items 33, 34 and 42). The first versions' split handled a backslash before it looked at the quote state, so inside single quotes `\c`, `\_` and `\#` were read as escapes where env reads them literally, and past the splice bound env's reading was the only one, so the arguments it kept and the split dropped were not classified (F1). `envSplit` follows env 9.4 (checked with harmless `printf` calls): blanks are the six of the C locale; outside quotes `\_` separates, `\c` ends the string, `\f \n \r \t \v` are those characters (not separators), `\# \$ \" \' \\` are the character and `#` at the start of a word is a comment; inside single quotes only `\\` and `\'` are escapes; inside double quotes `\_` is a blank, `\c` is an error and `#` is plain; `${NAME}` is kept as written *(item 46: the part is reviewed and the string is read two more ways, since an unset name makes its word vanish)* and a bare `$`, an unknown escape, a trailing backslash and an unterminated quote are errors. A string with an error is read on leniently, the part is marked unresolved (review), and the other readings still classify it. The other readings, each an extra: each string **alone** as a shell script, as `origin/main` read it: `mainEnvStrings` walks the part's words as main's wrapper walk did (its table of wrappers and of the options of each that take a value, kept as it was) and finds every `env -S` and `--split-string` string it found, however many, each time it stands (`env -S x watch env -S 'rm -rf /home/me'`: for env `x` is the program and what follows are its arguments, for main the walk went on and read the second string; a string repeated 500 times ran out main's 200 parts and was reviewed, and runs out the extras' 400 here: refused); the **shell reading** (the shell scanner's copy: the raw string, then the words after it, quoted), also for the strings past the splice bound (the raw strings in place, the words between and after them, led by `env`), which finds what the string holds as operators (`x; rm -rf` and the words that follow: F5, which was a review where every earlier tree blocked); and **the first versions' reading** (`envLooseWords`, kept as it was, made only when it differs from env's: it splits on `\t \n \f \r \v` and on every blank a regular expression's `\s` holds, a no-break space included, and treats a backslash before a quote as it did). The first versions' reading is kept because a sweep found commands that only it blocked (`env -S 'rm\t-rf\t/home/me'`: env reads one word, with tabs in it, which names no program; the first versions read three words), and no tree may be lowered by a correction of what env reads. Past the eighth string the strings are read together, in order, in these ways and not spliced, so the work does not grow with their number (the bound of item 34 stands).
    - **The unresolved copy.** The copy of a part's `unresolved` words (the part reviewed as one not read for sure) is made for each part but is no longer counted in `MAX_PARTS`: it is at most one for a part, and counting it used up a bound `origin/main` had (150 parts with an unknown option, then a block, lost the block).
    - **`PWD` and `OLDPWD` (F6, amends item 43).** The continuation pattern (`connection-string-pwd-continued`, `hooks/redact.ts`) now reads a value (bare or quoted, 4 to 1,000 characters, a closing quote allowed) followed by `;`, then a character that is no blank and up to 64 more with a `=` among them before any `;` or line break. Item 43 required a next name of 32 characters of `[A-Za-z0-9_.-]` with a value of 200 at most and no quote before the `;`, so `PWD=/x;User ID=sa`, `;[UID]=sa`, a name over 32, a value over 200 and `PWD=/x";UID=sa` stayed readable where `origin/main` redacted them. The exemption of a shell assignment (`isShellDirectory`) now needs `=` straight after the name and the value straight after the `=`: `PWD = /x` is no shell assignment and is redacted. Stays readable: `PWD=/tmp; ls`, `PWD=/home/me/project; CC=gcc make`, `PWD=/work/p;make`, `export PWD=/tmp`, `PWD=$HOME/src`, `cd "$OLDPWD"`. **A cost, stated:** `PWD=/work/p;make CC=gcc` (a command word glued to the `;` with a `=` after it) is now redacted, which item 43 left readable. **Residual, as a class:** a connection string whose first item is a path-shaped `PWD` with a value over 1,000 characters, a next name of more than 64 characters, or a `;` followed by a blank, which is also a shell command (`PWD=/tmp; CC=gcc make`), is still readable. Linear: every length is bounded, and the pattern is in the table of linear-time tests with new worst cases. *(Item 46 adds blanks or tabs before the `;` to the continuation, and a pattern for the name after a character that is no assignment context; its residual list is the one that stands.)*
    **Sweep (R9)** on four trees (this tree; `bf49b65`; the commit before the first bound, `par`; `origin/main`) over **637,426 commands**: the review's targeted set (12,435), large set (39,672) and subset (18,841); its shape sets for `env -S` and `nsenter` (c1 to c6, t1, t2); the earlier lists (the tests' own commands, `main`'s corpus, 83,963 plugin-folder forms, 437,760 option-arity forms, 16,000 and 4,189 of items 41 and 42); and 413 ordinary developer commands. **Lower than `par`: none** *(wrong, corrected by item 46: two classes, (i) and (ii) there)* (the 39,672-command set was compared with `par` on a sixth of the 9,918 commands this tree does not already block, 1,653, because `par` stalls for seconds on these shapes; none of them lower, and `bf49b65` is lower than `par` on none of them). **Lower than `bf49b65`: none; `bf49b65` is lower than this tree on 26,566 of them (every one a crafted shape: the ones this tree refuses, and the ones `bf49b65` had lowered to a review).** **Lower than `origin/main`: 18,675, every one of them also lower on `bf49b65` and the commit before it, so no class is new, and each is one that the items name:** 18,480 of the option-arity forms (items 9, 12 and 33: a runner or wrapper flag that takes no value read as taking one, `npm exec --global x rm -rf /`, `pnpm`, `yarn`, `uv`, `pdm`, `poetry`, `bundle`, `conda` and the like; `unshare`, `numactl`, `strace`, `ltrace`, `ionice`, `xvfb-run`, `stdbuf`, `runuser`, `chpst`, `time`, `retry`, `flock`, `chroot`, `setpriv`, `run0`, `sudo --user` and its long options, `env -a`, `-P`, `--unset`, `--chdir`, `timeout --signal`, `nice --adjustment`, and `nsenter -W`, `--wdns` and `--target` prefixes); 189 of the 16,000 (`env -S x rm -rf /home/me` and its forms: a string that holds the program, followed by words that are its arguments, items 34 and 42, named by item 46 as class (iii); the `env -S`, `-Sx` and `--split-string=x` forms of the option-arity set are the same class); and 6 of the 83,963 (`watch -d ls <plugin folder>`, item 33). **Nothing else is lower than `origin/main`, in any set.** The readings of this item add no class: `env -S` strings that env reads one way and `origin/main` another, and chains of ambiguous `nsenter` options, are at or above `origin/main` and `bf49b65` in every set. Where this tree is stricter than `bf49b65`: the crafted shapes of the review's large and shape sets that it refuses (15,683 of the 39,672, `bf49b65` having blocked 645 of them, asked 4,710 and reviewed 10,328; 7,803 of the 18,841), which no ordinary command is. **The ordinary commands: 413 (git, npm, yarn, pnpm, docker, make, `find`, `xargs`, loops, heredocs, `env VAR=x cmd`, `env -S` in one ordinary use, `nsenter -t 1 -m ls`, `sudo`, `timeout`, `nice`): none changes tier or rule against `bf49b65`, none is refused by the new block, and none is below `origin/main`.** Redaction: 148,352 lines of `PWD` and `OLDPWD` forms (`name` × separator × value × tail × prefix) and the corpora of items 18, 36 and 43 (319 and 231 lines) on `par`, `bf49b65`, `origin/main` and this tree: **nothing is readable that `bf49b65` or `par` redacts; what is readable here and was redacted on `origin/main` is, in all of the 5,631 lines of the large corpus and the 20 of the small one, a shell assignment (no blank around the `=`) of a path-shaped value to exactly `PWD` or `OLDPWD` that no continuation follows (`PWD=/home/me/project`, `PWD=~/work`, `declare -x PWD=...`, `env PWD=... make`, `PWD=/tmp; CC=gcc make`, `PWD=/work/p;make`), and the two lines item 18 let go (`token = tokens[0]`, `data.items[0]`)**; 26 of the 319 lines that `bf49b65` left readable (connection strings, and `PWD` with a blank around its `=`) are redacted, and `PWD=/work/p;make CC=gcc` is now redacted (stated above). **Timings** (best of three, the machine idle, one `classify` call): every shape of the review's `t1`, `t2` and `c` sets, the 40 shapes of the stall tests (those of this item among them), and the 225 slowest commands of the sweeps classify in **under 300 ms** (the slowest, 237 ms; the 20,000-character chain of `nsenter -S nsenter` links, 5.4 s on `bf49b65`, is 6 ms, and a chain of 1,000 links with a command after it 6 ms; the 3,000-splice shape is 86 ms; the 2,200 brace lists `{env,-S}` 173 ms). **Tests** (`rules.test.ts`, `secrets.test.ts`, `gollum.test.ts`; the suite is 1,208 tests, 1,195 before): the tiers `origin/main` gives for eight shapes the text's own bounds cut or read (250 parts, the 200th and 201st part, `$(...)` four and five deep, `bash -c` four and five deep, 250 parts that each carry an ambiguous `nsenter` option); a chain of ambiguous `nsenter` links of 7, 8, 40 and as many as fit, with and without `--`, with `-G`, with a newline, `&&` and `;`, with `sudo` in front, each before four followers that keep their tier; the second reading as one extra part (and the redirect it keeps); 150 parts that each carry an extra part or an unresolved copy, then a block, read; the inherited flag (three commands whose string holds sixty commands, then a block; four of them refused; five levels of `bash -c` in the second reading of `nsenter` refused and four read; five on their own reviewed, as on `origin/main`); each budget (characters with a smaller budget given to `splitShell`, parts, depth) refusing, a block found naming its rule, and everything ordinary not refused; the words of an `env -S` string (a table of 15 forms, checked against env 9.4), a string with an error reviewed and still classified, the strings past the eighth read as env reads them, with operators in them, in the first versions' way, and alone as `origin/main` read them (`env -S x watch env -S 'rm -rf /home/me'`, a string repeated 500 times); and for `PWD`, 22 lines redacted, 11 quiet, the residual and the cost. The timing tests have an explicit test limit of 20 s (rules) or 30 s (the two linear-time redaction tests, which take 2 to 4 s idle against the runner's 5 s), stated in their comments; **no measured ceiling is raised.** **Mutations**, each confirmed to fail the suite and reverted (tests failing): the second reading of `nsenter` counted as the text's own parts (1); the unresolved copy counted (1); the flag not inherited by what an extra holds (2, the survivor of the review); exhaustion a review (7), the extras' parts bound a cut (6), the finding a review tier (8), put before the parts (5) or left out (9); no depth bound (2), no character bound (2), no parts bound (5); depth not growing in an extra (2); no second reading of `nsenter` (6), or the same as the first (6); no walk of `origin/main`'s wrappers (2), that walk reading a repeated string once (2); no shell reading (1) or no env reading (1) of the strings past the bound; a single-quoted backslash read as an escape (2); an error in a string not reviewed (1); `\t` and `\n` read as separators (1); `#` a comment anywhere (1); `\c` in double quotes ending the string (1); the old continuation pattern (1); a blank around the `=` let through (1); a next name that may not hold a blank (1). **Two survive and are kept**: the first versions' reading of a string (`envLooseWords`) and the reading of a string alone that is not one `origin/main`'s walk found (an attached `-S'cmd'`); on every set above neither changes a tier, since the rules' patterns read a tab or a no-break space inside a word as a blank and the shell scanner's reading of the same string finds the same command. They stay as readings beside the others (they only add), and a later round may remove them with the sweep.
    **Still lower than `origin/main` after this item, as a class:** the option arities of items 9, 12 and 33 listed above; `nsenter -W`, `--wdns`, `--target` prefixes; `watch -d`; **`env -S` with a string that holds the program, or ends in an option that takes a value, so that the words after it are arguments or that value and not the command (class (iii) of item 46, renamed from "`env -S <one word> <command>`", which named only one shape of it)**; and, **added by item 46,** class (ii) (benign commands that `origin/main` cut to a review only because its alone-readings used up the 200 parts). Redaction: a shell assignment of a path-shaped value to exactly `PWD` or `OLDPWD`, with no blank around the `=` and no continuation, and the two lines of item 18. Nothing else. *(Wrong in two places, corrected by item 46: the classes are not these. **Item 47 removes class (iii):** `origin/main`'s own reading of every part with an `env -S` string is made too, so nothing with an `env -S` is lower than `origin/main` for that reason.)*
46. **A `${NAME}` in an `env -S` string is read three ways and reviewed; `PWD` and `OLDPWD` are exempt only where a shell reads an assignment word, and blanks may stand before a connection string's `;`** (a tightening; amends items 43 and 45; **corrects a loosening against `origin/main` that every earlier commit of this work had and no item recorded**, and two wrong statements of item 45). Four things.
    - **(1) The loosening.** GNU `env` 9.4 expands `${NAME}` from its environment in a split string (checked with harmless `printf` calls: `env -u NOPE -S '-u ${NOPE} printf' printf '[%s]\n' hi` prints `[hi]`): a name that is unset expands to nothing and **its word vanishes**, so an option before it takes the next word, and the words after the string can become the command. `envSplit` kept `${NAME}` as a literal word, so the parser read those words as arguments of a harmless program: allow where `origin/main` blocked (a string of that shape followed by a command a block rule exists for). The classifier cannot know a variable's value. Decided:
        - **The part is reviewed.** A string that holds an expansion outside single quotes (`envSplit` reports `hasExpansion`; in single quotes, and after `\$`, the `$` is plain) marks the part unresolved, as a string env cannot read does (`shell-runner-unresolved`, also judged from `/`). Past the eighth string too.
        - **Three readings, the strictest wins.** (a) The expansion kept as a word: the part itself, as before. (b) **Every expansion in that string replaced by nothing** (`envSplit(text, isVanishing)`: a word that was only expansions vanishes; text glued to it stays, `x${X}y` is `xy`; a quoted `"${X}"` leaves an empty word, as env does; a `#` straight after a vanished expansion at the start of a word begins a comment, as env does for an unset name, so `a ${X}#x b` is `a`), the words split, and the options **read again from the start of the part**: the extra is the part's own words with the string replaced by those words, so the wrappers and options before it (`nice`, `timeout 5`, `sudo`, `env -i`) are read again too, and the words after the string become the command where an option before the vanished word took the next one. (c) **In any case the words that follow the string, alone, as a command**, which is the reading where the whole string was consumed. (b) and (c) are extras (item 45's budgets). Past the eighth string the part skips the strings and so already reads the words after them as its command; the strings are read once more, replaced by nothing, led by `env`.
        - **Why these suffice.** For a string with one expansion `env` either has the name set or not: set, the word stands for its value, and the first reading (the expansion as a word that an option takes or that is the program, reviewed as an unknown program) is the part itself; unset, the second reading is exactly what env builds. A string that ends in an option that takes a value is read the same way by both, since the options are read again from the start with the words after the string spliced in, so which word of them is the value is decided as env decides it. A second string that holds an expansion is read in the extras of the first, and the first in the extras made from the part itself, so every combination of kept and replaced across the strings is read. The third reading covers the string that is consumed whole under a mixture. ***Amended by item 47:** these three readings did not suffice for the mixed class (some names set and others unset in one string), nor for a string that holds the program or ends in an option that takes a value (class (iii)), and each patch for a class left another below `origin/main`. They are kept, since they catch what `origin/main` missed, but the guarantee now rests on one reading: `origin/main`'s own reading of the part is always also made (item 47 A), so the mixed class is covered wherever `origin/main` covered it; and the words after a string are read as `env <those words>` and not as a plain command (item 47 D).*
        - **What remains unknown, as a class.** A name that is set to text that is itself an option, a program word, or a word that changes where the options end; and a string with two or more expansions where some names are set and others unset, which can move where the options end or which of the string's own words is the program in a way neither extreme shows. The first is the reviewed unknown program; both are why the part is reviewed whatever the three readings say. A set name whose value is empty makes an empty word (env refuses `-u ''`).
        - **A cost, stated.** Every `env -S` string with an expansion is reviewed. Everyday forms that become stricter (allow to review) in the sweep: `env -S 'node ${NODE_OPTS}' app.js`, `env -S 'printf ${HOME}'`, `env -S "echo ${PWD}"`, `env -S 'echo ${HOME}'`, and any other string that holds an unescaped `${NAME}` and was allowed; forms that were already reviewed (a script, a program computed at run time) stay reviewed. A string whose `$` is escaped (`\$`) or in single quotes is no expansion and is unchanged. A chain of `env -S` strings that each hold an expansion uses up the extras' depth (each is read in the extras of the one before) and is refused (`command-too-complex-to-read`): five of the plainest (`A=${X}`) are enough, four are read; `-u ${X}` is read up to eight and refused from nine. Nothing ordinary has more than one. *(Item 47 restates the rule and its numbers: the depth and the parts are shared with the nested scripts that follow, `-u ${X}` is now refused from five, and N honest one-string commands joined in one call are refused from 81.)*
    - **(2) Redaction, (a): the name after a character that is no assignment context.** The exemption of `PWD` and `OLDPWD` (items 36, 43, 45) did not look at what comes before the name, so `db.PWD=...`, `--PWD=...`, `&PWD=...`, `,PWD=...`, `#PWD=...` and `$PWD=...` were left readable where `origin/main` redacted them. Decided: it holds only where a shell would read an assignment word: the name at the start of the text or of a line, after a blank or tab (*item 47: the code said `\s`, which holds every white space code point and not only those; it now says a space, a tab or a line feed, as this sentence did*), after `(` (so `$(` too), `{` or a backtick, or glued to a `|`, `||` or `&&`; after any other character, a quote included, the name is the password keyword. The rule needs the text before the name, which a pattern's `isNoise` is not given, so it is its own shipped pattern, `connection-string-pwd-glued` (low, kind password): a look-behind for the contexts (tried only where `PWD` or `OLDPWD` stands) in front of the same name and value forms as `assignment`, with `isPlainNoise` as its noise rule. A single `&` is deliberately not a context (a query string); `a&&PWD=` is. A `;` before the name was already read by `connection-string-pwd` and stays. The pattern is in the table of linear-time tests.
    - **(3) Redaction, (b): blanks before the `;`.** `connection-string-pwd-continued` allows up to 16 blanks or tabs between the value (bare, or quoted with its closing quote) and the `;`; the non-blank character must still follow the `;` directly, so `PWD=/tmp ; ls` and `PWD=/x ; CC=gcc make` stay readable and `PWD=/x ;UID=sa` is redacted. Bounded at 16 so that names sharing one run of blanks cost a fixed amount each (the unbounded form is a mutation that a test kills). **(4) (c): a bare value with a blank inside it** followed by `;name=` (`PWD=/correct horse;UID=sa`) is left, and recorded as a residual class, as is a connection string whose item follows a blank (`UID=sa PWD=...`), which is a shell assignment as far as the context is concerned.
    - **What stays readable that `origin/main` redacted (redaction), and its cost in everyday lines.** After this item, exactly these classes (a generated set of 493,038 lines, name × separator × value × tail × prefix, run against four trees: 22,537 are readable here and were redacted on `origin/main`): a shell assignment of a path-shaped value to exactly `PWD` or `OLDPWD` with the name in a shell's context, no blank around the `=`, and no continuation (about 4,800 of the 22,537: the value ends at a blank, `&`, `,`, a line break, a quote or the end), followed by a command word (about 700) or a `;` and a blank, a line break or the end (about 6,500), or a `;` and a word with no `=` within 64 characters (about 5,200), or `;;` (574); and the residual classes of a connection string (about 4,600: a value over 1,000 characters, a value with a blank inside it, a next name over 64 characters), and a few values with a blank before `\";` or a `|`. The cost in everyday lines is the other direction: a command glued to the `;` after a `PWD=` assignment with a `=` within 64 characters (`PWD=/work/p;make CC=gcc`) is redacted, `PWD = /x` with blanks around the `=` is redacted, and so is `PWD=` after a quote (`echo "PWD=/home/me/p"` with a literal path; `echo "PWD=$PWD"` is a variable and stays readable). **Nothing is readable that the commit before (`590e49f`) redacted: 0 in all of the corpora; 7,860 lines of the large set that it left readable are redacted** (5,192 for a name after a character that is no context, 1,250 for the same names with that character written into them, `$PWD=`, `.PWD=`, `-PWD=`, and 1,418 for blanks before the `;`).
    **Sweeps (R9)** on four trees (this tree; `590e49f`; the commit before the first bound, `par`; `origin/main`). Classifier: 718,024 commands: the review's targeted set (12,435), the `env -S` set (205,312), the `nsenter` set (316,800; `par` stalls on the chains, 63,360 of them run on it), the fuzz set (150,000; `par` run on 21,429), the 586 everyday commands, and **32,891 built for this item** (27 strings × nine forms (`-S`, glued `-S`, `--split-string=`, `--split-string `, double-quoted, `env -i`, a second string, past the eighth string, past it twice) × nine commands after them × seven prefixes (none, `nice`, `timeout 5`, `sudo`, `nice timeout 5`, `env -i`, `sudo -u me`), each also inside `$(...)` and, unprefixed, `bash -c`; a string repeated two to twelve times; and 14 honest forms). **Lower than `590e49f`: none in any set; lower than `par`: 563 of the `nsenter` set and 12 of the fuzz set, all of class (i) below; lower than `origin/main`: 28,464 of the `env` set, 880 of the new set, 248 of the `nsenter` set, 1,749 of the fuzz set and 1 of the 586, by class:** (iii) `env -S` with a string that holds the program, or ends in an option that takes a value, so the words after it are arguments or that value and not the command (28,464 of the `env` set, of which 4,848 are strings env itself rejects and 23,616 hold the program or end in such an option; 880 of the new set; 1,622 of the fuzz set; the 1 of the 586, `/usr/bin/env -S node --experimental-vm-modules node_modules/.bin/jest`, which `origin/main` reviewed as a script path); `nsenter -W`, `--wdns` and `--target` prefixes (248 and 113); an option arity of items 9, 12 and 33 (12 of the fuzz set); (ii) benign commands that `origin/main` cut to `command-too-complex` because its alone-readings of the strings used up its 200 parts, which this tree reads completely (2 of the fuzz set); `watch -d` (none in these sets). **Nothing else is lower than `origin/main`.** The classes that were not recorded, as item 45 and item 42 had them: **(i)** two ambiguous options (`nsenter -S`/`-G` followed by a separate word) in one `nsenter` link: the tree before the bound made a third reading, mixed, in which the first option took its word and the second did not, and blocked a command that follows; item 45 reads the two readings that exist (one util-linux version holds for the whole part: every such option takes the next word, or the first such word is the program), neither of which runs that command, and the part is reviewed, so it is lower than the tree before the bound and not lower than `origin/main`; **(ii)** and **(iii)** as above, whose name in items 42 and 45 (`env -S <one word> <command>`) named one shape of (iii) only. Stricter than `590e49f`: the strings with an expansion (the classes of (1)) and the strings repeated more often than the extras' depth reads; on the 586 ordinary commands **none changes tier or rule** against `590e49f`. **Timings** (best of three, idle): the review's stall shapes (`s7`, 161 of them) under 220 ms (219 ms the slowest), the fuzz with `${X}` tokens (4,000 commands) under 90 ms, 97 new shapes of this item (strings repeated, nested, long, eight and nine strings with long tails, many `env` with four and nine strings) under 180 ms; the redaction shapes of `rt.ts` and nine new ones (blanks sharing one run, blanks and tabs, glued contexts) are linear (the ratio of 4 for 4 times the length). **Corpora (redaction):** nothing is readable here that `590e49f` redacts in any of them (the corpora of 231, 277 and 319 lines, and the generated sets of 148,352 and 493,038 forms).
    **Tests** (`rules.test.ts`, `secrets.test.ts`, `gollum.test.ts`; the suite is 1,214 tests): the `envSplit` table gains the unset-name cases (the vanished reading of 16 forms, with a wrapper in front, glued, clustered, `--unset`, `-C`, a comment, quoted and single-quoted expansions, past the bound; glued text kept; the empty word of a quoted expansion; `a ${X}#x b`; an escaped `$` and a single-quoted one are no expansion); the words after the string alone; the review of every honest form; the acceptance table (nine strings, ten forms, four commands that block and one that asks, 450 cases); five strings refused and four read; three shapes of a thousand strings refused at once; and for `PWD`: 20 characters before the name that make it a keyword, 16 contexts that keep it quiet, a `;` before, 8 values with blanks before the `;`, 6 quiet shell lines, the cost and the three residual classes; the pattern's prefix and six adversarial shapes in the linear-time test. **Mutations**, each confirmed to fail the suite and reverted (tests failing): no vanished reading (4); no catch-all (3); no review mark (5); a vanished expansion still starting a word (4); the vanished reading without the part's own words before the string (4); the vanished reading dropping the text glued to it (2); no vanished reading past the bound (1); past-bound strings never flagged (1); an expansion never noticed (6); no glued pattern (1); `{` not a context (1); `&&` not a context (1); `|` not a context (1); `&` a context (1); no start-of-text context (3); no blanks before the `;` (1, the bare branch); the `;` followed by a blank allowed (3); unbounded blanks (1). **One survives and is kept:** the blanks before the `;` of the quoted branch of the continuation pattern, since a quoted value is also found by the bare branch and by `assignment`, and the quoted branch matters only for a value with a blank inside it, which `assignment` already redacts. The catch-all of the strings past the bound was not made: the part skips them, so it already reads the words after them as its command (a mutation of it would be equivalent).
47. **`origin/main`'s reading of a part with an `env -S` string is always also made; env's own words are read as env reads them; the context before `PWD` is a space, a tab or a line feed** (a tightening; amends items 34, 42, 45 and 46; **removes class (iii) of item 46, the last class of `env -S` commands lower than `origin/main`**). Items 45 and 46 each found a class of `env -S` commands lower than `origin/main` (a string that holds the program; a mixture of set and unset expansions) and each added a reading for that class. An independent probe (env 9.4 emulated, 634,860 forms) found further shapes where real `env` runs the dangerous command and this tree was still below `origin/main`, each a new special case. This item stops adding readings class by class and decides one principle. Five things.
    - **(A) The principle for `env`: `origin/main`'s reading of the part is always also made, and the strictest wins.** `mainEnvWalk` (`rules/shell.ts`; it replaces `mainEnvStrings`) is `origin/main`'s walk over the part's words, whole: assignments, keywords, function headers and a `case` arm skipped (`triviaEnd` and `caseArmEnd`, which `coreOf` now uses too: one definition), its table of wrappers and of the options of each that take a value, its runners (and the `-c` and `--call` script of a one-word runner), and for `env` its own `-`, `-i`, `--ignore-environment` and assignments and every `-S`, `--split-string` and `--split-string=` string taken as an option's value. It returns the strings it found (each read alone, as before), the words it left as the command, the privilege wrappers it passed and the scripts of the runners. When this tree's own walk or main's met an `env -S` string (so an attached `-Sx` or `-vS`, which main read as a flag and `env` reads as a string, is read as main read it), **one extra part** is made of `origin/main`'s command: the privilege wrappers (`sudo`, `doas`, `gosu`, `runuser`, `setpriv`, `run0`, `chpst`, `pkexec`: the only wrappers a rule reads) in front of the words main left, each word quoted, and each runner script as an extra. It is charged to the extras' budgets (item 45) like the others. **Consequences, all accepted:** the tree is never lower than `origin/main` for an `env -S` form by construction (the rest is the parser's own tables, below); class (iii) is gone, so `env -S 'x y' rm -rf /home/me`, `env -S printf rm -rf /home/me`, `env -S'-u' git push --force origin main` and `env '-S-i --chdir' rm -rf /home/me` are blocked (allow or review before) and a shebang-style `/usr/bin/env -S node --experimental-vm-modules node_modules/.bin/jest` is reviewed as the script path main made of it; the mixed set and unset `${NAME}` class is covered where `origin/main` covered it; every reading item 45 and 46 added stays (they catch what main missed). **Not made when it is the part's own words again** (the walk of main stopped at the first word: a wrapper main did not know such as `setarch x86_64 env -S 'x y' cmd`, `fakeroot`, `systemd-run`, `npm --prefix web exec`, or a brace word): the reading would be this one, and so on to the extras' depth, and an ordinary call would be refused. For those the tables of this tree read the part as they always did.
    - **(B) `env`'s own words, with or without `-S`** (a defect on `origin/main` too). After `--` a lone `-` is env's `-i`, and a word with a `=` in it is an assignment, not the program; and without `--` the same holds for a word with a `=` in it. Checked with harmless `printf` calls on env 9.4: `env -- - printf '[%s]\n' hi` and `env =1 printf '[%s]\n' hi` run `printf`; **so do `env a-b=c printf …`, `env 1a=b printf …` and `env a.b=c printf …`**: env takes any word with a `=` in it for an assignment (the shell's assignment word needs a name; env's does not), so the rule is that, not only a word that starts with `=` (`isEnvAssignment`, `envOwnWordsEnd`; a word that starts with `-` is an option and is tried first). The program is the first word after these. **Decided to keep the earlier reading too:** the word that env now reads as its own was the program for the earlier versions, and a rule can match text in such a word (`env 'dd if=/dev/zero of=/dev/sda' ''` is reviewed as an overwrite tool on every tree); it would be lowered by the fix. That reading is made as one extra part, once for the part (the earlier walk stopped at the first such word), from that word on.
    - **(C) `${NAME}=value` as a word of a string is an assignment whatever the name holds** (checked with `printf`: `env -u NOPE -S '${NOPE}=v printf' '[%s]\n' hi`, and with a set name, run `printf`). It follows from (B): in the kept reading the word has a `=` in it, and in the vanished reading it is `=v`; the program is the next word in both.
    - **(D) The catch-all reads the words after a string as `env <those words>`**, not as a plain command: env goes on parsing its own options there (`env -S '-u ${X} ${Y}' -a X rm -rf /home/me`: the kept reading makes `${Y}` the program, the vanished reading makes `-u` take `-a`, main's walk read `X` as the program since `-a` was a flag for it, and only `env -a X rm …` reads `rm`).
    - **(E) Redaction.** The look-behind of `connection-string-pwd-glued` (`hooks/redact.ts`) said `\s`, which holds every white space code point, where its comment and item 46 said "after a blank or tab". It is now `[ \t\n]` with the start of the text: **a line feed counts** (the start of a line; a Windows line end `\r\n` ends in one), a space and a tab count, and nothing else does: a carriage return, a vertical tab, a form feed, a no-break space, a line or paragraph separator, an ideographic space and a byte order mark before `PWD=` make the name a key and the value is redacted, as after any other character. A look-behind of one character, so the pattern stays linear (the table of linear-time tests stands, ratios about 4 for 4 times the length).
    - **The refusal rule, as it really is (restated; item 46 said "five of the plainest"; the numbers are measured).** The extras share their depth (4 levels) and their parts (400) with every script nested in them and with every other extra of the call. An `env -S` command makes extra parts: its string alone, the shell's second reading, `origin/main`'s reading (three), and with an expansion the vanished reading and the words after the string (five); a reading that holds the strings again is read in the extras of the one before, as in item 46, so it makes its own again, one level deeper. So: **four strings that each hold an expansion followed by a nested script (`env -S 'A=${X}' ×4 bash -c 'echo hi'`) are refused; followed by `make`, five are** (item 46: also five); **`-S '-u ${X}'` ×5 is refused (nine before this item)**; and **N honest commands of one string each, joined in one call, are refused from the 81st when each string holds an expansion (101st before) and from the 134th when none does (never before: the text's own 200 parts came first)**. A string of 200 commands is read (refused from 201, as before). Four `-Senv` strings and a 19,000-character word scan 437,000 of the 400,000 characters (285,000 before): refused. **The maintainer should see this cost:** one of the 586 everyday commands, a line of 140 `env -S "node --check" fN.js` commands joined by `&&` (4,506 characters), was reviewed (`script-file`) on the commit before and is now refused (`command-too-complex-to-read`; main reviewed it as `command-too-complex`, having used up its 200 parts); it needs three extra parts a command and 133 fit. Two ways to read it within the budget were tried and not kept: skipping the shell's second reading of a string of plain words (it is the part itself) made 199 crafted chains and depths that the commit before refuses readable again (a loosening, per R8), and the budget is not raised here.
    **Sweep (R9)** on three trees (this tree; the commit before, a copy of `HEAD` at `24286e4`; `origin/main`) over **1,352,884 commands**: the 718,024 of item 46 (the review's targeted set 12,435; the `env -S` set 205,312; the `nsenter` set 316,800; the fuzz set 150,000; the 586 everyday commands; the 32,891 built for item 46) and the 634,860 of the independent probe (strings of up to four of 40 tokens, expansions, `--`, `-`, assignments and options, 17 forms, 20 tails). **Lower than the commit before: none, in any set** (a first version of (B) lowered one fuzz command to an allow, the word `dd if=/dev/zero of=/dev/sda env -S …` read as an assignment, which the reading as the program above keeps; a version that skipped a second reading lowered 199, above). **Higher than the commit before: 105,750** (30,778 of the `env -S` set, 71,676 of the probe, 2,167 of the fuzz set, 1,114 of the 32,891, 12 of the `nsenter` set, 3 of the 586): the tightening. **Lower than `origin/main`: 257, by class, none with an `env -S` as its cause:** `nsenter -W`, `--wdns` and `--target` prefixes 242 (item 33; 12 of them with the `nsenter` inside an `env -S` string, which this parser reads with its own tables, as it always did); two ambiguous `nsenter` options in one link 11 (item 45 (i); two inside a string); `env -a` taking a value 3 (item 33); main's 200-part cut 1 (class (ii) of item 46). The commit before was lower than `origin/main` on 69,772 of the same commands, 69,531 of them with an `env -S` (67,116 of them class (iii)); of the probe's 634,860 it was lower on 38,430, and this tree on none. Each of them was inspected: the cause is the `nsenter` option or the `env -a` in the text (the same text without the `env -S` is lower than `origin/main` too), not the `env -S`. **The 586 everyday commands: 3 change tier against the commit before:** the line of 140 above (review to refusal); `/usr/bin/env -S node --experimental-vm-modules node_modules/.bin/jest` (allow to review, `script-path`, as main); `for f in *.ts; do env -S "node --check" "$f"; done` (allow to review, `shell-dynamic-program`: the word after the string is `"$f"`, a program computed at run time). **33 differ from `origin/main`**: 31 are the commit before's tighter reading (a script file reviewed where main allowed it, `gh pr create --fill` reviewed as `publish`, the `nsenter -S` forms reviewed as unresolved), the loop above and the line of 140. **Timings** (best of three, idle): every shape of the review's stall sets (`s7`, `s8`, `s9` and the probe's `st`, `st2`, `st3`) under 300 ms (the slowest, 184 ms), and no command of the 1,352,884 took more than 300 ms in one call. **Redaction:** the sets of items 43 to 46 on this tree, the commit before and `origin/main` (493,038 lines and a set of 930,624 with the characters before the name added): **nothing is readable here that the commit before redacts: 0 in both**; 12,216 lines of the second are redacted that the commit before left readable (2,036 for each of six characters: a carriage return, a vertical tab, a form feed, a no-break space, an em space and a byte order mark, before a name whose value is a path); what is readable here and redacted on `origin/main` is the class of item 46, unchanged (22,537 of the first).
    **Tests** (`rules.test.ts`, `secrets.test.ts`; the suite is 1,221 tests, 1,214 before): six tests for A to D and the refusal rule (the command main read after a string, with the wrapper that marks it privileged, behind a wrapper, in a substitution, past a function header and a case arm; a wrapper main did not know is not refused; `--` then `-` and `=word` with and without `-S`, the earlier reading kept; `${NAME}=v` in the part itself and in the vanished reading; a tail that starts with `-a` under a mixture; the counts of the rule above), and one for (E) (eleven characters redacted, eight contexts quiet); two existing tests changed with the counts (the 150 `env -S` commands become 130, which fit; three `-Senv` strings and a long word fit the character budget, four are refused). **Mutations**, each confirmed to fail and reverted (tests failing): no reading of main's command (3); no privilege wrapper kept (1); runner scripts not read (1); the reading only when main's walk saw a string (2); no guard against the part's own words (1); main's walk without function headers (2) or without the `case` arm (1); an env word with a `=` only when it is a shell assignment (2); nothing skipped after `--` (1); the `-` after `--` not skipped (1); assignments after `--` not skipped (1); the earlier reading as the program not made (1); `$…=v` not an assignment (1); the catch-all as a plain command (1); `\s` in the look-behind (1); a line feed not a context (3); a tab not a context (2).
    **Still lower than `origin/main` after this item, as a class:** the option arities of items 9, 12 and 33 (a runner or wrapper flag read as taking a value; `env -a`); `nsenter -W`, `--wdns`, `--target` prefixes; two ambiguous `nsenter` options in one link; `watch -d`; main's 200-part cut (benign commands that main reviewed because its own readings used up the parts: class (ii)). **No class with an `env -S` as its cause.** Redaction: a shell assignment of a path-shaped value to exactly `PWD` or `OLDPWD`, with no blank around the `=` and no continuation, the two lines of item 18, and the residual classes of items 45 and 46. Nothing else.
