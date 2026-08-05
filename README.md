# Governed Agentic Development Framework

The source repo for the **`gov-work`** governance CLI and the **framework content** that
adopting organizations consume. One repo, two published artifacts.

## Layout

```
agent/            Authoring source for the agent harness (session-protocol,
                  harness-manifest, .claude, .cursor). Renders into publish/content.
docs/             Framework documentation (design docs, operating model, ADRs) +
                  assets + community health (SECURITY, CONTRIBUTING, CODE_OF_CONDUCT,
                  CODEOWNERS).
publish/
  content/        The framework CONTENT adopters consume (policies, knowledge
                  starters, the rendered harness, org-config template, VERSION).
  actions/
    ts/           The Node 24 / TypeScript CLI → npm @svayam-opensource/gov (cmd `gov-work`).
    deprecated/   The frozen legacy bash CLI (@svayam-opensource/prj @ 0.10.0) —
                  archived, not published.
ci/               Jenkins pipeline definitions.
.github/          Active CI (node-ci: build · lint · test · e2e gate).
```

## The two artifacts

- **CLI — [`publish/actions/ts`](publish/actions/ts)** → npm **`@svayam-opensource/gov`**
  (command `gov-work`), Node 24 / TypeScript. Install: `npm i -g @svayam-opensource/gov`.
  The legacy bash `@svayam-opensource/prj` is **frozen** at `0.10.0`.
- **Content — [`publish/content`](publish/content)** → the policies, knowledge
  starters, and agent harness adopters pull via `gov-work upgrade`.

The enterprise plugin units (`gov-catalog` · `gov-deploy` · `gov-data`, the
`gov-cicd` umbrella) live in a separate repo and publish to `npm.svayamtech.com`.

## Docs

- **[docs/operating-model.md](docs/operating-model.md)** — who does what (maintainer · admin · developer).
- **[docs/](docs)** — framework design docs, ADRs, session-start protocol.

## Develop the CLI

```bash
cd publish/actions/ts
npm install
npm run build && npm run lint && npm test   # incl. the full-flow e2e gate
```

Contributing / adding tests: **[CONTRIBUTING.md](CONTRIBUTING.md)** — both required gates (`gov-work`, `adopter-smoke`) grow by drop-in; see also [`publish/actions/ts/test/README.md`](publish/actions/ts/test/README.md).

Licensed under [MIT](LICENSE).
