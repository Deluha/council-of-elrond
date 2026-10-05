# council-of-elrond: roadmap

How to finish the mod from where it stands, written so a new dev session can pick it up cold.

- **The spec:** [SPEC.md](./SPEC.md) (§ numbers below refer to it).
- **What exists and why:** [DESIGN.md](./DESIGN.md).
- **Decisions approved after the spec:** listed below; they win over the spec where they differ.

| Stage | Scope (SPEC §20) | Status |
| :- | :- | :- |
| 0 | Research, plan | ✅ Done ([DESIGN.md §1](./DESIGN.md)) |
| 1 | Elrond, rules, Gandalf, escalation, fail-closed paths, audit log (plain mode) | ✅ Done: [Deluha/council-of-elrond#1](https://github.com/Deluha/council-of-elrond/pull/1) |
| 2 | Gollum, Galadriel, operation keys, rounds, wipes, cache, commands, shadow mode | ✅ Done (one switch pending the open question below) |
| 3 | Legolas, Aragorn (git and database profiles), routing | ⬜ Next |
| 4 | Full council with Gimli | ⬜ |
| 5 | Rule and allowlist suggestions, `/council report` | ⬜ |
| 6 | Theme strings, then UI features in order | ⬜ |

**Stop at every checkpoint (SPEC §20).** At each one: tests pass, `tsc` passes, `claude plugin validate`
passes, and the user gets a short summary of what changed, the decisions the spec didn't cover, and
the known limits. Then wait for the go-ahead.

---

## Resuming: what to know first

### Commands

```
cd mods/council-of-elrond && claude plugin test .     # all tests (135 at the end of stage 2)
tsc -p mods                                           # strict typecheck against mods/types/claude-code.d.ts
claude plugin validate mods/council-of-elrond         # copy its hooks:/calls: lines into DESIGN.md §2
```

- **Check the Claude Code version.** Run `claude --version`; this was built on **2.1.289**. If it changed, regenerate the types by loading the `plugin-authoring` skill (it writes `types/claude-code.d.ts`), copy them over `mods/types/claude-code.d.ts`, rerun `tsc`, and note any API drift in DESIGN.md.
- **Keep the mod out of the session building it.** Don't load it into your own dev session (the skill's hot-reload folder, or `--plugin-dir` on the session you work in): it would gate your own tool calls.
- **Live checks run headless.** Use `claude -p --plugin-dir ./mods/council-of-elrond "<prompt>"` with harmless commands, ideally in a throwaway `git init` folder, then clean it up along with the generated `.claude-plugin/types/` and `tsconfig.json` in the mod folder. `/council` output only shows with `--output-format stream-json --verbose` (as `system/ui_log`).

### Hard-won API facts (verified by probes; details in DESIGN.md)

1. **Only `hooks/register.ts` may touch `$`.**
   - Passing `$` to an imported function fails validation.
   - `$`-taking helpers must be **top-level functions in register.ts**, not closures inside a hook.
   - All decisions live in pure sibling modules.
2. **A hook that overruns its 10 s own-time budget is not cut off.** Its own later `next(e)` still runs the call, and `.catch` didn't fire on overrun in the test kit.
   - Every pass-through goes through `proceed()` in register.ts, which refuses when `next.budget.remainingMs < 1000`.
   - Keep the hook's own (non-`$`) work small and bounded.
3. **`$` calls don't count against the budget; `$.clock.sleep/after/every` do.**
   - Bound model calls with `timeoutMs` and processes with `timeoutMs`.
   - Build a shared deadline by passing *remaining* time into each call's `timeoutMs`, never with a clock timer.
4. **In `.catch`:** if `next.called`, then `next(e)` replays the real result without re-running the call. Otherwise refuse.
5. **`$.ui.ask` is an `AskUserQuestion` tool call** that skips the calling hook but **not the plugin's other `tool.call` hooks**.
   - Keep exactly one `tool.call` hook.
   - It rejects on dismiss, on "Chat about this", and in `-p`.
   - Guard it with `$.session.surfaces()` (empty means nobody can be asked: refuse).
6. **Command output reaches Claude.** A command's `{ text }` is read by Claude (approved decision 1: don't put council internals there).
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
13. **Claude Code's own denial wording (verified in `-p`):** "`rm in '<path>' needs approval. … Claude Code asks before a shell command creates, changes or removes files there.`", returned as `isError: true`.

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

1. **Command output stays out of Claude's context.** `/council` subcommands draw in the pane where a surface draws, else `$.ui.log` (dim, not sent to the model). The `command.run` hook returns no Claude-readable text. This includes `/council off|on|shadow`. Verify where `ui.log` lines go in a plain `claude -p "/council report"` run.
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
   - "Chat about this" refuses, telling Claude to stop and ask, and is **not a wipe**.
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

Stage 2's own decisions (the ones the spec didn't cover) are in [DESIGN.md §6](./DESIGN.md).

### Open question for the user (asked at the start of stage 2, not yet answered)

- **Does a refusal at Claude Code's own permission prompt, after the council approved, count as a wipe?**
  - Built: such results are recorded as `outcome: "denied-by-permission"` (`isPermissionDenial` in `elrond/operations.ts`), apart from ordinary tool errors. The automatic `-p` wording is verified live; the interactive refusal wording is not.
  - Today they **don't** count (`PERMISSION_DENIALS_ARE_WIPES = false` in register.ts, fed to `WipePolicy.permissionDenials`).
  - Proposal: count the user's own refusal at the prompt (same as "keep blocked"); don't count an automatic denial where nobody could be asked. Building it means splitting `isPermissionDenial` into the two wordings and verifying the interactive one in a terminal.

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
- [x] **Wipes:** block, revise, keep blocked (including dismiss and nobody-to-ask, per decision 4), and a gated call that ran and errored (`toolErrorsAreWipes` userConfig, default on). Permission-check denials: see the open question. At 3 wipes on a key, lock out: refuse, and tell Claude to stop retrying, summarise what failed and propose another approach. A successful approved call resets its own key. `resetForPrompt` clears rounds, wipes, lockouts and the cache.
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

## Stage 3: Legolas and Aragorn, with routing

- [ ] **Routing** (`hooks/elrond/routing.ts`, pure): `classification.decided.member/profile` → member; disabled or missing → Gandalf (fallback); Gandalf disabled → escalate. Stage 1 sends everything to Gandalf (see `MEMBER_WHO` and the `// Review. Stage 1 seats Gandalf alone` branch in register.ts).
- [ ] **Legolas** (`hooks/members/legolas.ts`): diff from the call's arguments.
  - Edit: a hunk from `old_string` → `new_string` with surrounding file context via `$.fs.read`.
  - Write: current file (if any) vs `content`.
  - NotebookEdit: the cell source.
  - Truncate to a diff line limit (`diffLines` option).
  - Checklist (§5): matches the request, scope creep or unrelated files, deleted or weakened tests, disabled checks, unexpected dependency, CI or config changes, obvious breakage. **No style review.**
- [ ] **Aragorn, git profile** (`hooks/members/aragorn.ts`): command plus Galadriel's git preview (branch, remote, commits to be sent) plus the latest prompt. Checklist: protected target branch, force flags, rewriting pushed history, unrelated commits.
- [ ] **Aragorn, database profile:** command plus migration or SQL content (truncated; read migration files named in the call, or heredoc and `-c` SQL). Checklist: rollback path, destructive DDL, UPDATE or DELETE without WHERE, production-looking target (config patterns), transaction wrapping, long locks on large tables. Separate system prompt per profile.
- [ ] `userConfig`: `legolasEnabled`, `legolasModel`, `aragornEnabled`, `aragornModel` (same picker options as Gandalf).
- [ ] Generalise `reviewByGandalf` into one top-level `review($, member, profile, context, model, deadline, signal)` in register.ts. Members only supply `system(nonce)` and `prompt(context, nonce)`.
- [ ] Tests (§19 Routing, Model members): each member and profile gets its triggers, with Gandalf as fallback; approve, revise and block for each member.
- [ ] Optional, needs the user's approval because it costs real tokens: a ~40-case labelled eval (destructive vs harmless commands, test-weakening diffs, SQL without WHERE, injection attempts inside diffs) run live against the default models, to confirm prompt quality.

## Stage 4: full council with Gimli

- [ ] **Big operations** in `rules.json` (`bigOperations`: rule ids or command regexes). Default: git push, merge to a protected branch, migrations.
- [ ] All enabled model members run **in parallel** (`Promise.all`; probed fine, peak 2) on the `council` model slot (default `opus`), under one shared deadline passed as each call's remaining `timeoutMs`. Gimli runs alongside on its own timeouts (decision 3). Keep the sequential fallback (stop at first block) behind a flag.
- [ ] **Combine** (`hooks/elrond/combine.ts`, pure): strictest wins (block > revise > approve); reasons labelled per member; a member error, timeout or malformed verdict is that member's block; a Gimli failure is a block. Members never see each other's verdicts.
- [ ] **Gimli** (`hooks/members/gimli.ts` + register.ts runner): only `gimli.commands: [{ name, argv, timeoutMs }]` from `rules.json`; never anything from Claude or the call. Pass or fail by exit code; keep the last ~20 lines. `$.process.spawn` so `next.signal` and Esc kill it.
- [ ] Gimli's commands live in `rules.json`, which is protected, so Claude can't add commands without the user's approval.
- [ ] Tests (§19 Full council, Gimli): strictest wins, one member failing, Gimli failing, shared deadline (`mock.clock`), only configured commands run, Gimli timeout.

## Stage 5: suggestions and `/council report`

- [ ] **After "allow once"**, offer an allow rule for that pattern (`hooks/elrond/suggest.ts`, pure: propose a minimal anchored regex from the part's core plus the tool). Show the exact JSON rule; write it to `rules.json` only on confirm, then reload config. **Never** offer one for block-tier matches, protected paths (`classification.isProtected`) or high-confidence Gollum findings.
- [ ] Allowlist suggestions for low Gollum findings follow the same confirm-then-write path (if not finished in stage 2).
- [ ] Writing `rules.json` safely: read, parse, validate the merged result with `validateOverrides`, write back pretty-printed, and keep the user's key order where possible.
- [ ] **`/council report`** (`hooks/elrond/report.ts`, pure over audit lines, including rotated files):
  - most-blocked rules and patterns;
  - blocks the user overrode with "allow once" (false-positive candidates);
  - shadow verdicts that would have blocked;
  - cost per member (tokens) and median latency.
- [ ] Tests (§19 Escalation, Commands): the rule suggestion is written only on confirm; never offered for block, protected or high Gollum; the report reads the log correctly.

## Stage 6: theme, then UI (SPEC §17, in this order; drop what the API can't do)

- [ ] **Theme strings:** add `themed` variants in `hooks/strings.ts`; a `plainMode` userConfig option (default off, i.e. themed). Themed messages: one line of flavour, then the plain reason and the safer alternative. Gandalf's block: "You shall not pass" style. Bypass is themed "Leeroy mode", and the escalation dialog is the "loot roll". Member names become the theme names (`who.*` entries).
- [ ] **Debate pane:** `Pane` showing the proposal (the call) beside the reviewing member's verdict; reads `$.state`. Opened unasked only from 144 columns; `/council` opens it at any width.
- [ ] **Council check:** for big operations, a ready-check row per member (tick or cross) in the `AbovePrompt` band (terminal + desktop).
- [ ] **Wipe counter** in the band or the pane.
- [ ] **Threat meter:** blocks per member (pane).
- [ ] **Loot roll:** themed escalation text and labels (and optionally a `ui.render` hook on `AskUserQuestion`; a rewrite must still fit the tool's schema).
- [ ] **Epic drop:** after a merge or push succeeds following a passed council check, a short magenta band row plus a toast saying "Legendary commit acquired", cleared by `$.clock.after`. No flash primitive exists. Cosmetic only.
- [ ] Degrade cleanly: no colour dependence, and nothing drawn where nothing draws (VS Code, `-p`, SDK, cloud).
- [ ] Tests: plain mode shows no theme text anywhere (extend the stage 1 test to every string and every drawn tree); mount UI through `$.ui.mount` on both `'terminal'` and `'desktop'`.

## Final deliverables (SPEC §21–22)

- [ ] README complete:
  - loading (`--plugin-dir`, install);
  - editing rules with examples;
  - each mode and command;
  - **adding a member**;
  - expected token cost (update with stage 3–4 figures);
  - limits;
  - **glossary** of theme terms and plain names.
- [ ] DESIGN.md: final `hooks:`/`calls:` lines, data flow, failure modes, and every decision.
- [ ] Definition of done (§22):
  - [ ] every §19 test passes;
  - [ ] no path where a gated call runs after a reviewer failure without the user's answer;
  - [ ] no path where the mod approves ahead of the permission check (no `tool.check` hook; assert in a test);
  - [ ] plain mode shows no theme text;
  - [ ] with every model member disabled, rules, Gollum and escalation still work;
  - [ ] the README states the limits plainly.
- [ ] Live interactive check by the user in a terminal: the dialog, the pane, the band, the indicator.

## Known follow-ups

From stage 2:
- **The open question above** decides `PERMISSION_DENIALS_ARE_WIPES` (and whether to split user refusals from automatic denials).
- **Live UI check in a terminal (user):** the `/council` pane, the `council: shadow` / `council: bypass` label, the "Council: you allowed this once" line under the permission dialog, the secrets dialog with three options and the allowlist confirm.
- **Scan allowed calls too?** The secrets scan follows SPEC §4 and reads gated calls only (DESIGN §6.1). Scanning every call is cheap; it needs the user's say-so since it changes the pipeline order.
- **Plain-mode identifiers.** `/council` prints member ids such as `gandalf` where you type them (DESIGN §6.16); stage 6's plain-mode test should decide whether ids count as theme text.
- `/config` has a model row for Gandalf only, so `/council model <legolas|aragorn|council> … --save` is session-only until stage 3 adds their rows (add them to `CONFIG_ROWS` in register.ts).
- Stage 3 routing should replace the `// Stage 2 seats Gandalf alone` branch and pass each member's `preview`.

From stage 1:
- `interpretRejection` detects "Chat about this" by looking for `chat` in the rejection message; the real wording is unverified. Check it live.
- `$.ui.ask` behaviour in SDK and cloud hosts is undocumented. If it can hang there, consider refusing when the only surfaces are remote ones.
- `isReadOnly` from `next(e)`'s result is unused. It could let Galadriel or the cache skip work.
- The audit appender re-reads the whole log per gated call (no append in `$.fs`). Fine at 1 MiB; revisit if latency shows.
