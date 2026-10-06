---
domain: policies
layer: standard
owner: policy-owner
compliance: C02
status: draft
---

# <ORG_NAME> — Approved Technologies

**Document:** Approved Technologies
**Policy Owner:** <POLICY_OWNER_EMAIL>
**Status:** draft — seeded by `gov setup`, and **yours to curate**

> ## This list is yours, and it is what the check reads
>
> gov created this file once and will never overwrite it. The entries below are a starter: the few
> technologies the framework itself is built with. **Replace them with your own.** Removing an entry you do not
> use is the expected first act, not a deviation.
>
> `policies/org-policy.md` section 3 says that a technology not on this list is introduced only with an
> approved exception. A check can hold that rule up: when a pull request adds a dependency, the check looks for
> the dependency's name in this file. So this file is not a description of your stack. As far as that check is
> concerned, it *is* your stack.
>
> Approving a new technology is an ordinary pull request to this file, approved by the owner of the domain it
> belongs to.

---

## How to write an entry

Write each technology under the **name its dependency manifest uses**: the npm package name, the Go module
path, the Maven artifact, the name in a Python requirements file. Write it exactly as it appears there.

The check matches a name **anywhere in this file**, as a whole word. Two things follow from that:

- Do not mention a technology you have not approved, not even as an example of something to avoid. A name
  written anywhere here reads as approved.
- An entry moved to the "Retired" table below still appears in the file, so the check still accepts it. That
  is what lets a repository keep building while it migrates away. When the migration is done everywhere,
  delete the row.

## 1. Languages and runtimes

| Technology | Approved for | Notes |
|---|---|---|
| TypeScript · Node.js LTS | services, CLIs, tooling | the framework's own stack |
| Python 3.12+ | data work, scripting | |
| Bash | glue and CI steps only | anything with branching logic belongs in a real language |

## 2. Testing

| Technology | Approved for |
|---|---|
| mocha · chai | TypeScript unit tests |
| pytest | Python tests |
| expect / pty harnesses | end-to-end terminal journeys |

## 3. Build, lint and CI

| Technology | Approved for |
|---|---|
| eslint (flat config) | TypeScript linting |
| tsc | TypeScript builds |
| GitHub Actions | CI |

## 4. Runtime dependencies

Keep this section short on purpose. Every runtime dependency is something an attacker can reach through your
supply chain, and something somebody has to keep upgrading for as long as the code lives. Avoiding a new one
is the strong default; add one when the alternative is clearly worse, and say why in the pull request.

| Technology | Approved for | Notes |
|---|---|---|
| `@svayam-opensource/svm-util-log` | all logging | the framework requires it of every gov client; your organization may require it of its own code too |
| `js-yaml` | reading YAML config | |

## 5. Retired

| Technology | Retired | Reason |
|---|---|---|
| *(none yet)* | | |

A repository that still uses a retired technology always has a task recording its migration, so that the gap
is visible and has an owner. Leaving a repository on a retired technology with no such task needs an approved
exception (`policies/org-policy.md` section 3.2).
