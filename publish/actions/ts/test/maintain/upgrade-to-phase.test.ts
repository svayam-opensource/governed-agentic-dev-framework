// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * EVERY ORG REACHES THE 2.0 TREE IN ONE UPGRADE PR (PRJ-121 intent 01, B01; spec §8 "Upgrade fixtures").
 *
 * Three fixtures, one harness:
 *   (1) layout-1.0          Svayamtech's shape — the file list of its gov repo, sanitised bodies (bridge)
 *   (2) flat-1.2.3          svm-geneva's shape — what gov 1.2.3 set up, root move record included (bridge)
 *   (3) flat-with-org-rows  (2) after a first policy PR — org rows that cite files the 2.0 layout moves (T8, permanent)
 *
 * For each: `gov upgrade --pr` opens ONE pull request; merged, the repo is spec §2's tree with nothing of the old
 * layout left; a second `gov upgrade --pr` finds nothing to do.
 *
 * THESE START RED. The layout (L02), the bridge commits (B02–B08) and the flat moves (B05) turn them green, one
 * fixture at a time. Until then each is an EXPECTED FAILURE: it passes while the upgrade does not yet reach §2, and
 * fails the day it does — so whoever lands the last piece turns it into a plain `it` instead of leaving it masked.
 */
import { expect } from "chai";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { runUpgradePr } from "../../src/maintain/upgrade-run.js";
import { phaseTreeProblems, PHASE_TREE, OLD_LAYOUT_PATHS } from "../../src/maintain/bridge/phase-tree.js";
import { leftoverTokens } from "../../src/setup/create.js";
import { parseRuleStore, validateRuleStore } from "../../src/rules/model/rule-row.js";
import { sectionShas } from "../../src/rules/checks/sections.js";
import { FIXTURE_NAMES, fixtureFiles, fixtureRepo, SHIPPED_CONTENT, tmpDir, treeOf, type FixtureName } from "../helpers/upgrade-fixture.js";

const gitOk = (): boolean => { try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } };

/**
 * An EXPECTED FAILURE. Passes while `fn` throws; fails, loudly, once `fn` passes — the reason has landed, and the case
 * must become a plain `it` so it guards the result from then on.
 */
function xfail(title: string, until: string, fn: () => void): void {
  it(`${title} [expected to fail until ${until}]`, () => {
    try { fn(); } catch { return; /* still red, as expected */ }
    throw new Error(`"${title}" now PASSES — ${until} has landed: make it a plain it() so it keeps guarding the result`);
  });
}

/** What each fixture must look like once the upgrade PR is merged, beyond §2 itself. */
const EXPECT: Record<FixtureName, { seedNew: boolean; gone: readonly string[]; untouched: readonly string[]; until: string }> = {
  "layout-1.0": {
    seedNew: true, // §4.2 commit 3 seeds the umbrella and build/policy.md for Svayamtech
    gone: [
      "AGENTS.md", "CLAUDE.md", "CONVENTIONS.md", ".clinerules/agent.md", ".continue/rules.md", ".cursor/rules/agent.mdc",
      ".windsurf/rules/agent.md", ".github/copilot-instructions.md", ".gemini/styleguide.md",
      ".claude/hooks/session-start.sh", ".cursor/hooks.json", ".cursor/hooks/session-gate.sh",
      "knowledge/guidance/todo-template.md", "knowledge/policies/procedures/templates/todo-template.md",
      "knowledge/policies/agentic-development-policy.md", "knowledge/policies/llm-governance.md", "knowledge/policies/roles.md",
      "knowledge/policies/data-classification.md", "knowledge/policies/api-development-policy.md",
      "knowledge/policies/platform-host-config-and-cicd-conventions.md",
      "knowledge/policies/exceptions/architecture/TEMPLATE.md",
      "knowledge/policies/exceptions/development/2026-07-01-PRJ-56-svm-hr-single-repo.md",
    ],
    untouched: [
      "knowledge/deployment/deploy-policy.yaml", "knowledge/deployment/catalog/services.yaml",
      "knowledge/policies/knowledge-organization-standard.md", "knowledge/policies/proposed-policy-modular-interfaces.md",
      "knowledge/policies/specs/README.md", "knowledge/deployment/pipelines/deploy.Jenkinsfile",
    ],
    until: "L02 + B02–B08",
  },
  "flat-1.2.3": {
    seedNew: false,
    gone: [".gov-upgrade-moves.json"],
    untouched: ["policies/knowledge-organization-standard.md", "policies/knowledge-publication.md", "policies/compliance-review.md"],
    until: "L02 + L05 + L06 + B05", // B05 moved the flat files and the root record; the build specification is L05's
  },
  "flat-with-org-rows": {
    seedNew: false,
    gone: [".gov-upgrade-moves.json"],
    untouched: ["policies/knowledge-organization-standard.md"],
    until: "L02 + L05 + B05",
  },
};

interface Upgraded { readonly dir: string; readonly g: (...a: string[]) => string; readonly before: Map<string, string>; readonly code: number; readonly lines: readonly string[] }

/** Run `gov upgrade --pr` on the fixture, and merge the PR it opened. */
function upgradeAndMerge(name: FixtureName): Upgraded {
  const { dir, g } = fixtureRepo(name);
  const before = fixtureFiles(name);
  const r = runUpgradePr(SHIPPED_CONTENT, dir, { userHome: tmpDir("govfx-home-"), openPr: () => "https://example.test/pr/1" });
  const branch = g("branch", "--list", "gov-upgrade-*", "--format=%(refname:short)").split("\n")[0];
  if (r.code === 0 && branch) g("merge", "-q", "--ff-only", branch);
  return { dir, g, before, code: r.code, lines: r.lines };
}

function reachesPhaseTree(name: FixtureName): Upgraded {
  const want = EXPECT[name];
  const u = upgradeAndMerge(name);
  expect(u.code, u.lines.join("\n")).to.equal(0);
  const files = treeOf(u.dir);
  expect(phaseTreeProblems(files, { seedNew: want.seedNew, moved: true }), "spec §2").to.deep.equal([]);
  for (const p of want.gone) expect(files, `left over: ${p}`).not.to.include(p);
  for (const p of want.untouched) expect(fs.readFileSync(path.join(u.dir, p), "utf8"), `touched: ${p}`).to.equal(u.before.get(p));
  // Zero leftovers: every file the upgrade CREATED for the org (not one it moved) has its tokens filled.
  const added = u.g("diff", "--name-status", "-M100%", "HEAD~1", "HEAD").split("\n").filter((l) => l.startsWith("A\t")).map((l) => l.slice(2));
  for (const p of added.filter((a) => a.startsWith("policies/") || !a.includes("/"))) {
    expect(leftoverTokens(fs.readFileSync(path.join(u.dir, p), "utf8")), `tokens left in ${p}`).to.deep.equal([]);
  }
  if (name === "flat-with-org-rows") {
    const rules = fs.readFileSync(path.join(u.dir, "policies/rules/rules.yaml"), "utf8");
    expect(rules, "org rows relocated (T8)").not.to.match(/doc: policies\/data-classification\.md|list: policies\/approved-technologies\.md/);
  }
  return u;
}

/** Meaningful only once the first upgrade reached §2 — so it asserts that first. */
function secondUpgradeIsNoOp(name: FixtureName): void {
  const u = reachesPhaseTree(name);
  const again = runUpgradePr(SHIPPED_CONTENT, u.dir, { userHome: tmpDir("govfx-home-"), branch: "gov-upgrade-again", openPr: () => "https://example.test/pr/2" });
  expect(again.code, again.lines.join("\n")).to.equal(0);
  expect(again.lines.join("\n")).to.match(/nothing to do/);
}

describe("upgrade fixtures — the inputs are what they claim to be (B01)", () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name}: paths.txt and bodies.txt agree, and no body carries a credential`, () => {
      const files = fixtureFiles(name);
      expect(files.size).to.be.greaterThan(40);
      const credential = /(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[abprs]-[A-Za-z0-9-]{10,}|hvs\.[A-Za-z0-9]{20,})/;
      for (const [p, body] of files) expect(credential.test(body), `credential-shaped text in ${name}/${p}`).to.equal(false);
    });
  }

  it("layout-1.0 is Svayamtech's 1.0 shape: knowledge/policies/, root harness copies, no policies/ and no framework/", () => {
    const files = [...fixtureFiles("layout-1.0").keys()];
    expect(files).to.include.members(["org-config.yaml", "VERSION", "AGENTS.md", "knowledge/policies/agentic-development-policy.md", "knowledge/policies/roles.md", "knowledge/policies/llm-governance.md", "knowledge/deployment/deploy-policy.yaml"]);
    expect(files.filter((f) => f.startsWith("policies/") || f.startsWith("framework/"))).to.deep.equal([]);
    expect(fixtureFiles("layout-1.0").get("VERSION")).to.equal("1.0.0\n");
    const cfg = fixtureFiles("layout-1.0").get("org-config.yaml")!;
    for (const key of ["policy_owner_github", "agent_work_root", "legal_owner_github", "org_slug_lower"]) expect(cfg, `pre-split key ${key}`).to.match(new RegExp(`^${key}:`, "m"));
  });

  it("flat-1.2.3 is what gov 1.2.3 set up: the flat policies/ starters, framework/docs/, and the ROOT move record", () => {
    const files = fixtureFiles("flat-1.2.3");
    expect([...files.keys()]).to.include.members(["policies/rules.yaml", "policies/catalog.yaml", "policies/authorized-representatives.md", "framework/docs/specs/framework-specification.md", "framework/rules/catalog.yaml", ".gov-upgrade-moves.json", "CODEOWNERS", ".github/workflows/approver-check.yml"]);
    expect(JSON.parse(files.get(".gov-upgrade-moves.json")!)).to.be.an("array").that.is.not.empty;
    for (const p of ["README.md", "policies/org-policy.md", "policies/authorized-representatives.md", "policies/governance.yaml"]) {
      expect(leftoverTokens(files.get(p)!), `setup filled the tokens in ${p}`).to.deep.equal([]);
    }
  });

  it("flat-with-org-rows holds valid org rows whose shas match the sections they cite", () => {
    const files = fixtureFiles("flat-with-org-rows");
    const rows = parseRuleStore(files.get("policies/rules.yaml")!);
    expect(rows.map((r) => r.id)).to.deep.equal(["GOV-GEX-001", "GOV-GEX-002"]);
    expect(validateRuleStore(rows, { scope: "GEX" })).to.deep.equal([]);
    for (const r of rows) expect(sectionShas(files.get(r.source.doc)!).get(r.source.section), `${r.id} sha`).to.equal(r.source.sha);
  });
});

describe("the §2 table (bridge) — what 'reaches §2' means", () => {
  it("the table's own files are the §2 tree; one missing row, a reserved path or an old path is named", () => {
    const tree = PHASE_TREE.filter((r) => r.mode !== "reserved").map((r) => (r.path.endsWith("/") ? `${r.path}x.md` : r.path));
    expect(phaseTreeProblems(tree, { seedNew: true, moved: true })).to.deep.equal([]);
    expect(phaseTreeProblems(tree.filter((p) => p !== "policies/org-policy.md"))).to.deep.equal(["missing policies/org-policy.md"]);
    expect(phaseTreeProblems([...tree, "policies/deploy/unit-catalog/services.yaml"])).to.include("reserved path created: policies/deploy/unit-catalog/");
    expect(phaseTreeProblems([...tree, "framework/docs/specs/a.md", "framework/docs/b.md"])).to.include("old layout left: framework/docs/ (2 file(s))");
    expect(OLD_LAYOUT_PATHS).to.include(".gov-upgrade-moves.json");
  });
});

/** Fixtures whose expected failure has been fixed: they are plain tests now and guard the result. */
const LANDED: ReadonlySet<FixtureName> = new Set<FixtureName>(["flat-1.2.3", "flat-with-org-rows"]);

(gitOk() ? describe : describe.skip)("gov upgrade --pr reaches spec §2 from every fixture (B01 harness)", function () {
  this.timeout(60_000);
  for (const name of FIXTURE_NAMES) {
    it(`${name}: today's upgrade opens a PR (the harness itself works)`, () => {
      const u = upgradeAndMerge(name);
      expect(u.code, u.lines.join("\n")).to.equal(0);
      expect(u.lines.join("\n")).to.match(/Opened upgrade PR/);
    });
    if (LANDED.has(name)) {
      it(`${name}: one upgrade PR reaches §2, with zero leftovers`, () => { reachesPhaseTree(name); });
      it(`${name}: a second upgrade is a no-op`, () => { secondUpgradeIsNoOp(name); });
      continue;
    }
    xfail(`${name}: one upgrade PR reaches §2, with zero leftovers`, EXPECT[name].until, () => reachesPhaseTree(name));
    xfail(`${name}: a second upgrade is a no-op`, EXPECT[name].until, () => secondUpgradeIsNoOp(name));
  }
});
