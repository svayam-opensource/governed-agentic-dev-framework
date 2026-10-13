// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
// bridge: deleted in D01 (PRJ-121 intent 01, spec §4.1)
/**
 * COMMIT 4 OF THE BRIDGE UPGRADE: PROPOSED prose — droppable (PRJ-121 intent 01, B08; rulings Q2, T9).
 *
 * The framework-superseded policy is retired, and the organization's own clauses in it (pol-aliases.yaml: `GOV-SVM`
 * rows and `org: pending` entries) are proposed into policies/org-policy.md and policies/build/policy.md. Exact old
 * paths in policies/**\/*.md are rewritten to the new ones. Every substitution is listed in the PR body. The whole
 * commit can be dropped and the tree is still valid.
 */
import { expect } from "chai";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { runUpgradePr } from "../../src/maintain/upgrade-run.js";
import { commitSubject } from "../../src/maintain/upgrade-commits.js";
import { orgClauses, applySubstitutions, OLD_PATH_REWRITES, PROPOSED_HEADING } from "../../src/maintain/bridge/prose.js";
import { parsePolAliases } from "../../src/rules/model/pol-aliases.js";
import { doctor } from "../../src/maintain/doctor.js";
import { contentLayoutOf, staleArtifactsIn } from "../../src/maintain/upgrade-sync.js";
import { GOVERNANCE_PATH } from "../../src/config/governance.js";
import { ROLE_LIST_PATH } from "../../src/config/role-list.js";
import { fixtureFiles, fixtureRepo, upgradeFixture, commitChanges, SHIPPED_CONTENT, tmpDir, type FixtureRepo } from "../helpers/upgrade-fixture.js";

const gitOk = (): boolean => { try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } };
const run = (dir: string, openPr: (a: { body: string }) => string) => runUpgradePr(SHIPPED_CONTENT, dir, { userHome: tmpDir("govb8-home-"), openPr });
const ALIASES = parsePolAliases(fs.readFileSync(path.join(SHIPPED_CONTENT, "framework", "rules", "pol-aliases.yaml"), "utf8")).aliases;
const POLICY = fixtureFiles("layout-1.0").get("knowledge/policies/agentic-development-policy.md")!;

/** `gov doctor`'s pure check on a working tree, with the machine taken as ready (only the tree is under test). */
function doctorOn(dir: string) {
  const read = (rel: string): string | null => (fs.existsSync(path.join(dir, rel)) ? fs.readFileSync(path.join(dir, rel), "utf8") : null);
  const exists = (rel: string): boolean => fs.existsSync(path.join(dir, rel));
  const version = fs.readFileSync(path.join(SHIPPED_CONTENT, "VERSION"), "utf8").trim();
  return doctor({
    gitPresent: true, ghPresent: true, ghAuthenticated: true, ghScopes: ["repo", "project", "read:org", "workflow"],
    gitIdentity: { name: "t", email: "t@example.test" },
    resolve: { ok: true, home: dir, org: "example-org", via: "cwd" }, activeOrg: "example-org", registeredOrgs: ["example-org"],
    cliVersion: version, workspaceChecked: true, contentVersion: read("VERSION")?.trim() ?? null,
    contentLayout: contentLayoutOf(exists), staleArtifacts: staleArtifactsIn(true, exists),
    orgConfigText: read("org-config.yaml"), governanceText: read(GOVERNANCE_PATH), roleListText: read(ROLE_LIST_PATH), codeownersText: read("CODEOWNERS"),
  });
}

describe("bridge prose — what is proposed (B08)", () => {
  it("finds the org's clauses in the policy's clause index through pol-aliases: GOV-SVM ones and org-pending ones, never the framework's", () => {
    const c = orgClauses(POLICY, ALIASES);
    expect(c.found.map((x) => x.pol)).to.deep.equal(["POL-006", "POL-033", "POL-137", "POL-143", "POL-159", "POL-160", "POL-161", "POL-162"]);
    expect(c.found.find((x) => x.pol === "POL-033")?.gov).to.equal("GOV-SVM-033");
    expect(c.found.find((x) => x.pol === "POL-159")?.gov).to.equal(null);
    expect(c.found.map((x) => x.pol)).not.to.include.members(["POL-001", "POL-011"]);
    expect(c.missing).to.include("POL-427"); // a GOV-SVM clause written elsewhere (not in this policy) — named, not invented
  });

  it("places a clause by the section that cites it: §4–§7 (how the org builds) → build/policy.md, the rest → org-policy.md", () => {
    const c = orgClauses(POLICY, ALIASES).found;
    const to = (pol: string) => c.find((x) => x.pol === pol)?.to;
    expect(to("POL-033")).to.equal("policies/org-policy.md");
    expect(to("POL-137")).to.equal("policies/build/policy.md");
    expect(to("POL-159")).to.equal("policies/org-policy.md");
  });

  it("rewrites an exact old path only — never inside a longer path, never a prefix", () => {
    const r = applySubstitutions("see `knowledge/policies/roles.md` and knowledge/policies/roles.md.bak and x/knowledge/policies/roles.md", OLD_PATH_REWRITES);
    expect(r.text).to.equal("see `policies/common/authorized-representatives.md` and knowledge/policies/roles.md.bak and x/knowledge/policies/roles.md");
    expect(r.made).to.deep.equal([{ from: "knowledge/policies/roles.md", to: "policies/common/authorized-representatives.md", count: 1 }]);
  });
});

(gitOk() ? describe : describe.skip)("bridge upgrade, commit 4 — proposed prose (B08)", function () {
  this.timeout(60_000);
  let repo: FixtureRepo;
  let u: ReturnType<typeof upgradeFixture>;
  let c4: string;
  before(() => {
    repo = fixtureRepo("layout-1.0");
    u = upgradeFixture(repo, run);
    const version = u.branch.replace(/^gov-upgrade-/, "");
    const last = u.commits[u.commits.length - 1]!;
    expect(last.subject, u.out).to.equal(commitSubject("proposed-prose", version));
    c4 = last.sha;
  });

  it("each GOV-SVM clause in the policy appears exactly once across org-policy.md and build/policy.md", () => {
    const text = ["policies/org-policy.md", "policies/build/policy.md"].map((p) => repo.g("show", `${c4}:${p}`)).join("\n");
    for (const gov of ["GOV-SVM-006", "GOV-SVM-033", "GOV-SVM-137", "GOV-SVM-143"]) {
      expect(text.split(gov).length - 1, gov).to.equal(1);
    }
  });

  it("the proposed clauses carry no token: each <TOKEN> in a clause is filled from org-config.yaml", () => {
    const text = ["policies/org-policy.md", "policies/build/policy.md"].map((p) => repo.g("show", `${c4}:${p}`)).join("\n");
    const proposed = text.split(PROPOSED_HEADING).slice(1).join("\n");
    expect(proposed).to.match(/GOV-SVM-033/);
    expect(proposed).not.to.match(/<[A-Z][A-Z_]{2,}>/);
  });

  it("org-policy.md and build/policy.md, whole, carry no token (L07 fills them)", () => {
    const text = ["policies/org-policy.md", "policies/build/policy.md"].map((p) => repo.g("show", `${c4}:${p}`)).join("\n");
    expect(text).not.to.match(/<[A-Z][A-Z_]{2,}>/);
  });

  it("retires the framework-superseded policy in the same droppable commit", () => {
    const changes = commitChanges(repo, c4);
    expect(changes.get("knowledge/policies/agentic-development-policy.md")).to.equal("D");
    expect(changes.get("knowledge/policies/agentic-development-procedures.md")).to.equal("D");
    expect(changes.get("knowledge/policies/procedures/agentic-development-procedures.md")).to.equal("D");
  });

  it("the substitution list in the PR body equals the diff: applying exactly those to commit 3 gives commit 4", () => {
    const listed = u.body.slice(u.body.indexOf("## Substitutions")).split("\n## ")[0]!.split("\n")
      .map((l) => /^- `([^`]+)`: `([^`]+)` → `([^`]+)`(?: \((\d+)×\))?$/.exec(l)).filter((m): m is RegExpExecArray => !!m)
      .map((m) => ({ file: m[1]!, from: m[2]!, to: m[3]!, count: Number(m[4] ?? 1) }));
    expect(listed.length, u.body).to.be.greaterThan(0);
    const changed = [...commitChanges(repo, c4)].filter(([p, st]) => st === "M" && p.startsWith("policies/") && p.endsWith(".md")).map(([p]) => p);
    for (const file of new Set([...changed, ...listed.map((l) => l.file)])) {
      const before = repo.g("show", `${c4}~1:${file}`) + "\n";
      const after = repo.g("show", `${c4}:${file}`) + "\n";
      const subs = listed.filter((l) => l.file === file);
      const r = applySubstitutions(before, subs.map((s) => ({ from: s.from, to: s.to })));
      expect(r.made.map((m) => m.count), `${file}: listed counts`).to.deep.equal(subs.map((s) => s.count));
      // what is left of the diff is only the proposed section gov appended
      expect(after.startsWith(r.text.trimEnd()), `${file}: the diff is the listed substitutions (+ the appended proposal)`).to.equal(true);
      const rest = after.slice(r.text.trimEnd().length).trim();
      if (rest) expect(rest.startsWith(PROPOSED_HEADING), `${file}: ${rest.slice(0, 80)}`).to.equal(true);
    }
  });

  it("dropping commit 4 (git revert) leaves a valid tree: gov doctor reports no failure, and the policy is back", () => {
    repo.g("checkout", "-q", u.branch);
    try {
      repo.g("revert", "--no-edit", c4);
      const report = doctorOn(repo.dir);
      expect(report.diagnostics.filter((d) => d.status === "fail"), JSON.stringify(report.diagnostics, null, 1)).to.deep.equal([]);
      expect(fs.existsSync(path.join(repo.dir, "knowledge/policies/agentic-development-policy.md"))).to.equal(true);
    } finally { repo.g("checkout", "-q", "main"); }
  });

  it("with commit 4 kept the tree is valid too", () => {
    repo.g("checkout", "-q", c4);
    try {
      const report = doctorOn(repo.dir);
      expect(report.diagnostics.filter((d) => d.status === "fail"), JSON.stringify(report.diagnostics, null, 1)).to.deep.equal([]);
    } finally { repo.g("checkout", "-q", "main"); }
  });
});
