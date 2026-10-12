// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** The WorkTrackerPort conformance suite against the `memory` adapter (unit tier), plus what only memory has. */
import { expect } from "chai";
import { workTrackerConformance } from "./work-tracker.conformance.js";
import { createMemoryWorkTracker } from "../../src/adapters/memory/work-tracker.js";
import { builtInProviders, pickAdapter } from "../../src/adapters/registry.js";
import { parseLinkMarker, stateOfStatus, linkMarker } from "../../src/ports/work-tracker.js";

const REPO = { owner: "acme", name: "work" };
const BOARD = { owner: "acme", number: 7 };

function seeded() {
  return createMemoryWorkTracker({ projects: [{ ref: BOARD, title: "Acme work" }], assignable: ["alice", "bob"] });
}

workTrackerConformance("memory", () => {
  const tracker = seeded();
  return {
    tracker, repo: REPO, project: BOARD, projectOwner: "acme", assignee: "alice", labels: ["gov-signal:ask", "intent"],
    missingProject: { owner: "acme", number: 999 }, missingItem: { url: "memory://acme/work/issues/999" },
    comments: async (i) => tracker.commentsOn(i),
    refuseNativeBlocks: () => tracker.refuseNativeBlocks(),
  };
});

describe("WorkTrackerPort — memory adapter specifics", () => {
  it("an assignee the tracker does not know is refused, as GitHub refuses one", async () => {
    const r = await seeded().create(REPO, { title: "t", body: "", assignee: "mallory" });
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.contain("mallory");
  });

  it("a board without a Status field: setState fails naming it", async () => {
    const t = createMemoryWorkTracker({ projects: [{ ref: BOARD, title: "x", statusField: false }], assignable: ["alice"] });
    const i = await t.create(REPO, { title: "t", body: "", assignee: "alice" }, [BOARD]);
    expect(i.ok).to.equal(true);
    if (!i.ok) return;
    const r = await t.setState(BOARD, i.value, "done");
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.match(/^no-field/);
  });

  it("the sync BoardWriter writes the same board the port reads", async () => {
    const t = seeded();
    const i = await t.create(REPO, { title: "t", body: "", assignee: "alice" }, [BOARD]);
    if (!i.ok) throw new Error(i.reason);
    expect(t.boardWriter().setState(BOARD, i.value.url, "in-progress")).to.deep.equal({ ok: true });
    const items = await t.items(BOARD);
    expect(items.ok && items.value[0]!.workState).to.equal("in-progress");
    expect(t.boardWriter().setState(BOARD, "memory://acme/work/issues/404", "done")).to.include({ ok: false, why: "not-on-board" });
    expect(t.boardWriter().closeProject(BOARD)).to.deep.equal({ ok: true });
    expect((await t.project(BOARD)).ok && ((await t.project(BOARD)) as { value: { state: string } }).value.state).to.equal("closed");
  });

  it("a closed item is found by state: closed", async () => {
    const t = seeded();
    const i = await t.create(REPO, { title: "t", body: "mark-1", assignee: "alice" });
    if (!i.ok) throw new Error(i.reason);
    t.closeItem(i.value);
    const r = await t.search({ marker: "mark-1", state: "closed" });
    expect(r.ok && r.value.map((x) => x.ref.url)).to.deep.equal([i.value.url]);
  });

  it("is registered as the memory adapter for workTracker; github is registered too", () => {
    expect(Object.keys(builtInProviders.workTracker).sort()).to.deep.equal(["github", "memory"]);
    expect(pickAdapter(builtInProviders, "workTracker", "memory")).to.have.property("setState");
    expect(pickAdapter(builtInProviders, "workTracker", "github")).to.have.property("setState");
  });
});

describe("WorkTrackerPort — words", () => {
  it("a Status option name means a state, whatever its case or spacing", () => {
    expect(["Todo", "To do", "TODO", "In progress", "In Progress", "in-progress", "Done", "Shipped"].map(stateOfStatus))
      .to.deep.equal(["todo", "todo", "todo", "in-progress", "in-progress", "in-progress", "done", null]);
  });

  it("a link marker round-trips", () => {
    const a = { url: "https://github.com/a/b/issues/1" }, b = { url: "https://github.com/a/b/issues/2" };
    const m = linkMarker(a, "blocks", b);
    expect(m).to.equal("<!-- gov-link https://github.com/a/b/issues/1 blocks https://github.com/a/b/issues/2 -->");
    expect(parseLinkMarker(`Blocked.\n${m}\n`)).to.deep.equal({ from: a, kind: "blocks", to: b });
    expect(parseLinkMarker("no marker")).to.equal(null);
  });
});
