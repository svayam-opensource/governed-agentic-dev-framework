# @svayam-opensource/gov

The OSS governance CLI (**command `gov-work`**) for the Governed Agentic Development
Framework — the unit **gov-work**. Reimplemented **Bash → Node 24 / TypeScript**
(AD-6.1 conformance; PRJ-43, issue #91).

It ships as a **new** npm package rather than continuing `@svayam-opensource/prj`:
the legacy bash CLI is **frozen** at npm `0.10.0`, and `gov-work` starts fresh at
`1.0.0`. Installing `@svayam-opensource/gov` provides the `gov-work` command; the two
coexist so adopters migrate at their own pace.

## Layout

ESM + CJS dual `tsc` build, `mocha` + `chai` + `tsx` tests, flat-config `eslint`,
Node 24.

```
ts/gov-work/
  package.json          # @svayam-opensource/gov  (bin: gov)
  tsconfig.json         # ESM build → lib/esm
  tsconfig-cjs.json     # CJS build → lib/cjs
  eslint.config.ts
  src/                  # source (index.ts = entry + roadmap)
  test/                 # *.test.ts (mocha) — incl. test/e2e (full-flow gate)
```

## Develop

```bash
cd publish/actions/ts
npm install
npm run build     # dual tsc → lib/esm + lib/cjs
npm run lint      # eslint (flat config)
npm test          # mocha + chai via tsx (unit + coverage + in-process e2e)
npm run test:e2e  # the mandatory full-flow e2e gate (seed → task → merge)

npm run test:adopter:smoke   # hermetic adopter smoke (real gov binary, stub gh)
npm run test:adopter         # live adopter journey — needs E2E_ORG + GH_TOKEN
```

## Testing — read before adding tests

**[`test/README.md`](test/README.md) is the canonical guide.** Two required checks
gate `main` (`gov-work`, `adopter-smoke (hermetic)`), and **both grow by drop-in —
you never edit CI or branch protection to add a case:**

- **Logic / command × flag / content rules** → add a `test/**/*.test.ts` (mocha
  globs them; picked up by `gov-work`).
- **Local CLI behavior without real GitHub** (flags, `setup`, resolution,
  `--gov-home`) → drop an `e2e/smoke.d/NN-name.sh` fragment (`adopter-smoke`
  sources them in order).
- **A real-GitHub lifecycle step** → add to `e2e/adopter-journey.sh` (the gated
  live tier).

Every bug the live journey surfaces should land a cheap guard in one of the first
two so it can't regress. See `test/README.md` for the full where-does-it-go table.

## Command reference

Run `gov-work` with no arguments for the interactive menu (a categorized launcher).
Every command is reachable both directly (`gov <command>`) and via a menu path
(`gov-work` ▸ Category ▸ command).

| command | menu path | purpose |
|---|---|---|
| `setup` | Admin ▸ setup | Bootstrap a workspace: prompt org identity, write `org-config.yaml`, point `origin` at the org repo |
| `seed` | Work ▸ seed | Create a project from a GitHub Project board — workspace + branches + anchor issue |
| `join` | Work ▸ join | Join an existing project (co-dev): clone/worktree its repos on the project branch |
| `task` | Work ▸ task | Open a task sub-branch for an issue + assign it |
| `merge` | Work ▸ merge | Merge a finished task → project branch; archive; close the issue |
| `sync` | Work ▸ sync | Re-sync project branches with the latest base branches |
| `add-repo` | Work ▸ add-repo | Pull another repo into the active project |
| `close` | Work ▸ close | Close a project: knowledge gate → PR-promote to main → close board → archive |
| `pause` | Work ▸ pause | Pause an active project |
| `resume` | Work ▸ resume | Resume a paused project |
| `cancel` | Work ▸ cancel | Cancel a project: archive branches (no merge) + close board |
| `manage` | Admin ▸ manage | List projects + owners; add/remove owners (anchor-issue assignees) |
| `anchor` | Admin ▸ anchor | Show the current project's anchor issue (url · labels · owners) |
| `knowledge` | Admin ▸ knowledge | Org-knowledge lifecycle: `propose` / `submit` / `archive` |
| `onboard` | Admin ▸ onboard | Scaffold a `knowledge/` folder into an existing repo + raise a PR |
| `org` | Admin ▸ org | Multi-home registry: `add` / `use` / `list` / `remove` workspaces |
| `list` / `list-all` | Status ▸ list | List ongoing (or all) projects with owners + derived status |
| `status` | Status ▸ status | The current project's live status (board state × anchor labels) |
| `validate` | Maintain ▸ validate | Governance validator suite (protocol · knowledge · secrets · privacy · version-sync) |
| `doctor` | Maintain ▸ doctor | Health check: git/gh · workspace resolves · active org · CLI↔content version · stale layout |
| `deps` | Maintain ▸ deps | Report runtime prereqs (git · gh) + per-OS install hints |
| `upgrade` | Maintain ▸ upgrade | Sync workspace content to the published framework (`--from`/template `--pr`/`--apply`); else CLI self-update guidance |
| `bump-version` | Maintain ▸ bump-version | Bump the CLI package + content `VERSION` in lockstep |
| `publish` | Maintain ▸ publish | Pre-publish gate (version-sync); real publish stays governed |
| `catalog` `deploy` `data` `promote` `rollback` `drift` | Operate ▸ … *(only when `@svayam/gov-cicd` is installed)* | Enterprise catalog + deploy plugin commands |

Global flags: `--gov-home <path>` / `$PRJ_GOV_HOME` target an explicit workspace
(bypassing resolution). `$GOV_LICENSE` unlocks the enterprise plugin.

Blueprint: `units/gov-work/SDD.md`.
