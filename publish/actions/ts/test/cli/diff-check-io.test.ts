// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE PROPERTY THAT MATTERS HERE IS NOT "IT READS A DIFF" — it is WHICH BRANCH THE RULE COMES FROM.
 *
 * A check that judges a pull request must not be one the pull request can edit. Read carelessly from the
 * worktree, deleting the clause on your own branch removes the gate meant to hold you, and the list of approved
 * technologies could be amended in the same commit that adds the dependency. So the two tests that would be worth
 * keeping if every other one were deleted are: the check still fires when the branch under review has removed it,
 * and the dependency is still unapproved when the branch under review has approved it.
 *
 * `git` is one injected function, so all of it runs with no repository.
 */
import { expect } from "chai";
import { changedFiles, policyChecks } from "../../src/cli/diff-check-io.js";
import type { GitRead } from "../../src/cli/policy-gate-io.js";
import { storeTree, boundRow, treeGit, type Tree } from "../helpers/rule-store.js";

/** The rule that judges a dependency: list-membership on the gov repo's pull requests. */
const RULE_WITH_CHECK = boundRow("GOV-SVM-210", { resource: "vcs.gov-repo", event: "pull_request" },
  "gov-builtin/list-membership", { when: ["**/package.json"], list: "policies/approved-technologies.md" });

/** A git over trees that also answers the changeset calls. */
function fakeGit(
  trees: Readonly<Record<string, Tree>>,
  nameStatus: string,
  hunks: Readonly<Record<string, string>> = {},
): GitRead & { calls: string[][] } {
  return treeGit(trees, (args) => {
    if (args[0] === "diff" && args[1] === "--name-status") return nameStatus;
    if (args[0] === "diff" && args[1] === "-U0") return hunks[args[5]!] ?? "";
    return null;
  });
}

const APPROVED_ON_MAIN = "| mocha · chai | tests |\n";
const APPROVED_ON_BRANCH = "| mocha · chai | tests |\n| left-pad | padding |\n";

describe("reading the changeset", () => {
  it("splits --name-status into statuses, and reads the ADDED lines from a -U0 hunk", () => {
    const git = fakeGit({}, "A\tsrc/new.ts\nM\tsrc/old.ts\nD\tsrc/gone.ts\n", {
      "src/new.ts": "--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1 @@\n+const a = 1;\n",
      "src/old.ts": "--- a/src/old.ts\n+++ b/src/old.ts\n@@ -3 +3 @@\n-const b = 1;\n+const b = 2;\n",
    });
    const changed = changedFiles(git, { repo: "/w", ref: "main", base: "base", head: "HEAD" });
    expect(changed.map((c) => `${c.status} ${c.path}`)).to.deep.equal([
      "added src/new.ts", "modified src/old.ts", "deleted src/gone.ts",
    ]);
    expect(changed[0]!.addedLines, "`+++` is a diff header, not an added line").to.deep.equal(["const a = 1;"]);
    expect(changed[1]!.addedLines).to.deep.equal(["const b = 2;"]);
    expect(changed[2]!.addedLines, "a deletion adds nothing").to.deep.equal([]);
    expect(changed[2]!.text, "and has no text to judge").to.equal(null);
  });

  it("a RENAME becomes a deletion of the old path and an addition of the new one", () => {
    // Collapsing it to one entry would hide the old path from path-scope: moving a file OUT of your writable
    // scope is a write to somewhere you may not write, and nothing would have reported it.
    const git = fakeGit({}, "R100\tsrc/a.ts\tlib/a.ts\n");
    expect(changedFiles(git, { repo: "/w", ref: "main", base: "base", head: "HEAD" }).map((c) => `${c.status} ${c.path}`))
      .to.deep.equal(["deleted src/a.ts", "added lib/a.ts"]);
  });

  it("an unrecognised status letter is skipped, not guessed at", () => {
    const git = fakeGit({}, "U\tsrc/conflicted.ts\n");
    expect(changedFiles(git, { repo: "/w", ref: "main", base: "base", head: "HEAD" })).to.deep.equal([]);
  });

  it("a git that cannot answer yields an empty changeset rather than a throw", () => {
    const git: GitRead = () => null;
    expect(changedFiles(git, { repo: "/w", ref: "main", base: "base", head: "HEAD" })).to.deep.equal([]);
  });
});

describe("where the rule comes from — the rule rows at the ratified ref", () => {
  const nameStatus = "M\tpackage.json\n";
  const hunks = { "package.json": '+++ b/package.json\n+    "left-pad": "^1.3.0",\n' };

  it("the check still fires when the branch under review has DELETED the rule row", () => {
    const git = fakeGit({
      main: storeTree(RULE_WITH_CHECK, { "policies/approved-technologies.md": APPROVED_ON_MAIN }),
      HEAD: storeTree("[]\n", { "package.json": "{}" }),
    }, nameStatus, hunks);

    const r = policyChecks({ git }, { repo: "/w", ref: "main", base: "base", head: "HEAD" });
    expect(r.ok, "a branch that edits the rules must not be judged by its own edit (GOV-FRM-456, GOV-FRM-086)").to.equal(false);
    expect(r.failures[0]!.message).to.contain("left-pad");
    expect(r.failures[0]!.pol).to.equal("GOV-SVM-210");
    expect(git.calls.some((c) => c[0] === "ls-tree" && c[3] === "main"), "the stores are listed at the ratified ref").to.equal(true);
    expect(git.calls.some((c) => c[0] === "show" && c[1]!.startsWith("HEAD:policies/")),
      "and the branch's own copy of the rules is never read").to.equal(false);
  });

  it("the list= document is read from the ratified ref too — a branch cannot approve its own dependency", () => {
    const git = fakeGit({
      main: storeTree(RULE_WITH_CHECK, { "policies/approved-technologies.md": APPROVED_ON_MAIN }),
      HEAD: { "policies/approved-technologies.md": APPROVED_ON_BRANCH, "package.json": "{}" },
    }, nameStatus, hunks);

    const r = policyChecks({ git }, { repo: "/w", ref: "main", base: "base", head: "HEAD" });
    expect(r.ok, "approving a technology is a pull request to that file, not a line in the same commit").to.equal(false);
    expect(r.failures[0]!.message).to.contain("policies/approved-technologies.md");
  });

  it("the same change passes once the ratified list holds the dependency", () => {
    const git = fakeGit({
      main: storeTree(RULE_WITH_CHECK, { "policies/approved-technologies.md": APPROVED_ON_BRANCH }),
      HEAD: { "package.json": "{}" },
    }, nameStatus, hunks);
    expect(policyChecks({ git }, { repo: "/w", ref: "main", base: "base", head: "HEAD" }).failures).to.deep.equal([]);
  });

  it("only the bindings whose `when` globs match the change judge it", () => {
    const git = fakeGit({ main: storeTree(RULE_WITH_CHECK, { "policies/approved-technologies.md": APPROVED_ON_MAIN }) }, "M\tREADME.md\n", { "README.md": "+++ b/README.md\n+hello\n" });
    expect(policyChecks({ git }, { repo: "/w", ref: "main", base: "base", head: "HEAD" }))
      .to.deep.equal({ ok: true, failures: [], warnings: [] });
  });

  it("only the changeset predicates run locally — an approval check is the pull request's business", () => {
    const approval = boundRow("GOV-SVM-300", { resource: "vcs.gov-repo", event: "pull_request" }, "gov-builtin/section-owner-approval", {});
    const git = fakeGit({ main: storeTree(approval) }, nameStatus, hunks);
    expect(policyChecks({ git }, { repo: "/w", ref: "main", base: "base", head: "HEAD" }))
      .to.deep.equal({ ok: true, failures: [], warnings: [] });
  });

  it("a workspace whose rules bind no changeset check reports nothing — adopters who wrote no rule are not blocked", () => {
    const git = fakeGit({ main: storeTree("[]\n") }, nameStatus, hunks);
    expect(policyChecks({ git }, { repo: "/w", ref: "main", base: "base", head: "HEAD" }))
      .to.deep.equal({ ok: true, failures: [], warnings: [] });
  });

  it("rule stores that cannot be read are a warning, never a silent pass", () => {
    const git = fakeGit({ main: { "policies/rules.yaml": "[]\n" } }, nameStatus, hunks);   // no org-config → no scope
    const r = policyChecks({ git }, { repo: "/w", ref: "main", base: "base", head: "HEAD" });
    expect(r.warnings.map((w) => w.message).join("\n")).to.contain("could not be read");
  });

  it("an empty changeset short-circuits: nothing changed, nothing to judge", () => {
    const git = fakeGit({ main: storeTree(RULE_WITH_CHECK) }, "");
    expect(policyChecks({ git }, { repo: "/w", ref: "main", base: "base", head: "HEAD" }).ok).to.equal(true);
    expect(git.calls.some((c) => c[0] === "ls-tree"), "and the rules are not even read").to.equal(false);
  });

  it("the branch is passed through, so a `subject: branch` naming check can be judged on a pull request", () => {
    const naming = boundRow("GOV-SVM-220", { resource: "vcs.gov-repo", event: "pull_request" }, "gov-builtin/naming", { subject: "branch", pattern: "^BRNCH-" });
    const git = fakeGit({ main: storeTree(naming), HEAD: { "package.json": "{}" } }, nameStatus, hunks);
    const bad = policyChecks({ git }, { repo: "/w", ref: "main", base: "base", head: "HEAD", branch: "feature/x" });
    expect(bad.failures[0]!.message).to.contain("feature/x");
    const good = policyChecks({ git }, { repo: "/w", ref: "main", base: "base", head: "HEAD", branch: "BRNCH-121-x" });
    expect(good.ok).to.equal(true);
  });
});
