# council-of-elrond

A [Claude Code](https://code.claude.com/) mod. Before a risky tool call runs, a council looks at it.

Most calls never meet the council: `git status`, an edit to `src/app.ts`, `npm test` pass untouched, with no model call and no delay. A call that matches a rule (`rm -rf build`, `git reset --hard`, a write to `.env`) goes to the member who watches that kind of thing. The member is one small model call with a checklist and your last message; it approves, refuses, or says it cannot tell. What the council cannot settle comes to you as a loot roll.

> **This is a seatbelt, not armour.** The rules are plain patterns over a command's text. They catch honest mistakes: the delete that is wider than you asked for, the force push you did not mean. Anything that wants past a pattern can get past it (a variable, a script file, `eval`). Claude Code's own permissions and sandbox are the security boundary; keep them on.

## Install

At the prompt of a terminal session:

```
/plugin install council-of-elrond --marketplace Deluha/council-of-elrond
```

From a shell:

```sh
claude plugin install council-of-elrond --marketplace Deluha/council-of-elrond
```

To try it for one session from a clone: `claude --plugin-dir ./council-of-elrond`.

## What happens to a call

1. **Gollum** reads what the call would run or write. A token he knows by its shape (an AWS key, a GitHub token, a private key, and a few more) refuses the call. *My precious.*
2. **No rule matches:** the call runs. The council never sees it.
3. **A block rule matches:** refused. *You shall not pass.* No review and no override: `rm -rf /`, a force push to main, a write into `.ssh` or into git's own files.
4. **A council rule matches:** the rule's member reviews it.
   - **Approve:** it runs.
   - **Refuse:** Claude is told who refused and why, and to narrow the call or explain itself.
   - **Unsure, or no answer** (a timeout, an error, a reply that is not a verdict): it comes to you.
5. **Claude tries the same call again:** it comes to you, with no second review.
6. **A third time:** raid lockout. Nobody looks at that call again until you write your next message.

Whatever fails along the way, the call does not run.

## The council

| Member | Watches | Examples |
| :- | :- | :- |
| Gandalf | destructive operations | `rm -r`, `find -delete`, `git clean -f`, `curl … \| sh`, `sudo`, `chmod -R` |
| Aragorn | git history | force push, a push to main, `reset --hard`, `checkout -- .`, `branch -D`, `stash drop`, `--no-verify` |
| Gimli | data, infrastructure, releases | `DROP TABLE`, a `DELETE` with no `WHERE`, `terraform apply`, `kubectl delete`, `docker system prune`, `npm publish` |
| Legolas | sensitive files | writes to `.env`, CI workflows, key files, git hooks, shell profiles |
| Gollum | secrets | token shapes in a command or in what a call writes. No model: a pattern match refuses. |

The full list is the `RULES` table in [`hooks/rules.ts`](hooks/rules.ts), one line per rule.

## The raid

- **Loot roll.** When a call comes to you: **Need** lets it run once, **Greed** lets that rule through for the rest of the session (a command that also matches another rule is still reviewed), **Pass** keeps it blocked. Type something else instead and Claude gets your words.
- **Wipes and raid lockout.** Each refusal of the same call is a wipe. After two, the call is locked out until your next message, so Claude cannot grind the gate down by retrying.
- **Leeroy mode.** `/council leeroy` skips reviews for the session. Block rules and Gollum still hold. At least you have chicken.
- **Loot.** A commit that lands rolls on the loot table. Mostly nothing drops. Sometimes a Rare does. Once in a hundred, a Legendary.

## Commands

| Command | Does |
| :- | :- |
| `/council` | Status, the meter (who let through and refused how much, tokens spent) and the combat log of recent gated calls. |
| `/council test <command or path>` | Shows what that command or file path would meet. Runs nothing. |
| `/council allow` | Lets the last refused call through once: for when you disagree with a member, or the dialog could not be shown. |
| `/council leeroy` | Toggles Leeroy mode. |

`allow` and `leeroy` only work when you send them yourself, from the prompt or from a Remote Control client. Claude, a plugin, a script or a headless run cannot.

## Options

Set when you install, or later in `/config`.

| Option | Default | |
| :- | :- | :- |
| Reviewer model | `sonnet` | `haiku` is faster and cheaper; `opus` is more careful. |
| Shadow mode | off | The council reviews and logs, and a toast says what it would have stopped, but nothing is refused. Block rules and Gollum still hold. Good for the first days. |
| Extra council pattern | none | A regular expression. A shell command it matches goes to the council. `\bmake\s+deploy\b` |
| Extra block pattern | none | A regular expression. A shell command it matches is refused outright. `/council` tells you if a pattern does not compile. |

## Limits

- Patterns read the command as text. `rm -rf "$DIR"` is seen; a script that deletes things is a script.
- A pattern cannot tell a command from a mention of one: `grep -rn "rm -rf" .` goes to Gandalf, who will wave it through.
- Path rules are about writes. Reading `.env` meets no rule.
- A plain `git push` while you are on main is not seen as a push to main; only a push that names `main` or `master` is.
- The reviewer is a model reading text Claude wrote. It can be wrong, and it can be talked round. It never loosens a block rule.
- A review costs one short model call (about a thousand tokens) and a few seconds. Only gated calls pay it.
- Nothing is written to disk. The combat log lives with the session.

## Developing

Three source files and one test file:

```
hooks/rules.ts      the rule table, the secrets patterns, classify()       pure
hooks/council.ts    members, the reviewer's prompt, every string, state    pure
hooks/register.ts   the hooks: the only file that touches the engine
types/index.d.ts    the shape of the session state
tests/council.test.ts
```

```sh
claude plugin test .                 # the tests, against the real engine
claude plugin validate --strict .    # the manifest and the hooks module, as the engine reads them
```

That is the whole check, and CI runs the same two commands on the latest Claude Code.

To add a rule: one line in `RULES`, one line in the `COMMANDS` or `PATHS` table of the test. To typecheck in an editor, load the mod once with `claude --plugin-dir .`; Claude Code writes its API types and a `tsconfig.json` beside the mod, and `tsc -p .` works from then on.

Do not load the mod into the session you are developing it in: a bug in the gate would gate the fix.

## History

Versions before 1.0 were a much larger design: a shell parser, per-project rules files with a trust model, an audit log, a multi-reviewer full council. It was thorough and it was heavy to maintain. It is all in the git history, up to commit `9420d47`.

## Licence

[MIT](LICENSE)
