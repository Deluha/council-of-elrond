# Testing

How the tests are written. The command that runs them is in `references/qa-and-ci.md`.

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

- **Pure modules get direct tests** (`tests/rules.test.ts`, `tests/operations.test.ts`, `tests/report.test.ts`).
  Integration through register.ts goes in `tests/pipeline.test.ts`, `tests/council.test.ts`,
  `tests/commands.test.ts`, `tests/suggest.test.ts`. `tests/done.test.ts` holds the definition-of-done evidence and
  the owner tests SPEC §19 names (DESIGN.md §12); keep its names in step with that table.
- **Safety tests are mutation-checked.** For a path that decides whether a call runs, break the
  code on purpose and confirm the test fails. Say so in the pull request.
- **One registration per event per test.** Registering the same event twice fails the load; use
  the fixture's switches (`replies`, `answers`, `surfaces`, `processReply`, `spawnReply`).
- **Mock the clock for anything that waits.** A test has 5 s. `world(on, { isClockMocked: true })`
  gives `w.clock`; `w.modelDelays` sets how long each model request takes.
- **Mounted drawings** (`$.ui.mount`): a mounted tree re-reads on its own after a `$.state` write,
  so mount once, drive the calls, and read `drawn()`, `find` or `findAll({ type: 'Text' })`. The
  engine keeps one instance per pane id, so unmount before mounting the same pane again. Mount
  the debate pane on all four surfaces and the band on `terminal` and `desktop`. The fixture's
  `isBandDrawn` adds the engine's own band beneath the plugin, so a pass-through shows
  "engine band"; `replyFor` picks a model reply by the request, for calls in flight together.
- **Kit specifics** (bottom hooks that must return `{ cwd }`, `{ result }`, async generators for
  `process.spawn`) are in `references/host-api-facts.md`, items 12 and 14.

Run one file while iterating: `claude plugin test` has no filter, so comment with `test.only` if the
kit supports it, or keep the suite fast enough that it doesn't matter.

Use `world()` rather than stubbing `$` by hand.

## What else the tests follow

- A test reads the `World`'s fields to assert on what happened; its name is a plain sentence about behaviour.
- Classifier tests are tables run through `expectCases` in `tests/rules.test.ts`.
- Every secret pattern has a linear-time test on adversarial input (`tests/gollum.test.ts`, `tests/secrets.test.ts`); a new or changed pattern joins them.

## The mutation check

For a path that decides whether a call runs (R7): break the code on purpose in the smallest way that should change the outcome, run the tests, confirm the test that guards it fails, and restore the code. A test that stays green is not a guard. Say in the pull request which paths were checked and how.
