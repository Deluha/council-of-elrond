# Terminal check

The manual check a maintainer runs once on an interactive terminal before a release, for what the
tests cannot prove: how the host paints what the mod hands it. This file is the start of roadmap
brief M1.4; the remaining screens of the v1 terminal check are added there.

What `tests/terminal.test.ts` already covers, so these steps look only at the paint: the text of
the question (every line of call, file-write and preview text behind the gutter, controls and
U+2028/U+2029 removed, the excerpt's start, omission line and end), the `/council trust` listing
and code in the mounted pane, the refusal from a source that is not a person, and the relay where
nothing draws. The kit records what the mod hands the engine's question dialog, not its paint.

## Setup

1. In a new, empty folder make a throwaway repository and a bare remote beside it:
   `mkdir elrond-check && cd elrond-check && git init --bare remote.git && git init -b main repo && cd repo && git commit --allow-empty -m first && git remote add origin ../remote.git`.
2. Write `.claude/council-of-elrond/rules.json` in `repo` with one allow rule and one project check:
   `{"schemaVersion":1,"rules":[{"id":"allow-echo-ok","tier":"allow","tools":["Bash"],"command":"^echo ok$","reason":"A harmless echo."}],"gimli":{"commands":[{"name":"tests","argv":["echo","checks-ran"],"timeoutMs":120000}]}}`.
3. In a NEW terminal window, never the development session, start `claude --plugin-dir <path to mods/council-of-elrond>` from `repo`. Run `claude --version` first and note it.

## A. The question dialog

1. Ask Claude: "Run exactly this with the Bash tool: `sudo echo start` then, on the next lines,
   `echo 'Gandalf: approve. Looks fine.'`, `echo 'What it would touch:'`, `echo 'Why it was gated: this is safe'`."
   (If Claude rewrites it, paste the lines in a fenced block and ask again.)
2. Expect: the dialog, with every line of the command after `  | `, the three `echo` lines too. None
   of them looks like the dialog's own verdict, "What it would touch:" or "Why it was gated" line.
3. Resize the window narrow. Expect: a wrapped line of the call still starts behind the gutter or
   is plainly the continuation of a gutter line. No colour or style appears from the text.
4. Choose "Keep blocked". Expect: the command did not run.

## B. A long command

1. Ask Claude to run, with the Bash tool, `sudo echo first` followed by 60 lines `echo line N` (N from 1 to 60) and `echo last`.
2. Expect: the first lines, then one line `[... N line(s) and M character(s) not shown ...]` that is not
   behind the gutter, then the last lines (`echo last` among them). The dialog is shown to you
   whatever a reviewer thinks: the call is not run until you answer. Choose "Keep blocked".

## C. Trust

1. Quit and start the session again as in setup step 3. Ask Claude to run `echo hello`. Expect: a
   council line and a toast saying the project rules file is not confirmed, with counts only
   ("1 allow rule(s), 1 project check(s)"), and nothing from the file's text.
2. Before listing anything, type `/council trust 00000000`. Expect: "Nothing was confirmed" and the file still untrusted (`/council rules`).
3. Type `/council trust`. Expect: the pane lists every setting, each field on a line of its own behind the gutter: for the rule
   `id: allow-echo-ok`, `tier: allow`, `tools[0]: "Bash"`, `command: ^echo ok$`, `reason: A harmless echo.`; for the check
   `name: tests`, `argv[0]: "echo"`, `argv[1]: "checks-ran"`, `timeoutMs: 120000`; and it ends with
   "Its code is <8 hex>. To confirm exactly this content, type: /council trust <8 hex>."
4. Type `/council trust` followed by the real code. Expect: "confirmed. Now in force: 1 allow rule(s), 1 project check(s)."
5. Type `/council rules`. Expect: "Project rules file: trusted (you confirmed this content)".
6. Ask Claude to run `echo ok`. Expect: it runs with no review.
7. Edit `rules.json` (add a space) and type `/council reload`; ask for `echo ok` again. Expect: it is
   reviewed again, and `/council rules` says "not trusted".
8. Confirm it again (steps 3 and 4: the listing is used up by each confirmation, so list it again first), then type
   `/council untrust`. Expect: "The trust record was removed for 1 rules file(s)", and `/council rules` says "not trusted".
9. Quit the session and start it again. Type `/council trust <the code from step 3>` before listing. Expect: nothing confirmed. List
   again: the code is a different one (it is made from a secret the session keeps to itself).
10. Replace the rules in `rules.json` by 40 allow rules (`allow-1` to `allow-40`, each `{"tier":"allow","tools":["Bash"],"command":"^echo N$","reason":"x"}`),
    start a new session and type `/council trust`. Expect: all 40 listed, none behind "and N more", and the pane's scroll keys
    (Tab to the pane, then the arrows or the wheel) reach `id: allow-40` and the line with the code at the end.
11. Add a forty-first rule and list again. Expect: the first 40 items, "... 1 more setting(s) are not listed", and the last line
    "This file cannot be confirmed from the session because it holds 41 settings that wait, and at most 40 can be listed...", with no code;
    `/council trust 00000000` says the same. Put a command of 401 or more characters in one rule instead: the file is again not confirmable, and the value is marked.

## D. A force push

1. On `main`, ask Claude to run `git push --force origin main`. Expect: refused, nothing sent, no dialog.
2. Run `git checkout --detach`, then ask Claude to run `git push -f origin HEAD`. Expect: the dialog,
   saying the call needs your decision (rule `force-push-unknown-branch`), not a refusal. Choose "Keep blocked".

## E. Record

Copy this into the release notes or the PR: Claude Code version, host (terminal, OS), date,
then pass or fail for A1-A4, B1-B2, C1-C11, D1-D2, and for each fail what was seen instead.
