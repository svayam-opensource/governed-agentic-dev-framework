<!-- SPDX-License-Identifier: MIT -->
# `@svayam-opensource/gov-core`

**Where** a gov command is acting: which organisation, which governance repo, and whether this invocation
is working on a **project branch** or on **`main`**.

`gov` (gov-work), `gov-cicd` and `gov-infra` are three **independent** command-line tools. None is a plugin
of another and they share no runtime. What every one of them must nonetheless agree about is the context —
and two tools disagreeing about that means two tools quietly reading and writing *different repositories*
while reporting the same thing.

## Contents

| export | what it settles |
|---|---|
| `detectContext` | PROJECT (cwd is inside a project under `agent_work_root`) · GOVERNED · NONE |
| `contextFingerprint`, `renderBanner`, `isAcked`, `recordAck` | the banner, and the prompt shown only when the context *changes* |
| `parseOrgConfig` | the org's identity, branches, work root and service endpoints |
| `readTopLevelScalar`, `expandTilde` | the two file primitives the above needs |

## What is deliberately NOT here

**Identity and secrets.** gov-work needs no identity provider at all: its own requirements are `git config`
and `gh auth` — the user's own tools. Sessions, OIDC, the credential store and the Vault client belong to
the deploy path, so they live in a **proprietary** library shared by `gov-cicd` and `gov-infra`. Nothing of
that model is published here.

**Our grammar.** Path taxonomies, role names and `GOV_*` conventions stay in the clients. Two tests enforce
both boundaries rather than trusting them: no such symbol may appear in the exported surface, and no
organisation hostname may appear outside a comment — so an adopter's install can never be pointed at
someone else's infrastructure by a default.

## Rules for what may be added

1. It goes in only if **two or more clients must agree** about it.
2. This package holds **mechanism**; the clients hold **our grammar**.

Every export is a reason three packages might have to release together, so the surface stays small on
purpose.

## Install

```bash
npm i @svayam-opensource/gov-core
```

No runtime dependencies — a test asserts it, because a dependency here is a dependency in every client.
