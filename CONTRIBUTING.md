# Contributing to the Agentic Development Framework

Thanks for considering a contribution. This guide explains where to send changes, what they go through, and how to maximize the chance of a smooth merge.

---

## Where to send changes

This repository's `publish` branch is the open-source-ready framework — that's the upstream that adopters pull from. **All contributions target `publish`.**

If you're an adopter (you cloned this template into your own org), you typically don't contribute back upstream — you customize your fork. Contributions are about improving the framework itself: scripts, validators, policy templates, governance machinery, documentation.

---

## Quick path

1. Fork the repository (or create a feature branch in a fork).
2. Make your change. Keep it focused — one concern per PR.
3. Run the local checks (see below).
4. Open a pull request targeting the `publish` branch.
5. CI runs validators and (if you're working in the source repo) a privacy check.
6. A maintainer reviews. Address feedback by pushing more commits — don't force-push unless asked.

---

## Local checks before pushing

```bash
# Bash syntax
bash -n scripts/lib.sh scripts/*.sh prj

# Validators (schema, registry, lifecycle, cross-references)
python3 scripts/validate/run.py

# If you touched policy or guidance markdown, check links/placeholders manually
```

Failing local checks will fail in CI too — save yourself a round trip.

---

## What the test-merge gate does

When you open a PR to `publish`, two CI workflows run:

- **test-merge gate** — runs `scripts/validate/run.py` against the proposed merge commit. Catches schema and lifecycle invariant violations.
- **privacy check** (in the upstream source repo only) — ensures no per-org private values leak into the publish branch.

Both must pass before merge. They're not gating opinion — they catch concrete invariant violations that would corrupt downstream consumers' state.

---

## Conventions

### Branches

- Framework changes: `<short-topic>-<your-handle>` (e.g., `add-archive-flag-jdoe`)
- Knowledge proposals (policy/guidance edits without script changes): `knowledge-<topic>` — these can use `scripts/propose-knowledge.sh` to scaffold

### Commits

- One logical change per commit. If a commit message starts with "and", split it.
- Subject line: short imperative ("add cancel reason", "fix race in close-project"), under 72 chars.
- Body: explain *why*, not what. The diff shows what; the body explains the motivation, the alternative considered, the constraint that drove the design.

### Code style

- **Bash**: `set -euo pipefail` at the top. Quote variables. Use `[[ ]]` for tests. Source `lib.sh` from `scripts/`.
- **Python**: target Python 3.10+. PEP 8 with reasonable line length. Standard library only where possible (pyyaml is the one allowed dep).
- **Markdown**: 1 blank line between sections, GitHub-flavored markdown, no trailing whitespace.
- **YAML**: 2-space indent, no tabs. Comments explaining each top-level key are appreciated.

### Placeholders

The framework uses double-curly placeholder syntax for values substituted by `setup.sh`. The examples below are shown with spaces inside the braces so that this documentation file itself isn't subject to substitution. **In actual templated files, drop the inner spaces** — the substitution regex matches the no-space form only.

- `{{ ORG_NAME }}`, `{{ ORG_SHORT_NAME }}`, `{{ ORG_SLUG }}`, `{{ org_slug }}` (lowercase variant for branch names)
- `{{ GITHUB_ORG }}`, `{{ WORKSPACE_REPO }}`, `{{ DEFAULT_BRANCH }}`, `{{ DEFAULT_CODE_BRANCH }}`
- `{{ POLICY_OWNER_EMAIL }}`, `{{ POLICY_OWNER_GITHUB }}`, and the other role handles
- `{{ POLICY_EFFECTIVE_DATE }}`

`setup.sh` only substitutes placeholders in `*.md`, `*.yaml`, `*.yml`, and `CODEOWNERS` files. **Do not put placeholders in shell scripts or Python** — they won't get substituted and will leak through to downstream consumers as literal placeholder text. Use prose or runtime config reads instead.

### Tests

This framework doesn't have a unit test suite yet. The validators in `scripts/validate/run.py` serve as integration-level invariant checks. If you change something the validators should catch, update the validator. If you add a new lifecycle script, the test-merge gate should still produce a valid post-merge state when your script runs.

---

## Filing an issue

Use the templates in `.github/ISSUE_TEMPLATE/`:

- **Bug report** — something works incorrectly. Include reproduction steps, expected vs actual, environment.
- **Feature request** — propose a capability. Explain the use case, not just the feature.
- **Question** — ask about usage. Search existing issues first.

For security issues, see [SECURITY.md](SECURITY.md). Don't file public issues for vulnerabilities.

---

## Maintainer expectations

PRs are typically responded to within a few days. If a PR sits without feedback for more than a week, ping the maintainers in a polite comment. Some changes (especially to the policy template or compliance machinery) need broader review and may take longer.

A PR may be:

- **Merged** — congratulations
- **Requested changes** — address feedback by pushing more commits
- **Deferred** — the maintainer thinks it's reasonable but not now; will be revisited
- **Declined** — the maintainer thinks it doesn't fit the framework's scope; the rationale will be in the PR thread

Declined PRs are not personal. The framework intentionally has a small surface — fewer features means easier governance.

---

## Code of conduct

By participating, you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).
