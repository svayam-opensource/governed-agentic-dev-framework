// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// THE CHECK ENGINE, THIRD SLICE (W6): GitHub events → payloads, the thin GitHub adapters, the rule set with
// ownership and roles, and `gov check run` / `gov check install` end to end over fakes and the shipped stores.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { expect } from "chai";
import { buildPayload, approvalsFrom, type PayloadReaders } from "../../../src/rules/checks/event-payload.js";
import { githubViolationPorts, requestReviews, type Gh } from "../../../src/rules/checks/github-adapters.js";
import { githubPullsForCommit } from "../../../src/rules/checks/gh-actions.js";
import { loadCheckRuleSet, defaultRef } from "../../../src/rules/checks/ruleset-io.js";
import { checkCommand, policyPrFromEvent, type CheckVerbDeps, type CheckVerbConfig } from "../../../src/cli/check-verb.js";
import type { ViolationIssue } from "../../../src/rules/checks/violation.js";
import { sectionOwnerApproval } from "../../../src/rules/checks/policy-actions.js";
import type { EventContext } from "../../../src/rules/model/contracts.js";

const here = dirname(fileURLToPath(import.meta.url));
const CONTENT = resolve(here, "../../../../../content");
const read = (rel: string) => readFileSync(resolve(CONTENT, rel), "utf8");

const HEAD = "1111111111111111111111111111111111111111";
const BASE = "2222222222222222222222222222222222222222";
const MB = "3333333333333333333333333333333333333333";

// ── real-shaped GitHub event JSON (trimmed to the fields gov reads, plus some it ignores) ──────────────────
const PR_EVENT = {
  action: "synchronize",
  number: 42,
  pull_request: {
    number: 42, state: "open", title: "Hand §4 to the Data Owner",
    user: { login: "alice", type: "User" },
    head: { ref: "BRNCH-121-doc", sha: HEAD, repo: { full_name: "acme/acme-gov" } },
    base: { ref: "main", sha: BASE, repo: { full_name: "acme/acme-gov" } },
  },
  repository: { full_name: "acme/acme-gov", default_branch: "main", private: true },
  sender: { login: "alice" },
};
const PUSH_EVENT = {
  ref: "refs/heads/main", before: BASE, after: HEAD, forced: false, created: false, deleted: false,
  commits: [{ id: HEAD, message: "direct push", author: { username: "bob" } }],
  head_commit: { id: HEAD },
  repository: { full_name: "acme/acme-gov", default_branch: "main", master_branch: "main" },
  pusher: { name: "bob" },
};
const ISSUE_EVENT = {
  action: "closed",
  issue: { number: 7, state: "closed", title: "Project anchor" },
  repository: { full_name: "acme/acme-gov", default_branch: "main" },
};
const REVIEWS = JSON.stringify([
  { id: 1, user: { login: "dana" }, state: "CHANGES_REQUESTED", commit_id: BASE },
  { id: 2, user: { login: "dana" }, state: "APPROVED", commit_id: HEAD },
  { id: 3, user: { login: "dana" }, state: "COMMENTED", commit_id: HEAD },
  { id: 4, user: { login: "polly" }, state: "APPROVED", commit_id: BASE },
  { id: 5, user: { login: "carl" }, state: "APPROVED", commit_id: HEAD },
  { id: 6, user: { login: "carl" }, state: "DISMISSED", commit_id: HEAD },
]);

/** git over a map of `args.join(" ")` → stdout. */
const gitOf = (map: Record<string, string | null>) => (args: readonly string[]): string | null => {
  const k = args.join(" ");
  return k in map ? map[k]! : null;
};

describe("check engine slice 3 — GitHub events → payload", () => {
  const prGit = gitOf({
    [`merge-base ${BASE} ${HEAD}`]: `${MB}\n`,
    [`diff --name-status ${MB} ${HEAD}`]: "M\tpolicies/org-policy.md\nA\tpolicies/new.md\n",
    [`diff -U0 ${MB} ${HEAD} -- policies/org-policy.md`]: "+++ b/policies/org-policy.md\n+Keep it very safe.\n",
    [`diff -U0 ${MB} ${HEAD} -- policies/new.md`]: "+## 1 New\n",
    [`show ${HEAD}:policies/org-policy.md`]: "## 4 Data\n\nKeep it very safe.\n",
    [`show ${HEAD}:policies/new.md`]: "## 1 New\n",
    [`show ${MB}:policies/org-policy.md`]: "## 4 Data\n\nKeep it safe.\n",
  });
  const ghCalls: string[][] = [];
  const readers = (git = prGit, reviews: string | null = REVIEWS): PayloadReaders =>
    ({ git, gh: (a) => { ghCalls.push([...a]); return reviews; } });

  it("pull_request: changed files with added lines, head text, base texts at the merge-base, branch, author, approvals, default", () => {
    const b = buildPayload("pull_request", PR_EVENT, "acme/acme-gov", readers());
    expect(b.event).to.equal("pull_request");
    expect(b.pullNumber).to.equal(42);
    const p = b.payload;
    expect(p.branch).to.equal("BRNCH-121-doc");
    expect(p.author).to.equal("alice");
    expect(p.defaultBranch).to.equal("main");
    expect(p.changed).to.deep.equal([
      { path: "policies/org-policy.md", status: "modified", addedLines: ["Keep it very safe."], text: "## 4 Data\n\nKeep it very safe.\n" },
      { path: "policies/new.md", status: "added", addedLines: ["## 1 New"], text: "## 1 New\n" },
    ]);
    expect(p.baseTexts).to.deep.equal({ "policies/org-policy.md": "## 4 Data\n\nKeep it safe.\n", "policies/new.md": null });
    expect(p.approvals, "latest per reviewer, APPROVED, on the head; COMMENTED does not change standing").to.deep.equal(["dana"]);
    expect(ghCalls.at(-1)).to.deep.equal(["api", "--paginate", "repos/acme/acme-gov/pulls/42/reviews"]);
  });

  it("pull_request: gh not answering leaves approvals OUT; git not answering leaves the changeset out", () => {
    expect(buildPayload("pull_request", PR_EVENT, "acme/acme-gov", readers(prGit, null)).payload.approvals).to.equal(undefined);
    const p = buildPayload("pull_request", PR_EVENT, "acme/acme-gov", readers(gitOf({}))).payload;
    expect(p.changed).to.equal(undefined);
    expect(p.baseTexts).to.equal(undefined);
  });

  it("approvalsFrom refuses what is not a list", () => {
    expect(approvalsFrom("nope", HEAD)).to.equal(undefined);
    expect(approvalsFrom("{}", HEAD)).to.equal(undefined);
    expect(approvalsFrom("[]", HEAD)).to.deep.equal([]);
  });

  it("push: commits from git (the event lists at most 20), forced, branch, default, changed files", () => {
    const git = gitOf({
      [`rev-list ${BASE}..${HEAD}`]: `${HEAD}\naaaa\n`,
      [`diff --name-status ${BASE} ${HEAD}`]: "M\tREADME.md\n",
      [`diff -U0 ${BASE} ${HEAD} -- README.md`]: "+hi\n",
      [`show ${HEAD}:README.md`]: "hi\n",
    });
    const b = buildPayload("push", { ...PUSH_EVENT, forced: true }, "acme/acme-gov", { git, gh: () => null });
    expect(b.event).to.equal("push");
    expect(b.payload).to.deep.equal({
      defaultBranch: "main", branch: "main", forced: true, commits: [HEAD, "aaaa"],
      changed: [{ path: "README.md", status: "modified", addedLines: ["hi"], text: "hi\n" }],
    });
  });

  it("push: git cannot list → the event's commits; a new branch (before = zeros) → the event's commits only", () => {
    expect(buildPayload("push", PUSH_EVENT, "a/b", { git: gitOf({}), gh: () => null }).payload.commits).to.deep.equal([HEAD]);
    const created = { ...PUSH_EVENT, before: "0".repeat(40), created: true };
    const p = buildPayload("push", created, "a/b", { git: gitOf({}), gh: () => null }).payload;
    expect(p.commits).to.deep.equal([HEAD]);
    expect(p.changed).to.equal(undefined);
  });

  it("issues: the action is the event; the issue number rides along for undo", () => {
    const b = buildPayload("issues", ISSUE_EVENT, "acme/acme-gov", { git: gitOf({}), gh: () => null });
    expect(b.event).to.equal("closed");
    expect(b.issueNumber).to.equal(7);
    expect(b.payload).to.deep.equal({ defaultBranch: "main" });
  });

  it("an event gov has no reading of → no event name", () => {
    expect(buildPayload("workflow_dispatch", {}, "a/b", { git: gitOf({}), gh: () => null }).event).to.equal(null);
  });
});

describe("check engine slice 3 — the GitHub adapters (fake runner)", () => {
  const fake = (answer: (args: readonly string[], input?: string) => string | null) => {
    const calls: { args: string[]; input?: string }[] = [];
    const gh: Gh = (args, input) => { calls.push({ args: [...args], ...(input === undefined ? {} : { input }) }); return answer(args, input); };
    return { gh, calls };
  };
  const ISSUE: ViolationIssue = { title: "gov-violation: GOV-FRM-040 x", body: "B", labels: ["gov-violation"], assignees: ["polly"] };

  it("openIssue: label first (idempotent), then the issue with label + assignee; the body on stdin", () => {
    const { gh, calls } = fake((a) => (a[0] === "issue" ? "https://github.com/acme/acme-gov/issues/12\n" : ""));
    expect(githubViolationPorts(gh, "acme/acme-gov").openIssue(ISSUE)).to.deep.equal({ number: 12 });
    expect(calls[0]!.args.slice(0, 5)).to.deep.equal(["label", "create", "gov-violation", "--repo", "acme/acme-gov"]);
    expect(calls[0]!.args).to.include("--force");
    expect(calls[1]!.args).to.deep.equal(["issue", "create", "--repo", "acme/acme-gov", "--title", ISSUE.title, "--body-file", "-", "--label", "gov-violation", "--assignee", "polly"]);
    expect(calls[1]!.input).to.equal("B");
  });

  it("openIssue: an assignee GitHub refuses → opened unassigned; gh failing outright → null", () => {
    const { gh, calls } = fake((a) => (a[0] === "issue" ? (a.includes("--assignee") ? null : "https://github.com/a/b/issues/3") : ""));
    expect(githubViolationPorts(gh, "a/b").openIssue(ISSUE)).to.deep.equal({ number: 3 });
    expect(calls.at(-1)!.args).to.not.include("--assignee");
    expect(githubViolationPorts(fake(() => null).gh, "a/b").openIssue(ISSUE)).to.equal(null);
  });

  it("undo reopen: `gh issue reopen <n>`; unknown kind or no issue → not done", () => {
    const { gh, calls } = fake(() => "");
    const ctx = { resource: "pms.issue", event: "closed", payload: {} };
    expect(githubViolationPorts(gh, "a/b", 7).undo!("reopen", ctx)).to.equal(true);
    expect(calls[0]!.args).to.deep.equal(["issue", "reopen", "7", "--repo", "a/b"]);
    expect(githubViolationPorts(gh, "a/b").undo!("reopen", ctx)).to.equal(false);
    expect(githubViolationPorts(gh, "a/b", 7).undo!("revert", ctx)).to.equal(false);
  });

  it("requestReviews: POST requested_reviewers with a JSON body", () => {
    const { gh, calls } = fake(() => "{}");
    expect(requestReviews(gh, "a/b", 42, ["dana", "polly"])).to.equal(true);
    expect(calls[0]).to.deep.equal({ args: ["api", "-X", "POST", "repos/a/b/pulls/42/requested_reviewers", "--input", "-"], input: '{"reviewers":["dana","polly"]}' });
    expect(requestReviews(fake(() => null).gh, "a/b", 1, ["x"])).to.equal(false);
    expect(requestReviews(fake(() => null).gh, "a/b", 1, []), "nobody to ask is not a failure").to.equal(true);
  });

  it("pullsForCommit goes through the same runner", () => {
    const { gh, calls } = fake(() => "[]");
    expect(githubPullsForCommit((a) => gh(a), "a/b")("abc")).to.deep.equal([]);
    expect(calls[0]!.args).to.deep.equal(["api", "repos/a/b/commits/abc/pulls"]);
  });
});

// ── a governance repository at origin/main, as `git` would show it ───────────────────────────────────────
const ORG_CONFIG = 'org_slug: "ACME"\npolicy_owner_github: "@polly"\ncheck_owner_github: "chuck"\n';
const POLICY = "## 4 Data\n\nKeep it safe.\n\n## 5 Other\n\nx\n";
function govRepo(files: Record<string, string> = {}): Record<string, string> {
  return {
    "org-config.yaml": ORG_CONFIG,
    "framework/rules/rules.yaml": read("framework/rules/rules.yaml"),
    "framework/rules/catalog.yaml": read("framework/rules/catalog.yaml"),
    "policies/org-policy.md": POLICY,
    "policies/ownership.yaml": '- { doc: policies/org-policy.md, section: "4", role: Check Owner, sha: "abc1234" }\n- { doc: policies/org-policy.md, section: "5", role: Check Owner }\n',
    ...files,
  };
}
/** git -C <repo>: the gov repo at origin/main, plus per-repo extras keyed by args. */
function fakeGit(files: Record<string, string>, extra: Record<string, string | null> = {}) {
  return (_repo: string, args: readonly string[]): string | null => {
    const k = args.join(" ");
    if (k in extra) return extra[k]!;
    if (args[0] === "rev-parse") return args.includes("origin/main") ? "abc" : null;
    if (args[0] === "ls-tree") {
      const at = args.indexOf("--");
      const want = args.slice(at + 1);
      return Object.keys(files).filter((f) => want.some((p) => f === p || f.startsWith(`${p}/`))).join("\n");
    }
    if (args[0] === "show" && args[1]?.startsWith("origin/main:")) return files[args[1].slice("origin/main:".length)] ?? null;
    return null;
  };
}

describe("check engine slice 3 — the rule set a check runs against", () => {
  it("rules + catalog at the default ref, with ownership and the two framework roles", () => {
    const git = fakeGit(govRepo());
    expect(defaultRef(git, "/gov", "main")).to.equal("origin/main");
    expect(defaultRef(() => null, "/gov", "main")).to.equal("main");
    const r = loadCheckRuleSet(git, "/gov", "origin/main");
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    // The row with no `sha` (of the section that grants it) is not an ownership row: it is dropped.
    expect(r.set.ownership).to.deep.equal([{ doc: "policies/org-policy.md", section: "4", role: "Check Owner", sha: "abc1234" }]);
    expect(r.set.roles).to.deep.equal({ "Policy Owner": "@polly", "Check Owner": "chuck" });
    expect(r.set.framework.length).to.be.greaterThan(10);
  });

  // W2-Q5 + W2-Q8: a section owned by a role from the ORG's list is routed to that role's holder — not, as before the
  // role list was read, to the Policy Owner as if the role were vacant.
  it("a Data Owner's section is routed to the Data Owner's holder from the org's role list", () => {
    const files = govRepo({
      "policies/authorized-representatives.md": "# Reps\n\n| Role | GitHub handle | Owns |\n|---|---|---|\n| Data Owner | @dana | `knowledge/data/` |\n",
      "policies/ownership.yaml": '- { doc: policies/org-policy.md, section: "4", role: Data Owner, sha: "abc1234" }\n',
    });
    const r = loadCheckRuleSet(fakeGit(files), "/gov", "origin/main");
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.set.roles).to.include({ "Data Owner": "@dana" });
    const base = "# Policy\n\n## 4. Data\n\nOld text.\n";
    const head = "# Policy\n\n## 4. Data\n\nNew text.\n";
    const ctx = { resource: "vcs.gov-repo", event: "pull_request", payload: {
      changed: [{ path: "policies/org-policy.md", status: "modified", text: head }],
      baseTexts: { "policies/org-policy.md": base }, author: "someone", approvals: [],
    } } as unknown as EventContext;
    const out = sectionOwnerApproval("t", {}, ctx, r.set);
    expect(out.verdict).to.equal("miss");
    expect(out.requestReview).to.deep.equal(["dana"]);
    expect(out.findings.join("\n")).to.match(/@dana.*§4 \(Data Owner\)/);
    expect(sectionOwnerApproval("t", {}, { ...ctx, payload: { ...ctx.payload, approvals: ["dana"] } }, r.set).verdict).to.equal("pass");
  });

  it("no ownership file is every section the Policy Owner's; a broken one is could-not-tell", () => {
    const files = govRepo();
    delete files["policies/ownership.yaml"];
    const r = loadCheckRuleSet(fakeGit(files), "/gov", "origin/main");
    expect(r.ok && r.set.ownership).to.deep.equal([]);
    expect(loadCheckRuleSet(fakeGit(govRepo({ "policies/ownership.yaml": "{ not: a list }" })), "/gov", "origin/main").ok).to.equal(false);
  });
});

describe("gov check run", () => {
  const CFG = (posture: "hard" | "soft" = "soft"): CheckVerbConfig =>
    ({ home: "/gov", defaultBranch: "main", defaultCodeBranch: "dev", githubOrg: "acme", workspaceRepo: "acme-gov", posture });
  const deps = (over: { git?: CheckVerbDeps["git"]; gh?: Gh; env?: Record<string, string>; event?: unknown; written?: Record<string, string> } = {}): CheckVerbDeps & { ghCalls: string[][] } => {
    const ghCalls: string[][] = [];
    return {
      git: over.git ?? fakeGit(govRepo()),
      gh: over.gh ?? ((a) => { ghCalls.push([...a]); return null; }),
      env: { GITHUB_EVENT_PATH: "/tmp/event.json", GITHUB_REPOSITORY: "acme/acme-gov", GITHUB_SERVER_URL: "https://github.com", GITHUB_RUN_ID: "99", ...(over.env ?? {}) },
      readFile: (f) => (f === "/tmp/event.json" && over.event !== undefined ? JSON.stringify(over.event) : null),
      writeFile: (f, t) => { if (over.written) over.written[f] = t; },
      ghCalls,
    };
  };
  const run = (args: string[], d: CheckVerbDeps, cfg = CFG()) => {
    const pos = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1]!.startsWith("--")));
    const flags: Record<string, string> = {};
    for (let i = 0; i < args.length; i++) if (args[i]!.startsWith("--")) flags[args[i]!.slice(2)] = args[++i]!;
    return checkCommand(pos, flags, d, cfg);
  };

  // A pull request that rewrites §4 (owned by the Check Owner, chuck), opened by alice.
  const prGit = fakeGit(govRepo(), {
    [`merge-base ${BASE} ${HEAD}`]: MB,
    [`diff --name-status ${MB} ${HEAD}`]: "M\tpolicies/org-policy.md",
    [`diff -U0 ${MB} ${HEAD} -- policies/org-policy.md`]: "+Keep it very safe.",
    [`show ${HEAD}:policies/org-policy.md`]: POLICY.replace("Keep it safe.", "Keep it very safe."),
    [`show ${MB}:policies/org-policy.md`]: POLICY,
  });
  const reviewsBy = (who: string) => JSON.stringify([{ user: { login: who }, state: "APPROVED", commit_id: HEAD }]);
  const prGh = (reviews: string) => (calls: string[][]): Gh => (a, input) => {
    calls.push([...a, ...(input ? [`<${input}`] : [])]);
    if (a[0] === "api" && String(a.at(-1)).endsWith("/reviews")) return reviews;
    return "{}";
  };
  const id = "GOV-FRM-455";
  const ARGS = ["run", id, "--resource", "vcs.gov-repo", "--event", "pull_request"];

  it("usage when the id, resource or event is missing", () => {
    expect(run(["run", id], deps()).code).to.equal(2);
    expect(run([], deps()).code).to.equal(2);
  });

  it("a GATE fail exits 1, prints the human message, and requests review from the missing owner", () => {
    const calls: string[][] = [];
    const r = run(ARGS, deps({ git: prGit, gh: prGh("[]")(calls), event: PR_EVENT, env: { GITHUB_EVENT_NAME: "pull_request" } }));
    const text = r.lines.join("\n");
    expect(r.code, text).to.equal(1);
    expect(text).to.contain(`${id} · C01 — failed`).and.contain("Expectation:").and.contain("@chuck");
    expect(text).to.contain("requested review from @chuck");
    expect(calls.some((c) => c.includes("repos/acme/acme-gov/pulls/42/requested_reviewers") && c.includes('<{"reviewers":["chuck"]}'))).to.equal(true);
  });

  it("approved by the owner → pass, exit 0", () => {
    const r = run(ARGS, deps({ git: prGit, gh: prGh(reviewsBy("chuck"))([]), event: PR_EVENT, env: { GITHUB_EVENT_NAME: "pull_request" } }));
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(r.lines.join("\n")).to.contain("passed");
  });

  it("cannot-tell: exit 0 with a WARNING under soft; exit 1 under hard — said in the output", () => {
    const soft = run(ARGS, deps({ event: undefined }));
    expect(soft.code).to.equal(0);
    expect(soft.lines.join("\n")).to.contain("WARNING").and.contain("could not tell").and.contain("does NOT block");
    const hard = run(ARGS, deps({ event: undefined }), CFG("hard"));
    expect(hard.code).to.equal(1);
    expect(hard.lines.join("\n")).to.contain("hard posture");
  });

  it("an unknown rule, or rules that cannot be read, is cannot-tell", () => {
    expect(run(["run", "GOV-FRM-999", "--resource", "vcs.gov-repo", "--event", "push"], deps(), CFG("hard")).code).to.equal(1);
    const r = run(ARGS, deps({ git: () => null }), CFG("hard"));
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.contain("the rules could not be read");
  });

  describe("the policy PR inputs (GOV-FRM-467's gate) for the gov repo's pull_request", () => {
    // Two trees: the merge-base (MB) and the PR head (HEAD), each a whole repository.
    const AT_MB = govRepo({ "policies/VERSION": "1.4.0\n" });
    const AT_HEAD = { ...AT_MB, "README.md": "touched outside policies/\n" };
    const byRef: Record<string, Record<string, string>> = { [MB]: AT_MB, [HEAD]: AT_HEAD, "origin/main": AT_MB };
    const prGit2 = (calls: string[][] = []) => (repo: string, args: readonly string[]): string | null => {
      calls.push([repo, ...args]);
      const k = args.join(" ");
      if (k === `merge-base ${BASE} ${HEAD}`) return `${MB}\n`;
      if (k === `show -s --format=%cs ${HEAD}`) return "2026-09-30\n";
      if (args[0] === "diff" && args[1] === "--name-status") return "M\tREADME.md";
      if (args[0] === "diff") return "+touched outside policies/";
      if (args[0] === "rev-parse") return args.includes("origin/main") ? "abc" : null;
      if (args[0] === "ls-tree") {
        const ref = args.find((a) => a in byRef);
        if (!ref) return null;
        const want = args.slice(args.indexOf("--") + 1);
        return Object.keys(byRef[ref]!).filter((f) => want.some((p) => f === p || f.startsWith(`${p}/`))).join("\n");
      }
      if (args[0] === "show" && args[1]?.includes(":")) {
        const [ref, file] = [args[1].slice(0, args[1].indexOf(":")), args[1].slice(args[1].indexOf(":") + 1)];
        return byRef[ref]?.[file] ?? null;
      }
      return null;
    };

    it("trees at the merge-base and the head, the PR number from the event, the date of the HEAD COMMIT", () => {
      const calls: string[][] = [];
      const p = policyPrFromEvent((r, a) => prGit2(calls)(r, a), "/gov", "pull_request", PR_EVENT)!;
      expect(p).to.not.equal(null);
      expect(p.pr).to.equal(42);
      expect(p.today, "deterministic: the head commit's committer date, never the run's").to.equal("2026-09-30");
      expect(p.base.read("policies/VERSION")).to.equal("1.4.0\n");
      expect(p.head.read("README.md")).to.equal("touched outside policies/\n");
      expect(p.base.read("README.md")).to.equal(null);
      expect(calls.every((c) => c[0] === "/gov")).to.equal(true);
    });

    it("not a pull_request, or no shas, or no commit date → no inputs (the gate then says cannot-tell)", () => {
      expect(policyPrFromEvent(prGit2(), "/gov", "push", PUSH_EVENT)).to.equal(null);
      expect(policyPrFromEvent(prGit2(), "/gov", "pull_request", { ...PR_EVENT, pull_request: { ...PR_EVENT.pull_request, head: {} } })).to.equal(null);
      expect(policyPrFromEvent(() => null, "/gov", "pull_request", PR_EVENT)).to.equal(null);
    });

    it("end to end: a gov-repo PR that leaves policies/ alone PASSES GOV-FRM-467 under hard posture", () => {
      const r = run(["run", "GOV-FRM-467", "--resource", "vcs.gov-repo", "--event", "pull_request"],
        deps({ git: prGit2(), gh: () => "[]", event: PR_EVENT, env: { GITHUB_EVENT_NAME: "pull_request" } }), CFG("hard"));
      expect(r.code, r.lines.join("\n")).to.equal(0);
      expect(r.lines.join("\n")).to.contain("GOV-FRM-467 passed");
    });
  });

  it("--repo-dir is the directory the job runs in, not a path under --gov-home", () => {
    const repos = new Set<string>();
    const git = (repo: string, args: readonly string[]) => { repos.add(repo); return fakeGit(govRepo())(repo, args); };
    run(["run", "GOV-FRM-040", "--resource", "vcs.code-repo", "--event", "push", "--repo-dir", "."], deps({ git, event: PUSH_EVENT, env: { GITHUB_EVENT_NAME: "push" } }), { ...CFG(), home: "/work/billing/.gov" });
    expect([...repos].sort()).to.deep.equal([process.cwd(), "/work/billing/.gov"].sort());
  });

  it("an OBSERVE fail opens a violation record and exits 0 — the push already happened", () => {
    const calls: string[][] = [];
    const git = fakeGit(govRepo(), { [`rev-list ${BASE}..${HEAD}`]: HEAD });
    const gh: Gh = (a, input) => {
      calls.push([...a, ...(input ? ["<body>"] : [])]);
      if (a[0] === "api" && String(a[1]).endsWith("/pulls")) return "[]"; // the commit belongs to no PR
      if (a[0] === "issue") return "https://github.com/acme/acme-gov/issues/31";
      return "";
    };
    const r = run(["run", "GOV-FRM-040", "--resource", "vcs.gov-repo", "--event", "push"], deps({ git, gh, event: PUSH_EVENT, env: { GITHUB_EVENT_NAME: "push" } }), CFG("hard"));
    const text = r.lines.join("\n");
    expect(r.code, text).to.equal(0);
    expect(text).to.contain("GOV-FRM-040 · C01 — failed").and.contain("opened violation record #31").and.contain("does not block");
    const create = calls.find((c) => c[0] === "issue" && c[1] === "create")!;
    expect(create).to.include("--label").and.include("gov-violation").and.include("--assignee").and.include("polly");
  });
});

describe("gov check install", () => {
  const CFG: CheckVerbConfig = { home: "/gov", defaultBranch: "main", defaultCodeBranch: "dev", githubOrg: "acme", workspaceRepo: "acme-gov", posture: "soft" };
  const mk = (written: Record<string, string>): CheckVerbDeps => ({
    git: fakeGit(govRepo()), gh: () => null, env: {}, readFile: () => null, writeFile: (f, t) => { written[f] = t; },
  });

  it("the governance repo: one workflow with the gov-repo and issue bindings, written, NOT committed", () => {
    const written: Record<string, string> = {};
    const r = checkCommand(["install"], {}, mk(written), CFG);
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(Object.keys(written)).to.deep.equal(["/gov/.github/workflows/gov-checks.yml"]);
    const wf = written["/gov/.github/workflows/gov-checks.yml"]!;
    expect(wf).to.contain("--resource vcs.gov-repo").and.contain("--gov-home .");
    expect(wf).to.not.contain("vcs.code-repo");
    expect(wf).to.contain('branches: ["BRNCH-*", "main"]');
    expect(r.lines.join("\n")).to.contain("NOT committed and NOT pushed");
  });

  it("a code repo: vcs.code-repo only, its default code branch, and the governance repo checked out beside it", () => {
    const written: Record<string, string> = {};
    const r = checkCommand(["install"], { repo: "/work/billing" }, mk(written), CFG);
    expect(r.code, r.lines.join("\n")).to.equal(0);
    const wf = written["/work/billing/.github/workflows/gov-checks.yml"]!;
    expect(wf).to.contain("--resource vcs.code-repo").and.not.contain("vcs.gov-repo");
    expect(wf).to.contain("repository: acme/acme-gov").and.contain("--gov-home .gov --repo-dir .");
    expect(wf).to.contain('"dev"');
    const text = r.lines.join("\n");
    expect(wf).to.contain("actions/create-github-app-token@").and.not.contain("GOV_REPO_TOKEN");
    expect(text).to.not.contain("GOV_REPO_TOKEN");
    // The one-time App setup the org needs, said where the person installing the workflow will read it.
    expect(text).to.contain("GitHub App").and.contain("Contents: Read-only").and.contain("acme/acme-gov");
    expect(text).to.contain("Install it on the acme organization");
    expect(text).to.contain("GOV_APP_CLIENT_ID").and.contain("GOV_APP_PRIVATE_KEY").and.contain("Client ID");
    expect(text).to.not.contain("GOV_APP_ID ");
  });

  it("the governance repo itself: no App setup is printed — its workflow uses GITHUB_TOKEN", () => {
    const written: Record<string, string> = {};
    const text = checkCommand(["install"], {}, mk(written), CFG).lines.join("\n");
    expect(text).to.not.contain("GOV_APP_");
    expect(written["/gov/.github/workflows/gov-checks.yml"]).to.not.contain("create-github-app-token");
  });

  it("hard posture prints the protect step, the required checks and the force-push ruleset — and calls nothing", () => {
    let ghCalled = false;
    const written: Record<string, string> = {};
    const d = { ...mk(written), gh: () => { ghCalled = true; return null; } };
    const text = checkCommand(["install"], {}, d, { ...CFG, posture: "hard" }).lines.join("\n");
    expect(text).to.contain("gov repo protect apply --repo acme/acme-gov");
    expect(text).to.contain("GOV-FRM-455 · pull_request");
    expect(text).to.contain("refs/heads/BRNCH-*").and.contain("non_fast_forward");
    expect(ghCalled).to.equal(false);
  });

  it("rules that cannot be read: nothing is written, exit 1", () => {
    const written: Record<string, string> = {};
    const r = checkCommand(["install"], {}, { ...mk(written), git: () => null }, CFG);
    expect(r.code).to.equal(1);
    expect(written).to.deep.equal({});
  });
});
