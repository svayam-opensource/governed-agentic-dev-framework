# Adopter-journey e2e

The first-adopter path, in **two tiers** — generalized so *any* gov maintainer can
run it (nothing here depends on a personal machine, image, org, or token).

## Tier 1 — hermetic smoke (every PR, zero setup)

```bash
npm run test:adopter:smoke
```

No token, no org, no network, no Docker. Stubs `gh` and drives the **real gov
binary** over the local adopter surface — meta flags · `gov setup` · org registry ·
`gov validate` (on the shipped content) · `gov doctor` · `--gov-home`. Runs in CI
for everyone (the `smoke` job of `.github/workflows/adopter-e2e.yml`). The board/
issue lifecycle is covered hermetically by the in-process e2e (`npm run test:e2e`).

## Tier 2 — live journey (maintainer, own sandbox)

```bash
E2E_ORG=<your-throwaway-github-org> GH_TOKEN=<token> npm run test:adopter
```

The full clean-slate journey against **real GitHub**, self-cleaning:
bootstrap → workspace-from-template → `gov setup` → create repo/project/issue →
seed → task → merge (issue closed) → knowledge propose → close (board shut) →
`--gov-home` → teardown (deletes everything it created).

- **Reproducible env:** `run-adopter-e2e.sh` builds a clean image from
  `e2e/Dockerfile` (node 24 + git + gh) if `$E2E_IMAGE` (default
  `gov-adopter-e2e:latest`) isn't present — no dependency on any personal image.
- **Bring your own throwaway org.** Create a GitHub org you own and a token; the
  journey namespaces everything `gov-e2e-<runid>-*` and tears it down.
- `E2E_KEEP=1` leaves artifacts for inspection.

### Token scopes (classic PAT)

`repo` · `workflow` · `project` · `read:org` · `delete_repo`. The token owner must
be able to create repos + projects in `E2E_ORG` (org owner, or member with repo
creation enabled; SSO-authorize the token if the org enforces SSO).

## CI

`.github/workflows/adopter-e2e.yml`:
- **`smoke`** runs for everyone on every PR (no secrets).
- **`live`** runs only when the repo has secret **`GOV_E2E_TOKEN`** + variable
  **`GOV_E2E_ORG`** (a throwaway org); otherwise it **skips** (never fails), so
  forks/contributors aren't blocked. The ephemeral runner is the clean slate — the
  journey runs directly on it (no container in CI).
