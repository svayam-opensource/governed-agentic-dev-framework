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
    expect(readTopLevelScalar("gov_workspace: '~/x'", "gov_workspace")).to.equal("~/x");
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
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "prjwork-")));
    configDir = path.join(tmp, "config", "prj");
    govDir = path.join(tmp, "gov_repo");
    fs.mkdirSync(govDir, { recursive: true });
    // A canonical gov home: github_org set, gov_workspace points at itself.
    fs.writeFileSync(
      path.join(govDir, "org-config.yaml"),
      `github_org: "Svayamtech"\ngov_workspace: "${govDir}"\n`,
    );
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("govConfigAt reads github_org + gov_workspace, and skips .bases clones", () => {
    const env = createNodeEnv({ cwd: govDir, configDir });
    expect(env.govConfigAt(govDir)).to.deep.equal({ org: "Svayamtech", govWorkspace: govDir });
    expect(env.govConfigAt(path.join(tmp, "missing"))).to.equal(null);

    const baseClone = path.join(tmp, ".bases", "gov_repo");
    fs.mkdirSync(baseClone, { recursive: true });
    fs.writeFileSync(path.join(baseClone, "org-config.yaml"), "github_org: X\n");
    expect(env.govConfigAt(baseClone)).to.equal(null); // .bases → skipped
  });

  it("readActiveOrg and homeForOrg read the registry files", () => {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "active"), "Svayamtech\n");
    fs.writeFileSync(path.join(configDir, "workspaces"), `Svayamtech\t${govDir}\n`);
    const env = createNodeEnv({ cwd: tmp, configDir });
    expect(env.readActiveOrg()).to.equal("Svayamtech");
    expect(env.homeForOrg("Svayamtech")).to.equal(govDir);
    expect(env.homeForOrg("Nope")).to.equal(null);
  });

  it("readActiveOrg is null when unset; sameHome is realpath/~-aware", () => {
    const env = createNodeEnv({ cwd: tmp, configDir, home: tmp });
    expect(env.readActiveOrg()).to.equal(null);
    expect(env.sameHome(govDir, govDir)).to.equal(true);
    expect(env.sameHome("~/gov_repo", govDir)).to.equal(true); // ~ expands to home=tmp
    expect(env.sameHome(govDir, path.join(tmp, "other"))).to.equal(false);
  });

  it("end-to-end: cwd inside a real gov repo + matching active-org resolves via cwd", () => {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "active"), "Svayamtech\n");
    const nested = path.join(govDir, "projects", "PRJ-1");
    fs.mkdirSync(nested, { recursive: true });
    const env = createNodeEnv({ cwd: nested, configDir });
    expect(prjResolveGov(env)).to.deep.include({ ok: true, home: govDir, org: "Svayamtech", via: "cwd" });
  });

  it("end-to-end: outside any workspace resolves via active-org's canonical registry home", () => {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "active"), "Svayamtech\n");
    fs.writeFileSync(path.join(configDir, "workspaces"), `Svayamtech\t${govDir}\n`);
    const outside = path.join(tmp, "elsewhere");
    fs.mkdirSync(outside, { recursive: true });
    const env = createNodeEnv({ cwd: outside, configDir });
    expect(prjResolveGov(env)).to.deep.include({ ok: true, home: govDir, org: "Svayamtech", via: "active-org" });
  });

  it("end-to-end: a project-clone pointer in the registry is rejected (not canonical)", () => {
    // Registry points active-org at a project clone whose gov_workspace ≠ itself.
    const clone = path.join(tmp, "projects", "PRJ-9", "svm-prj-work");
    fs.mkdirSync(clone, { recursive: true });
    fs.writeFileSync(
      path.join(clone, "org-config.yaml"),
      `github_org: "Svayamtech"\ngov_workspace: "${govDir}"\n`,
    );
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "active"), "Svayamtech\n");
    fs.writeFileSync(path.join(configDir, "workspaces"), `Svayamtech\t${clone}\n`);
    const outside = path.join(tmp, "elsewhere");
    fs.mkdirSync(outside, { recursive: true });
    const r = prjResolveGov(createNodeEnv({ cwd: outside, configDir }));
    expect(r.ok).to.equal(false);
    if (!r.ok && r.reason === "pointer-mismatch") {
      expect(r.detail.why).to.equal("not-canonical");
    } else expect.fail("expected pointer-mismatch/not-canonical");
  });
});
