<!-- SPDX-License-Identifier: MIT -->
# `@svayam-opensource/gov-core`

The things the **gov family of CLIs must agree about** — identity, the credential store, and which
org/repo/branch a command is acting on.

`gov` (gov-work), `gov-cicd` and `gov-infra` are three **independent** command-line tools. None is a plugin
of another and they share no runtime. What they do share is **state on disk and one identity**, and that is
what lives here — in a single implementation, so two clients cannot hold different ideas about it.

## Why it exists

On 2026-08-04 a successful `gov auth login` could not authenticate a governed verb, *by construction*: one
tool wrote `preferences/<os-user>/gov-auth.json` as `{accessToken, idToken, expiresAt}` and the other read
`preferences/<email>/gov-auth.json` expecting `{token, user}`. Different directory key, different schema,
nothing comparing them — and it surfaced only with **no TTY**, i.e. in automation, where nobody could
intervene.

That is not a bug you fix twice. It is a bug you delete the second copy of.

## What belongs in here — two rules

1. **Two or more clients must agree about it** — a shared file on disk, or a shared identity. One client's
   business stays in that client.
2. **This package holds MECHANISM; the grammar stays in the clients.** A keyed file store, an OIDC exchange,
   a scalar reader and an HTTP Vault client are mechanism. Path grammars, role names and `GOV_*`
   conventions are grammar — and this package is MIT and public.

Rule 2 is why `vaultLogin` takes the role as a *parameter* and knows nothing about which roles your
organisation has, and why the secret-ref taxonomy is **not** here.

Every export is a reason three packages might have to release together, so the surface stays small on
purpose.

## Contents

| area | what |
|---|---|
| **identity** | where a session lives (`authPath`, the `.current` pointer), its shape, and the OIDC exchange |
| **secrets** | the per-user credential store, the NEED/GAP model, and the Vault HTTP client |
| **location** | `org-config.yaml` parsing, and `detectContext` — PROJECT vs GOVERNED vs NONE |

## Install

```bash
npm i @svayam-opensource/gov-core
```

No runtime dependencies — a test asserts it, because a dependency here is a dependency in every client.
