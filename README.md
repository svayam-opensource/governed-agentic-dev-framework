# Governed Agentic Development Framework

The source repository for the **`gov`** CLI and the **framework content** that adopting
organizations consume. One repo, two published artifacts.

**If you are adopting the framework, you do not start here** — you start at
**[gov.svayam.ai](https://gov.svayam.ai)**, which serves the installer and the adopter and
joiner instructions. This README is for people working *on* the framework.

## The two artifacts

| | Built from | Published as | Consumed by |
|---|---|---|---|
| **CLI** | [`publish/actions/ts`](publish/actions/ts) | npm [`@svayam-opensource/gov`](https://www.npmjs.com/package/@svayam-opensource/gov), command `gov` | one install per machine |
| **Content** | [`publish/content`](publish/content) | this repo, used as a GitHub template | `gov setup`, then `gov upgrade` |

The enterprise plugin units (`gov-catalog` · `gov-deploy` · `gov-data`, under the `gov-cicd`
umbrella) live in a separate repo and publish to `npm.svayamtech.com`.

## Layout

```
agent/
  session-protocol.md      THE protocol source. Everything an agent reads is rendered from it.
  harness-manifest.yaml    Which file each agent reads, and from which template.
  render-harness.mjs       Renders the nine harness files. Refuses to render a protocol
                           that carries no version marker.

publish/
  content/                 What an adopter's governance repo is seeded with. Its own layout is
                           the adopter's layout — see publish/content/README.md.
  actions/ts/              The Node 24 / TypeScript CLI.
  actions/deprecated/      The frozen bash CLI (@svayam-opensource/prj @ 0.10.0). Not published.

docs/                      Framework design docs, ADRs, and how to test the adopter path.
ci/                        Jenkins pipeline definitions.
.github/                   CI: build · lint · test · e2e gates, and the weekly freshness checks.
install.sh / install.ps1   The bootstrap installers served from gov.svayam.ai.
```

### One thing worth knowing before you edit anything under `agent/`

The nine harness files in `publish/content/agent/harness/` are **generated**. Edit
`agent/session-protocol.md` and re-render; never hand-edit a generated copy, which carries a
do-not-edit banner and a version marker `gov` verifies before it will launch an agent.

```bash
node agent/render-harness.mjs
```

## Develop the CLI

```bash
cd publish/actions/ts
npm install
npm run build && npm run lint && npm test
```

Four suites, in increasing cost. Run at least the first two before pushing — `lint` and
`adopter-smoke` are the two that most often catch what `npm test` does not.

| Suite | What it needs | What it covers |
|---|---|---|
| `npm test` | nothing | ~1000 unit tests |
| `bash e2e/adopter-smoke.sh` | nothing | `gov validate` against the shipped content |
| `bash e2e/journey.sh` | nothing | the interactive flows, driven through a real pty |
| `bash e2e/os-tier.sh` | docker | `install.sh` on four Linux images, from bare |

## Docs

- **[docs/operating-model.md](docs/operating-model.md)** — who does what: maintainer, admin, developer.
- **[docs/testing-the-adopter-path.md](docs/testing-the-adopter-path.md)** — how to test what an
  adopter hits *before* `gov` exists. Throwaway containers, because none of it is visible from a
  machine that already works.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — the gates, and how to add to them by drop-in.

Licensed under [MIT](LICENSE).
