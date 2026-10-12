// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** `gov issue` — the verb the first step of governed work never had (#182, #194). */
import { expect } from "chai";
import { planIssue, issueSummary, createPlannedIssue, type IssuePlan } from "../../src/lifecycle/issue-create.js";
import { createMemoryWorkTracker } from "../../src/adapters/memory/work-tracker.js";
import { parseArgv } from "../../src/cli/args.js";
import { routeAsync, type CliContext } from "../../src/cli/dispatch.js";
import { classifyPosture } from "../../src/config/governance.js";
import { DEFAULT_SELECTION } from "../../src/adapters/registry.js";
import type { OrgConfig } from "../../src/config/org-config.js";
import type { WorkTrackerPort } from "../../src/ports/work-tracker.js";

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

// ── Part B: `gov issue` writes through the WorkTrackerPort (spec 03 §6–§7, plan L05) ──────────────────────────

const ORG = "svm-geneva";
const board7 = { owner: ORG, number: 7 };
const plan = (over: Partial<IssuePlan> = {}): IssuePlan =>
  ({ repo: `${ORG}/x`, title: "t", body: "b", assignee: "svayam-rkant", board: 7, mirrorOf: null, labels: [], ...over });

describe("gov issue — through the WorkTrackerPort (intent 03 L05 part B)", () => {
  it("creates the item assigned, on the board, with the --intent label — through the port", async () => {
    const t = createMemoryWorkTracker({ projects: [{ ref: board7, title: "B" }] });
    const r = await createPlannedIssue(plan({ labels: ["gov-intent:03"] }), t, ORG);
    expect(r.code, r.lines.join("\n")).to.equal(0);
    const items = await t.items(board7);
    if (!items.ok) throw new Error(items.reason);
    expect(items.value).to.have.length(1);
    expect(items.value[0]!.assignees).to.deep.equal(["svayam-rkant"]);
    expect(items.value[0]!.labels).to.deep.equal(["gov-intent:03"]);
    expect(r.lines.join("\n")).to.contain("labelled gov-intent:03").and.contain("added to board #7");
  });

  it("a port failure at creation is reported, and exits non-zero", async () => {
    const t = createMemoryWorkTracker({ assignable: ["someone-else"] });
    const r = await createPlannedIssue(plan(), t, ORG);
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.match(/Could not create the issue in svm-geneva\/x/).and.contain("cannot be assigned");
  });

  it("created but not on the board: still reported as created, with why, and exits non-zero", async () => {
    const t = createMemoryWorkTracker();   // no board 7
    const r = await createPlannedIssue(plan(), t, ORG);
    expect(r.code).to.equal(1);
    const text = r.lines.join("\n");
    expect(text).to.contain("Created an issue").and.contain("could NOT be added to board #7").and.contain("no project svm-geneva#7");
  });

  it("a label the tracker refuses is reported, and exits non-zero (the issue stands)", async () => {
    const base = createMemoryWorkTracker({ projects: [{ ref: board7, title: "B" }] });
    const t: WorkTrackerPort = { ...base, label: async () => ({ ok: false, reason: "label 'gov-intent:03' not found", retryable: false }) };
    const r = await createPlannedIssue(plan({ labels: ["gov-intent:03"] }), t, ORG);
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.contain("could NOT be labelled gov-intent:03").and.contain("not found");
  });

  it("a tracker that throws is reported, never silent", async () => {
    const r = await createPlannedIssue(plan(), { create: async () => { throw new Error("boom"); } } as unknown as WorkTrackerPort, ORG);
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.contain("boom");
  });
});

const CONFIG = {
  orgName: "G", orgShortName: "G", orgSlug: "SVM", orgSlugLower: "svm",
  githubOrg: ORG, workspaceRepo: "svm-geneva-gov", orgRepoUrl: "git@github.com:svm-geneva/svm-geneva-gov.git",
  defaultBranch: "main", defaultCodeBranch: "dev", agentWorkRoot: "/awr", govWorkspace: "/gov", policyOwnerEmail: "rk@x",
  orgTokens: {}, governancePosture: classifyPosture(""), adapters: DEFAULT_SELECTION,
} as unknown as OrgConfig;

function issueCtx(tracker: (() => WorkTrackerPort) | undefined, branch = "BRNCH-7-demo"): CliContext {
  return {
    config: CONFIG, home: "/awr/PRJ-7-demo/svm-geneva-gov", today: "2026-10-12", seededBy: "rk", login: "svayam-rkant",
    vcs: { currentBranch: () => branch },
    fs: { pathExists: () => false, readFile: () => null, mkdirp: () => {}, writeFile: () => {}, rm: () => {}, readdir: () => [] },
    issues: { read: () => UP },
    authorize: () => true, gate: () => ({ ok: true, failures: [] }),
    ...(tracker ? { tracker } : {}),
  } as unknown as CliContext;
}

describe("gov issue — dispatch with the memory adapter (intent 03 L05 part B)", () => {
  it("`gov issue <repo> --title t --intent 03` creates an assigned, labelled item on the current project's board", async () => {
    const t = createMemoryWorkTracker({ projects: [{ ref: board7, title: "B" }] });
    const r = await routeAsync(parseArgv(["issue", `${ORG}/x`, "--title", "t", "--intent", "03"]) as never, issueCtx(() => t));
    expect(r.code, r.lines.join("\n")).to.equal(0);
    const items = await t.items(board7);
    if (!items.ok) throw new Error(items.reason);
    expect(items.value.map((i) => [i.title, i.assignees, i.labels])).to.deep.equal([["t", ["svayam-rkant"], ["gov-intent:03"]]]);
  });

  it("--board names the board; off a project branch with no --board, it says the issue is on no board", async () => {
    const t = createMemoryWorkTracker({ projects: [{ ref: { owner: ORG, number: 9 }, title: "B9" }] });
    const r = await routeAsync(parseArgv(["issue", `${ORG}/x`, "--title", "t", "--board", "9"]) as never, issueCtx(() => t, "main"));
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(r.lines.join("\n")).to.contain("added to board #9");
    const none = await routeAsync(parseArgv(["issue", `${ORG}/x`, "--title", "u"]) as never, issueCtx(() => t, "main"));
    expect(none.code).to.equal(0);
    expect(none.lines.join("\n")).to.contain("not on a board");
  });

  it("--from mirrors through the port too", async () => {
    const t = createMemoryWorkTracker({ projects: [{ ref: board7, title: "B" }] });
    const r = await routeAsync(parseArgv(["issue", "--from", UP.url, "--intent", "3"]) as never, issueCtx(() => t));
    expect(r.code, r.lines.join("\n")).to.equal(0);
    const found = await t.search({ labels: ["gov-intent:03"] });
    if (!found.ok) throw new Error(found.reason);
    expect(found.value).to.have.length(1);
    expect(found.value[0]!.ref.url).to.match(/^memory:\/\/svm-geneva\/Workbench\//);
    expect(found.value[0]!.body).to.contain("Mirrored from");
  });

  it("a port failure exits non-zero with the reason", async () => {
    const t = createMemoryWorkTracker({ assignable: ["nobody"], projects: [{ ref: board7, title: "B" }] });
    const r = await routeAsync(parseArgv(["issue", `${ORG}/x`, "--title", "t"]) as never, issueCtx(() => t));
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.contain("cannot be assigned");
  });

  it("an adapter that cannot be built (unknown id in org-config) is reported, exit non-zero", async () => {
    const r = await routeAsync(parseArgv(["issue", `${ORG}/x`, "--title", "t"]) as never,
      issueCtx(() => { throw new Error("no adapter 'jira' for port workTracker"); }));
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.contain("no adapter 'jira'");
  });

  it("no tracker wired: refused, exit non-zero — never a silent skip", async () => {
    const r = await routeAsync(parseArgv(["issue", `${ORG}/x`, "--title", "t"]) as never, issueCtx(undefined));
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.match(/work tracker/);
  });
});
