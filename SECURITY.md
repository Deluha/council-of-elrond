# Security policy

## What this project is, and is not

council-of-elrond is a Claude Code mod that gates risky tool calls. **It is not a sandbox and not a
security product.** The rules tier is a best-effort classifier over tool-call text; the model
reviewers are a second opinion. The limits are listed plainly in the user manual under
[What it does not protect against](mods/council-of-elrond/README.md#what-it-does-not-protect-against)
and [Known gaps in shell parsing](mods/council-of-elrond/README.md#known-gaps-in-shell-parsing).

Something listed there is a known limit, not a vulnerability. Everything else that lets a call
past the gate in a way the documentation says it should not is in scope.

## In scope

- A destructive command that the shipped rules classify as `allow`, or that evades a shipped
  `block` rule or a protected path, through parsing (quoting, wrappers, encodings, path tricks).
- A way for the proposing session (Claude) to influence a reviewer's verdict through the content
  it controls (the call text, a diff, a preview) beyond what the manual describes as a known limit.
- A way to make the mod run something derived from a tool call other than through `next(e)`
  (the read-only preview table, the project checks).
- A path where a gated call runs after a reviewer failure without the user's answer, or where the
  mod takes part in Claude Code's permission decision.
- Secrets reaching the audit log, a model prompt or the dialog unredacted.
- An allow rule or allowlist entry written to `rules.json` without the user's confirmation.
- A setting of a project's `rules.json` that loosens the gate or runs code taking effect before a
  person confirmed that exact file content (see [Trusting a project's rules file](mods/council-of-elrond/README.md#trusting-a-projects-rules-file)).

## A project's rules file

A `rules.json` that arrives with a cloned repository is trusted like code only after a person has
confirmed that exact content (`/council trust`), kept as a hash in the plugin's own store. Until
then its settings that loosen the gate or run code are ignored and its tightening ones apply, so it
can never make the gate weaker than no file. The option `trustProjectRules=always` turns this off for
a host whose owner controls which repositories it opens; it is the plugin's own configuration, never
read from a rules file.

## Out of scope

- Behaviour when the mod is not loaded, disabled, or run with `--safe-mode`, `--bare` or
  `disableAllHooks`.
- Limits the manual already states (variables and globs not expanded, code inside interpreters not
  parsed, non-POSIX shells, secrets the patterns don't know).
- Issues in Claude Code itself. Report those to Anthropic.

## Reporting

Please do not open a public issue for a bypass. Use GitHub's private vulnerability reporting on
this repository ("Security" tab, "Report a vulnerability"). Include the exact tool call, the
classification you got (`/council test "<command>"` prints it) and the one you expected, and the
Claude Code version (`claude --version`).

You should get an acknowledgement within a week. Fixes land in a normal pull request with a test
that reproduces the bypass; the report is credited in `CHANGELOG.md` unless you ask otherwise.

## Supported versions

No version has been tagged yet: 0.5.0 and 0.6.0 are headings in the changelog on `main`, and the
first tag will be 0.6.0. Until then only `main` is supported, and afterwards only the latest
release. The mod targets the Claude Code version named at the top of
[`DESIGN.md`](mods/council-of-elrond/DESIGN.md); behaviour on other versions is untested.
