// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** The adoption checklist (#186) — derived from the machine, never from a file. */
import { expect } from "chai";
import { checklist, renderChecklist, statusSoFar, finalStatus, stepBanner, stepDone } from "../../src/cli/checklist.js";
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

  it("step 8 differs by role, and only step 8", () => {
    const adopter = checklist({ ...BARE, role: "adopter" });
    const joiner = checklist({ ...BARE, role: "joiner" });

    // An adopter founds an organization; a joiner clones one that exists. Listing the
    // founding steps against a joiner's name would be a list of things they must not do.
    expect(renderChecklist(adopter).join("\n")).to.contain("from the framework template");
    expect(renderChecklist(joiner).join("\n")).to.not.contain("from the framework template");
    expect(renderChecklist(joiner).join("\n")).to.contain("Clone it to");

    // Everything either side of 8 is the same run, under the same numbers.
    const tops = (l: typeof adopter) => l.filter((i) => !i.sub).map((i) => i.n);
    expect(tops(adopter)).to.deep.equal(tops(joiner));
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

  it("the final status repeats every path, because it is meant to be screenshotted", () => {
    const lines = finalStatus(checklist({
      ...BARE, role: "adopter", workspaceResolves: true, orgActive: "svm-geneva",
      workspacePath: "/home/t/.gov/geneva/gov_repo", orgSlug: "GENEVA",
    })).join("\n");
    expect(lines).to.contain("worth a screenshot");
    expect(lines).to.contain("/home/t/.gov/geneva/gov_repo");
    expect(lines, "and where projects will land").to.contain("~/.gov/geneva/projects");
  });

  it("a step opens with a banner carrying its own number, and closes ticked", () => {
    const item = checklist({ ...BARE, gitPresent: false })[2]!;   // step 3, git
    expect(stepBanner(item).join("\n")).to.contain("===> 3. Install dependency — git");
    expect(stepDone(item)).to.contain("===> 3. [✓]");
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

describe("gov-work — the two steps that used to be unobservable (#196, Q12)", () => {
  const A = {
    gitPresent: true, ghPresent: true, ghAuthenticated: true, ghScopesOk: true,
    gitIdentityOk: true, workspaceResolves: true, orgActive: "svm-geneva",
    workspacePath: "/home/t/.gov/geneva/gov_repo", orgSlug: "GENEVA", role: "adopter" as const,
  };

  it("choosing the approved agents is a step, and it ticks when the block exists", () => {
    const before = checklist({ ...A });
    const after = checklist({ ...A, approvedAgents: ["claude-code"] });
    const find = (l: typeof before) => l.find((i) => i.text.includes("which AI agents"))!;
    expect(find(before).done, "no block yet").to.equal(false);
    expect(find(after).done, "the block is the evidence").to.equal(true);
  });

  it("'policies reviewed' derives from the starter issue being closed", () => {
    // No progress file: a recorded tick is a copy of a fact the world already holds,
    // and a stale one skips a step that never happened.
    const open = checklist({ ...A, policiesReviewed: false });
    const closed = checklist({ ...A, policiesReviewed: true });
    const find = (l: typeof open) => l.find((i) => i.text.includes("Review the seeded policies"))!;
    expect(find(open).done).to.equal(false);
    expect(find(closed).done).to.equal(true);
  });

  it("a joiner is asked neither — both belong to founding an organization", () => {
    const joiner = renderChecklist(checklist({ ...A, role: "joiner" })).join("\n");
    expect(joiner).to.not.contain("which AI agents");
    expect(joiner).to.not.contain("Review the seeded policies");
  });
});

describe("gov-work — the checklist tells the truth about where you are (#186)", () => {
  const BARE2 = {
    gitPresent: true, ghPresent: true, ghAuthenticated: true, ghScopesOk: true,
    gitIdentityOk: true, workspaceResolves: false, orgActive: null,
    workspacePath: null, orgSlug: null,
  };

  it("before the role is known, it shows neither branch", () => {
    // It used to fall through to the adopter's, so someone who had not yet been asked
    // whether they were adopting or joining was shown five steps about founding an
    // organization, as though the answer were already given.
    const text = renderChecklist(checklist({ ...BARE2, role: null })).join("\n");
    expect(text).to.contain("(adopters) — or bring in your org's (joiners)");
    expect(text, "no founding sub-steps yet").to.not.contain("from the framework template");
    expect(text).to.not.contain("Choose which AI agents");
  });

  it("'where things stand' counts what is left; 'final status' is only for the end", () => {
    // "Final status" appeared at the end of doctor --fix, with the organization still
    // to set up and the next question already queued. A heading that announces an
    // ending which has not come teaches the reader to distrust the screen.
    const mid = statusSoFar(checklist({ ...BARE2, role: null })).join("\n");
    expect(mid).to.contain("still to go");
    expect(mid).to.not.contain("Final status");

    const done = statusSoFar(checklist({
      ...BARE2, role: "joiner", workspaceResolves: true, orgActive: "svm-geneva", workspacePath: "/h/gov",
    })).join("\n");
    expect(done).to.contain("everything on this machine is done");
  });
});

describe("gov-work — a probe must not be disabled by a stale capture (#186)", () => {
  it("git's identity is readable on a machine where git was installed mid-run", () => {
    // The bug: `gitCfg` was guarded by a `gitPresent` captured BEFORE the run. On a
    // fresh machine that is false, `--fix` then installs git, the identity step
    // succeeds — and the probe stays disabled, so the checklist reports step 6
    // undone. Third time in this issue that a value was read before the step that
    // changes it (gh scopes before the login, git identity before git existed).
    //
    // Modelled here as the checklist's own contract: the fact is supplied, and the
    // tick follows the fact rather than anything captured earlier.
    const before = checklist({
      gitPresent: false, ghPresent: false, ghAuthenticated: false, ghScopesOk: false,
      gitIdentityOk: false, workspaceResolves: false, orgActive: null,
      workspacePath: null, orgSlug: null, role: null,
    });
    const after = checklist({
      gitPresent: true, ghPresent: true, ghAuthenticated: true, ghScopesOk: true,
      gitIdentityOk: true, workspaceResolves: false, orgActive: null,
      workspacePath: null, orgSlug: null, role: null,
    });
    const step6 = (l: typeof before) => l.find((i) => i.text.startsWith("Configure git"))!;
    expect(step6(before).done).to.equal(false);
    expect(step6(after).done, "installed and configured in the same run").to.equal(true);
  });
});

/**
 * COLOUR IS A SECOND CHANNEL (#204). The checklist and the doctor report are the two screens an
 * adopter reads most, and both stayed plain while the installer around them did not. What these
 * pin is that turning the colour on changes nothing except the colour.
 */
describe("gov-work — the checklist in colour (#204)", () => {
  // eslint-disable-next-line no-control-regex
  const strip = (s: string): string => s.replace(/\u001b\[\d+m/g, "");
  const items = checklist({ ...BARE, gitPresent: true });

  it("stripping the codes gives back exactly the plain render", () => {
    expect(renderChecklist(items, true).map(strip)).to.deep.equal([...renderChecklist(items, false)]);
    expect(statusSoFar(items, true).map(strip)).to.deep.equal([...statusSoFar(items, false)]);
    expect(finalStatus(items, true).map(strip)).to.deep.equal([...finalStatus(items, false)]);
    expect(strip(stepDone(items[0]!, true, true))).to.equal(stepDone(items[0]!, true, false));
    expect(stepBanner(items[0]!, true).map(strip)).to.deep.equal([...stepBanner(items[0]!, false)]);
  });

  it("plain is the default — a caller that has not been told where it writes stays plain", () => {
    expect(renderChecklist(items).join("")).to.not.contain("\u001b");
    expect(finalStatus(items).join("")).to.not.contain("\u001b");
  });

  it("the box still says done or not with no colour at all", () => {
    const plain = renderChecklist(items, false);
    expect(plain[0], "step 1 is done by construction").to.contain("[\u2713]");
    expect(plain.find((l) => /gh, the GitHub CLI/.test(l))).to.contain("[ ]");
  });
});
