// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** Spec 03 §2.1 re-entry — a spec changed after the plan was approved marks the plan STALE. */
import { expect } from "chai";
import { planStaleness, replaceStatusLine, staleStatusLine } from "../../src/intent/status.js";

const PLAN = (status: string): string => `---\nx: y\n---\n\n# Plan 03\n\n${status}\n\n## Tasks\n`;

describe("plan staleness", () => {
  it("spec changed after the plan's approval → STALE, with the reason", () => {
    const r = planStaleness({ planApprovedAt: "2026-10-10T12:00:00Z", specChangedAt: "2026-10-11T08:00:00Z" });
    expect(r.stale).to.equal(true);
    expect(r.stale && r.why).to.equal("spec changed 2026-10-11 after the plan was approved 2026-10-10");
  });

  it("spec unchanged since (or changed at the same instant, or before) → not stale", () => {
    expect(planStaleness({ planApprovedAt: "2026-10-10T12:00:00Z", specChangedAt: "2026-10-09T08:00:00Z" }).stale).to.equal(false);
    expect(planStaleness({ planApprovedAt: "2026-10-10T12:00:00Z", specChangedAt: "2026-10-10T12:00:00Z" }).stale).to.equal(false);
  });

  it("compares instants, not strings (time zones)", () => {
    expect(planStaleness({ planApprovedAt: "2026-10-10T12:00:00+05:30", specChangedAt: "2026-10-10T07:00:00Z" }).stale).to.equal(true);
  });

  it("a plan not yet approved cannot be stale", () => {
    expect(planStaleness({ planApprovedAt: null, specChangedAt: "2026-10-11T08:00:00Z" }).stale).to.equal(false);
  });

  it("an unreadable time throws rather than guessing", () => {
    expect(() => planStaleness({ planApprovedAt: "soon", specChangedAt: "2026-10-11T08:00:00Z" })).to.throw(/time/);
  });

  it("writes the STALE Status line in place", () => {
    const line = staleStatusLine("spec changed 2026-10-11 after the plan was approved 2026-10-10");
    expect(line).to.equal("**Status: STALE (spec changed 2026-10-11 after the plan was approved 2026-10-10)**");
    const r = replaceStatusLine(PLAN("**Status: APPROVED by ada 2026-10-10 (memory://a/b/change/1)**"), line);
    expect(r.ok && r.value).to.equal(PLAN(line));
  });

  it("keeps CRLF line endings and touches only the first Status line", () => {
    const text = "# P\r\n**Status:** DRAFT\r\nbody **Status:** not a line start\r\n";
    const r = replaceStatusLine(text, "**Status: STALE (x)**");
    expect(r.ok && r.value).to.equal("# P\r\n**Status: STALE (x)**\r\nbody **Status:** not a line start\r\n");
  });

  it("ignores a Status line inside a code fence", () => {
    const text = "```\n**Status:** DRAFT\n```\n**Status:** DRAFT\n";
    const r = replaceStatusLine(text, "**Status: STALE (x)**");
    expect(r.ok && r.value).to.equal("```\n**Status:** DRAFT\n```\n**Status: STALE (x)**\n");
  });

  it("no Status line → a failed Result", () => {
    expect(replaceStatusLine("# P\n", "**Status: STALE (x)**").ok).to.equal(false);
  });
});
