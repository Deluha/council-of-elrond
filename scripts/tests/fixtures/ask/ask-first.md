## Ask first

Edits prompt (path-gated in `.claude/settings.json`; the same paths head the safety-boundary block of `.github/CODEOWNERS`):

- Classifier and shipped rules: `/mods/council-of-elrond/hooks/rules/**` `/mods/council-of-elrond/hooks/config/defaults.ts`
- Trust and schema: `/mods/council-of-elrond/hooks/config/trust.ts` `/mods/council-of-elrond/hooks/config/schema.ts`
- Redaction: `/mods/council-of-elrond/hooks/redact.ts` `/mods/council-of-elrond/hooks/members/gollum.ts`
- Manifests: `/mods/council-of-elrond/.claude-plugin/plugin.json` `/.claude-plugin/marketplace.json`
- Automation: `/.github/**` `/.githooks/**` `/scripts/**`
- Policy and the guidance machinery: `/SECURITY.md` `/LICENSE` `/.claude/settings.json`

Stop and ask (behaviour-gated; a path rule would prompt too often):

- Any loosening: fewer calls ask or are refused, less is redacted, even as a side effect.
- The pass-through and the fail-closed catch in `hooks/register.ts`; one `tool.call` hook, never a `tool.check` hook.
- Session state shape and migration: `hooks/state.ts`, `types/index.d.ts`.
- The audit line format: `hooks/audit.ts`.
- The retry brake and the denial wordings: `hooks/elrond/operations.ts`.
- What reaches a model or starts a process: `hooks/members/shared.ts`, `hooks/members/brief.ts`, `hooks/members/galadriel.ts`, `hooks/elrond/escalation.ts`, `hooks/elrond/refusal.ts`, `hooks/elrond/suggest.ts`, `hooks/elrond/chat.ts`.
- A new `/council` command, option or configuration file: `hooks/elrond/commands.ts`.
- Binding decisions in the roadmap, and `mods/council-of-elrond/SPEC.md`.
- A version bump, a release heading in `CHANGELOG.md`, or a tag.
- A headless child run that makes model requests.
- Scheduled-routine or cloud-environment setup.
- Pushing to `main` or merging.
