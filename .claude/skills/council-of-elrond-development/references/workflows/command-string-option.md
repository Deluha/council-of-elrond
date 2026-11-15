# Add or change a /council subcommand, a string or a /config option

## Preconditions

- Until 1.0 no new command, option or configuration file lands beyond the roadmap's briefs (AM1, the freeze). If the brief does not name it: stop and ask.
- Read `references/style.md` for strings.

## Steps

### Add a `/config` option

1. A field in `.claude-plugin/plugin.json` `userConfig` (flat: string, number, boolean; `options`
   for a picker, `min`/`max` for numbers). Lists and structures go in rules.json instead.
2. Its type in `Settings` and its reading in `settingsOf` (register.ts), with the default the
   manifest declares.
3. A row in the README's Options table.

### Add a `/council` subcommand

The parser is pure (`hooks/elrond/commands.ts`): add the subcommand there with a test in
`tests/commands.test.ts`, then the output builder (pure, returning lines), then one arm in
register.ts that gathers inputs and calls `show()`. If the subcommand loosens the gate (it lets
more through, or switches something on), add it to `needsPerson` in the same file, with a test that
a non-person origin is refused; one that only tightens is not added. Output goes to the pane or `ui.log`, never to
Claude (approved decision 1), except the four subcommands `hooks/elrond/relay.ts` relays where
nothing draws (C2, DESIGN §13.5): a new one is not added to that list without the maintainer.

### Add or change a string

Every user-facing string is an entry in `hooks/strings.ts`, picked by key, with a plain variant that describes the role; text Claude reads is always plain (R4, `references/style.md`).

## Verification

Run `node scripts/verify.mjs` (`/verify-change`) on the pinned build (`references/qa-ci.md`) and read its table. Tests: `tests/commands.test.ts` for the parser and the output, `tests/theme.test.ts` for plain mode. A subcommand that loosens the gate is in `needsPerson` and has a test that a non-person origin is refused.

## Docs to update

A new string, option or subcommand is user-visible: `CHANGELOG.md` under "Unreleased", and `mods/council-of-elrond/README.md` (Options, Commands).

## Ask first

- **A new `/council` command, `userConfig` option or configuration file**: `.claude-plugin/plugin.json` is path-gated, the edit prompts; `hooks/elrond/commands.ts` is stop and ask.
- **The trust, untrust and `needsPerson` parts of `hooks/elrond/commands.ts`**: stop and ask.
- **The four subcommands relayed where nothing draws**: a new one is not added without the maintainer.
