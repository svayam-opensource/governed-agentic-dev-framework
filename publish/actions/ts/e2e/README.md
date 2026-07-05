# Adopter-journey e2e (clean-slate, real GitHub)

The highest-fidelity gate: a brand-new adopter's whole path, exercised against
**real GitHub** in a **fresh container** (clean slate every run), asserting a
specific outcome at each step. Run on publish / whenever `publish/content` or
`publish/actions` changes.

## Run

```bash
E2E_ORG=<throwaway-github-org> GH_TOKEN=<token> \
  publish/actions/ts/e2e/run-adopter-e2e.sh
```

- `run-adopter-e2e.sh` (host) packs the **local** gov build (tests the exact
  artifact about to publish), then `docker run --rm` a fresh `gyan-e2e-img`
  container and runs `adopter-journey.sh` inside it.
- `E2E_KEEP=1` leaves the created repos/project for inspection (skips teardown).
- `E2E_IMAGE` overrides the container image (default `gyan-e2e-img:latest`).

## Journey (each step asserts an outcome)

bootstrap (node 24 · install packed gov · `gh auth`) → create workspace repo from
template → `gov setup` → create code repo + project board + issue → `gov seed` →
`gov task` → change + `gov merge` (issue closed) → `gov knowledge propose` →
`gov close` (board closed) → **Gap-2**: `--gov-home` resolves from an unrelated
cwd → teardown (delete repos + project).

## Token scopes (classic PAT)

`repo` · `workflow` · `project` · `read:org` · `delete_repo`. The owner must be
able to create repos + projects in `E2E_ORG` (org owner, or member with repo
creation enabled; SSO-authorize the token if the org enforces SSO).
