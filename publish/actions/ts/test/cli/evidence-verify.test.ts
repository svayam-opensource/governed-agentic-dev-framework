// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// `gov evidence verify` — the free verifier's command (Q4). Exit 0 only when the ledger is whole; any break exits 1 and
// names the file and line / chain entry; a bad window is usage (2). Gaps are printed as runs with NO evidence.
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { evidenceCommand, type EvidenceDeps } from "../../src/cli/evidence-verb.js";
import { dirSource } from "../../src/evidence/verify.js";
import { buildLedger, gapRecord, record, type Ledger } from "../helpers/ledger-fixture.js";

describe("gov evidence verify", () => {
  let l: Ledger;
  let deps: EvidenceDeps;
  beforeEach(() => {
    l = buildLedger(
      [{ date: "2026/10/30", name: "ci-77-1-1", records: [record(1), record(2)] }, { date: "2026/11/02", name: "ci-77-2-1", records: [record(3)] }],
      { gaps: [{ date: "2026/10/31", name: "gap-ci-77-3-1", records: [gapRecord(1, { reason: "lease.refused" })] }] },
    );
    deps = { source: () => ({ ok: true, src: dirSource(l.dir) }), roots: [{ kid: l.root.kid, ...l.root.jwk }] };
  });
  afterEach(() => l.cleanup());

  it("a whole ledger: exit 0, the counts, the head, and the gap listed as a run with no evidence", async () => {
    const r = await evidenceCommand(["verify"], {}, deps);
    const out = r.lines.join("\n");
    expect(r.code, out).to.equal(0);
    expect(out).to.match(/2 entries/).and.match(/2 segments/).and.match(/3 records/);
    expect(out).to.match(/gap-ci-77-3-1\.jsonl line 1/).and.match(/lease\.refused/).and.match(/never a pass/);
    expect(out).to.match(/verified/i);
  });

  it("a break: exit 1, naming the chain file and entry", async () => {
    fs.rmSync(path.join(l.dir, l.segments[1]!));
    const r = await evidenceCommand(["verify"], {}, deps);
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.match(/evidence\/chain\/2026-11\.jsonl entry 2/).and.match(/NOT VERIFIED/);
  });

  it("--from/--to narrow the segments re-hashed", async () => {
    fs.rmSync(path.join(l.dir, l.segments[1]!));
    expect((await evidenceCommand(["verify"], { from: "2026-10-01", to: "2026-10-31" }, deps)).code).to.equal(0);
  });

  it("a malformed window, or from after to, is usage (2)", async () => {
    expect((await evidenceCommand(["verify"], { from: "2026-13-01" }, deps)).code).to.equal(2);
    expect((await evidenceCommand(["verify"], { from: "2026-11-01", to: "2026-10-01" }, deps)).code).to.equal(2);
    expect((await evidenceCommand(["nonsense"], {}, deps)).code).to.equal(2);
  });

  it("no ledger to read: exit 1 with the plain fix", async () => {
    const r = await evidenceCommand(["verify"], {}, { ...deps, source: () => ({ ok: false, line: "no evidence here" }) });
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.match(/no evidence here/);
  });

  it("test roots are trusted only with --test-roots, and the output says the ledger is a test ledger", async () => {
    const plain = await evidenceCommand(["verify"], {}, { ...deps, roots: [] });
    expect(plain.code).to.equal(1);
    const t = await evidenceCommand(["verify"], { "test-roots": true }, { ...deps, roots: [] });
    expect(t.code, t.lines.join("\n")).to.equal(0);
    expect(t.lines.join("\n")).to.match(/TEST roots/);
  });
});
