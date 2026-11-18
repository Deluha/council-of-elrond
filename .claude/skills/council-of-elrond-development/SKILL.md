---
name: council-of-elrond-development
description: Development guidance for the council-of-elrond repository (the hard rules, conventions, architecture, testing, QA and CI, domain notes and one workflow per common task); load it for any development task here, then read the one file its table names.
---

| Task or question | File |
| :- | :- |
| A rule's full form, R1 to R15 | `references/conventions.md` |
| Code, test and document style; commit messages | `references/style.md` |
| Where things are; how `hooks/register.ts` is built | `references/architecture.md` |
| Facts about the host API (budget, `$.ui.ask`, the test kit, denial wording) | `references/host-api-facts.md` |
| Writing tests; the mutation check | `references/testing.md` |
| Verify, CI, pre-commit, the pinned build, the hooks, the guidance checker | `references/qa-ci.md` |
| The ask and deny rules, the two hooks, what the guidance checker checks and does not prove | `references/guidance-machinery.md` |
| How a session runs a brief; stop conditions; hand-over | `references/session-protocol.md` |
| Tightening or loosening; the sweep against `main` | `references/domain-gate-direction.md` |
| The classifier and the shell parser | `references/domain-classifier.md` |
| Redaction and the secrets scan | `references/domain-redaction.md` |
| Trust, the rules-file schema, session state, the audit line, the retry brake | `references/domain-state-and-trust.md` |
| Reviewers and what reaches a model | `references/domain-reviewers.md` |
| Roles, the brief template, the review loop, the model-tier table | `references/recipes-orchestration.md` |
| Grep before coding; the shared helpers; the lessons loop | `references/recipes.md` |
| The prompts that check this guidance | `references/evals.md` |
| Add or change a shipped rule or a protected path | `references/workflows/add-rule.md` |
| Teach the shell parser a wrapper, a runner or a command form | `references/workflows/teach-parser.md` |
| Change a reviewer's prompt, a preview inspection or the members | `references/workflows/change-reviewer.md` |
| Add or change a /council subcommand, a string or a /config option | `references/workflows/command-string-option.md` |
| Change the decision pipeline, the session state or the audit line | `references/workflows/change-pipeline.md` |
| Change redaction or the secrets scan | `references/workflows/change-redaction.md` |
| Change the trust rule or the rules-file schema | `references/workflows/change-trust-or-schema.md` |
| Upgrade the vendored types to a new Claude Code build | `references/workflows/upgrade-types.md` |
| Run a headless live check or probe | `references/workflows/live-check.md` |
| Update the documents; reach a checkpoint | `references/workflows/docs-and-checkpoint.md` |
| Cut a release | `references/workflows/release.md` |
