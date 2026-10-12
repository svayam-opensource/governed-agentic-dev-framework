---
domain: governance
layer: path
owner: policy-owner
compliance: C02
status: current
---

# Path — Reference

Consulted, not read through. Use this when you know what you want and need the exact form of it.

**Links only, never content (Knowledge Organization Standard §5).**

## The tool

- [gov command reference](../specs/gov-command-reference.md) — every verb, and who runs it
- [The glossary](../specs/framework-specification.md#glossary) — the vocabulary

## The rules

- [How the framework works](../specs/framework-specification.md) — and `agent/harness/rule-map.md`, every rule by GOV id;
  `gov rules show <id>` prints one (a retired POL number resolves to the rule that carries it now)
- [Working on a project](working-on-a-project.md) — and the other user guides beside it, for each thing you do
- [Knowledge organization standard](../../../policies/knowledge-organization-standard.md)

## Writing a check action

For the Check Owner, and for anyone who writes a check your organization's own rules call.

- [Writing your own check action](../specs/framework-specification.md#95-checks) — the folder, `action.yaml`, what the
  script is given, what its exit code means, what keeps it safe, and why a GitHub Action check runs in CI only
- [Your catalog additions](../../../policies/catalog.yaml) — where a new action is listed

## Infrastructure

- [CI/CD spec](../specs/org_gov_repo_operations.md)
- [Knowledge publication spec](../../../policies/knowledge-publication.md)
- [gov-validate workflow reference](../../templates/gov-validate.reference.yml) — the framework's
  current CI workflow, shipped to diff against your own

## Templates

- [Guidance templates](../../templates/) — todo, preferences, repo agent, compliance, project impact
