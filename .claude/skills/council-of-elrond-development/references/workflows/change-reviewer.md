# Change a reviewer, a preview inspection or the members

## Preconditions

- The spec caps the council at three model members (SPEC section 3). A new model member means replacing one, or adding a code member, unless the maintainer lifts the cap: stop and ask.
- Read `references/domain-reviewers.md`.

## Steps

### Change a reviewer's prompt or what it is shown

The prompt text lives in the member's file in `hooks/members/`. Everything a model reads is session content: wrap it with `untrusted(kind, text, nonce)`, redact it before it is cut, keep to the member's `LIMITS`, and tell the reviewer when its input was cut short (`references/domain-reviewers.md`). Test in `tests/members.test.ts` that the prompt holds what it should and nothing more.

### Add a preview inspection

Galadriel's table in `hooks/members/galadriel.ts` is the only place a process is named. An entry
takes the call's targets as data; the proposed command never runs. Validate anything that becomes
an argument (refs: no leading `-`, no `..`), keep it read-only (`git` runs with
`GIT_OPTIONAL_LOCKS=0`, no pager, no prompts), and remember each inspection has 5 s and the
preview at most 3 steps (a push may have up to 5, one more per extra commit list; a `note` step is a
line, not a step, and does not count). A git inspection may carry an `orElse` fallback (a second fixed entry, tried only
when the first fails); it is an alternative, not a fourth step. Test in `tests/galadriel.test.ts`
that the proposed command is never among `w.processes`.

### Add a member

The spec caps the council at three model members (SPEC §3): Gandalf, Legolas and Aragorn, with
Aragorn's two profiles. Adding one therefore means replacing one, or adding a code member like
Gollum or Gimli, unless the maintainer lifts the cap. A model member touches these places:

1. A new file in `hooks/members/`: a `Context` type, a `LIMITS` object, `system(nonce)` and
   `prompt(context, nonce)`. Wrap every piece of session content with `untrusted(kind, text,
   nonce)`, include `untrustedRules(nonce)` and `ANSWER_FORMAT` in the system prompt, and keep the
   checklist short. Look at `hooks/members/gandalf.ts` for the shape.
2. `hooks/members/brief.ts`: a variant in the `Brief` union, an arm in `requestOf`, a key in
   `whoOf`.
3. `hooks/config/types.ts`: the id in `MEMBERS` and `MODEL_SLOTS`; `hooks/config/defaults.ts`:
   its built-in model in `BUILT_IN_MODELS` and the rules that name it.
4. `hooks/strings.ts`: `who.<name>` with a plain description (and the themed name in Stage 6).
5. `hooks/elrond/routing.ts` if it needs a fallback rule beyond "the rule names it";
   `hooks/elrond/council.ts` for when it sits on the full council.
6. register.ts: the `Settings` fields and `/config` rows (enabled, model) in `.claude-plugin/plugin.json`, the
   `briefOf` arm that gathers its context, and the status pane's member list.
7. Tests: `tests/members.test.ts` (approve, revise and block parsed from its reply; its prompt holds
   what it should and nothing more), `tests/routing.test.ts`, `tests/council.test.ts`, and a plain-mode check
   that its strings carry no theme text.

A code member (no model) skips 1 to 3 and adds a pure module with its own test file, wired at the
pipeline step where it belongs; see `hooks/members/gollum.ts` and `hooks/members/gimli.ts`.

## Verification

Run `node scripts/verify.mjs` (`/verify-change`) on the pinned build (`references/qa-ci.md`) and read its table. A change to what a reviewer is told needs a test that fails without it (R7); the proposed command is never among `w.processes`; a plain-mode check shows its strings carry no theme text.

## Docs to update

A new member: the README's Reviewers table and Models table, DESIGN.md, CHANGELOG.

A changed prompt, a changed limit or a new inspection: `mods/council-of-elrond/DESIGN.md` if a decision was taken, and `CHANGELOG.md` under "Unreleased".

## Ask first

- **What reaches a model or starts a process** (`hooks/members/shared.ts`, `hooks/members/brief.ts`, `hooks/members/galadriel.ts`, `hooks/elrond/escalation.ts`, `hooks/elrond/refusal.ts`, `hooks/elrond/suggest.ts`, `hooks/elrond/chat.ts`): stop and ask; none of these is path-gated.
- **Built-in models** (`hooks/config/defaults.ts`): path-gated, the edit prompts.
- **Redaction** (`hooks/members/gollum.ts`): path-gated, the edit prompts.
- **The cap on model members** and **any loosening**: stop and ask.
