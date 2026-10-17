// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// A STALE lib/ IS NEVER USED SILENTLY (PRJ-121 intent 05, Item 7a). `npm test` runs src/ through tsx and has no
// build step, but some tests (and both e2e harnesses) run the COMPILED lib/. A lib/ built before the last src/
// change used to be run without a word. The build now records a fingerprint of what it compiled (src/** and
// tsconfig*.json); `scripts/lib-fresh.mjs` recomputes it and says whether lib/ is fresh, stale or absent.
import { expect } from "chai";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { libFreshness } from "../helpers/lib-fresh.js";

const script = fileURLToPath(new URL("../../scripts/lib-fresh.mjs", import.meta.url));
const run = (root: string, ...args: string[]) =>
  spawnSync(process.execPath, [script, "--root", root, ...args], { encoding: "utf8" });

describe("lib-fresh: is the compiled lib/ the build of this src/?", () => {
  let pkg: string;
  beforeEach(() => {
    pkg = fs.mkdtempSync(path.join(os.tmpdir(), "lib-fresh-"));
    fs.mkdirSync(path.join(pkg, "src", "cli"), { recursive: true });
    fs.writeFileSync(path.join(pkg, "src", "index.ts"), "export const A = 1;\n");
    fs.writeFileSync(path.join(pkg, "src", "cli", "bin.ts"), "console.log(1);\n");
    fs.writeFileSync(path.join(pkg, "tsconfig.json"), "{}\n");
    fs.writeFileSync(path.join(pkg, "tsconfig-cjs.json"), "{}\n");
    fs.mkdirSync(path.join(pkg, "lib", "esm"), { recursive: true });
  });
  afterEach(() => fs.rmSync(pkg, { recursive: true, force: true }));

  it("a lib/ just built from this src/ is fresh (exit 0)", () => {
    expect(run(pkg, "--write").status).to.equal(0);
    const r = run(pkg);
    expect(r.status, r.stderr).to.equal(0);
    expect(libFreshness(pkg).state).to.equal("fresh");
  });

  it("a src/ file changed after the build makes lib/ stale (exit 1, says to build)", () => {
    run(pkg, "--write");
    fs.appendFileSync(path.join(pkg, "src", "cli", "bin.ts"), "console.log(2);\n");
    const r = run(pkg);
    expect(r.status).to.equal(1);
    expect(r.stderr).to.include("lib/ is stale — npm run build");
    expect(libFreshness(pkg)).to.deep.include({ state: "stale" });
  });

  it("a src/ file added, or a tsconfig changed, also makes it stale", () => {
    run(pkg, "--write");
    fs.writeFileSync(path.join(pkg, "src", "new.ts"), "export {};\n");
    expect(run(pkg).status).to.equal(1);
    run(pkg, "--write");
    fs.writeFileSync(path.join(pkg, "tsconfig-cjs.json"), "{ \"compilerOptions\": {} }\n");
    expect(run(pkg).status).to.equal(1);
  });

  it("a lib/ with no recorded fingerprint (built before this check) is stale, not trusted", () => {
    const r = run(pkg);
    expect(r.status).to.equal(1);
    expect(r.stderr).to.include("lib/ is stale — npm run build");
  });

  it("no lib/ at all is absent (exit 2) — the lib-dependent unit tests skip, they do not fail", () => {
    fs.rmSync(path.join(pkg, "lib"), { recursive: true });
    const r = run(pkg);
    expect(r.status).to.equal(2);
    expect(r.stderr).to.include("no lib/");
    expect(libFreshness(pkg).state).to.equal("absent");
  });

  it("the package's own build records the fingerprint (postbuild runs lib-fresh --write)", () => {
    const pkgJson = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")) as { scripts: Record<string, string> };
    expect(pkgJson.scripts.postbuild).to.include("scripts/lib-fresh.mjs --write");
  });
});
