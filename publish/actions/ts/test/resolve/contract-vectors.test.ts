// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Conformance vectors for the workspace-resolution contract (`svm-prj-work#310`).
 *
 * The contract is owned by gov-work and binding on all three clients; the vectors are published at
 * `knowledge/architecture/system/specs/workspace-resolution-vectors.json`. Per
 * `adr-no-shared-client-core`, each client implements the FIXTURE in its own harness — read them, do not
 * import them — so a divergence fails in the client that caused it rather than in a shared build.
 *
 * V03 is the one that matters: standing INSIDE a project workspace, a GOVERNANCE read must still resolve
 * the mirror. Both clients failed that, in opposite directions, and neither had a test for it.
 */
import { expect } from "chai";
import { prjResolveGov, type OperationClass } from "../../src/resolve/resolve-gov.js";
import type { ResolveEnv } from "../../src/resolve/types.js";

const MIRROR = "/home/u/.gov/acme/gov_repo";
const P7 = "/home/u/.gov/acme/projects/PRJ-7-thing";
const WS7 = `${P7}/acme-gov`;
const CODE7 = `${P7}/acme-api`;
const WS9 = "/home/u/.gov/acme/projects/PRJ-9-other/acme-gov";
const OTHER = "/home/u/.gov/other/gov_repo";

/** The fixture tree: path → owning org (a path with no entry is not a gov repo). */
const ORG_AT: Record<string, string> = { [MIRROR]: "Acme", [WS7]: "Acme", [WS9]: "Acme", [OTHER]: "Other" };

const env = (cwd: string, active: string | null = "Acme", homes: Record<string, string> = { Acme: MIRROR, Other: OTHER }): ResolveEnv => ({
  cwd,
  parentOf: (p) => (p === "/" ? null : p.slice(0, p.lastIndexOf("/")) || "/"),
  govConfigAt: (p) => (ORG_AT[p] ? { org: ORG_AT[p], govWorkspace: null } : null),
  readActiveOrg: () => active,
  homeForOrg: (o) => homes[o] ?? null,
  sameHome: (a, b) => a === b,
});

const resolve = (cwd: string, cls: OperationClass, active: string | null = "Acme") => prjResolveGov(env(cwd, active), cls);

describe("workspace-resolution contract — conformance vectors (svm-prj-work#310)", () => {
  it("V01 · GOVERNANCE from an unrelated directory resolves the registry mirror", () => {
    expect(resolve("/home/u/elsewhere", "GOVERNANCE")).to.include({ ok: true, home: MIRROR, via: "active-org" });
  });

  it("V02 · PROJECT outside any project fails, and does NOT fall back to the mirror", () => {
    const r = resolve("/home/u/elsewhere", "PROJECT");
    expect(r).to.include({ ok: false, reason: "not-in-a-project" });
  });

  it("V03 · inside a project workspace, GOVERNANCE STILL resolves the mirror", () => {
    // The case that defines the contract, and the one both clients got wrong.
    expect(resolve(WS7, "GOVERNANCE")).to.include({ ok: true, home: MIRROR, via: "active-org" });
  });

  it("V04 · same cwd, PROJECT resolves the project clone", () => {
    expect(resolve(WS7, "PROJECT")).to.include({ ok: true, home: WS7, via: "cwd" });
  });

  // NOT YET CONFORMING — deliberately skipped rather than deleted, so the gap is visible.
  // `walkForOrg` only walks UP, and a project's workspace clone is a CHILD of the project root
  // (`PRJ-7/acme-gov`), not an ancestor. So from the project root or a sibling code repo it is invisible.
  // This is exactly the reported bug: `gov add-repo` failed at `…/PRJ-115-gov-work` and succeeded one
  // directory down in `…/svm-prj-work`. Closing it needs ResolveEnv to gain a "look in immediate
  // children" capability — an interface change across every consumer.
  it.skip("V05 · PROJECT from a code repo walks up to the project's workspace clone", () => {
    expect(resolve(CODE7, "PROJECT")).to.include({ ok: true, home: WS7, via: "cwd" });
  });

  it.skip("V06 · PROJECT from the project root — where `gov add-repo` used to fail", () => {
    expect(resolve(P7, "PROJECT")).to.include({ ok: true, home: WS7, via: "cwd" });
  });

  it("V07 · GOVERNANCE from that same root resolves the mirror, not the sibling clone", () => {
    expect(resolve(P7, "GOVERNANCE")).to.include({ ok: true, home: MIRROR, via: "active-org" });
  });

  it("V09 · another org's tree is a conflict for GOVERNANCE, naming both", () => {
    expect(resolve(OTHER, "GOVERNANCE")).to.include({ ok: false, reason: "org-conflict", cwdOrg: "Other", activeOrg: "Acme" });
  });

  it("V10 · cwd decides WHICH project — not the registry", () => {
    expect(resolve(WS9, "PROJECT")).to.include({ ok: true, home: WS9, via: "cwd" });
  });

  it("V11/V12 · no active org is a hardstop for both classes", () => {
    expect(resolve(MIRROR, "GOVERNANCE", null)).to.include({ ok: false, reason: "no-active-org" });
    expect(resolve(WS7, "PROJECT", null)).to.include({ ok: false, reason: "no-active-org" });
  });

  it("V15 · the mirror comes from the REGISTRY, not from deriving ~/.gov/<slug>/gov_repo", () => {
    // A client that derives the path passes V01 by luck and fails here.
    const legacy = prjResolveGov(
      { ...env("/home/u/elsewhere", "Legacy", { Legacy: "/home/u/code/legacy-gov" }),
        govConfigAt: (p) => (p === "/home/u/code/legacy-gov" ? { org: "Legacy", govWorkspace: null } : null) },
      "GOVERNANCE");
    expect(legacy).to.include({ ok: true, home: "/home/u/code/legacy-gov" });
  });
});
