// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE PHASE TREE (PRJ-121 intent 01, spec §2 and §3.1 — task L02).
 *
 * `gov setup` seeds a new governance repo from the content gov carries, through the same planner `gov upgrade` uses
 * (cli/main.ts: runUpgradeSync on the freshly created clone). Seeding the shipped content into an EMPTY directory must
 * produce exactly the tree in test/content/fixtures/phase-tree.txt — nothing missing, nothing extra. The fixture is
 * spec §2 written out file by file; a task that changes the tree changes the fixture in the same commit.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runUpgradeSync } from "../../src/maintain/upgrade-run.js";
import { parseManifest } from "../../src/maintain/upgrade-sync.js";

const CONTENT = fileURLToPath(new URL("../../../../content/", import.meta.url));
const FIXTURE = fileURLToPath(new URL("./fixtures/phase-tree.txt", import.meta.url));

function walk(dir: string, rel = ""): string[] {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? walk(dir, r) : [r];
  });
}

const fixture = (): string[] => fs.readFileSync(FIXTURE, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

describe("the phase tree — what setup seeds into an empty org (spec 01 §2, L02)", function () {
  this.timeout(20000);

  it("seeding the shipped content into an empty directory produces exactly fixtures/phase-tree.txt", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gov-phase-tree-"));
    try {
      const res = runUpgradeSync(CONTENT, dir, { apply: true, userHome: dir });
      expect(res.code, res.lines.join("\n")).to.equal(0);
      const seeded = walk(dir).sort();
      const want = fixture().sort();
      const missing = want.filter((p) => !seeded.includes(p));
      const extra = seeded.filter((p) => !want.includes(p));
      expect({ missing, extra }, "the seeded tree differs from spec §2 (test/content/fixtures/phase-tree.txt)").to.deep.equal({ missing: [], extra: [] });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("the fixture is sorted and has no duplicates, so a diff to it reads cleanly", () => {
    const f = fixture();
    expect(f).to.deep.equal([...new Set(f)].sort());
  });

  it("src = dst on every MANIFEST row: the content tree IS the org tree (§3.1)", () => {
    const m = parseManifest(fs.readFileSync(path.join(CONTENT, "MANIFEST.yaml"), "utf8"));
    const differ = m.files.filter((e) => e.src !== e.dst && !(e.src === "org-config.example.yaml" && e.dst === "org-config.yaml"));
    expect(differ.map((e) => `${e.src} → ${e.dst}`)).to.deep.equal([]);
  });

  it("nothing is created at a reserved path (policies/deploy/, policies/run/ — §3.11)", () => {
    const f = fixture();
    expect(f.filter((p) => p.startsWith("policies/deploy/") || p.startsWith("policies/run/"))).to.deep.equal([]);
  });
});
