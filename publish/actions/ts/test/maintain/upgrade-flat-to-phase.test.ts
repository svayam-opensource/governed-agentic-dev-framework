// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
// bridge: deleted in D01 with the flat 1.2.x moves (PRJ-121 intent 01, spec §4.1)
/**
 * FLAT 1.2.x → THE PHASE TREE, AND THE ROOT MOVE RECORD (PRJ-121 intent 01, task B05; spec §3.7, §4.3 step 6, Q5).
 *
 * svm-geneva's gov repo is what gov 1.2.3 set up: a flat `policies/` (rules.yaml, catalog.yaml, the role list and its
 * siblings at the top) and the move record at the repository ROOT. The bridge upgrade moves each of the org's flat
 * files to its §2 path BYTE FOR BYTE, and moves the root record once to `framework/upgrade-moves.json` — after which
 * the root file is gone and the record at the new path holds every relocation, old and new.
 */
import { expect } from "chai";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { runUpgradePr, runUpgradeSync, moveRecords, MOVES_FILE, LEGACY_MOVES_FILE } from "../../src/maintain/upgrade-run.js";
import { phaseTreeProblems } from "../../src/maintain/bridge/phase-tree.js";
import { fixtureFiles, fixtureRepo, materialise, SHIPPED_CONTENT, tmpDir, treeOf } from "../helpers/upgrade-fixture.js";

/** The flat 1.2.x path of each org file, and its §2 path. */
const FLAT_TO_PHASE: Readonly<Record<string, string>> = {
  "policies/rules.yaml": "policies/rules/rules.yaml",
  "policies/catalog.yaml": "policies/rules/checks-catalog.yaml",
  "policies/authorized-representatives.md": "policies/common/authorized-representatives.md",
  "policies/data-classification.md": "policies/common/data-classification.md",
  "policies/policy-domains.md": "policies/common/policy-domains.md",
  "policies/approved-technologies.md": "policies/build/approved-technologies.md",
};

const gitOk = (): boolean => { try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } };

(gitOk() ? describe : describe.skip)("flat 1.2.3 → the phase tree in one upgrade PR (B05, fixture 2)", function () {
  this.timeout(60_000);

  function upgraded(): { dir: string; g: (...a: string[]) => string; before: Map<string, string>; lines: readonly string[] } {
    const { dir, g } = fixtureRepo("flat-1.2.3");
    const before = fixtureFiles("flat-1.2.3");
    const r = runUpgradePr(SHIPPED_CONTENT, dir, { userHome: tmpDir("b05-home-"), openPr: () => "https://example.test/pr/1", govVersion: "2.0.0-next.1" });
    expect(r.code, r.lines.join("\n")).to.equal(0);
    const branch = g("branch", "--list", "gov-upgrade-*", "--format=%(refname:short)").split("\n")[0]!;
    g("merge", "-q", "--ff-only", branch);
    return { dir, g, before, lines: r.lines };
  }

  it("every flat org file arrives at its §2 path byte for byte, and nothing is left at the flat path", () => {
    const { dir, before } = upgraded();
    for (const [from, to] of Object.entries(FLAT_TO_PHASE)) {
      expect(fs.existsSync(path.join(dir, from)), `left at ${from}`).to.equal(false);
      expect(fs.readFileSync(path.join(dir, to), "utf8"), `${from} → ${to}`).to.equal(before.get(from));
    }
  });

  it("the root move record is gone; framework/upgrade-moves.json holds its relocations and this run's (§3.7)", () => {
    const { dir, before } = upgraded();
    expect(fs.existsSync(path.join(dir, LEGACY_MOVES_FILE)), "root record left").to.equal(false);
    const old = (JSON.parse(before.get(LEGACY_MOVES_FILE)!) as unknown[]).map((e) => (typeof e === "string" ? e : (e as { move: string }).move));
    const now = JSON.parse(fs.readFileSync(path.join(dir, MOVES_FILE), "utf8")) as { move: string; version: string | null }[];
    for (const m of old) expect(now.map((r) => r.move), `carried over: ${m}`).to.include(m);
    for (const [from, to] of Object.entries(FLAT_TO_PHASE)) expect(now.map((r) => r.move)).to.include(`${from} → ${to}`);
    expect(now.find((r) => r.move === "policies/rules.yaml → policies/rules/rules.yaml")!.version).to.equal("2.0.0-next.1");
    for (const r of now) expect(Object.keys(r).sort()).to.deep.equal(["move", "version"]);
  });

  it("the result is spec §2's tree — but for the build specification the spec split (L05) adds", () => {
    const { dir } = upgraded();
    expect(phaseTreeProblems(treeOf(dir), { moved: true }).filter((p) => p !== "missing framework/build/build-specification.md")).to.deep.equal([]);
  });

  it("a second upgrade moves nothing and writes no root record again", () => {
    const { dir, g } = upgraded();
    const again = runUpgradePr(SHIPPED_CONTENT, dir, { userHome: tmpDir("b05-home-"), branch: "gov-upgrade-again", openPr: () => "https://example.test/pr/2" });
    expect(again.code, again.lines.join("\n")).to.equal(0);
    const branch = g("branch", "--list", "gov-upgrade-again", "--format=%(refname:short)");
    if (branch) for (const from of Object.keys(FLAT_TO_PHASE)) expect(g("ls-tree", "--name-only", branch, "--", from), from).to.equal("");
    expect(fs.existsSync(path.join(dir, LEGACY_MOVES_FILE))).to.equal(false);
  });
});

describe("the root move record, moved once (B05, §3.7 first half)", () => {
  it("--apply: the root record's relocations reach framework/upgrade-moves.json and the root file is removed", () => {
    const dir = tmpDir("b05-apply-");
    materialise("flat-1.2.3", dir);
    const rootBefore = moveRecords(dir).map((r) => r.move);
    const r = runUpgradeSync(SHIPPED_CONTENT, dir, { apply: true, userHome: tmpDir("b05-home-"), govVersion: "2.0.0-next.1" });
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(fs.existsSync(path.join(dir, LEGACY_MOVES_FILE))).to.equal(false);
    const now = moveRecords(dir).map((x) => x.move);
    for (const m of rootBefore) expect(now).to.include(m);
    expect(r.lines.join("\n")).to.include(LEGACY_MOVES_FILE);
  });

  it("dry run: names the record's move and writes nothing", () => {
    const dir = tmpDir("b05-dry-");
    materialise("flat-1.2.3", dir);
    const r = runUpgradeSync(SHIPPED_CONTENT, dir, { apply: false });
    expect(r.lines.join("\n")).to.include(`${LEGACY_MOVES_FILE} → ${MOVES_FILE}`);
    expect(fs.existsSync(path.join(dir, LEGACY_MOVES_FILE))).to.equal(true);
    expect(fs.existsSync(path.join(dir, MOVES_FILE))).to.equal(false);
  });

  it("a workspace with only the root record (nothing else to upgrade) still gets it moved", () => {
    const dir = tmpDir("b05-only-");
    fs.writeFileSync(path.join(dir, LEGACY_MOVES_FILE), JSON.stringify(["a/ → b/"]));
    const r = runUpgradeSync(SHIPPED_CONTENT, dir, { apply: true, userHome: tmpDir("b05-home-"), seed: false });
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(fs.existsSync(path.join(dir, LEGACY_MOVES_FILE))).to.equal(false);
    expect(moveRecords(dir)).to.deep.equal([{ move: "a/ → b/", version: null }]);
  });
});
