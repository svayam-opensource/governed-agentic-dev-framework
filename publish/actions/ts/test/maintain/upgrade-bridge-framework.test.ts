// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
// bridge: deleted in D01 (PRJ-121 intent 01, spec §4.1)
/**
 * COMMIT 1 OF THE BRIDGE UPGRADE: the 1.0 layout's framework files go, by fingerprint only (PRJ-121 intent 01, B03;
 * spec §4.2, ruling Q3; T11, T13).
 *
 * On fixture (1), Svayamtech's shape: every file whose bytes are the framework's is retired in commit 1 (the exception
 * templates beside the records, in commit 2); a file at the same path with another body is the org's — kept, and listed
 * in the PR body; gov-cicd's knowledge/deployment/ is never touched.
 */
import { expect } from "chai";
import { execFileSync } from "node:child_process";
import { runUpgradePr } from "../../src/maintain/upgrade-run.js";
import { commitSubject } from "../../src/maintain/upgrade-commits.js";
import { contentLayoutOf } from "../../src/maintain/upgrade-sync.js";
import { FINGERPRINTS, sha256 } from "../../src/maintain/bridge/fingerprints.js";
import { fixtureFiles, fixtureRepo, upgradeFixture, commitChanges, SHIPPED_CONTENT, tmpDir, type FixtureRepo } from "../helpers/upgrade-fixture.js";

const gitOk = (): boolean => { try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } };
const run = (dir: string, openPr: (a: { body: string }) => string) => runUpgradePr(SHIPPED_CONTENT, dir, { userHome: tmpDir("govb3-home-"), openPr });
const subjectOf = (c: "framework" | "org-moves", version: string): string => commitSubject(c, version);

describe("bridge fingerprints (B03)", () => {
  it("every fingerprint is a file of fixture (1) whose body hashes to it — the fixture carries the framework's exact bytes", () => {
    const files = fixtureFiles("layout-1.0");
    for (const f of FINGERPRINTS) {
      expect(files.has(f.path), f.path).to.equal(true);
      expect(sha256(files.get(f.path)!), f.path).to.equal(f.sha256);
    }
  });

  it("a CRLF checkout of the same bytes has the same fingerprint", () => {
    expect(sha256("a\r\nb\r\n")).to.equal(sha256("a\nb\n"));
  });

  it("contentLayoutOf names the 1.0 layout, and only when there is no framework/ tree", () => {
    const has = (set: string[]) => (rel: string) => set.includes(rel);
    expect(contentLayoutOf(has(["knowledge/policies/roles.md"]))).to.equal("layout-1.0");
    expect(contentLayoutOf(has(["knowledge/policies/agentic-development-policy.md"]))).to.equal("layout-1.0");
    expect(contentLayoutOf(has(["knowledge/policies/roles.md", "framework/rules"]))).to.equal("framework");
    expect(contentLayoutOf(has(["knowledge/deployment"]))).to.equal("none");
  });
});

(gitOk() ? describe : describe.skip)("bridge upgrade, commit 1 — the framework in, the 1.0 framework files out (B03)", function () {
  this.timeout(60_000);
  const changedHook = ".claude/hooks/session-start.sh";
  let repo: FixtureRepo;
  let u: ReturnType<typeof upgradeFixture>;
  let version: string;
  before(() => {
    repo = fixtureRepo("layout-1.0", { [changedHook]: `${fixtureFiles("layout-1.0").get(changedHook)}# the org's own line\n` });
    u = upgradeFixture(repo, run);
    version = u.branch.replace(/^gov-upgrade-/, "");
  });

  it("opens the PR, and its first commit is the framework commit", () => {
    expect(u.code, u.out).to.equal(0);
    expect(u.commits[0]?.subject).to.equal(subjectOf("framework", version));
  });

  it("every fingerprinted framework file is retired in commit 1; the exception templates in commit 2", () => {
    const c1 = commitChanges(repo, u.commits[0]!.sha);
    const c2 = commitChanges(repo, u.commits.find((c) => c.subject === subjectOf("org-moves", version))!.sha);
    for (const f of FINGERPRINTS.filter((x) => x.path !== changedHook)) {
      expect((f.commit === "framework" ? c1 : c2).get(f.path), `${f.path} retired in ${f.commit}`).to.equal("D");
    }
  });

  it("a same-named file with a changed body is kept, untouched, and listed in the PR body", () => {
    expect(repo.g("show", `${u.branch}:${changedHook}`)).to.equal(repo.g("show", `main:${changedHook}`));
    expect(u.body).to.include(`- \`${changedHook}\` — named like a 1.0 framework file, but not its body — yours, kept`);
  });

  it("knowledge/deployment/** is never touched (T11, T13)", () => {
    expect(repo.g("diff", "--name-only", "main", u.branch, "--", "knowledge/deployment/")).to.equal("");
  });

  it("the retirements are listed in the PR body", () => {
    expect(u.body).to.include("- `AGENTS.md` — the framework's own file from the 1.0 layout (its exact bytes)");
  });
});
