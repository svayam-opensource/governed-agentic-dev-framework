// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// W1 — THE STORES, READ FROM THE DEFAULT BRANCH, AND THE ONE ISSUER OF IDS (rule-model-design.md Q5, Q7, Q8, Q17).
//
// What is pinned here is the difference between three answers that a careless reader collapses into one:
// "this org has no rules yet" (an empty list), "these rules are broken" (rows plus diagnostics), and "gov could
// not tell" (null, with the reason). Only the first is ever a pass.
import { expect } from "chai";
import {
  RULE_STORE_PATHS, loadRuleStores, createRuleStoreReader, createIdIssuer, idIssuerAt, everIssuedIds,
} from "../../../src/rules/model/store-io.js";
import type { GitRead } from "../../../src/cli/policy-gate-io.js";

const FRM_ROWS = `
- id: GOV-FRM-001
  source: { doc: framework/docs/specs/framework-specification.md, section: "1", sha: aaa111 }
  expectation: Agents stop when a C01 rule would be broken.
  actor: [agent]
  level: C01
  start: { version: 1.0.0, date: 2026-10-01 }
  end: { version: 1.1.0, date: 2026-10-05 }
- id: GOV-FRM-001
  source: { doc: framework/docs/specs/framework-specification.md, section: "1", sha: bbb222 }
  expectation: Agents stop and report when a C01 rule would be broken.
  actor: [agent]
  level: C01
  start: { version: 1.1.0, date: 2026-10-05 }
  end: null
- id: GOV-FRM-009
  source: { doc: framework/docs/specs/framework-specification.md, section: "4", sha: ccc333 }
  expectation: gov issues every GOV id.
  actor: [gov-client]
  level: C01
  start: { version: 1.0.0, date: 2026-10-01 }
  end: { version: 1.1.0, date: 2026-10-05 }
`;

const ORG_ROWS = `
- id: GOV-SVM-012
  source: { doc: policies/org-policy.md, section: "3.1", sha: a1b2c3 }
  expectation: Everyone uses only technologies listed in approved-technologies.md.
  actor: [everyone]
  level: C02
  checks:
    - on: { resource: vcs.code-repo, event: pull_request }
      action: gov-builtin/list-membership
      on_miss: fail
  start: { version: 1.4.0, date: 2026-10-06, pr: 87 }
  end: null
`;

const FRM_CATALOG = `
resources:
  - id: vcs.code-repo
    renderer: github-actions
    events: [{ name: pull_request, mode: gate }]
tools: [{ id: gov-builtin }]
actions: [{ id: gov-builtin/list-membership, tool: gov-builtin }]
`;

const ORG_CATALOG = `
resources:
  - id: pms.issue
    events: [{ name: closed, mode: observe }]
tools: [{ id: bash }]
actions: [{ id: bash/spdx-header, tool: bash, reviewed: { by: "@checker", pr: 12 } }]
`;

const ORG_CONFIG = 'org_name: "Svayam"\norg_slug: "SVM"\n';

/** A repository at one ref, as `git ls-tree` / `git show` see it. `null` for the whole repo = git cannot answer. */
function fakeGit(files: Record<string, string> | null, calls: string[][] = []): GitRead {
  return (_repo, args) => {
    calls.push([...args]);
    if (files === null) return null;
    if (args[0] === "ls-tree") {
      const roots = args.slice(args.indexOf("--") + 1);
      return Object.keys(files).filter((p) => roots.some((r) => p === r || p.startsWith(`${r}/`))).join("\n");
    }
    if (args[0] === "show") {
      const [, rel] = args[1]!.split(":");
      return files[rel!] ?? null;
    }
    return null;
  };
}

const full = (): Record<string, string> => ({
  [RULE_STORE_PATHS.frameworkRules]: FRM_ROWS,
  [RULE_STORE_PATHS.frameworkCatalog]: FRM_CATALOG,
  [RULE_STORE_PATHS.orgRules]: ORG_ROWS,
  [RULE_STORE_PATHS.orgCatalog]: ORG_CATALOG,
  [RULE_STORE_PATHS.orgVersion]: "1.4.0\n",
  [RULE_STORE_PATHS.orgConfig]: ORG_CONFIG,
});

describe("rule model — W1 store reader", () => {
  it("reads both stores, the merged catalog, the org version and the org scope — all at the ref asked for", () => {
    const calls: string[][] = [];
    const r = loadRuleStores(fakeGit(full(), calls), "/repo", "origin/main");
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.set.framework.map((x) => x.id)).to.deep.equal(["GOV-FRM-001", "GOV-FRM-001", "GOV-FRM-009"]);
    expect(r.set.org.map((x) => x.id)).to.deep.equal(["GOV-SVM-012"]);
    expect(r.set.orgScope).to.equal("SVM");
    expect(r.set.orgVersion).to.equal("1.4.0");
    expect(r.set.catalog.resources.map((x) => x.id)).to.deep.equal(["vcs.code-repo", "pms.issue"]);
    expect(r.set.catalog.actions.map((x) => x.id)).to.deep.equal(["gov-builtin/list-membership", "bash/spdx-header"]);
    expect(r.diagnostics, "a valid pair of stores has nothing to say").to.deep.equal([]);
    // Every read names the ref — never the worktree (GOV-FRM-456: governance is what the default branch says).
    for (const c of calls.filter((x) => x[0] === "show")) expect(c[1]).to.match(/^origin\/main:/);
    expect(calls.some((c) => c[0] === "ls-tree" && c.includes("origin/main"))).to.equal(true);
  });

  // W2-Q5: RuleSet.roles carries the framework's two roles from org-config and every role in the org's role list,
  // read at the SAME ref as the rules — a branch cannot name itself a role's holder.
  it("loads the org's role list into RuleSet.roles, beside the Policy Owner and Check Owner from org-config", () => {
    const files = full();
    files[RULE_STORE_PATHS.orgConfig] = `${ORG_CONFIG}policy_owner_github: "@polly"\ncheck_owner_github: "chuck"\nlegal_owner_github: "@stale"\n`;
    files[RULE_STORE_PATHS.roleList] = "# Reps\n\n| Role | GitHub handle | Owns |\n|---|---|---|\n| Data Owner | @dana | `knowledge/data/` |\n| Legal Owner | | |\n";
    const calls: string[][] = [];
    const r = loadRuleStores(fakeGit(files, calls), "/repo", "origin/main");
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.set.roles).to.deep.equal({ "Policy Owner": "@polly", "Check Owner": "chuck", "Data Owner": "@dana", "Legal Owner": "" });
    expect(calls.some((c) => c[0] === "show" && c[1] === `origin/main:${RULE_STORE_PATHS.roleList}`)).to.equal(true);
  });

  it("no role table at the ref → the legacy *_owner_github keys, for one release", () => {
    const files = full();
    files[RULE_STORE_PATHS.orgConfig] = `${ORG_CONFIG}policy_owner_github: "@polly"\ndata_arch_owner_github: "@dana"\n`;
    const r = loadRuleStores(fakeGit(files), "/repo", "main");
    expect(r.ok && r.set.roles).to.deep.include({ "Policy Owner": "@polly", "Check Owner": "@polly", "Data Architecture Owner": "@dana" });
  });

  it("an org with no rules yet is an EMPTY org store, not a failure — and its version defaults to 0.0.0", () => {
    const files = full();
    delete files[RULE_STORE_PATHS.orgRules];
    delete files[RULE_STORE_PATHS.orgCatalog];
    delete files[RULE_STORE_PATHS.orgVersion];
    const r = loadRuleStores(fakeGit(files), "/repo", "main");
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.set.org).to.deep.equal([]);
    expect(r.set.orgVersion).to.equal("0.0.0");
    expect(r.set.catalog.resources.map((x) => x.id), "the framework catalog alone").to.deep.equal(["vcs.code-repo"]);
    expect(r.diagnostics).to.deep.equal([]);
  });

  it("git that cannot answer is null — 'could not tell' is never the same as 'no rules'", () => {
    const r = loadRuleStores(fakeGit(null), "/repo", "main");
    expect(r.ok).to.equal(false);
    if (r.ok) return;
    expect(r.reason).to.match(/could not list/);
    expect(createRuleStoreReader(fakeGit(null), "/repo").load("main")).to.equal(null);
  });

  it("a file the listing names but git cannot show is 'could not tell', not an empty store", () => {
    const git: GitRead = (repo, args) =>
      args[0] === "show" && args[1]!.endsWith(RULE_STORE_PATHS.orgRules) ? null : fakeGit(full())(repo, args);
    const r = loadRuleStores(git, "/repo", "main");
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.include(RULE_STORE_PATHS.orgRules);
  });

  it("a store that does not parse is 'could not tell', with the file named", () => {
    const files = { ...full(), [RULE_STORE_PATHS.orgRules]: "id: not-a-list\n" };
    const r = loadRuleStores(fakeGit(files), "/repo", "main");
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.include(RULE_STORE_PATHS.orgRules);
  });

  it("no org_slug means no org scope: could not tell", () => {
    const files = { ...full(), [RULE_STORE_PATHS.orgConfig]: 'org_name: "x"\norg_slug: ""\n' };
    const r = loadRuleStores(fakeGit(files), "/repo", "main");
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.match(/org_slug/);
  });

  it("an org_slug of FRM is refused — the framework's scope is reserved (Q7)", () => {
    const files = { ...full(), [RULE_STORE_PATHS.orgConfig]: 'org_slug: "FRM"\n' };
    const r = loadRuleStores(fakeGit(files), "/repo", "main");
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.match(/reserved/);
  });

  it("a lowercase org_slug is read as its uppercase scope — ids carry the scope in capitals", () => {
    const files = { ...full(), [RULE_STORE_PATHS.orgConfig]: 'org_slug: "svm"\n' };
    const r = loadRuleStores(fakeGit(files), "/repo", "main");
    expect(r.ok && r.set.orgScope).to.equal("SVM");
  });

  it("validates BOTH stores, each against its own scope, and returns the diagnostics beside the rows", () => {
    const files = {
      ...full(),
      // An org row wearing the framework's scope, and a framework row claiming two revisions in force.
      [RULE_STORE_PATHS.orgRules]: ORG_ROWS.replace("GOV-SVM-012", "GOV-FRM-012"),
      [RULE_STORE_PATHS.frameworkRules]: FRM_ROWS.replace("end: { version: 1.1.0, date: 2026-10-05 }\n- id: GOV-FRM-001", "end: null\n- id: GOV-FRM-001"),
    };
    const r = loadRuleStores(fakeGit(files), "/repo", "main");
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    const by = (store: string) => r.diagnostics.filter((d) => d.store === store).map((d) => d.kind);
    expect(by("org")).to.include("wrong-scope");
    expect(by("framework")).to.include("two-in-force");
  });

  it("checks the in-force rows' bindings against the MERGED catalog", () => {
    const files = { ...full(), [RULE_STORE_PATHS.orgRules]: ORG_ROWS.replace("gov-builtin/list-membership", "bash/nope") };
    const r = loadRuleStores(fakeGit(files), "/repo", "main");
    expect(r.ok).to.equal(true);
    if (r.ok) expect(r.diagnostics.map((d) => d.kind)).to.deep.equal(["unknown-action"]);
  });

  it("an org store with rules but no policies/VERSION is noted — its rows cite a version nobody recorded", () => {
    const files = full();
    delete files[RULE_STORE_PATHS.orgVersion];
    const r = loadRuleStores(fakeGit(files), "/repo", "main");
    expect(r.ok).to.equal(true);
    if (r.ok) expect(r.diagnostics.map((d) => d.kind)).to.deep.equal(["missing-version"]);
  });

  it("a missing framework store is a noted absence — the org has not upgraded to the rule model yet", () => {
    const files = full();
    delete files[RULE_STORE_PATHS.frameworkRules];
    const r = loadRuleStores(fakeGit(files), "/repo", "main");
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.set.framework).to.deep.equal([]);
    expect(r.diagnostics.map((d) => d.kind)).to.include("missing-framework-store");
  });
});

describe("rule model — W1 id issuer", () => {
  it("every id ever present counts, retired revisions included, in both stores", () => {
    const r = loadRuleStores(fakeGit(full()), "/repo", "main");
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(everIssuedIds(r.set)).to.deep.equal(["GOV-FRM-001", "GOV-FRM-009", "GOV-SVM-012"]);
    const issuer = idIssuerAt(r.set);
    // GOV-FRM-009 is retired (closed, no successor) — its number is still never handed out again.
    expect(issuer.next("FRM")).to.equal("GOV-FRM-010");
    expect(issuer.next("SVM")).to.equal("GOV-SVM-013");
  });

  it("never issues the same id twice in one run — a proposal adding three rules gets three numbers", () => {
    const issuer = createIdIssuer(["GOV-SVM-004"]);
    expect([issuer.next("SVM"), issuer.next("SVM"), issuer.next("SVM")]).to.deep.equal(["GOV-SVM-005", "GOV-SVM-006", "GOV-SVM-007"]);
    expect(issuer.next("ACME")).to.equal("GOV-ACME-001");
  });

  it("refuses a malformed scope rather than issue an id nobody can parse back", () => {
    expect(() => createIdIssuer([]).next("svm")).to.throw(/scope/);
  });
});
