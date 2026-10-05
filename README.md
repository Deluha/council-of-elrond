# council-of-elrond

A Claude Code mod: a council of specialist reviewers that gates risky tool calls before they run.

- The mod: [`mods/council-of-elrond`](mods/council-of-elrond) ([README](mods/council-of-elrond/README.md), [design](mods/council-of-elrond/DESIGN.md))
- Claude Code's generated API types for the build it targets: `mods/types/claude-code.d.ts`

```
claude --plugin-dir ./mods/council-of-elrond      # load it for one session
claude plugin test ./mods/council-of-elrond       # run its tests
tsc -p ./mods                                     # typecheck
```
