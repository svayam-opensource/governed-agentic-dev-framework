// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
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

  it("carries the transitional package identity", () => {
    expect(PACKAGE_NAME).to.equal("@svayam-opensource/gov");
  });
});
