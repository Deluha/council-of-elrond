# C3 probe: does the web client answer `$.ui.ask`?

**This branch is a throwaway probe build. Never merge it, never install it anywhere but a throwaway cloud environment, and delete the branch once the run is recorded.** Its version reads `0.5.0-probe.c3`.

It differs from `main` in one behaviour and adds logging:

- **The ask is attempted with no surface.** Where `$.session.surfaces()` is empty (the cloud web client), `main` refuses at once with "nobody can be asked". This build puts the question to the user anyway with `$.ui.ask`, with no timeout:
  - An answer is honoured as in a terminal.
  - A rejection falls back to `main`'s nobody-to-ask refusal.
  - Whether the ask can hang is part of what the run measures.
- **Logging.** One JSON line per event goes to `council-c3-probe.jsonl` at the session root, and the same line goes to the engine's debug log with the prefix `council-c3-probe`. Every string in a line is redacted with the secrets patterns. No prompt text and no question text is written.

The run answers these questions (ROADMAP C3 and C4):

1. Does the web client show the council's question?
2. If it does, does the answer come back? How long does each step take?
3. If it does not, what is the rejection `message`, and how long until it comes? Or does the call hang?
4. Which origin kind (`PromptOrigin`) do the web client's prompts arrive with?
5. Which origin kind does a `/council` command arrive with?
6. Does a typed `/council` raise `prompt.submit` with `command` set?

## 1. A throwaway cloud environment

Create a new environment in Claude Code on the web just for this run:

- Network access must reach github.com.
- Attach one throwaway repository; an empty one is fine. Never attach `council-of-elrond` itself: a session developing the mod must not be gated by it.
- Set no plugin options. The defaults are what the run needs: enforcing mode, themed labels.

Setup script:

```sh
claude plugin marketplace add 'Deluha/council-of-elrond#probe/c3-cloud-ask-DO-NOT-MERGE'
claude plugin install council-of-elrond@council-of-elrond
```

## 2. The run

Keep a note open and write down the wall-clock time at each step. The log has timestamps, but what the screen showed and when is only in your note.

1. **The gated call.** Start a session in that environment with this first message:

   > Run exactly this shell command once with the Bash tool and tell me its result verbatim: sudo -n true. Don't retry it or work around it if it is refused.

   `sudo -n true` does nothing. The shipped rule `privileged` sends it straight to you (ask tier), so no reviewer model runs. Then watch for a question card from the council. It is headed "Loot roll" and offers "Need: allow once", "Pass: keep blocked" and "Parley: talk first".

   - **The card appears:** note how long after the call it showed, then pick "Need: allow once". If Claude Code then shows its own permission prompt for the command, allow it. Note what Claude reports.
   - **No card, and Claude reports a refusal:** note how long it took, and copy the refusal text.
   - **No card, and no reply:** wait five minutes by the clock, then press Stop. Note that you did, and when.

2. **Only if the card appeared in step 1: a dismissal.** Send the same message again, and this time close the card without answering, if the client offers a way. If it offers none, pick "Pass: keep blocked". Note which you did.
3. **A command.** Send `/council status` as a message of its own. Note whether anything shows at once. Claude may only repeat the output in its reply to your next message.
4. **A plain prompt.** Send `Go on.` and note whether Claude now repeats the `/council` output.
5. **Collect the logs.** Send:

   > Use the Read tool to print the file council-c3-probe.jsonl at the root of the repository, verbatim, in a code block. If it is not there, find it with: find / -name council-c3-probe.jsonl 2>/dev/null. Then run this and print its output verbatim in a code block: grep -h council-c3-probe /tmp/claude-code*.log | tail -60. Then run claude --version.

   The debug log was at `/tmp/claude-code.log` in the cloud session this was prepared in; if the grep finds nothing, ask Claude for `ls -la /tmp`.

## 3. Send the results back

Paste these into the session that prepared the probe, or into a new one that continues C3:

- your notes from step 2: what showed, when, what you chose, and anything unexpected;
- the probe file, the debug lines, and the version, as Claude printed them.

Then delete the throwaway environment. Ask for the probe branch to be deleted too.

## What the lines mean

| `event` | Written | Fields that matter |
| :- | :- | :- |
| `session.start` | before the first prompt | `surfaces` (the roster: `[]` means nothing draws), `surface`, `isInteractive` |
| `session.attach`, `session.detach` | a client joins or leaves | `surfaces` after the change, `surface`, `reason` |
| `prompt.submit` | every prompt, before the mod's own work | `origin.kind`, `command` (`name` and `args` for a slash command, else `null`), `isMeta`, `textLength` |
| `command.run` | `/council` | `origin.kind`, `args`, `presentation` |
| `ask.start` | the ask is attempted with no surface | `remainingMs` (the hook's own-time budget left), the `options` and `header` offered |
| `ask.answered` | the ask resolved | `elapsedMs`, `remainingMs`, `answer`, `interpreted` |
| `ask.rejected` | the ask rejected; the call gets `main`'s nobody-to-ask refusal | `elapsedMs`, `remainingMs`, `message` |
| `ask.aborted` | the call was interrupted (Stop) while the ask was in flight | `elapsedMs` |
| `tool.call.catch` | the gating hook failed or overran its budget | `kind` (`timeout`, `throw`, `re-entry`), `called`, `message` |

- `seq` counts from 1 in each hooks worker. A restart at 1 mid-session means the worker was replaced or the session reloaded.
- `remainingMs` should be about the same before and after the ask, however long the ask took: a `$` call does not count against the hook's 10 s budget. A `tool.call.catch` line with `kind` `timeout` during the ask would mean it does count.
- A headless `claude -p` check of this build on Claude Code 2.1.299 wrote `session.start` with `surfaces: []` and `prompt.submit` with origin `sdk`. Then `ask.start` with `remainingMs` 9984, then `ask.rejected` after 36 ms with `council-of-elrond: $.tool.call: no tool named "AskUserQuestion" in this session` (`remainingMs` 9982), and the call was refused with the nobody-to-ask text. `/council status` in `-p` wrote `command.run` with origin `sdk` and no `prompt.submit`.
