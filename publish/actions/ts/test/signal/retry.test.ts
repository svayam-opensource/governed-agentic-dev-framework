// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * F68 (RULED A 2026-11-16): `gov signal`'s create / comment / close survive a brief GitHub error — up to 3 retries
 * after ~2/4/8 s, a check before each retry so nothing is made twice, a permanent refusal returned at once, and
 * after the last try a message saying what was saved and how to finish by hand.
 */
import { expect } from "chai";
import { createMemoryWorkTracker } from "../../src/adapters/memory/work-tracker.js";
import { fail, type Result } from "../../src/ports/result.js";
import type { WorkTrackerPort } from "../../src/ports/work-tracker.js";
import { retryingTracker, SIGNAL_RETRY_DELAYS_MS, writeMarker } from "../../src/signal/retry.js";
import { ackSignal } from "../../src/signal/ack.js";
import { sendSignal, type SignalEnv } from "../../src/signal/send.js";

const GOV = { owner: "acme", name: "acme-gov" };
const A = { owner: "acme", number: 1 }, B = { owner: "acme", number: 2 };
const TRANSIENT = fail("gh: HTTP 502 Bad Gateway", true);
const REFUSED = fail("gh: HTTP 422 Validation Failed", false);

type Write = "create" | "comment" | "close";
/**
 * A memory tracker whose next writes misbehave as scripted: `fail` — refused without effect; `lost` — the write
 * HAPPENS but the answer is a transient error (the case a blind retry would duplicate).
 */
function flaky(script: Partial<Record<Write, ("fail" | "lost" | "refuse")[]>>, opts: { noReads?: boolean } = {}) {
  const t = createMemoryWorkTracker({ projects: [{ ref: A, title: "PRJ-1-alpha" }, { ref: B, title: "PRJ-2-beta" }] });
  const calls: Record<Write, number> = { create: 0, comment: 0, close: 0 };
  const wrap = <T>(w: Write, real: () => Promise<Result<T>>): Promise<Result<T>> => {
    calls[w]++;
    const step = script[w]?.shift();
    if (step === "fail") return Promise.resolve(TRANSIENT);
    if (step === "refuse") return Promise.resolve(REFUSED);
    if (step === "lost") return real().then(() => TRANSIENT);
    return real();
  };
  const port: WorkTrackerPort = {
    ...t,
    create: (where, item, onto) => wrap("create", () => t.create(where, item, onto)),
    comment: (i, text) => wrap("comment", () => t.comment(i, text)),
    close: (i) => wrap("close", () => t.close(i)),
    ...(opts.noReads ? { comments: undefined, recent: undefined } : {}),
  };
  const slept: number[] = [];
  const tracker = retryingTracker(port, { sleep: async (ms) => { slept.push(ms); } });
  return { t, tracker, calls, slept };
}
const env = (tracker: WorkTrackerPort, login: string, project: string): SignalEnv => ({ tracker, govRepo: GOV, owner: "acme", login, project });
const newItem = { title: "need X", body: "please", assignee: "ann", labels: ["gov-signal:ask"] };

describe("F68: gov signal retries a brief GitHub error", () => {
  it("waits ~2, 4, 8 s between tries", () => {
    expect(SIGNAL_RETRY_DELAYS_MS).to.deep.equal([2000, 4000, 8000]);
  });

  describe("create", () => {
    it("transient, then ok → one issue", async () => {
      const f = flaky({ create: ["fail"] });
      const r = await f.tracker.create(GOV, newItem);
      expect(r.ok).to.equal(true);
      expect(f.calls.create).to.equal(2);
      expect(f.slept).to.deep.equal([2000]);
      const all = await f.t.search({ repo: GOV });
      expect(all.ok && all.value.length).to.equal(1);
    });
    it("landed despite the error → not created again; the existing one is returned", async () => {
      const f = flaky({ create: ["lost"] });
      const r = await f.tracker.create(GOV, newItem);
      expect(r.ok).to.equal(true);
      expect(f.calls.create).to.equal(1);
      const all = await f.t.search({ repo: GOV });
      expect(all.ok && all.value.length).to.equal(1);
      expect(r.ok && all.ok && r.value.url).to.equal(all.ok ? all.value[0]!.ref.url : "");
    });
    it("a permanent refusal (4xx) is not retried", async () => {
      const f = flaky({ create: ["refuse"] });
      const r = await f.tracker.create(GOV, newItem);
      expect(r.ok).to.equal(false);
      expect(f.calls.create).to.equal(1);
      expect(f.slept).to.deep.equal([]);
    });
    it("still failing after 3 retries → says so; gov signal says nothing was saved and how to redo it", async () => {
      const f = flaky({ create: ["fail", "fail", "fail", "fail"] });
      const r = await sendSignal(env(f.tracker, "ann", "PRJ-1-alpha"), { kind: "ask", to: "PRJ-2-beta", title: "need X", body: "please", items: [] });
      expect(r.ok).to.equal(false);
      expect(f.calls.create).to.equal(4);
      expect(f.slept).to.deep.equal([2000, 4000, 8000]);
      expect(r.lines.join("\n")).to.match(/tried 4 times/).and.match(/nothing was saved; run the same `gov signal ask` command again/);
    });
    it("a tracker that cannot check is not retried (a duplicate is worse than a clear failure)", async () => {
      const f = flaky({ create: ["fail"] }, { noReads: true });
      const r = await f.tracker.create(GOV, newItem);
      expect(r.ok).to.equal(false);
      expect(f.calls.create).to.equal(1);
      expect(r.ok ? "" : r.reason).to.match(/not retried/);
    });
  });

  describe("comment", () => {
    const seeded = async (f: ReturnType<typeof flaky>) => {
      const c = await f.t.create(GOV, newItem);
      if (!c.ok) throw new Error(c.reason);
      return c.value;
    };
    it("transient, then ok → one comment", async () => {
      const f = flaky({ comment: ["fail"] });
      const i = await seeded(f);
      expect((await f.tracker.comment(i, "the answer")).ok).to.equal(true);
      expect(f.t.commentsOn(i).length).to.equal(1);
      expect(f.t.commentsOn(i)[0]).to.match(/^the answer\n\n<!-- gov-write [0-9a-f]+ -->$/);
    });
    it("landed despite the error → not written twice", async () => {
      const f = flaky({ comment: ["lost"] });
      const i = await seeded(f);
      expect((await f.tracker.comment(i, "the answer")).ok).to.equal(true);
      expect(f.calls.comment).to.equal(1);
      expect(f.t.commentsOn(i).length).to.equal(1);
    });
    it("a permanent refusal is not retried", async () => {
      const f = flaky({ comment: ["refuse"] });
      const i = await seeded(f);
      expect((await f.tracker.comment(i, "x")).ok).to.equal(false);
      expect(f.calls.comment).to.equal(1);
    });
  });

  describe("close (gov signal ack)", () => {
    const sent = async (f: ReturnType<typeof flaky>) => {
      const s = await sendSignal(env(f.t, "ann", "PRJ-1-alpha"), { kind: "notice", to: "PRJ-2-beta", title: "fyi", body: "x", items: [] });
      if (!s.ok || !s.url) throw new Error(s.lines.join("\n"));
      return s.url;
    };
    it("transient, then ok → closed", async () => {
      const f = flaky({ close: ["fail"] });
      const url = await sent(f);
      const r = await ackSignal(env(f.tracker, "bob", "PRJ-2-beta"), url);
      expect(r.ok, r.lines.join("\n")).to.equal(true);
      expect(f.calls.close).to.equal(2);
    });
    it("closed despite the error → not closed again, ack succeeds", async () => {
      const f = flaky({ close: ["lost"] });
      const url = await sent(f);
      const r = await ackSignal(env(f.tracker, "bob", "PRJ-2-beta"), url);
      expect(r.ok, r.lines.join("\n")).to.equal(true);
      expect(f.calls.close).to.equal(1);
    });
    it("still failing → the answer is written, and the command to close it by hand", async () => {
      const f = flaky({ close: ["fail", "fail", "fail", "fail"] });
      const url = await sent(f);
      const r = await ackSignal(env(f.tracker, "bob", "PRJ-2-beta"), url);
      expect(r.ok).to.equal(false);
      expect(r.lines.join("\n")).to.match(/the answer is written/).and.include(`finish by hand: gh issue close ${url}`);
      expect(f.t.commentsOn({ url }).length).to.equal(1);
    });
  });

  it("the marker is an HTML comment — invisible on GitHub", () => {
    expect(writeMarker("abc")).to.equal("<!-- gov-write abc -->");
  });
});
