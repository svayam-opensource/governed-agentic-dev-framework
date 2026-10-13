// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
// bridge: deleted in D01 (PRJ-121 intent 01, spec §4.1)
/**
 * COMMIT 3 OF THE BRIDGE UPGRADE: THE MIGRATIONS (PRJ-121 intent 01, B06; spec §4.2).
 *
 * For a 1.0-layout org (Svayamtech's): org-config.yaml is split into governance.yaml and the role list; the approved
 * agents in llm-governance.md move to governance.yaml; roles.md's holders reach the role list; the missing org files
 * are seeded; every org token is filled; and the result is a tree `gov doctor` accepts. The retired files go in this
 * commit, after what they held has been carried.
 */
import { expect } from "chai";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import { runUpgradePr } from "../../src/maintain/upgrade-run.js";
import { commitSubject } from "../../src/maintain/upgrade-commits.js";
import { migrateRolesMd, rolesMdHolders } from "../../src/maintain/bridge/migrations.js";
import { doctor } from "../../src/maintain/doctor.js";
import { contentLayoutOf, staleArtifactsIn } from "../../src/maintain/upgrade-sync.js";
import { GOVERNANCE_PATH } from "../../src/config/governance.js";
import { ROLE_LIST_PATH, parseRoleList } from "../../src/config/role-list.js";
import { leftoverTokens } from "../../src/setup/create.js";
import { fixtureFiles, fixtureRepo, upgradeFixture, commitChanges, SHIPPED_CONTENT, tmpDir, type FixtureRepo } from "../helpers/upgrade-fixture.js";

const gitOk = (): boolean => { try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } };
const run = (dir: string, openPr: (a: { body: string }) => string) => runUpgradePr(SHIPPED_CONTENT, dir, { userHome: tmpDir("govb6-home-"), openPr });
const ROLES = fixtureFiles("layout-1.0").get("knowledge/policies/roles.md")!;

describe("bridge migrations — roles.md (B06)", () => {
  it("reads each role's holder: a literal handle is a holder, a token is not (the org-config split carries those)", () => {
    expect(rolesMdHolders(ROLES)).to.deep.equal([
      { role: "Policy Owner", handle: null }, { role: "Legal Owner", handle: null }, { role: "Infrastructure Owner", handle: null },
      { role: "System Architecture Owner", handle: null }, { role: "Data Architecture Owner", handle: null },
      { role: "Development Owner", handle: "@fake-dev-owner" },
    ]);
  });

  const LIST = [
    "## 4. The role list", "", "| Role | GitHub handle | Owns |", "|---|---|---|",
    "| Legal Owner | @legal-person | `knowledge/legal/` |", "| Data Architecture Owner | vacant | `knowledge/architecture/data/` |", "", "After a change…", "",
  ].join("\n");
  it("adds a role the list lacks, fills a vacant one, and never overrides a holder the list already names", () => {
    const roles = [
      "## Legal Owner", "| GitHub Handle | @someone-else |", "## Data Architecture Owner", "| GitHub Handle | @data-person |", "## Development Owner", "| GitHub Handle | @dev-person |",
    ].join("\n");
    const r = migrateRolesMd(roles, LIST);
    expect(r).to.be.a("string");
    const parsed = parseRoleList(r!);
    expect(parsed.found && parsed.roles.map((x) => `${x.role}=${x.holder}`)).to.deep.equal([
      "Legal Owner=@legal-person", "Data Architecture Owner=@data-person", "Development Owner=@dev-person",
    ]);
    expect(r).to.contain("After a change…");
  });

  it("changes nothing when there is nothing to carry", () => {
    expect(migrateRolesMd("## Legal Owner\n| GitHub Handle | <LEGAL_OWNER_GITHUB> |\n", LIST)).to.equal(LIST);
  });
});

(gitOk() ? describe : describe.skip)("bridge upgrade, commit 3 — migrations (B06)", function () {
  this.timeout(60_000);
  let repo: FixtureRepo;
  let u: ReturnType<typeof upgradeFixture>;
  let c3: string;
  const at = (rel: string): string => repo.g("show", `${c3}:${rel}`);
  before(() => {
    // The real 1.0 llm-governance.md carries the org's agents as a fenced yaml block (config/approved-agents.ts); the
    // sanitised fixture body does not, so the test supplies one.
    const llm = fixtureFiles("layout-1.0").get("knowledge/policies/llm-governance.md")! + "\n```yaml\napproved_agents:\n  - id: cursor\n  - id: claude\n    default: true\n```\n";
    repo = fixtureRepo("layout-1.0", { "knowledge/policies/llm-governance.md": llm });
    u = upgradeFixture(repo, run);
    const version = u.branch.replace(/^gov-upgrade-/, "");
    c3 = u.commits.find((c) => c.subject === commitSubject("migrations", version))!.sha;
    expect(c3, u.out).to.be.a("string");
  });

  it("org-config.yaml has only the post-split keys: the governance choices and the owners left it", () => {
    const keys = Object.keys(yaml.load(at("org-config.yaml")) as Record<string, unknown>);
    for (const gone of ["policy_owner_github", "legal_owner_github", "infra_owner_github", "system_arch_owner_github", "data_arch_owner_github", "policy_effective_date", "agent_work_root"]) {
      expect(keys, gone).not.to.include(gone);
    }
    expect(keys).to.include.members(["org_name", "org_slug", "github_org"]);
    expect(at(GOVERNANCE_PATH)).to.contain("fake-policy-owner");
  });

  it("the role list holds roles.md's holders: the four from org-config and the Development Owner from roles.md", () => {
    const parsed = parseRoleList(at(ROLE_LIST_PATH));
    expect(parsed.found && parsed.roles.map((r) => `${r.role}=${r.holder}`)).to.include.members([
      "Legal Owner=@fake-legal-owner", "Infrastructure Owner=@fake-infra-owner", "System Architecture Owner=@fake-sysarch-owner",
      "Data Architecture Owner=@fake-dataarch-owner", "Development Owner=@fake-dev-owner",
    ]);
  });

  it("the approved agents of llm-governance.md are in governance.yaml, and both files are retired in this commit", () => {
    expect(at(GOVERNANCE_PATH)).to.match(/authorized_agents/);
    expect(at(GOVERNANCE_PATH)).to.match(/cursor/i);
    expect(at(GOVERNANCE_PATH)).to.match(/claude/i);
    const changes = commitChanges(repo, c3);
    expect(changes.get("knowledge/policies/llm-governance.md")).to.equal("D");
    expect(changes.get("knowledge/policies/roles.md")).to.equal("D");
  });

  it("the org files a 2.0 org needs are seeded, and no token is left in any file the upgrade created", () => {
    repo.g("checkout", "-q", c3);
    try {
      for (const f of ["policies/org-policy.md", "policies/VERSION", "policies/rules/rules.yaml", "policies/ownership.yaml", "policies/CHANGELOG.md", "policies/build/policy.md"]) {
        expect(fs.existsSync(path.join(repo.dir, f)), f).to.equal(true);
      }
    } finally { repo.g("checkout", "-q", "main"); }
    const created = [...commitChanges(repo, c3)].filter(([, k]) => k === "A").map(([p]) => p).filter((p) => p.startsWith("policies/") && /\.(md|ya?ml)$/.test(p));
    for (const p of created) expect(leftoverTokens(at(p)), p).to.deep.equal([]);
  });

  it("gov doctor accepts the tree", () => {
    repo.g("checkout", "-q", c3);
    try {
      const read = (rel: string): string | null => (fs.existsSync(path.join(repo.dir, rel)) ? fs.readFileSync(path.join(repo.dir, rel), "utf8") : null);
      const exists = (rel: string): boolean => fs.existsSync(path.join(repo.dir, rel));
      const version = fs.readFileSync(path.join(SHIPPED_CONTENT, "VERSION"), "utf8").trim();
      const report = doctor({
        gitPresent: true, ghPresent: true, ghAuthenticated: true, ghScopes: ["repo", "project", "read:org", "workflow"],
        gitIdentity: { name: "t", email: "t@example.test" },
        resolve: { ok: true, home: repo.dir, org: "example-org", via: "cwd" }, activeOrg: "example-org", registeredOrgs: ["example-org"],
        cliVersion: version, workspaceChecked: true, contentVersion: read("VERSION")?.trim() ?? null,
        contentLayout: contentLayoutOf(exists), staleArtifacts: staleArtifactsIn(true, exists),
        orgConfigText: read("org-config.yaml"), governanceText: read(GOVERNANCE_PATH), roleListText: read(ROLE_LIST_PATH), codeownersText: read("CODEOWNERS"),
      });
      expect(report.diagnostics.filter((d) => d.status === "fail"), JSON.stringify(report.diagnostics, null, 1)).to.deep.equal([]);
    } finally { repo.g("checkout", "-q", "main"); }
  });
});
