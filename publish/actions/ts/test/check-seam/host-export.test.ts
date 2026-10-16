// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// THE SEAM IS A PUBLIC SUBPATH: `@svayam-opensource/gov/check-host` (spec 02 §5). The closed module imports its types
// and schemas from there and gets runtime helpers only through the host object, so it always runs against the gov that
// loaded it. This test packs the BUILT package (run `npm run build` first — the gate does), unpacks the tarball into an
// empty project and imports the subpath the way a consumer would: ESM `import` and CJS `require`.
import { expect } from "chai";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { plan } from "../../src/run-process.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("check-seam — @svayam-opensource/gov/check-host from a packed tarball", function () {
  this.timeout(120_000);
  let dir = "";

  before(function () {
    if (!fs.existsSync(path.join(pkgRoot, "lib", "esm", "check-seam", "public.js"))) {
      throw new Error("lib/ has no check-seam build — run `npm run build` before the tests.");
    }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gov-check-host-"));
    // npm is `npm.cmd` on Windows: spawned the way gov spawns it (PATH × PATHEXT, a .cmd through cmd.exe).
    const npm = plan("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", dir]);
    const out = execFileSync(npm.file, [...npm.args], { cwd: pkgRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsVerbatimArguments: npm.verbatim });
    const tgz = (JSON.parse(out) as { filename: string }[])[0]!.filename;
    const target = path.join(dir, "consumer", "node_modules", "@svayam-opensource", "gov");
    fs.mkdirSync(target, { recursive: true });
    // Relative paths in `dir`: Git's GNU tar on Windows reads `D:\…` as a remote host `D`.
    execFileSync("tar", ["-xzf", tgz, "-C", "consumer/node_modules/@svayam-opensource/gov", "--strip-components=1"], { cwd: dir });
    fs.writeFileSync(path.join(dir, "consumer", "package.json"), JSON.stringify({ name: "consumer", private: true }));
  });

  after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

  const run = (file: string, code: string): Record<string, unknown> => {
    const f = path.join(dir, "consumer", file);
    fs.writeFileSync(f, code);
    return JSON.parse(execFileSync(process.execPath, [f], { cwd: path.join(dir, "consumer"), encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } })) as Record<string, unknown>;
  };

  const probe = (load: string) => `${load}
const out = {
  api: h.HOST_API,
  lockOk: h.checkLockStep({ major: h.HOST_API.major, minHostMinor: 0 }).ok,
  lockBad: h.checkLockStep({ major: h.HOST_API.major + 1, minHostMinor: 0 }).ok,
  schemas: Object.keys(h.SCHEMAS).sort(),
  canon: h.canonicalJson({ b: 1, a: [true, null, "x"] }),
  sha: h.sha256Hex("abc"),
  bad: h.validate("usage-counts", { records: "x" }).length > 0,
  verifier: [h.verifyLedger, h.dirSource, h.formatBreak, h.trustRoots, h.checkWriterCert, h.verifyEd25519].every((f) => typeof f === "function"),
  root: h.segmentRoot([{ b: 1, a: 2 }, { x: "é" }]),
  zero: h.ZERO_HASH,
};
console.log(JSON.stringify(out));`;

  const expectProbe = (o: Record<string, unknown>) => {
    expect(o.api).to.have.keys("major", "minor");
    expect(o.lockOk).to.equal(true);
    expect(o.lockBad).to.equal(false);
    expect(o.schemas).to.deep.equal(["chain-entry", "gov-evidence-1", "lease-request", "seal", "usage-counts"]);
    expect(o.canon).to.equal('{"a":[true,null,"x"],"b":1}');
    expect(o.sha).to.equal("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(o.bad).to.equal(true);
    // The free verifier ships through the same subpath (E06): the writer builds with what `gov evidence verify` checks.
    expect(o.verifier).to.equal(true);
    expect(o.root).to.equal("d0f91bbac65c75e8d99bbde74afa2c791fec3265c9bbd786a92fdf870cc7b18e");
    expect(o.zero).to.equal("0".repeat(64));
  };

  it("ESM import works", () => {
    expectProbe(run("probe.mjs", probe(`import * as h from "@svayam-opensource/gov/check-host";`)));
  });

  it("CJS require works", () => {
    expectProbe(run("probe.cjs", probe(`const h = require("@svayam-opensource/gov/check-host");`)));
  });

  it("the raw JSON schemas are reachable for other languages and services", () => {
    const f = path.join(dir, "consumer", "node_modules", "@svayam-opensource", "gov", "lib", "esm", "check-seam", "schemas", "lease-request.schema.json");
    expect((JSON.parse(fs.readFileSync(f, "utf8")) as { $id: string }).$id).to.match(/lease-request/);
    const o = run("raw.mjs", `import { createRequire } from "node:module"; const r = createRequire(import.meta.url);
console.log(JSON.stringify({ id: r("@svayam-opensource/gov/check-host/schemas/usage-counts.schema.json").$id }));`);
    expect(o.id).to.match(/usage-counts/);
  });
});
