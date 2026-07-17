// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { doctor, formatDoctorReport, type DoctorFacts } from "../../src/maintain/doctor.js";
import type { ResolveResult } from "../../src/resolve/types.js";

const resolved: ResolveResult = { ok: true, home: "/gov", org: "Svayamtech", via: "active-org" };
const unresolved: ResolveResult = { ok: false, code: 2, reason: "no-active-org" };

const facts = (over: Partial<DoctorFacts> = {}): DoctorFacts => ({
  gitPresent: true,
  ghPresent: true,
  resolve: resolved,
  activeOrg: "Svayamtech",
  cliVersion: "1.0.0",
  ...over,
});

describe("gov-work — doctor", () => {
  it("all green when tools present, workspace resolves, active org set", () => {
    const r = doctor(facts());
    expect(r.ok).to.equal(true);
    expect(r.diagnostics.every((d) => d.status === "ok")).to.equal(true);
    expect(r.diagnostics.find((d) => d.name === "CLI version")!.detail).to.equal("1.0.0");
  });

  it("fails (not ok) when git/gh missing or the workspace won't resolve", () => {
    expect(doctor(facts({ gitPresent: false })).ok).to.equal(false);
    expect(doctor(facts({ ghPresent: false })).ok).to.equal(false);
    const r = doctor(facts({ resolve: unresolved }));
    expect(r.ok).to.equal(false);
    expect(r.diagnostics.find((d) => d.name === "gov workspace")!.status).to.equal("fail");
  });

  it("warns on old-world content artifacts (points to gov-work upgrade)", () => {
    const r = doctor(facts({ staleArtifacts: ["framework/", "registry.yaml"] }));
    expect(r.ok).to.equal(true);
    const cl = r.diagnostics.find((d) => d.name === "content layout");
    expect(cl.status).to.equal("warn");
    expect(cl.detail).to.match(/gov-work upgrade/);
  });

  it("warns (still ok) on no active org", () => {
    const noOrg = doctor(facts({ activeOrg: null }));
    expect(noOrg.ok).to.equal(true);
    const org = noOrg.diagnostics.find((d) => d.name === "active org")!;
    expect(org.status).to.equal("warn");
    expect(org.detail).to.match(/gov-work org use/);
  });

  it("formats a printable report ending in the overall verdict", () => {
    const lines = formatDoctorReport(doctor(facts()));
    expect(lines[0]).to.match(/^ {2}✓ git:/);
    expect(lines[lines.length - 1]).to.equal("doctor: ok");
    expect(formatDoctorReport(doctor(facts({ gitPresent: false }))).pop()).to.match(/doctor: FAILED/);
  });
});
