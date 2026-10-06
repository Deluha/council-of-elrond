# Getting help

- **Installing, configuring, removing:** [docs/INSTALL.md](docs/INSTALL.md), including a
  troubleshooting section.
- **What a command or option does:** the [user manual](mods/council-of-elrond/README.md).
- **Why a call was gated:** `/council test "<command>"` prints the tier, the rule, the reviewer and
  the operation key without running anything; `/council log` shows the last decisions.
- **Something wrong, or a rule gating too much:** open an issue with the matching template. Include
  `claude --version`, the call with secrets removed, and what `/council test` printed.
- **A command that passed when it should not have:** do not open an issue. Use
  [private vulnerability reporting](https://github.com/Deluha/council-of-elrond/security/advisories/new);
  see [SECURITY.md](SECURITY.md).
- **Questions and ideas:** GitHub Discussions, if enabled on the repository, else an issue with the
  feature-request template.

Claude Code itself (mods not loading at all, the plugin runtime, `claude plugin` commands) is
supported by Anthropic: https://github.com/anthropics/claude-code/issues.
