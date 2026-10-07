// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * F15 (svm-geneva re-walk, 2026-10-07). An org already governed turns `gov setup` into a JOIN — but its governance repo
 * was on an OLDER framework layout than this gov (`governance/`, no policies/governance.yaml). Join printed "Read
 * first" paths that did not exist there, then offered to start work, which failed at seed ("todo-template.md is
 * missing… Run gov upgrade").
 *
 * Join compares the repo to itself first. Older → said plainly, with who brings it forward and what changes for the
 * joiner meanwhile; only paths that exist are printed; no offer to start work. The Policy Owner is offered the upgrade
 * pull request directly.
 */
import { expect } from "chai";
import { runFirstRun, type FirstRunIo } from "../../src/cli/bootstrap.js";
import { joinerNextSteps } from "../../src/cli/next-steps.js";
import { assessFrameworkCurrency, policyOwnerFacts } from "../../src/maintain/framework-currency.js";

/** The svm-geneva repo as the walk found it: the old `governance/` layout, no governance.yaml, no todo template. */
const OLD_LAYOUT = new Set(["governance/policies", "org-config.yaml", "agent/session-protocol.md", "policies/authorized-representatives.md"]);
const CURRENT = new Set(["framework/rules", "framework/docs/specs", "framework/docs/specs/framework-specification.md", "policies/governance.yaml",
  "framework/templates/todo-template.md", "agent/session-protocol.md", "policies/authorized-representatives.md", "framework/docs/user-guides/path-joiner.md"]);

const OLD = assessFrameworkCurrency((p) => OLD_LAYOUT.has(p), "1.0.4", "1.2.3");
const NOW = assessFrameworkCurrency((p) => CURRENT.has(p), "1.2.3", "1.2.3");

function joinIo(over: Partial<FirstRunIo> = {}) {
  const out: string[] = [];
  const asked: string[] = [];
  let reviewed = 0;
  const w: FirstRunIo = {
    facts: { orgs: [], active: null, interactive: true },
    homeDir: "/home/rk",
    prompt: async (q: string, def: string) => {
      asked.push(q);
      if (/Select \(A\/B\/C\)/.test(q)) return "B";
      if (/^Q1 - /.test(q)) return "svm-geneva";
      if (/^Q2 - /.test(q)) return "svm-geneva-gov";
      return def;
    },
    print: (l) => out.push(l),
    tempDir: () => "/tmp/boot",
    clone: () => {},
    readIdentity: () => ({ org: "svm-geneva", orgSlug: "GENEVA" }),
    exists: () => false,
    place: () => {},
    discard: () => {},
    found: async () => null,
    createWorkspace: async () => 0,
    register: () => ({ ok: true }),
    activate: () => ({ ok: true }),
    reviewNow: async () => { reviewed++; return 0; },
    ...over,
  };
  return { w, out, asked, reviewed: () => reviewed };
}

describe("F15 — joining an organization whose governance is on an older framework", () => {
  it("the comparison: old layout → older, cannot start work, each gap named; current → neither", () => {
    expect(OLD.older).to.equal(true);
    expect(OLD.canStartWork).to.equal(false);
    expect(OLD.gaps.join("\n")).to.match(/governance\/` layout/).and.to.match(/governance\.yaml/).and.to.match(/todo-template\.md/);
    expect(NOW.older).to.equal(false);
    expect(NOW.canStartWork).to.equal(true);
    // A version behind, on the current layout, is reported but blocks nothing.
    const behind = assessFrameworkCurrency((p) => CURRENT.has(p), "1.2.0", "1.2.3");
    expect(behind.older).to.equal(true);
    expect(behind.canStartWork).to.equal(true);
  });

  it("the Policy Owner is read from governance.yaml, else the legacy org-config key, and matched to the signed-in login", () => {
    expect(policyOwnerFacts('policy_owner:\n  email: ""\n  github: "@Rkant"\n', null, "rkant")).to.deep.equal({ handle: "@Rkant", isYou: true });
    expect(policyOwnerFacts(null, 'org_name: "x"\npolicy_owner_github: "@rkant"\n', "someone")).to.deep.equal({ handle: "@rkant", isYou: false });
    expect(policyOwnerFacts(null, null, "rkant")).to.deep.equal({ handle: null, isYou: false });
  });

  it("says so plainly, names who acts and what changes for the joiner — and does NOT offer to start work", async () => {
    const { w, out, asked, reviewed } = joinIo({
      frameworkCurrency: () => OLD,
      policyOwner: () => ({ handle: "@polly", isYou: false }),
      openUpgradePr: async () => { throw new Error("a joiner who is not the Policy Owner is never offered the upgrade"); },
    });
    expect(await runFirstRun(w)).to.equal(0);
    const text = out.join("\n");
    expect(text).to.match(/your organization's governance is on an older framework/i);
    expect(text).to.match(/Policy Owner \(@polly\) brings it forward: {2}gov upgrade --pr/);
    expect(text).to.match(/What that means for you/);
    expect(asked.some((q) => /start work now/.test(q)), "no offer to start work").to.equal(false);
    expect(reviewed()).to.equal(0);
  });

  it("the Policy Owner at the keyboard is offered the upgrade pull request directly", async () => {
    const opened: string[] = [];
    const { w, out, asked } = joinIo({
      frameworkCurrency: () => OLD,
      policyOwner: () => ({ handle: "@rkant", isYou: true }),
      openUpgradePr: async (home) => { opened.push(home); return 0; },
    });
    expect(await runFirstRun(w)).to.equal(0);
    expect(asked.some((q) => /Open the upgrade pull request now/.test(q))).to.equal(true);
    expect(opened).to.have.length(1);
    expect(out.join("\n")).to.match(/As its Policy Owner, you bring it forward/);
    expect(asked.some((q) => /start work now/.test(q))).to.equal(false);
  });

  it("the Policy Owner may decline; nothing is opened and the command is named", async () => {
    let opened = 0;
    const { w, out } = joinIo({
      prompt: async (q, def) => (/Select \(A\/B\/C\)/.test(q) ? "B" : /^Q1 - /.test(q) ? "svm-geneva" : /^Q2 - /.test(q) ? "svm-geneva-gov" : /upgrade pull request now/.test(q) ? "n" : def),
      frameworkCurrency: () => OLD,
      policyOwner: () => ({ handle: "@rkant", isYou: true }),
      openUpgradePr: async () => { opened++; return 0; },
    });
    expect(await runFirstRun(w)).to.equal(0);
    expect(opened).to.equal(0);
    expect(out.join("\n")).to.match(/When you are ready: {2}cd .* && gov upgrade --pr/);
  });

  it("a current repository joins exactly as before — the offer to start work stays", async () => {
    const { w, asked, reviewed } = joinIo({ frameworkCurrency: () => NOW, policyOwner: () => ({ handle: "@polly", isYou: false }) });
    expect(await runFirstRun(w)).to.equal(0);
    expect(asked.some((q) => /start work now/.test(q))).to.equal(true);
    expect(reviewed()).to.equal(1);
  });

  it("the joiner's next steps print only paths that exist, and no 'start working' block when work cannot start", () => {
    const F = { orgSlug: "GENEVA", githubOrg: "svm-geneva", workspaceRepo: "svm-geneva-gov", workspacePath: "/h/gov_repo" };
    const lines = joinerNextSteps(F, false, { exists: (p) => OLD_LAYOUT.has(p), canStartWork: false }).join("\n");
    expect(lines).to.not.contain("framework-specification.md");
    expect(lines).to.not.contain("path-joiner.md");
    expect(lines).to.contain("/h/gov_repo/agent/session-protocol.md");
    expect(lines).to.not.match(/Then start working/);
    // No caption is left without its path.
    expect(lines).to.not.match(/how work is organized, what must be reviewed/);
    // Unchanged when everything exists.
    expect(joinerNextSteps(F, false, { exists: (p) => CURRENT.has(p), canStartWork: true }).join("\n"))
      .to.contain("framework-specification.md").and.to.match(/Then start working/);
  });
});

