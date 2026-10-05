# council-of-elrond: design

Status: **Stage 1** (Elrond, rules, Gandalf, escalation, fail-closed paths, audit log; plain mode).
Built and checked against Claude Code **2.1.289**; its generated API types are vendored at
`mods/types/claude-code.d.ts` and are the source of truth over docs, samples and the spec.

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
hooks: session.start, prompt.submit, tool.call
calls: $.env.get (via loadContext), $.fs.exists (via appendAudit, loadContext),
       $.fs.read (via appendAudit, loadContext, scriptsOf), $.fs.stat (via loadContext, realPathOf),
       $.fs.write (via appendAudit), $.model.complete (via reviewByGandalf), $.session.cwd,
       $.session.root (via loadContext), $.session.surfaces (via escalate), $.state.get,
       $.state.set, $.ui.ask (via escalate), $.ui.log, $.ui.toast (via warnOnce)
env reads: HOME
state: council-of-elrond.session
```

There is no `tool.check` hook: the mod never takes part in the permission decision.

## 3. Data flow

```
tool.call ─► classify (pure, rules only)
             │ allow ──────────────────────────────► next(e)            (no I/O beyond cwd/stat)
             │ block ──► refuse (rule reason)                            audit
             │ ask   ──► escalate ─► allow once ──► next(e)              audit
             │                    └► keep blocked / instruction / dismissed / chat / nobody ─► refuse
             │ review ─► bypass? ─► next(e)                              audit
             │           member off / budget spent ─► escalate
             │           Gandalf ($.model.complete, own deadline)
             │              approve ─► next(e)
             │              revise / block ─► refuse (verdict)
             │              error / timeout / malformed ─► escalate
             └─ any throw before next ─► .catch ─► refuse
```

- **Files.** `hooks/register.ts` is the only file that touches `$`. Rules (`rules/`), config (`config/`), members (`members/`), escalation, refusal and model choice (`elrond/`), state (`state.ts`), audit (`audit.ts`), redaction and strings are pure modules.
- **State.** One `$.state` value, `council-of-elrond.session` (`types/index.d.ts`). `resetForPrompt` is the single reset, run on every prompt you send (composer, bridge or SDK origin).
- **Config.** The shipped defaults are a TS module. Project overrides live at `.claude/council-of-elrond/rules.json`, read once per load.

## 4. Failure modes

| Failure | Behaviour |
| :- | :- |
| Hook throws before the call runs | `.catch` refuses ("fails closed"). |
| Hook throws after the call ran | `.catch` replays the real result (`next.called`); the call is not re-run and Claude isn't told a call that ran was refused. |
| Hook overruns its 10 s own-time budget | **Probe result: the engine did not cut the hook off in the test kit, even with `.catch`.** A hook that overran and then called `next(e)` ran the call. Elrond therefore passes calls only through `proceed()`, which refuses when `next.budget.remainingMs` < 1 s. The hook's own work is bounded to make this unlikely: commands over 20,000 characters aren't parsed (review), parse depth ≤ 4, ≤ 200 parts. |
| Model error, timeout (`timeoutMs`), empty reply, malformed verdict, request refused | Escalate to you; "keep blocked" refuses. |
| Token budget spent / Gandalf switched off | Escalate without a model call. |
| Nobody can be asked (no surface) | Refuse, saying why. |
| `$.ui.ask` dismissed / "Chat about this" | Refuse (recorded as `dismissed` / `chat`). |
| Overrides file broken, unknown version, invalid field | Ignored whole; shipped rules enforce; a transcript line lists errors by field, plus a toast. |
| Audit write fails | Logged to the debug log; never changes a decision. |
| Module fails to load, mod disabled, `disableAllHooks`, `--safe-mode`, `--bare` | **No gate at all.** Outside the mod's reach. |

## 5. Decisions the spec did not cover (Stage 1)

1. **Precedence of project rules.** Per command part, a matching project rule decides before shipped rules (overrides win). Shipped block rules and protected paths are a floor no project rule lowers, and block rules can't be disabled. Lists (protected paths, branches, production patterns) only add to the shipped ones.
2. **The overrides file is protected** (`.claude/council-of-elrond/**`), as are `.claude/settings*.json` and `.git/**`. Claude can't loosen the gate or change the models without your approval.
3. **Protected paths apply to any shell mention**, reads included (`cat .env` asks). The Read tool is not gated.
4. **Recursive delete of the project root itself is blocked** (`rm -rf /work`, `rm -rf .` at the root). A glob over its contents (`rm -rf ./*`) is review.
5. **`cd` inside a compound command** moves where later parts' paths land. An unknown target (`cd $X`) is treated as `/`, so a later relative recursive delete is blocked rather than guessed at.
6. **Running a program by path** (`./deploy.sh`) is script execution (review), along with interpreters running files.
7. **Models.** Built-in defaults are `sonnet` (Gandalf, Legolas), `opus` (Aragorn, full council), with no Haiku in any default. Aliases track the newest model of the family this Claude Code build knows. Layers, in order: session switch (Stage 2), `/config` row, project file, built-in. Settings follow the family: Sonnet 2,000 tokens / low effort / 30 s, Opus 2,000 / low / 45 s, Fable 4,000 / low / 90 s, Haiku 400 / no effort / 20 s.
8. **Stage 1 routing.** Every review goes to Gandalf until Legolas and Aragorn exist (Stage 3). The audit log records the member that actually reviewed.
9. **Allow before bypass.** The classifier runs first; the allow tier passes before the state is read, so allow adds no state or audit I/O. Bypass then applies to gated calls only. The behaviour is the same as the spec's order.
10. **Plain-mode notices say "Council:"**, not the plugin's name, which contains a theme word. The engine labels toasts with the plugin's name itself; that is outside the mod's reach.
