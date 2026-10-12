// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** Spec 03 §4 — handover moves --items from the sender's board to the receiver's, recorded by one signal, at once. */
import { expect } from "chai";
import { createMemoryWorkTracker, type MemoryWorkTracker } from "../../src/adapters/memory/work-tracker.js";
import { handover } from "../../src/signal/handover.js";
import type { SignalEnv } from "../../src/signal/send.js";
import { parseMarker } from "../../src/signal/marker.js";

const GOV = { owner: "acme", name: "gov" };
const A = { owner: "acme", number: 1 }, B = { owner: "acme", number: 2 };
async function world(bWritable = true): Promise<{ t: MemoryWorkTracker; env: SignalEnv; x: string; y: string }> {
  const t = createMemoryWorkTracker({ projects: [{ ref: A, title: "a" }, { ref: B, title: "b", writable: bWritable }] });
  const mk = async (title: string) => { const r = await t.create(GOV, { title, body: "", assignee: "ann" }, [A]); if (!r.ok) throw new Error(r.reason); return r.value.url; };
  return { t, env: { tracker: t, govRepo: GOV, owner: "acme", login: "ann", project: "PRJ-1-alpha" }, x: await mk("x"), y: await mk("y") };
}
const on = async (t: MemoryWorkTracker, p: typeof A) => { const r = await t.items(p); return r.ok ? r.value.map((i) => i.ref.url) : []; };

describe("gov signal handover", () => {
  it("items move: off the sender's board, onto the receiver's; one closed signal records the list", async () => {
    const w = await world();
    const r = await handover(w.env, { to: "PRJ-2-beta", title: "hand over x, y", body: "", items: [w.x, w.y] });
    expect(r.ok, r.lines.join("\n")).to.equal(true);
    expect(await on(w.t, B)).to.include.members([w.x, w.y]);
    expect(await on(w.t, A)).to.not.include.members([w.x]);
    expect(await on(w.t, A)).to.not.include.members([w.y]);
    const s = await w.t.item({ url: r.url! });
    if (!s.ok) throw new Error(s.reason);
    expect(s.value.state).to.equal("closed");
    expect(s.value.labels).to.include("gov-signal:handover");
    expect(parseMarker(s.value.body)).to.deep.include({ kind: "handover", items: [w.x, w.y] });
  });

  it("needs --items", async () => {
    const w = await world();
    expect((await handover(w.env, { to: "PRJ-2-beta", title: "t", body: "", items: [] })).ok).to.equal(false);
  });

  it("an item the receiver's board refuses STAYS on the sender's board, and the report says so", async () => {
    const w = await world(false);
    const r = await handover(w.env, { to: "PRJ-2-beta", title: "t", body: "", items: [w.x] });
    expect(r.ok).to.equal(false);
    expect(await on(w.t, A)).to.include(w.x);
    expect(r.lines.join("\n")).to.match(/kept on PRJ-1-alpha/);
  });
});
