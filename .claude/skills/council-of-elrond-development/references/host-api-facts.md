# Facts about the host API

What the probes and the binary showed. `mods/types/claude-code.d.ts` stays the API (R2); these are what it does not say.

## Hard-won API facts (verified by probes; details in DESIGN.md)

Each fact carries the version it was last verified on in DESIGN §12; M0.4 re-probes them all and
writes the version beside each.

1. **Only `hooks/register.ts` may touch `$`.** *(M0.4 probe 1 re-probes this: finding A1 found it no longer holds at validation time. Until then the rule stands.)*
   - Passing `$` to an imported function fails validation.
   - `$`-taking helpers must be **top-level functions in register.ts**, not closures inside a hook.
   - All decisions live in pure sibling modules.
2. **A hook that overruns its 10 s own-time budget is cut off from 2.1.299** (DESIGN §12.5): its `.catch` is asked with `kind` `timeout` and `called` false, and a later `next(e)` is refused. The test kit does not cut a hook off, so the guard below stays.
   - Every pass-through goes through `proceed()` in register.ts, which refuses when `next.budget.remainingMs < 1000`.
   - Keep the hook's own (non-`$`) work small and bounded.
   - A hook that blocks the hooks worker for 5 s without yielding has the worker replaced and its `.catch` asked (`kind` `throw`): keep a `.catch` on the gating hook.
3. **`$` calls don't count against the budget; `$.clock.sleep/after/every` do.**
   - Bound model calls with `timeoutMs` and processes with `timeoutMs`.
   - Build a shared deadline by passing *remaining* time into each call's `timeoutMs`, never with a clock timer.
4. **In `.catch`:** if `next.called`, then `next(e)` replays the real result without re-running the call. Otherwise refuse.
5. **`$.ui.ask` is an `AskUserQuestion` tool call** that skips the calling hook but **not the plugin's other `tool.call` hooks**.
   - Keep exactly one `tool.call` hook.
   - It rejects on dismiss, on "Chat about this", and in `-p`. In `-p` on 2.1.299 the rejection says the session has no `AskUserQuestion` tool. Dismiss and "Chat about this" reject with the same text (the call's result, cut to 120 characters), so the mod cannot tell them apart (DESIGN §12.4).
   - Guard it with `$.session.surfaces()` (empty means nobody can be asked: refuse).
   - In a cloud session in Auto mode, the host answered it with the first option and the person saw nothing (DESIGN §14.1): an answer is not proof that a person chose it. Never ask where `$.session.surfaces()` is empty.
   - The engine's own alternative is a `tool.check` hook's ask (`decider: 'person'` on 2.1.304; from 2.1.308 every hook's ask is a person's and `decider` is gone, DESIGN §14.2). On 2.1.304 no classifier, PermissionRequest hook, allow rule or `bypassPermissions` settled it (2.1.308's types name a PermissionRequest hook among what may answer it, not yet probed), and in `-p` it is a deny. But a host program's allow does settle it: in a hosted session, the host is told only to suppress an "always allow" rule (DESIGN §14.2).
6. **Command output reaches Claude.** A command's `{ text }` is read by Claude (approved decision 1: don't put council internals there). *(Amended by C2: where nothing draws, a person's `/council` status, report, rules and test also go to Claude as the result's `context`, redacted and fenced; DESIGN §13.5.)*
7. **`$.state` needs a contract.**
   - Every key must be declared in `types/index.d.ts` (`PluginState`).
   - Refs must be literals.
   - Writes are refused while drawing.
   - It survives reloads; `/clear`, `/resume` and `/branch` reset it.
8. **`userConfig` is flat:** string, number or boolean, `options` for a picker, `multiple` for string lists. Lists and structures go in rules.json.
9. **Tests:**
   - Stub every `$` noun the code touches with the test's `on(...)`; an unstubbed bottom throws.
   - The fixtures in `tests/fixtures.ts` already answer files, model, user, surfaces, logs and the tool itself.
   - `$.tool.call` input types drop `agentId`, but it arrives at runtime (cast `as never`). From 2.1.308 the test kit's `$.tool.call` takes `agentId`; the existing casts still compile.
   - Registering the same event twice in one test fails the load; use fixture switches instead.
10. **`--plugin-dir` writes generated files into the mod folder.** It writes .claude-plugin/types/ and tsconfig.json, both gitignored.
11. **Drawing from register.ts without JSX:** call the global `h(Element, props, ...children)` with elements from `$.ui.resolve(e)` and cast the result to `RenderElement`; the file stays `.ts`.
12. **Test kit specifics (stage 2):** a `tool.call` bottom answer must carry `result` (an error is `{ result, isError: true, text }`); `$.session.start` needs `{ cwd, surface, isInteractive }` and a bottom hook returning `{ cwd }`; a `ui.render` hook that calls `next(e)` (SessionMode) needs a bottom `ui.render` hook in the test; `$.command.run` resolves `{ text: undefined, ref: undefined }` for a hook's `{}`.
13. **Claude Code's own denial wording.** Automatic (verified in `-p`): "`rm in '<path>' needs approval. … Claude Code asks before a shell command creates, changes or removes files there.`" The person refusing at the prompt (from the binary): "The user doesn't want to proceed with this tool use. …", optionally ending "To tell you how to proceed, the user said: …", or "The user doesn't want to take this action right now. …". All come back from `next(e)` as `isError: true`.
14. **`$.process.spawn` has no timeout** (stage 4, probed live in 2.1.289). End the loop with `stream.return()` from a `$.clock.after` timer.
    - Doing so kills the child, with no orphan.
    - A pending `after` cost the hook about 3 ms of budget while a spawn pull was in flight for 12 s: it does not burn the budget the way an awaited `$.clock.sleep` does.
    - After `return()`, `stream.result` settles `undefined`, so track "ended by us" in a flag.
    - In the test kit, a `process.spawn` bottom hook is an async generator returning `{ value: { code, signal } }` (or `{ deny }` for "can't start"). A generator stuck in an `await` never sees the consumer's `return()`, so a hanging stub must keep yielding.
    - `mock.clock(on)` answers `clock.now/after/sleep`; the fixtures take `isClockMocked: true` (and `w.modelDelays`) instead of their default real-time `clock.now`.

## What the hardening sessions established (2026-11)

Each is to be re-probed by M0.4; until then treat the ones marked as read, not probed.

- **A headless child run works from a cloud session** (probed on 2.1.322). Earlier notes assumed
  it did not.
- **`$.session.cwd()` follows a `cd` between shell calls** (DESIGN §14.5, probed on 2.1.304).
  Approvals are keyed by it.
- **`$.store` exists and persists across sessions** (the types). Where its file lives, and
  whether a write to it is caught, is not known: M0.4 probe 10.
- **The shape of denial texts, read from the 2.1.322 binary and not yet probed live:** where
  nobody can be asked, an ask is wrapped in one message that opens with a fixed sentence and ends
  with what required approval; a second wrapper exists for sessions with no prompts; a deny rule
  opens with its own sentence; a failed shell command's text is assembled as an exit-code line,
  then its error output, then its output. M1.9 rests on this and M0.4 probe 5 checks it.
- **The mod's own refusal reaches the model inside an error wrapper** (seen in the stream of
  headless runs on 2.1.322). Whether the host's denials reach the hook wrapped the same way is
  not known: probe 5.
- **The test kit records what the mod hands the question dialog, not its paint.** Wrapping,
  markup and what a narrow window does are only seen in a terminal
  (`docs/TERMINAL-CHECK.md`).
