// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * RESERVED PATHS (PRJ-121 intent 01, spec §3.11, rulings Q11 — task L08).
 *
 * `policies/deploy/unit-catalog/` (gov-cicd) and `policies/run/fleet-catalog/` (gov-infra) are reserved: named in the
 * framework specification and in `org_gov_repo_operations.md`, each with its owner — and nowhere else (Q11: no empty
 * shells, no "add your deploy policy here" line in a starter). gov creates neither.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runUpgradeSync } from "../../src/maintain/upgrade-run.js";
import { parseManifest } from "../../src/maintain/upgrade-sync.js";

const CONTENT = fileURLToPath(new URL("../../../../content/", import.meta.url));
const read = (rel: string): string => fs.readFileSync(path.join(CONTENT, rel), "utf8");

const RESERVED = [
  { path: "policies/deploy/unit-catalog/", owner: "gov-cicd" },
  { path: "policies/run/fleet-catalog/", owner: "gov-infra" },
] as const;
const NAMED_IN = ["framework/framework-specification.md", "framework/common/reference/org_gov_repo_operations.md"];

function walk(dir: string, rel = ""): string[] {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? walk(dir, r) : [r];
  });
}

describe("reserved paths — named with their owners, never created (spec 01 §3.11, Q11, L08)", function () {
  this.timeout(20000);

  for (const doc of NAMED_IN) {
    for (const r of RESERVED) {
      it(`${doc} names ${r.path} as reserved, owned by ${r.owner}`, () => {
        const line = read(doc).split("\n").find((l) => l.includes(`\`${r.path}\``));
        expect(line, `${doc} does not name \`${r.path}\``).to.not.equal(undefined);
        expect(line).to.contain(r.owner);
        expect(line!.toLowerCase()).to.contain("reserved");
      });
    }
  }

  it("no MANIFEST row ships anything under policies/deploy/ or policies/run/", () => {
    const m = parseManifest(read("MANIFEST.yaml"));
    expect(m.files.filter((e) => /^policies\/(deploy|run)\//.test(e.dst)).map((e) => e.dst)).to.deep.equal([]);
  });

  it("setup on an empty org creates neither (nor any deploy/ or run/ folder)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gov-reserved-"));
    try {
      const res = runUpgradeSync(CONTENT, dir, { apply: true, userHome: dir });
      expect(res.code, res.lines.join("\n")).to.equal(0);
      expect(fs.existsSync(path.join(dir, "policies"))).to.equal(true);
      expect(walk(dir).filter((f) => /^(policies|framework)\/(deploy|run)\//.test(f))).to.deep.equal([]);
      for (const d of ["policies/deploy", "policies/run", "framework/deploy", "framework/run"]) expect(fs.existsSync(path.join(dir, d)), d).to.equal(false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("no shipped starter policy names the reserved folders (Q11: the spec and the operations doc only)", () => {
    const starters = walk(path.join(CONTENT, "policies")).filter((f) => f.endsWith(".md"));
    for (const f of starters) {
      const text = read(`policies/${f}`);
      for (const r of RESERVED) expect(text, `policies/${f}`).to.not.contain(r.path);
    }
  });
});
