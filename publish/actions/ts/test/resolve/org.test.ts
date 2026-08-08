// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { orgAdd, orgUse, orgList, orgRemove, type OrgDeps } from "../../src/resolve/org.js";
import { createNodeRegistryStore } from "../../src/resolve/registry-store.js";
import type { RegistryStore } from "../../src/resolve/registry-store.js";
import type { GovConfig, GovHome } from "../../src/resolve/types.js";
import { pxAbs } from "../helpers/paths.js";

/** In-memory registry store. */
function memStore(homes: GovHome[] = [], active: string | null = null): RegistryStore {
  let hs = homes;
  let a = active;
  return {
    readHomes: () => hs,
    writeHomes: (h) => { hs = [...h]; },
    readActiveOrg: () => a,
    writeActiveOrg: (o) => { a = o; },
    clearActiveOrg: () => { a = null; },
  };
}
/** govConfigAt over a map of path → org (govWorkspace omitted). */
function probe(orgAt: Record<string, string>) {
  return (p: string): GovConfig | null => (orgAt[pxAbs(p)] ? { org: orgAt[pxAbs(p)], govWorkspace: p } : null);
}

describe("prj-work — gov-work org (multi-home registry)", () => {
  it("add validates the home is that org's gov repo, then records it", () => {
    const store = memStore();
    const deps: OrgDeps = { store, govConfigAt: probe({ "/gov": "Svayamtech" }) };
    expect(orgAdd(deps, "Svayamtech", "/gov").ok).to.equal(true);
    expect(store.readHomes()).to.deep.equal([{ org: "Svayamtech", home: "/gov" }]);
  });

  it("add rejects a non-gov path or an org mismatch", () => {
    const deps: OrgDeps = { store: memStore(), govConfigAt: probe({ "/gov": "Other" }) };
    expect(orgAdd(deps, "Svayamtech", "/nope")).to.include({ ok: false });
    const mismatch = orgAdd(deps, "Svayamtech", "/gov");
    expect(mismatch.ok).to.equal(false);
    if (!mismatch.ok) expect(mismatch.message).to.match(/belongs to org 'Other'/);
  });

  it("use requires the org to be registered, then sets active-org", () => {
    const store = memStore([{ org: "Svayamtech", home: "/gov" }]);
    const deps: OrgDeps = { store, govConfigAt: probe({}) };
    expect(orgUse(deps, "Ghost").ok).to.equal(false);
    expect(orgUse(deps, "Svayamtech").ok).to.equal(true);
    expect(store.readActiveOrg()).to.equal("Svayamtech");
  });

  it("list marks the active org", () => {
    const deps: OrgDeps = { store: memStore([{ org: "A", home: "/a" }, { org: "B", home: "/b" }], "B"), govConfigAt: probe({}) };
    const r = orgList(deps);
    expect(r.ok).to.equal(true);
    if (r.ok) expect(r.lines.join("\n")).to.match(/\* B\t\/b/);
  });

  it("remove deletes the home and clears active-org if it was active", () => {
    const store = memStore([{ org: "A", home: "/a" }], "A");
    const deps: OrgDeps = { store, govConfigAt: probe({}) };
    expect(orgRemove(deps, "A").ok).to.equal(true);
    expect(store.readHomes()).to.deep.equal([]);
    expect(store.readActiveOrg()).to.equal(null);
  });
});

describe("prj-work — createNodeRegistryStore (real temp dir)", () => {
  it("round-trips homes + active-org through the files", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prjwork-reg-"));
    try {
      const store = createNodeRegistryStore({ configDir: tmp });
      expect(store.readHomes()).to.deep.equal([]);
      store.writeHomes([{ org: "Svayamtech", home: "/gov" }]);
      store.writeActiveOrg("Svayamtech");
      const reopened = createNodeRegistryStore({ configDir: tmp });
      expect(reopened.readHomes()).to.deep.equal([{ org: "Svayamtech", home: "/gov" }]);
      expect(reopened.readActiveOrg()).to.equal("Svayamtech");
      expect(fs.readFileSync(path.join(tmp, "gov-workspaces"), "utf8")).to.equal("Svayamtech\t/gov\n");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
