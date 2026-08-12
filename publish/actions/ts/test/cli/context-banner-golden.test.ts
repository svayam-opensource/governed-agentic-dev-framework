// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * GOLDEN TEST — the context banner's three render lines are a CROSS-CLIENT CONVENTION.
 *
 * gov-work and gov-cicd each own their own `context-banner.ts`. There is no shared package and there is
 * not going to be one (ADR: no shared client core, 2026-08-10). What they share is the OUTPUT: the line a
 * human reads to answer *which governance repo am I acting on*. Two clients silently disagreeing about
 * that is the one failure the dissolved library was actually protecting against —
 * "two tools quietly read and write different repositories while reporting the same thing".
 *
 * So the convention is enforced where it can be enforced: on each client's own output, in each client's
 * own suite. A drift fails in the client that caused it, not in a shared build. gov-cicd holds the
 * mirror of this test (svm-prj-work#281).
 *
 * The convention is documented at
 *   knowledge/development/patterns/context-banner-convention.md   (svm-prj-work)
 * and is deliberately narrow: THREE LINES, their field order, labels and fallbacks. Everything else in
 * either file — comments, whether `Ack` is exported, helper shape — may differ freely, and does.
 *
 * If you are changing the expected strings below, you are changing a cross-client convention. Update the
 * convention doc and tell gov-cicd (anchor issue svm-prj-work#281) in the same change.
 */
import { expect } from "chai";
import { renderBanner, type ContextInfo } from "../../src/cli/context-banner.js";

const FULL: ContextInfo = {
  mode: "project",
  projectPath: "/w/PRJ-115-gov-work",
  govRepo: "/w/PRJ-115-gov-work/svm-prj-work",
  branch: "BRNCH-115-gov-work",
  orgConfigPath: "/w/PRJ-115-gov-work/svm-prj-work/org-config.yaml",
  user: "rkant@svayam.ai",
  services: { vault: "v", oidc: "o", jenkins: "j", npm: "n" },
  anomalies: [],
};

const EMPTY: ContextInfo = {
  mode: "none",
  projectPath: null,
  govRepo: null,
  branch: null,
  orgConfigPath: null,
  user: null,
  services: {},
  anomalies: [],
};

describe("context banner — cross-client convention (golden)", () => {
  it("renders the three agreed lines, fully populated", () => {
    expect(renderBanner(FULL).slice(0, 3)).to.deep.equal([
      "gov · context: PROJECT  (/w/PRJ-115-gov-work)   user: rkant@svayam.ai",
      "  gov_repo:   /w/PRJ-115-gov-work/svm-prj-work (BRNCH-115-gov-work)",
      "  org_config: /w/PRJ-115-gov-work/svm-prj-work/org-config.yaml   vault ✓ oidc ✓ jenkins ✓ npm ✓",
    ]);
  });

  it("renders the agreed FALLBACKS when nothing resolves — the case a reader most needs to trust", () => {
    expect(renderBanner(EMPTY).slice(0, 3)).to.deep.equal([
      "gov · context: NONE   user: (not logged in)",
      "  gov_repo:   (unresolved)",
      "  org_config: (none)   vault · oidc · jenkins · npm ·",
    ]);
  });

  it("keeps the service-status suffix in the agreed ORDER, with ✓/· per service", () => {
    const partial = { ...FULL, services: { vault: "v", npm: "n" } };
    expect(renderBanner(partial)[2]).to.match(/vault ✓ oidc · jenkins · npm ✓$/);
  });

  it("appends target env and anomalies AFTER the three lines, never inside them", () => {
    const noisy = { ...FULL, anomalies: ["org-config newer than ack"] };
    const out = renderBanner(noisy, "uat");
    expect(out.slice(0, 3)).to.deep.equal(renderBanner(FULL).slice(0, 3));
    expect(out.slice(3)).to.deep.equal(["  target env: uat", "  ⚠ org-config newer than ack"]);
  });
});
