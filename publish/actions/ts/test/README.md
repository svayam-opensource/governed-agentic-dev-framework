# Testing gov

Two **required** status checks protect `main`. Both are fixed *commands*, so
**coverage grows by drop-in — you never edit CI or branch protection to add cases.**

## `gov-work` — unit · build · lint · in-process e2e (every PR)

`npm test` globs **`test/**/*.test.ts`**. A new case = a new `it()` or a new
`*.test.ts` file. Auto-discovered, zero config.

| put it here | for |
|---|---|
| `test/<area>/*.test.ts` | a function's / module's behavior |
| `test/coverage/*.coverage.test.ts` | command × flag × subcommand × error combinations |
| `test/content/shipped-knowledge.test.ts` | the shipped `publish/content` must pass the validators (it walks the real tree, so new content is validated automatically) |
| `test/e2e/*.e2e.test.ts` | hermetic in-process lifecycle (seed→…→close over a fake world) |

## `adopter-smoke (hermetic)` — real gov binary, stub `gh` (every PR)

`e2e/adopter-smoke.sh` is a runner that **sources every `e2e/smoke.d/*.sh` in
sorted order**. A new case = drop a new `e2e/smoke.d/NN-name.sh` file — no runner
edit (the `gov-work` model, for bash).

Fragments share the runner's shell: use the helpers **`step` / `pass` / `fail` /
`has`** and the context **`$WS`** (the prepared adopter workspace), **`$WORK`**,
**`$CONTENT_DIR`**, with `gov` (the real binary) + a stub `gh` already on `PATH`.
No token, org, network, or Docker. Use it for **local CLI behavior** — flags,
resolution, `setup`, `org`, `validate`, `doctor`, `--gov-home`. Ordered by `NN`
prefix because later fragments build on earlier state (`20-setup` before
`40-validate`). Example — add a check for `gov deps`:

```bash
echo 'has "$(gov deps 2>&1)" "git" "gov deps lists prerequisites"' \
  > e2e/smoke.d/60-deps.sh
```

## Live journey — real GitHub, maintainer-gated (NOT required)

`e2e/adopter-journey.sh` runs the full lifecycle against real GitHub, self-cleaning.
**Real-GitHub lifecycle conditions go here** (a new step in seed→task→merge→close).
Run: `E2E_ORG=<throwaway-org> GH_TOKEN=<token> npm run test:adopter`. Gated in CI on
`GOV_E2E_TOKEN` + `GOV_E2E_ORG`; skips (never fails) when unset.

## Where does a new test go?

> **Assertable with fakes/stubs?** → a `*.test.ts` (`gov-work`) or an
> `e2e/smoke.d/NN-*.sh` fragment (`adopter-smoke`).
> **Needs real GitHub state?** → an `e2e/adopter-journey.sh` step (live, gated).

## The loop that keeps it honest

Every bug the live journey (or a report) surfaces → **fix it → add the cheapest
guard that catches it** (a `*.test.ts` for logic, a `smoke.d` fragment for local
CLI). Bugs flow *down* from the expensive live tier into fast, always-on gates and
can't regress. The required-check names (`gov-work`, `adopter-smoke (hermetic)`)
stay stable no matter how many cases you add — you only touch branch protection to
add a whole new *gate*, never a new *case*.
