// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { prjResolveGov, resolveFailureMessage } from "../../src/resolve/resolve-gov.js";
import type { GovConfig, ResolveEnv, ResolveResult } from "../../src/resolve/types.js";

/** In-memory, read-only ResolveEnv double. */
function makeEnv(cfg: {
  cwd: string;
  govAt?: Record<string, { org: string; govWorkspace?: string | null }>; // dir → org-config
  activeOrg?: string | null;
  homes?: Record<string, string>; // org → registry home
}): ResolveEnv {
  const govAt = cfg.govAt ?? {};
  const homes = cfg.homes ?? {};
  return {
    cwd: cfg.cwd,
    parentOf(p) {
      if (p === "/") return null;
      const idx = p.lastIndexOf("/");
      return idx <= 0 ? "/" : p.slice(0, idx);
    },
    govConfigAt(p): GovConfig | null {
      const c = govAt[p];
      return c ? { org: c.org, govWorkspace: c.govWorkspace ?? null } : null;
    },
    readActiveOrg() {
      return cfg.activeOrg ?? null;
    },
    homeForOrg(org) {
      return homes[org] ?? null;
    },
    sameHome(a, b) {
      return a === b; // test paths are already normalized strings
    },
  };
}

function fail(r: ResolveResult) {
  expect(r.ok).to.equal(false);
  return r as Extract<ResolveResult, { ok: false }>;
}

describe("prj-work Phase 1 — prjResolveGov (SDD-040, active-org anchored)", () => {
  it("[rule a] no active-org is a hardstop — even when cwd sits in a gov repo", () => {
    const env = makeEnv({
      cwd: "/w/gov/sub",
      govAt: { "/w/gov": { org: "Svayamtech" } },
      activeOrg: null,
    });
    const r = fail(prjResolveGov(env));
    expect(r.reason).to.equal("no-active-org");
    expect(resolveFailureMessage(r)).to.match(/gov-work org use/);
  });

  it("O2 == O1: resolves to the cwd workspace (project clone included)", () => {
    const env = makeEnv({
      cwd: "/w/PRJ-43/svm-prj-work/projects/PRJ-43",
      govAt: {
        // a project clone: org matches, but gov_workspace points at the canonical home
        "/w/PRJ-43/svm-prj-work": { org: "Svayamtech", govWorkspace: "/home/.svm/gov_repo" },
      },
      activeOrg: "Svayamtech",
      homes: { Svayamtech: "/home/.svm/gov_repo" },
    });
    expect(prjResolveGov(env)).to.deep.equal({
      ok: true,
      home: "/w/PRJ-43/svm-prj-work",
      org: "Svayamtech",
      via: "cwd",
    });
  });

  it("O2 ≠ O1: standing in a different org's tree is a conflict hardstop", () => {
    const env = makeEnv({
      cwd: "/w/acme/gov/x",
      govAt: { "/w/acme/gov": { org: "AcmeOrg" } },
      activeOrg: "Svayamtech",
    });
    const r = fail(prjResolveGov(env));
    expect(r).to.include({ reason: "org-conflict", cwdOrg: "AcmeOrg", activeOrg: "Svayamtech" });
    expect(resolveFailureMessage(r)).to.match(/gov-work org use AcmeOrg/);
  });

  it("O2 none: resolves via active-org's registry home when the pointer checks out", () => {
    const env = makeEnv({
      cwd: "/tmp/nowhere",
      activeOrg: "Svayamtech",
      homes: { Svayamtech: "/home/.svm/gov_repo" },
      govAt: {
        // canonical home: org matches AND gov_workspace points at itself
        "/home/.svm/gov_repo": { org: "Svayamtech", govWorkspace: "/home/.svm/gov_repo" },
      },
    });
    expect(prjResolveGov(env)).to.deep.equal({
      ok: true,
      home: "/home/.svm/gov_repo",
      org: "Svayamtech",
      via: "active-org",
    });
  });

  it("O2 none + no registered home: hardstop asking to add one", () => {
    const env = makeEnv({ cwd: "/tmp/nowhere", activeOrg: "Svayamtech" });
    const r = fail(prjResolveGov(env));
    expect(r).to.include({ reason: "no-home", activeOrg: "Svayamtech" });
    expect(resolveFailureMessage(r)).to.match(/gov-work org add Svayamtech/);
  });

  describe("[rule b] registry-home double-check against org-config", () => {
    it("rejects a home that is not a gov repo", () => {
      const env = makeEnv({
        cwd: "/tmp/nowhere",
        activeOrg: "Svayamtech",
        homes: { Svayamtech: "/gone" },
        govAt: {}, // govConfigAt('/gone') → null
      });
      const r = fail(prjResolveGov(env));
      expect(r).to.include({ reason: "pointer-mismatch", home: "/gone" });
      if (r.reason === "pointer-mismatch") expect(r.detail.why).to.equal("not-a-gov-repo");
    });

    it("rejects a home whose org-config names a different org", () => {
      const env = makeEnv({
        cwd: "/tmp/nowhere",
        activeOrg: "Svayamtech",
        homes: { Svayamtech: "/home/other" },
        govAt: { "/home/other": { org: "AcmeOrg", govWorkspace: "/home/other" } },
      });
      const r = fail(prjResolveGov(env));
      if (r.reason === "pointer-mismatch") {
        expect(r.detail).to.deep.equal({ why: "org-mismatch", found: "AcmeOrg" });
      } else expect.fail("expected pointer-mismatch");
    });

    it("rejects a non-canonical home (its gov_workspace points elsewhere) — the pollution guard", () => {
      const env = makeEnv({
        cwd: "/tmp/nowhere",
        activeOrg: "Svayamtech",
        // registry accidentally points at a PROJECT CLONE, not the canonical home
        homes: { Svayamtech: "/w/PRJ-43/svm-prj-work" },
        govAt: {
          "/w/PRJ-43/svm-prj-work": { org: "Svayamtech", govWorkspace: "/home/.svm/gov_repo" },
        },
      });
      const r = fail(prjResolveGov(env));
      if (r.reason === "pointer-mismatch") {
        expect(r.detail).to.deep.equal({ why: "not-canonical", found: "/home/.svm/gov_repo" });
        expect(resolveFailureMessage(r)).to.match(/not a canonical gov home/);
      } else expect.fail("expected pointer-mismatch");
    });

    it("accepts a canonical home whose gov_workspace field is absent (null → skip that check)", () => {
      const env = makeEnv({
        cwd: "/tmp/nowhere",
        activeOrg: "Svayamtech",
        homes: { Svayamtech: "/home/.svm/gov_repo" },
        govAt: { "/home/.svm/gov_repo": { org: "Svayamtech", govWorkspace: null } },
      });
      expect(prjResolveGov(env)).to.include({ ok: true, via: "active-org" });
    });
  });

  it("cwd-walk climbs ancestors to find the nearest gov repo", () => {
    const env = makeEnv({
      cwd: "/a/b/c/d",
      govAt: { "/a/b": { org: "Svayamtech", govWorkspace: "/a/b" } },
      activeOrg: "Svayamtech",
    });
    expect(prjResolveGov(env)).to.include({ ok: true, home: "/a/b", via: "cwd" });
  });
});
