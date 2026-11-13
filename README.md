> **Who this is for:** people working *on* the framework. Adopting or joining it? Start with the install page in the [gov portal](https://portal.svayamtech.com/install). The doors are below.

# Governed Agentic Development Framework

The source repository for the **`gov`** CLI and the **framework content** that adopting
organizations consume. One repo, two published artifacts.

## Using the framework? Start here

The install page is in the **[gov portal](https://portal.svayamtech.com/install)**. Sign in, or register your
organisation, to see it. [gov.svayamtech.com](https://gov.svayamtech.com) takes you there.

You don't need an account to install. These commands, npm and winget all work without signing in.
There is one door per OS:

| OS | Door |
|---|---|
| macOS, Linux | `curl -fsSL https://gov.svayamtech.com/install.sh -o install.sh && bash install.sh` |
| Windows | `winget install Svayam.Gov` |

The Windows door goes live with the first release of the installer; until then there is no Windows door. The installer
is unsigned until a production certificate exists, so use winget: a directly downloaded `.msi` shows "Unknown publisher".
Every door ends in the same
**first-run flow**: `gov` checks git and `gh`, signs you in to GitHub, and asks whether you are
adopting, joining, or not sure. [docs/installing.md](docs/installing.md) has the detail.

## The two artifacts

| | Built from | Published as | Consumed by |
|---|---|---|---|
| **CLI** | [`publish/actions/ts`](publish/actions/ts) | npm [`@svayam-opensource/gov`](https://www.npmjs.com/package/@svayam-opensource/gov), command `gov` | one install per machine |
| **Content** | [`publish/content`](publish/content) | this repo, used as a GitHub template | the first-run flow, then `gov upgrade` |

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
  actions/deprecated/      The frozen bash CLI (prj @ 0.10.0). Not published.

docs/                      Framework design docs, ADRs, and how to test the adopter path.
ci/                        Jenkins pipeline definitions.
.github/                   CI: build · lint · test · e2e gates, and the weekly freshness checks.
install.sh / install.ps1   The bootstrap installers served from gov.svayamtech.com.
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
