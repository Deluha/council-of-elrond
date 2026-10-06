# Developing council-of-elrond

For contributors and for Claude Code sessions that work on the mod. Read this, then
[ROADMAP.md](../mods/council-of-elrond/ROADMAP.md) for what is next and the decisions already
taken, and [DESIGN.md](../mods/council-of-elrond/DESIGN.md) for how it works and why.

## The one-minute version

```sh
cd council-of-elrond
claude plugin test mods/council-of-elrond       # 242 tests, about 15 s
tsc -p mods                                    # strict, against mods/types/claude-code.d.ts
claude plugin validate mods/council-of-elrond  # manifest, hooks, and every $ call the module makes
```

- All three pass before every commit.
- Only `hooks/register.ts` touches `$`. Everything else is pure and tested directly.
- Never load the mod into the session developing it. Live checks run headless (below).
- `mods/types/claude-code.d.ts` is the API. Don't invent methods; don't edit the file.
- Stop at every stage checkpoint (SPEC §20) with the summary it asks for, and wait for the
  maintainer.

## Layout

```
mods/
  tsconfig.json              strict typecheck for every mod under mods/
  types/claude-code.d.ts     Claude Code's generated API types (2.1.291), vendored
  council-of-elrond/
    .claude-plugin/plugin.json   manifest: name, version, userConfig (the /config rows)
    hooks/hooks.json             "modules": ["./register.ts"]
    hooks/register.ts            the only impure file: wires events to the pure modules
    hooks/strings.ts             every user-facing string, plain and (Stage 6) themed
    hooks/state.ts               the session record and its pure updates
    hooks/audit.ts               audit line shape, rotation
    hooks/redact.ts              secret redaction shared by prompts, dialogs and the log
    hooks/rules/                 shell parser, classifier, checks, globs, paths
    hooks/config/                shipped defaults, rules.json schema, types, the writer
    hooks/members/               one file per member, plus brief.ts and shared.ts
    hooks/elrond/                routing, council seats, verdict combination, operations,
                                 escalation, refusal text, model choice, commands, suggest, report
    types/index.d.ts             the $.state contract (CouncilSession, CouncilPanel)
    tests/                       *.test.ts, run by `claude plugin test`; fixtures.ts is the fake world
    README.md DESIGN.md ROADMAP.md SPEC.md
```

What each pure module decides, and the order they run in, is the data-flow diagram in
[DESIGN.md §3](../mods/council-of-elrond/DESIGN.md#3-data-flow).

## How register.ts is built

`register.ts` is long because the engine requires it: a helper that takes `$` must be a top-level
function in that file (passing `$` to an imported function fails validation). Keep it to wiring:

- `tool.call` runs Elrond's pipeline. Every pass-through goes through `proceed()`, which refuses
  when the hook's remaining own-time budget is under one second. The `.catch` replays the real
  result if `next.called`, else refuses.
- `prompt.submit` runs `resetForPrompt`, the single per-prompt reset.
- `session.start` loads the config and registers `/council`; `command.run` answers it.
- `ui.render` draws the `/council` pane and the mode label. Drawing is done with the global
  `h(Element, props, ...children)` and elements from `$.ui.resolve(e)`, so the file stays `.ts`.

Everything that decides something lives in a sibling module and gets its inputs as plain values.
If you find yourself deciding in register.ts, move it out and test it directly.

The API facts that shaped this (budget behaviour, `$.ui.ask` mechanics, `$.process.spawn` having
no timeout, state rules) are the numbered list under "Hard-won API facts" in
[ROADMAP.md](../mods/council-of-elrond/ROADMAP.md). Read it before touching register.ts.

## Conventions

- **Imports:** pure modules import siblings with `.js` suffixes (`./schema.js`); types come from
  `claude-code`.
- **No text in logic.** Every user-facing string is an entry in `hooks/strings.ts`, picked by key.
  Plain variants describe the role ("the diff reviewer"); themed variants (Stage 6) may use the
  names. Member ids typed by the user (`gandalf` in `/council model gandalf opus`) are config
  keys and stay as written.
- **One state value.** `council-of-elrond.session` (`CouncilSession`, shape version in `v`),
  changed only by the pure functions in `hooks/state.ts`. A new field goes in `types/index.d.ts`,
  `INITIAL_SESSION`, and `resetForPrompt` if it is per prompt. Bump `v` when an old value must
  not be read as the new shape.
- **Refusals and questions.** Every refusal is built by `refusalText`
  (`hooks/elrond/refusal.ts`); every escalation by `questionText` (`hooks/elrond/escalation.ts`).
- **Audit.** Each gated call writes exactly one line, through `finish()` in register.ts. The log
  never holds file contents, diffs, check output or secrets.
- **Redaction** happens before anything reaches a model, a dialog, the pane or the log.
- **Comments** say why, never what. Short.
- **Decisions the spec didn't cover** go in the current stage's section of DESIGN.md, numbered,
  and are summarised at the checkpoint.

## Tests

Tests import the kit from `claude-code/testing`. The test's `on(...)` hooks sit beneath the
plugin and stand for the engine: a `model.complete` hook is the model, a `process.run` hook is a
process, a `tool.call` hook on `AskUserQuestion` is the user's answer, `mock.clock(on)` is the
clock. An unstubbed `$` call throws, which is what you want.

`tests/fixtures.ts` builds all of that as `world(on, setup)`: a project at `/work` with files in
memory, scripted model replies, a scripted user, recorded processes, logs, toasts, panes and config
writes. Read a `World`'s fields to assert on what happened (`w.ran` is what reached the tool,
`w.asked` what the user was asked, `w.modelRequests` what a reviewer saw).

Patterns to keep:

- **Pure modules get direct tests** (`rules.test.ts`, `operations.test.ts`, `report.test.ts`).
  Integration through register.ts goes in `pipeline.test.ts`, `council.test.ts`,
  `commands.test.ts`, `suggest.test.ts`.
- **Safety tests are mutation-checked.** For a path that decides whether a call runs, break the
  code on purpose and confirm the test fails. Say so in the pull request.
- **One registration per event per test.** Registering the same event twice fails the load; use
  the fixture's switches (`replies`, `answers`, `surfaces`, `processReply`, `spawnReply`).
- **Mock the clock for anything that waits.** A test has 5 s. `world(on, { isClockMocked: true })`
  gives `w.clock`; `w.modelDelays` sets how long each model request takes.
- **Kit specifics** (bottom hooks that must return `{ cwd }`, `{ result }`, async generators for
  `process.spawn`) are in the ROADMAP's API facts, item 12 and 14.

Run one file while iterating: `claude plugin test` has no filter, so comment with `test.only` if the
kit supports it, or keep the suite fast enough that it doesn't matter (it is about 15 s today).

## Live checks

Unit tests stand in for the engine; a live check runs the real one, headless, with no human to
answer a dialog. Use a throwaway repository, never this one:

```sh
mkdir /tmp/council-probe && cd /tmp/council-probe && git init -q && echo hi > a.txt && git add . && git commit -qm init
claude -p --plugin-dir /path/to/council-of-elrond/mods/council-of-elrond \
  --output-format stream-json --verbose \
  "Run exactly this command and report its output: rm -r build"
```

- A refusal reaches Claude as the tool's error text. A question can't be answered in `-p`, so
  escalations refuse with "nobody can be asked"; that is the path you are testing.
- `/council …` output arrives as `system/ui_log` lines in stream-json; in plain `-p` it prints
  nothing.
- Loading writes `.claude-plugin/types/` and `tsconfig.json` into the mod folder (gitignored),
  and the probe's `.claude/council-of-elrond/audit/` into the throwaway repo.
- Interactive UI (the dialog, the pane, the band, the mode label) can only be checked by the
  maintainer in a terminal. List what you did not verify in the checkpoint summary.

The `/live-check` skill in this repository walks through this.

## Recipes

### Add a shipped rule

1. Add it to `SHIPPED.rules` in `hooks/config/defaults.ts`: an `id`, a `tier`, `tools`, and a
   `command`, `path` or `input` pattern, with a `reason` the user will read, and `member` and
   `profile` for the review tier.
2. Mind the floor: a block rule can't be disabled or lowered by a project rule, so block only what
   is never right. Prefer review for anything a project might legitimately do.
3. Test it in `tests/rules.test.ts`: the call that should match, the near miss that should not,
   and the compound form.
4. Document it in the README's "Tiers" list and in the CHANGELOG.

### Add a preview inspection

Galadriel's table in `hooks/members/galadriel.ts` is the only place a process is named. An entry
takes the call's targets as data; the proposed command never runs. Validate anything that becomes
an argument (refs: no leading `-`, no `..`), keep it read-only (`git` runs with
`GIT_OPTIONAL_LOCKS=0`, no pager, no prompts), and remember each inspection has 5 s and the
preview at most 3. Test in `tests/galadriel.test.ts` that the proposed command is never among
`w.processes`.

### Add a `/config` option

1. A field in `.claude-plugin/plugin.json` `userConfig` (flat: string, number, boolean; `options`
   for a picker, `min`/`max` for numbers). Lists and structures go in `rules.json` instead.
2. Its type in `Settings` and its reading in `settingsOf` (register.ts), with the default the
   manifest declares.
3. A row in the README's Options table.

### Add a `/council` subcommand

The parser is pure (`hooks/elrond/commands.ts`): add the subcommand there with a test in
`tests/commands.test.ts`, then the output builder (pure, returning lines), then one arm in
register.ts that gathers inputs and calls `show()`. Output goes to the pane or `ui.log`, never to
Claude (approved decision 1).

### Add a member

The spec caps the council at three model members (SPEC §3): Gandalf, Legolas and Aragorn, with
Aragorn's two profiles. Adding one therefore means replacing one, or adding a code member like
Gollum or Gimli, unless the maintainer lifts the cap. A model member touches these places:

1. `hooks/members/<name>.ts`: a `Context` type, a `LIMITS` object, `system(nonce)` and
   `prompt(context, nonce)`. Wrap every piece of session content with `untrusted(kind, text,
   nonce)`, include `untrustedRules(nonce)` and `ANSWER_FORMAT` in the system prompt, and keep the
   checklist short. Look at `gandalf.ts` for the shape.
2. `hooks/members/brief.ts`: a variant in the `Brief` union, an arm in `requestOf`, a key in
   `whoOf`.
3. `hooks/config/types.ts`: the id in `MEMBERS` and `MODEL_SLOTS`; `hooks/config/defaults.ts`:
   its built-in model in `BUILT_IN_MODELS` and the rules that name it.
4. `hooks/strings.ts`: `who.<name>` with a plain description (and the themed name in Stage 6).
5. `hooks/elrond/routing.ts` if it needs a fallback rule beyond "the rule names it";
   `hooks/elrond/council.ts` for when it sits on the full council.
6. register.ts: the `Settings` fields and `/config` rows (enabled, model) in `plugin.json`, the
   `briefOf` arm that gathers its context, and the status pane's member list.
7. Tests: `members.test.ts` (approve, revise and block parsed from its reply; its prompt holds
   what it should and nothing more), `routing.test.ts`, `council.test.ts`, and a plain-mode check
   that its strings carry no theme text.
8. Docs: the README's Reviewers table and Models table, DESIGN.md, CHANGELOG.

A code member (no model) skips 1 to 3 and adds a pure module with its own test file, wired at the
pipeline step where it belongs; see `gollum.ts` and `gimli.ts`.

### Change the session state

Add the field to `CouncilSession` in `types/index.d.ts` and to `INITIAL_SESSION`. If it is per
prompt, clear it in `resetForPrompt`. If an old value must not be read as the new shape, bump `v`
and the check in `sessionOf`. Writes to `$.state` are refused while drawing, so never set state
from a `ui.render` hook.

## Working with Claude Code on this repo

The root `CLAUDE.md` holds the rules a session must follow. Three project skills help:

- `/checkpoint`: runs the three checks and drafts the stage summary SPEC §20 asks for.
- `/live-check`: the headless probe procedure above, step by step.
- `/upgrade-types`: regenerating `mods/types/claude-code.d.ts` after a Claude Code update and
  recording the drift.

Keep the stage discipline: finish the stage, pass the checks, write the summary, wait. The
maintainer decides scope; the roadmap's "Known follow-ups" is where ideas wait for a decision.
