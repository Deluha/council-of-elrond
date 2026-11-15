# Architecture

Where things are, and how `hooks/register.ts` is built.

## Layout

```
mods/
  tsconfig.json              strict typecheck for every mod under mods/
  types/claude-code.d.ts     Claude Code's generated API types (the version in DESIGN.md's header), vendored
  council-of-elrond/
    .claude-plugin/plugin.json   manifest: name, version, userConfig (the /config rows)
    hooks/hooks.json             "modules": ["./register.ts"]
    hooks/register.ts            the only impure file: wires events to the pure modules
    hooks/strings.ts             every user-facing string, plain and (Stage 6) themed
    hooks/state.ts               the session record and its pure updates
    hooks/audit.ts               audit line shape, rotation
    hooks/redact.ts              secret redaction shared by prompts, dialogs and the log
    hooks/rules/                 shell parser, classifier, checks, globs, paths, scopes (rules per repository)
    hooks/rules/push.ts          the one parser of `git push` arguments (checks, operation keys and previews all read it)
    hooks/config/                shipped defaults, rules.json schema, types, the writer
    hooks/config/trust.ts        what a project rules file may do before it is confirmed; the trust record helpers
    hooks/members/               one file per member, plus brief.ts and shared.ts
    hooks/elrond/                routing, council seats, verdict combination, operations,
                                 escalation, refusal text, model choice, commands, suggest, report,
                                 relay (what reaches Claude where nothing draws),
                                 view (the rows the debate pane and the band draw)
    hooks/elrond/chat.ts         the `council allow` / `council deny` lines a person types, parsed
    types/index.d.ts             the $.state contract (CouncilSession, CouncilDebate, CouncilPanel)
    tests/                       *.test.ts, run by `claude plugin test`; fixtures.ts is the fake world
    tests/approvals.test.ts      what an approval holds for: the folder, a big operation, a git part, a fresh read
    tests/aragorn.test.ts        the SQL a shell call carries, for the database reviewer
    tests/audit.test.ts          the call fingerprint and audit rotation by bytes
    tests/broken.test.ts         a rules file with errors: what still applies, what is ignored, the caps
    tests/chat.test.ts           approving or refusing a call in chat where nothing draws
    tests/commands.test.ts       the `/council` subcommands: parsing, who may run what, the output
    tests/config.test.ts         loading the rules file and merging it with the shipped rules; model layers
    tests/council.test.ts        big operations, the project checks, who sits, combining the verdicts
    tests/debate.test.ts         the debate pane, the council check band and the epic drop, mounted
    tests/done.test.ts           the definition-of-done evidence and the owner tests SPEC §19 names
    tests/galadriel.test.ts      the read-only preview: the table, where git runs, what a push shows
    tests/gandalf.test.ts        verdict parsing, the destructive-operations prompt, redaction
    tests/gitcwd.test.ts         where the mod's own git runs: the folder the call works in
    tests/gollum.test.ts         the secrets scan: formats, low patterns, redaction that keeps code
    tests/members.test.ts        the diff and git or database reviewers' prompts; the names fenced
    tests/omission.test.ts       what a reviewer is told when its input was cut short
    tests/operations.test.ts     operation keys, rounds, failed attempts and the outcome of a call
    tests/pipeline.test.ts       the gate end to end: allow, block, review, escalate, fail closed
    tests/relay.test.ts          what reaches Claude where nothing draws
    tests/report.test.ts         reading the audit log and `/council report`
    tests/robustness.test.ts     stale, malformed, interrupted and late inputs; failing writes; Esc
    tests/rounds.test.ts         review rounds, lockouts, and a part retried inside a compound command
    tests/routing.test.ts        which member gets which call, and the fallback
    tests/rules.test.ts          the shell parser and the classifier: shipped rules, near misses, compounds
    tests/scopes.test.ts         rules per repository under a parent root
    tests/secrets.test.ts        project patterns applied wherever the mod redacts; what the scan reads
    tests/state.test.ts          the session record's shape check and its older versions
    tests/suggest.test.ts        the allow rule offered after "allow once", and writing it
    tests/terminal.test.ts       what a person is handed: the question's text, lines and size cap
    tests/theme.test.ts          the strings table, plain mode, and what Claude reads staying plain
    tests/trust.test.ts          the trust rule: which settings wait, the record, the commands
    tests/view.test.ts           the rows the debate pane and the band draw
    README.md DESIGN.md ROADMAP.md SPEC.md
```

What each pure module decides, and the order they run in, is the data-flow diagram in
`mods/council-of-elrond/DESIGN.md#3-data-flow`.

## How register.ts is built

`hooks/register.ts` is long because the engine requires it: a helper that takes `$` must be a top-level
function in that file (passing `$` to an imported function fails validation; re-probed in M0, since
the November review found the rule no longer holds at validation time). Keep it to wiring:

- `tool.call` runs Elrond's pipeline. Every pass-through goes through `proceed()`, which refuses
  when the hook's remaining own-time budget is under one second. The `.catch` replays the real
  result if `next.called`, else refuses.
- `prompt.submit` runs `resetForPrompt`, the single per-prompt reset, for a person's prompt
  (`HUMAN_ORIGINS`) except a `/council` command; a person's prompt without a slash command is also
  read for `council allow` / `council deny` lines, which are answered against the offers, stripped
  and acknowledged in `context` (DESIGN §14.4); any other prompt only clears the approve cache and
  the once-allowances;
  its `.catch` passes the prompt through, so a failure there never costs the prompt or the
  plugin.
- `session.start` loads the config, registers `/council` and, where nothing draws, appends the start
  notice; `command.run` answers it; `session.attach` and `session.detach` keep the status line in step.
- `ui.render` draws the `/council` pane, the debate pane, the council check band and the mode
  label. The debate pane and the band only read state; their rows come from `hooks/elrond/view.ts`.
  Drawing is done with the global `h(Element, props, ...children)` and elements from `$.ui.resolve(e)`, so the file stays `.ts`.

Everything that decides something lives in a sibling module and gets its inputs as plain values.
If you find yourself deciding in register.ts, move it out and test it directly.

The API facts that shaped this (budget behaviour, `$.ui.ask` mechanics, `$.process.spawn` having
no timeout, state rules) are the numbered list in `references/host-api-facts.md`. Read it before touching register.ts.
