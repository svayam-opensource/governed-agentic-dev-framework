// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// THE CHECK ENGINE, FIRST SLICE (rule-model-design.md Q13–Q15, Q22; W6): the framework catalog, the seven
// predicates as `gov-builtin/*` actions, the runner behind `gov check run <GOV-ID>`, and the GitHub Actions
// renderer. The safety rules pinned here: a check that cannot run is `cannot-tell`, never `pass`; an LLM judge
// never passes; content-forbidden judges ADDED lines only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { expect } from "chai";
import { parseCatalog, validateBindings, classifyRow, type Catalog, type CheckBinding } from "../../../src/rules/model/catalog.js";
import type { RuleRow } from "../../../src/rules/model/rule-row.js";
import type { RuleSet, EventContext } from "../../../src/rules/model/contracts.js";
import { lintCatalog, validateParams } from "../../../src/rules/checks/params.js";
import { runBuiltin, BUILTIN_ACTIONS } from "../../../src/rules/checks/builtin.js";
import { createCheckRunner } from "../../../src/rules/checks/runner.js";
import { githubActionsRenderer, renderWorkflow, WORKFLOW_PATH } from "../../../src/rules/checks/render-github.js";
import { CHECK_KINDS } from "../../../src/rules/checks/predicates.js";
import type { ChangedFile } from "../../../src/rules/diff-check.js";
import type { WorkspaceView } from "../../../src/rules/verb-gate.js";

const here = dirname(fileURLToPath(import.meta.url));
const CATALOG_TEXT = readFileSync(resolve(here, "../../../../../content/framework/rules/catalog.yaml"), "utf8");
const CATALOG: Catalog = parseCatalog(CATALOG_TEXT);

const row = (id: string, checks: CheckBinding[], over: Partial<RuleRow> = {}): RuleRow => ({
  id,
  source: { doc: "policies/org-policy.md", section: "3.1", sha: "a1b2c3" },
  expectation: "Everyone uses only approved technologies.",
  actor: ["everyone"],
  level: "C02",
  checks,
  start: { version: "1.0.0", date: "2026-10-06" },
  end: null,
  ...over,
});
const bind = (resource: string, event: string, action: string, w: Record<string, unknown> = {}, on_miss: "fail" | "warn" = "fail"): CheckBinding =>
  ({ on: { resource, event }, action, with: w, on_miss });
const ruleset = (org: RuleRow[], framework: RuleRow[] = [], catalog: Catalog = CATALOG): RuleSet =>
  ({ framework, org, orgScope: "SVM", catalog, orgVersion: "1.0.0" });
const file = (path: string, addedLines: string[], text: string | null = addedLines.join("\n"), status: ChangedFile["status"] = "modified"): ChangedFile =>
  ({ path, status, addedLines, text });
const pr = (changed: ChangedFile[], extra: Record<string, unknown> = {}): EventContext =>
  ({ resource: "vcs.code-repo", event: "pull_request", payload: { changed, ...extra } });
const ws = (files: Record<string, string>, over: Partial<WorkspaceView> = {}): WorkspaceView => ({
  exists: (p) => p in files,
  read: (p) => files[p] ?? null,
  paths: () => Object.keys(files),
  ...over,
});
const APPROVED = "| express | mocha |";
const readDefault = (p: string): string | null => (p === "policies/approved-technologies.md" ? APPROVED : null);

describe("check engine — the framework catalog", () => {
  it("parses, and lints clean: unique ids, known tools, gate|observe, undo only on observe", () => {
    expect(CATALOG.resources.length).to.be.greaterThan(0);
    expect(lintCatalog(CATALOG)).to.deep.equal([]);
  });

  it("seeds the resources, tools and actions the design names", () => {
    const ids = CATALOG.resources.map((r) => r.id);
    expect(ids).to.include.members(["vcs.gov-repo", "vcs.code-repo", "vcs.framework-repo", "pms.issue", "pms.project", "gov.verb"]);
    expect(CATALOG.tools.map((t) => t.id)).to.have.members(["gov-builtin", "bash", "python", "gh-action", "llm"]);
    for (const k of CHECK_KINDS) expect(CATALOG.actions.map((a) => a.id)).to.include(`gov-builtin/${k}`);
    expect(CATALOG.actions.map((a) => a.id)).to.include.members(["gov-builtin/test-suite", "gov-builtin/rules-propose"]);
  });

  it("vcs pull_request gates and push observes; an issue closed is undone by reopening", () => {
    const ev = (r: string, e: string) => CATALOG.resources.find((x) => x.id === r)!.events.find((x) => x.name === e)!;
    for (const r of ["vcs.gov-repo", "vcs.code-repo", "vcs.framework-repo"]) {
      expect(ev(r, "pull_request").mode).to.equal("gate");
      expect(ev(r, "push").mode).to.equal("observe");
    }
    expect(ev("pms.issue", "closed")).to.deep.equal({ name: "closed", mode: "observe", undo: "reopen" });
    expect(ev("gov.verb", "close").mode).to.equal("gate");
    expect(ev("gov.verb", "merge").mode).to.equal("gate");
  });

  it("pms.project has no renderer — a rule bound only there is cannot-tell", () => {
    expect(CATALOG.resources.find((r) => r.id === "pms.project")!.renderer).to.equal(undefined);
    const r = row("GOV-SVM-001", [bind("pms.project", "item_moved", "gov-builtin/naming", { pattern: "x" })]);
    expect(validateBindings(r, CATALOG)).to.deep.equal([]);
    expect(classifyRow(r, CATALOG)).to.equal("cannot-tell");
  });

  it("the design's own example row binds cleanly and classes as prevented", () => {
    const r = row("GOV-SVM-012", [bind("vcs.code-repo", "pull_request", "gov-builtin/list-membership", { when: ["**/package.json"], list: "policies/approved-technologies.md" })]);
    expect(validateBindings(r, CATALOG)).to.deep.equal([]);
    expect(classifyRow(r, CATALOG)).to.equal("prevented");
  });

  it("lintCatalog reports what is wrong", () => {
    const bad = parseCatalog(`
resources:
  - { id: a, events: [ { name: e, mode: sometimes }, { name: f, mode: gate, undo: revert } ] }
  - { id: a, events: [] }
tools: [ { id: t } ]
actions: [ { id: t/x, tool: nope }, { id: y, tool: t } ]
`);
    const problems = lintCatalog(bad).join("\n");
    expect(problems).to.match(/duplicate resource "a"/);
    expect(problems).to.match(/mode "sometimes"/);
    expect(problems).to.match(/undo on a gate/);
    expect(problems).to.match(/unknown tool "nope"/);
    expect(problems).to.match(/"y" is not <tool>\/<name>/);
  });
});

describe("check engine — action parameters", () => {
  const schema = CATALOG.actions.find((a) => a.id === "gov-builtin/list-membership")!.params!;
  it("accepts the declared shape", () => {
    expect(validateParams(schema, { when: ["**/package.json"], list: "x.md" })).to.deep.equal([]);
    expect(validateParams(schema, { when: "**/package.json", list: "x.md" })).to.deep.equal([]);
  });
  it("refuses a missing required, an unknown key (a typo), and a wrong type", () => {
    expect(validateParams(schema, {}).join()).to.match(/requires "list"/);
    expect(validateParams(schema, { list: "x", lsit: "y" }).join()).to.match(/unknown parameter "lsit"/);
    expect(validateParams(schema, { list: 3 }).join()).to.match(/"list" must be string/);
  });
  it("enforces an enum", () => {
    const naming = CATALOG.actions.find((a) => a.id === "gov-builtin/naming")!.params!;
    expect(validateParams(naming, { pattern: "x", subject: "nope" }).join()).to.match(/"subject" must be one of/);
  });
});

describe("check engine — gov-builtin actions", () => {
  const run = (name: string, params: Record<string, unknown>, ctx: EventContext) =>
    runBuiltin({ ruleId: "GOV-SVM-012", action: `gov-builtin/${name}`, params, ctx, readDefault });

  it("exposes one action per predicate plus test-suite and rules-propose", () => {
    expect([...BUILTIN_ACTIONS].sort()).to.deep.equal([...CHECK_KINDS, "test-suite", "rules-propose", "forbid-forced-push", "section-owner-approval", "policy-pr-gate"].sort());
  });

  it("list-membership: an unapproved added dependency misses; an approved one passes", () => {
    const miss = run("list-membership", { when: ["**/package.json"], list: "policies/approved-technologies.md" },
      pr([file("package.json", [`"left-pad": "^1.3.0"`])]));
    expect(miss.verdict).to.equal("miss");
    expect(miss.findings[0]).to.match(/^GOV-SVM-012 \[gov-builtin\/list-membership\]: .*left-pad/);
    expect(run("list-membership", { when: "**/package.json", list: "policies/approved-technologies.md" },
      pr([file("package.json", [`"express": "^4.0.0"`])])).verdict).to.equal("pass");
  });

  it("list-membership: an unreadable list is cannot-tell, never pass", () => {
    const r = run("list-membership", { list: "policies/missing.md" }, pr([file("package.json", [`"left-pad": "1"`])]));
    expect(r.verdict).to.equal("cannot-tell");
    expect(r.findings.join()).to.match(/could not be read/);
  });

  it("content-forbidden judges ADDED lines only", () => {
    const pre = file("a.env", ["harmless"], "AKIA_OLD_KEY\nharmless");
    expect(run("content-forbidden", { pattern: "AKIA" }, pr([pre])).verdict).to.equal("pass");
    expect(run("content-forbidden", { pattern: "AKIA" }, pr([file("a.env", ["AKIA_NEW"])])).verdict).to.equal("miss");
  });

  it("a bad regular expression is cannot-tell", () => {
    expect(run("content-forbidden", { pattern: "(" }, pr([file("a", ["x"])])).verdict).to.equal("cannot-tell");
  });

  it("content-required, file-required, frontmatter-required, naming, path-scope over a changeset", () => {
    expect(run("content-required", { when: "**/*.ts", pattern: "SPDX", within_lines: 3 }, pr([file("a.ts", ["x"], "x")])).verdict).to.equal("miss");
    expect(run("file-required", { when: "src/**", require: ["test/**"] }, pr([file("src/a.ts", ["x"])])).verdict).to.equal("miss");
    expect(run("file-required", { when: "src/**", require: "test/**" }, pr([file("src/a.ts", ["x"]), file("test/a.ts", ["y"])])).verdict).to.equal("pass");
    expect(run("frontmatter-required", { when: "**/*.md", keys: ["owner"] }, pr([file("a.md", ["x"], "---\ntitle: t\n---\n")])).verdict).to.equal("miss");
    expect(run("naming", { subject: "branch", pattern: "^BRNCH-" }, pr([], { branch: "feature/x" })).verdict).to.equal("miss");
    expect(run("path-scope", { writable: ["projects/**"] }, pr([file("knowledge/x.md", ["x"])])).verdict).to.equal("miss");
  });

  it("naming subject=branch with no branch known is cannot-tell", () => {
    expect(run("naming", { subject: "branch", pattern: "^B" }, pr([])).verdict).to.equal("cannot-tell");
  });

  it("a gov verb runs against the workspace view", () => {
    const verb: EventContext = { resource: "gov.verb", event: "close", payload: { workspace: ws({ "k/close.md": "## Done\n" }) } };
    expect(run("file-required", { require: ["k/close.md"] }, verb).verdict).to.equal("pass");
    expect(run("content-required", { file: "k/close.md", sections: ["## Risks"] }, verb).verdict).to.equal("miss");
  });

  it("a changeset-only predicate at a verb is cannot-tell", () => {
    const verb: EventContext = { resource: "gov.verb", event: "close", payload: { workspace: ws({}) } };
    expect(run("content-forbidden", { pattern: "x" }, verb).verdict).to.equal("cannot-tell");
  });

  it("a payload with neither a changeset nor a workspace is cannot-tell", () => {
    const r = run("naming", { pattern: "x" }, { resource: "vcs.code-repo", event: "push", payload: {} });
    expect(r.verdict).to.equal("cannot-tell");
  });

  it("test-suite: a passing tagged test passes; none tagged or a failure misses; no results is cannot-tell", () => {
    const ctx = (tests: unknown): EventContext => ({ resource: "vcs.framework-repo", event: "pull_request", payload: tests === undefined ? {} : { tests } });
    expect(run("test-suite", {}, ctx([{ title: "GOV-SVM-012 refuses x", state: "passed" }])).verdict).to.equal("pass");
    expect(run("test-suite", {}, ctx([{ title: "GOV-SVM-0123 other", state: "passed" }])).verdict).to.equal("miss");
    expect(run("test-suite", {}, ctx([{ title: "GOV-SVM-012 a", state: "passed" }, { title: "GOV-SVM-012 b", state: "failed" }])).verdict).to.equal("miss");
    expect(run("test-suite", {}, ctx([{ title: "GOV-SVM-012 a", state: "pending" }])).verdict).to.equal("cannot-tell");
    expect(run("test-suite", {}, ctx(undefined)).verdict).to.equal("cannot-tell");
  });

  it("rules-propose is a stub: cannot-tell", () => {
    expect(run("rules-propose", {}, pr([])).verdict).to.equal("cannot-tell");
  });

  it("an unknown builtin is cannot-tell", () => {
    expect(run("nonesuch", {}, pr([])).verdict).to.equal("cannot-tell");
  });
});

describe("check engine — CheckRunner", () => {
  const listCheck = bind("vcs.code-repo", "pull_request", "gov-builtin/list-membership", { when: "**/package.json", list: "policies/approved-technologies.md" });
  const leftPad = pr([file("package.json", [`"left-pad": "1.0.0"`])]);

  it("runs the in-force row's matching binding: fail", () => {
    const runner = createCheckRunner({ rules: ruleset([row("GOV-SVM-012", [listCheck])]), readDefault });
    const v = runner.run("GOV-SVM-012", leftPad);
    expect(v.verdict).to.equal("fail");
    expect(v.findings.join()).to.match(/left-pad/);
  });

  it("finds framework rows too, and ignores closed revisions", () => {
    const closed = row("GOV-FRM-001", [listCheck], { end: { version: "1.1.0", date: "2026-10-06" } });
    const open = row("GOV-FRM-001", [], { start: { version: "1.1.0", date: "2026-10-06" } });
    const runner = createCheckRunner({ rules: ruleset([], [closed, open]), readDefault });
    const v = runner.run("GOV-FRM-001", leftPad);
    expect(v.verdict).to.equal("cannot-tell"); // the in-force revision binds nothing on this event
  });

  it("on_miss=warn reports the miss but does not fail", () => {
    const warn = { ...listCheck, on_miss: "warn" as const };
    const v = createCheckRunner({ rules: ruleset([row("GOV-SVM-012", [warn])]), readDefault }).run("GOV-SVM-012", leftPad);
    expect(v.verdict).to.equal("pass");
    expect(v.findings.join()).to.match(/warn: .*left-pad/);
  });

  it("a fail outranks a cannot-tell; a cannot-tell outranks a pass", () => {
    const broken = bind("vcs.code-repo", "pull_request", "gov-builtin/list-membership", { list: "policies/missing.md" });
    const ok = bind("vcs.code-repo", "pull_request", "gov-builtin/path-scope", { writable: "**" });
    const r1 = createCheckRunner({ rules: ruleset([row("GOV-SVM-012", [broken, listCheck])]), readDefault }).run("GOV-SVM-012", leftPad);
    expect(r1.verdict).to.equal("fail");
    const r2 = createCheckRunner({ rules: ruleset([row("GOV-SVM-012", [broken, ok])]), readDefault }).run("GOV-SVM-012", leftPad);
    expect(r2.verdict).to.equal("cannot-tell");
  });

  it("only bindings on the event's resource and name run", () => {
    const onPush = bind("vcs.code-repo", "push", "gov-builtin/list-membership", { list: "policies/approved-technologies.md" });
    const v = createCheckRunner({ rules: ruleset([row("GOV-SVM-012", [onPush, bind("vcs.code-repo", "pull_request", "gov-builtin/path-scope", { writable: "**" })])]), readDefault }).run("GOV-SVM-012", leftPad);
    expect(v.verdict).to.equal("pass");
  });

  it("unknown id, no rules, no matching binding, unknown action, bad params: cannot-tell", () => {
    const rs = ruleset([row("GOV-SVM-012", [listCheck]), row("GOV-SVM-013", [bind("vcs.code-repo", "pull_request", "gov-builtin/nonesuch")]),
      row("GOV-SVM-014", [bind("vcs.code-repo", "pull_request", "gov-builtin/list-membership", { lst: "x" })])]);
    const runner = createCheckRunner({ rules: rs, readDefault });
    const ct = (id: string, ctx: EventContext = leftPad) => runner.run(id, ctx);
    expect(ct("GOV-SVM-999").verdict).to.equal("cannot-tell");
    expect(ct("GOV-SVM-012", { ...leftPad, event: "push" }).verdict).to.equal("cannot-tell");
    expect(ct("GOV-SVM-013").verdict).to.equal("cannot-tell");
    expect(ct("GOV-SVM-014").findings.join()).to.match(/unknown parameter "lst"/);
    expect(createCheckRunner({ rules: null, readDefault }).run("GOV-SVM-012", leftPad).verdict).to.equal("cannot-tell");
  });

  it("an llm judge is cannot-tell, never pass", () => {
    const cat: Catalog = { ...CATALOG, actions: [...CATALOG.actions, { id: "llm/tone", tool: "llm" }] };
    const r = row("GOV-SVM-020", [bind("vcs.code-repo", "push", "llm/tone")]);
    const v = createCheckRunner({ rules: ruleset([r], [], cat), readDefault }).run("GOV-SVM-020", { resource: "vcs.code-repo", event: "push", payload: { changed: [] } });
    expect(v.verdict).to.equal("cannot-tell");
    expect(v.findings.join()).to.match(/LLM judge not implemented/);
  });

  it("a bash / python / gh-action tool is cannot-tell in this slice", () => {
    const cat: Catalog = { ...CATALOG, actions: [...CATALOG.actions, { id: "bash/lint", tool: "bash" }] };
    const v = createCheckRunner({ rules: ruleset([row("GOV-SVM-021", [bind("vcs.code-repo", "pull_request", "bash/lint")])], [], cat), readDefault })
      .run("GOV-SVM-021", leftPad);
    expect(v.verdict).to.equal("cannot-tell");
  });

  it("a predicate that throws is cannot-tell, not a crash", () => {
    const naming = bind("gov.verb", "close", "gov-builtin/naming", { subject: "branch", pattern: "(" });
    const v = createCheckRunner({ rules: ruleset([row("GOV-SVM-030", [naming])]), readDefault })
      .run("GOV-SVM-030", { resource: "gov.verb", event: "close", payload: { workspace: ws({}, { branch: "b" }) } });
    expect(v.verdict).to.equal("cannot-tell");
  });
});

describe("check engine — GitHub Actions renderer", () => {
  const r = githubActionsRenderer();
  const b = (id: string, resource: string, event: string) => ({ id, check: bind(resource, event, "gov-builtin/naming", { pattern: "x" }) });

  it("is the github-actions renderer", () => {
    expect(r.renderer).to.equal("github-actions");
    expect(WORKFLOW_PATH).to.equal(".github/workflows/gov-checks.yml");
  });

  it("renders nothing when nothing is bound", () => {
    expect(r.render([])).to.deep.equal([]);
  });

  it("one workflow, triggers on the union of events, one job per rule·event, sorted", () => {
    const files = r.render([
      b("GOV-SVM-012", "vcs.code-repo", "push"),
      b("GOV-FRM-061", "vcs.code-repo", "pull_request"),
      b("GOV-SVM-012", "vcs.code-repo", "pull_request"),
      { id: "GOV-SVM-012", check: bind("vcs.code-repo", "pull_request", "gov-builtin/path-scope", { writable: "**" }) }, // same rule·event: one job
    ]);
    expect(files).to.have.length(1);
    expect(files[0]!.path).to.equal(".github/workflows/gov-checks.yml");
    expect(files[0]!.text).to.equal(EXPECTED_CODE_REPO);
  });

  it("is byte-stable whatever order the bindings arrive in", () => {
    const list = [b("GOV-SVM-012", "vcs.code-repo", "push"), b("GOV-FRM-061", "vcs.code-repo", "pull_request"), b("GOV-SVM-012", "vcs.code-repo", "pull_request")];
    expect(r.render([...list].reverse())).to.deep.equal(r.render(list));
  });

  it("renders issue events as `issues` types, and names an event it cannot trigger on", () => {
    const files = r.render([b("GOV-SVM-040", "pms.issue", "closed"), b("GOV-SVM-041", "pms.issue", "opened"), b("GOV-SVM-042", "pms.issue", "transferred_to_mars")]);
    expect(files[0]!.text).to.equal(EXPECTED_ISSUES);
  });

  it("renderWorkflow over several resources of one repo unions their triggers", () => {
    const files = renderWorkflow([b("GOV-SVM-001", "vcs.gov-repo", "pull_request"), b("GOV-SVM-002", "pms.issue", "closed")]);
    expect(files).to.have.length(1);
    expect(files[0]!.text).to.contain("  issues:\n    types: [closed]\n  pull_request:\n");
    expect(files[0]!.text).to.contain("--resource vcs.gov-repo --event pull_request");
    expect(files[0]!.text).to.contain("--resource pms.issue --event closed");
  });

  it("an event with no GitHub trigger alone renders no workflow", () => {
    expect(r.render([b("GOV-SVM-042", "pms.issue", "transferred_to_mars")])).to.deep.equal([]);
  });

  it("a CODE repo's workflow reads the governance repo through the org's GitHub App — no personal token, no stopgap", () => {
    const files = githubActionsRenderer({ govCheckout: { repository: "acme/acme-gov" } }).render([b("GOV-FRM-061", "vcs.code-repo", "pull_request")]);
    expect(files[0]!.text).to.equal(`${HEADER}
on:
  pull_request:

permissions:
  contents: read

jobs:
  GOV-FRM-061_pull_request:
    name: GOV-FRM-061 · pull_request
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Mint a read-only token for the governance repository
        id: gov-token
        uses: actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3.2.0
        with:
          client-id: \${{ secrets.GOV_APP_CLIENT_ID }}
          private-key: \${{ secrets.GOV_APP_PRIVATE_KEY }}
          owner: acme
          repositories: acme-gov
          permission-contents: read
      - uses: actions/checkout@v4
        with:
          repository: acme/acme-gov
          path: .gov
          fetch-depth: 0
          token: \${{ steps.gov-token.outputs.token }}
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
      - name: Install the gov CLI
        run: npm install -g @svayam-opensource/gov
      - name: gov check run GOV-FRM-061
        run: gov check run GOV-FRM-061 --resource vcs.code-repo --event pull_request --gov-home .gov --repo-dir .
`);
    expect(files[0]!.text).to.not.contain("GOV_REPO_TOKEN").and.not.contain("app-id:");
  });

  it("the governance repo's own workflow mints nothing — GITHUB_TOKEN already reads the repository it runs in", () => {
    const text = githubActionsRenderer().render([b("GOV-FRM-061", "vcs.gov-repo", "push")])[0]!.text;
    expect(text).to.not.contain("create-github-app-token").and.not.contain("secrets.");
    expect(text).to.contain("GH_TOKEN: ${{ github.token }}");
  });

  it("a pinned gov package is honoured", () => {
    const files = githubActionsRenderer({ govPackage: "@svayam-opensource/gov@1.2.3" }).render([b("GOV-SVM-001", "vcs.code-repo", "push")]);
    expect(files[0]!.text).to.contain("npm install -g @svayam-opensource/gov@1.2.3\n");
  });
});

const HEADER = `# GENERATED by gov from the rule stores — do not edit; re-render instead.
# Each job runs one rule's checks for one event through \`gov check run <GOV-ID>\`. Rules are read from the
# default branch, never from the branch under review.
name: gov-checks
`;
// An observe event (push, issues) may open a violation record, so its job gets \`issues: write\` and the token.
const observe = (event: string) => event !== "pull_request";
const job = (id: string, resource: string, event: string, cond: string) => `  ${id}_${event}:
    name: ${id} · ${event}
    if: ${cond}
${observe(event) ? "    permissions:\n      contents: read\n      issues: write\n" : ""}    runs-on: ubuntu-latest
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
${observe(event) ? "        env:\n          GH_TOKEN: ${{ github.token }}\n" : ""}        run: gov check run ${id} --resource ${resource} --event ${event} --gov-home .
`;
const EXPECTED_CODE_REPO = `${HEADER}
on:
  pull_request:
  push:

permissions:
  contents: read

jobs:
${job("GOV-FRM-061", "vcs.code-repo", "pull_request", "github.event_name == 'pull_request'")}${job("GOV-SVM-012", "vcs.code-repo", "pull_request", "github.event_name == 'pull_request'")}${job("GOV-SVM-012", "vcs.code-repo", "push", "github.event_name == 'push'")}`;
const EXPECTED_ISSUES = `${HEADER}# not rendered: GOV-SVM-042 on pms.issue · transferred_to_mars — GitHub Actions has no trigger for it (cannot-tell)

on:
  issues:
    types: [closed, opened]

permissions:
  contents: read

jobs:
${job("GOV-SVM-040", "pms.issue", "closed", "github.event_name == 'issues' && github.event.action == 'closed'")}${job("GOV-SVM-041", "pms.issue", "opened", "github.event_name == 'issues' && github.event.action == 'opened'")}`;
