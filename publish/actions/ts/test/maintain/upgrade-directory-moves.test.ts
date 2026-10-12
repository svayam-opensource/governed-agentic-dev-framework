// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * A DIRECTORY MOVE IS ONE RELOCATION, RECORDED ONCE (PRJ-121, 2026-10-12).
 *
 * Until now a directory move was recorded one entry per file it moved, never as the folder: a second upgrade would
 * move a file the org had since put back under the old folder deliberately. The coming restructure (framework/ and
 * policies/ split into phase folders) is made of directory moves, so they must hold the "applied once" promise:
 * recorded as the directory, never re-applied under the old folder, an older per-file record still honoured,
 * a destination that already exists refused rather than merged, and a source that is not there nothing to do.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseManifest, planUpgrade, applyUpgrade, directoryMoveDone, type PlanReaders, type ManifestMove } from "../../src/maintain/upgrade-sync.js";
import { runUpgradeSync, doneMoves, moveRecords, MOVES_FILE } from "../../src/maintain/upgrade-run.js";

const DIR_MOVE: ManifestMove = { from: "old/snap/", to: "new/snap/", mode: "move" };
const ID = "old/snap/ → new/snap/";

function plan(store: Record<string, string>, moves: readonly ManifestMove[], done: string[] = []) {
  const r: PlanReaders = { readContent: () => null, readAdopter: (p) => store[p] ?? null, adopterPaths: () => Object.keys(store), doneMoves: () => done };
  return planUpgrade([], r, moves);
}
function apply(store: Record<string, string>, p: ReturnType<typeof planUpgrade>, recorded: string[]) {
  return applyUpgrade(p, {
    readContent: () => null, readAdopter: (k) => store[k] ?? null,
    writeAdopter: (k, t) => { store[k] = t; }, removeAdopter: (k) => { delete store[k]; },
    recordMove: (id) => recorded.push(id),
  });
}

describe("upgrade — a directory move is recorded once, as the directory", () => {
  it("moves every file under the folder, keeping the structure, and records ONE entry: the directory", () => {
    const store: Record<string, string> = { "old/snap/1.0/a.md": "A\n", "old/snap/1.0/b.md": "B\n", "old/snap/top.md": "T\n" };
    const recorded: string[] = [];
    const res = apply(store, plan(store, [DIR_MOVE]), recorded);
    expect(store).to.deep.equal({ "new/snap/1.0/a.md": "A\n", "new/snap/1.0/b.md": "B\n", "new/snap/top.md": "T\n" });
    expect(recorded, "the folder, once — no per-file records").to.deep.equal([ID]);
    expect(res.refused).to.deep.equal([]);
  });

  it("a recorded directory move is never re-applied: a file the org put back under the old folder stays", () => {
    const store: Record<string, string> = { "new/snap/1.0/a.md": "A\n", "old/snap/ours.md": "the org put this here on purpose\n" };
    expect(plan(store, [DIR_MOVE], [ID]).actions).to.deep.equal([]);
  });

  it("LEGACY: per-file records an older gov wrote count as the directory move applied", () => {
    const legacy = ["old/snap/1.0/a.md → new/snap/1.0/a.md", "old/snap/1.0/b.md → new/snap/1.0/b.md"];
    expect(directoryMoveDone(DIR_MOVE, new Set(legacy))).to.equal(true);
    const store: Record<string, string> = { "old/snap/recreated.md": "the org's, since\n" };
    expect(plan(store, [DIR_MOVE], legacy).actions, "nothing planned for the recreated file").to.deep.equal([]);
  });

  it("LEGACY: a per-file record of some OTHER move does not count", () => {
    expect(directoryMoveDone(DIR_MOVE, new Set(["old/snap/a.md → elsewhere/a.md", "old/snapshot/a.md → new/snapshot/a.md", "old/snap/ → x/"]))).to.equal(false);
  });

  it("the source folder is missing: nothing to do — no move, no refusal, nothing recorded", () => {
    const store: Record<string, string> = { "VERSION": "1\n" };
    const recorded: string[] = [];
    const p = plan(store, [DIR_MOVE]);
    expect(p.actions).to.deep.equal([]);
    expect(apply(store, p, recorded).refused).to.deep.equal([]);
    expect(recorded).to.deep.equal([]);
  });

  it("the destination already exists: REFUSED with the reason — nothing moved, nothing merged, nothing recorded", () => {
    const store: Record<string, string> = { "old/snap/a.md": "old A\n", "new/snap/a.md": "already here\n" };
    const p = plan(store, [DIR_MOVE]);
    expect(p.actions).to.have.length(1);
    expect(p.actions[0]).to.include({ kind: "refuse", dst: "new/snap/", from: "old/snap/" });
    expect(p.actions[0]!.detail).to.match(/new\/snap\/ already exists.*nothing moved from old\/snap\/.*merge the two folders by hand/);
    const recorded: string[] = [];
    const res = apply(store, p, recorded);
    expect(store).to.deep.equal({ "old/snap/a.md": "old A\n", "new/snap/a.md": "already here\n" });
    expect(recorded).to.deep.equal([]);
    expect(res.refused).to.deep.equal(["new/snap/"]);
  });

  it("a destination file that appears AFTER planning is not overwritten, and the directory stays unrecorded", () => {
    const store: Record<string, string> = { "old/snap/a.md": "A\n", "old/snap/b.md": "B\n" };
    const p = plan(store, [DIR_MOVE]);
    store["new/snap/b.md"] = "arrived since\n";
    const recorded: string[] = [];
    const res = apply(store, p, recorded);
    expect(store["new/snap/b.md"]).to.equal("arrived since\n");
    expect(store["old/snap/b.md"]).to.equal("B\n");
    expect(recorded).to.deep.equal([]);
    expect(res.refused).to.deep.equal(["new/snap/b.md"]);
    expect(res.why.join("\n")).to.match(/already exists/);
  });

  it("NESTED: a file under a more specific pending move is that move's; the rest go with the broader one", () => {
    const moves = parseManifest(`
moves:
  - { from: framework/, to: build/framework/, mode: move }
  - { from: framework/rules/, to: run/rules/, mode: move }
  - { from: framework/docs/spec.md, to: deploy/spec.md, mode: move }
`).moves;
    const store: Record<string, string> = { "framework/a.md": "a\n", "framework/rules/r.yaml": "r\n", "framework/docs/spec.md": "s\n", "framework/docs/x.md": "x\n" };
    const recorded: string[] = [];
    apply(store, plan(store, moves), recorded);
    expect(store).to.deep.equal({ "build/framework/a.md": "a\n", "build/framework/docs/x.md": "x\n", "run/rules/r.yaml": "r\n", "deploy/spec.md": "s\n" });
    expect(recorded).to.have.members(["framework/ → build/framework/", "framework/rules/ → run/rules/", "framework/docs/spec.md → deploy/spec.md"]);
  });

  it("NESTED: a destination inside its own source — what is already under it is not the source, and is an occupied destination", () => {
    const into: ManifestMove = { from: "policies/", to: "policies/run/", mode: "move" };
    const fresh: Record<string, string> = { "policies/a.md": "a\n", "policies/b/c.md": "c\n" };
    const recorded: string[] = [];
    apply(fresh, plan(fresh, [into]), recorded);
    expect(fresh).to.deep.equal({ "policies/run/a.md": "a\n", "policies/run/b/c.md": "c\n" });
    expect(recorded).to.deep.equal(["policies/ → policies/run/"]);
    const occupied: Record<string, string> = { "policies/a.md": "a\n", "policies/run/z.md": "z\n" };
    expect(plan(occupied, [into]).actions.map((a) => a.kind)).to.deep.equal(["refuse"]);
    // and the other way: a source inside its destination — the destination's own files are an occupied destination
    const up: ManifestMove = { from: "policies/run/", to: "policies/", mode: "move" };
    expect(plan({ "policies/run/a.md": "a\n" }, [up]).actions.map((a) => `${a.kind} ${a.dst}`)).to.deep.equal(["move policies/a.md"]);
    expect(plan({ "policies/run/a.md": "a\n", "policies/b.md": "b\n" }, [up]).actions.map((a) => a.kind)).to.deep.equal(["refuse"]);
  });
});

describe("upgrade — the directory record on disk (.gov-upgrade-moves.json)", function () {
  this.timeout(30000);
  let content = "", ws = "";
  const put = (root: string, rel: string, text: string): void => {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  const read = (rel: string): string | null => { try { return fs.readFileSync(path.join(ws, rel), "utf8"); } catch { return null; /* absent */ } };

  beforeEach(() => {
    content = fs.mkdtempSync(path.join(os.tmpdir(), "gov-dirmove-content-"));
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "gov-dirmove-ws-"));
    put(content, "MANIFEST.yaml", "files:\n  - { src: VERSION, dst: VERSION, mode: scaffold-auto }\nmoves:\n  - { from: old/snap/, to: new/snap/, mode: move }\n");
    put(content, "VERSION", "9.9.9\n");
  });
  afterEach(() => { for (const d of [content, ws]) fs.rmSync(d, { recursive: true, force: true }); });

  it("records the directory once, with the gov version that applied it — and a second upgrade leaves a recreated file alone", () => {
    put(ws, "old/snap/1.0/a.md", "A\n");
    put(ws, "old/snap/1.0/b.md", "B\n");
    const first = runUpgradeSync(content, ws, { apply: true, govVersion: "1.2.3" });
    expect(first.code, first.lines.join("\n")).to.equal(0);
    expect(read("new/snap/1.0/a.md")).to.equal("A\n");
    expect(JSON.parse(read(MOVES_FILE)!)).to.deep.equal([ID, { move: ID, version: "1.2.3" }]);
    expect(moveRecords(ws)).to.deep.equal([{ move: ID, version: "1.2.3" }]);
    expect(fs.existsSync(path.join(ws, "old")), "the emptied old folder is gone").to.equal(false);

    put(ws, "old/snap/ours.md", "the org's, put back deliberately\n");
    const second = runUpgradeSync(content, ws, { apply: true, govVersion: "1.2.4" });
    expect(second.code, second.lines.join("\n")).to.equal(0);
    expect(read("old/snap/ours.md")).to.equal("the org's, put back deliberately\n");
    expect(read("new/snap/ours.md")).to.equal(null);
    expect(JSON.parse(read(MOVES_FILE)!), "the record is unchanged").to.deep.equal([ID, { move: ID, version: "1.2.3" }]);
  });

  it("without a gov version given, the record names the content's VERSION", () => {
    put(ws, "old/snap/a.md", "A\n");
    runUpgradeSync(content, ws, { apply: true });
    expect(moveRecords(ws)).to.deep.equal([{ move: ID, version: "9.9.9" }]);
  });

  it("LEGACY: a workspace holding the per-file records an older gov wrote is treated as already moved", () => {
    put(ws, MOVES_FILE, JSON.stringify(["old/snap/1.0/a.md → new/snap/1.0/a.md", "org-config.yaml → policies/governance.yaml"], null, 2));
    put(ws, "new/snap/1.0/a.md", "A\n");
    put(ws, "old/snap/recreated.md", "the org's\n");
    const res = runUpgradeSync(content, ws, { apply: true, govVersion: "1.2.3" });
    expect(res.code, res.lines.join("\n")).to.equal(0);
    expect(read("old/snap/recreated.md")).to.equal("the org's\n");
    expect(doneMoves(ws)).to.deep.equal(["old/snap/1.0/a.md → new/snap/1.0/a.md", "org-config.yaml → policies/governance.yaml"]);
  });

  it("the destination already exists: exit 1, the reason printed, nothing moved and nothing recorded", () => {
    put(ws, "old/snap/a.md", "old\n");
    put(ws, "new/snap/b.md", "already here\n");
    const dry = runUpgradeSync(content, ws, { apply: false });
    expect(dry.lines.join("\n")).to.match(/refuse.*old\/snap\/ → new\/snap\/.*already exists/);
    const res = runUpgradeSync(content, ws, { apply: true, govVersion: "1.2.3" });
    expect(res.code).to.equal(1);
    expect(res.lines.join("\n")).to.match(/✗ new\/snap\/ NOT moved: new\/snap\/ already exists here/);
    expect(read("old/snap/a.md")).to.equal("old\n");
    expect(read("new/snap/a.md")).to.equal(null);
    expect(read(MOVES_FILE)).to.equal(null);
  });

  it("the source folder is missing: nothing to do, exit 0, nothing recorded", () => {
    const res = runUpgradeSync(content, ws, { apply: true, govVersion: "1.2.3" });
    expect(res.code, res.lines.join("\n")).to.equal(0);
    expect(read(MOVES_FILE)).to.equal(null);
  });
});
