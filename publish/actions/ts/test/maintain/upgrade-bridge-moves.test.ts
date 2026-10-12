// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
// bridge: deleted in D01 (PRJ-121 intent 01, spec §4.2)
/**
 * COMMIT 2 OF THE BRIDGE UPGRADE: the organization's own documents move, byte for byte (PRJ-121 intent 01, B04;
 * spec §4.2's table, ruling Q3).
 *
 * On fixture (1): data-classification → policies/common/, api-development-policy → policies/build/, the platform host
 * conventions → policies/deploy/, each exception record → policies/exceptions/<domain>/ — every one with the same blob.
 * Everything else under knowledge/policies/ is left exactly where it is and named in the PR body.
 */
import { expect } from "chai";
import { execFileSync } from "node:child_process";
import { runUpgradePr } from "../../src/maintain/upgrade-run.js";
import { commitSubject } from "../../src/maintain/upgrade-commits.js";
import { BRIDGE_MOVES, bridgeMoves } from "../../src/maintain/bridge/moves.js";
import { PHASE_TREE } from "../../src/maintain/bridge/phase-tree.js";
import { fixtureRepo, upgradeFixture, commitChanges, SHIPPED_CONTENT, tmpDir, type FixtureRepo } from "../helpers/upgrade-fixture.js";

const gitOk = (): boolean => { try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } };
const run = (dir: string, openPr: (a: { body: string }) => string) => runUpgradePr(SHIPPED_CONTENT, dir, { userHome: tmpDir("govb4-home-"), openPr });

const MOVED: Readonly<Record<string, string>> = {
  "knowledge/policies/data-classification.md": "policies/common/data-classification.md",
  "knowledge/policies/api-development-policy.md": "policies/build/api-development-policy.md",
  "knowledge/policies/platform-host-config-and-cicd-conventions.md": "policies/deploy/platform-host-config-and-cicd-conventions.md",
  "knowledge/policies/exceptions/architecture/2026-05-20-SVM-001-svm-ident-verify-fastify.md": "policies/exceptions/architecture/2026-05-20-SVM-001-svm-ident-verify-fastify.md",
  "knowledge/policies/exceptions/deployment/2026-08-05-PRJ-43-gov-version-bump-automated-merge.md": "policies/exceptions/deployment/2026-08-05-PRJ-43-gov-version-bump-automated-merge.md",
  "knowledge/policies/exceptions/deployment/2026-08-28-PRJ-120-openbao-port-8200.md": "policies/exceptions/deployment/2026-08-28-PRJ-120-openbao-port-8200.md",
  "knowledge/policies/exceptions/development/2026-07-01-PRJ-56-svm-hr-single-repo.md": "policies/exceptions/development/2026-07-01-PRJ-56-svm-hr-single-repo.md",
};

/** knowledge/policies/ entries the bridge leaves where they are (a folder named once when all of it is left). */
const LEFT = [
  "knowledge/policies/README.md",
  "knowledge/policies/compliance/",
  "knowledge/policies/exceptions/README.md",
  "knowledge/policies/exceptions/deployment/README.md",
  "knowledge/policies/exceptions/development/README.md",
  "knowledge/policies/exceptions/support/",
  "knowledge/policies/exceptions/testing/",
  "knowledge/policies/knowledge-organization-standard.md",
  "knowledge/policies/mandates/",
  "knowledge/policies/patterns/",
  "knowledge/policies/procedures/README.md",
  "knowledge/policies/procedures/close-project-recovery.md",
  "knowledge/policies/procedures/gov-seed-github-projects-visibility.md",
  "knowledge/policies/proposed-pol-421-cross-repo-worktree-isolation.md",
  "knowledge/policies/proposed-policy-modular-interfaces.md",
  "knowledge/policies/proposed-policy-unit-documentation.md",
  "knowledge/policies/specs/",
  "knowledge/policies/use-cases/",
  // Carried by later bridge steps — listed as left in place until they are (B06: roles.md, llm-governance.md;
  // B08: the framework-superseded policy and procedures).
  "knowledge/policies/agentic-development-policy.md",
  "knowledge/policies/agentic-development-procedures.md",
  "knowledge/policies/llm-governance.md",
  "knowledge/policies/procedures/agentic-development-procedures.md",
  "knowledge/policies/roles.md",
];

describe("bridge move table (B04)", () => {
  it("lands data-classification where spec §2 puts the org's copy", () => {
    const to = BRIDGE_MOVES.find((m) => m.from === "knowledge/policies/data-classification.md")?.to;
    expect(PHASE_TREE.map((r) => r.path)).to.include(to);
  });

  it("an exception record moves under its domain; the domain's README and TEMPLATE.md do not", () => {
    const files = ["knowledge/policies/exceptions/legal/2026-01-01-x.md", "knowledge/policies/exceptions/legal/README.md", "knowledge/policies/exceptions/legal/TEMPLATE.md", "knowledge/policies/exceptions/README.md"];
    expect(bridgeMoves(files).moves.map((m) => [m.from, m.to])).to.deep.equal([["knowledge/policies/exceptions/legal/2026-01-01-x.md", "policies/exceptions/legal/2026-01-01-x.md"]]);
  });

  it("a destination that already exists is not moved onto — the file is left, with the reason", () => {
    const r = bridgeMoves(["knowledge/policies/data-classification.md", "policies/common/data-classification.md"]);
    expect(r.moves).to.deep.equal([]);
    expect(r.blocked).to.deep.equal([{ path: "knowledge/policies/data-classification.md", why: "policies/common/data-classification.md already exists — not moved; merge the two by hand" }]);
  });
});

(gitOk() ? describe : describe.skip)("bridge upgrade, commit 2 — the org's own documents move (B04)", function () {
  this.timeout(60_000);
  let repo: FixtureRepo;
  let u: ReturnType<typeof upgradeFixture>;
  before(() => {
    repo = fixtureRepo("layout-1.0");
    u = upgradeFixture(repo, run);
  });

  it("commit 2 moves each file byte for byte — the blob at the new path is the blob that was at the old one", () => {
    expect(u.code, u.out).to.equal(0);
    const version = u.branch.replace(/^gov-upgrade-/, "");
    const c2 = u.commits.find((c) => c.subject === commitSubject("org-moves", version));
    expect(c2, u.commits.map((c) => c.subject).join("\n")).to.not.equal(undefined);
    const changes = commitChanges(repo, c2!.sha);
    for (const [from, to] of Object.entries(MOVED)) {
      expect(changes.get(from), from).to.equal("D");
      expect(changes.get(to), to).to.equal("A");
      expect(repo.g("rev-parse", `${c2!.sha}:${to}`), `${to} byte for byte`).to.equal(repo.g("rev-parse", `main:${from}`));
    }
  });

  it("every move is listed in the PR body", () => {
    for (const [from, to] of Object.entries(MOVED)) expect(u.body).to.include(`- \`${from}\` → \`${to}\``);
  });

  it("the left-in-place list for knowledge/policies/ is exactly the expected one, and none of it is touched", () => {
    const section = u.body.slice(u.body.indexOf("## Left in place"));
    const left = section.slice(0, section.indexOf("\n## ", 3) === -1 ? undefined : section.indexOf("\n## ", 3)).split("\n").map((l) => /^- `(knowledge\/policies\/[^`]+)` — /.exec(l)?.[1]).filter((p): p is string => !!p);
    expect([...new Set(left)].sort()).to.deep.equal([...LEFT].sort());
    expect(repo.g("diff", "--name-only", "main", u.branch, "--", ...LEFT.filter((p) => !p.endsWith("/")), ...LEFT.filter((p) => p.endsWith("/")))).to.equal("");
  });
});
