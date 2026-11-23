// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// F127 G3: THE POLICY PULL REQUEST WRITER IS A PUBLIC SUBPATH, `@svayam-opensource/gov/policy-pr`, for gov-licence's
// write side. This packs the BUILT package (run `npm run build` first — the gate does), installs it into an empty
// project beside gov's own dependencies, and imports the subpath the way a consumer would: ESM and CJS.
import { expect } from "chai";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { plan } from "../../../src/run-process.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("@svayam-opensource/gov/policy-pr from a packed tarball (F127 G3)", function () {
  this.timeout(120_000);
  let dir = "";

  before(function () {
    if (!fs.existsSync(path.join(pkgRoot, "lib", "esm", "rules", "policy-pr", "public.js"))) {
      throw new Error("lib/ has no policy-pr build — run `npm run build` before the tests.");
    }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gov-policy-pr-"));
    const npm = plan("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", dir]);
    const out = execFileSync(npm.file, [...npm.args], { cwd: pkgRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsVerbatimArguments: npm.verbatim });
    const tgz = (JSON.parse(out) as { filename: string }[])[0]!.filename;
    const target = path.join(dir, "consumer", "node_modules", "@svayam-opensource", "gov");
    fs.mkdirSync(target, { recursive: true });
    execFileSync("tar", ["-xzf", tgz, "-C", "consumer/node_modules/@svayam-opensource/gov", "--strip-components=1"], { cwd: dir });
    // A consumer's npm install brings gov's dependencies; here, gov's own installed ones stand in.
    fs.symlinkSync(path.join(pkgRoot, "node_modules"), path.join(target, "node_modules"), "junction");
    fs.writeFileSync(path.join(dir, "consumer", "package.json"), JSON.stringify({ name: "consumer", private: true }));
  });

  after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

  const run = (file: string, code: string): unknown => {
    const f = path.join(dir, "consumer", file);
    fs.writeFileSync(f, code);
    return JSON.parse(execFileSync(process.execPath, [f], { cwd: path.join(dir, "consumer"), encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } }));
  };
  const probe = (load: string) => `${load}
const t = p.memTree({ "policies/VERSION": "1.0.0\\n" });
console.log(JSON.stringify({
  fns: [p.applyPolicyEdit, p.judgePolicyPr, p.planPolicyPr, p.parseRuleStore, p.inForce, p.openRows, p.parsePolicyDocument, p.requiredSectionOwners, p.parseOwnership].every((f) => typeof f === "function"),
  chapters: Object.keys(p.CHAPTERS).length,
  read: t.read("policies/VERSION"),
}));`;

  for (const [how, file, load] of [["ESM import", "probe.mjs", `import * as p from "@svayam-opensource/gov/policy-pr";`], ["CJS require", "probe.cjs", `const p = require("@svayam-opensource/gov/policy-pr");`]] as const) {
    it(`${how} works`, () => {
      expect(run(file, probe(load))).to.deep.equal({ fns: true, chapters: 8, read: "1.0.0\n" });
    });
  }
});
