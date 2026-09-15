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
| bringing the framework into this organization | [`governance/paths/adopter.md`](governance/paths/adopter.md) |
| joining an organization that already uses it | [`governance/paths/joiner.md`](governance/paths/joiner.md) |
| working on a project today | [`governance/paths/developer.md`](governance/paths/developer.md) |
| looking something up | [`governance/paths/reference.md`](governance/paths/reference.md) |

New to the vocabulary? [`governance/specs/concepts.md`](governance/specs/concepts.md) is the
shortest path to reading the policy without stopping.

## What is where, and who owns it

The split matters, because it decides what an upgrade may overwrite.

```
governance/      The FRAMEWORK's. Replaced by `gov upgrade`.
  policies/        the rules of work, including the C01 digest every agent carries
  use-cases/       task documents — set up a machine, work a project, close one
  specs/           reference — the command surface, the vocabulary
  paths/           the four entry points above
  guidance/        templates gov reads (the project to-do list, and others)
  infrastructure/  CI/CD and publication specs
  procedures/      knowledge harvest

knowledge/       YOURS. Ships empty, and stays whatever you make it.
projects/        One folder per project, created by `gov seed`. Yours.
agent/           The session-start protocol and the per-agent harness. The framework's.
org-config.yaml  Your organization's values. An upgrade adds new keys and never touches a
                 value you set.
CODEOWNERS       GENERATED from the roles in the policy and the handles in org-config.yaml.
                 Do not edit it by hand; change the handle and re-run `gov upgrade`.
```

### `knowledge/` is deliberately empty

The framework ships **no** knowledge domains. Organize that tree however your accountability
actually runs — by SDLC phase, by product line, by business unit, by anything.

One rule applies, and it is the rule rather than a suggestion: a top-level domain exists only
once a named Owner role exists for it
([`POL-403`](governance/policies/knowledge-organization-standard.md)). Create the domain and
name its owner together, add the owner to the policy, and `CODEOWNERS` will gate it on the next
upgrade.

### What an upgrade will and will not touch

| Treatment | Meaning | Examples |
|---|---|---|
| framework-owned | overwritten, every upgrade | `governance/`, `agent/` |
| yours after the first install | never touched again | `README.md` (this file), `.github/workflows/gov-validate.yml`, `governance/policies/llm-governance.md` |
| merged | new keys added, your values kept | `org-config.yaml` |
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
