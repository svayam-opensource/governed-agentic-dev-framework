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
  cliVersion: "0.8.0",
  frameworkVersion: "0.8.0",
  ...over,
});

describe("prj-work Phase E — doctor", () => {
  it("all green when tools present, workspace resolves, versions match", () => {
    const r = doctor(facts());
    expect(r.ok).to.equal(true);
    expect(r.diagnostics.every((d) => d.status === "ok")).to.equal(true);
  });

  it("fails (not ok) when git/gh missing or the workspace won't resolve", () => {
    expect(doctor(facts({ gitPresent: false })).ok).to.equal(false);
    expect(doctor(facts({ ghPresent: false })).ok).to.equal(false);
    const r = doctor(facts({ resolve: unresolved }));
    expect(r.ok).to.equal(false);
    expect(r.diagnostics.find((d) => d.name === "gov workspace")!.status).to.equal("fail");
  });

  it("warns (still ok) on no active org and on version drift", () => {
    const noOrg = doctor(facts({ activeOrg: null }));
    expect(noOrg.ok).to.equal(true);
    expect(noOrg.diagnostics.find((d) => d.name === "active org")!.status).to.equal("warn");

    const drift = doctor(facts({ frameworkVersion: "0.7.4" }));
    expect(drift.ok).to.equal(true);
    const v = drift.diagnostics.find((d) => d.name === "version drift")!;
    expect(v.status).to.equal("warn");
    expect(v.detail).to.match(/prj upgrade/);
  });

  it("formats a printable report ending in the overall verdict", () => {
    const lines = formatDoctorReport(doctor(facts()));
    expect(lines[0]).to.match(/^ {2}✓ git:/);
    expect(lines[lines.length - 1]).to.equal("doctor: ok");
    expect(formatDoctorReport(doctor(facts({ gitPresent: false }))).pop()).to.match(/doctor: FAILED/);
  });
});
