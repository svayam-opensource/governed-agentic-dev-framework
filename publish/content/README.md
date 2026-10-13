# <ORG_NAME> — governance repository

This repository is `<ORG_NAME>`'s record of how work gets done here: the policies that govern
it, the knowledge it accumulates, and the projects it runs.

It was created from the Governed Agentic Development Framework and is now **yours**. Edit it,
commit to it, and raise pull requests against it like any other repository you own.

## Start here

Four entry points, one per reason you might be reading this. Each is a **consultation order** —
links in sequence, no content of its own.

| You are | Start at |
|---|---|
| bringing the framework into this organization | [`framework/common/guides/path-adopter.md`](framework/common/guides/path-adopter.md) |
| joining an organization that already uses it | [`framework/common/guides/path-joiner.md`](framework/common/guides/path-joiner.md) |
| working on a project today | [`framework/build/guides/path-developer.md`](framework/build/guides/path-developer.md) |
| looking something up | [`framework/common/guides/path-reference.md`](framework/common/guides/path-reference.md) |

New to the vocabulary? The glossary at the end of
[`framework/framework-specification.md`](framework/framework-specification.md#glossary)
is the shortest path to reading the policy without stopping.

## What is where, and who owns it

The split matters, because it decides what an upgrade may overwrite.

```
framework/       The FRAMEWORK's. Replaced by `gov upgrade`.
  framework-specification.md   how the framework works; every framework rule cites it
  rules/           the framework's rule rows and its checks catalog
  common/          what every phase shares: reference (command reference, org-config schema),
                   guides (the four entry points above and more), the exception form
  build/           building software: the developer's guides and the templates gov reads

policies/        YOURS. Seeded once, then changed only by approved pull requests.
  org-policy.md    your organization's policy; governance.yaml holds its choices
  rules/           your rule rows and checks catalog, written by `gov rules propose`
  common/          clauses every phase shares: roles, data classification, policy domains
  build/           policy.md (engineering standards, technology choices) and the approved-technologies list

knowledge/       YOURS. Ships empty, and stays whatever you make it.
projects/        One folder per project, created by `gov seed`. Yours.
agent/           The session-start protocol and the per-agent harness. The framework's.
org-config.yaml  Your organization's identity and infrastructure. Checked against
                 framework/common/reference/org-config.schema.yaml; an upgrade never touches it.
CODEOWNERS       GENERATED from the role list in policies/common/authorized-representatives.md.
                 Do not edit it by hand; change the role list and run `gov upgrade`.
```

### `knowledge/` is deliberately empty

The framework ships **no** knowledge domains. Organize that tree however your accountability
actually runs — by SDLC phase, by product line, by business unit, by anything.

One rule applies, and it is the rule rather than a suggestion: a top-level domain exists only
once a named Owner role exists for it
([framework specification §8.1](framework/framework-specification.md#81-the-knowledge-tree-is-yours)). Create the domain and
name its owner together, add the owner to the policy, and `CODEOWNERS` will gate it on the next
upgrade.

### What an upgrade will and will not touch

| Treatment | Meaning | Examples |
|---|---|---|
| framework-owned | overwritten, every upgrade | `framework/`, `agent/` |
| yours after the first install | never touched again | `README.md` (this file), `.github/workflows/gov-validate.yml`, `org-config.yaml`, `policies/governance.yaml` |
| framework-owned shape | the list of keys `org-config.yaml` may hold, checked by `gov doctor` | `framework/common/reference/org-config.schema.yaml` |
| never shipped | generated from the two above | `CODEOWNERS` |

So this file is yours. Rewrite it for your organization — the section above is a starting point,
not a fixture.

## Install and first-time setup

Not here, deliberately. Installation instructions cannot live inside the thing you install.

**[gov.svayam.ai](https://gov.svayam.ai)** serves the installer and the adopter and joiner
instructions. Once `gov` is on your machine, everything else you need is in this repository.

Already set up? The front door is one word:

```bash
gov
```

## Licence and provenance

The framework content in `governance/` and `agent/` arrived under
[MIT](https://github.com/svayam-opensource/governed-agentic-dev-framework/blob/main/LICENSE).
Everything you add is `<ORG_NAME>`'s, under whatever licence you choose.
