# @svayam/knowledge-site (Form 1 — static knowledge site)

Track A of PRJ-010 (#39). A **Quartz v4** static-site generator that renders the
org knowledge corpus (`svm-prj-work/knowledge`, 164 docs) as a human-browsable
site — a pure **generated face** over the single source of truth.

## Hard rules

- **Content is never committed and never edited** (POL-402 / C01). `content/` is
  a build-time symlink/rsync of `svm-prj-work/knowledge`, created by
  `scripts/prepare-content.mjs`. It is git-ignored.
- The three bespoke plugins live in `quartz/plugins/svayam/`:
  - `authorityBadge.ts` — front-matter `{compliance,status,owner,layer}` → badge
    (transformer). Tolerates the stray `active` status and the one no-front-matter
    doc; never hard-fails.
  - `domainIndex.ts` — per-`domain`-FIELD generated index pages, ordered by the
    layer normativity gradient (emitter).
  - `roleBrowse.ts` — subject-led hierarchical browse with role as an orthogonal
    lens, read from the nav manifest (emitter). No-ops if the manifest is absent.

## Build

```bash
# 1. install (local to this workspace)
npm install

# 2. materialise content (symlink of the org SoT — NOT committed)
npm run prepare

# 3. build the static site to ./public
npm run build
```

`npm run serve` runs a local preview. The nav manifest path defaults to the
PRJ-010 checkout; override with `SVM_NAV_DIR`, the content source with
`SVM_PRJ_WORK` / `CONTENT_MODE`.

## Versions

- Quartz pinned to **v4.5.2** (vendored under `quartz/`).
- Node 20 (`.nvmrc`).
