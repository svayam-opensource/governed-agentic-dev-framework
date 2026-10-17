// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// TAMPER IS CAUGHT, AND SAYS WHERE (spec 02 §3.2 "What tampering is caught", A3 unit half). The free verifier walks a
// fixture ledger written in-test with test-* keys and must name the file and the line / chain entry of every break:
//   edited record → that segment (and the line, when the edit shows in the line itself; else the seal line)
//   edited or deleted segment → the chain entry whose sha256 no longer matches
//   deleted or reordered chain entry → the `prev` break
//   a writer key no Svayam root certified → a cert failure
// and gaps are LISTED, never verified as evidence.
import { expect } from "chai";
import { sign } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { canonicalJson } from "../../src/evidence/canonical.js";
import { dirSource, formatBreak, verifyLedger, type VerifyResult } from "../../src/evidence/verify.js";
import { buildLedger, gapRecord, leaseJws, record, resignEntry, testKey, writerKey, type Ledger } from "../helpers/ledger-fixture.js";

const segs = [
  { date: "2026/10/30", name: "ci-77-9123-1", records: [record(1), record(2), record(3)] },
  { date: "2026/10/31", name: "local-dev1-01ja0000000000000000000001", records: [record(4, { source: "local", runKey: "local:01JA0000000000000000000004:GOV-ACME-004" })] },
  { date: "2026/11/01", name: "ci-77-9200-1", records: [record(5), record(6)] },
];

const verify = (l: Ledger, o: Partial<Parameters<typeof verifyLedger>[1]> = {}): VerifyResult =>
  verifyLedger(dirSource(l.dir), { roots: [{ kid: l.root.kid, ...l.root.jwk }], ...o });

const codes = (r: VerifyResult): string[] => r.breaks.map((b) => b.code);
const said = (r: VerifyResult): string => r.breaks.map(formatBreak).join("\n");

describe("evidence verify — tamper is caught and named (A3)", () => {
  let l: Ledger;
  beforeEach(() => { l = buildLedger(segs); });
  afterEach(() => l.cleanup());

  it("a ledger as written verifies: every entry, segment and record, across a month boundary", () => {
    const r = verify(l);
    expect(r.breaks, said(r)).to.deep.equal([]);
    expect(r.ok).to.equal(true);
    expect(r.counts).to.deep.equal({ entries: 3, segments: 3, records: 6 });
    expect(r.head?.n).to.equal(3);
    expect(r.writers).to.deep.equal([l.writer.kid]);
    expect(l.writer.kid).to.match(/^wk-[0-9a-f]{24}$/);
  });

  it("one byte edited inside a record line that stays valid JSON → the segment's seal root breaks (segment + seal line), and its chain sha256", () => {
    const rel = l.segments[0]!;
    l.write(rel, l.read(rel).replace('"at":"2026-10-12T09:14:03Z"', '"at":"2026-10-12T09:14:04Z"'));
    const r = verify(l);
    expect(r.ok).to.equal(false);
    const seal = r.breaks.find((b) => b.code === "seal.root")!;
    expect(seal.file).to.equal(rel);
    expect(seal.line).to.equal(4);
    expect(formatBreak(seal)).to.match(/evidence\/2026\/10\/30\/ci-77-9123-1\.jsonl line 4/);
    const chain = r.breaks.find((b) => b.code === "chain.sha256")!;
    expect(chain.file).to.equal("evidence/chain/2026-10.jsonl");
    expect(chain.entry).to.equal(1);
  });

  it("one byte edited so the line itself shows it → names the segment AND that record line", () => {
    const rel = l.segments[0]!;
    const lines = l.read(rel).split("\n");
    lines[1] = lines[1]!.replace('"verdict":"pass"', '"verdict":"pas5"');   // line 2
    l.write(rel, lines.join("\n"));
    const r = verify(l);
    const b = r.breaks.find((x) => x.file === rel && x.line === 2);
    expect(b, said(r)).to.not.equal(undefined);
    expect(formatBreak(b!)).to.match(/ci-77-9123-1\.jsonl line 2/);
  });

  it("a record line rewritten in non-canonical form → names that line", () => {
    const rel = l.segments[0]!;
    const lines = l.read(rel).split("\n");
    lines[2] = JSON.stringify(JSON.parse(lines[2]!), null, 0).replace("{", "{ ");
    l.write(rel, lines.join("\n"));
    const r = verify(l);
    expect(r.breaks.some((x) => x.file === rel && x.line === 3 && x.code === "segment.noncanonical"), said(r)).to.equal(true);
  });

  it("a segment deleted → the chain entry's sha256 cannot match (chain file + entry n)", () => {
    fs.rmSync(path.join(l.dir, l.segments[1]!));
    const r = verify(l);
    expect(r.ok).to.equal(false);
    const b = r.breaks.find((x) => x.code === "chain.sha256")!;
    expect(b.file).to.equal("evidence/chain/2026-10.jsonl");
    expect(b.entry).to.equal(2);
    expect(formatBreak(b)).to.match(/evidence\/chain\/2026-10\.jsonl entry 2/).and.match(/missing/);
  });

  it("a chain entry deleted → the next entry's prev breaks", () => {
    const rel = "evidence/chain/2026-10.jsonl";
    const lines = l.read(rel).split("\n").filter(Boolean);
    l.write(rel, `${lines[1]}\n`);   // entry 1 gone
    const r = verify(l);
    expect(codes(r)).to.include("chain.prev");
    const b = r.breaks.find((x) => x.code === "chain.prev")!;
    expect(b.entry).to.equal(2);
    expect(b.file).to.equal(rel);
  });

  it("chain entries reordered → prev breaks", () => {
    const rel = "evidence/chain/2026-10.jsonl";
    const lines = l.read(rel).split("\n").filter(Boolean);
    l.write(rel, `${lines[1]}\n${lines[0]}\n`);
    const r = verify(l);
    expect(r.breaks.filter((x) => x.code === "chain.prev").length).to.be.greaterThan(0);
  });

  it("an entry re-signed by its own writer after its prev was changed still breaks the link — the signature does not save it", () => {
    const rel = "evidence/chain/2026-10.jsonl";
    const e2 = resignEntry({ ...l.entries[1]!, prev: "a".repeat(64) }, l.writer);
    const lines = l.read(rel).split("\n").filter(Boolean);
    l.write(rel, `${lines[0]}\n${JSON.stringify(e2)}\n`);
    const r = verify(l);
    expect(r.breaks.map((b) => `${b.code}@${b.entry}`)).to.include("chain.prev@2");
    expect(codes(r)).to.not.include("chain.sig");
  });

  it("month boundary: entry 1 of November links to October's last entry — and a restarted chain is a break", () => {
    expect(verify(l).ok).to.equal(true);
    const rel = "evidence/chain/2026-11.jsonl";
    const e3 = resignEntry({ ...l.entries[2]!, prev: "0".repeat(64) }, l.writer);
    l.write(rel, `${JSON.stringify(e3)}\n`);
    const r = verify(l);
    const b = r.breaks.find((x) => x.code === "chain.prev")!;
    expect(b.file).to.equal(rel);
    expect(b.entry).to.equal(3);
  });

  it("a whole month file deleted → the next month's first entry breaks", () => {
    fs.rmSync(path.join(l.dir, "evidence/chain/2026-10.jsonl"));
    const r = verify(l);
    expect(r.breaks.some((x) => x.code === "chain.prev" && x.file === "evidence/chain/2026-11.jsonl"), said(r)).to.equal(true);
  });

  it("an edited chain entry signature → chain.sig; an edited seal signature → seal.sig", () => {
    const rel = "evidence/chain/2026-11.jsonl";
    const e = JSON.parse(l.read(rel)) as Record<string, unknown>;
    l.write(rel, `${JSON.stringify({ ...e, sig: String(e.sig).replace(/^./, (c) => (c === "A" ? "B" : "A")) })}\n`);
    const seg = l.segments[0]!;
    const lines = l.read(seg).split("\n");
    const s = JSON.parse(lines[3]!) as { seal: Record<string, unknown> };
    s.seal.sig = String(s.seal.sig).replace(/^./, (c) => (c === "A" ? "B" : "A"));
    lines[3] = JSON.stringify(s);
    l.write(seg, lines.join("\n"));
    const r = verify(l);
    expect(r.breaks.find((b) => b.code === "chain.sig")?.entry).to.equal(3);
    expect(r.breaks.find((b) => b.code === "seal.sig")?.file).to.equal(seg);
  });

  it("a segment on the branch that no chain entry names → unchained", () => {
    l.write("evidence/2026/10/30/ci-77-9999-1.jsonl", l.read(l.segments[0]!));
    const r = verify(l);
    expect(r.breaks.find((b) => b.code === "segment.unchained")?.file).to.equal("evidence/2026/10/30/ci-77-9999-1.jsonl");
  });

  it("--from/--to: a segment outside the window is not re-hashed; one inside is", () => {
    const rel = l.segments[0]!;   // 2026-10-30
    l.write(rel, l.read(rel).replace("09:14:03Z", "09:14:04Z"));
    expect(verify(l, { from: "2026-10-31", to: "2026-11-30" }).ok).to.equal(true);
    expect(verify(l, { from: "2026-10-01", to: "2026-10-30" }).ok).to.equal(false);
  });
});

describe("evidence verify — writer certificates chain to Svayam's roots", () => {
  it("a writer whose lease no trusted root signed → cert failure, naming the writer and its key file", () => {
    const rogueRoot = testKey("test-rogue");
    const w2 = writerKey();
    const l = buildLedger([{ ...segs[0]!, writer: w2 }], { extraWriters: [{ key: w2, leases: [leaseJws(rogueRoot, w2)] }] });
    try {
      const r = verify(l);
      expect(r.ok).to.equal(false);
      const b = r.breaks.find((x) => x.code === "cert.root")!;
      expect(b.file).to.equal(`evidence/keys/${w2.kid}.json`);
      expect(formatBreak(b)).to.match(/test-rogue/);
    } finally { l.cleanup(); }
  });

  it("a lease that certifies a DIFFERENT public key → cert failure", () => {
    const root = testKey("test-root-1");
    const w2 = writerKey();
    const other = testKey("test-other");
    const l = buildLedger([{ ...segs[0]!, writer: w2 }], { root, extraWriters: [{ key: w2, leases: [leaseJws(root, other)] }] });
    try {
      expect(verify(l).breaks.map((b) => b.code)).to.include("cert.key-mismatch");
    } finally { l.cleanup(); }
  });

  it("a lease that expired (beyond 72 h grace) before the segment's records were written → cert failure", () => {
    const root = testKey("test-root-1");
    const w2 = writerKey();
    const l = buildLedger([{ ...segs[0]!, writer: w2 }], { root, extraWriters: [{ key: w2, leases: [leaseJws(root, w2, { exp: Date.parse("2026-10-01T00:00:00Z") / 1000 })] }] });
    try {
      expect(verify(l).breaks.map((b) => b.code)).to.include("cert.expired");
    } finally { l.cleanup(); }
  });

  it("a writer with no key file → cert.missing", () => {
    const l = buildLedger(segs);
    try {
      fs.rmSync(path.join(l.dir, `evidence/keys/${l.writer.kid}.json`));
      expect(verify(l).breaks.map((b) => b.code)).to.include("cert.missing");
    } finally { l.cleanup(); }
  });

  it("a test-* root listed only in evidence/keys/roots.json is NOT trusted unless test roots are allowed — and says so when they are", () => {
    const l = buildLedger(segs);
    try {
      const plain = verifyLedger(dirSource(l.dir), { roots: [] });
      expect(plain.ok).to.equal(false);
      expect(plain.breaks.map((b) => b.code)).to.include("cert.root");
      const t = verifyLedger(dirSource(l.dir), { roots: [], trustTestRoots: true });
      expect(t.ok, t.breaks.map(formatBreak).join("\n")).to.equal(true);
      expect(t.notes.join(" ")).to.match(/TEST roots/);
      // gov-check writes roots.json as {roots: [...]}: the same entries, read the same way
      l.write("evidence/keys/roots.json", JSON.stringify({ roots: [{ kid: l.root.kid, ...l.root.jwk }] }));
      expect(verifyLedger(dirSource(l.dir), { roots: [], trustTestRoots: true }).ok).to.equal(true);
    } finally { l.cleanup(); }
  });

  it("a non-test root added to roots.json is trusted only when an already-trusted root endorses it (rotation)", () => {
    const shipped = testKey("svayam-root-1");
    const next = testKey("svayam-root-2");
    const w = writerKey();
    const l = buildLedger(segs, { root: next, writer: w });
    try {
      // roots.json lists next without an endorsement → not trusted
      expect(verifyLedger(dirSource(l.dir), { roots: [{ kid: shipped.kid, ...shipped.jwk }] }).breaks.map((b) => b.code)).to.include("cert.root");
      // endorse next with the shipped root
      const h = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "gov-root+jws", kid: shipped.kid })).toString("base64url");
      const c = Buffer.from(JSON.stringify({ kid: next.kid, x: next.jwk.x })).toString("base64url");
      const endorsement = `${h}.${c}.${sign(null, Buffer.from(`${h}.${c}`), shipped.priv).toString("base64url")}`;
      l.write("evidence/keys/roots.json", JSON.stringify({ keys: [{ kid: next.kid, ...next.jwk, endorsement }] }));
      const r = verifyLedger(dirSource(l.dir), { roots: [{ kid: shipped.kid, ...shipped.jwk }] });
      expect(r.ok, r.breaks.map(formatBreak).join("\n")).to.equal(true);
    } finally { l.cleanup(); }
  });
});

describe("evidence verify — the writer's format, as gov-check writes it", () => {
  const root = (): ReturnType<typeof testKey> => testKey("test-root-1");

  it("a key file listing several leases (a rotated lease) verifies seals made under any of them", () => {
    const r1 = root();
    const w = writerKey();
    const l = buildLedger([{ ...segs[0]!, writer: w }], { root: r1, writer: w });
    try {
      l.write(`evidence/keys/${w.kid}.json`, JSON.stringify({ kid: w.kid, jwk: w.jwk, leases: [leaseJws(r1, w, { jti: "older" }), leaseJws(r1, w)] }));
      const r = verify(l);
      expect(r.ok, r.breaks.map(formatBreak).join("\n")).to.equal(true);
    } finally { l.cleanup(); }
  });

  it("a seal whose cert names no lease in the key file → seal.cert", () => {
    const r1 = root();
    const w = writerKey();
    const l = buildLedger([{ ...segs[0]!, writer: w }], { root: r1, writer: w });
    try {
      l.write(`evidence/keys/${w.kid}.json`, JSON.stringify({ kid: w.kid, jwk: w.jwk, leases: [leaseJws(r1, w, { jti: "another" })] }));
      expect(verify(l).breaks.map((b) => b.code)).to.include("seal.cert");
    } finally { l.cleanup(); }
  });

  it("a kid that is not wk- + 24 hex of sha256(x) of its key → cert.invalid", () => {
    const w = { ...writerKey(), kid: "wk-000000000000000000000000" };
    const l = buildLedger([{ ...segs[0]!, writer: w }], { writer: w });
    try {
      expect(verify(l).breaks.map((b) => b.code)).to.include("cert.invalid");
    } finally { l.cleanup(); }
  });

  it("a lease without the evidence entitlement → cert.entitlement; a record for another org → cert.org", () => {
    const r1 = root();
    const w = writerKey();
    const l = buildLedger([{ ...segs[0]!, writer: w }], { root: r1, writer: w });
    try {
      l.write(`evidence/keys/${w.kid}.json`, JSON.stringify({ kid: w.kid, jwk: w.jwk, leases: [leaseJws(r1, w, { entitlements: ["deploy"], org: { vcs: "github", id: 1 } })] }));
      const codes2 = verify(l).breaks.map((b) => b.code);
      expect(codes2).to.include("cert.entitlement");
      expect(codes2).to.include("cert.org");
    } finally { l.cleanup(); }
  });

  it("a seal's chainPrev that is not its entry's prev → seal.chainPrev", () => {
    const l = buildLedger(segs);
    try {
      // segment 2 sealed against head 0 (zeros) instead of entry 1: re-seal it consistently, re-chain it
      const rel = l.segments[1]!;
      const lines = l.read(rel).split("\n");
      const s = JSON.parse(lines[1]!) as { seal: Record<string, unknown> };
      s.seal.chainPrev = "0".repeat(64);
      delete s.seal.sig;
      s.seal.sig = sign(null, Buffer.from(canonicalJson(s.seal)), l.writer.priv).toString("base64url");
      lines[1] = canonicalJson(s);
      l.write(rel, lines.join("\n"));
      expect(verify(l).breaks.find((b) => b.code === "seal.chainPrev")?.file).to.equal(rel);
    } finally { l.cleanup(); }
  });

  it("a gap record inside a SEALED segment is a break — gaps are never sealed as evidence", () => {
    const l = buildLedger([{ date: "2026/10/30", name: "ci-77-1-1", records: [record(1), gapRecord(2)] }]);
    try {
      const b = verify(l).breaks.find((x) => x.code === "segment.gap");
      expect(b?.line).to.equal(2);
    } finally { l.cleanup(); }
  });
});

describe("evidence verify — gaps are listed, never passed", () => {
  it("a gap segment is listed with its run and reason, and counts as no verified segment or record", () => {
    const l = buildLedger(segs, { gaps: [{ date: "2026/10/13", name: "gap-local-dev1-01jb0000000000000000000001", records: [gapRecord(1), gapRecord(2, { reason: "lease.refused" })] }] });
    try {
      const r = verify(l);
      expect(r.ok).to.equal(true);
      expect(r.counts).to.deep.equal({ entries: 3, segments: 3, records: 6 });
      expect(r.gaps.map((g) => [g.line, g.reason])).to.deep.equal([[1, "lease.expired"], [2, "lease.refused"]]);
      expect(r.gaps[0]!.file).to.equal("evidence/2026/10/13/gap-local-dev1-01jb0000000000000000000001.jsonl");
      expect(r.gaps[0]!.runKey).to.match(/^local:/);
    } finally { l.cleanup(); }
  });

  it("a gap file carrying a verdict record is a break — it is never counted as a pass", () => {
    const l = buildLedger(segs, { gaps: [{ date: "2026/10/13", name: "gap-ci-77-1-1", records: [record(9)] }] });
    try {
      const r = verify(l);
      expect(r.ok).to.equal(false);
      expect(r.breaks.find((b) => b.code === "gap.not-gap")?.line).to.equal(1);
      expect(r.counts.records).to.equal(6);
    } finally { l.cleanup(); }
  });

  it("an evidence tree with gaps only verifies nothing as evidence — zero entries, the gaps listed", () => {
    const l = buildLedger([], { gaps: [{ date: "2026/10/13", name: "gap-ci-77-1-1", records: [gapRecord(1)] }] });
    try {
      const r = verify(l);
      expect(r.counts).to.deep.equal({ entries: 0, segments: 0, records: 0 });
      expect(r.gaps).to.have.length(1);
    } finally { l.cleanup(); }
  });
});
