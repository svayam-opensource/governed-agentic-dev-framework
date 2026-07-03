// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  createNodeEnv,
  readTopLevelScalar,
  containsBasesSegment,
  expandTilde,
} from "../../src/resolve/node-env.js";
import { prjResolveGov } from "../../src/resolve/resolve-gov.js";

describe("prj-work Phase 1 — node-env helpers", () => {
  it("readTopLevelScalar reads quoted, unquoted, and single-quoted values", () => {
    expect(readTopLevelScalar('github_org: "Svayamtech"', "github_org")).to.equal("Svayamtech");
    expect(readTopLevelScalar("github_org: Svayamtech", "github_org")).to.equal("Svayamtech");
    expect(readTopLevelScalar("github_org: 'Acme'", "github_org")).to.equal("Acme");
  });

  it("readTopLevelScalar strips inline comments on unquoted scalars", () => {
    expect(readTopLevelScalar("github_org: Svayamtech  # the org", "github_org")).to.equal("Svayamtech");
  });

  it("readTopLevelScalar ignores indented (non-top-level) keys and missing keys", () => {
    expect(readTopLevelScalar("nested:\n  github_org: Deep", "github_org")).to.equal(null);
    expect(readTopLevelScalar("other: x", "github_org")).to.equal(null);
  });

  it("containsBasesSegment flags .bases clones but not similar names", () => {
    expect(containsBasesSegment("/w/.bases/repo")).to.equal(true);
    expect(containsBasesSegment("/w/bases/repo")).to.equal(false);
    expect(containsBasesSegment("/w/gov")).to.equal(false);
  });

  it("expandTilde expands ~ and ~/… but leaves absolute paths", () => {
    expect(expandTilde("~", "/home/rk")).to.equal("/home/rk");
    expect(expandTilde("~/gov", "/home/rk")).to.equal(path.join("/home/rk", "gov"));
    expect(expandTilde("/abs/gov", "/home/rk")).to.equal("/abs/gov");
  });
});

describe("prj-work Phase 1 — createNodeEnv (fs-backed, temp dir)", () => {
  let tmp: string;
  let configDir: string;
  let govDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prjwork-"));
    configDir = path.join(tmp, "config", "prj");
    govDir = path.join(tmp, "gov_repo");
    fs.mkdirSync(govDir, { recursive: true });
    fs.writeFileSync(path.join(govDir, "org-config.yaml"), 'github_org: "Svayamtech"\n');
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("govOrgAt reads github_org, and skips .bases clones", () => {
    const env = createNodeEnv({ cwd: govDir, configDir });
    expect(env.govOrgAt(govDir)).to.equal("Svayamtech");
    expect(env.govOrgAt(path.join(tmp, "does-not-exist"))).to.equal(null);

    const baseClone = path.join(tmp, ".bases", "gov_repo");
    fs.mkdirSync(baseClone, { recursive: true });
    fs.writeFileSync(path.join(baseClone, "org-config.yaml"), "github_org: X\n");
    expect(env.govOrgAt(baseClone)).to.equal(null); // .bases → skipped
  });

  it("readRegistry reads gov-workspaces, active-org, and the legacy pointer", () => {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "gov-workspaces"), "Svayamtech\t/x\n");
    fs.writeFileSync(path.join(configDir, "active-org"), "Svayamtech\n");
    fs.writeFileSync(path.join(configDir, "gov-workspace"), "/legacy/home\n");
    const snap = createNodeEnv({ cwd: tmp, configDir }).readRegistry();
    expect(snap.homes).to.deep.equal([{ org: "Svayamtech", home: "/x" }]);
    expect(snap.activeOrg).to.equal("Svayamtech");
    expect(snap.legacyPointer).to.equal("/legacy/home");
  });

  it("writeHomes persists atomically and round-trips via readRegistry", () => {
    const env = createNodeEnv({ cwd: tmp, configDir });
    env.writeHomes([{ org: "A", home: "/a" }]);
    expect(env.readRegistry().homes).to.deep.equal([{ org: "A", home: "/a" }]);
  });

  it("end-to-end: cwd inside a real gov repo resolves + self-heals the registry file", () => {
    const nested = path.join(govDir, "projects", "PRJ-1");
    fs.mkdirSync(nested, { recursive: true });
    const env = createNodeEnv({ cwd: nested, configDir });
    const r = prjResolveGov(env);
    expect(r).to.deep.include({ ok: true, home: govDir, org: "Svayamtech", via: "cwd-walk" });
    // self-heal wrote the registry file
    const written = fs.readFileSync(path.join(configDir, "gov-workspaces"), "utf8");
    expect(written).to.equal(`Svayamtech\t${govDir}\n`);
  });
});
