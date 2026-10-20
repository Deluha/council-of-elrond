# council-of-elrond: roadmap

How to finish the mod from where it stands, written so a new dev session can pick it up cold.

- **The spec:** [SPEC.md](./SPEC.md) (§ numbers below refer to it).
- **What exists and why:** [DESIGN.md](./DESIGN.md).
- **Decisions approved after the spec:** listed below; they win over the spec where they differ.

| Stage | Scope (SPEC §20) | Status |
| :- | :- | :- |
| 0 | Research, plan | ✅ Done ([DESIGN.md §1](./DESIGN.md)) |
| 1 | Elrond, rules, Gandalf, escalation, fail-closed paths, audit log (plain mode) | ✅ Done: [Deluha/council-of-elrond#1](https://github.com/Deluha/council-of-elrond/pull/1) |
| 2 | Gollum, Galadriel, operation keys, rounds, wipes, cache, commands, shadow mode | ✅ Done: [Deluha/council-of-elrond#2](https://github.com/Deluha/council-of-elrond/pull/2) |
| 3 | Legolas, Aragorn (git and database profiles), routing | ✅ Done: [Deluha/council-of-elrond#3](https://github.com/Deluha/council-of-elrond/pull/3) |
| 4 | Full council with Gimli | ✅ Done: [Deluha/council-of-elrond#4](https://github.com/Deluha/council-of-elrond/pull/4) |
| 5 | Rule and allowlist suggestions, `/council report` | ✅ Done: [Deluha/council-of-elrond#5](https://github.com/Deluha/council-of-elrond/pull/5) |
| 6 | Theme strings, then UI features in order | ✅ Done: [Deluha/council-of-elrond#11](https://github.com/Deluha/council-of-elrond/pull/11) |
| — | Final deliverables (SPEC §21–22) | ✅ At the checkpoint ([DESIGN.md §12](./DESIGN.md)); the terminal check is the maintainer's |

**Review at the end of Stage 5:** [docs/REVIEW-2026-10.md](../../docs/REVIEW-2026-10.md) holds the
findings (a 0.5.x hardening list) and proposed amendments to Stage 6 and the definition of done,
pending the user's decision. Project documentation for users, contributors and maintainers lives in
[docs/](../../docs/) and the repository root.

**Stop at every checkpoint (SPEC §20).** At each one: tests pass, `tsc` passes, `claude plugin validate`
passes, and the user gets a short summary of what changed, the decisions the spec didn't cover, and
the known limits. Then wait for the go-ahead.

---

## Resuming: what to know first

### Commands

```
cd mods/council-of-elrond && claude plugin test .     # all tests (532 after dropping `sdk`)
tsc -p mods                                           # strict typecheck against mods/types/claude-code.d.ts
claude plugin validate mods/council-of-elrond         # copy its hooks:/calls: lines into DESIGN.md §2
```

- **Check the Claude Code version.** Run `claude --version`; this was built on **2.1.289** and checked on **2.1.291** from stage 5, **2.1.294** from stage 6, and **2.1.296**, **2.1.299** and **2.1.304** after it (types regenerated each time; the drift was additive, DESIGN.md header; 2.1.299's probes found two semantic changes, DESIGN §12.5; 2.1.304 removed the `re-entry` failure kind the mod never relied on, DESIGN §12.6). If it changed, regenerate the types by loading the `plugin-authoring` skill (it writes `types/claude-code.d.ts` under the skill's folder and names the path; don't write a mod folder, which would ask to hot-reload it into your session), copy them over `mods/types/claude-code.d.ts`, rerun `tsc`, and note any API drift in DESIGN.md.
- **Keep the mod out of the session building it.** Don't load it into your own dev session (the skill's hot-reload folder, or `--plugin-dir` on the session you work in): it would gate your own tool calls.
- **Live checks run headless.** Use `claude -p --plugin-dir ./mods/council-of-elrond "<prompt>"` with harmless commands, ideally in a throwaway `git init` folder, then clean it up along with the generated `.claude-plugin/types/` and `tsconfig.json` in the mod folder. `/council` output only shows with `--output-format stream-json --verbose` (as `system/ui_log`).

### Hard-won API facts (verified by probes; details in DESIGN.md)

1. **Only `hooks/register.ts` may touch `$`.**
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
   - The engine's own alternative is a `tool.check` hook's ask with `decider: 'person'`. No classifier, PermissionRequest hook, allow rule or `bypassPermissions` settles it, and in `-p` it is a deny. But a host program's allow does settle it: in a hosted session, the host is told only to suppress an "always allow" rule (DESIGN §14.2).
6. **Command output reaches Claude.** A command's `{ text }` is read by Claude (approved decision 1: don't put council internals there). *(Amended by C2: where nothing draws, a person's `/council` status, report, rules and test also go to Claude as the result's `context`, redacted and fenced; DESIGN §13.5.)*
7. **`$.state` needs a contract.**
   - Every key must be declared in `types/index.d.ts` (`PluginState`).
   - Refs must be literals.
   - Writes are refused while drawing.
   - It survives reloads; `/clear`, `/resume` and `/branch` reset it.
8. **`userConfig` is flat:** string, number or boolean, `options` for a picker, `multiple` for string lists. Lists and structures go in `rules.json`.
9. **Tests:**
   - Stub every `$` noun the code touches with the test's `on(...)`; an unstubbed bottom throws.
   - The fixtures in `tests/fixtures.ts` already answer files, model, user, surfaces, logs and the tool itself.
   - `$.tool.call` input types drop `agentId`, but it arrives at runtime (cast `as never`).
   - Registering the same event twice in one test fails the load; use fixture switches instead.
10. **`--plugin-dir` writes generated files into the mod folder.** It writes `.claude-plugin/types/` and `tsconfig.json`, both gitignored.
11. **Drawing from register.ts without JSX:** call the global `h(Element, props, ...children)` with elements from `$.ui.resolve(e)` and cast the result to `RenderElement`; the file stays `.ts`.
12. **Test kit specifics (stage 2):** a `tool.call` bottom answer must carry `result` (an error is `{ result, isError: true, text }`); `$.session.start` needs `{ cwd, surface, isInteractive }` and a bottom hook returning `{ cwd }`; a `ui.render` hook that calls `next(e)` (SessionMode) needs a bottom `ui.render` hook in the test; `$.command.run` resolves `{ text: undefined, ref: undefined }` for a hook's `{}`.
13. **Claude Code's own denial wording.** Automatic (verified in `-p`): "`rm in '<path>' needs approval. … Claude Code asks before a shell command creates, changes or removes files there.`" The person refusing at the prompt (from the binary): "The user doesn't want to proceed with this tool use. …", optionally ending "To tell you how to proceed, the user said: …", or "The user doesn't want to take this action right now. …". All come back from `next(e)` as `isError: true`.
14. **`$.process.spawn` has no timeout** (stage 4, probed live in 2.1.289). End the loop with `stream.return()` from a `$.clock.after` timer.
    - Doing so kills the child, with no orphan.
    - A pending `after` cost the hook about 3 ms of budget while a spawn pull was in flight for 12 s: it does not burn the budget the way an awaited `$.clock.sleep` does.
    - After `return()`, `stream.result` settles `undefined`, so track "ended by us" in a flag.
    - In the test kit, a `process.spawn` bottom hook is an async generator returning `{ value: { code, signal } }` (or `{ deny }` for "can't start"). A generator stuck in an `await` never sees the consumer's `return()`, so a hanging stub must keep yielding.
    - `mock.clock(on)` answers `clock.now/after/sleep`; the fixtures take `isClockMocked: true` (and `w.modelDelays`) instead of their default real-time `clock.now`.

### Conventions in this codebase

- **Imports:** pure modules import siblings with `.js` suffixes (`./schema.js`); types come from `claude-code`.
- **No text in logic:** every user-facing string lives in `hooks/strings.ts` (plain now, themed in stage 6).
- **One state value:** session state is the single `$.state` value `council-of-elrond.session` (`CouncilSession` in `types/index.d.ts`), changed only through pure functions in `hooks/state.ts`. `resetForPrompt` is the one per-prompt reset; extend it rather than adding resets elsewhere.
- **Refusals:** every refusal is built by `refusalText` (`hooks/elrond/refusal.ts`), and every escalation by `questionText` (`hooks/elrond/escalation.ts`).
- **Audit:** each gated call writes exactly one audit line, via `finish()` in register.ts.
- **Comments:** short, saying why, never what.

---

## Approved decisions (after the spec)

From the Step 0 review and the model discussion. These are binding unless the user changes them.

1. **Command output stays out of Claude's context.** *(Amended by C2, approved 2026-10-13, a scoped exception: where `$.session.surfaces()` is empty, `/council` status, report, rules and test, typed by a person, also return their lines as `context` for Claude to relay, redacted and fenced; every other case is as below. DESIGN §13.5.)* `/council` subcommands draw in the pane where a surface draws, else `$.ui.log` (dim, not sent to the model). The `command.run` hook returns no Claude-readable text. This includes `/council off|on|shadow`. Verify where `ui.log` lines go in a plain `claude -p "/council report"` run.
2. **Models.**
   - No Haiku in any default; the latest Sonnet is the floor.
   - Built-in defaults: Gandalf `sonnet`, Legolas `sonnet`, Aragorn `opus`, full council `opus` (`BUILT_IN_MODELS` in `hooks/config/defaults.ts`).
   - Fable is selectable.
   - Layers, highest first: session switch (`/council model`) → `/config` row (picker: `default` / `sonnet` / `opus` / `fable` / `haiku`; `default` = unset) → project `rules.json` `models` (full IDs allowed) → built-in. Your `/config` choice beats the project file.
   - Token cap, effort and deadline follow the model family (`profileOf` in `hooks/elrond/models.ts`).
   - `/council model <member> <model>` switches for the session. `--save` writes the `/config` row via `$.config.set`, falling back to session-only with a message when the value isn't a picker option or the row is locked.
   - On a `/council model` change, send a one-token probe call to confirm the model works.
3. **Deadlines.**
   - Single member: from the model (Sonnet 30 s, Opus 45 s, Fable 90 s). Galadriel: 5 s per inspection command, up to 3 commands.
   - Full council: one shared model deadline.
   - **Gimli runs outside that deadline**, on its own per-command timeouts (default 120 s, max 600 s). It starts first and runs alongside the models via `$.process.spawn`, so Esc can kill it.
   - Overall council wait: the longer of the model deadline and Gimli's longest timeout.
4. **Unanswered escalations.**
   - Dismissing the dialog is "keep blocked" and **counts as a wipe**.
   - "Talk first" (themed "Parley: talk first"), the dialog's own fourth option, refuses, telling Claude to stop and ask, and is **not a wipe**. Claude Code's "Chat about this" counts as a dismissal. *(Amended 2026-10-13, approved by the user: this used to say "Chat about this", which the mod cannot tell from a dismissal, DESIGN §12.4.)*
   - Nobody to ask: refuse, and it counts as a wipe (a block).
   - Typed text is an instruction and resets the operation's rounds; labels compare exactly.
5. **Audit log** at `.claude/council-of-elrond/audit/audit.jsonl`, with a self-written `.gitignore` (`*`), 1 MiB × 3 files. *(Done.)*
6. **Shadow mode ships off** (enforcing). The README's first-days section recommends turning it on. While the audit log is empty, a one-time toast in the first session suggests it. An indicator by the prompt shows it whenever it's on.
7. **Unmatched MCP tools are allowed**, plus a shipped review rule for tool names containing mutating verbs (`mcp-mutating`). *(Done.)*
8. **Build in the repo** (`./mods/council-of-elrond`). Verify with tests, `tsc` and validate; the user runs live UI checks in a terminal with `--plugin-dir`.
9. **Config reload.** Load at session start, after the mod's own writes to `rules.json` (confirmed rules, allowlist entries), and on a new `/council reload`. Never by watching the file.
10. **Possible second prompt on the ask tier.** "Allow once" calls `next(e)`, and Claude Code may still ask. Accept it, and label the permission dialog with `$.ui.notice(e.tool_use_id, "Council: you allowed this once")`. *(Done.)*
11. **Operation keys (stage 2):** tool family + verb + normalised target set.
    - Paths are resolved to real paths under the root, flags dropped, targets sorted.
    - Push uses remote + branch; SQL uses the target database.
    - So `rm -rf ./build` and `rm -r build/` share a key.
    - A coarser per-verb counter (e.g. `git push`, any target) locks out at 5 wipes, to catch retries that change the target.

Stage 2's own decisions (the ones the spec didn't cover) are in [DESIGN.md §6](./DESIGN.md), Stage 3's in [§7](./DESIGN.md), Stage 4's in [§8](./DESIGN.md), Stage 5's in [§9](./DESIGN.md).

12. **Refusals at Claude Code's own permission prompt** (answered in stage 2). The person's own refusal there, after the council let the call through, counts as a failed attempt (as "keep blocked"); an automatic denial with nobody asked (`-p`, a deny rule) does not. Recorded as `outcome: "refused-by-user"` and `"denied-by-permission"` (`outcomeOf` in `elrond/operations.ts`). *(Done.)*

---

## Stage 2: Gollum, Galadriel, operation keys, rounds, wipes, cache, commands, shadow ✅

Pipeline order to implement (SPEC §4): bypass → classify → allow → block → **lockout** → **Gollum** →
ask → **Galadriel** → route → act → **after the tool runs**.

### Gollum: `hooks/members/gollum.ts` (pure scan) + register.ts wiring
- [x] Scan the call: shell command text plus heredoc input, Write content, Edit `new_string`, NotebookEdit source, and MCP input JSON. Reuse `SECRET_PATTERNS` and `isRandomLooking` in `hooks/redact.ts` (each pattern already has a `level`).
- [x] **High finding:** refuse without asking, and tell Claude to remove the secret. Never offer a rule.
- [x] **Low finding:** ask with a redacted snippet. Options: keep blocked, allow once, add to allowlist. Allowlist only after a second confirm that shows the exact entry; write it to `rules.json` (`gollum.allowlist`), then reload config (decision 9).
- [x] Config: `gollum: { patterns: [{ id, level, regex, label }], allowlist: [...] }` in `rules.json`, added to `TOP_KEYS` and validated in `hooks/config/schema.ts`. Allowlist entries are exact strings or fingerprints, never regexes.
- [x] Gollum runs with every model member disabled and in shadow mode (§13, §22). Bypass skips it, as it skips every step (§4 step 1).
- [x] Tests (§19 Gollum): high and low findings, redaction in dialog, refusal, audit and prompt, allowlist honoured, allowlist written only on confirm.

### Galadriel: `hooks/members/galadriel.ts` (pure plan) + register.ts runner
- [x] A **fixed table in code**: for a part's verb, which read-only inspections to run, as argv with the call's targets passed as data after `--`. Never run the proposed command or any part of it.
  - rm, find -delete: count and list targets via `$.fs.stat`/`$.fs.list` (no process), capped.
  - git push: `git rev-parse --abbrev-ref HEAD`, `git remote get-url <remote>`, `git log --oneline <remote>/<branch>..HEAD` (capped).
  - git reset, rebase: `git log --oneline -n 20`, `git status --porcelain`.
  - Edit, Write: `git diff --stat -- <path>`, and whether the file is tracked (`git ls-files --error-unmatch -- <path>`).
- [x] `$.process.run(argv, { cwd: root, timeoutMs: 5000 })`; failures and timeouts give "no preview". **No preview is never a reason to allow or block.**
- [x] Output truncated to the preview line limit. Add a `previewLines` userConfig option (default 80).
- [x] Gandalf's prompt already accepts `preview`; pass it, and show it in escalations.
- [x] Tests (§19 Galadriel): never runs the proposed command (assert the `process.run` argv), timeout gives no preview, and inspections are built only from the table.

### Operation keys, rounds, wipes, lockout, cache: `hooks/elrond/operations.ts` (pure)
- [x] `operationKeyOf(call, classification, context)` per decision 11; `verbKeyOf` for the coarse counter.
- [x] Extend `CouncilSession` (`types/index.d.ts` + `hooks/state.ts`) with:
  - `ops: Record<key, { rounds, wipes, lockedOut, awaitingUser }>`;
  - `verbWipes: Record<verb, number>`;
  - `cache: { epoch, fingerprints[] }`;
  - `shadow`, and `models` (session switches).

  Bump `v` to 2 (`sessionOf` resets an old shape).
- [x] **Rounds:** each review verdict on a key is one round. After 2 non-approve rounds, escalate, with no model call until the user answers. A typed instruction resets that key's rounds.
- [x] **Wipes:** block, revise, keep blocked (including dismiss and nobody-to-ask, per decision 4), a gated call that ran and errored (`toolErrorsAreWipes` userConfig, default on), and the person's refusal at Claude Code's own prompt (decision 12). At 3 wipes on a key, lock out: refuse, and tell Claude to stop retrying, summarise what failed and propose another approach. A successful approved call resets its own key. `resetForPrompt` clears rounds, wipes, lockouts and the cache.
- [x] **Cache:** an approve for an identical fingerprint is reused within the same turn (key on `turn.start`'s `turnId`, or `promptEpoch` if subagent turns complicate it). Never cache block or revise.
- [x] Refusals now include **rounds left** (`Refusal.roundsLeft` already exists) and the lockout message. Audit lines carry `opKey`.
- [x] Tests (§19 Rounds, Wipes, Cache): 2-round cap and escalation, including a **rephrased retry** (different fingerprint, same key); wipe counting; lockout; reset on a new prompt; reset on success; approve reused; block not reused.

### Commands: register.ts (`session.start` registers, `command.run` answers)
- [x] One command, `/council`, with `argumentHint`; parse `e.args` in a pure `hooks/elrond/commands.ts`. Registration can reject (32-command cap), so catch and log it.
- [x] Subcommands:
  - `/council`: status (members enabled, mode, per-member counts, wipes, tokens spent, median review time; add `reviewMs[]` to state).
  - `off` / `on`: bypass. Session only; never persisted.
  - `shadow on|off`.
  - `log`: the last N verdicts, from the audit log.
  - `rules`: effective rules and their source, `shipped` or `project`; `CompiledRule.source` already exists.
  - `test "<command>"`: run `classify` only, then show tier, rule, member and profile. **Runs nothing.**
  - `model [<member> <model> [--save]]`: decision 2.
  - `reload`: decision 9.
  - `report` comes in stage 5.
- [x] Output per decision 1: return `{}`, draw in a pane (`$.ui.open` from the command is "asked", so it seats at any width; it needs a `ui.render` hook on `Pane`), and fall back to `$.ui.log` lines.
- [x] **Indicator** while bypass or shadow is on (SPEC §13, §17): a `ui.render` hook on `SessionMode` adding a label (terminal + desktop), plus `$.ui.status` elsewhere. Plain labels now ("council: bypass", "council: shadow"), themed in stage 6 ("Leeroy mode").
- [x] Tests (§19 Commands, Modes): `/council test` runs nothing (no `process.run`, no `tool.call` reaches the bottom); bypass passes gated calls and logs them; shadow logs verdicts and never blocks, while rules, protected paths and Gollum still enforce.

### Shadow mode
- [x] `shadowMode` userConfig (boolean, default off) plus the session toggle.
- [x] Model verdicts are logged with `shadow: true` and never refuse. Escalations caused by model failures also pass in shadow (logged), since only the second opinion is shadowed. Block tier, ask tier, protected paths and Gollum still enforce.
- [x] First-run toast (decision 6).

### Also in stage 2
- [x] `$.ui.notice` on "allow once" (decision 10).
- [x] Bypass is only settable by command now; the stage 1 bypass branch already logs to debug. Add the indicator.

---

## Stage 3: Legolas and Aragorn, with routing ✅

- [x] **Routing** (`hooks/elrond/routing.ts`, pure): `classification.decided.member/profile` → member; disabled or missing → Gandalf (fallback); Gandalf disabled → escalate. Also: parts naming different members → Gandalf; Legolas named for a call with no file → Gandalf; Aragorn without a profile → git for `git`, else database (DESIGN §7.1–2).
- [x] **Legolas** (`hooks/members/legolas.ts`): diff from the call's arguments.
  - Edit: a hunk from `old_string` → `new_string` with surrounding file context via `$.fs.read`.
  - Write: current file (if any) vs `content`.
  - NotebookEdit: the cell source.
  - Truncate to a diff line limit (`diffLines` option).
  - Checklist (§5): matches the request, scope creep or unrelated files, deleted or weakened tests, disabled checks, unexpected dependency, CI or config changes, obvious breakage. **No style review.**
- [x] **Aragorn, git profile** (`hooks/members/aragorn.ts`): command plus Galadriel's git preview (branch, remote, commits to be sent) plus the latest prompt. Checklist: protected target branch, force flags, rewriting pushed history, unrelated commits.
- [x] **Aragorn, database profile:** command plus migration or SQL content (truncated; read migration files named in the call, or heredoc and `-c` SQL). Checklist: rollback path, destructive DDL, UPDATE or DELETE without WHERE, production-looking target (config patterns), transaction wrapping, long locks on large tables. Separate system prompt per profile.
- [x] `userConfig`: `legolasEnabled`, `legolasModel`, `aragornEnabled`, `aragornModel` (same picker options as Gandalf), plus `diffLines`; `CONFIG_ROWS` has their rows, so `--save` works for them.
- [x] Generalise `reviewByGandalf` into one top-level `review($, brief, model, deadline, signal)` in register.ts; the `Brief` (`members/brief.ts`) carries member, profile and context together. Members only supply `system(nonce)` and `prompt(context, nonce)`.
- [x] Tests (§19 Routing, Model members): each member and profile gets its triggers, with Gandalf as fallback; approve, revise and block for each member (`tests/routing.test.ts`, `tests/members.test.ts`).
- [x] `/council` status lists all three members; `/council test` names the routed member, profile and any fallback.
- [ ] Optional, **not run yet** (a 1.0 item: "Decisions on the open items" and "Before 1.0" below): a ~40-case labelled eval (destructive vs harmless commands, test-weakening diffs, SQL without WHERE, injection attempts inside diffs) run live against the default models, to confirm prompt quality.

## Stage 4: full council with Gimli ✅

- [x] **Big operations** in `rules.json` (`bigOperations`: rule ids, `/regex/flags` command patterns, or the check `merge-to-protected`). Default: git push, merge to a protected branch, migrations (`elrond/council.ts`, validated in `config/schema.ts`). `councilEnabled` in `/config` turns the council off.
- [x] All enabled model members with something to review sit **in parallel** on the `council` model slot (default `opus`), under one shared deadline passed as each call's remaining `timeoutMs` (read with `$.clock.now()`, never a timer). Gimli runs alongside on its own timeouts (decision 3). Sequential fallback (stop at first block) behind `councilSequential`. Each seat's brief comes from the shared `briefOf`; Legolas reviews a push's or merge's range diff (DESIGN §8.3).
- [x] **Combine** (`hooks/elrond/combine.ts`, pure): strictest wins; reasons labelled per member; a member error, timeout or malformed verdict is that member's block; a Gimli failure is a block. Blocked only for want of verdicts escalates to the user (DESIGN §8.6). Members never see each other's verdicts.
- [x] **Gimli** (`hooks/members/gimli.ts` + `runCheck` in register.ts): only `gimli.commands: [{ name, argv, timeoutMs }]` from `rules.json`; pass or fail by exit code; the last 20 lines (redacted) for Claude, none in the audit log. `$.process.spawn`, a `$.clock.after` timeout (fact 14); Esc kills it; a member's block stops it.
- [x] Gimli's commands live in `rules.json`, which is protected, so Claude can't add commands without the user's approval.
- [x] `councilModel` `/config` row in `CONFIG_ROWS` and `settingsModel`, so `/council model council … --save` works. `/council` status shows the council and the checks; `/council test` names the council, its seats, model and checks.
- [x] Tests (§19 Full council, Gimli) in `tests/council.test.ts`: strictest wins, one member failing, Gimli failing, shared deadline (`mock.clock`, parallel and sequential), only configured commands run, Gimli timeout, a block stopping a running check.
- [x] Live headless check (`claude -p --plugin-dir`, throwaway repo): a push with a failing check was refused by the checks with its tail (2 Opus members approving, 1,860 tokens, 1.8 s; the diff reviewer sat out, as the branch was new); a push to an existing remote branch was approved by all three in about 2 s (3,042 tokens) and ran.

## Stage 5: suggestions and `/council report` ✅

- [x] **After "allow once"**, once the call ran, offer an allow rule for it (`hooks/elrond/suggest.ts`, pure; `offerRule` in register.ts). The dialog shows the exact JSON; "Add the rule" writes it to `rules.json` and reloads; "Not now" or dismissing declines it for the session (`declinedRules`, session shape v3). **Never** for block-tier matches, protected paths, any secrets finding, scripts, expanding words, multi-line or long commands (DESIGN §9.1–4).
  - The rule is as narrow as the call: `command` anchors the gated part's core, and `input` pins the whole command text, so `sudo`, redirects and chained commands can't ride on it. It is offered only if classifying the call again with it in place gives `allow`.
- [x] Allowlist suggestions for low secrets: already confirm-then-write since stage 2; they now share the writer (DESIGN §9.7).
- [x] Writing `rules.json` safely: `editOverrides` in `config/write.ts` (read fresh, validate before and after with `validateOverrides`, pretty-print, key order kept, a broken file never rewritten).
- [x] **`/council report`** (`hooks/elrond/report.ts`, pure over `audit.jsonl.2`, `.1` and the current file): most-refused rules and operations, with who refused; calls stopped then allowed by you; shadow verdicts that would have refused; tokens per reviewer (full councils by `council.voices[].tokens`) and median review time (the new `reviewMs` audit field).
- [x] Tests (`tests/suggest.test.ts`, `tests/report.test.ts`): written only on "Add the rule" (with the exact JSON shown), declined not re-offered, never for block, protected or secrets findings, nothing rides on the rule (sudo, redirect, chained, other targets), a broken file left alone; the report over rotated files, council lines, shadow lines, unparseable lines, an unreadable file, and what the mod itself logs. Mutation-checked: removing the command pin or the confirm fails tests.
- [x] Live headless check: a reviewed `rm -r build` logged `reviewMs` (1.2 s, 840 tokens), and `/council report` read it back as `ui_log` lines only.

## Stage 6: theme, then UI (SPEC §17, in this order; drop what the API can't do)

- [x] **Theme strings:** add `themed` variants in `hooks/strings.ts`; a `plainMode` userConfig option (default off, i.e. themed). Themed messages: one line of flavour, then the plain reason and the safer alternative. Gandalf's block: "You shall not pass" style. Bypass is themed "Leeroy mode", and the escalation dialog is the "loot roll". Member names become the theme names (`who.*` entries).
- [x] **Debate pane:** `Pane` showing the proposal (the call) beside the reviewing member's verdict; reads `$.state`. Opened unasked only from 144 columns; `/council` opens it at any width. *(Done: the pane is its own id, `council-debate`, a tab beside `/council`'s; `/council debate` opens it at any width; it draws per `view.agentId`; DESIGN §11.7-10.)*
- [x] **Council check:** for big operations, a ready-check row per member (tick or cross) in the `AbovePrompt` band (terminal + desktop). *(Done: a row per member and per check while a full council sits; each symbol has a word.)*
- [x] **Wipe counter** in the band or the pane. *(Done: in the pane only, so the band takes no row all session.)*
- [x] **Threat meter:** blocks per member (pane). *(Done: a bar of up to ten blocks with the number as text.)*
- [x] **Loot roll:** themed escalation text and labels (and optionally a `ui.render` hook on `AskUserQuestion`; a rewrite must still fit the tool's schema). The optional ui.render hook is dropped (review §5 item 5).
- [x] **Epic drop:** after a merge or push succeeds following a passed council check, a short magenta band row plus a toast saying "Legendary commit acquired", cleared by `$.clock.after`. No flash primitive exists. Cosmetic only. *(Done: themed mode only; the row hides itself by `epicUntil` in state, and the timer is only a redraw trigger, since a hot reload cancels timers.)*
- [x] Degrade cleanly: no colour dependence, and nothing drawn where nothing draws (VS Code, `-p`, SDK, cloud). *(Done: every symbol has a word; the pane is raised on every surface and the band on terminal and desktop, per the types; `/council debate` logs where nothing places it. Whether VS Code paints the pane is a live check.)*
- [x] Tests: plain mode shows no theme text anywhere (extend the stage 1 test to every string and every drawn tree); mount UI through `$.ui.mount` on both `'terminal'` and `'desktop'`. *(Done: `tests/view.test.ts` and `tests/debate.test.ts`; the pane is mounted on terminal, desktop, VS Code and mobile, the band on terminal and desktop; three mutation checks recorded at the checkpoint.)*

## Final deliverables (SPEC §21–22)

- [x] README complete: *(done; a Modes section added, the rest was in place)*
  - loading (`--plugin-dir`, install);
  - editing rules with examples;
  - each mode and command;
  - **adding a member**;
  - expected token cost (update with stage 3–4 figures);
  - limits;
  - **glossary** of theme terms and plain names.
- [x] DESIGN.md: final `hooks:`/`calls:` lines, data flow, failure modes, and every decision. *(§2 re-run, §4 the re-entry row, §12)*
- [x] Definition of done (§22, with the end-of-Stage-5 review's amendments): *(evidence in DESIGN.md §12.2)*
  - [x] every §19 test passes, with a table in DESIGN.md mapping each §19 bullet to the test names that cover it ("fallback where nothing draws" and "no re-entry from the mod's own calls" each need a named owner test); *(DESIGN.md §12.3; owners in `tests/done.test.ts`)*
  - [x] in enforcing mode, no path where a gated call runs after a reviewer failure without the user's answer (shadow mode passes by design); *(tests/done.test.ts, mutation-checked)*
  - [x] no path where the mod approves ahead of the permission check: CI fails if `claude plugin validate` lists a `tool.check` hook, and a behavioural test shows `$.tool.check` resolves to exactly the engine's own decision (Stage 6, `tests/debate.test.ts`);
  - [x] plain mode shows no theme text: the string table, `/council` output, the dialog and the mounted pane and band trees (Stage 6);
  - [x] with every model member disabled, rules, Gollum and escalation still work; *(tests/done.test.ts, mutation-checked)*
  - [x] the README states the limits plainly.
- [ ] Live interactive check by the user in a terminal, screen by screen: the loot roll (Need, which must run the call, since the mod's own question could arrive at the hook's `.catch` as re-entry on 2.1.294; Pass; a typed instruction; "Talk first", after which `/council log` must show `decision: chat`; "Chat about this", which must show `decision: dismissed` and confirm DESIGN §12.4's reading of its rejection; dismiss) and its "allowed once" notice under Claude Code's prompt; the allow-rule offer after "allow once"; the secrets dialog with Greed and its confirm; the debate pane opening on its own at 144 columns and through `/council debate` below that, with a subagent's review in its view; the ready-check band during a `git push` with a project check; the epic drop row and toast after an approved push; the `council: Leeroy mode` and `council: shadow` labels; every `/council` subcommand in its pane; plain mode on the same screens; and whether VS Code paints the pane.

## Known follow-ups

### Decisions on the open items (after the final deliverables)

| Item | Recommendation |
| :- | :- |
| `.catch` and re-entry (2.1.294) | Half settled live (DESIGN §12.1): a subagent's gated calls are reviewed, in the background and the foreground, not refused. **Terminal check:** whether the mod's own `AskUserQuestion` arrives as re-entry ("Allow once" must still run the call). If it does, pass exactly that through (a guard on the tool name and the pending ask) and keep refusing every other re-entry. |
| The ~40-case live eval | **Before 1.0, not before 0.6.0.** A `claude plugin eval` suite under `mods/council-of-elrond/evals/` (destructive vs harmless commands, test-weakening diffs, SQL without WHERE, injections inside diffs, plus a council set), about 40 to 120 reviews at about 1,000 tokens each, run once after the prompts are final, results in DESIGN.md, out of CI. A definition-of-done item for 1.0 (below). |
| Live UI checks (stages 2 to 6) | **Terminal check:** the one screen-by-screen pass above, once, before 0.6.0. |
| Prompt-refusal wording | The third automatic-denial wording, "This command requires approval" (a `git push` in `-p` on 2.1.294), is now recognised (DESIGN §6.14). Settled without a terminal on 2.1.296 (DESIGN §12.4): both user-refusal wordings are in the binary unchanged and matched, and the deny-rule wordings for editing and reading a file are now recognised too. |
| A new branch's push has no range | Done (DESIGN §13.1): a fixed fallback against `<remote>/HEAD` when the push names a remote; it needs `<remote>/HEAD`, which `git clone` sets and `git remote add` does not. |
| Scan allowed calls for secrets | Do it for high-confidence findings only (refuse), never asking on an allowed call. The cost is a pattern scan of the command text. A literal token in an allowed `curl` used to reach the network unscanned. Behaviour change: 0.6.0. Done (DESIGN §13.2). |
| An `exact` field in the rule schema | Declined. The `input` pin works and is tested; add the field only if someone hand-editing `rules.json` asks. |
| The allow-rule offer after every "allow once" | Wait for feedback from real use. If it is noisy, a `/config` switch for the offer is the smallest change. |
| An allow rule pins text, not the folder | Documented (README, "What it does not protect against"); pinning the cwd needs a schema change, declined. |
| Migration tools' own files | Deferred; the gap is named in the README. Per-tool lookups (Prisma first) only on request. |
| Review time per council member | Dropped: the sitting's time is what the user waits for. |
| `auditMaxKb` above 4,096 | Nothing to do: the `/config` row's `max` is 3072, under the 4 MiB read cap. |
| The council's cost (about 3 Opus reviews per push) | Default kept; the README's cost section names the knobs. |
| `isReadOnly` unused | Left unused: trusting it to skip work would let the tool's own claim lower the gate. |
| `$.ui.ask` in SDK and cloud hosts | Left as is: the mod refuses where no surface is attached, which is the safe default. The terminal check covers the terminal only. |
| Windows | Declared unsupported in `docs/INSTALL.md` (POSIX shells, `HOME` only). |
| Versioning | Release as **0.6.0** once the terminal check passes: the default text changed, allowed calls are scanned, and a push's range changed, each a behaviour change under a minor bump. Move the `[Unreleased]` entries to `[0.6.0]` and bump `plugin.json` then, not before. Approved 2026-10-13: 0.6.0 also carries H1 and H2, and the terminal check runs on that build; C2 to C6 and H3 go to 0.7.0 ("Recommendations on the remaining open decisions" below). |

Also decided after the final deliverables: the fake secrets in tests are built at run time from two halves (`tests/fixtures.ts`), so no committed line holds a well-formed token and `scripts/check-hygiene.sh` reports none; the audit appender's whole-file re-read stays (tens of milliseconds at 1 MiB; revisit only if latency shows).

### Recommendations on the remaining open decisions (2026-10-13)

**The user approved every recommendation below on 2026-10-13 ("All of them accepted"), so they
are binding, like the approved decisions above.** They cover every item the table above leaves open, the cloud work items' own open choices,
and the end-of-Stage-5 review items that are still open. A sweep of the code on 2026-10-13
checked which review items are still present. **It found that the review's banner was wrong** (it is corrected in this change): most of
§2.5 to §2.11 and §3.1 to §3.9 were never fixed. 0.5.0 fixed the parser, the rules and part of
the pipeline (DESIGN.md §10), and the CHANGELOG never claimed the rest. The items still present
are grouped below into three hardening briefs, H1 to H3.

**Recommended order of the next pull requests.**

1. **Regenerate the types for Claude Code 2.1.296** (`/upgrade-types`) before any code changes,
   since the vendored types are 2.1.294. Its step 5 re-reads the two user-refusal wordings from the
   binary, which settles that terminal-check item without a terminal. Also grep the binary for the
   "Chat about this" rejection message that `interpretRejection` matches. *(Done: types are
   2.1.296's, drift additive, DESIGN.md header. The refusal wordings are unchanged; two deny-rule
   wordings were added. The "Chat about this" match was wrong, DESIGN §12.4; decision 4 is
   amended and the dialog has its own "Talk first" option.)*
2. **H1, the secrets scan and protected paths** (below). It ships in 0.6.0, since 0.6.0 already
   changes what the scan refuses. *(Done: every H1 row, the C5 `**/` prefixes, `db/migrate/**`
   included, and the allowlist-oracle note; decisions in DESIGN §13.3.)*
3. **H2, pipeline robustness** (below). Also in 0.6.0. *(Done: every H2 row but the
   `$.ui.status` one, which went to C2 and is done there; decisions in DESIGN §13.4,
   [Deluha/council-of-elrond#19](https://github.com/Deluha/council-of-elrond/pull/19).)*
4. **C2**, which needs no cloud run and helps whatever C3 shows. Then **C3** once the maintainer
   can run the cloud probe, then **C4** if C3 calls for it, then **C5** and **C6**.
5. **H3, review accuracy** (below).
6. **Release.** 0.6.0 is H1 and H2 on top of what `[Unreleased]` holds now, after the terminal
   check on that build. C2 to C6 and H3 go to 0.7.0, so the terminal check is not redone for
   cloud-only work.

**The cloud work items' open choices.**

| Item | Recommendation |
| :- | :- |
| C3, how the probe ships | Run it from a throwaway branch that is never merged. Ship no `cloudAsk` option: an ask with no timeout can hold a call indefinitely, so it should not exist in a release, even off by default. Have the probe also log the origin kinds (`PromptOrigin`) that the web client's prompts and `/council` commands arrive with. C4 and H2's origin check both need them. |
| C4, which prompts may approve | Accept `council allow` and `council deny` only as a whole line, and only from a person's origin: `composer`, `bridge`, and whatever kind C3 shows for the web client. Never accept them from `peer`, `peer-send-message`, `plugin` (`asUser` included), `channel`, `scheduled-trigger`, `task-notification`, `coordinator`, `observer`, `auto-continuation` or `unclassified`: each of those can carry text that no person typed. |
| C4, the `session` allowance | Limit it the way the allow-rule offer is limited: never for a script, an expanding word, a multi-line or long command, a block rule, a protected path or any secrets finding. It stands in for that offer, so it should not reach further. |
| C5, where a rules file may sit | Only at the top of a repository (a folder holding `.git`) directly below the session root, never at an arbitrary depth. Otherwise a planted file in any subfolder could set rules, models or `gimli.commands` for the calls beneath it. |
| C5, protected paths | The shipped entries `.git/**`, `.github/workflows/**`, `.gitlab-ci.yml`, `.circleci/**`, `.buildkite/**`, `.claude/council-of-elrond/**`, `.claude/settings.json` and `.claude/settings.local.json` are anchored at the session root. Prefix them with `**/` in H1, ahead of C5, so they hold in every repository below a multi-repository root. That includes a rules file at any depth. |

**H1: the secrets scan and protected paths** (one implementer brief; behaviour change, 0.6.0).

| Review item | Recommendation |
| :- | :- |
| §3.1 compound names (`DB_PASSWORD=…`, `PGPASSWORD=…`, `GITHUB_TOKEN=…`) | Let the assignment pattern take a name prefix ending in `_` or the keyword itself, keeping it a low finding (it asks). Today `\b` fails inside the name, so these pass unscanned. |
| §3.5 formats | High only for exact, fixed vendor formats (`glpat-`, `npm_`, `GOCSPX-`, Slack webhook URLs, the PGP private-key block): a high finding now refuses allowed calls too, so a loose high pattern would refuse ordinary work. Low for JWTs, `Authorization: Basic/Bearer` headers, `mysql -p<password>` and a connection string with an empty user. |
| §3.6 redaction blanks code | Share Gollum's placeholder test with `redact()` for low patterns, so `process.env.X`, type annotations and indexing stay in the reviewer's diff. Add the idempotence test DESIGN §6.15 claims. |
| §3.8 `LONG_TOKEN` defined twice | Keep one copy, in `redact.ts`. |
| Protected paths anchored at the root | The `**/` prefixes above, with a test per entry in a nested repository. |

**H2: pipeline robustness** (one implementer brief; DESIGN §4 rows and notes in the same brief). *(Done, DESIGN §13.4.)*

| Review item | Recommendation |
| :- | :- |
| §2.9 `command.run` origin | Require a person's origin (the C4 list) for the subcommands that loosen the gate: `off`, `shadow on`, `model`. Others answer any origin. Until C3 names the web client's kind, `sdk` counts as a person's. *(C3 named it `composer`; `sdk` dropped 2026-10-20, DESIGN §14.3.)* |
| §2.6 checks outlive a throw | `stop.abort()` in a `finally` in `convene`, and chain the dispatch signal into `stop`. |
| §2.7 rotation by characters | Compare UTF-8 bytes, as `appendPlan` does, and test rotation to `.2` with multibyte text. |
| §2.7 a hanging audit write stalls later calls | Stop awaiting the queue in `finish()` and keep its catch, so the line is still written in order. The brief first checks in the test kit that a `$.fs.write` still lands after the hook returned; if it does not, it stops and reports. |
| §2.7 two sessions on one log | Document only (README limits, DESIGN §4): `$.fs` has no lock, and the report already skips unparseable lines. |
| §2.5 one state snapshot per call | Re-read the session just before the lockout and token-budget checks, which a parallel call can overshoot. Document last-reader-wins for the cache and rounds in a new DESIGN "Concurrency model" note. |
| §2.8 eager work | Build `shownCall` lazily, only on the paths that show it. No caps until latency shows. The new DESIGN "Performance notes" record this and that render hooks only read state. |
| §2.9 a failed allowlist write counts as a failed attempt | Not a failed attempt: the failure is the mod's, not Claude's. |
| §2.9 `sessionOf` checks only the version | Validate the shape and fall back to `INITIAL_SESSION` with a debug line. Today a malformed value denies every call until `/clear`. |
| §2.9 `Date.now()` | Use `$.clock.now()` throughout. |
| §2.9 literals outside `strings.ts` | Move the command's description, argument hint and the audit-write-failed line into `strings.ts` (a CLAUDE.md rule). |
| §2.9 `$.ui.status` never cleared | Fold into C2, which reworks what shows where nothing draws. *(Done in C2, DESIGN §13.5 f: the status is cleared when no other surface is left, and `session.detach` and `session.attach` hooks sync it.)* |
| §2.10 DESIGN §4 rows | Rewrite "Esc during a council", "Writing the allowlist fails" and "Audit write fails", and add a row for `$.session.root`/`cwd` failing (denies every call, allow tier included: keep it, as it is fail-closed). |
| §2.11 test gaps | Add a test with each fix above. Add the `.catch` replay after `next` ran, a prompt during an in-flight review, Esc mid-review and mid-council, `/council reload` clearing the cache, and a malformed session. Skip the `proceed()` budget-guard test unless the kit can set `remainingMs`. |

**H3: review accuracy** (one implementer brief; behaviour changes under 0.7.0).

| Review item | Recommendation |
| :- | :- |
| §2.9 an `Edit` with an `edits` array | Apply every edit in order in the diff builder, so the diff reviewer sees the whole change, not an empty diff. |
| §3.7 git previews and a part's cwd or `GIT_DIR` | Skip the git inspections when the part's cwd is outside the root or an assignment sets `GIT_DIR` or `GIT_WORK_TREE`, and pass an inside cwd through. Read `-o`, `--push-option` and `--receive-pack` values as values, not the remote. |
| §3.7 nits | `--no-ext-diff` on `git diff --stat`, and `core.fsmonitor` switched off in the inspections' git environment, so a preview never starts a configured program. |
| §3.4 operation keys | Skip the value of `psql -c`, and remove `-n` from the value-taking options. Key a redirect write on the written file. Read `git push origin HEAD` as the current branch. Name alternating verbs on one target in the README's "Known gaps". |
| §3.8 diff builder | Use `-0,0` for a new file (fix the test that pins `-1,0`), strip `\r` from CRLF lines, and show "\ No newline at end of file". |
| §3.8 routing | A mixed call with Gandalf off keeps coming to the user (the safer choice); say so in DESIGN §7.1. Check `disabled` before `no-diff`. |
| §3.8 verdict parser | Cap `safer_alternative` like the reason. A missing one on an approve stays accepted; fix the comment that says otherwise. |
| §3.8 database | Add `sqlite3` to the client options. A `.sql` file's content stays out of the block rules (classification reads no files); name it in "Known gaps". |
| §3.8 the report | A council line with malformed `voices` adds no cost, rather than counting under a member named `council`. |
| §3.8 `unquote` | Drop it where the parser already removed quotes, with a test that keys are unchanged. |

**The Stage 5 review's remaining decisions** (the "Before 1.0" list below).

| Item | Recommendation |
| :- | :- |
| Performance notes and the concurrency model | Write both in H2, where the related code changes (§2.5, §2.8). |
| The `register.ts` reducer refactor (now 1,635 lines) | After 1.0, not before. Until then, new decisions (C4's allowance, H2's origin check) land as pure functions in sibling modules, so register.ts gains effects only. |
| The two-session audit race | Document only (H2). |
| The allowlist-oracle note | Add it in H1: a README note that a `sha256:` fingerprint of a short password can be guessed offline, so the allowlist is for keys, not passwords. Add one line in the confirm dialog for assignment findings (`strings.ts`). |

**Approved after the H1 checkpoint (2026-10-13).** The user approved the seven decisions H1 took
beyond this table (DESIGN §13.3) with these changes: redaction uses its own, narrower test of
plainly-code values (a variable, a call, a dotted path, an indexed lookup, a type word), so a
value the scan does not flag, such as an all-letter word, is still redacted; indexing is not a
placeholder to the scan; the password warning follows a `kind` on each secret pattern
(`password` or `token`, settable in `gollum.patterns`); one timing test covers every shipped
pattern; the compound-name prefix is capped at 64 characters. Also approved, as a standing rule
(CLAUDE.md): a decision the roadmap does not cover that loosens the gate goes to the user before
it is committed; one that tightens it is decided, recorded and reported.

### Before 1.0

- [ ] The ~40-case live eval (above), recorded in DESIGN.md: a definition-of-done item for 1.0.
- [ ] Cloud sessions: the setup-script install was tried and the mod loads and enforces (findings below, "Cloud sessions"); it is recorded in DESIGN.md §14 (C1); the `$.ui.ask` probe (C3) is done (DESIGN §14.1). Repository settings do not load plugins in the cloud (docs/INSTALL.md, "Cloud sessions").
- [ ] A `/config` switch for the allow-rule offer, only if feedback says the offer is noisy.
- [ ] The terminal-check item above resolved: the `AskUserQuestion` re-entry path. (The user-refusal wordings were settled against the 2.1.296 binary, DESIGN §12.4.)
- [ ] Still open from the Stage 5 review (docs/REVIEW-2026-10.md §5 and §7 D), decided 2026-10-13: only the `register.ts` reducer refactor, which comes after 1.0. The performance notes, the concurrency model and the two-session audit race were done in H2 (DESIGN §13.4), the allowlist-oracle note in H1 (DESIGN §13.3). H3 is the review item still open in the code, under "Recommendations on the remaining open decisions" above.
- [ ] The cloud-session work items C3 to C6 below (C1 and C2 are done), in the order given under "Recommendations on the remaining open decisions".

### Cloud sessions: findings and work items

The first real use of the mod in a cloud session (Claude Code on the web, two repositories in one
environment, the mod installed by the environment's setup script at a pinned ref) found it loaded
and enforcing, but silent and unable to ask. The findings below come from that session's engine
debug log and from the 2.1.294 types; the items are written so a dev session can take each one
cold. Each is one brief with its own tests; C1 and C5 are documentation only.

**What the session showed.**

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

**Work items.** C2 and C4 change a recorded design decision; the user approved both on
2026-10-13 ("I approve roadmap items C2 and C4"), so every item follows the usual loop.

- [x] **C1. Record the cloud trial.** DESIGN.md gains a "Cloud sessions" subsection with the table above; docs/INSTALL.md "Cloud sessions" replaces "not confirmed" with the working recipe (setup script, pinned ref, loads at start, no restart) and a ready-made snippet that also writes the plugin's options to the user settings (`shadowMode` for a rollout, models, budget), since project settings are not read; docs/MAINTENANCE.md "Supported hosts" lists the cloud as tested, enforcing and non-drawing. Documentation only; `scribe`-sized once the wording is dictated. *(Done: DESIGN.md §14; the install recipe and its option keys checked against the CLI there.)*
- [x] **C2. Speak through Claude where nothing draws.** *(Done, DESIGN §13.5: the four subcommands for a person's command, the start notice, the refusal; the H2 status row with it. Checked live in `-p` on 2.1.299 (DESIGN §13.5 h): the notice, the plain context, Claude relaying it at the next prompt, the refusal. Not checked live: the cloud web client, and the roster timing of `session.detach`.)* Command output never reaches Claude (a stage 2 decision); this is a scoped exception, approved 2026-10-13. When `$.session.surfaces()` is empty: `/council` (status, report, rules, test) also returns its lines as the `command.run` result's `context`, prefixed with an instruction to relay them verbatim; the session-start notice is appended as a model-readable row (`$.session.append`, `type: "user"`) saying the council is active and how to approve a call (C4); and the `nobodyToAsk` refusal names the refused operation, the rule or reviewer behind it, and the approval route. Never the secrets preview or a diff. Tests: the fixtures' `session.surfaces` answers `[]`, and the command result carries `context`; with a surface it carries none. Strings in `strings.ts`; README under "Where nothing draws"; CHANGELOG.
- [x] **C3. Probe `$.ui.ask` in a cloud session.** *(Done 2026-10-19, DESIGN §14.1: the host answered the ask in Auto mode without the person, so asking where nothing draws is ruled out and `escalate` is unchanged; C4 is needed; the web client's prompts arrive as `composer`.)* A branch with a `cloudAsk` option (default off) that attempts the ask when surfaces is empty. The ask has no timeout today and the types give it none; a `$.clock` timer would count against the 10 s own-time budget (fact 3 above), so the probe runs without one and the hang risk is what it measures. Run it once in a throwaway cloud environment whose setup script installs that ref, with one gated call, and record in DESIGN.md: whether the web client shows the question, what the rejection's `message` is when it cannot, and how long it takes. If the client answers it, the surfaces guard in `escalate` becomes "no surface and no remote client" and C4 is a fallback only. If it rejects, `escalate` must map that message to `unavailable` (today every rejection is `dismissed`, a failed attempt).
- [ ] **C4. A chat approval route for hosts that cannot ask.** A typed approval stands in for the dialog, approved 2026-10-13. A refusal in the no-surface case carries a short fingerprint of the operation key (`council:xxxx`, six hex characters of the audit hash) that Claude relays. The person types `council allow xxxx` (one call) or `council allow xxxx session` (the session, like "allow once" and the allow-rule offer) in chat. The `prompt.submit` hook recognises the line, records the allowance in `$.state` through `state.ts`, answers with a model-readable acknowledgement, and strips the line from the prompt. The next gated call with that fingerprint runs, audited as decided by the user via chat; the allowance is spent on use and at the next prompt. It never applies to a high-confidence secrets find, a block rule or a protected path (the same limits as the dialog), and `council deny xxxx` records a refusal with no failed attempt (a `chat` outcome). Tests: a refusal carries the fingerprint; the prompt line is parsed (and `council allow` with no fingerprint, or an unknown one, is answered and not stored); the allowed call runs once; a block rule still refuses; the allowance is gone after the next prompt. README section; CHANGELOG. Skipped if C3 shows the client answers the dialog. *(C3: needed, DESIGN §14.1. Step 1, `decider` on `tool.check`, probed headless (DESIGN §14.2): it holds against every machine inside the engine but the host. Pending: a cloud run, the maintainer's decision on what it changes here (`sdk` was dropped from `HUMAN_ORIGINS`, DESIGN §14.3).)*
- [ ] **C5. Rules-file discovery in a multi-root environment.** When the session root holds no `rules.json`, resolve it per call: from the call's target (a file tool's path, a shell command's cwd) walk up to the nearest `.claude/council-of-elrond/rules.json` below the root; none found, use the root's defaults. `protectedPaths`, `productionPatterns` and `gimli.commands` then resolve against that file's directory, and the project checks run with it as cwd. One cache entry per directory, invalidated by `/council reload`. The audit log path, when relative, resolves the same way, so it lands in the repository. Until this ships, docs/INSTALL.md says: one repository per cloud environment, and never one that holds the mod's own checkout (that session would be gated by the mod it develops, against the rule above). Tests: a fixture root with two repositories, a rules file in one; a file edit in each resolves the right rules; a shell command under the second gets the root's defaults.
- [ ] **C6. Small things seen in the log.** `$.session.surfaces()` never rejects (the types), so the `.catch(() => [])` wrappers in register.ts are dead; drop them. The three project checks of a typical rules file need the repository's toolchain on the PATH: once C5 lands, run one live cloud check that a check with a missing binary reports "failed" with the error, not a hang.

Order (approved 2026-10-13, replacing C1, C3, C2, C4, C5, C6): C1 (done), C2, C3 (its result decides C4), C4, C5, C6. The full sequence of pull requests is under "Recommendations on the remaining open decisions".

The per-stage lists below are the follow-ups as each stage left them. The table above decides
every one that was still open; a struck item was done in the stage named. They stay for the
reasoning they carry.

From the 2.1.294 types (Stage 6):
- **`.catch` and re-entry.** 2.1.294 asks a hook's `.catch` handler, with `next.error.kind === 're-entry'` and `next.called` false, when the engine skips the hook because the event was raised beneath its own frame. Elrond's handler then refuses (fails closed). Verify live, in a terminal, that an escalation's "Allow once" still runs the call (the mod's own `$.ui.ask` must not be refused this way), and that a subagent's gated calls are still reviewed rather than refused. Only then decide whether the handler should pass the mod's own `AskUserQuestion` through. The subagent half is verified (DESIGN §12.1).

From stage 5:
- **Live UI check (user):** the allow-rule offer after "allow once" (it can't show in `-p`: nobody to ask), "Add the rule" then the same call passing silently, "Not now" not re-offered, and `/council report` in the pane, in a terminal.
- **The offer comes after every "allow once"** for a new pattern. "Not now" lasts the session only. If it's noisy, a persistent "never offer for this rule" list, or a `/config` switch for the offer, would be small additions.
- **An allow rule pins the command text, not the folder.** `rm -r build` added from the project root is also allowed after a `cd` in an earlier, separate call. A `cd x && …` in the same command is part of the pinned text.
- **Rules can't express "exact command" directly**, hence the `input` pattern over the call's JSON. A dedicated `exact` field in the rule schema would read better in `rules.json`; it's a schema change; declined (the table above).
- **Review time per council member** isn't recorded (the sitting's time is); the report shows each member's median from its single reviews only.
- **The report reads at most three 1 MiB files** in the hook's own time (fine: tens of milliseconds). An `auditMaxKb` above 4,096 would pass `$.fs.read`'s 4 MiB cap; the appender would fail first, as it reads the current file too.

From stage 4:
- ~~**A push of a branch the remote doesn't have yet** has no range: the diff reviewer sits out, and Galadriel shows no commits. Diffing against `<remote>/HEAD` (the remote's default branch) when it exists would cover the common case.~~ Done (DESIGN §13.1).
- ~~**Esc during any review** puts a question to the user after they pressed Esc~~ Done in 0.5.0 (DESIGN §10.9): Esc refuses plainly, with no failed attempt, round or dialog.
- **The council's cost.** Every push now costs about three Opus reviews (~3,000 tokens). If that's too much, the knobs are the `/config` council model, "Full council for big operations", or `disableRules`-style removal of a default entry (not offered: lists only add).
- **Live UI check (user):** the new `/config` rows (full council on/off, model, one at a time, project checks) and the council lines in `/council` and `/council test`, in a terminal.
- **The ~40-case live eval** is still not run (needs the user's go-ahead); a council-specific set (pushes of unrelated commits, migrations without rollback, failing checks) could join it.

From stage 3:
- **The ~40-case live eval** (Stage 3's optional item) has not been run; it needs the user's go-ahead for the tokens. Only a 3-call live smoke test ran (one per member and profile, all approve, ~1,000 tokens each).
- **Migration tools' own files aren't read.** The database reviewer sees inline SQL, heredocs and `.sql` files named in the command; `prisma migrate deploy`, `alembic upgrade` and the like don't name their files, so it sees the command only. Looking them up is tool-specific (and the migrations folders are protected paths, so a shell mention of them already asks).
- ~~Mixed compound commands go to Gandalf~~ Decided in stage 4 (DESIGN §8.9): one that contains a big operation goes to the full council; others stay with Gandalf.
- **Live UI check (user):** the new `/config` rows (Legolas and Aragorn enabled and model, diff line limit) in a terminal.

From stage 2:
- **Verify the prompt-refusal wording live** in a terminal. The patterns come from the 2.1.289 binary ("The user doesn't want to proceed with this tool use", "…take this action right now"); after a Claude Code update, re-check them (`grep -a` the binary) or a refusal reads as an ordinary tool error. The final live check found a third automatic wording, "This command requires approval" (DESIGN §12.1 item 4), now in `outcomeOf`. *(Re-checked against the 2.1.296 binary without a terminal: unchanged, DESIGN §12.4.)*
- **Live UI check in a terminal (user):** the `/council` pane, the `council: shadow` / `council: bypass` label, the "Council: you allowed this once" line under the permission dialog, the secrets dialog with three options and the allowlist confirm.
- ~~**Scan allowed calls too?** The secrets scan follows SPEC §4 and reads gated calls only (DESIGN §6.1). Scanning every call is cheap; it needs the user's say-so since it changes the pipeline order.~~ Done, high confidence only (DESIGN §13.2).
- **Plain-mode identifiers.** `/council` prints member ids such as `gandalf` where you type them (DESIGN §6.16); decided in stage 6: ids are config keys, not theme text (DESIGN §11.4).
- ~~`/config` has no model row for the full council~~ Added in stage 4.

From stage 1:
- ~~`interpretRejection` detects "Chat about this" by looking for `chat`~~ That word never reaches it (DESIGN §12.4). Decided 2026-10-13: the dialog has its own "Talk first" option (not a failed attempt), and "Chat about this" counts as a dismissal (decision 4, amended).
- `$.ui.ask` behaviour in SDK and cloud hosts is undocumented. If it can hang there, consider refusing when the only surfaces are remote ones. *(Cloud: the ask is never reached, as surfaces is empty there; probing it is C3 under "Cloud sessions" above.)*
- `isReadOnly` from `next(e)`'s result is unused. It could let Galadriel or the cache skip work.
- The audit appender re-reads the whole log per gated call (no append in `$.fs`). Fine at 1 MiB; revisit if latency shows.
