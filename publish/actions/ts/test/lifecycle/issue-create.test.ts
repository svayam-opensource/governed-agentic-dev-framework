// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** `gov issue` — the verb the first step of governed work never had (#182, #194). */
import { expect } from "chai";
import { planIssue, issueSummary } from "../../src/lifecycle/issue-create.js";

const UP = {
  repo: "genevaers/Workbench", number: 278, title: "release.md update",
  body: "stale notes", url: "https://github.com/genevaers/Workbench/issues/278",
  state: "OPEN", author: "someone",
};
const fetchUp = () => UP;
const BASE = { assignee: "svayam-rkant", githubOrg: "svm-geneva" };

describe("gov-work — gov issue (#182)", () => {
  it("refuses to create an unassigned issue — the rule this verb exists to enforce", () => {
    const r = planIssue({ ...BASE, assignee: "", repo: "svm-geneva/x", title: "t" });
    expect(r.ok).to.equal(false);
    if (r.ok) return;
    expect(r.message).to.contain("accountable person");
  });

  it("plans a plain issue in the named repo", () => {
    const r = planIssue({ ...BASE, repo: "svm-geneva/Workbench", title: "Do some change", body: "why" });
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.plan).to.include({ repo: "svm-geneva/Workbench", title: "Do some change", assignee: "svayam-rkant", mirrorOf: null });
  });

  it("falls back to the workspace repo when none is named", () => {
    const r = planIssue({ ...BASE, title: "t", defaultRepo: "svm-geneva/svm-geneva-gov" });
    expect(r.ok && r.plan.repo).to.equal("svm-geneva/svm-geneva-gov");
  });

  it("needs a title, and says so", () => {
    const r = planIssue({ ...BASE, repo: "svm-geneva/x" });
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.message).to.contain("--title");
  });

  it("--from mirrors upstream into your own repo of the same name", () => {
    const r = planIssue({ ...BASE, from: UP.url, board: 1 }, fetchUp);
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.plan.repo, "your copy, not theirs").to.equal("svm-geneva/Workbench");
    expect(r.plan.title).to.contain("genevaers/Workbench#278");
    expect(r.plan.body).to.contain("Mirrored from");
    expect(r.plan.mirrorOf).to.equal(UP.url);
    expect(r.plan.board).to.equal(1);
  });

  it("refuses to mirror an issue that is already in your org", () => {
    const r = planIssue({ ...BASE, from: "https://github.com/svm-geneva/Workbench/issues/1" }, fetchUp);
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.message).to.contain("already in your organization");
  });

  it("says when an unreadable upstream is the problem, not the URL", () => {
    const r = planIssue({ ...BASE, from: UP.url }, () => null);
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.message).to.contain("that you can see that repository");
  });

  it("warns loudly when the issue exists but never reached the board", () => {
    const plan = { repo: "svm-geneva/x", title: "t", body: "", assignee: "rk", board: 1, mirrorOf: null, labels: [] };
    const lines = issueSummary(plan, "https://github.com/svm-geneva/x/issues/9", false).join("\n");
    expect(lines, "invisible to gov until it is on a board").to.contain("could NOT be added to board #1");
  });

  it("says plainly when no board was asked for — not a failure, but a consequence", () => {
    const plan = { repo: "svm-geneva/x", title: "t", body: "", assignee: "rk", board: null, mirrorOf: null, labels: [] };
    expect(issueSummary(plan, "u", false).join("\n")).to.contain("gov cannot see it");
  });
});

describe("gov issue — intent 03 L05 (D8)", () => {
  it("no flag combination yields an unassigned issue (every combination of repo/title/body/from/board/intent × assignee)", () => {
    const opts = {
      repo: [undefined, "svm-geneva/x", "bad repo"], title: [undefined, "", "t"], body: [undefined, "b"],
      from: [undefined, UP.url, "not-a-url"], board: [undefined, null, 7], intent: [undefined, "03", "3", "x"],
      assignee: ["", "svayam-rkant"],
    };
    let plans = 0;
    for (const repo of opts.repo) for (const title of opts.title) for (const body of opts.body) for (const from of opts.from)
      for (const board of opts.board) for (const intent of opts.intent) for (const assignee of opts.assignee) {
        const r = planIssue({ githubOrg: "svm-geneva", defaultRepo: "svm-geneva/gov", repo, title, body, from, board, intent, assignee }, fetchUp);
        if (r.ok) { plans++; expect(r.plan.assignee, JSON.stringify({ repo, title, from, assignee })).to.equal("svayam-rkant"); }
        if (assignee === "") expect(r.ok).to.equal(false);
      }
    expect(plans).to.be.greaterThan(0);
  });

  it("--intent 03 puts the intent label on the plan", () => {
    const r = planIssue({ ...BASE, repo: "svm-geneva/x", title: "t", intent: "03" });
    expect(r.ok && r.plan.labels).to.deep.equal(["gov-intent:03"]);
  });

  it("--intent accepts a single digit as its two-digit number, and refuses anything else", () => {
    const r = planIssue({ ...BASE, repo: "svm-geneva/x", title: "t", intent: "3" });
    expect(r.ok && r.plan.labels).to.deep.equal(["gov-intent:03"]);
    const bad = planIssue({ ...BASE, repo: "svm-geneva/x", title: "t", intent: "x" });
    expect(bad.ok).to.equal(false);
    if (!bad.ok) expect(bad.message).to.match(/--intent/);
  });

  it("no --intent, no label", () => {
    const r = planIssue({ ...BASE, repo: "svm-geneva/x", title: "t" });
    expect(r.ok && r.plan.labels).to.deep.equal([]);
  });

  it("the summary says which intent label was set, or that it could not be", () => {
    const r = planIssue({ ...BASE, repo: "svm-geneva/x", title: "t", intent: "03", board: 7 });
    if (!r.ok) throw new Error("plan");
    expect(issueSummary(r.plan, "u", true, true).join("\n")).to.match(/labelled gov-intent:03/);
    expect(issueSummary(r.plan, "u", true, false).join("\n")).to.match(/could NOT be labelled gov-intent:03/);
  });
});
