// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov autorun` — one run (spec 03 §3.1, §3.3–3.5): lock, classify, one prep step per item whose gate passed,
 * report every item with whom it waits on, record the run. Steps are injected; this is the orchestration.
 */
import { expect } from "chai";
import { runAutorun, type AutorunDeps, type StepOutcome } from "../../src/autorun/run.js";
import type { ItemFacts } from "../../src/autorun/classify.js";
import type { LockFs } from "../../src/autorun/lock.js";

const intent = (id: string, over: Partial<Extract<ItemFacts, { kind: "intent" }>> = {}): ItemFacts => ({
  kind: "intent", id, intent: "approved", spec: "absent", plan: "absent", build: "absent",
  openDraftCr: null, specChangedAfterPlanApproval: false, planTasks: 0, taskIssues: [], ...over,
});

function memLock(): LockFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return { files, createExclusive: (p, t) => (files.has(p) ? false : (files.set(p, t), true)), read: (p) => files.get(p) ?? null, remove: (p) => { files.delete(p); } };
}

function deps(items: ItemFacts[], step: (id: string, next: string) => StepOutcome = () => ({ kind: "ok", cr: "https://x/pull/1" }), over: Partial<AutorunDeps> = {}) {
  const calls: string[] = [];
  const records: { path: string; text: string; decisions: string }[] = [];
  const d: AutorunDeps = {
    project: "PRJ-1-alpha",
    lifecycleActive: true,
    items: async () => items,
    step: async (c) => { calls.push(`${c.id}:${c.next}`); return step(c.id, c.next!); },
    lockFs: memLock(), stateDir: "/state",
    now: () => new Date("2026-10-13T08:00:00Z"),
    runId: "run-1",
    budget: { itemMinutes: 30, runItems: 10, runCrs: 10 },
    record: async (path, text, decisions) => { records.push({ path, text, decisions }); return { ok: true, value: undefined }; },
    ...over,
  };
  return { d, calls, records };
}

describe("autorun — one run", () => {
  it("advances each item whose gate passed exactly one stage, and leaves waiting items alone", async () => {
    const { d, calls } = deps([intent("01-a"), intent("02-b", { intent: "draft" }), intent("03-c", { spec: "approved" })]);
    const r = await runAutorun(d, {});
    expect(calls).to.deep.equal(["01-a:draft-spec", "03-c:draft-plan"]);
    expect(r.code).to.equal(0);
  });

  it("a second run with nothing approved does nothing and says what waits on whom", async () => {
    const waiting = [intent("01-a", { spec: "draft", openDraftCr: { artifact: "spec", url: "https://x/pull/9" } })];
    const { d, calls } = deps(waiting);
    const r = await runAutorun(d, {});
    expect(calls).to.deep.equal([]);
    expect(r.lines.join("\n")).to.match(/01-a\s+intent\s+✋ waiting on the project owner \(spec approval\) — review https:\/\/x\/pull\/9/);
  });

  it("never merges or closes: a step may only be one of the prep steps", async () => {
    const { d, calls } = deps([intent("01-a"), { kind: "issue", id: "#7" }]);
    await runAutorun(d, {});
    for (const c of calls) expect(c).to.not.match(/merge|close|send/);
  });

  it("a C01 event halts the WHOLE run: nothing more runs, non-zero exit, reported", async () => {
    const { d, calls } = deps([intent("01-a"), intent("02-b")], (id) => (id === "01-a" ? { kind: "c01", id: "GOV-FRM-086", detail: "context gate refused" } : { kind: "ok" }));
    const r = await runAutorun(d, {});
    expect(calls).to.deep.equal(["01-a:draft-spec"]);
    expect(r.code).to.not.equal(0);
    expect(r.lines.join("\n")).to.match(/HALT.*GOV-FRM-086/);
  });

  it("a per-item failure is reported and the rest continue", async () => {
    const { d, calls } = deps([intent("01-a"), intent("02-b")], (id) => (id === "01-a" ? { kind: "failed", detail: "tests failed" } : { kind: "ok" }));
    const r = await runAutorun(d, {});
    expect(calls).to.deep.equal(["01-a:draft-spec", "02-b:draft-spec"]);
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.match(/01-a.*✗ failed: tests failed/);
  });

  it("the run budget stops starting items, and the report says why", async () => {
    const { d, calls } = deps([intent("01-a"), intent("02-b"), intent("03-c")], undefined, { budget: { itemMinutes: 30, runItems: 2, runCrs: 10 } });
    const r = await runAutorun(d, {});
    expect(calls).to.have.lengthOf(2);
    expect(r.lines.join("\n")).to.match(/run budget reached/).and.match(/03-c.*not started/);
  });

  it("the CR budget counts CRs opened", async () => {
    const { d, calls } = deps([intent("01-a"), intent("02-b")], undefined, { budget: { itemMinutes: 30, runItems: 10, runCrs: 1 } });
    await runAutorun(d, {});
    expect(calls).to.have.lengthOf(1);
  });

  it("--intent limits the run to one item; --dry-run runs no step", async () => {
    const a = deps([intent("01-a"), intent("02-b")]);
    await runAutorun(a.d, { intent: "02" });
    expect(a.calls).to.deep.equal(["02-b:draft-spec"]);
    const b = deps([intent("01-a")]);
    const r = await runAutorun(b.d, { dryRun: true });
    expect(b.calls).to.deep.equal([]);
    expect(r.lines.join("\n")).to.match(/would draft-spec/);
  });

  it("no active lifecycle: says so and does nothing (not even the lock)", async () => {
    const { d, calls } = deps([intent("01-a")], undefined, { lifecycleActive: false });
    const r = await runAutorun(d, {});
    expect(calls).to.deep.equal([]);
    expect(r.lines.join()).to.match(/no lifecycle/);
    expect((d.lockFs as ReturnType<typeof memLock>).files.size).to.equal(0);
  });

  it("a second concurrent run is refused by the lock; the lock is released after a run", async () => {
    const { d } = deps([intent("01-a")]);
    d.lockFs.createExclusive("/state/autorun/PRJ-1-alpha.lock", JSON.stringify({ runId: "other", startedAt: "2026-10-13T07:59:00Z" }));
    const r = await runAutorun(d, {});
    expect(r.code).to.equal(1);
    expect(r.lines.join()).to.match(/another autorun/);
    const e = deps([intent("01-a")]);
    await runAutorun(e.d, {});
    expect((e.d.lockFs as ReturnType<typeof memLock>).files.size).to.equal(0);
  });

  it("records the run at projects/<PRJ>/autorun/<yyyy-mm-dd-hhmm>.md, plus one decisions line (Q12)", async () => {
    const { d, records } = deps([intent("01-a")]);
    await runAutorun(d, {});
    expect(records).to.have.lengthOf(1);
    expect(records[0].path).to.equal("projects/PRJ-1-alpha/autorun/2026-10-13-0800.md");
    expect(records[0].text).to.match(/Gov-Autorun: run-1/).and.match(/01-a/);
    expect(records[0].decisions).to.match(/^- 2026-10-13 autorun run-1: 1 advanced, 0 failed/);
  });

  it("a second run in the same minute gets its own record file — never overwrites the first", async () => {
    const taken = new Set(["projects/PRJ-1-alpha/autorun/2026-10-13-0800.md", "projects/PRJ-1-alpha/autorun/2026-10-13-0800-2.md"]);
    const { d, records } = deps([intent("01-a")], undefined, { recordExists: (p: string) => taken.has(p) });
    const r = await runAutorun(d, {});
    expect(records[0].path).to.equal("projects/PRJ-1-alpha/autorun/2026-10-13-0800-3.md");
    expect(records[0].decisions).to.include("2026-10-13-0800-3.md");
    expect(r.lines.join("\n")).to.include("recorded: projects/PRJ-1-alpha/autorun/2026-10-13-0800-3.md");
  });

  it("a dry run records nothing", async () => {
    const { d, records } = deps([intent("01-a")]);
    await runAutorun(d, { dryRun: true });
    expect(records).to.deep.equal([]);
  });
});
