// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// THE CHECK ENGINE, SECOND SLICE (rule-model-design.md Q15; W2-Q3, Q8, Q10): violation records and undo, the
// three new actions (landed-by-pr, forbid-forced-push, section-owner-approval), and what the GitHub renderer now
// adds for them (push branch filters, the forced condition, least-privilege permissions).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { expect } from "chai";
import yaml from "js-yaml";
import { parseCatalog, type Catalog, type CheckBinding } from "../../../src/rules/model/catalog.js";
import type { RuleRow } from "../../../src/rules/model/rule-row.js";
import type { RuleSet, EventContext, CheckVerdict } from "../../../src/rules/model/contracts.js";
import { lintCatalog, validateParams } from "../../../src/rules/checks/params.js";
import { runBuiltin } from "../../../src/rules/checks/builtin.js";
import { createCheckRunner } from "../../../src/rules/checks/runner.js";
import { landedByPr, githubPullsForCommit, type PullRef } from "../../../src/rules/checks/gh-actions.js";
import { sectionShas, changedSections } from "../../../src/rules/checks/sections.js";
import { violationFor, recordViolation, type ViolationIssue } from "../../../src/rules/checks/violation.js";
import { renderWorkflow } from "../../../src/rules/checks/render-github.js";
import type { ChangedFile } from "../../../src/rules/diff-check.js";

const here = dirname(fileURLToPath(import.meta.url));
const CATALOG: Catalog = parseCatalog(readFileSync(resolve(here, "../../../../../content/framework/rules/catalog.yaml"), "utf8"));

const row = (id: string, checks: CheckBinding[], over: Partial<RuleRow> = {}): RuleRow => ({
  id,
  source: { doc: "framework/docs/specs/framework-specification.md", section: "5.5", sha: "a1b2c3" },
  expectation: "Every change lands on the default branch through a merged pull request.",
  actor: ["everyone"],
  level: "C01",
  checks,
  start: { version: "1.0.0", date: "2026-10-06" },
  end: null,
  ...over,
});
const bind = (resource: string, event: string, action: string, w: Record<string, unknown> = {}, on_miss: "fail" | "warn" = "fail"): CheckBinding =>
  ({ on: { resource, event }, action, with: w, on_miss });
const ROLES = { "Policy Owner": "@polly", "Check Owner": "@chuck", "Data Owner": "@dana" };
const ruleset = (rows: RuleRow[], over: Partial<RuleSet> = {}): RuleSet =>
  ({ framework: rows, org: [], orgScope: "SVM", catalog: CATALOG, orgVersion: "1.0.0", roles: ROLES, ...over });
const file = (path: string, text: string | null, status: ChangedFile["status"] = "modified"): ChangedFile =>
  ({ path, status, addedLines: [], text });
const push = (payload: Record<string, unknown>, resource = "vcs.gov-repo"): EventContext =>
  ({ resource, event: "push", payload: payload as EventContext["payload"] });
const noRead = () => null;

describe("check engine slice 2 — the catalog", () => {
  it("still lints clean, and carries the three new actions with params schemas", () => {
    expect(lintCatalog(CATALOG)).to.deep.equal([]);
    for (const id of ["gh-action/landed-by-pr", "gov-builtin/forbid-forced-push", "gov-builtin/section-owner-approval"]) {
      const a = CATALOG.actions.find((x) => x.id === id);
      expect(a, id).to.not.equal(undefined);
      expect(a!.params, id).to.be.an("object");
    }
    const ff = CATALOG.actions.find((x) => x.id === "gov-builtin/forbid-forced-push")!.params!;
    expect(validateParams(ff, { branches: ["BRNCH-*"] })).to.deep.equal([]);
    expect(validateParams(ff, { branchs: "x" }).join()).to.match(/unknown parameter/);
  });
});

describe("check engine slice 2 — gh-action/landed-by-pr", () => {
  const merged = (n: number, base = "main"): PullRef => ({ number: n, mergedAt: "2026-10-06T00:00:00Z", base });
  const open = (n: number): PullRef => ({ number: n, mergedAt: null, base: "main" });
  const ports = (map: Record<string, PullRef[] | null>) => ({ pullsForCommit: (sha: string): PullRef[] | null => (sha in map ? map[sha]! : []) });
  const run = (payload: Record<string, unknown>, map: Record<string, PullRef[] | null>, params: Record<string, unknown> = {}) =>
    landedByPr({ ruleId: "GOV-FRM-040", params, ctx: push(payload) }, ports(map));

  it("every pushed commit in a merged PR into the pushed branch passes", () => {
    expect(run({ branch: "main", defaultBranch: "main", commits: ["a1", "b2"] }, { a1: [merged(1)], b2: [open(3), merged(2)] }).verdict).to.equal("pass");
  });

  it("a commit with no merged PR misses, naming the commit", () => {
    const r = run({ branch: "main", defaultBranch: "main", commits: ["a1", "deadbeefcafe"] }, { a1: [merged(1)], deadbeefcafe: [open(4)] });
    expect(r.verdict).to.equal("miss");
    expect(r.findings.join()).to.contain("deadbee").and.contain("without a merged pull request");
  });

  it("a PR merged into a DIFFERENT branch does not count", () => {
    expect(run({ branch: "main", defaultBranch: "main", commits: ["a1"] }, { a1: [merged(1, "dev")] }).verdict).to.equal("miss");
  });

  it("a push to a branch out of scope is not judged ($default = the default branch)", () => {
    expect(run({ branch: "BRNCH-1-x", defaultBranch: "main", commits: ["a1"] }, { a1: [] }).verdict).to.equal("pass");
  });

  it("no commits, no branch, an unknown default, or GitHub not answering: cannot-tell", () => {
    expect(run({ branch: "main", defaultBranch: "main" }, {}).verdict).to.equal("cannot-tell");
    expect(run({ defaultBranch: "main", commits: ["a1"] }, {}).verdict).to.equal("cannot-tell");
    expect(run({ branch: "main", commits: ["a1"] }, { a1: [merged(1)] }).verdict).to.equal("cannot-tell");
    expect(run({ branch: "main", defaultBranch: "main", commits: ["a1"] }, { a1: null }).verdict).to.equal("cannot-tell");
  });

  it("the GitHub adapter reads `GET /repos/{repo}/commits/{sha}/pulls`", () => {
    const calls: string[][] = [];
    const pulls = githubPullsForCommit((args) => {
      calls.push([...args]);
      return JSON.stringify([{ number: 7, merged_at: "2026-10-06T00:00:00Z", base: { ref: "main" } }, { number: 8, merged_at: null, base: { ref: "main" } }]);
    }, "acme/acme-gov");
    expect(pulls("abc")).to.deep.equal([{ number: 7, mergedAt: "2026-10-06T00:00:00Z", base: "main" }, { number: 8, mergedAt: null, base: "main" }]);
    expect(calls[0]).to.deep.equal(["api", "repos/acme/acme-gov/commits/abc/pulls"]);
    expect(githubPullsForCommit(() => null, "a/b")("x"), "gh failed → could not tell").to.equal(null);
    expect(githubPullsForCommit(() => "not json", "a/b")("x")).to.equal(null);
  });

  it("through the runner: the port is injected; without it, cannot-tell", () => {
    const r = ruleset([row("GOV-FRM-040", [bind("vcs.gov-repo", "push", "gh-action/landed-by-pr")])]);
    const ctx = push({ branch: "main", defaultBranch: "main", commits: ["a1"] });
    expect(createCheckRunner({ rules: r, readDefault: noRead, github: ports({ a1: [] }) }).run("GOV-FRM-040", ctx).verdict).to.equal("fail");
    expect(createCheckRunner({ rules: r, readDefault: noRead }).run("GOV-FRM-040", ctx).verdict).to.equal("cannot-tell");
  });
});

describe("check engine slice 2 — gov-builtin/forbid-forced-push", () => {
  const run = (payload: Record<string, unknown>, params: Record<string, unknown> = {}) =>
    runBuiltin({ ruleId: "GOV-FRM-466", action: "gov-builtin/forbid-forced-push", params, ctx: push(payload, "vcs.code-repo"), readDefault: noRead });

  it("a forced push to a BRNCH-* branch misses (default pattern)", () => {
    const r = run({ forced: true, branch: "BRNCH-121-doc" });
    expect(r.verdict).to.equal("miss");
    expect(r.findings.join()).to.contain("BRNCH-121-doc");
  });
  it("a normal push, or a forced push to a branch out of scope, passes", () => {
    expect(run({ forced: false, branch: "BRNCH-121-doc" }).verdict).to.equal("pass");
    expect(run({ forced: true, branch: "scratch/me" }).verdict).to.equal("pass");
    expect(run({ forced: true, branch: "release" }, { branches: ["release", "main"] }).verdict).to.equal("miss");
  });
  it("forced or branch unknown: cannot-tell", () => {
    expect(run({ branch: "BRNCH-1-x" }).verdict).to.equal("cannot-tell");
    expect(run({ forced: true }).verdict).to.equal("cannot-tell");
  });
});

describe("check engine slice 2 — sections and their shas", () => {
  const V1 = "# Org policy\n\nPreamble.\n\n## 3 Technology\n\nUse approved tech.\n\n### 3.1 Libraries\n\nOnly listed.\n\n## 4 Data\n\nKeep it safe.\n";
  it("one sha per numbered section; text before the first is the preamble", () => {
    const s = sectionShas(V1);
    expect([...s.keys()]).to.deep.equal(["", "3", "3.1", "4"]);
    expect(s.get("3")).to.match(/^[0-9a-f]{7}$/);
  });
  it("only the sections whose text changed; added and removed count; reflow does not", () => {
    const v2 = V1.replace("Keep it safe.", "Keep it   safe.").replace("Only listed.", "Only listed ones.") + "\n## 5 New\n\nx\n";
    expect(changedSections(V1, v2)).to.deep.equal(["3.1", "5"]);
    expect(changedSections(null, "## 1 A\n\nx\n")).to.deep.equal(["1"]);
    expect(changedSections("## 1 A\n\nx\n", null)).to.deep.equal(["1"]);
  });
});

describe("check engine slice 2 — gov-builtin/section-owner-approval", () => {
  const DOC = "policies/org-policy.md";
  const BASE = "## 3 Technology\n\nUse approved tech.\n\n### 3.1 Libraries\n\nOnly listed.\n\n## 4 Data\n\nKeep it safe.\n\n## 6 Other\n\nx\n";
  const ownership = [{ doc: DOC, section: "4", role: "Data Owner" }, { doc: DOC, section: "3", role: "Engineering Owner" }];
  const rules = ruleset([], { ownership });
  const pr = (changed: ChangedFile[], extra: Record<string, unknown> = {}): EventContext =>
    ({ resource: "vcs.gov-repo", event: "pull_request", payload: { changed, baseTexts: { [DOC]: BASE }, ...extra } as EventContext["payload"] });
  const run = (ctx: EventContext, rs: RuleSet = rules) =>
    runBuiltin({ ruleId: "GOV-FRM-086", action: "gov-builtin/section-owner-approval", params: {}, ctx, readDefault: noRead, rules: rs });

  it("a changed owned section needs its owner; approved → pass", () => {
    const head = BASE.replace("Keep it safe.", "Keep it very safe.");
    expect(run(pr([file(DOC, head)], { approvals: ["dana"] })).verdict).to.equal("pass");
    const r = run(pr([file(DOC, head)], { approvals: [] }));
    expect(r.verdict).to.equal("miss");
    expect(r.findings.join()).to.contain("@dana").and.contain("Data Owner").and.contain("§4");
    expect(r.requestReview).to.deep.equal(["dana"]);
  });

  it("ownership is most-specific: §3.1 falls under §3's owner; a role with no holder goes to the Policy Owner", () => {
    const head = BASE.replace("Only listed.", "Only listed ones.");
    const r = run(pr([file(DOC, head)], { approvals: [] }));
    expect(r.requestReview, "Engineering Owner has no holder in roles → vacant → Policy Owner").to.deep.equal(["polly"]);
    expect(r.findings.join()).to.contain("vacant");
  });

  it("an unowned section, ownership.yaml, and policies/actions/** route to the Policy Owner and Check Owner", () => {
    const head = BASE.replace("x\n", "y\n");
    const r = run(pr([file(DOC, head), file("policies/ownership.yaml", "[]"), file("policies/actions/lint/run.sh", "echo")], { approvals: [] }));
    expect(r.requestReview).to.deep.equal(["chuck", "polly"]);
    expect(r.findings.join()).to.contain("§6").and.contain("policies/ownership.yaml").and.contain("policies/actions/lint/run.sh");
  });

  it("a snapshot under policies/version/** and a non-policy file need nobody", () => {
    expect(run(pr([file("policies/version/1.0.0/org-policy.md", "x"), file("README.md", "x")], { approvals: [] })).verdict).to.equal("pass");
  });

  it("approvals compare case-insensitively and ignore @", () => {
    const head = BASE.replace("Keep it safe.", "Keep it very safe.");
    expect(run(pr([file(DOC, head)], { approvals: ["@DANA"] })).verdict).to.equal("pass");
  });

  it("no approvals in the payload: cannot-tell — but the review request is still produced", () => {
    const head = BASE.replace("Keep it safe.", "Keep it very safe.");
    const r = run(pr([file(DOC, head)]));
    expect(r.verdict).to.equal("cannot-tell");
    expect(r.requestReview).to.deep.equal(["dana"]);
  });

  it("base unknown, head unreadable, no Policy Owner, no rules: cannot-tell", () => {
    const head = BASE.replace("Keep it safe.", "Keep it very safe.");
    expect(run({ ...pr([file(DOC, head)], { approvals: [] }), payload: { changed: [file(DOC, head)], approvals: [] } }).verdict).to.equal("cannot-tell");
    expect(run(pr([file(DOC, null)], { approvals: [] })).verdict).to.equal("cannot-tell");
    expect(run(pr([file(DOC, head)], { approvals: [] }), ruleset([], { ownership, roles: {} })).verdict).to.equal("cannot-tell");
    expect(runBuiltin({ ruleId: "GOV-FRM-086", action: "gov-builtin/section-owner-approval", params: {}, ctx: pr([file(DOC, head)], { approvals: [] }), readDefault: noRead }).verdict).to.equal("cannot-tell");
  });

  it("a new policy doc: every section is changed; a deleted one: every base section", () => {
    const r = run({ ...pr([file("policies/new.md", "## 1 A\n\nx\n", "added")], { approvals: [] }), payload: { changed: [file("policies/new.md", "## 1 A\n\nx\n", "added")], baseTexts: { "policies/new.md": null }, approvals: [] } as EventContext["payload"] });
    expect(r.requestReview).to.deep.equal(["polly"]);
    const d = run(pr([file(DOC, null, "deleted")], { approvals: [] }));
    expect(d.requestReview).to.deep.equal(["dana", "polly"]);
  });

  // Policy Owner, 2026-10-06: GitHub never lets an author approve their own PR, so the author is simply left off the
  // approver list — and if that leaves nobody, someone else must still review (GOV-FRM-040: nothing merges unreviewed).
  describe("the author is never asked to approve their own change", () => {
    const ownSection = BASE.replace("Keep it safe.", "Keep it very safe.");                       // §4, Data Owner
    const twoSections = ownSection.replace("x\n", "y\n");                                       // §4 + §6 (unowned → Policy Owner)

    it("the author is left off; other owners still approve", () => {
      const r = run(pr([file(DOC, twoSections)], { approvals: [], author: "dana" }));
      expect(r.requestReview).to.deep.equal(["polly"]);
      expect(run(pr([file(DOC, twoSections)], { approvals: ["polly"], author: "dana" })).verdict).to.equal("pass");
    });

    it("the author owns everything changed → the Policy Owner approves instead", () => {
      const r = run(pr([file(DOC, ownSection)], { approvals: [], author: "@Dana" }));
      expect(r.requestReview).to.deep.equal(["polly"]);
      expect(r.findings.join()).to.contain("author");
    });

    it("the author is the Policy Owner and owns everything changed → the Check Owner approves", () => {
      const r = run(pr([file(DOC, twoSections.replace("Keep it very safe.", "Keep it safe."))], { approvals: [], author: "polly" }));
      expect(r.requestReview).to.deep.equal(["chuck"]);
    });

    it("one person holds every role → nobody else can approve: a miss that says so, never a silent pass", () => {
      const solo = ruleset([], { ownership, roles: { "Policy Owner": "@solo", "Check Owner": "@solo", "Data Owner": "@solo" } });
      const r = run(pr([file(DOC, ownSection)], { approvals: [], author: "solo" }), solo);
      expect(r.verdict).to.equal("miss");
      expect(r.findings.join()).to.match(/no one other than the author/i);
    });

    it("author not given → nobody is left off (today's behaviour)", () => {
      expect(run(pr([file(DOC, ownSection)], { approvals: [] })).requestReview).to.deep.equal(["dana"]);
    });
  });

  it("through the runner, the review request rides on the verdict", () => {
    const rs = ruleset([row("GOV-FRM-086", [bind("vcs.gov-repo", "pull_request", "gov-builtin/section-owner-approval")])], { ownership });
    const v = createCheckRunner({ rules: rs, readDefault: noRead }).run("GOV-FRM-086", pr([file(DOC, BASE.replace("Keep it safe.", "Keep."))], { approvals: [] }));
    expect(v.verdict).to.equal("fail");
    expect((v as CheckVerdict & { requestReview?: string[] }).requestReview).to.deep.equal(["dana"]);
  });
});

describe("check engine slice 2 — violation records (Q15)", () => {
  const r040 = row("GOV-FRM-040", [bind("vcs.gov-repo", "push", "gh-action/landed-by-pr")]);
  const fail: CheckVerdict = { verdict: "fail", findings: ["GOV-FRM-040 [gh-action/landed-by-pr]: commit deadbee was pushed without a merged pull request"] };
  const RUN = "https://github.com/acme/acme-gov/actions/runs/42";

  it("an observe-event FAIL builds the issue: title, label, Policy Owner, body", () => {
    const v = violationFor({ row: r040, ctx: push({}), verdict: fail, rules: ruleset([r040]), runUrl: RUN });
    expect(v.kind).to.equal("record");
    const issue = (v as { issue: ViolationIssue }).issue;
    expect(issue.title).to.match(/^gov-violation: GOV-FRM-040 Every change lands on the default branch/);
    expect(issue.title.length).to.be.at.most(100);
    expect(issue.labels).to.deep.equal(["gov-violation"]);
    expect(issue.assignees).to.deep.equal(["polly"]);
    for (const s of ["Every change lands on the default branch through a merged pull request.", "C01", "vcs.gov-repo · push", "deadbee", RUN]) {
      expect(issue.body).to.contain(s);
    }
  });

  it("a long expectation is shortened at a word, with an ellipsis", () => {
    const long = row("GOV-SVM-001", [], { expectation: "Everyone keeps every secret out of every file in every repository that the organization owns or operates." });
    const issue = (violationFor({ row: long, ctx: push({}), verdict: fail, rules: ruleset([long]) }) as { issue: ViolationIssue }).issue;
    expect(issue.title).to.match(/…$/);
    expect(issue.title).to.not.match(/\s…$/);
    expect(issue.body).to.contain("(no run link)");
  });

  it("a GATE fail never opens a record — the gate already refused", () => {
    const v = violationFor({ row: r040, ctx: { resource: "vcs.gov-repo", event: "pull_request", payload: {} }, verdict: fail, rules: ruleset([r040]) });
    expect(v.kind).to.equal("none");
  });

  it("a pass or a cannot-tell is not a violation", () => {
    for (const verdict of ["pass", "cannot-tell"] as const) {
      expect(violationFor({ row: r040, ctx: push({}), verdict: { verdict, findings: [] }, rules: ruleset([r040]) }).kind).to.equal("none");
    }
  });

  it("no Policy Owner handle: the record opens unassigned and says the role is vacant", () => {
    const issue = (violationFor({ row: r040, ctx: push({}), verdict: fail, rules: ruleset([r040], { roles: {} }) }) as { issue: ViolationIssue }).issue;
    expect(issue.assignees).to.deep.equal([]);
    expect(issue.body).to.contain("Policy Owner role is vacant");
  });

  it("recordViolation: undo none (or undeclared) is report only — the undo port is not called", () => {
    const opened: ViolationIssue[] = [];
    let undone = 0;
    const out = recordViolation({ row: r040, ctx: push({}), verdict: fail, rules: ruleset([r040]) },
      { openIssue: (i) => { opened.push(i); return { number: 9 }; }, undo: () => { undone++; return true; } });
    expect(opened).to.have.length(1);
    expect(undone).to.equal(0);
    expect(out.undo).to.equal("none");
    expect(opened[0]!.body).to.contain("report only");
    expect(out.issue).to.equal(9);
  });

  it("recordViolation: a declared undo (issue closed → reopen) goes through the port, and the body says it was done", () => {
    const r = row("GOV-SVM-050", [bind("pms.issue", "closed", "gov-builtin/naming", { pattern: "x" })]);
    const calls: string[] = [];
    const opened: ViolationIssue[] = [];
    const ctx: EventContext = { resource: "pms.issue", event: "closed", payload: {} };
    const out = recordViolation({ row: r, ctx, verdict: fail, rules: ruleset([r]) },
      { openIssue: (i) => { opened.push(i); return { number: 3 }; }, undo: (kind) => { calls.push(kind); return true; } });
    expect(calls).to.deep.equal(["reopen"]);
    expect(out.undo).to.equal("done");
    expect(opened[0]!.body).to.contain("reopen — done");
  });

  it("recordViolation: an undo that fails, or no undo port, is said in the record", () => {
    const r = row("GOV-SVM-050", [bind("pms.issue", "closed", "gov-builtin/naming", { pattern: "x" })]);
    const ctx: EventContext = { resource: "pms.issue", event: "closed", payload: {} };
    const bodies: string[] = [];
    const o1 = recordViolation({ row: r, ctx, verdict: fail, rules: ruleset([r]) }, { openIssue: (i) => { bodies.push(i.body); return null; }, undo: () => false });
    expect(o1.undo).to.equal("failed");
    expect(o1.issue, "the issue port failed").to.equal(null);
    const o2 = recordViolation({ row: r, ctx, verdict: fail, rules: ruleset([r]) }, { openIssue: (i) => { bodies.push(i.body); return { number: 1 }; } });
    expect(o2.undo).to.equal("unavailable");
    expect(bodies[0]).to.contain("reopen — failed");
  });

  it("recordViolation on a gate fail opens nothing", () => {
    let opened = 0;
    const out = recordViolation({ row: r040, ctx: { resource: "vcs.gov-repo", event: "pull_request", payload: {} }, verdict: fail, rules: ruleset([r040]) },
      { openIssue: () => { opened++; return { number: 1 }; } });
    expect(opened).to.equal(0);
    expect(out.issue).to.equal(null);
  });
});

describe("check engine slice 2 — the renderer: branches, forced, permissions", () => {
  const b = (id: string, resource: string, event: string, action: string, w: Record<string, unknown> = {}) => ({ id, check: bind(resource, event, action, w) });

  it("push(default) for landed-by-pr filters to the default branch; forced-push adds its condition; least privilege per job", () => {
    const [f] = renderWorkflow([
      b("GOV-FRM-040", "vcs.gov-repo", "push", "gh-action/landed-by-pr"),
      b("GOV-FRM-466", "vcs.gov-repo", "push", "gov-builtin/forbid-forced-push"),
      b("GOV-FRM-086", "vcs.gov-repo", "pull_request", "gov-builtin/section-owner-approval"),
      b("GOV-FRM-001", "vcs.gov-repo", "pull_request", "gov-builtin/naming", { pattern: "x" }),
    ], { defaultBranch: "main" });
    expect(f!.text).to.equal(EXPECTED);
  });

  it("the rendered workflow is valid YAML of the shape GitHub reads", () => {
    const [f] = renderWorkflow([
      b("GOV-FRM-040", "vcs.gov-repo", "push", "gh-action/landed-by-pr"),
      b("GOV-SVM-050", "pms.issue", "closed", "gov-builtin/naming", { pattern: "x" }),
    ], { defaultBranch: "main" });
    const doc = yaml.load(f!.text) as { on: Record<string, unknown>; jobs: Record<string, { permissions?: Record<string, string> }> };
    expect(doc.on).to.deep.equal({ issues: { types: ["closed"] }, push: { branches: ["main"] } });
    expect(doc.jobs["GOV-FRM-040_push"]!.permissions).to.deep.equal({ contents: "read", issues: "write", "pull-requests": "read" });
    expect(doc.jobs["GOV-SVM-050_closed"]!.permissions).to.deep.equal({ contents: "read", issues: "write" });
  });

  it("with no default branch known, landed-by-pr is not filtered (the runner still scopes it)", () => {
    const [f] = renderWorkflow([b("GOV-FRM-040", "vcs.gov-repo", "push", "gh-action/landed-by-pr")]);
    expect(f!.text).to.contain("  push:\n\npermissions:");
  });

  it("an explicit branches= wins over the action's default", () => {
    const [f] = renderWorkflow([b("GOV-FRM-466", "vcs.code-repo", "push", "gov-builtin/forbid-forced-push", { branches: ["release/*"] })]);
    expect(f!.text).to.contain('    branches: ["release/*"]');
  });

  it("one unfiltered push job leaves the trigger unfiltered", () => {
    const [f] = renderWorkflow([
      b("GOV-FRM-466", "vcs.code-repo", "push", "gov-builtin/forbid-forced-push"),
      b("GOV-SVM-002", "vcs.code-repo", "push", "gov-builtin/naming", { pattern: "x" }),
    ]);
    expect(f!.text).to.contain("  push:\n\npermissions:");
  });
});

const steps = (id: string, resource: string, event: string, token: boolean) => `    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
      - name: Install the gov CLI
        run: npm install -g @svayam-opensource/gov
      - name: gov check run ${id}
${token ? "        env:\n          GH_TOKEN: ${{ github.token }}\n" : ""}        run: gov check run ${id} --resource ${resource} --event ${event} --gov-home .
`;
const EXPECTED = `# GENERATED by gov from the rule stores — do not edit; re-render instead.
# Each job runs one rule's checks for one event through \`gov check run <GOV-ID>\`. Rules are read from the
# default branch, never from the branch under review.
name: gov-checks

on:
  pull_request:
  push:
    branches: ["BRNCH-*", "main"]

permissions:
  contents: read

jobs:
  GOV-FRM-001_pull_request:
    name: GOV-FRM-001 · pull_request
    if: github.event_name == 'pull_request'
${steps("GOV-FRM-001", "vcs.gov-repo", "pull_request", false)}  GOV-FRM-040_push:
    name: GOV-FRM-040 · push
    if: github.event_name == 'push'
    permissions:
      contents: read
      issues: write
      pull-requests: read
${steps("GOV-FRM-040", "vcs.gov-repo", "push", true)}  GOV-FRM-086_pull_request:
    name: GOV-FRM-086 · pull_request
    if: github.event_name == 'pull_request'
    permissions:
      contents: read
      pull-requests: write
${steps("GOV-FRM-086", "vcs.gov-repo", "pull_request", true)}  GOV-FRM-466_push:
    name: GOV-FRM-466 · push
    if: github.event_name == 'push' && github.event.forced
    permissions:
      contents: read
      issues: write
${steps("GOV-FRM-466", "vcs.gov-repo", "push", true)}`;
