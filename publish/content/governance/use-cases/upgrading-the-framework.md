---
domain: governance
layer: use-case
owner: policy-owner
compliance: C02
status: current
---
# Upgrading the framework

Pulling new framework content into your organization, and what the test-merge gate exists to
catch.

## 10. Framework upgrades from TEMPLATE

The framework template lives at
[`svayam-opensource/governed-agentic-dev-framework`](https://github.com/svayam-opensource/governed-agentic-dev-framework).
Your org's repo was created from it (`gh repo create --template ...` or "Use
this template" on GitHub). `gov setup` configured a `template` remote
pointing at the upstream so you can pull future framework updates without
touching org-specific values.

> **The gov-work CLI is installed from npm** — `npm i -g @svayam-opensource/gov`
> (requires Node 24), never vendored into a repo. Repos carry only data
> (`org-config.yaml`, `projects/`, `knowledge/`), and you upgrade the CLI itself
> with `npm i -g @svayam-opensource/gov@latest`, independently of any project's
> data. Framework *content* (policies, scaffolded files) upgrades separately via
> `gov upgrade`, described below.

### How upgrades work (Direction A)

Framework files (`governance/policies/`, `CLAUDE.md`, `AGENTS.md`,
the per-tool rule files, etc.) contain **no org-specific values**. They use
angle-bracketed tokens like `<ORG_NAME>` and `<DEFAULT_BRANCH>` that the agent
resolves at runtime from `org-config.yaml`. After `gov setup`, the ONLY file
that diverges from upstream TEMPLATE is `org-config.yaml` (plus `projects/` as
you do project work). That makes upgrades conflict-free.

### Pulling an upgrade (v0.3.0+)

v0.3.0 introduces a framework-as-package upgrade model. Framework files live
in a `framework/` directory inside TEMPLATE; on ORG side that directory is
ephemeral — it gets fetched, applied, and deleted on every upgrade. ORG's
working tree at rest contains only org-owned content + scaffolded canonical
paths populated by the framework.

From your HOME repo on the default branch:

```bash
gov upgrade [version]      # e.g. gov upgrade v0.3.1
```

That fetches the `template` remote at the requested version (or `template/main`
if no version is given) and applies the framework update:
1. Checks out `framework/` at the requested version.
2. Applies the framework's `MANIFEST.yaml`, which governs how each shipped file
   lands:
   - For `scaffold-auto` files (scripts, CI): overwrites the canonical copy
     without asking.
   - For `scaffold-prompt` files (agent rule files, policy text): 3-way
     merges against the previous framework version. Prompts only when your
     org has customized AND the framework also changed the same file.
   - For `overlay-schema` files (`org-config.yaml`): adds new keys with
     empty values; never modifies existing values.
   - Leaves `projects/` and your custom knowledge files completely untouched.
3. Writes `.framework-version` to record what's now installed.
4. Deletes `framework/` from the working tree.
5. Stages everything for your review.

After upgrading, run `gov validate` to confirm everything still validates.

### What the test-merge gate catches

CI runs the same validators against `template/main` merges. A regression on
the upstream side (e.g. a framework file accidentally introducing a
double-curly placeholder token) fails the gate before it lands.

---
