// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * AN UPGRADED TREE HAS NO BROKEN LINKS — for every layout an org can be on (F55, Policy Owner ruling A, 2026-11-12).
 *
 * An upgrade moves, migrates and retires files; the org's own documents that stay put link to them. Before F55 the
 * upgraded tree failed `gov validate` (16 broken links on a real org) and the upgrade PR's own CI went red. This runs
 * the REAL shipped content and the REAL `gov upgrade` (--apply, and --pr with and without its droppable commit 4) on a
 * workspace of each layout whose index documents link to everything the upgrade relocates, and checks the result with
 * `gov validate`'s own knowledge checker.
 */
import { expect } from "chai";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runUpgradePr, runUpgradeSync } from "../../src/maintain/upgrade-run.js";
import { checkKnowledge } from "../../src/governance/knowledge.js";
import { fixtureRepo, upgradeFixture, tmpDir } from "../helpers/upgrade-fixture.js";

const contentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../content");
const gitOk = (): boolean => { try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } };

function filesOf(root: string, rel = ""): string[] {
  return fs.readdirSync(path.join(root, rel)).flatMap((n) => {
    if (n === ".git" || n === "node_modules") return [];
    const r = rel ? `${rel}/${n}` : n;
    return fs.statSync(path.join(root, r)).isDirectory() ? filesOf(root, r) : [r];
  });
}

/** `gov validate`'s broken-link findings for the tree at `dir` (the knowledge checker, on the real disk). */
function brokenLinks(dir: string): string[] {
  const r = checkKnowledge({
    repoRoot: dir,
    files: filesOf(dir),
    fs: {
      readFile: (p) => (fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, "utf8") : null),
      pathExists: (p) => fs.existsSync(p),
      mkdirp: () => {}, writeFile: () => {}, rm: () => {}, readdir: (p) => (fs.existsSync(p) ? fs.readdirSync(p) : []),
    },
  });
  return r.errors.filter((e) => /broken link/.test(e));
}

const put = (dir: string, rel: string, text: string): void => {
  fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};

describe("upgrade leaves no broken links — the governance/ layout (flat, gov 1.2.x)", function () {
  this.timeout(60_000);
  let dir = "";
  let code = -1, out = "";
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gov-links-flat-"));
    put(dir, "org-config.yaml", 'org_name: "Acme"\ngithub_org: "acme"\nworkspace_repo: "acme-gov"\n');
    put(dir, "VERSION", "1.2.0\n");
    put(dir, "governance/policies/knowledge-organization-standard.md", "# ours\n");
    put(dir, "governance/policies/exceptions/legal/retention.md", "# ours\n");
    put(dir, "governance/infrastructure/knowledge-publication-spec.md", "# ours\n");
    put(dir, "governance/policies/llm-governance.md", "```yaml\napproved_agents:\n  - id: claude\n    default: true\n```\n");
    // The org's own index, linking to every file the manifest relocates — a file, a migration and a whole folder.
    put(dir, "knowledge/README.md", [
      "# Our knowledge",
      "- [standard](../governance/policies/knowledge-organization-standard.md)",
      "- [retention exception](../governance/policies/exceptions/legal/retention.md)",
      "- [all exceptions](../governance/policies/exceptions/)",
      "- [publication](../governance/infrastructure/knowledge-publication-spec.md#rules)",
      "- [agents](../governance/policies/llm-governance.md)",
      "- [ours](domains/ours.md)",
      "",
    ].join("\n"));
    put(dir, "knowledge/domains/ours.md", "# ours\n\nBack to the [index](../README.md).\n");
    const r = runUpgradeSync(contentDir, dir, { apply: true, userHome: tmpDir("gov-links-home-") });
    code = r.code; out = r.lines.join("\n");
  });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ } });

  it("upgrades, and every link in the org's documents still resolves", () => {
    expect(code, out).to.equal(0);
    expect(brokenLinks(dir)).to.deep.equal([]);
  });

  it("repoints each link to its file's new home — and only the targets change", () => {
    const t = fs.readFileSync(path.join(dir, "knowledge/README.md"), "utf8");
    expect(t).to.include("- [standard](../policies/knowledge-organization-standard.md)");
    expect(t).to.include("- [retention exception](../policies/exceptions/legal/retention.md)");
    expect(t).to.include("- [all exceptions](../policies/exceptions/)");
    expect(t).to.include("- [publication](../policies/knowledge-publication.md#rules)");
    expect(t).to.include("- [agents](../policies/governance.yaml)");
    expect(t).to.include("- [ours](domains/ours.md)");
    expect(fs.readFileSync(path.join(dir, "knowledge/domains/ours.md"), "utf8")).to.equal("# ours\n\nBack to the [index](../README.md).\n");
  });

  it("the dry run lists the relinked document, and writes nothing", () => {
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "gov-links-dry-"));
    try {
      put(fresh, "org-config.yaml", 'org_name: "Acme"\ngithub_org: "acme"\nworkspace_repo: "acme-gov"\n');
      put(fresh, "VERSION", "1.2.0\n");
      put(fresh, "governance/policies/knowledge-organization-standard.md", "# ours\n");
      put(fresh, "knowledge/README.md", "[s](../governance/policies/knowledge-organization-standard.md)\n");
      const r = runUpgradeSync(contentDir, fresh, { apply: false, userHome: tmpDir("gov-links-home-") });
      expect(r.lines.join("\n")).to.match(/↪ relink\s+knowledge\/README\.md/);
      expect(fs.readFileSync(path.join(fresh, "knowledge/README.md"), "utf8")).to.equal("[s](../governance/policies/knowledge-organization-standard.md)\n");
    } finally { fs.rmSync(fresh, { recursive: true, force: true }); }
  });
});

/** The 1.0 layout's index documents, as every 1.0 org has them: links to what the 2.0 bridge moves, migrates, retires. */
const ONE_ZERO_INDEXES: Record<string, string> = {
  "knowledge/README.md": "# Knowledge\n\n- [roles](./policies/roles.md)\n- [the policy](./policies/agentic-development-policy.md)\n",
  "knowledge/policies/README.md": "# Policies\n\n- [roles](roles.md)\n- [llm-governance](llm-governance.md)\n- [data-classification](data-classification.md)\n- [the policy](agentic-development-policy.md)\n",
  "knowledge/policies/exceptions/README.md": "# Exceptions\n\n- [template](./architecture/TEMPLATE.md)\n- [SVM-001](./architecture/2026-05-20-SVM-001-svm-ident-verify-fastify.md)\n",
  "knowledge/policies/exceptions/deployment/README.md": "# Deployment exceptions\n\n- [PRJ-43](./2026-08-05-PRJ-43-gov-version-bump-automated-merge.md)\n",
};

(gitOk() ? describe : describe.skip)("upgrade leaves no broken links — the 1.0 layout (knowledge/policies/), via the 2.0 bridge", function () {
  this.timeout(120_000);
  const run = (dir: string, openPr: (a: { body: string }) => string) => runUpgradePr(contentDir, dir, { userHome: tmpDir("gov-links-home-"), openPr });

  it("--pr: all four commits — no broken links, and the PR body lists the relinked documents", () => {
    const repo = fixtureRepo("layout-1.0", ONE_ZERO_INDEXES);
    const u = upgradeFixture(repo, run);
    expect(u.code, u.out).to.equal(0);
    repo.g("checkout", "-q", u.branch);
    expect(brokenLinks(repo.dir)).to.deep.equal([]);
    expect(u.body).to.include("Links repointed").and.include("`knowledge/policies/README.md`");
  });

  it("--pr with commit 4 dropped — still no broken links, and the superseded policy is still linked", () => {
    const repo = fixtureRepo("layout-1.0", ONE_ZERO_INDEXES);
    const u = upgradeFixture(repo, run);
    expect(u.code, u.out).to.equal(0);
    repo.g("checkout", "-q", u.branch);
    repo.g("-c", "commit.gpgsign=false", "revert", "--no-edit", "HEAD");
    expect(brokenLinks(repo.dir)).to.deep.equal([]);
    expect(fs.readFileSync(path.join(repo.dir, "knowledge/README.md"), "utf8")).to.include("[the policy](./policies/agentic-development-policy.md)");
  });

  it("--apply — no broken links (commit 4 is never applied here, so its links stay)", () => {
    const repo = fixtureRepo("layout-1.0", ONE_ZERO_INDEXES);
    const r = runUpgradeSync(contentDir, repo.dir, { apply: true, userHome: tmpDir("gov-links-home-") });
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(brokenLinks(repo.dir)).to.deep.equal([]);
    const t = fs.readFileSync(path.join(repo.dir, "knowledge/policies/README.md"), "utf8");
    expect(t).to.include("[roles](../../policies/common/authorized-representatives.md)");
    expect(t).to.include("[llm-governance](../../policies/governance.yaml)");
    expect(t).to.include("[the policy](agentic-development-policy.md)");
  });
});
