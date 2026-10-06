---
domain: policies
layer: standard
owner: policy-owner
compliance: C02
status: draft
---

# <ORG_NAME> — Approved Technologies

**Governed by:** `policies/org-policy.md` §3.1
**Policy Owner:** <POLICY_OWNER_EMAIL>
**Status:** draft — seeded by `gov setup`, and **yours to curate**

> ## This list is the check
>
> `gov validate` reads this file. A dependency added in a pull request that does not appear here **fails the
> check**. So this is not documentation about your stack — it *is* your stack, as far as the gate is
> concerned.
>
> The list below is a starter holding what the framework itself needs. **Replace it with yours.** Approving a
> new technology is an ordinary pull request to this file, approved by the owner of the domain it belongs to.
>
> An entry is matched by the **name a dependency manifest would use** (the npm package name, the Go module
> path, the Maven artifact). Add the name exactly as it appears there.

---

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

> Deliberately short. Every dependency is a supply-chain surface and a thing that must be upgraded
> forever — `CAN` be avoided is the default posture.

| Technology | Approved for | Notes |
|---|---|---|
| `@svayam-opensource/svm-util-log` | all logging | required by POL-423 |
| `js-yaml` | reading YAML config | |

## 5. Retired

| Technology | Retired | Reason |
|---|---|---|
| *(none yet)* | | |

An entry retired here MAY still be present in a repository that has not migrated; record the migration as a
task rather than leaving the repository silently non-compliant (POL-211).
