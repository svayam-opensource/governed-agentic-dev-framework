// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * What `gov autorun` finds (spec 03 §3.1–§3.2, Q1, Q2, Q4, Q7): the project's intents (L11's scan of the project
 * branch), their artifacts' change requests and approvals read through the VcsPort, the board through the
 * WorkTrackerPort — turned into the facts `classify` decides on. Memory adapters; no git, no gh.
 */
import { expect } from "chai";
import { collectItems, planTasks, planTaskMarker, parsePlanTaskMarker, artifactOfBranch, isLooseIssue, type CollectDeps } from "../../src/autorun/facts.js";
import { classify } from "../../src/autorun/classify.js";
import { createMemoryWorkTracker, type MemoryWorkTracker } from "../../src/adapters/memory/work-tracker.js";
import { createMemoryVcs, type MemoryVcs } from "../../src/adapters/memory/vcs.js";
import type { TreeReader } from "../../src/intent/scan.js";
import { LIFECYCLE_POLICY_PATH } from "../../src/intent/lifecycle-policy.js";

const ORG = "acme", PB = "BRNCH-7-demo", PRJ = "PRJ-7-demo";
const GOV = { owner: ORG, name: "acme-gov" };
const BOARD = { owner: ORG, number: 7 };
const DIR = `projects/${PRJ}/intents`;

function mapTree(files: Record<string, string>): TreeReader {
  return {
    async list(dir) {
      const names = new Set<string>();
      for (const f of Object.keys(files)) if (f.startsWith(`${dir}/`)) names.add(f.slice(dir.length + 1).split("/")[0]!);
      return names.size ? [...names] : null;
    },
    async read(f) { return f in files ? files[f]! : null; },
  };
}

const art = (title: string, status: string, body = ""): string => `# ${title}\n\n${status}\n\n${body}`;

function world(files: Record<string, string>, over: Partial<CollectDeps> = {}) {
  const tracker: MemoryWorkTracker = createMemoryWorkTracker({ projects: [{ ref: BOARD, title: "Demo" }] });
  const host: MemoryVcs = createMemoryVcs({
    repos: [{ repo: GOV, defaultBranch: "main", branches: { main: "a", [PB]: "b", [`${PB}.INTENT-01-spec`]: "c", [`${PB}.INTENT-01-intent`]: "d", [`${PB}.INTENT-01-plan`]: "e" } },
      { repo: { owner: ORG, name: "app" }, defaultBranch: "dev", branches: { dev: "a", [`${PB}.ISSUE-1`]: "x", [`${PB}.ISSUE-2`]: "y" } }],
  });
  const changed: Record<string, string> = {};
  const deps: CollectDeps = {
    tree: mapTree({ [LIFECYCLE_POLICY_PATH]: "# lifecycle\n", ...files }),
    host, tracker, govRepo: GOV, board: BOARD, project: PRJ, projectBranch: PB,
    changedAt: (p) => changed[p] ?? null,
    ...over,
  };
  return { deps, tracker, host, changed };
}

/** A merged change request a person approved, as an APPROVED Status line names it. */
function approvedCr(host: MemoryVcs, head: string, by = "po", at = "2026-10-01T00:00:00Z"): string {
  const ref = host.seedChangeRequest({ repo: GOV, head, base: PB, title: head, body: "" });
  host.addReview(ref, { by, verdict: "approved", at });
  host.merge(ref);
  return `memory://acme/acme-gov/change/${ref.number}`;
}

describe("autorun — what it finds", () => {
  it("parses plan tasks from the Tasks section, skipping the template's placeholder", () => {
    const plan = [
      "# Plan", "", "**Status:** DRAFT", "", "## Tasks",
      "### T01 — <title>", "- **Issue:** <created after approval> · **Repo:** <repo>",
      "### T01 — Ports frame", "- **Issue:** — · **Repo:** `acme/app`",
      "### T02 — Docs", "- **Repo:** acme-gov",
      "### T03 — No repo named", "",
      "## Order", "### T99 — not a task, another section",
    ].join("\n");
    expect(planTasks(plan)).to.deep.equal([
      { id: "T01", title: "Ports frame", repo: "acme/app" },
      { id: "T02", title: "Docs", repo: "acme-gov" },
      { id: "T03", title: "No repo named", repo: null },
    ]);
  });

  it("a plan-task marker round-trips; an intent sub-branch names its intent and artifact", () => {
    expect(parsePlanTaskMarker(`x\n${planTaskMarker(PRJ, "03", "T02")}\n`)).to.deep.equal({ project: PRJ, intent: "03", task: "T02" });
    expect(parsePlanTaskMarker("no marker")).to.equal(null);
    expect(artifactOfBranch(PB, `${PB}.INTENT-03-spec`)).to.deep.equal({ nn: "03", artifact: "spec", stale: false });
    expect(artifactOfBranch(PB, `${PB}.INTENT-03-plan-stale-2`)).to.deep.equal({ nn: "03", artifact: "plan", stale: true });
    expect(artifactOfBranch(PB, `${PB}.ISSUE-4`)).to.equal(null);
    expect(artifactOfBranch(PB, `OTHER.INTENT-03-spec`)).to.equal(null);
  });

  it("a board issue in no intent is loose; gov's own issues (labelled gov-…, marked, the anchor) and started or done ones are not", () => {
    const base = { ref: { url: "https://github.com/acme/app/issues/9" }, title: "t", body: "", state: "open" as const, labels: [], assignees: [] };
    expect(isLooseIssue({ ...base, workState: "todo" })).to.equal(true);
    expect(isLooseIssue({ ...base, workState: null })).to.equal(true);
    expect(isLooseIssue({ ...base, labels: ["gov-intent:01"] })).to.equal(false);
    expect(isLooseIssue({ ...base, labels: ["gov-signal:ask"] })).to.equal(false);
    expect(isLooseIssue({ ...base, body: "<!-- gov-plan-task {} -->" })).to.equal(false);
    expect(isLooseIssue({ ...base, body: "Anchor issue for the project on GitHub Project #7 — *Demo*." })).to.equal(false);
    expect(isLooseIssue({ ...base, workState: "in-progress" })).to.equal(false);
    expect(isLooseIssue({ ...base, workState: "done" })).to.equal(false);
    expect(isLooseIssue({ ...base, state: "closed" })).to.equal(false);
    expect(isLooseIssue({ ...base, ref: { url: "https://github.com/acme/app/pull/9" } })).to.equal(false);
  });

  it("an intent APPROVED by a verified change request, with no spec → draft-spec; the tracking issue is read from intent.md", async () => {
    const w = world({});
    const url = approvedCr(w.host, `${PB}.INTENT-01-intent`);
    const deps: CollectDeps = { ...w.deps, tree: mapTree({
      [LIFECYCLE_POLICY_PATH]: "# l\n",
      [`${DIR}/01-paging/intent.md`]: art("Intent 01", `**Status: APPROVED by po 2026-10-01 (${url})**`, "**Project:** PRJ · **Tracking issue:** https://github.com/acme/acme-gov/issues/5\n"),
    }) };
    const r = await collectItems(deps);
    expect(r.ok, JSON.stringify(r)).to.equal(true);
    if (!r.ok) return;
    const it = r.items.find((i) => i.facts.id === "01-paging")!;
    expect(classify(it.facts)).to.include({ next: "draft-spec", gate: "G2" });
    expect(it.context.kind === "intent" && it.context.trackingUrl).to.equal("https://github.com/acme/acme-gov/issues/5");
  });

  it("an APPROVED line an agent wrote (no real approval behind it) is not approval", async () => {
    const { deps } = world({ [`${DIR}/01-paging/intent.md`]: art("Intent 01", "**Status: APPROVED by po 2026-10-01 (memory://acme/acme-gov/change/77)**") });
    const r = await collectItems(deps);
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    const f = r.items[0]!.facts;
    expect(f.kind === "intent" && f.intent).to.equal("draft");
    expect(classify(f).next).to.equal(null);
    expect(r.notes.join("\n")).to.match(/01-paging intent/);
  });

  it("a DRAFT artifact whose change request a person approved and merged counts as approved (gov writes the Status line on merge, Q2)", async () => {
    const { deps, host } = world({ [`${DIR}/01-paging/intent.md`]: art("Intent 01", "**Status:** DRAFT") });
    approvedCr(host, `${PB}.INTENT-01-intent`);
    const r = await collectItems(deps);
    expect(r.ok && r.items[0]!.facts.kind === "intent" && (r.items[0]!.facts as { intent: string }).intent).to.equal("approved");
  });

  it("a bot's approval on the merged change request is not approval", async () => {
    const { deps, host } = world({ [`${DIR}/01-paging/intent.md`]: art("Intent 01", "**Status:** DRAFT") });
    const ref = host.seedChangeRequest({ repo: GOV, head: `${PB}.INTENT-01-intent`, base: PB, title: "x", body: "" });
    host.addReview(ref, { by: "gov-bot[bot]", verdict: "approved" });
    host.merge(ref);
    const r = await collectItems(deps);
    expect(r.ok && (r.items[0]!.facts as { intent: string }).intent).to.equal("draft");
  });

  it("an open change request for one of the intent's artifacts → waiting on its review (idempotent re-run)", async () => {
    const { deps, host } = world({ [`${DIR}/01-paging/intent.md`]: art("Intent 01", "**Status:** DRAFT") });
    approvedCr(host, `${PB}.INTENT-01-intent`);
    host.seedChangeRequest({ repo: GOV, head: `${PB}.INTENT-01-spec`, base: PB, title: "spec", body: "" });
    const r = await collectItems(deps);
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    const c = classify(r.items[0]!.facts);
    expect(c.next).to.equal(null);
    expect(c.waitingOn).to.match(/review memory:\/\/acme\/acme-gov\/change\/2/);
  });

  it("plan approved: its tasks counted, task issues found on the board by marker, each task's change request read from its repo", async () => {
    const plan = art("Plan 01", "**Status:** DRAFT", "## Tasks\n### T01 — A\n- **Repo:** acme/app\n### T02 — B\n- **Repo:** acme/app\n### T03 — C\n- **Repo:** acme/app\n");
    const { deps, host, tracker } = world({
      [`${DIR}/01-paging/intent.md`]: art("I", "**Status:** DRAFT"),
      [`${DIR}/01-paging/spec.md`]: art("S", "**Status:** DRAFT"),
      [`${DIR}/01-paging/plan.md`]: plan,
    });
    for (const a of ["intent", "spec", "plan"]) approvedCr(host, `${PB}.INTENT-01-${a}`);
    const app = { owner: ORG, name: "app" };
    for (const t of ["T01", "T02"]) {
      const made = await tracker.create(app, { title: t, body: planTaskMarker(PRJ, "01", t), assignee: "po", labels: ["gov-intent:01"] }, [BOARD]);
      expect(made.ok).to.equal(true);
    }
    const cr = host.seedChangeRequest({ repo: app, head: `${PB}.ISSUE-1`, base: PB, title: "T01", body: "" });
    host.merge(cr);
    const r = await collectItems(deps);
    expect(r.ok, JSON.stringify(r)).to.equal(true);
    if (!r.ok) return;
    const f = r.items.find((i) => i.facts.id === "01-paging")!.facts;
    expect(f.kind === "intent" && f.planTasks).to.equal(3);
    expect(f.kind === "intent" && f.taskIssues).to.deep.equal([{ issue: "memory://acme/app/issues/1", cr: "merged" }, { issue: "memory://acme/app/issues/2", cr: "none" }]);
    expect(classify(f).next).to.equal("create-task-issues");
    // the task issues are not loose board issues
    expect(r.items.filter((i) => i.facts.kind === "issue")).to.deep.equal([]);
  });

  it("the spec changed after the plan was approved → mark-plan-stale", async () => {
    const { deps, host, changed } = world({
      [`${DIR}/01-paging/intent.md`]: art("I", "**Status:** DRAFT"),
      [`${DIR}/01-paging/spec.md`]: art("S", "**Status:** DRAFT"),
      [`${DIR}/01-paging/plan.md`]: art("P", "**Status:** DRAFT", "## Tasks\n### T01 — A\n"),
    });
    approvedCr(host, `${PB}.INTENT-01-intent`);
    approvedCr(host, `${PB}.INTENT-01-spec`, "po", "2026-10-01T00:00:00Z");
    approvedCr(host, `${PB}.INTENT-01-plan`, "po", "2026-10-02T00:00:00Z");
    changed[`${DIR}/01-paging/spec.md`] = "2026-10-05T00:00:00Z";
    const r = await collectItems(deps);
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(classify(r.items[0]!.facts).next).to.equal("mark-plan-stale");
    const ctx = r.items[0]!.context;
    expect(ctx.kind === "intent" && ctx.staleWhy).to.match(/spec changed 2026-10-05 after the plan was approved 2026-10-02/);
  });

  it("loose board issues become intake items (draft-intent), after the intents", async () => {
    const { deps, tracker } = world({ [`${DIR}/01-paging/intent.md`]: art("I", "**Status:** DRAFT") });
    const made = await tracker.create({ owner: ORG, name: "app" }, { title: "Pages are uneven", body: "b", assignee: "po" }, [BOARD]);
    expect(made.ok).to.equal(true);
    const r = await collectItems(deps);
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.items.map((i) => i.facts.id)).to.deep.equal(["01-paging", "app#1"]);
    expect(classify(r.items[1]!.facts)).to.include({ next: "draft-intent", gate: "G1" });
  });

  it("a host or tracker that cannot answer fails the collection with its reason — never an empty, all-quiet world", async () => {
    const { deps } = world({}, { board: { owner: ORG, number: 99 } });
    const r = await collectItems(deps);
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.match(/99/);
  });
});
