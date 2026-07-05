# @svayam-opensource/gov

The OSS governance CLI (**command `gov`**) for the Governed Agentic Development
Framework — the unit **gov-work**. Reimplemented **Bash → Node 24 / TypeScript**
(AD-6.1 conformance; PRJ-43, issue #91).

It ships as a **new** npm package rather than continuing `@svayam-opensource/prj`:
the legacy bash CLI is **frozen** at npm `0.10.0`, and `gov` starts fresh at
`1.0.0`. Installing `@svayam-opensource/gov` provides the `gov` command; the two
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
cd ts/gov-work
npm install
npm run build     # dual tsc → lib/esm + lib/cjs
npm run lint      # eslint (flat config)
npm test          # mocha + chai via tsx
npm run test:e2e  # the mandatory full-flow e2e gate (seed → task → merge)
```

## Command surface

Lifecycle: `seed · join · task · merge · sync · add-repo · close · pause · resume · cancel`.
Governance/org: `validate · manage · anchor · knowledge · onboard · org`.
Info/maintain: `list · list-all · status · doctor · deps · publish · upgrade`.
Run `gov` with no arguments for the interactive menu.

Blueprint: `units/gov-work/SDD.md`.
