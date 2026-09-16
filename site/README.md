# The install site — `gov.svayam.ai` (#231)

One static page per environment, serving `install.sh` and `install.ps1` from an address a person can
say out loud.

```bash
node site/build.mjs prod --verify     # → site/dist/prod/
node site/build.mjs uat  --verify
node site/build.mjs dev  --verify
```

`site/dist/` is build output and is not committed.

## Why it exists

Two problems, and only one of them is cosmetic.

**The `main` pin is the one that matters.** The only install URL in the tree points at
`raw.githubusercontent.com/.../main/install.sh`, so every adopter gets whatever is on `main` at the
instant they run the one-liner — including a half-merged change. The project already applies release
discipline to third-party vendors (#201, the catalog freshness check) and did not apply it to its own
front door.

**The address is unsayable**, which matters for a one-liner that *is* the product's first impression.
Peers: `sh.rustup.rs`, `get.docker.com`, `bun.sh/install`, `astral.sh/uv/install.sh`.

## Each host pins two things

That is what makes three hosts worth more than three DNS records. `site/envs.json`:

| Env | DN (derived) | Serves ref | Installs |
|---|---|---|---|
| prod | `gov.svayamtech.com` | `v1.2.2` | `@svayam-opensource/gov@1.2.2` |
| uat | `gov-uat.svayamtech.com` | `uat` | `@svayam-opensource/gov@1.2.2` |
| dev | `gov-dev.svayamtech.com` | `dev` | `@svayam-opensource/gov@1.2.2` |

All three pin the **same client**, because there is no prerelease channel to pin to: the published
package carries exactly one dist-tag (`latest → 1.2.2`) — no `next`, no `uat`, no `dev`. Pinning at
a channel that does not exist fails with `No matching version found`. They differ only in the
**script** ref until #235 gives the release line somewhere to publish prereleases.

`ref` is what the deploy checks out; the build bakes it into the page so the site states out loud
which ref it is serving. The client version is rewritten into the copied `install.sh` — `GOV_PKG` was
already overridable at `install.sh:36`, so no installer change was needed.

**Bump `prod.pkg` and `prod.ref` in the same commit that tags a release**, or the site advertises a
version nobody can install. `--verify` catches an unpinned build; it cannot catch a pin to a version
that was never published.

## Where it deploys — a catalog unit, not a hosting product

**Earlier draft recommended Cloudflare Pages. That was wrong and is withdrawn.** The organization
already runs a shared Apache web-server engine (`ws-1`) that serves per-DN vhosts, and there is a
direct precedent for exactly this shape: `iam-web`, a static bundle served by `ws-1` at
`security.svayamtech.com` (`svm-prj-work:knowledge/deployment/catalog/services.yaml`). The blocker
raised against GitHub Pages — one custom domain per repository — simply does not exist here. No new
hosting vendor, no new DNS, no new deploy mechanism.

So this is catalog unit shape **4b** from `catalog-unit-shapes.md`: `engine-content` /
`web-content`.

```yaml
- id: gov-site
  type: engine-content
  sub_type: web-content
  deps: [{ unit: ws-1, compat: ^2.4 }]
  web:
    app_domain: gov
    content: ws-1
    spa: false          # ← load-bearing; see below
    root: site/dist
    build: node site/build.mjs <env> --verify
  source:
    repo: svayam-opensource/governed-agentic-dev-framework
```

**`spa: false` is the most important line.** `spa: true` renders
`FallbackResource /index.html`, which is precisely the mechanism that answers `/install.sh` with a
web page — piping HTML into someone's shell. The `iam-web` precedent sets it true because it is an
Angular SPA. This unit must not.

Two notes for whoever wires the unit up: `source.repo` crosses orgs (the installer lives in
`svayam-opensource`, every existing unit sources from `Svayamtech`), so gov-cicd's deploy
credentials need read access there. And the DN is **derived, never declared** — prod is bare, every
other env carries `-<env>`.

### Interim: `gov.svayamtech.com`, not `gov.svayam.ai`

The DN convention hardcodes the apex, so a second SLD is not expressible yet.
**Svayamtech/910-GOV-CICD#273** requests `app_domain` + `base_domain`, and carries a second
requirement — `former_domains:`, rendering permanent path-preserving redirect vhosts — so the
eventual switch keeps existing one-liners working. `curl -fsSL` already passes `-L` and `irm`
follows redirects, so no adopter command changes.

Change `base` in `envs.json` when #273 lands.

### This cannot be deployed yet, and the build says so

`install.sh` is read from the **pinned ref**, and today:

| ref | what it has |
|---|---|
| `origin/main` | a 509-line `install.sh` — no cached-tarball support, no checksums |
| `origin/uat` | no `install.sh` at all |
| `origin/dev` | no `install.sh` at all |

So `node site/build.mjs dev` **fails on purpose** — it refuses to serve a ref that has no installer
rather than silently falling back to the working tree. The order that unblocks it:

1. #233 `main` → `dev`, #234 `dev` → `uat`, then `uat` → `main` — close the branch split.
2. Land PRJ-121 into `dev`, resolving the `install.sh` add/add conflict **toward the project
   branch** (its 623-line version has the cached tarball and the checksums; main's 509-line version
   predates both).
3. Promote `dev` → `uat` → `main`.
4. Tag (**#235**), then set `prod.ref`.

A CI job for the site is deliberately not added until step 4, because it would be a job that cannot
pass.

## What `--verify` asserts, and why

The adopter-facing command fetches `/install.sh` to a file, then runs it. The single worst outcome
is a host answering with **HTML** — a redirect notice, a 404 page, a client-side router — which is
then handed to a shell. It fails silently and confusingly. So:

- `install.sh` begins with a shebang and neither script looks like HTML;
- both pins actually applied, asserted against the **output** rather than trusting the substitution;
- no `raw.githubusercontent.com` URL for our own artefact survives;
- the page's primary command fetches to a file and does **not** pipe `curl` into `bash` — piped, a
  failed download exits 0 and installs nothing (`docs/installing.md`); the one-liner appears only
  as the CI form;
- the page carries no unsubstituted `{{TOKEN}}`, and states its host, ref and package;
- a non-prod build carries its environment banner and prod does not.

This is why the scripts are copied as plain files beside the page rather than served through anything
that could decide to be clever.

## Still to do

- **Checksums (#205).** The Node-tarball half is now done in `install.sh` (verified against
  nodejs.org's `SHASUMS256.txt`, refusing rather than warning). Publishing `install.sh`'s own hash
  is NOT done and should not be done beside the file on this host — whoever controls the host
  controls both. It belongs in the git tag / release notes, which needs #235.
- **The repo's own copies of the URL.** `install.sh` holds it in one overridable constant; the
  literal in `docs/testing-the-adopter-path.md` is a tester's command and deliberately still points
  at `raw.githubusercontent.com`, because a tester must be able to run the installer before a site
  exists.
