// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { readFile } from "node:fs/promises";
import {
  OPERATION_CATEGORIES,
  MIGRATION_PHASES,
  PACKAGE_NAME,
} from "../src/index.js";

describe("prj-work Phase 0 — scaffold smoke", () => {
  it("declares the four operation categories (SDD Part B–E)", () => {
    expect([...OPERATION_CATEGORIES]).to.have.members([
      "lifecycle", "governance", "org-registry", "publish",
    ]);
  });

  it("starts the migration roadmap at Phase 0 (scaffold + CI)", () => {
    const phase0 = MIGRATION_PHASES[0];
    expect(phase0.phase).to.equal(0);
    expect(phase0.title).to.match(/scaffold/i);
  });

  it("every roadmap phase references only known operation categories", () => {
    for (const p of MIGRATION_PHASES) {
      for (const c of p.categories) {
        expect(OPERATION_CATEGORIES).to.include(c);
      }
    }
  });

  // The published identity, asserted against package.json ITSELF rather than a second copy of the string.
  // `PACKAGE_NAME` is what `upgrade` installs and what `--version` matches on, so a drift between it and the
  // manifest sends users to a package that is not this one. On 2026-08-04 the catalog and the manifest
  // disagreed about this exact name for weeks, silently, because nothing compared them.
  it("PACKAGE_NAME IS the published name — not a copy that can drift", async () => {
    const url = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(await readFile(url, "utf8")) as { name: string };
    expect(PACKAGE_NAME).to.equal(pkg.name);
    expect(pkg.name).to.equal("@svayam-opensource/gov");   // the artifact; `gov` is the COMMAND
  });

  // PUBLISHING SAFETY. `publishConfig.registry` is the target of a bare `npm publish` — a refactor that drops
  // the recipe's `--registry` flag, or a hand-run in a checkout. It must NOT be the public registry: npm's
  // unpublish window is 72h and never applies once anything depends on the version, so the default has to
  // fail in the recoverable direction. Going public is reached by SAYING SO (prod's registries entry).
  it("defaults publishing to the INTERNAL registry — going public must be explicit", async () => {
    const url = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(await readFile(url, "utf8")) as { publishConfig?: { registry?: string; access?: string } };
    expect(pkg.publishConfig?.registry ?? "").to.not.match(/registry\.npmjs\.org/);
    expect(pkg.publishConfig?.access).to.equal("public");   // required for a SCOPED package once it does go public
  });

  it("ships a LICENSE file, not just a license field", async () => {
    const url = new URL("../LICENSE", import.meta.url);
    expect((await readFile(url, "utf8")).slice(0, 11)).to.equal("MIT License");
  });

  // `bin` is the user-facing contract and is deliberately NOT the package name.
  it("ships the `gov` command regardless of what the package is called", async () => {
    const url = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(await readFile(url, "utf8")) as { bin: Record<string, string> };
    expect(Object.keys(pkg.bin)).to.include("gov");
  });
});
