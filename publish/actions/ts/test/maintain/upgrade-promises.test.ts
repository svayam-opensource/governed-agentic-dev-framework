// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WHAT `gov setup` AND `gov upgrade` PROMISE ABOUT THE TREE (W9, rule model — spec rules ↔ tests).
 *
 * `gov setup` seeds a new workspace with `runUpgradeSync(publish/content → workspace)` (cli/main.ts), and
 * `gov upgrade` runs the same engine over an existing one. So both promises are tested here the way they are
 * kept: the REAL shipped content and MANIFEST, applied to a real temporary directory.
 *
 * GOV-FRM-444 (upgrade replaces every file under framework/) is kept since P3: the MANIFEST ships framework/rules/
 * and the specification its rows cite, and seeds the organization's empty rule store once.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runUpgradeSync } from "../../src/maintain/upgrade-run.js";
import { parseManifest } from "../../src/maintain/upgrade-sync.js";
import { loadRuleStoresFrom } from "../../src/rules/model/store-io.js";

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

  // Tier 0 #7: RETIRE_PATHS listed `framework/` for the OLD world's vendored copy — and the new layout lives there.
  // A second upgrade saw `framework/…` in the workspace and removed the whole tree it had just written.
  it("a second upgrade keeps the framework/ tree it ships — RETIRE_PATHS' `framework/` is the old world only", () => {
    const again = runUpgradeSync(contentDir, dir, { apply: true });
    expect(again.code, again.lines.join("\n")).to.equal(0);
    expect(again.lines.join("\n")).to.not.match(/retire[^\n]*framework\/(\s|$|`|,)/);
    for (const rel of ["framework/docs/specs/framework-specification.md", "framework/procedures/knowledge-harvest.md", "framework/templates/todo-template.md"]) {
      expect(fs.existsSync(path.join(dir, rel)), rel).to.equal(true);
    }
  });

  it("an upgrade removes the documents the release merged away, by the MANIFEST's retire list", () => {
    const manifest = parseManifest(fs.readFileSync(path.join(contentDir, "MANIFEST.yaml"), "utf8"));
    expect(manifest.retire.length, "the MANIFEST names what it retires").to.be.greaterThan(0);
    const files = manifest.retire.filter((r) => !r.endsWith("/"));
    for (const rel of files) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), "the old release's copy\n");
    }
    const again = runUpgradeSync(contentDir, dir, { apply: true });
    expect(again.code, again.lines.join("\n")).to.equal(0);
    expect(files.filter((rel) => fs.existsSync(path.join(dir, rel))), "still there after the upgrade").to.deep.equal([]);
  });

  const FRAMEWORK_RULES = ["framework/rules/rules.yaml", "framework/rules/catalog.yaml", "framework/rules/pol-aliases.yaml", "framework/docs/specs/framework-specification.md"];
  const ORG_SEEDS = ["policies/rules.yaml", "policies/catalog.yaml", "policies/ownership.yaml", "policies/VERSION", "policies/CHANGELOG.md"];
  const read = (rel: string): string => fs.readFileSync(path.join(dir, rel), "utf8");
  const shipped = (rel: string): string => fs.readFileSync(path.join(contentDir, rel), "utf8");

  it("GOV-FRM-444 setup ships the framework's rules, its catalog, the POL aliases and the specification they cite", () => {
    for (const rel of FRAMEWORK_RULES) expect(read(rel), rel).to.equal(shipped(rel));
  });

  it("GOV-FRM-444 upgrade replaces every file under framework/rules/ with the release's copy, edited or not", () => {
    for (const rel of FRAMEWORK_RULES) fs.writeFileSync(path.join(dir, rel), "# edited by hand\n");
    const again = runUpgradeSync(contentDir, dir, { apply: true });
    expect(again.code, again.lines.join("\n")).to.equal(0);
    for (const rel of FRAMEWORK_RULES) expect(read(rel), rel).to.equal(shipped(rel));
  });

  it("setup seeds the organization's rule store once: an empty rules list, catalog, ownership, VERSION 1.0.0, CHANGELOG", () => {
    for (const rel of ORG_SEEDS) expect(fs.existsSync(path.join(dir, rel)), rel).to.equal(true);
    expect(read("policies/VERSION").trim()).to.equal("1.0.0");
    fs.writeFileSync(path.join(dir, "org-config.yaml"), read("org-config.yaml").replace(/^org_slug: .*$/m, "org_slug: \"ACME\""));
    const loaded = loadRuleStoresFrom({ where: "the seeded workspace", read: (rel) => (fs.existsSync(path.join(dir, rel)) ? read(rel) : undefined) });
    expect(loaded.ok, loaded.ok ? "" : loaded.reason).to.equal(true);
    if (!loaded.ok) return;
    expect(loaded.set.org, "the org store is seeded EMPTY — its rules come from its own prose").to.deep.equal([]);
    expect(loaded.set.orgVersion).to.equal("1.0.0");
    expect(loaded.set.framework.length, "and the framework's rows arrive with it").to.be.greaterThan(0);
    expect(loaded.diagnostics.map((d) => `${d.kind} ${d.message}`), "a seeded workspace loads clean").to.deep.equal([]);
  });

  it("an upgrade never overwrites the organization's rule store", () => {
    const theirs = "- id: GOV-ACME-001\n";
    fs.writeFileSync(path.join(dir, "policies/rules.yaml"), theirs);
    fs.writeFileSync(path.join(dir, "policies/VERSION"), "1.4.0\n");
    runUpgradeSync(contentDir, dir, { apply: true });
    expect(read("policies/rules.yaml")).to.equal(theirs);
    expect(read("policies/VERSION")).to.equal("1.4.0\n");
  });
});

