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

- [ ] `bash -n scripts/lib.sh scripts/*.sh prj` — no syntax errors
- [ ] `python3 scripts/validate/run.py` — validators pass
- [ ] If shell-script change: tested the affected script(s) manually
- [ ] If policy change: confirmed compliance level is correct (C01/C02/C03)
- [ ] If new placeholder added: also added to `setup.sh` substitutions

## Privacy / scope

- [ ] No per-org private values (real org names, emails, project IDs) committed
- [ ] No `{{PLACEHOLDER}}` left in shell scripts (`setup.sh` only substitutes `.md`/`.yaml`/`CODEOWNERS`)
- [ ] If targeting `publish`: change is universal, applies to any adopting org
- [ ] If targeting `main`: change is org-specific or comes from upstream `publish` via sync

## Linked issues

<!-- "Closes #123", "Refs #456" -->

## Additional notes

<!-- Anything reviewers should know: tradeoffs, deferred work, follow-ups. -->
