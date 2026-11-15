# Recipes: grep before coding, and the lessons loop

## Grep before coding

Before writing a helper, a refusal, a question, a fence or a redaction, grep for it. These exist; reuse them rather than re-deriving them.

| Name | Where | What it is for |
| :- | :- | :- |
| `refusalText` | `hooks/elrond/refusal.ts` | Every refusal is built by it |
| `questionText` | `hooks/elrond/escalation.ts` | Every escalation to the person is built by it |
| `redact` | `hooks/redact.ts` | Secret redaction, with the shipped and the project's patterns |
| `untrusted`, `untrustedRules`, `ANSWER_FORMAT` | `hooks/members/shared.ts` | A reviewer's prompt: wrap session content, state the rules about it, fix the answer shape |
| `fenced`, `label` | `hooks/members/shared.ts` | A fenced block with its limits and omission marker; a call-supplied name made safe to print |
| `cleanText` | `hooks/config/trust.ts` | Control and hidden characters out of a text a person will read |
| `finish()` | `hooks/register.ts`, inside the `tool.call` hook | The one place a gated call writes its audit line |
| `warnOnce` | `hooks/register.ts` | A warning shown once per key; a helper that takes `$` is a top-level function there |

Where a name has moved, grep for its definition: `grep -rn "function refusalText" mods/council-of-elrond/hooks`. The patterns to copy for each kind of change are in the workflows (`references/workflows/`): a rule, a parser entry, a preview inspection, a member, a `/council` subcommand, a state field.

## The lessons loop

Every finding of a review is closed in one of four ways, in this order of preference:

1. a **checker rule** (`scripts/check-guidance.mjs`, or a row of `node scripts/verify.mjs`), so the mistake cannot recur unseen;
2. a **test**, so the behaviour is pinned;
3. a **hook** (`.claude/settings.json`), so the correction arrives when the mistake is made;
4. **one guidance line**, in the one file that owns the fact (never a second copy).

The pull request lists each finding and how it was closed, and each finding declined with the reason. The nine lessons the loop was seeded with:

| # | Lesson | Lands as |
| -: | :- | :- |
| 1 | A sweep against `main` finds a loosening a review does not | R9; the verify sweep row; the pull request's gate line; a real check when M2.1 exists |
| 2 | Never stash, reset or check out over another agent's tree | R12 |
| 3 | A headless child run costs money | R13; `claude -p` is never on the allow list |
| 4 | Run on the pinned build, not the installed one | The session-start hook; verify's pinned-build row |
| 5 | A loosening is asked first, even as a side effect | R8; the ask-first list; the pull request's gate line |
| 6 | Parallel briefs need disjoint file sets | One line in `references/recipes-orchestration.md` naming the five shared files |
| 7 | Docs ship in the same brief as the change | R10; verify's docs warning |
| 8 | A safety path's test must fail when the code is broken | R7; the verify mutation row |
| 9 | No bypass input in public text | R11; the reviewer's checklist (a checker cannot know what a bypass input is) |
