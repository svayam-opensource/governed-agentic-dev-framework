// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { prjResolveGov } from "../../src/resolve/resolve-gov.js";
import type { GovHome, ResolveEnv } from "../../src/resolve/types.js";

/** In-memory ResolveEnv double; records writeHomes calls for side-effect assertions. */
function makeEnv(cfg: {
  cwd: string;
  orgAt?: Record<string, string>; // gov-repo path → github_org
  homes?: GovHome[];
  activeOrg?: string | null;
  legacyPointer?: string | null;
}): { env: ResolveEnv; writes: GovHome[][] } {
  const orgAt = cfg.orgAt ?? {};
  let homes: readonly GovHome[] = cfg.homes ?? [];
  const writes: GovHome[][] = [];
  const env: ResolveEnv = {
    cwd: cfg.cwd,
    parentOf(p) {
      if (p === "/") return null;
      const idx = p.lastIndexOf("/");
      return idx <= 0 ? "/" : p.slice(0, idx);
    },
    govOrgAt(p) {
      return orgAt[p] ?? null;
    },
    readRegistry() {
      return { homes, activeOrg: cfg.activeOrg ?? null, legacyPointer: cfg.legacyPointer ?? null };
    },
    writeHomes(h) {
      homes = [...h];
      writes.push([...h]);
    },
  };
  return { env, writes };
}

describe("prj-work Phase 1 — prjResolveGov (SDD-013/040)", () => {
  it("(1) cwd-walk: resolves the nearest ancestor gov repo and self-heals it", () => {
    const { env, writes } = makeEnv({
      cwd: "/w/PRJ-43/svm-prj-work/projects/PRJ-43",
      orgAt: { "/w/PRJ-43/svm-prj-work": "Svayamtech" },
    });
    const r = prjResolveGov(env);
    expect(r).to.deep.equal({
      ok: true,
      home: "/w/PRJ-43/svm-prj-work",
      org: "Svayamtech",
      via: "cwd-walk",
    });
    expect(writes).to.deep.equal([[{ org: "Svayamtech", home: "/w/PRJ-43/svm-prj-work" }]]);
  });

  it("(1) cwd-walk self-heal is idempotent — no write when already registered", () => {
    const { env, writes } = makeEnv({
      cwd: "/w/gov/sub",
      orgAt: { "/w/gov": "Org" },
      homes: [{ org: "Org", home: "/w/gov" }],
    });
    const r = prjResolveGov(env);
    expect(r.ok).to.equal(true);
    expect(writes).to.have.lengthOf(0);
  });

  it("(2) active-org: wins over a lone home when a different active-org is set", () => {
    const { env } = makeEnv({
      cwd: "/nowhere",
      homes: [
        { org: "A", home: "/a" },
        { org: "B", home: "/b" },
      ],
      activeOrg: "B",
    });
    expect(prjResolveGov(env)).to.deep.equal({ ok: true, home: "/b", org: "B", via: "active-org" });
  });

  it("(2→3) active-org set but unregistered falls through to the single home", () => {
    const { env } = makeEnv({
      cwd: "/nowhere",
      homes: [{ org: "A", home: "/a" }],
      activeOrg: "ghost",
    });
    expect(prjResolveGov(env)).to.deep.equal({ ok: true, home: "/a", org: "A", via: "single-home" });
  });

  it("(3) single home: resolves it when no cwd match and no active-org", () => {
    const { env } = makeEnv({ cwd: "/nowhere", homes: [{ org: "Solo", home: "/solo" }] });
    expect(prjResolveGov(env)).to.deep.equal({ ok: true, home: "/solo", org: "Solo", via: "single-home" });
  });

  it("(4) ambiguous: >1 home, no cwd match, no active-org → rc=2 with candidates", () => {
    const homes = [
      { org: "A", home: "/a" },
      { org: "B", home: "/b" },
    ];
    const { env } = makeEnv({ cwd: "/nowhere", homes });
    expect(prjResolveGov(env)).to.deep.equal({
      ok: false,
      code: 2,
      reason: "ambiguous",
      candidates: homes,
    });
  });

  it("none: nothing registered and no cwd match → rc=1", () => {
    const { env } = makeEnv({ cwd: "/nowhere" });
    expect(prjResolveGov(env)).to.deep.equal({ ok: false, code: 1, reason: "none" });
  });

  it("legacy: migrates the single-path pointer once, then resolves it", () => {
    const { env, writes } = makeEnv({
      cwd: "/nowhere",
      legacyPointer: "/legacy/gov",
      orgAt: { "/legacy/gov": "LegacyOrg" },
    });
    const r = prjResolveGov(env);
    expect(r).to.deep.equal({ ok: true, home: "/legacy/gov", org: "LegacyOrg", via: "single-home" });
    expect(writes).to.deep.equal([[{ org: "LegacyOrg", home: "/legacy/gov" }]]);
  });

  it("legacy: a stale pointer (no longer a gov repo) is not migrated → rc=1", () => {
    const { env, writes } = makeEnv({ cwd: "/nowhere", legacyPointer: "/gone" });
    expect(prjResolveGov(env)).to.deep.equal({ ok: false, code: 1, reason: "none" });
    expect(writes).to.have.lengthOf(0);
  });

  it("cwd-walk outranks the registry (deterministic-from-cwd beats active-org)", () => {
    const { env } = makeEnv({
      cwd: "/here/gov/x",
      orgAt: { "/here/gov": "HereOrg" },
      homes: [{ org: "Other", home: "/other" }],
      activeOrg: "Other",
    });
    const r = prjResolveGov(env);
    expect(r).to.deep.include({ ok: true, org: "HereOrg", via: "cwd-walk" });
  });
});
