// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** Spec 03 §3.2 — gate detection, the table row by row. One run advances an item exactly one stage. */
import { expect } from "chai";
import { classify, type ItemFacts } from "../../src/autorun/classify.js";

const intent = (over: Partial<Extract<ItemFacts, { kind: "intent" }>> = {}): ItemFacts => ({
  kind: "intent", id: "03-x", intent: "approved", spec: "absent", plan: "absent", build: "absent",
  openDraftCr: null, specChangedAfterPlanApproval: false, planTasks: 0, taskIssues: [], ...over,
});

describe("autorun — classify (spec 03 §3.2)", () => {
  it("row 1: a board issue in no intent → propose a grouping, draft intent.md + interview; waits at G1", () => {
    const c = classify({ kind: "issue", id: "#12" });
    expect(c).to.deep.include({ next: "draft-intent", gate: "G1", stage: "intake" });
  });

  it("row 2: intent APPROVED, no spec → draft spec.md; waits at G2", () => {
    expect(classify(intent())).to.deep.include({ next: "draft-spec", gate: "G2", stage: "intent" });
  });

  it("row 3: spec APPROVED, no plan → draft plan.md; waits at G3", () => {
    expect(classify(intent({ spec: "approved" }))).to.deep.include({ next: "draft-plan", gate: "G3", stage: "spec" });
  });

  it("row 4: plan APPROVED, task issues missing → create the plan's task issues; no gate (continues)", () => {
    const c = classify(intent({ spec: "approved", plan: "approved", planTasks: 3, taskIssues: [{ issue: "#1", cr: "none" }] }));
    expect(c).to.deep.include({ next: "create-task-issues", gate: null, stage: "plan" });
  });

  it("row 5: a task issue with no CR → gov task + agent session + CR to the project branch; waits at G4", () => {
    const c = classify(intent({ spec: "approved", plan: "approved", planTasks: 2, taskIssues: [{ issue: "#1", cr: "merged" }, { issue: "#2", cr: "none" }] }));
    expect(c).to.deep.include({ next: "build-task", gate: "G4", stage: "build", target: "#2" });
  });

  it("row 5 waits, not acts, while a task CR is open", () => {
    const c = classify(intent({ spec: "approved", plan: "approved", planTasks: 1, taskIssues: [{ issue: "#1", cr: "open" }] }));
    expect(c).to.deep.include({ next: null, gate: "G4", stage: "build" });
  });

  it("row 6: every task CR merged, no build.md → draft build.md; waits at G4b", () => {
    const c = classify(intent({ spec: "approved", plan: "approved", planTasks: 2, taskIssues: [{ issue: "#1", cr: "merged" }, { issue: "#2", cr: "merged" }] }));
    expect(c).to.deep.include({ next: "draft-build", gate: "G4b", stage: "build" });
  });

  it("row 7: an open draft CR already exists → nothing (idempotent); same gate", () => {
    const c = classify(intent({ spec: "draft", openDraftCr: { artifact: "spec", url: "https://x/pull/9" } }));
    expect(c).to.deep.include({ next: null, gate: "G2", stage: "intent" });
    expect(c.waitingOn).to.match(/pull\/9/);
  });

  it("row 8: spec changed after the plan was approved → mark the plan STALE and report; back to G2/G3", () => {
    const c = classify(intent({ spec: "approved", plan: "approved", specChangedAfterPlanApproval: true, planTasks: 1, taskIssues: [] }));
    expect(c).to.deep.include({ next: "mark-plan-stale", gate: "G3", stage: "spec" });
  });

  it("an intent still DRAFT with no open CR waits at G1 and does nothing", () => {
    expect(classify(intent({ intent: "draft" }))).to.deep.include({ next: null, gate: "G1" });
  });

  it("a STALE plan is redrafted only after the spec is approved again — until then nothing", () => {
    expect(classify(intent({ spec: "approved", plan: "stale" }))).to.deep.include({ next: "draft-plan", gate: "G3" });
    expect(classify(intent({ spec: "draft", plan: "stale" }))).to.deep.include({ next: null, gate: "G2" });
  });

  it("build.md APPROVED → BUILT; autorun stops there (release is not autorun's)", () => {
    const c = classify(intent({ spec: "approved", plan: "approved", build: "approved", planTasks: 1, taskIssues: [{ issue: "#1", cr: "merged" }] }));
    expect(c).to.deep.include({ next: null, gate: null, stage: "built" });
  });

  it("never yields a merge, a close, or a send — those are people's acts", () => {
    const all = [classify({ kind: "issue", id: "#1" }), classify(intent()), classify(intent({ spec: "approved" }))];
    for (const c of all) expect(String(c.next)).to.not.match(/merge|close|send/);
  });
});
