# Contributing

Two artifacts live here (see the [README](README.md)): the **CLI**
(`publish/actions/ts` → `@svayam-opensource/gov-work`) and the **content**
(`publish/content` → policies, knowledge, agent harness). Change either; both are
gated the same way.

## The gates (what must pass before `main`)

Two **required** status checks, both of which **grow by drop-in — you never edit
CI or branch protection to add a test case:**

| check | command | grows by dropping in |
|---|---|---|
| **`gov-work`** | `npm test` (unit · coverage · in-process e2e) + build + lint | a `publish/actions/ts/test/**/*.test.ts` file |
| **`adopter-smoke (hermetic)`** | real `gov-work` binary over a stub `gh` (no token/org/network) | a `publish/actions/ts/e2e/smoke.d/NN-name.sh` fragment |

A third tier — the **live adopter journey** (`e2e/adopter-journey.sh`, real GitHub,
maintainer-gated) — is *not* required; it's where real-GitHub lifecycle steps go.

## Adding a test or check (developers **and** agents)

Decide by dependency, then drop a file in — no config to touch:

- **Assertable with fakes/stubs?**
  - logic, a command × flag × error, a content rule → **`test/**/*.test.ts`**
  - local CLI behavior (flags, `setup`, resolution, `--gov-home`, `validate`) →
    **`e2e/smoke.d/NN-*.sh`** (uses the `step`/`pass`/`fail`/`has` helpers + `$WS`)
- **Needs real GitHub state?** → a step in **`e2e/adopter-journey.sh`**.

**The full guide, with the where-does-it-go table and examples, is
[`publish/actions/ts/test/README.md`](publish/actions/ts/test/README.md) — read it
before adding tests.**

## The discipline

Every bug the live journey (or a report) surfaces: **fix it, then land the cheapest
guard that catches it** (a `*.test.ts` for logic, a `smoke.d` fragment for local
CLI). Bugs flow *down* from the expensive live tier into fast, always-on gates and
can't regress. The check names stay stable, so coverage grows without ever touching
branch protection.

## Local commands

```bash
cd publish/actions/ts
npm install && npm run build && npm run lint && npm test   # the gov-work gate
npm run test:adopter:smoke                                 # the adopter-smoke gate
E2E_ORG=<throwaway-org> GH_TOKEN=<token> npm run test:adopter   # live (bring your own sandbox)
```
