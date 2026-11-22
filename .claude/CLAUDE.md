# council-of-elrond

A Claude Code mod: risky tool calls go to a council of reviewers before they run. Lord of the Rings on the council, Warcraft in the raid (loot roll, wipes, Leeroy mode). Public, MIT. The README is the manual and the design; read it first.

## Layout

- `hooks/rules.ts`: the rule table, the secrets patterns, `classify`. Pure.
- `hooks/council.ts`: the members, the reviewer's prompt, every string, state changes. Pure.
- `hooks/register.ts`: the hooks. The only file that touches `$`.
- `types/index.d.ts`: the session state's shape.
- `tests/council.test.ts`: all the tests.

## Working here

- Check with `claude plugin test .` and `claude plugin validate --strict .`. That is the whole gate; CI runs the same two.
- Do not load this mod into the session that is editing it: a bug in the gate would gate the fix.
- A new rule is one line in `RULES` and one line in the test's `COMMANDS` or `PATHS` table.
- Keep it small. This replaced a 14,000-line version with a shell parser; it catches honest mistakes and says so. A pattern someone can dodge is not a bug to chase.
- What must hold: a failure never lets a gated call run, block rules and Gollum have no override, and only the person's own command (`composer` or `bridge` origin) loosens anything. Each has a test; keep them.
- Public repository: no real secrets in tests (join fake ones from halves), nothing personal.
