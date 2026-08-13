// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { orgAdd, orgUse, orgList, orgRemove, type OrgDeps } from "../../src/resolve/org.js";
import { createNodeRegistryStore } from "../../src/resolve/registry-store.js";
import { legacyRegistryFiles, resetRegistryMigrationForTests } from "../../src/resolve/node-env.js";
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

describe("prj-work — gov org (multi-home registry)", () => {
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
      // R10 — the canonical names are `workspaces` and `active` under ~/.gov. The old
      // `gov-workspaces`/`active-org` pair lives in a directory named after the retired `prj` CLI and is
      // migrated from, never written.
      expect(fs.readFileSync(path.join(tmp, "workspaces"), "utf8")).to.equal("Svayamtech\t/gov\n");
      expect(fs.existsSync(path.join(tmp, "gov-workspaces")), "must not write the legacy name").to.equal(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  /**
   * R10 moved the registry to `~/.gov/`. Without a migration, upgrading silently forgets which orgs
   * exist and which is active — and `gov` then hard-fails `no-active-org` on a machine that worked a
   * minute earlier. That is the worst possible upgrade experience, and it is invisible until it happens.
   */
  describe("R10 migration from the prj-named legacy registry", () => {
    const withHome = (fn: (home: string) => void): void => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "prjwork-home-"));
      const prev = process.env.XDG_CONFIG_HOME;
      const prevAppData = process.env.APPDATA;
      process.env.XDG_CONFIG_HOME = path.join(home, ".config");
      process.env.APPDATA = path.join(home, "AppData", "Roaming");   // Windows: keep configDir inside the fixture
      // Migration is once per process. Without this, only the FIRST case below actually migrates and the
      // rest pass without exercising anything.
      resetRegistryMigrationForTests();
      try { fn(home); } finally {
        if (prev === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = prev;
        if (prevAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = prevAppData;
        fs.rmSync(home, { recursive: true, force: true });
      }
    };

    // Seed via the SAME function the code reads with. Hard-coding `~/.config/prj` seeds a POSIX path
    // while the code looks in %APPDATA%\prj on Windows, so the fixture and the code disagree and the
    // migration legitimately finds nothing — green on macOS/Linux, red on Windows. Same class as #90.
    const seedLegacy = (home: string, workspaces: string, active: string): string => {
      const legacy = legacyRegistryFiles(process.env, process.platform, home);
      fs.mkdirSync(path.dirname(legacy.workspaces), { recursive: true });
      fs.writeFileSync(legacy.workspaces, workspaces, "utf8");
      fs.writeFileSync(legacy.active, active, "utf8");
      return path.dirname(legacy.workspaces);
    };

    it("carries an existing registry forward on first read", () => {
      withHome((home) => {
        seedLegacy(home, "Acme\t/home/u/.gov/acme/gov_repo\n", "Acme\n");
        const store = createNodeRegistryStore({ home });
        expect(store.readHomes()).to.deep.equal([{ org: "Acme", home: "/home/u/.gov/acme/gov_repo" }]);
        expect(store.readActiveOrg()).to.equal("Acme");
        expect(fs.existsSync(path.join(home, ".gov", "workspaces")), "written to the new location").to.equal(true);
      });
    });

    it("COPIES rather than moves, so a downgrade still works", () => {
      withHome((home) => {
        const legacyDir = seedLegacy(home, "Acme\t/gov\n", "Acme\n");
        createNodeRegistryStore({ home }).readHomes();
        expect(fs.readdirSync(legacyDir).length, "legacy must survive").to.be.greaterThan(0);
      });
    });

    it("never overwrites a current registry with a stale legacy one", () => {
      withHome((home) => {
        seedLegacy(home, "Old\t/old\n", "Old\n");
        fs.mkdirSync(path.join(home, ".gov"), { recursive: true });
        fs.writeFileSync(path.join(home, ".gov", "workspaces"), "New\t/new\n", "utf8");
        expect(createNodeRegistryStore({ home }).readHomes()).to.deep.equal([{ org: "New", home: "/new" }]);
      });
    });

    it("does nothing on a fresh machine", () => {
      withHome((home) => {
        const store = createNodeRegistryStore({ home });
        expect(store.readHomes()).to.deep.equal([]);
        expect(store.readActiveOrg()).to.equal(null);
      });
    });
  });
});
