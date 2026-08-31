// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** The adoption checklist (#186) — derived from the machine, never from a file. */
import { expect } from "chai";
import { checklist, renderChecklist, checklistProgress } from "../../src/cli/checklist.js";
import { adopterNextSteps, joinerNextSteps } from "../../src/cli/next-steps.js";

const BARE = {
  gitPresent: false, ghPresent: false, ghAuthenticated: false, ghScopesOk: false,
  gitIdentityOk: false, workspaceResolves: false, orgActive: null,
  workspacePath: null, orgSlug: null, role: null as null,
};

describe("gov-work — the adoption checklist (#186)", () => {
  it("ticks Node and gov by construction — if you can read this, they are done", () => {
    const items = checklist(BARE);
    expect(items[0]!.done, "Node").to.equal(true);
    expect(items[1]!.done, "gov").to.equal(true);
    expect(items.slice(2).every((i) => !i.done), "and nothing else").to.equal(true);
  });

  it("shows the commands that will actually run, not generic ones", () => {
    const lines = renderChecklist(checklist({
      ...BARE,
      installCmd: { git: "sudo dnf install -y git", ghRepo: "sudo curl … gh-cli.repo", gh: "sudo dnf install -y gh" },
    })).join("\n");
    expect(lines).to.contain("sudo dnf install -y git");
    expect(lines, "the RHEL repo step only appears where it applies").to.contain("gh-cli.repo");
  });

  it("omits the repo step where the distribution ships gh", () => {
    const lines = renderChecklist(checklist({
      ...BARE, installCmd: { git: "brew install git", gh: "brew install gh" },
    })).join("\n");
    expect(lines).to.not.contain("package repository");
  });

  it("lists the founding steps for an adopter, and not for a joiner", () => {
    const adopter = renderChecklist(checklist({ ...BARE, role: "adopter" })).join("\n");
    const joiner = renderChecklist(checklist({ ...BARE, role: "joiner" })).join("\n");
    expect(adopter).to.contain("adopters only");
    // Listing them against a joiner's name would be a list of things they must not do.
    expect(joiner).to.not.contain("adopters only");
  });

  it("fills in the real paths once they exist, instead of the placeholder", () => {
    const done = renderChecklist(checklist({
      ...BARE, workspaceResolves: true, orgActive: "svm-geneva",
      workspacePath: "/home/tester/.gov/geneva/gov_repo", orgSlug: "GENEVA",
    })).join("\n");
    expect(done).to.contain("/home/tester/.gov/geneva/gov_repo");
    expect(done).to.not.contain("<org-slug>");
    expect(done).to.contain("svm-geneva →");
  });

  it("counts only top-level steps, so progress does not jump on a sub-item", () => {
    const lines = checklistProgress(checklist({ ...BARE, gitPresent: true })).join("\n");
    expect(lines).to.match(/Progress — 3 of \d+ done/);
  });
});

describe("gov-work — what to do now (#186)", () => {
  const F = { orgSlug: "GENEVA", githubOrg: "svm-geneva", workspaceRepo: "svm-geneva-gov", workspacePath: "/home/t/.gov/geneva/gov_repo" };

  it("an adopter is told the policies are not theirs yet, and given three routes", () => {
    const t = adopterNextSteps(F).join("\n");
    expect(t).to.contain("not your organization's");
    expect(t).to.contain("https://github.com/svm-geneva");
    expect(t, "and which route bypasses the review").to.contain("UNGOVERNED");
    expect(t, "and which one is the point").to.contain("the governed way");
  });

  it("a joiner is told the opposite — it is settled, here is where to read it", () => {
    const t = joinerNextSteps(F).join("\n");
    expect(t).to.contain("nothing for you to configure");
    expect(t).to.contain("agentic-development-policy.md");
    expect(t, "and how to push back without working around it").to.contain("gov knowledge propose");
    expect(t, "no founding instructions").to.not.contain("UNGOVERNED");
  });
});
