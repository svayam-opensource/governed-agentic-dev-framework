// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov signal` ask / depends / notice, list, ack, send-a-draft — spec 03 §4 on the memory work tracker.
 * One signal = one issue in the gov repo, labelled gov-signal:<kind>, marker in its body, on BOTH boards.
 */
import { expect } from "chai";
import { createMemoryWorkTracker, type MemoryWorkTracker } from "../../src/adapters/memory/work-tracker.js";
import { sendSignal, type SignalEnv } from "../../src/signal/send.js";
import { listSignals, addIncomingToBoard, manifestLines } from "../../src/signal/list.js";
import { ackSignal } from "../../src/signal/ack.js";
import { parseDraft } from "../../src/signal/draft.js";
import { parseMarker } from "../../src/signal/marker.js";

const GOV = { owner: "acme", name: "acme-gov" };
const A = { owner: "acme", number: 1 }, B = { owner: "acme", number: 2 };

async function world(opts: { bWritable?: boolean } = {}): Promise<{ t: MemoryWorkTracker; envA: SignalEnv; envB: SignalEnv; anchorA: string }> {
  const t = createMemoryWorkTracker({ projects: [{ ref: A, title: "PRJ-1-alpha" }, { ref: B, title: "PRJ-2-beta", writable: opts.bWritable !== false }] });
  const anchor = await t.create(GOV, { title: "PRJ-1 anchor", body: "", assignee: "ann", labels: ["anchor"] }, [A]);
  if (!anchor.ok) throw new Error(anchor.reason);
  const base = { tracker: t, govRepo: GOV, owner: "acme" };
  return { t, anchorA: anchor.value.url, envA: { ...base, login: "ann", project: "PRJ-1-alpha" }, envB: { ...base, login: "bob", project: "PRJ-2-beta" } };
}
const req = (kind: "ask" | "depends" | "notice", over: Record<string, unknown> = {}) => ({ kind, to: "PRJ-2-beta", title: "need X", body: "please", items: [], ...over });
const onBoard = async (t: MemoryWorkTracker, p: typeof A, url: string) => { const r = await t.items(p); return r.ok && r.value.some((i) => i.ref.url === url); };

describe("gov signal — send (spec 03 §4)", () => {
  for (const kind of ["ask", "depends", "notice"] as const) {
    it(`${kind}: one issue in the gov repo, label gov-signal:${kind}, marker, on both boards, assigned to the sender`, async () => {
      const w = await world();
      const r = await sendSignal(w.envA, req(kind));
      expect(r.ok, r.lines.join("\n")).to.equal(true);
      const it_ = await w.t.item({ url: r.url! });
      if (!it_.ok) throw new Error(it_.reason);
      expect(it_.value.labels).to.include(`gov-signal:${kind}`);
      expect(it_.value.assignees).to.deep.equal(["ann"]);
      expect(r.url!.startsWith("memory://acme/acme-gov/")).to.equal(true);
      expect(parseMarker(it_.value.body)).to.deep.include({ kind, from: "PRJ-1-alpha", to: "PRJ-2-beta" });
      expect(await onBoard(w.t, A, r.url!)).to.equal(true);
      expect(await onBoard(w.t, B, r.url!)).to.equal(true);
    });
  }

  it("ask: Status Todo on the receiver's board", async () => {
    const w = await world();
    const r = await sendSignal(w.envA, req("ask"));
    const items = await w.t.items(B);
    expect(items.ok && items.value.find((i) => i.ref.url === r.url)?.workState).to.equal("todo");
  });

  it("depends: the sender's anchor is blocked by the signal (or each --items)", async () => {
    const w = await world();
    const r = await sendSignal(w.envA, req("depends"));
    expect(r.ok).to.equal(true);
    const blocked = w.t.nativeLinks().filter((l) => l.kind === "blocks" && l.a === r.url);
    expect(blocked.map((l) => l.b)).to.deep.equal([w.anchorA]);
    const item = await w.t.create(GOV, { title: "task", body: "", assignee: "ann" }, [A]);
    if (!item.ok) throw new Error(item.reason);
    const r2 = await sendSignal(w.envA, req("depends", { items: [item.value.url] }));
    expect(w.t.nativeLinks().filter((l) => l.a === r2.url).map((l) => l.b)).to.deep.equal([item.value.url]);
  });

  it("depends: a refused native link falls back to the marker — and the report says so", async () => {
    const w = await world();
    w.t.refuseNativeBlocks();
    const r = await sendSignal(w.envA, req("depends"));
    expect(r.ok).to.equal(true);
    expect(r.lines.join("\n")).to.match(/marker/);
  });

  it("Q5: the receiver's board is not writable → the issue is still created and the receiver finds it by label + marker", async () => {
    const w = await world({ bWritable: false });
    const r = await sendSignal(w.envA, req("ask"));
    expect(r.ok).to.equal(true);
    expect(r.lines.join("\n")).to.match(/could not be added to PRJ-2-beta's board/);
    expect(await onBoard(w.t, B, r.url!)).to.equal(false);
    const l = await listSignals(w.envB);
    if (!l.ok) throw new Error(l.reason);
    expect(l.incoming.map((s) => s.url)).to.deep.equal([r.url]);
    expect(l.notOnBoard.map((s) => s.url)).to.deep.equal([r.url]);
  });

  it("refuses an unknown receiver project id and a handover/merge (L08)", async () => {
    const w = await world();
    expect((await sendSignal(w.envA, req("ask", { to: "nonsense" }))).ok).to.equal(false);
    expect((await sendSignal(w.envA, req("ask", { title: "  " }))).ok).to.equal(false);
  });
});

describe("gov signal — list, manifest lines, ack", () => {
  it("list: incoming for the receiver, outgoing for the sender; the manifest lines name them, or 'none'", async () => {
    const w = await world();
    const r = await sendSignal(w.envA, req("notice"));
    const a = await listSignals(w.envA), b = await listSignals(w.envB);
    if (!a.ok || !b.ok) throw new Error("list");
    expect(a.outgoing.map((s) => s.url)).to.deep.equal([r.url]);
    expect(a.incoming).to.deep.equal([]);
    expect(b.incoming.map((s) => s.url)).to.deep.equal([r.url]);
    const lines = manifestLines(b);
    expect(lines[0]).to.match(/^- \*\*Incoming signals:\*\* notice from PRJ-1-alpha — need X \(memory:/);
    expect(lines[1]).to.equal("- **Outgoing signals:** none");
  });

  it("list --add: puts incoming signals that are missing from the receiver's board onto it", async () => {
    const w = await world();
    const r = await sendSignal(w.envA, req("ask"));
    await w.t.removeFromProject(B, { url: r.url! });
    const l = await listSignals(w.envB);
    if (!l.ok) throw new Error(l.reason);
    const added = await addIncomingToBoard(w.envB, l.notOnBoard);
    expect(added.every((x) => x.ok)).to.equal(true);
    expect(await onBoard(w.t, B, r.url!)).to.equal(true);
  });

  it("ack: the receiver answers an ask — comment + closed; then it is gone from both lists", async () => {
    const w = await world();
    const r = await sendSignal(w.envA, req("ask"));
    const k = await ackSignal(w.envB, r.url!, "X is done");
    expect(k.ok, k.lines.join("\n")).to.equal(true);
    expect(w.t.commentsOn({ url: r.url! })).to.include("X is done");
    const a = await listSignals(w.envA);
    expect(a.ok && a.outgoing).to.deep.equal([]);
  });

  it("ack: an ask or depends needs an answer; a notice does not", async () => {
    const w = await world();
    const ask = await sendSignal(w.envA, req("ask"));
    expect((await ackSignal(w.envB, ask.url!)).ok).to.equal(false);
    const n = await sendSignal(w.envA, req("notice"));
    expect((await ackSignal(w.envB, n.url!)).ok).to.equal(true);
  });

  it("ack: only the receiving project may acknowledge", async () => {
    const w = await world();
    const r = await sendSignal(w.envA, req("notice"));
    const k = await ackSignal(w.envA, r.url!);
    expect(k.ok).to.equal(false);
    expect(k.lines.join("\n")).to.match(/PRJ-2-beta/);
  });
});

describe("gov signal — drafts an agent writes (Q6)", () => {
  it("parses a draft: front matter kind/to/title/items + body", () => {
    const d = parseDraft("---\nkind: ask\nto: PRJ-2-beta\ntitle: need X\nitems: [\"memory://acme/acme-gov/9\"]\n---\n\nWhy we ask.\n");
    expect(d).to.deep.equal({ ok: true, value: { kind: "ask", to: "PRJ-2-beta", title: "need X", items: ["memory://acme/acme-gov/9"], body: "Why we ask." } });
  });
  it("a draft with no kind, a bad kind or no receiver is refused, saying what is missing", () => {
    expect(parseDraft("---\nto: PRJ-2\ntitle: t\n---\n").ok).to.equal(false);
    expect(parseDraft("---\nkind: shout\nto: PRJ-2\ntitle: t\n---\n").ok).to.equal(false);
    const r = parseDraft("no front matter");
    expect(r.ok).to.equal(false);
  });
});
