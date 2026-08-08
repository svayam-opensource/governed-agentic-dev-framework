# Contributing to gov-work

Build, test and layout notes for working on the CLI itself. For what the tool does and how to use
it, see [README.md](./README.md).

## Layout

ESM + CJS dual `tsc` build, `mocha` + `chai` + `tsx` tests, flat-config `eslint`,
Node 24.

```
publish/actions/ts/
  package.json          # @svayam-opensource/gov  (bin: gov, gov-work)
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

