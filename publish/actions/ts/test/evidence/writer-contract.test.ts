// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// E10 CONTRACT: the ledger a conforming writer produces (spec 02 §3.2–3.4) is accepted by gov's free verifier.
//   1. in-test: a ledger built with node:crypto Ed25519 and gadf's own canonicalJson —
//      segments across a month boundary, local and CI sources, a gap file — verifies, counts exactly, lists the gap.
//   2. cross-repo: the paid module's committed fixture ledger (counts-checked by hand in E06: 6 entries, 6 segments,
//      17 records, 2 writers, 1 gap). SKIPPED unless GC_FIXTURE=<path to gov-check test/fixtures/report-ledger> is set,
//      so this public repo never carries the module's code or data.
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { dirSource, verifyLedger, formatBreak } from "../../src/evidence/verify.js";
import { buildLedger, gapRecord, record } from "../helpers/ledger-fixture.js";

describe("evidence writer contract (E10)", () => {
  it("a cross-month, local+CI ledger with a gap verifies; the gap is listed and never counted", () => {
    const l = buildLedger(
      [
        { date: "2026/09/30", name: "ci-77-9001-1", records: [record(1), record(2)] },
        { date: "2026/10/01", name: "local-dev1-01ja0000000000000000000001", records: [record(3, { source: "local", runKey: "local:01JA0000000000000000000003:GOV-ACME-003" })] },
        { date: "2026/10/02", name: "ci-77-9002-1", records: [record(4), record(5), record(6)] },
      ],
      { gaps: [{ date: "2026/10/01", name: "gap-ci-77-9003-1", records: [gapRecord(1, { reason: "lease.refused" })] }] },
    );
    try {
      const r = verifyLedger(dirSource(l.dir), { roots: [{ kid: l.root.kid, ...l.root.jwk }] });
      expect(r.breaks.map(formatBreak)).to.deep.equal([]);
      expect(r.ok).to.equal(true);
      expect(r.counts).to.deep.equal({ entries: 3, segments: 3, records: 6 });
      expect(r.gaps).to.have.length(1);
      expect(r.gaps[0]!.reason).to.equal("lease.refused");
    } finally {
      l.cleanup();
    }
  });

  const fixture = process.env.GC_FIXTURE;
  (fixture ? it : it.skip)("the paid module's committed fixture ledger verifies with its keyset roots (GC_FIXTURE)", () => {
    const keyset = JSON.parse(fs.readFileSync(path.join(fixture!, "keyset.json"), "utf8")) as { keys: { kid: string; kty: "OKP"; crv: "Ed25519"; x: string }[] };
    const r = verifyLedger(dirSource(fixture!), { roots: keyset.keys, trustTestRoots: true });
    expect(r.breaks.map(formatBreak)).to.deep.equal([]);
    expect(r.ok).to.equal(true);
    expect(r.counts).to.deep.equal({ entries: 6, segments: 6, records: 17 });
    expect(r.writers).to.have.length(2);
    expect(r.gaps).to.have.length(1);
  });
});
