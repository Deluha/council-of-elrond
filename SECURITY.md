# Security policy

council-of-elrond is a seatbelt, not a security boundary. Its rules are plain patterns over a
command's text, and its reviewers are model calls. A command that slips past a pattern is expected
and is not a vulnerability: open an ordinary issue or a pull request with the rule. Rely on Claude
Code's own permissions and sandbox to contain a session.

Please report these privately, through
[private vulnerability reporting](https://github.com/Deluha/council-of-elrond/security/advisories/new):

- A gated call that runs after the gate itself failed (an error, a timeout, nobody to ask).
- A way for anything other than the person's own typed command to turn on Leeroy mode or use
  `/council allow`.
- A block rule or the secrets scan being overridden from inside a session.
- The mod running or writing anything other than the tool call it let through.

Please do not put a working bypass of those four in a public issue.
