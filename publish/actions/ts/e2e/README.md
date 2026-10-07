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

**Drop-in:** `adopter-smoke.sh` sources every `e2e/smoke.d/*.sh` in order — add a
check = drop a new `e2e/smoke.d/NN-name.sh` (no runner edit). See `test/README.md`.

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

**`delete_repo` is required**, not optional: without it every run leaks its repos
into the sandbox (the first live run, 2026-10-07, left `rmj-…-gov` / `rmj-…-app`).
Both live journeys read the token's scopes at START (`gh api -i user` →
`x-oauth-scopes`, `e2e/token-scopes.sh`); a token without `delete_repo` gets a
`::warning::` naming the scope and the repos it will leak, and the run carries on.
A fine-grained token has no scope header — the journey says it cannot tell; it
needs **Administration: read and write** on the sandbox's repositories. Teardown
ends by listing exactly what it could not delete. Check a token by hand with
`gh api -i user | grep -i x-oauth-scopes`.

## CI

`.github/workflows/adopter-e2e.yml`:
- **`smoke`** runs for everyone on every PR (no secrets).
- **`live`** runs only when the repo has secret **`TESTBED_BOT_PAT`** + variable
  **`TESTBED_SANDBOX_ORG`** (a throwaway org); otherwise it **skips** (never fails)
  and names what is missing, so forks/contributors aren't blocked. The ephemeral
  runner is the clean slate — both journeys run directly on it (no container in CI).
  On a PR it runs only when the base is `dev` or `main`.

## Tier 3 — rule-model journey (`rule-model-journey.sh`)

The 2026-10-07 sandbox run, scripted. Two ephemeral private repos `rmj-<run>-gov` /
`rmj-<run>-app`; every workflow installs the **packed tarball** under test. Asserts:
(a) a workflows-only PR passes GOV-FRM-455/467/468 · (b) a direct push opens a
GOV-FRM-040 `gov-violation` issue for the Policy Owner · (c) a policy prose PR is
`unreviewed` in GOV-FRM-467 and GOV-FRM-468 proposes · (d) the bot's follow-up run
is approved through the API and GOV-FRM-467 passes · (e) a soft merge with a red
check opens a violation record · (f) the code repo reads the gov repo's rules
through the sandbox App. Propose uses a **stub `command` model** (fixed reply, no
key); the real model runs only on `workflow_dispatch` with `real_model: true`.

```bash
bash e2e/rule-model-journey.sh --dry-run   # hermetic: prints every gh/git/gov call, makes none
```

### One-time human setup (the framework repo's settings)

1. **The sandbox App** — once, by an owner of the sandbox org (`svayam-e2e`), in a
   gov workspace for that org: `gov app setup`, then Create and Install on GitHub
   (all repositories is simplest; otherwise the journey adds its repos to the
   installation through the API). The App made in the 2026-10-07 manual run can be
   reused — skip this step if it exists.
2. **Give the framework repo its credentials** — `gov app setup` stores the key only
   in the sandbox, so: on the App's settings page copy the **Client ID**, and click
   **Generate a private key** (downloads a `.pem`). Then, from the framework repo:
   ```bash
   gh secret set GOV_E2E_APP_CLIENT_ID   --body <client-id>
   gh secret set GOV_E2E_APP_PRIVATE_KEY < ~/Downloads/<app>.private-key.pem && rm ~/Downloads/<app>.private-key.pem
   ```
   The journey copies both as **repo** secrets onto its ephemeral repos (GitHub Free:
   org secrets never reach private repos). Without them, (f) is skipped with a notice;
   nothing fails.
3. **`GEMINI_API_KEY`** in the framework repo's secrets — used only by a manual
   run (Actions → adopter-e2e → Run workflow → `real_model`).
4. **`TESTBED_BOT_PAT`** (classic: `repo`, `workflow`, `project`, `read:org` **and
   `delete_repo`** — REQUIRED, or every run leaks its repos; its owner is an org owner
   of the sandbox, so it can add repos to the App installation) and the variable
   `TESTBED_SANDBOX_ORG`. The token that ran on 2026-10-07 lacked `delete_repo`:
   as its owner, github.com → Settings → Developer settings → Personal access tokens
   (classic) → the token → tick `delete_repo` → Update token (the value is unchanged,
   so the secret needs no update). Delete any `rmj-*` / `gov-e2e-*` repos it left in
   the sandbox; the rule-model journey also sweeps `rmj-*` leftovers older than two
   hours once it can delete.
