// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// NO MODULE = TODAY, AND NO PHONE-HOME (spec 02 A1; I02.3). With nothing installed, discovering the module, building
// records and flushing them opens ZERO sockets and writes nothing: the records are dropped in-process. Asserted by
// counting every TCP/TLS connect attempt while the whole path runs.
import { expect } from "chai";
import * as fs from "node:fs";
import net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import tls from "node:tls";
import { flushEvidence, recordEvidence, resetEvidence, evidenceDrafts } from "../../src/check-seam/evidence.js";
import { sessionDraft } from "../../src/check-seam/record.js";

describe("check-seam — no module means no network (A1)", () => {
  const connects: string[] = [];
  const origNet = net.Socket.prototype.connect;
  const origTls = tls.connect;
  before(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (net.Socket.prototype as any).connect = function (...a: unknown[]) { connects.push(`net ${JSON.stringify(a[0])}`); throw new Error("network denied in test"); };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tls as any).connect = (...a: unknown[]) => { connects.push(`tls ${JSON.stringify(a[0])}`); throw new Error("network denied in test"); };
  });
  after(() => {
    net.Socket.prototype.connect = origNet;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tls as any).connect = origTls;
  });

  it("records, flush, discovery: zero sockets, nothing written, the buffer emptied", async () => {
    resetEvidence();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "gov-nonet-"));
    recordEvidence(sessionDraft({ boundary: "start", project: "PRJ-1", env: {} })!);
    expect(evidenceDrafts()).to.have.length(1);
    let asked = 0;
    const out = await flushEvidence({
      ctx: { surface: "local", govHome: home, env: { GOV_CHECK_HOME: path.join(home, "none") }, govVersion: "2.0.0" },
      govRoot: home,
      orgId: async () => { asked++; return 1; },
    });
    expect(out.state).to.equal("absent");
    expect(out.lines).to.deep.equal([]);
    expect(asked, "the org id is looked up only for a module").to.equal(0);
    expect(connects).to.deep.equal([]);
    expect(evidenceDrafts()).to.deep.equal([]);
    expect(fs.readdirSync(home)).to.deep.equal([]);
  });
});
