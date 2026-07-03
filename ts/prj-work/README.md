# @svayam-opensource/prj-work

The OSS core of the `prj` governance CLI, being migrated **Bash → Node 24 / TypeScript**
(AD-6.1 conformance; see PRJ-43 issue #91). During the transition this package lives
here at `ts/prj-work/` and is built/tested independently, while the legacy Bash CLI at
the repo root keeps publishing as `@svayam-opensource/prj`. At **cutover**, the repo
root `bin/prj` is repointed to this package's compiled `lib/` entry.

## Layout

Mirrors the `prj-deploy` (prj-operate) package conventions: ESM + CJS dual `tsc`
build, `mocha` + `chai` + `tsx` tests, flat-config `eslint`, Node 24.

```
ts/prj-work/
  package.json          # @svayam-opensource/prj-work
  tsconfig.json         # ESM build → lib/esm
  tsconfig-cjs.json     # CJS build → lib/cjs
  eslint.config.ts
  src/                  # source (index.ts = entry + migration roadmap)
  test/                 # *.test.ts (mocha)
```

## Develop

```bash
cd ts/prj-work
npm install
npm run build   # dual tsc → lib/esm + lib/cjs
npm run lint    # eslint (flat config)
npm test        # mocha + chai via tsx
```

## Phases

Blueprint: `units/prj-work/SDD.md`. Phase 0 = scaffold + CI (this). Phase 1 =
`prj_resolve_gov` deterministic resolver + registry. See `src/index.ts`
(`MIGRATION_PHASES`) for the full roadmap.
