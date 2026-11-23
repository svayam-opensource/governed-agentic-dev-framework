// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// SOLO MODE (Policy Owner ruling Q45 C, PRJ-121, 2026-11-23). Nobody approves their own work — unchanged. Under soft
// posture, while nobody but the author holds any role or alternate, a merge with no second approver is recorded
// honestly as "self-merged: no second person": an EVIDENCE entry on ONE open solo-mode issue (the banner), never a
// gov-violation record. Any other red gov check on the same PR still opens the violation record. Hard: nothing changes.
// The banner closes on the first push after a second person holds a role or an alternate.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { expect } from "chai";
import { githubCheckRunsForCommit, githubFailureAnnotations, redMerges, type CheckRunRef, type PullRef, type RedMerge } from "../../../src/rules/checks/gh-actions.js";
import { closeSoloBanner, recordRedMerges, selfMergeMarker, SOLO_BANNER_MARKER, SOLO_LABEL, soloBannerIssue, type SoloModePorts, type ViolationIssue } from "../../../src/rules/checks/violation.js";
import { githubSoloModePorts, type Gh } from "../../../src/rules/checks/github-adapters.js";
import { SELF_MERGED_SOLO } from "../../../src/rules/checks/policy-actions.js";
import { checkCommand, type CheckVerbConfig, type CheckVerbDeps } from "../../../src/cli/check-verb.js";
import type { EventContext, RuleSet } from "../../../src/rules/model/contracts.js";

const here = dirname(fileURLToPath(import.meta.url));
const CONTENT = resolve(here, "../../../../../content");
const read = (rel: string) => readFileSync(resolve(CONTENT, rel), "utf8");

const C1 = "1111111111111111111111111111111111111111";
const H4 = "4444444444444444444444444444444444444444";
const SOLO_FINDING = `GOV-FRM-455: ${SELF_MERGED_SOLO} — @solo changed \`policies/org-policy.md\` §6 (Policy Owner), and no one other than the author holds any role or alternate (solo mode).`;
const rules = (posture: "soft" | "hard", roles: Record<string, string> = { "Policy Owner": "@solo", "Check Owner": "@solo" }, alternates: Record<string, string> = {}) =>
  ({ framework: [], org: [], catalog: { resources: [], tools: [], actions: [] }, roles, alternates, posture }) as unknown as RuleSet;

const push: EventContext = { resource: "vcs.gov-repo", event: "push", payload: { branch: "main", defaultBranch: "main", commits: [C1] } as EventContext["payload"] };
const PR4: PullRef = { number: 4, mergedAt: "2026-11-23T10:00:00Z", base: "main", headSha: H4 };
const run455: CheckRunRef = { id: 455, name: "GOV-FRM-455 · pull_request", conclusion: "failure", summary: "" };
const run467: CheckRunRef = { id: 467, name: "GOV-FRM-467 · pull_request", conclusion: "failure", summary: "" };

describe("solo mode — telling a solo-mode red check from any other (redMerges)", () => {
  const find = (runs: CheckRunRef[], annotations: Record<number, readonly string[] | null>) =>
    redMerges({ ruleId: "GOV-FRM-040", params: {}, ctx: push }, {
      pullsForCommit: () => [PR4], checkRunsForCommit: () => runs, failureAnnotations: (id) => annotations[id] ?? [],
    }).merges;

  it("every failure annotation is solo mode → the failed check is marked solo", () => {
    expect(find([run455], { 455: [SOLO_FINDING] })[0]!.failed).to.deep.equal([{ rule: "GOV-FRM-455", event: "pull_request", summary: "", solo: true }]);
  });
  it("a failure that also says something else, no annotations, or annotations GitHub would not give → not solo", () => {
    for (const a of [[SOLO_FINDING, "GOV-FRM-455: @chuck has not approved"], [], null]) {
      expect(find([run455], { 455: a })[0]!.failed[0]!.solo).to.equal(undefined);
    }
  });
  it("no annotations port (an older caller) → never solo", () => {
    const r = redMerges({ ruleId: "GOV-FRM-040", params: {}, ctx: push }, { pullsForCommit: () => [PR4], checkRunsForCommit: () => [run455] });
    expect(r.merges[0]!.failed[0]!.solo).to.equal(undefined);
  });
});

/** An in-memory tracker: violation records, the banner, its entries. */
function tracker(o: { banner?: number | null; recorded?: number[]; blind?: boolean } = {}) {
  const violations: ViolationIssue[] = [];
  const banners: ViolationIssue[] = [];
  const entries: { banner: number; body: string }[] = [];
  const closed: { banner: number; body: string }[] = [];
  let banner = o.banner ?? null;
  const solo: SoloModePorts = {
    findBanner: () => (o.blind ? null : { found: banner }),
    openBanner: (i) => { banners.push(i); banner = 30; return { number: 30 }; },
    recordedPrs: () => [...(o.recorded ?? []), ...entries.map((e) => Number(/pr=(\d+)/.exec(e.body)![1]))],
    addEntry: (b, body) => { entries.push({ banner: b, body }); return true; },
    closeBanner: (b, body) => { closed.push({ banner: b, body }); banner = null; return true; },
  };
  const ports = { openIssue: (i: ViolationIssue) => { violations.push(i); return { number: 12 }; }, findOpenRecord: () => ({ found: null }), solo };
  return { ports, solo, violations, banners, entries, closed };
}

describe("solo mode — recording a self-merge (recordRedMerges)", () => {
  const soloOnly: RedMerge = { pr: 4, headSha: H4, failed: [{ rule: "GOV-FRM-455", event: "pull_request", summary: "", solo: true }] };
  const mixed: RedMerge = { ...soloOnly, failed: [...soloOnly.failed, { rule: "GOV-FRM-467", event: "pull_request", summary: "" }] };

  it("SOFT, only solo-mode failures → no violation record; the banner is opened and the self-merge is an entry on it", () => {
    const t = tracker();
    const r = recordRedMerges([soloOnly], rules("soft"), t.ports, "https://github.com/acme/acme-gov/actions/runs/9");
    expect(t.violations).to.deep.equal([]);
    expect(r.opened).to.deep.equal([]);
    expect(r.selfMerges).to.deep.equal([4]);
    expect(t.banners).to.have.length(1);
    expect(t.banners[0]!.labels).to.deep.equal([SOLO_LABEL]).and.not.include("gov-violation");
    expect(t.banners[0]!.body).to.contain(SOLO_BANNER_MARKER).and.contain("solo mode").and.contain("not as a violation");
    expect(t.entries).to.have.length(1);
    expect(t.entries[0]!.body).to.contain(`PR #4 — ${SELF_MERGED_SOLO}`).and.contain(selfMergeMarker(4)).and.contain("runs/9");
    expect(r.lines.join("\n")).to.contain("opened solo-mode issue #30").and.contain("evidence, not a violation");
  });

  it("ONE banner: a second self-merge is a second entry on the open banner, and a re-run adds none", () => {
    const t = tracker({ banner: 30, recorded: [4] });
    const r = recordRedMerges([soloOnly, { ...soloOnly, pr: 5 }], rules("soft"), t.ports);
    expect(t.banners).to.deep.equal([]);
    expect(t.entries.map((e) => e.banner)).to.deep.equal([30]);
    expect(r.selfMerges).to.deep.equal([5]);
    expect(r.lines.join("\n")).to.contain("#30 already records it");
  });

  it("SOFT, another gov check red on the same PR → the violation record still opens, naming that check only", () => {
    const t = tracker();
    const r = recordRedMerges([mixed], rules("soft"), t.ports);
    expect(t.violations).to.have.length(1);
    expect(t.violations[0]!.title).to.equal("gov-violation: PR #4 merged with failing gov checks (GOV-FRM-467)");
    expect(t.entries).to.have.length(1);
    expect(r.opened).to.deep.equal([12]);
  });

  it("HARD: nothing changes — every red check is a violation, no banner", () => {
    const t = tracker();
    recordRedMerges([mixed], rules("hard"), t.ports);
    expect(t.violations[0]!.title).to.contain("(GOV-FRM-455, GOV-FRM-467)");
    expect(t.banners).to.deep.equal([]);
    expect(t.entries).to.deep.equal([]);
  });

  it("the banner cannot be searched → nothing recorded, and it says re-run", () => {
    const t = tracker({ blind: true });
    const r = recordRedMerges([soloOnly], rules("soft"), t.ports);
    expect(t.violations).to.deep.equal([]);
    expect(r.lines.join()).to.contain("could not search").and.contain("re-run");
  });

  it("no solo ports → a solo-mode failure is recorded as a violation (never silently dropped)", () => {
    const t = tracker();
    recordRedMerges([soloOnly], rules("soft"), { openIssue: t.ports.openIssue, findOpenRecord: t.ports.findOpenRecord });
    expect(t.violations).to.have.length(1);
  });

  it("the banner goes to the Policy Owner and names nobody's email", () => {
    const i = soloBannerIssue(rules("soft"));
    expect(i.assignees).to.deep.equal(["solo"]);
    expect(i.body).to.not.match(/@[\w.-]+\.\w+/);
  });
});

describe("solo mode — the banner closes when a second person is named (closeSoloBanner)", () => {
  it("a second role holder, or an alternate → the open banner is closed, saying why", () => {
    for (const r of [rules("soft", { "Policy Owner": "@solo", "Check Owner": "@chuck" }), rules("soft", { "Policy Owner": "@solo" }, { "Policy Owner": "@pat" })]) {
      const t = tracker({ banner: 30 });
      const lines = closeSoloBanner(r, t.solo);
      expect(t.closed).to.have.length(1);
      expect(t.closed[0]!.body).to.contain("Solo mode has ended");
      expect(lines.join()).to.contain("closed solo-mode issue #30");
    }
  });
  it("still solo → left open; no banner → nothing", () => {
    const t = tracker({ banner: 30 });
    expect(closeSoloBanner(rules("soft"), t.solo)).to.deep.equal([]);
    expect(t.closed).to.deep.equal([]);
    expect(closeSoloBanner(rules("soft", { "Policy Owner": "@solo", "Check Owner": "@chuck" }), tracker().solo)).to.deep.equal([]);
  });
});

describe("solo mode — the GitHub ports", () => {
  it("check runs carry their id; failure annotations are read by it, failure level only", () => {
    const runs = githubCheckRunsForCommit(() => JSON.stringify({ check_runs: [{ id: 455, name: "GOV-FRM-455 · pull_request", conclusion: "failure", output: { title: null } }] }), "a/b")(H4);
    expect(runs).to.deep.equal([{ id: 455, name: "GOV-FRM-455 · pull_request", conclusion: "failure", summary: "" }]);
    const calls: string[][] = [];
    const ann = githubFailureAnnotations((a) => { calls.push([...a]); return JSON.stringify([
      { annotation_level: "failure", message: SOLO_FINDING }, { annotation_level: "notice", message: "evidence off" },
    ]); }, "acme/acme-gov")(455);
    expect(ann).to.deep.equal([SOLO_FINDING]);
    expect(calls[0]).to.deep.equal(["api", "repos/acme/acme-gov/check-runs/455/annotations?per_page=100"]);
    expect(githubFailureAnnotations(() => null, "a/b")(1)).to.equal(null);
  });

  it("the banner: an open gov-solo-mode issue carrying the marker; entries from the comments' markers", () => {
    const calls: string[][] = [];
    const gh: Gh = (a) => {
      calls.push([...a]);
      if (a[0] === "issue" && a[1] === "list") return JSON.stringify([{ number: 3, body: "other" }, { number: 30, body: `x\n${SOLO_BANNER_MARKER}` }]);
      if (a[0] === "api") return `entry\n${selfMergeMarker(4)}\nentry\n${selfMergeMarker(7)}\n`;
      if (a[0] === "issue" && a[1] === "create") return "https://github.com/acme/acme-gov/issues/31";
      return "";
    };
    const p = githubSoloModePorts(gh, "acme/acme-gov");
    expect(p.findBanner()).to.deep.equal({ found: 30 });
    expect(calls[0]).to.include.members(["--label", SOLO_LABEL, "open"]);
    expect(p.recordedPrs(30)).to.deep.equal([4, 7]);
    expect(p.openBanner(soloBannerIssue(rules("soft")))).to.deep.equal({ number: 31 });
    expect(calls.some((c) => c[0] === "label" && c.includes(SOLO_LABEL))).to.equal(true);
    expect(calls.some((c) => c.includes("gov-violation"))).to.equal(false);
    expect(p.addEntry(30, "b")).to.equal(true);
    expect(p.closeBanner(30, "why")).to.equal(true);
    expect(githubSoloModePorts(() => null, "a/b").findBanner()).to.equal(null);
  });
});

describe("solo mode — gov check run on the push, end to end", () => {
  const files = (governance: string): Record<string, string> => ({
    "org-config.yaml": 'org_slug: "ACME"\n',
    "policies/governance.yaml": governance,
    "framework/rules/rules.yaml": read("framework/rules/rules.yaml"),
    "framework/rules/checks-catalog.yaml": read("framework/rules/checks-catalog.yaml"),
  });
  const git = (f: Record<string, string>) => (_repo: string, args: readonly string[]): string | null => {
    if (args[0] === "rev-parse") return args.includes("origin/main") ? "abc" : null;
    if (args[0] === "rev-list") return C1;
    if (args[0] === "ls-tree") { const want = args.slice(args.indexOf("--") + 1); return Object.keys(f).filter((x) => want.some((p) => x === p || x.startsWith(`${p}/`))).join("\n"); }
    if (args[0] === "show" && args[1]?.startsWith("origin/main:")) return f[args[1].slice("origin/main:".length)] ?? null;
    return null;
  };
  const EVENT = { ref: "refs/heads/main", before: C1, after: C1, forced: false, commits: [{ id: C1 }], repository: { full_name: "acme/acme-gov", default_branch: "main" } };
  const CFG = (posture: "soft" | "hard"): CheckVerbConfig => ({ home: "/gov", defaultBranch: "main", defaultCodeBranch: "dev", githubOrg: "acme", workspaceRepo: "acme-gov", posture });
  const ghFor = (calls: string[][], banner: string) => (a: readonly string[]): string | null => {
    calls.push([...a]);
    const k = a.join(" ");
    if (k.startsWith(`api repos/acme/acme-gov/commits/${C1}/pulls`)) return JSON.stringify([{ number: 4, merged_at: "2026-11-23T10:00:00Z", base: { ref: "main" }, head: { sha: H4 } }]);
    if (k.startsWith(`api repos/acme/acme-gov/commits/${H4}/check-runs`)) return JSON.stringify({ check_runs: [{ id: 455, name: "GOV-FRM-455 · pull_request", conclusion: "failure", output: { title: null } }] });
    if (k.startsWith("api repos/acme/acme-gov/check-runs/455/annotations")) return JSON.stringify([{ annotation_level: "failure", message: SOLO_FINDING }]);
    if (k.startsWith("api --paginate repos/acme/acme-gov/issues/")) return "";
    if (a[0] === "issue" && a[1] === "list") return a.includes(SOLO_LABEL) ? banner : "[]";
    if (a[0] === "issue" && a[1] === "create") return "https://github.com/acme/acme-gov/issues/30";
    return "";
  };
  const deps = (gh: Gh, governance: string): CheckVerbDeps => ({
    git: git(files(governance)), gh,
    env: { GITHUB_EVENT_PATH: "/e.json", GITHUB_EVENT_NAME: "push", GITHUB_REPOSITORY: "acme/acme-gov", GITHUB_SERVER_URL: "https://github.com", GITHUB_RUN_ID: "9" },
    readFile: (f) => (f === "/e.json" ? JSON.stringify(EVENT) : null), writeFile: () => {},
  });
  const ARGS = { resource: "vcs.gov-repo", event: "push" };
  const SOLO_GOV = (posture: string) => `governance_posture: "${posture}"\npolicy_owner:\n  github: "@solo"\n`;

  it("SOFT, solo: no gov-violation issue; the solo-mode banner is opened and PR #4 is an entry on it", () => {
    const calls: string[][] = [];
    const r = checkCommand(["run", "GOV-FRM-040"], ARGS, deps(ghFor(calls, "[]"), SOLO_GOV("soft")), CFG("soft"));
    const text = r.lines.join("\n");
    expect(r.code, text).to.equal(0);
    const creates = calls.filter((c) => c[0] === "issue" && c[1] === "create");
    expect(creates).to.have.length(1);
    expect(creates[0]).to.include(SOLO_LABEL).and.not.include("gov-violation");
    expect(calls.filter((c) => c[0] === "issue" && c[1] === "comment")).to.have.length(1);
    expect(text).to.contain("evidence, not a violation");
  });

  it("HARD, the same red check: a violation record, as before", () => {
    const calls: string[][] = [];
    checkCommand(["run", "GOV-FRM-040"], ARGS, deps(ghFor(calls, "[]"), SOLO_GOV("hard")), CFG("hard"));
    const creates = calls.filter((c) => c[0] === "issue" && c[1] === "create");
    expect(creates).to.have.length(1);
    expect(creates[0]).to.include("gov-violation");
  });

  it("a second person named on the default branch → the open banner closes on the push", () => {
    const calls: string[][] = [];
    const gov = 'governance_posture: "soft"\npolicy_owner:\n  github: "@solo"\ncheck_owner:\n  github: "@chuck"\n';
    const r = checkCommand(["run", "GOV-FRM-040"], ARGS, deps(ghFor(calls, JSON.stringify([{ number: 30, body: SOLO_BANNER_MARKER }])), gov), CFG("soft"));
    expect(calls.filter((c) => c[0] === "issue" && c[1] === "close").map((c) => c[2])).to.deep.equal(["30"]);
    expect(r.lines.join("\n")).to.contain("closed solo-mode issue #30");
  });
});
