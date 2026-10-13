// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The prep steps `gov autorun` performs (spec 03 §3.2–§3.4, Q7, Q10, Q16): an artifact drafted by a headless agent
 * on its own sub-branch (a worktree — the person's checkout is never touched), committed by gov with the
 * Gov-Autorun / Gov-Agent trailers, proposed by a change request to the project branch; a plan marked STALE; the
 * plan's task issues created after G3, assigned to the approver and citing the plan's change request.
 *
 * Real git in a temporary directory (the commits and pushes are the point); memory adapters for the host and the
 * tracker; a scripted stand-in for the agent.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { makeStep, taskBrief, type StepDeps } from "../../src/autorun/steps.js";
import { planTaskMarker, parsePlanTaskMarker, type IntentContext } from "../../src/autorun/facts.js";
import type { Classification } from "../../src/autorun/classify.js";
import { DEFAULT_BUDGET } from "../../src/autorun/budget.js";
import { createGitVcs } from "../../src/lifecycle/vcs.js";
import { createNodeFs } from "../../src/lifecycle/fs-io.js";
import { createMemoryVcs, type MemoryVcs } from "../../src/adapters/memory/vcs.js";
import { createMemoryWorkTracker, type MemoryWorkTracker } from "../../src/adapters/memory/work-tracker.js";
import { parseLifecycle, LIFECYCLE_POLICY_PATH, statusOf } from "../../src/intent/lifecycle-policy.js";
import type { ScannedIntent } from "../../src/intent/scan.js";
import type { HeadlessResult } from "../../src/cli/work-flow.js";

const CONTENT = path.join(import.meta.dirname, "..", "..", "..", "..", "content");
const ORG = "acme", PB = "BRNCH-7-demo", PRJ = "PRJ-7-demo";
const GOV = { owner: ORG, name: "acme-gov" };
const BOARD = { owner: ORG, number: 7 };
const DIR = `projects/${PRJ}/intents/01-paging`;
const TRACKING = "https://github.com/acme/acme-gov/issues/5";

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.email=t@x", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" }).trim();

interface World {
  readonly home: string; readonly remote: string; readonly host: MemoryVcs; readonly tracker: MemoryWorkTracker;
  readonly prompts: { cwd: string; task: string }[];
  deps(over?: Partial<StepDeps>): StepDeps;
  context: IntentContext;
}

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "autorun-steps-")); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function world(agentDoes: (cwd: string, task: string) => Partial<HeadlessResult> | void = () => {}): World {
  const remote = path.join(tmp, "remote.git");
  const home = path.join(tmp, "home");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  fs.mkdirSync(home);
  git(home, "init", "-q", "-b", "main");
  const put = (rel: string, text: string): void => { fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true }); fs.writeFileSync(path.join(home, rel), text); };
  put(LIFECYCLE_POLICY_PATH, fs.readFileSync(path.join(CONTENT, LIFECYCLE_POLICY_PATH), "utf8"));
  for (const k of ["intent", "spec", "plan", "build"]) {
    const rel = `policies/reference/lifecycles/ai-sdlc/${k}.md`;
    put(rel, fs.readFileSync(path.join(CONTENT, rel), "utf8"));
  }
  put(`${DIR}/intent.md`, `# Intent 01\n\n**Status: APPROVED by po 2026-10-01 (memory://acme/acme-gov/change/1)**\n\n**Project:** ${PRJ} · **Tracking issue:** ${TRACKING}\n`);
  put(`${DIR}/spec.md`, "# Spec 01\n\n**Status: APPROVED by po 2026-10-02 (memory://acme/acme-gov/change/2)**\n");
  put(`${DIR}/plan.md`, "# Plan 01\n\n**Status: APPROVED by po 2026-10-03 (memory://acme/acme-gov/change/3)**\n\n## Tasks\n### T01 — A\n- **Repo:** acme/app\n### T02 — B\n- **Repo:** acme-gov\n");
  git(home, "add", "-A");
  git(home, "commit", "-qm", "init");
  git(home, "remote", "add", "origin", remote);
  git(home, "checkout", "-q", "-b", PB);
  git(home, "push", "-q", "origin", PB);
  git(home, "fetch", "-q", "origin");

  const branches = Object.fromEntries([PB, "main", ...["intent", "spec", "plan", "build", "plan-stale"].map((a) => `${PB}.INTENT-01-${a}`)].map((b) => [b, "sha"]));
  const host = createMemoryVcs({ repos: [{ repo: GOV, defaultBranch: "main", branches }] });
  const tracker = createMemoryWorkTracker({ projects: [{ ref: BOARD, title: "Demo" }] });
  const prompts: { cwd: string; task: string }[] = [];
  const policy = fs.readFileSync(path.join(home, LIFECYCLE_POLICY_PATH), "utf8");
  const intent: ScannedIntent = { project: PRJ, id: "01-paging", number: 1, slug: "paging", dir: DIR, artifacts: {} };
  const context: IntentContext = {
    kind: "intent", intent, nn: "01", trackingUrl: TRACKING,
    approvals: { plan: { by: "po", at: "2026-10-03T00:00:00Z", url: "memory://acme/acme-gov/change/3" } },
    staleWhy: null, tasks: [{ id: "T01", title: "A", repo: "acme/app" }, { id: "T02", title: "B", repo: "acme-gov" }], taskIssueOf: {},
  };
  const w: World = {
    home, remote, host, tracker, prompts, context,
    deps: (over = {}) => ({
      vcs: createGitVcs(), fs: createNodeFs(), host, tracker,
      home, remote: "origin", projectBranch: PB, baseRef: `origin/${PB}`, project: PRJ,
      govRepo: GOV, board: BOARD, githubOrg: ORG, workspaceRepo: "acme-gov", runId: "ar-1",
      agent: { id: "claude-code" },
      headless: async ({ cwd, task }) => {
        prompts.push({ cwd, task });
        const r = agentDoes(cwd, task) ?? {};
        return { outcome: "ok", c01Ids: [], exitCode: 0, output: "", ...r };
      },
      worktreeRoot: path.join(tmp, "state", "autorun", "wt"),
      lifecycle: parseLifecycle(policy),
      draftIntent: async () => ({ code: 0, lines: ["Intent 02-x drafted (DRAFT)", "  change request: https://github.com/acme/acme-gov/pull/12 → BRNCH-7-demo"] }),
      contextOf: (id) => (id === "01-paging" ? w.context : undefined),
      ...over,
    }),
  };
  return w;
}

const cls = (next: Classification["next"], over: Partial<Classification> = {}): Classification =>
  ({ id: "01-paging", stage: "spec", next, gate: "G3", waitingOn: "x", ...over });

/** The agent writes the artifact named on the brief's `Artifact:` line. */
const writesArtifact = (text: string) => (cwd: string, task: string): void => {
  const rel = /^Artifact: (\S+)$/m.exec(task)![1]!;
  fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
  fs.writeFileSync(path.join(cwd, rel), text);
};

describe("autorun — the prep steps", function () {
  this.timeout(30_000);   // real git: a repository, a worktree, a push per case
  it("the brief names the artifact, the lifecycle step skill, the template, and what the agent must not do", () => {
    const w = world();
    const t = taskBrief({ runId: "ar-1", artifact: "spec", path: `${DIR}/spec.md`, template: "policies/reference/lifecycles/ai-sdlc/spec.md", inputs: [`${DIR}/intent.md`] });
    expect(t).to.match(new RegExp(`^Artifact: ${DIR}/spec.md$`, "m"));
    expect(t).to.include("gov-lifecycle-spec");
    expect(t).to.include("policies/reference/lifecycles/ai-sdlc/spec.md");
    expect(t).to.include(`${DIR}/intent.md`);
    expect(t).to.match(/Do not commit/);
    expect(t).to.match(/DRAFT/);
    expect(w.home).to.be.a("string");
  });

  it("draft-plan: the agent drafts in a worktree; gov commits it with the trailers, pushes the sub-branch, opens a change request to the project branch", async () => {
    const w = world(writesArtifact("# Plan 01\n\n**Status: APPROVED by agent 2026-10-13 (x)**\n\n## Tasks\n"));
    const step = makeStep(w.deps());
    const out = await step(cls("draft-plan"), DEFAULT_BUDGET);
    expect(out, JSON.stringify(out)).to.deep.include({ kind: "ok" });
    expect(out.kind === "ok" && out.cr).to.match(/^memory:\/\/acme\/acme-gov\/change\/\d+$/);

    const branch = `${PB}.INTENT-01-plan`;
    const committed = git(w.remote, "show", `${branch}:${DIR}/plan.md`);
    expect(statusOf(committed)?.kind, "an agent never approves: the Status is forced to DRAFT").to.equal("draft");
    const msg = git(w.remote, "log", "-1", "--format=%B", branch);
    expect(msg).to.match(/^Gov-Autorun: ar-1$/m).and.match(/^Gov-Agent: claude-code$/m).and.include(`Traces to: ${TRACKING}`);

    const crs = await w.host.changeRequests(GOV, { head: branch, state: "open" });
    expect(crs.ok && crs.value.map((c) => [c.base, c.head])).to.deep.equal([[PB, branch]]);
    expect(w.tracker.commentsOn({ url: TRACKING })).to.deep.equal([]);   // the tracking issue is not on the memory tracker: a failed comment is a note, not a failure

    expect(w.prompts).to.have.length(1);
    expect(w.prompts[0]!.cwd).to.not.equal(w.home);
    expect(w.prompts[0]!.task).to.include("gov-lifecycle-plan");
    // the person's checkout: still on the project branch, clean, no worktree left behind
    expect(git(w.home, "rev-parse", "--abbrev-ref", "HEAD")).to.equal(PB);
    expect(git(w.home, "status", "--porcelain")).to.equal("");
    expect(git(w.home, "worktree", "list").split("\n")).to.have.length(1);
    expect(git(w.home, "branch", "--list", branch)).to.equal("");
  });

  it("a C01 outcome: nothing committed, nothing pushed, the step says c01 with the id", async () => {
    const w = world((cwd, task) => { writesArtifact("# Plan\n**Status:** DRAFT\n")(cwd, task); return { outcome: "c01", c01Ids: ["GOV-FRM-086"], exitCode: 1, output: "Refusing: GOV-FRM-086" }; });
    const out = await makeStep(w.deps())(cls("draft-plan"), DEFAULT_BUDGET);
    expect(out).to.deep.include({ kind: "c01", id: "GOV-FRM-086" });
    expect(git(w.remote, "branch", "--list")).to.not.include("INTENT-01-plan");
    const crs = await w.host.changeRequests(GOV, { state: "all" });
    expect(crs.ok && crs.value).to.deep.equal([]);
    expect(git(w.home, "branch", "--list", `${PB}.INTENT-01-plan`)).to.equal("");
  });

  it("an agent that fails, times out, writes nothing, or commits by itself fails that item and leaves nothing behind", async () => {
    for (const [does, why] of [
      [() => ({ outcome: "failed", exitCode: 3, output: "boom" }), /exited 3/],
      [() => ({ outcome: "failed", exitCode: null, timedOut: true, output: "" }), /time budget/],
      [() => {}, /did not write/],
      [(cwd: string, task: string) => { writesArtifact("# P\n**Status:** DRAFT\n")(cwd, task); git(cwd, "add", "-A"); git(cwd, "commit", "-qm", "mine"); }, /committed by itself/],
    ] as const) {
      const w = world(does as (cwd: string, task: string) => Partial<HeadlessResult> | void);
      const out = await makeStep(w.deps())(cls("draft-plan"), DEFAULT_BUDGET);
      expect(out.kind, String(why)).to.equal("failed");
      expect(out.kind === "failed" && out.detail).to.match(why);
      expect(git(w.remote, "branch", "--list")).to.not.include("INTENT-01-plan");
      fs.rmSync(tmp, { recursive: true, force: true }); tmp = fs.mkdtempSync(path.join(os.tmpdir(), "autorun-steps-"));
    }
  });

  it("an agent gov may not run headless (Q16) fails the agent's items with the reason, and nothing is started", async () => {
    const w = world();
    const out = await makeStep(w.deps({ agent: { refused: "Cursor has no verified headless mode" } }))(cls("draft-spec"), DEFAULT_BUDGET);
    expect(out).to.deep.include({ kind: "failed" });
    expect(out.kind === "failed" && out.detail).to.include("no verified headless mode");
    expect(w.prompts).to.deep.equal([]);
  });

  it("a commit refused by a gate citing a C01 rule halts (Q10 a)", async () => {
    const w = world(writesArtifact("# P\n**Status:** DRAFT\n"));
    const hook = path.join(w.home, ".git", "hooks", "commit-msg");
    fs.writeFileSync(hook, "#!/bin/sh\necho 'refused by GOV-FRM-086' >&2\nexit 1\n", { mode: 0o755 });
    const out = await makeStep(w.deps({ isC01: (id) => id === "GOV-FRM-086" }))(cls("draft-plan"), DEFAULT_BUDGET);
    expect(out).to.deep.include({ kind: "c01", id: "GOV-FRM-086" });
    expect(git(w.remote, "branch", "--list")).to.not.include("INTENT-01-plan");
  });

  it("mark-plan-stale: the plan's Status becomes STALE (why) on its own sub-branch, committed with the trailers, by change request", async () => {
    const w = world();
    w.context = { ...w.context, staleWhy: "spec changed 2026-10-05 after the plan was approved 2026-10-03" };
    const out = await makeStep(w.deps())(cls("mark-plan-stale"), DEFAULT_BUDGET);
    expect(out, JSON.stringify(out)).to.deep.include({ kind: "ok" });
    const branch = `${PB}.INTENT-01-plan-stale`;
    const text = git(w.remote, "show", `${branch}:${DIR}/plan.md`);
    expect(statusOf(text)).to.deep.include({ kind: "stale" });
    expect(text).to.include("spec changed 2026-10-05");
    expect(git(w.remote, "log", "-1", "--format=%B", branch)).to.match(/^Gov-Autorun: ar-1$/m).and.match(/^Gov-Agent: gov$/m);
    expect(w.prompts).to.deep.equal([]);
  });

  it("create-task-issues (after G3): one issue per task not yet created, assigned to the plan's approver, citing the plan's change request, labelled into the intent, on the board", async () => {
    const w = world();
    w.context = { ...w.context, taskIssueOf: { T01: "memory://acme/app/issues/9" } };
    const out = await makeStep(w.deps())(cls("create-task-issues", { stage: "plan", gate: null }), DEFAULT_BUDGET);
    expect(out, JSON.stringify(out)).to.deep.include({ kind: "ok" });
    const items = await w.tracker.items(BOARD);
    expect(items.ok).to.equal(true);
    if (!items.ok) return;
    expect(items.value).to.have.length(1);
    const t = items.value[0]!;
    expect(t.ref.url).to.match(/^memory:\/\/acme\/acme-gov\/issues\//);   // T02's repo is acme-gov
    expect(t.title).to.include("T02").and.include("B");
    expect(t.assignees).to.deep.equal(["po"]);
    expect(t.labels).to.deep.equal(["gov-intent:01"]);
    expect(t.body).to.include("memory://acme/acme-gov/change/3");
    expect(parsePlanTaskMarker(t.body)).to.deep.equal({ project: PRJ, intent: "01", task: "T02" });
    expect(t.body).to.include(planTaskMarker(PRJ, "01", "T02"));
  });

  it("create-task-issues refuses without a verified plan approval (only G3 authorises them, Q7)", async () => {
    const w = world();
    w.context = { ...w.context, approvals: {} };
    const out = await makeStep(w.deps())(cls("create-task-issues", { stage: "plan", gate: null }), DEFAULT_BUDGET);
    expect(out.kind).to.equal("failed");
    const items = await w.tracker.items(BOARD);
    expect(items.ok && items.value).to.deep.equal([]);
  });

  it("build-task is not wired yet: a clear per-item failure, nothing started", async () => {
    const w = world();
    const out = await makeStep(w.deps())(cls("build-task", { stage: "build", gate: "G4", target: "memory://acme/app/issues/1" }), DEFAULT_BUDGET);
    expect(out.kind).to.equal("failed");
    expect(out.kind === "failed" && out.detail).to.match(/not wired/).and.include("gov task");
    expect(w.prompts).to.deep.equal([]);
  });

  it("draft-intent goes through gov intent's own path; its change request is the step's", async () => {
    const asked: string[] = [];
    const w = world();
    const out = await makeStep(w.deps({
      contextOf: () => ({ kind: "issue", item: { ref: { url: "https://github.com/acme/app/issues/42" }, title: "t", body: "", state: "open", labels: [], assignees: [] } }),
      draftIntent: async (url) => { asked.push(url); return { code: 0, lines: ["Intent 02-t drafted (DRAFT)", "  change request: https://github.com/acme/acme-gov/pull/12 → BRNCH-7-demo"] }; },
    }))(cls("draft-intent", { id: "app#42", stage: "intake", gate: "G1" }), DEFAULT_BUDGET);
    expect(asked).to.deep.equal(["https://github.com/acme/app/issues/42"]);
    expect(out).to.deep.equal({ kind: "ok", cr: "https://github.com/acme/acme-gov/pull/12" });
  });
});
