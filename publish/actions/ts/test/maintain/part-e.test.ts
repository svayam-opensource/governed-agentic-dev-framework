// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { PACKAGE_NAME } from "../../src/index.js";
import { checkDeps, formatDepsReport } from "../../src/maintain/deps.js";
import { publishGate, formatPublishGate } from "../../src/maintain/publish.js";
import { upgradePlan, formatUpgradePlan } from "../../src/maintain/upgrade.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";

const memFs = (files: Record<string, string>): Fs => {
  const at = (p: string) => files[p.replace(/^\/repo\//, "")] ?? null;
  return { pathExists: (p) => at(p) !== null, readFile: (p) => at(p), writeFile: () => {}, mkdirp: () => {}, rm: () => {}, readdir: () => [] };
};

describe("prj-work Phase E — deps", () => {
  it("reports present + missing tools with per-OS install hints", () => {
    const r = checkDeps((n) => n === "git", "darwin");
    expect(r.ok).to.equal(false);
    expect(r.tools.find((t) => t.name === "gh")).to.deep.include({ present: false, installHint: "brew install gh" });
    expect(formatDepsReport(r)).to.include("  ✓ git");
    expect(formatDepsReport(r).some((l) => /✗ gh/.test(l))).to.equal(true);
  });
  it("is ok when git + gh are both present (no yq/python needed)", () => {
    expect(checkDeps(() => true, "linux").ok).to.equal(true);
  });
});

describe("prj-work Phase E — publish gate", () => {
  it("PASS when versions agree; BLOCKED with the version-sync reasons otherwise", () => {
    const good = publishGate(memFs({ "publish/actions/ts/package.json": '{"version":"1.0.0"}', "publish/content/VERSION": "1.0.0" }), "/repo");
    expect(good.ok).to.equal(true);
    expect(formatPublishGate(good)[0]).to.match(/PASS/);
    const bad = publishGate(memFs({ "publish/actions/ts/package.json": '{"version":"1.0.0"}', "publish/content/VERSION": "0.9.9" }), "/repo");
    expect(bad.ok).to.equal(false);
    expect(bad.blockers.join()).to.match(/version-sync:/);
    expect(formatPublishGate(bad)[0]).to.match(/BLOCKED/);
  });
});

describe("prj-work Phase E — upgrade plan", () => {
  it("plans install for a newer target, up-to-date when equal, error otherwise", () => {
    expect(upgradePlan("0.7.4", "0.8.0")).to.deep.include({ kind: "install", version: "0.8.0" });
    expect(upgradePlan("0.8.0", "0.8.0")).to.deep.equal({ kind: "up-to-date", version: "0.8.0" });
    expect(upgradePlan("0.7.4", null).kind).to.equal("error");
    expect(upgradePlan("0.7.4", "latest").kind).to.equal("error");
    expect(formatUpgradePlan(upgradePlan("0.7.4", "0.8.0"))).to.include(`  npm install -g ${PACKAGE_NAME}@0.8.0`);   // the NAME comes from one place
  });
});
