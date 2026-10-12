// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE WorkTrackerPort CONFORMANCE SUITE (PRJ-121 intent 03, D7, plan L02).
 *
 * One suite, every adapter. Unit tests run it against `memory` (test/ports/work-tracker.memory.test.ts); the live
 * tier runs it against `github` in svayam-e2e with a fixture naming a sandbox repository and board. An adapter
 * that passes answers every question the same way, so a command that asks never needs to know which it got.
 *
 * Not a `*.test.ts` file on purpose: mocha does not pick it up by itself; a runner imports
 * {@link workTrackerConformance} and hands it a fixture.
 */
import { expect } from "chai";
import type { Result } from "../../src/ports/result.js";
import type { RepoRef } from "../../src/ports/vcs.js";
import { linkMarker, type ItemRef, type ProjectRef, type WorkTrackerPort } from "../../src/ports/work-tracker.js";

/** What an adapter's runner prepares. Everything named here must already exist. */
export interface WorkTrackerFixture {
  readonly tracker: WorkTrackerPort;
  /** A repository items may be created in. */
  readonly repo: RepoRef;
  /** An open project whose Status field has Todo, In progress and Done. */
  readonly project: ProjectRef;
  /** An account that may own a new project. */
  readonly projectOwner: string;
  /** A login that may be assigned in `repo`. */
  readonly assignee: string;
  /** Two labels that exist in `repo`. */
  readonly labels: readonly [string, string];
  /** A project that does not exist, and an item that does not exist. */
  readonly missingProject: ProjectRef;
  readonly missingItem: ItemRef;
  /** The comments on an item, oldest first — how the suite sees what a marker link wrote. */
  comments(i: ItemRef): Promise<string[]>;
  /** Make the tracker refuse a native `blocks` link from now on. Absent → the fallback case is skipped. */
  refuseNativeBlocks?(): void;
  /** Undo what the suite made (live: close the items and projects it created). */
  cleanup?(made: { readonly items: readonly ItemRef[]; readonly projects: readonly ProjectRef[] }): Promise<void>;
}

/** A failure with a reason a person can read, and whether to retry — never a throw, never `undefined`. */
function expectFailure(r: Result<unknown> | undefined, what: string): void {
  expect(r, `${what}: returned nothing`).to.be.an("object");
  expect(r!.ok, `${what}: ${JSON.stringify(r)}`).to.equal(false);
  if (!r!.ok) {
    expect(r!.reason, what).to.be.a("string").and.not.equal("");
    expect(r!.retryable, what).to.be.a("boolean");
  }
}

/** Register the suite under `describe("WorkTrackerPort conformance — <name>")`. `setup` runs before each case. */
export function workTrackerConformance(name: string, setup: () => Promise<WorkTrackerFixture> | WorkTrackerFixture): void {
  describe(`WorkTrackerPort conformance — ${name}`, function () {
    let fx: WorkTrackerFixture;
    const items: ItemRef[] = [];
    const projects: ProjectRef[] = [];
    let marker = "";
    let n = 0;

    beforeEach(async () => {
      fx = await setup();
      items.length = 0; projects.length = 0;
      marker = `gov-conformance-${Date.now().toString(36)}-${(n++).toString(36)}`;
    });
    afterEach(async () => { if (fx?.cleanup) await fx.cleanup({ items, projects }); });

    /** Create an item carrying this case's marker; fails the test if it cannot. */
    async function make(title: string, over: { labels?: readonly string[]; onto?: readonly ProjectRef[] } = {}): Promise<ItemRef> {
      const r = await fx.tracker.create(fx.repo, { title, body: `made by the WorkTrackerPort conformance suite\n${marker}`, assignee: fx.assignee, ...(over.labels ? { labels: over.labels } : {}) }, over.onto);
      expect(r.ok, JSON.stringify(r)).to.equal(true);
      if (!r.ok) throw new Error(r.reason);
      items.push(r.value);
      return r.value;
    }
    const onProject = async (i: ItemRef) => {
      const r = await fx.tracker.items(fx.project);
      expect(r.ok, JSON.stringify(r)).to.equal(true);
      return r.ok ? r.value.find((x) => x.ref.url === i.url) : undefined;
    };

    it("create(): an item needs an assignee — none (or blank) is refused and nothing is made", async () => {
      for (const assignee of ["", "  "]) {
        const r = await fx.tracker.create(fx.repo, { title: "conformance: unassigned", body: marker, assignee });
        if (r.ok) items.push(r.value);
        expectFailure(r, `assignee ${JSON.stringify(assignee)}`);
        if (!r.ok) expect(r.reason).to.match(/assignee/i);
      }
      const found = await fx.tracker.search({ marker, repo: fx.repo });
      expect(found).to.deep.equal({ ok: true, value: [] });
    });

    it("create(): assigned, labelled, onto the project — item() and items() read it back", async () => {
      const i = await make("conformance: create", { labels: [fx.labels[0]], onto: [fx.project] });
      const r = await fx.tracker.item(i);
      expect(r.ok, JSON.stringify(r)).to.equal(true);
      if (!r.ok) return;
      expect(r.value).to.deep.include({ title: "conformance: create", state: "open" });
      expect(r.value.ref.url).to.equal(i.url);
      expect(r.value.assignees).to.include(fx.assignee);
      expect(r.value.labels).to.include(fx.labels[0]);
      expect(r.value.body).to.contain(marker);
      expect(await onProject(i), "on the project").to.not.equal(undefined);
    });

    it("addToProject() / removeFromProject(): add (twice is fine), remove, and removing again fails", async () => {
      const i = await make("conformance: add-remove");
      expect(await onProject(i)).to.equal(undefined);
      expect(await fx.tracker.addToProject(fx.project, i)).to.deep.equal({ ok: true, value: undefined });
      expect(await fx.tracker.addToProject(fx.project, i)).to.deep.equal({ ok: true, value: undefined });
      expect(await onProject(i)).to.not.equal(undefined);
      expect(await fx.tracker.removeFromProject(fx.project, i)).to.deep.equal({ ok: true, value: undefined });
      expect(await onProject(i)).to.equal(undefined);
      expectFailure(await fx.tracker.removeFromProject(fx.project, i), "remove an item not on the project");
    });

    it("setState(): todo → in-progress → done, each read back from the project", async () => {
      const i = await make("conformance: state", { onto: [fx.project] });
      for (const s of ["todo", "in-progress", "done"] as const) {
        expect(await fx.tracker.setState(fx.project, i, s), s).to.deep.equal({ ok: true, value: undefined });
        expect((await onProject(i))?.workState, s).to.equal(s);
      }
    });

    it("setState(): an item not on the project is a failure with a reason", async () => {
      const i = await make("conformance: state-off-board");
      expectFailure(await fx.tracker.setState(fx.project, i, "done"), "setState off the board");
    });

    it("label(): adds and removes", async () => {
      const i = await make("conformance: label", { labels: [fx.labels[0]] });
      expect(await fx.tracker.label(i, [fx.labels[1]], [fx.labels[0]])).to.deep.equal({ ok: true, value: undefined });
      const r = await fx.tracker.item(i);
      expect(r.ok && [...r.value.labels]).to.deep.equal([fx.labels[1]]);
    });

    it("comment(): written; an empty comment is refused", async () => {
      const i = await make("conformance: comment");
      expect(await fx.tracker.comment(i, "a conformance comment")).to.deep.equal({ ok: true, value: undefined });
      expect(await fx.comments(i)).to.include("a conformance comment");
      expectFailure(await fx.tracker.comment(i, "   "), "empty comment");
    });

    it("search(): by label and marker, and by state", async () => {
      const a = await make("conformance: search a", { labels: [fx.labels[0]] });
      const b = await make("conformance: search b");
      const urls = (r: Result<{ ref: ItemRef }[]>) => (r.ok ? r.value.map((x) => x.ref.url).sort() : r);
      expect(urls(await fx.tracker.search({ marker, repo: fx.repo }))).to.deep.equal([a.url, b.url].sort());
      expect(urls(await fx.tracker.search({ marker, labels: [fx.labels[0]], repo: fx.repo }))).to.deep.equal([a.url]);
      expect(urls(await fx.tracker.search({ marker, labels: [fx.labels[0], fx.labels[1]], repo: fx.repo }))).to.deep.equal([]);
      expect(urls(await fx.tracker.search({ marker, state: "open", repo: fx.repo }))).to.deep.equal([a.url, b.url].sort());
      expect(urls(await fx.tracker.search({ marker, state: "closed", repo: fx.repo }))).to.deep.equal([]);
    });

    it("link(): relates and moved-to leave a marker comment on the first item", async () => {
      const a = await make("conformance: link a");
      const b = await make("conformance: link b");
      for (const kind of ["relates", "moved-to"] as const) {
        const r = await fx.tracker.link(a, b, kind);
        expect(r.ok, JSON.stringify(r)).to.equal(true);
        if (r.ok && r.value.via === "marker") expect((await fx.comments(a)).join("\n")).to.contain(linkMarker(a, kind, b));
      }
    });

    it("link(blocks): native when the tracker takes it", async () => {
      const a = await make("conformance: blocks a");
      const b = await make("conformance: blocks b");
      const r = await fx.tracker.link(a, b, "blocks");
      expect(r.ok, JSON.stringify(r)).to.equal(true);
    });

    it("link(blocks): when the tracker refuses, falls back to a marker comment on the blocked item — and says so", async function () {
      if (!fx.refuseNativeBlocks) return this.skip();
      const a = await make("conformance: fallback a");
      const b = await make("conformance: fallback b");
      fx.refuseNativeBlocks();
      const r = await fx.tracker.link(a, b, "blocks");
      expect(r).to.deep.equal({ ok: true, value: { via: "marker" } });
      expect((await fx.comments(b)).join("\n")).to.contain(linkMarker(a, "blocks", b));
    });

    it("createProject() then closeProject(pointer): open, then closed with the pointer in its description", async () => {
      const c = await fx.tracker.createProject(fx.projectOwner, `conformance ${marker}`);
      expect(c.ok, JSON.stringify(c)).to.equal(true);
      if (!c.ok) return;
      projects.push(c.value);
      const p = await fx.tracker.project(c.value);
      expect(p.ok && p.value).to.deep.include({ title: `conformance ${marker}`, state: "open" });
      const pointer = "https://example.invalid/moved-here";
      expect(await fx.tracker.closeProject(c.value, pointer)).to.deep.equal({ ok: true, value: undefined });
      const q = await fx.tracker.project(c.value);
      expect(q.ok && q.value.state).to.equal("closed");
      expect(q.ok && q.value.description).to.contain(pointer);
    });

    it("createProject(): an empty title is refused", async () => {
      const c = await fx.tracker.createProject(fx.projectOwner, " ");
      if (c.ok) projects.push(c.value);
      expectFailure(c, "empty title");
    });

    it("project() / item() / items(): one that does not exist is a failure, not a value", async () => {
      expectFailure(await fx.tracker.project(fx.missingProject), "project");
      expectFailure(await fx.tracker.items(fx.missingProject), "items");
      expectFailure(await fx.tracker.item(fx.missingItem), "item");
    });

    it("every write returns a Result: on what does not exist, each fails with a reason — none silent, none throws", async () => {
      const i = await make("conformance: writes");
      const t = fx.tracker;
      const writes: [string, () => Promise<Result<unknown>>][] = [
        ["create in a missing project", () => t.create(fx.repo, { title: "conformance: onto missing", body: marker, assignee: fx.assignee }, [fx.missingProject])],
        ["addToProject", () => t.addToProject(fx.missingProject, i)],
        ["removeFromProject", () => t.removeFromProject(fx.missingProject, i)],
        ["setState", () => t.setState(fx.missingProject, i, "done")],
        ["link", () => t.link(fx.missingItem, i, "relates")],
        ["label", () => t.label(fx.missingItem, [fx.labels[0]])],
        ["comment", () => t.comment(fx.missingItem, "x")],
        ["closeProject", () => t.closeProject(fx.missingProject)],
      ];
      for (const [what, call] of writes) {
        let r: Result<unknown> | undefined;
        try { r = await call(); } catch (e) { expect.fail(`${what} threw: ${(e as Error).message}`); }
        expectFailure(r, what);
      }
    });
  });
}
