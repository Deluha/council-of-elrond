## What and why

<!-- One paragraph. Link the issue or the roadmap item. -->

## Checks

- [ ] `claude plugin test mods/council-of-elrond` passes
- [ ] `tsc -p mods` passes
- [ ] `claude plugin validate mods/council-of-elrond` passes, and `DESIGN.md` §2 carries its `hooks:`/`calls:` lines if they changed
- [ ] New or changed behaviour has a test that fails without the change
- [ ] User-visible changes are in `mods/council-of-elrond/README.md` and `CHANGELOG.md` ("Unreleased")
- [ ] Any decision the spec or roadmap didn't cover is recorded in `DESIGN.md`
- [ ] No new text in logic: strings are in `hooks/strings.ts`
- [ ] Only `hooks/register.ts` touches `$`

## Safety

<!-- Does this change what the rules allow, how a call reaches next(e), what reaches a model, or what the audit log holds? Say so, and how it was tested. "No" is a fine answer. -->

## Verified live

<!-- What you ran with `claude -p --plugin-dir ...` in a throwaway folder, or in a terminal, and what you did not verify. -->
