// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// SOFT MERGE WITH RED CHECKS → A VIOLATION RECORD (Policy Owner, 2026-10-07; rule-model-design.md "soft merge with red
// checks"). Found in the sandbox: PR #4 merged with GOV-FRM-455 red under soft posture and nothing was recorded —
// GOV-FRM-040's push check passed because the PR did merge. A gate rule claimed `detected`, and nothing detected it.
//
// The push to the default branch now reads the check runs on each merged PR's head; any `<GOV-ID> · <event>` that
// concluded failure opens ONE gov-violation record per PR, for the Policy Owner. Never twice for the same PR.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { expect } from "chai";
import { govCheckRunOf, redMerges, githubCheckRunsForCommit, type CheckRunRef, type PullRef, type RedMerge } from "../../../src/rules/checks/gh-actions.js";
import { redMergeIssue, recordRedMerges, redMergeMarker } from "../../../src/rules/checks/violation.js";
import { githubOpenRedMergeRecord, type Gh } from "../../../src/rules/checks/github-adapters.js";
import { checkRunName } from "../../../src/rules/checks/render-github.js";
import { checkCommand, type CheckVerbConfig, type CheckVerbDeps } from "../../../src/cli/check-verb.js";
import type { EventContext, RuleSet } from "../../../src/rules/model/contracts.js";

const here = dirname(fileURLToPath(import.meta.url));
const CONTENT = resolve(here, "../../../../../content");
const read = (rel: string) => readFileSync(resolve(CONTENT, rel), "utf8");

const C1 = "1111111111111111111111111111111111111111";
const C2 = "2222222222222222222222222222222222222222";
const H4 = "4444444444444444444444444444444444444444";
const RULES = { framework: [], org: [], catalog: { resources: [], tools: [], actions: [] }, roles: { "Policy Owner": "@polly" } } as unknown as RuleSet;

const push = (over: Record<string, unknown> = {}): EventContext =>
  ({ resource: "vcs.gov-repo", event: "push", payload: { branch: "main", defaultBranch: "main", commits: [C1, C2], ...over } as EventContext["payload"] });
const PR4: PullRef = { number: 4, mergedAt: "2026-10-07T10:00:00Z", base: "main", headSha: H4 };
const RUNS: CheckRunRef[] = [
  { name: "GOV-FRM-455 · pull_request", conclusion: "failure", summary: "@chuck must approve policies/org-policy.md §4" },
  { name: "GOV-FRM-467 · pull_request", conclusion: "success", summary: "" },
  { name: "build", conclusion: "failure", summary: "not a gov check" },
];
const ports = (over: { pulls?: (sha: string) => readonly PullRef[] | null; runs?: (sha: string) => readonly CheckRunRef[] | null } = {}) => ({
  pullsForCommit: over.pulls ?? (() => [PR4]),
  checkRunsForCommit: over.runs ?? ((sha: string) => (sha === H4 ? RUNS : [])),
});

describe("soft merge with red checks — which check runs are gov's", () => {
  it("parses the renderer's own check-run name, and nothing else", () => {
    expect(govCheckRunOf(checkRunName("GOV-FRM-455", "pull_request"))).to.deep.equal({ rule: "GOV-FRM-455", event: "pull_request" });
    expect(govCheckRunOf(checkRunName("GOV-FRM-086c", "pull_request"))).to.deep.equal({ rule: "GOV-FRM-086c", event: "pull_request" });
    expect(govCheckRunOf(checkRunName("GOV-SVM-001", "push"))).to.deep.equal({ rule: "GOV-SVM-001", event: "push" });
    expect(govCheckRunOf("build")).to.equal(null);
    expect(govCheckRunOf("GOV-FRM-455")).to.equal(null);
  });
});

describe("soft merge with red checks — finding them (pure)", () => {
  it("a merged PR whose gov check failed → one merge, naming the rule and its summary; other checks ignored", () => {
    const r = redMerges({ ruleId: "GOV-FRM-040", params: {}, ctx: push() }, ports());
    expect(r.notes).to.deep.equal([]);
    expect(r.merges).to.deep.equal([{ pr: 4, headSha: H4, failed: [{ rule: "GOV-FRM-455", event: "pull_request", summary: "@chuck must approve policies/org-policy.md §4" }] }]);
  });
  it("all gov checks green → nothing", () => {
    const r = redMerges({ ruleId: "GOV-FRM-040", params: {}, ctx: push() }, ports({ runs: () => [RUNS[1]!] }));
    expect(r.merges).to.deep.equal([]);
  });
  it("a PR not merged, or merged into another branch, is landed-by-pr's business — not this", () => {
    const r = redMerges({ ruleId: "GOV-FRM-040", params: {}, ctx: push() },
      ports({ pulls: () => [{ ...PR4, mergedAt: null }, { ...PR4, number: 5, base: "dev" }] }));
    expect(r.merges).to.deep.equal([]);
  });
  it("a push to a branch out of scope is not looked at", () => {
    const r = redMerges({ ruleId: "GOV-FRM-040", params: {}, ctx: push({ branch: "BRNCH-1-x" }) }, ports());
    expect(r).to.deep.equal({ merges: [], notes: [] });
  });
  it("GitHub not answering is a note, never a silent pass", () => {
    const r = redMerges({ ruleId: "GOV-FRM-040", params: {}, ctx: push() }, ports({ runs: () => null }));
    expect(r.merges).to.deep.equal([]);
    expect(r.notes.join()).to.contain("#4").and.contain("check runs");
  });
});

describe("soft merge with red checks — the record", () => {
  const M: RedMerge = { pr: 4, headSha: H4, failed: [{ rule: "GOV-FRM-455", event: "pull_request", summary: "@chuck must approve §4" }, { rule: "GOV-FRM-467", event: "pull_request", summary: "" }] };
  it("names the PR, each failed rule and its finding, says it merged under soft posture, and goes to the Policy Owner", () => {
    const i = redMergeIssue(M, RULES, "https://github.com/acme/acme-gov/actions/runs/9");
    expect(i.title).to.equal("gov-violation: PR #4 merged with failing gov checks (GOV-FRM-455, GOV-FRM-467)");
    expect(i.labels).to.deep.equal(["gov-violation"]);
    expect(i.assignees).to.deep.equal(["polly"]);
    expect(i.body).to.contain("merged under soft posture with these checks failing")
      .and.contain("#4").and.contain("GOV-FRM-455 · pull_request — @chuck must approve §4")
      .and.contain("GOV-FRM-467 · pull_request — (the check run gave no summary").and.contain(redMergeMarker(4));
  });
  it("opens one record per PR; an open record for that PR already → none; cannot search → none, and says so", () => {
    const opened: string[] = [];
    const open = (i: { title: string }) => { opened.push(i.title); return { number: 12 }; };
    const r = recordRedMerges([M], RULES, { openIssue: open, findOpenRecord: () => ({ found: null }) });
    expect(r.lines.join()).to.contain("opened violation record #12");
    expect(opened).to.have.length(1);
    const again = recordRedMerges([M], RULES, { openIssue: open, findOpenRecord: () => ({ found: 12 }) });
    expect(again.lines.join()).to.contain("#12 already records PR #4");
    expect(opened).to.have.length(1);
    const blind = recordRedMerges([M], RULES, { openIssue: open, findOpenRecord: () => null });
    expect(blind.lines.join()).to.contain("could not search").and.contain("re-run");
    expect(opened).to.have.length(1);
  });
});

describe("soft merge with red checks — the GitHub ports", () => {
  it("check runs: name, conclusion, and the output's title as the summary", () => {
    const calls: string[][] = [];
    const gh: Gh = (a) => { calls.push([...a]); return JSON.stringify({ total_count: 2, check_runs: [
      { name: "GOV-FRM-455 · pull_request", conclusion: "failure", output: { title: "needs @chuck", summary: "long" }, html_url: "u1" },
      { name: "GOV-FRM-467 · pull_request", conclusion: null, output: { title: null, summary: null }, html_url: "u2" },
    ] }); };
    expect(githubCheckRunsForCommit(gh, "acme/acme-gov")(H4)).to.deep.equal([
      { name: "GOV-FRM-455 · pull_request", conclusion: "failure", summary: "needs @chuck" },
      { name: "GOV-FRM-467 · pull_request", conclusion: null, summary: "" },
    ]);
    expect(calls[0]).to.deep.equal(["api", `repos/acme/acme-gov/commits/${H4}/check-runs?per_page=100`]);
    expect(githubCheckRunsForCommit(() => null, "a/b")(H4)).to.equal(null);
    expect(githubCheckRunsForCommit(() => "nope", "a/b")(H4)).to.equal(null);
  });
  it("the existing record: an OPEN gov-violation issue whose body carries the PR's marker", () => {
    const gh: Gh = () => JSON.stringify([{ number: 3, body: "direct push" }, { number: 12, body: `x\n${redMergeMarker(4)}\n` }]);
    expect(githubOpenRedMergeRecord(gh, "acme/acme-gov")(4)).to.deep.equal({ found: 12 });
    expect(githubOpenRedMergeRecord(gh, "acme/acme-gov")(40)).to.deep.equal({ found: null });
    expect(githubOpenRedMergeRecord(() => null, "acme/acme-gov")(4)).to.equal(null);
  });
});

describe("soft merge with red checks — gov check run on the push", () => {
  const GOVERNANCE = 'governance_posture: "soft"\npolicy_owner:\n  github: "@polly"\n';
  const files: Record<string, string> = {
    "org-config.yaml": 'org_slug: "ACME"\n',
    "policies/governance.yaml": GOVERNANCE,
    "framework/rules/rules.yaml": read("framework/rules/rules.yaml"),
    "framework/rules/catalog.yaml": read("framework/rules/catalog.yaml"),
  };
  const git = (_repo: string, args: readonly string[]): string | null => {
    if (args[0] === "rev-parse") return args.includes("origin/main") ? "abc" : null;
    if (args[0] === "rev-list") return C1;
    if (args[0] === "ls-tree") { const want = args.slice(args.indexOf("--") + 1); return Object.keys(files).filter((f) => want.some((p) => f === p || f.startsWith(`${p}/`))).join("\n"); }
    if (args[0] === "show" && args[1]?.startsWith("origin/main:")) return files[args[1].slice("origin/main:".length)] ?? null;
    return null;
  };
  const EVENT = { ref: "refs/heads/main", before: C2, after: C1, forced: false, commits: [{ id: C1 }], repository: { full_name: "acme/acme-gov", default_branch: "main" } };
  const CFG = (posture: "soft" | "hard"): CheckVerbConfig => ({ home: "/gov", defaultBranch: "main", defaultCodeBranch: "dev", githubOrg: "acme", workspaceRepo: "acme-gov", posture });
  const ghFor = (calls: string[][], existing: string) => (a: readonly string[]): string | null => {
    calls.push([...a]);
    const k = a.join(" ");
    if (k.startsWith(`api repos/acme/acme-gov/commits/${C1}/pulls`)) return JSON.stringify([{ number: 4, merged_at: "2026-10-07T10:00:00Z", base: { ref: "main" }, head: { sha: H4 } }]);
    if (k.startsWith(`api repos/acme/acme-gov/commits/${H4}/check-runs`)) return JSON.stringify({ check_runs: [{ name: "GOV-FRM-455 · pull_request", conclusion: "failure", output: { title: "@chuck must approve §4" } }] });
    if (a[0] === "issue" && a[1] === "list") return existing;
    if (a[0] === "issue" && a[1] === "create") return "https://github.com/acme/acme-gov/issues/12";
    return "";
  };
  const deps = (gh: Gh): CheckVerbDeps => ({
    git, gh,
    env: { GITHUB_EVENT_PATH: "/e.json", GITHUB_EVENT_NAME: "push", GITHUB_REPOSITORY: "acme/acme-gov", GITHUB_SERVER_URL: "https://github.com", GITHUB_RUN_ID: "9" },
    readFile: (f) => (f === "/e.json" ? JSON.stringify(EVENT) : null), writeFile: () => {},
  });
  const ARGS = { resource: "vcs.gov-repo", event: "push" };

  it("SOFT: GOV-FRM-040 passes (the PR merged) AND one record names PR #4 and GOV-FRM-455, for the Policy Owner", () => {
    const calls: string[][] = [];
    const r = checkCommand(["run", "GOV-FRM-040"], ARGS, deps(ghFor(calls, "[]")), CFG("soft"));
    const text = r.lines.join("\n");
    expect(r.code, text).to.equal(0);
    expect(text).to.contain("GOV-FRM-040 passed").and.contain("opened violation record #12");
    const creates = calls.filter((c) => c[0] === "issue" && c[1] === "create");
    expect(creates).to.have.length(1);
    expect(creates[0]!.join(" ")).to.contain("PR #4 merged with failing gov checks (GOV-FRM-455)").and.contain("--assignee polly");
  });

  it("SOFT, re-run: an open record for PR #4 already → no second record", () => {
    const calls: string[][] = [];
    const r = checkCommand(["run", "GOV-FRM-040"], ARGS, deps(ghFor(calls, JSON.stringify([{ number: 12, body: redMergeMarker(4) }]))), CFG("soft"));
    expect(calls.filter((c) => c[0] === "issue" && c[1] === "create")).to.have.length(0);
    expect(r.lines.join("\n")).to.contain("#12 already records PR #4");
  });

  it("HARD: the checks were required, so a red merge cannot happen — gov does not look", () => {
    const calls: string[][] = [];
    checkCommand(["run", "GOV-FRM-040"], ARGS, deps(ghFor(calls, "[]")), CFG("hard"));
    expect(calls.some((c) => c.join(" ").includes("/check-runs"))).to.equal(false);
    expect(calls.some((c) => c[0] === "issue")).to.equal(false);
  });
});
