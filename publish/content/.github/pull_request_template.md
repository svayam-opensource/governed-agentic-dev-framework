<!--
Thanks for contributing. A few things to confirm before submitting.

If this is a Knowledge proposal (no script/code changes, just policy or guidance edits),
delete the rest of this template and replace with a description of what you're proposing
and why.
-->

## What this changes

<!-- One or two sentences. The diff shows what; explain why. -->

## Type of change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds capability)
- [ ] Breaking change (changes existing behavior that downstream consumers depend on)
- [ ] Documentation only
- [ ] Policy / governance template change
- [ ] CI / tooling change

## Local checks

- [ ] `gov-work validate` — validators pass
- [ ] If policy change: confirmed compliance level is correct (C01/C02/C03)
- [ ] If new org value added: added to `org-config.yaml` and the `gov-work setup` prompt

## Privacy / scope

- [ ] No per-org private values (real org names, emails, project IDs) committed
- [ ] No double-curly placeholder tokens anywhere in framework files — framework reads org values from `org-config.yaml` at runtime; the only files that may diverge from upstream TEMPLATE are `org-config.yaml` and `projects/`
- [ ] If targeting `publish`: change is universal, applies to any adopting org
- [ ] If targeting `main`: change is org-specific or comes from upstream `publish` via sync

## Linked issues

<!-- "Closes #123", "Refs #456" -->

## Additional notes

<!-- Anything reviewers should know: tradeoffs, deferred work, follow-ups. -->
