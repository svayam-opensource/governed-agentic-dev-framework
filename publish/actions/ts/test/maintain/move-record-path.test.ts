// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE MOVE RECORD LIVES UNDER `framework/` (PRJ-121 intent 01, spec §3.7, Policy Owner ruling Q5).
 *
 * `framework/upgrade-moves.json`, listed in the MANIFEST's `generated:` list: never shipped, never retired, written
 * only by `gov upgrade`, and — with `--pr` — only inside the upgrade pull request. Each entry is `{move, version}`.
 * (The one-time move of a root `.gov-upgrade-moves.json` is the bridge's, B05.)
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseManifest, expandEntries, planUpgrade } from "../../src/maintain/upgrade-sync.js";
import { runUpgradeSync, runUpgradePr, MOVES_FILE, doneMoves } from "../../src/maintain/upgrade-run.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));
const put = (root: string, rel: string, text: string): void => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const read = (root: string, rel: string): string | null => { try { return fs.readFileSync(path.join(root, rel), "utf8"); } catch { return null; /* absent */ } };
const ID = "old/snap/ → new/snap/";

const MANIFEST = [
  "files:",
  "  - { src: VERSION, dst: VERSION, mode: scaffold-auto }",
  "  - { src: framework/, dst: framework/, mode: scaffold-auto }",
  "moves:",
  "  - { from: old/snap/, to: new/snap/, mode: move }",
  "generated:",
  "  - framework/upgrade-moves.json   # the move record",
  "retire:",
  "  - framework/upgrade-moves.json",
  "",
].join("\n");

function content(): string {
  const c = tmp("moverec-content-");
  put(c, "MANIFEST.yaml", MANIFEST);
  put(c, "VERSION", "2.0.0\n");
  put(c, "framework/rules/rules.yaml", "rules: []\n");
  // A content tree that (wrongly) carries a record of its own: it must never reach an org.
  put(c, "framework/upgrade-moves.json", "[\"shipped → never\"]\n");
  return c;
}

describe("the move record — framework/upgrade-moves.json (spec §3.7, Q5)", function () {
  this.timeout(30000);

  it("lives at framework/upgrade-moves.json", () => {
    expect(MOVES_FILE).to.equal("framework/upgrade-moves.json");
  });

  it("the MANIFEST parser reads the generated: list", () => {
    expect(parseManifest(MANIFEST).generated).to.deep.equal(["framework/upgrade-moves.json"]);
  });

  it("the shipped MANIFEST lists it under generated:", () => {
    const m = parseManifest(fs.readFileSync(path.join(repoRoot, "publish/content/MANIFEST.yaml"), "utf8"));
    expect(m.generated).to.include("framework/upgrade-moves.json");
  });

  it("a generated: entry is never shipped — not even by a directory row that covers it", () => {
    const m = parseManifest(MANIFEST);
    const dsts = expandEntries(m, ["VERSION", "framework/rules/rules.yaml", "framework/upgrade-moves.json"]).map((e) => e.dst);
    expect(dsts).to.include("framework/rules/rules.yaml");
    expect(dsts).to.not.include("framework/upgrade-moves.json");
  });

  it("a generated: entry is never retired by name", () => {
    const m = parseManifest(MANIFEST);
    const entries = expandEntries(m, ["VERSION", "framework/rules/rules.yaml"]);
    const files: Record<string, string> = { "VERSION": "1.0.0\n", "org-config.yaml": "x: 1\n", "framework/rules/rules.yaml": "rules: []\n", "framework/upgrade-moves.json": "[]\n" };
    const plan = planUpgrade(entries, { readContent: () => "2.0.0\n", readAdopter: (r) => files[r] ?? null, adopterPaths: () => Object.keys(files) }, [], m.retire, [], { generated: m.generated });
    expect(plan.actions.filter((a) => a.kind === "retire").map((a) => a.dst)).to.deep.equal([]);
  });

  it("a retired DIRECTORY that holds the record goes, and the record stays", () => {
    const c = tmp("moverec-oldworld-content-");
    put(c, "MANIFEST.yaml", "files:\n  - { src: VERSION, dst: VERSION, mode: scaffold-auto }\nmoves:\n  - { from: old/snap/, to: new/snap/, mode: move }\n");
    put(c, "VERSION", "2.0.0\n");
    const ws = tmp("moverec-oldworld-ws-");
    put(ws, "org-config.yaml", "x: 1\n");
    put(ws, "framework/bin/old.sh", "echo vendored\n");   // the old world's vendored framework/ — retired
    put(ws, "old/snap/a.md", "A\n");
    const r = runUpgradeSync(c, ws, { apply: true, govVersion: "2.0.0" });
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(read(ws, "framework/bin/old.sh")).to.equal(null);
    expect(JSON.parse(read(ws, MOVES_FILE)!)).to.deep.equal([{ move: ID, version: "2.0.0" }]);
  });

  it("gov upgrade --apply writes it at the new path, as {move, version} entries, and nothing at the root", () => {
    const c = content(), ws = tmp("moverec-ws-");
    put(ws, "old/snap/a.md", "A\n");
    const r = runUpgradeSync(c, ws, { apply: true, govVersion: "2.0.0" });
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(JSON.parse(read(ws, "framework/upgrade-moves.json")!)).to.deep.equal([{ move: ID, version: "2.0.0" }]);
    expect(read(ws, ".gov-upgrade-moves.json")).to.equal(null);
    expect(doneMoves(ws)).to.deep.equal([ID]);
  });

  it("is written only by an upgrade that moved something: a dry run, a no-move upgrade and setup's seed write none", () => {
    const c = content();
    const dry = tmp("moverec-dry-");
    put(dry, "old/snap/a.md", "A\n");
    runUpgradeSync(c, dry, { apply: false });
    expect(read(dry, MOVES_FILE)).to.equal(null);
    const none = tmp("moverec-none-");
    runUpgradeSync(c, none, { apply: true });
    expect(read(none, MOVES_FILE), "nothing moved, so no record — and the content's copy is never shipped").to.equal(null);
    const seeded = tmp("moverec-seed-");
    runUpgradeSync(c, seeded, { apply: true, seed: true });
    expect(read(seeded, MOVES_FILE)).to.equal(null);
  });

  it("gov upgrade --pr writes it only inside the upgrade pull request, at the new path", () => {
    const c = content();
    const remote = tmp("moverec-remote-");
    execFileSync("git", ["init", "-q", "--bare", remote]);
    const ws = tmp("moverec-pr-");
    const g = (...a: string[]): string => execFileSync("git", ["-C", ws, ...a], { encoding: "utf8" }).trim();
    g("init", "-q", "-b", "main"); g("config", "user.email", "t@example.com"); g("config", "user.name", "t");
    g("remote", "add", "origin", remote);
    put(ws, "VERSION", "1.0.0\n");
    put(ws, "org-config.yaml", 'github_org: "acme"\n');
    put(ws, "old/snap/a.md", "A\n");
    g("add", "-A"); g("commit", "-qm", "seed");
    const r = runUpgradePr(c, ws, { userHome: tmp("moverec-home-"), openPr: () => "https://example.test/pr/1", govVersion: "2.0.0" });
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(JSON.parse(g("show", "gov-upgrade-2.0.0:framework/upgrade-moves.json"))).to.deep.equal([{ move: ID, version: "2.0.0" }]);
    expect(g("ls-tree", "--name-only", "gov-upgrade-2.0.0")).to.not.include(".gov-upgrade-moves.json");
    expect(read(ws, MOVES_FILE), "the default branch's working tree has no record — it arrives with the PR").to.equal(null);
  });

  it("keeps working for a repo that still has only the root record (until the bridge moves it): those moves stay done", () => {
    const c = content(), ws = tmp("moverec-legacy-");
    put(ws, ".gov-upgrade-moves.json", JSON.stringify([ID, { move: ID, version: "1.2.3" }], null, 2));
    put(ws, "old/snap/ours.md", "the org's, put back\n");
    const r = runUpgradeSync(c, ws, { apply: true, govVersion: "2.0.0" });
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(read(ws, "old/snap/ours.md")).to.equal("the org's, put back\n");
    expect(doneMoves(ws)).to.deep.equal([ID]);
  });
});
