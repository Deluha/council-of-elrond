# About `claude-code.d.ts`

`claude-code.d.ts` is **not this project's work**. It is the TypeScript declaration file that
Claude Code generates for its plugin API ("function hooks"), copied here unchanged so that the mod
typechecks (`tsc -p mods`) without a running Claude Code session. Its first line names the Claude
Code version that wrote it; its header marks the surface as early access.

- **Origin:** written by the Claude Code engine (Anthropic) each time it loads a mod from a folder,
  beside that mod as `.claude-plugin/types/claude-code/index.d.ts`. That generated copy is
  gitignored in the mod folder; this one is the vendored copy the build uses.
- **Licence:** the file carries no licence notice of its own. This repository's MIT licence covers
  the project's own files and makes no claim over this one. It is redistributed here as
  generated, for the single purpose of typechecking against the API it describes.
- **Do not edit it.** Regenerate it after a Claude Code update with the `/upgrade-types` skill
  (see `docs/MAINTENANCE.md`), and record the version and the drift in `DESIGN.md`.
- `.gitattributes` marks it as generated, so it is collapsed in diffs and excluded from language
  statistics.

If Anthropic publishes these declarations under explicit terms or as a package, switch to that
and delete this copy.
