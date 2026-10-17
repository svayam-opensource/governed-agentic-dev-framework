// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Spec 03 §4 — merge: every item and linked repo of the sender goes to the receiver; the sender's board closes, its
 * anchor closes with a pointer. Needs the owner of BOTH boards; refuses otherwise, before anything moves.
 */
import { expect } from "chai";
import { createMemoryWorkTracker, type MemoryWorkTracker } from "../../src/adapters/memory/work-tracker.js";
import { mergeProjects, type MergeDeps } from "../../src/signal/merge.js";
import type { SignalEnv } from "../../src/signal/send.js";
import { ok } from "../../src/ports/result.js";

const GOV = { owner: "acme", name: "gov" };
const A = { owner: "acme", number: 1 }, B = { owner: "acme", number: 2 };
async function world(owner: { a: boolean; b: boolean } = { a: true, b: true }) {
  const t = createMemoryWorkTracker({ projects: [{ ref: A, title: "a" }, { ref: B, title: "b" }] });
  const mk = async (title: string, labels: string[] = []) => { const r = await t.create(GOV, { title, body: "", assignee: "ann", labels }, [A]); if (!r.ok) throw new Error(r.reason); return r.value.url; };
  const anchor = await mk("anchor", ["anchor"]);
  const x = await mk("x");
  const env: SignalEnv = { tracker: t, govRepo: GOV, owner: "acme", login: "ann", project: "PRJ-1-alpha" };
  const deps: MergeDeps = {
    isOwner: async (p) => (p.number === 1 ? owner.a : owner.b),
    repos: async (p) => ok(p.number === 1 ? ["https://github.com/acme/svc", "https://github.com/acme/ui"] : ["https://github.com/acme/ui"]),
  };
  return { t, env, deps, anchor, x };
}
const on = async (t: MemoryWorkTracker, p: typeof A) => { const r = await t.items(p); return r.ok ? r.value.map((i) => i.ref.url) : []; };

describe("gov signal merge", () => {
  it("moves every item, names the repos to add, closes the sender's board and anchor with a pointer", async () => {
    const w = await world();
    const r = await mergeProjects(w.env, w.deps, { to: "PRJ-2-beta", title: "fold alpha into beta", body: "" });
    expect(r.ok, r.lines.join("\n")).to.equal(true);
    expect(await on(w.t, B)).to.include.members([w.x]);
    const pa = await w.t.project(A);
    expect(pa.ok && pa.value.state).to.equal("closed");
    expect(pa.ok && pa.value.description).to.match(/PRJ-2-beta/);
    const an = await w.t.item({ url: w.anchor });
    expect(an.ok && an.value.state).to.equal("closed");
    expect(w.t.commentsOn({ url: w.anchor }).join()).to.match(/Merged into PRJ-2-beta/);
    expect(r.lines.join("\n")).to.match(/gov add-repo https:\/\/github.com\/acme\/svc/);
    expect(r.lines.join("\n")).to.not.match(/gov add-repo https:\/\/github.com\/acme\/ui/);
  });

  it("refuses unless the invoker owns BOTH boards — and nothing moves", async () => {
    for (const owner of [{ a: true, b: false }, { a: false, b: true }]) {
      const w = await world(owner);
      const r = await mergeProjects(w.env, w.deps, { to: "PRJ-2-beta", title: "t", body: "" });
      expect(r.ok).to.equal(false);
      expect(r.lines.join("\n")).to.match(/owner of both/);
      expect(await on(w.t, B)).to.deep.equal([]);
      const pa = await w.t.project(A);
      expect(pa.ok && pa.value.state).to.equal("open");
    }
  });

  it("an item that cannot move stops the merge before the board is closed", async () => {
    const w = await world();
    const t2 = createMemoryWorkTracker({ projects: [{ ref: A, title: "a" }, { ref: B, title: "b", writable: false }] });
    const it_ = await t2.create(GOV, { title: "z", body: "", assignee: "ann" }, [A]);
    if (!it_.ok) throw new Error(it_.reason);
    const r = await mergeProjects({ ...w.env, tracker: t2 }, w.deps, { to: "PRJ-2-beta", title: "t", body: "" });
    expect(r.ok).to.equal(false);
    const pa = await t2.project(A);
    expect(pa.ok && pa.value.state).to.equal("open");
  });
});
