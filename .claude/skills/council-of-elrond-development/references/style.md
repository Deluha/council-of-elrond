# Style

Code, test and document style; commit messages.

## Conventions

- **Imports:** pure modules import siblings with `.js` suffixes (`./schema.js`); types come from
  `claude-code`.
- **No text in logic.** Every user-facing string is an entry in `hooks/strings.ts`, picked by key.
  Plain variants describe the role ("the diff reviewer"); themed variants (Stage 6) may use the
  names. Member ids typed by the user (`gandalf` in a `/council model` command) are config
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
- **Decisions the spec didn't cover:** R8 (`references/conventions.md#r8`).

### More of the same

- **Where text may live.** `hooks/strings.ts` holds every user-facing string, each entry `{ plain, themed? }`; text Claude reads is always asked for in plain. Two exceptions: the reason of a shipped rule is written inline in `hooks/config/defaults.ts`, and a reviewer's prompt text lives in `hooks/members/`.
- **Syntax.** No default exports; no `enum`, `class` or `namespace`; no `any` and no `@ts-ignore`. `as never` is the accepted cast for a gap in the kit's types (`references/host-api-facts.md`, item 9). Boolean exports are named `is...`, `has...` or `needs...`.
- **Fixtures.** Test data uses `/work`, `/home/me` and `example.com`. A fake secret is joined from two halves at run time (see `tests/fixtures.ts`), so that no committed line holds a well-formed token (R11).
- **Records.** DESIGN decisions are numbered per section and amended in place with a pointer to the amendment. Roadmap ids never change once given.
- **Files.** `.editorconfig` holds the rest: LF, two spaces, a final newline.

## Commit messages

Commit messages: an imperative summary line under 72 characters, then why the change was made.

The `.githooks/commit-msg` hook, where installed, checks the summary: at most 72 characters, no full stop, a blank second line, and no past tense ("Add", not "Added").

## Writing style for docs

Plain words, short sentences, no filler. Say what the thing does, not what it is like. Member names
(Gandalf, Legolas and so on) are fine in prose; in the mod's own output they appear only in themed
mode, so the plain description ("the diff reviewer") goes in `hooks/strings.ts` as the `plain` variant.
