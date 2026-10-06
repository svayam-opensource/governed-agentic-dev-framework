// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WHAT `gov setup` AND `gov upgrade` PROMISE ABOUT THE TREE (W9, rule model — spec rules ↔ tests).
 *
 * `gov setup` seeds a new workspace with `runUpgradeSync(publish/content → workspace)` (cli/main.ts), and
 * `gov upgrade` runs the same engine over an existing one. So both promises are tested here the way they are
 * kept: the REAL shipped content and MANIFEST, applied to a real temporary directory.
 *
 * GOV-FRM-444 (upgrade replaces every file under framework/) is deliberately NOT tested here: it is not kept —
 * `framework/rules/` has no MANIFEST entry, so no upgrade ships it. See KNOWN_UNKEPT in
 * test/content/spec-rule-coverage.test.ts.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runUpgradeSync } from "../../src/maintain/upgrade-run.js";
import { parseManifest } from "../../src/maintain/upgrade-sync.js";

const contentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../content");

function walk(root: string, rel = ""): string[] {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs).flatMap((n) => {
    const r = rel ? `${rel}/${n}` : n;
    return fs.statSync(path.join(root, r)).isDirectory() ? walk(root, r) : [r];
  });
}

describe("setup and upgrade — what the shipped content promises about the tree", function () {
  this.timeout(30000);
  let dir = "";

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gov-promises-"));
    const r = runUpgradeSync(contentDir, dir, { apply: true });
    expect(r.code, r.lines.join("\n")).to.equal(0);
  });
  afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ } });

  it("GOV-FRM-082 setup's seed creates no domain folder under knowledge/ — the tree ships empty", () => {
    expect(walk(dir, "knowledge"), "a domain exists only once the organization names its owner").to.deep.equal(["knowledge/.gitkeep"]);
  });

  it("GOV-FRM-445 every file the release ships for policies/ is seeded once — no MANIFEST entry may overwrite it", () => {
    const manifest = parseManifest(fs.readFileSync(path.join(contentDir, "MANIFEST.yaml"), "utf8"));
    const policies = manifest.files.filter((e) => e.dst.startsWith("policies/"));
    expect(policies.length, "the MANIFEST seeds the organization's starter policies").to.be.greaterThan(0);
    expect(policies.filter((e) => e.mode !== "seed-once").map((e) => `${e.dst} (${e.mode})`)).to.deep.equal([]);
  });

  it("GOV-FRM-445 an upgrade over the organization's edited policies/ leaves every byte as the organization wrote it", () => {
    const seeded = walk(dir, "policies");
    expect(seeded.length, "setup seeded the starter policies").to.be.greaterThan(0);
    const theirs = new Map(seeded.map((rel) => [rel, `# ours now — ${rel}\n`]));
    for (const [rel, text] of theirs) fs.writeFileSync(path.join(dir, rel), text);

    const again = runUpgradeSync(contentDir, dir, { apply: true });
    expect(again.code, again.lines.join("\n")).to.equal(0);
    for (const [rel, text] of theirs) expect(fs.readFileSync(path.join(dir, rel), "utf8"), rel).to.equal(text);
  });
});
