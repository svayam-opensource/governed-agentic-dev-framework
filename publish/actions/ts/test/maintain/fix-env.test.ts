// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov doctor --fix` planning (#186). Every case here is a shape a real adopter
 * arrived in: no package manager, an old distro without `gh` in its archive, a
 * tool installed but never signed in.
 */
import { expect } from "chai";
import { detectPackageManager, planFixes, renderCommand, formatPlan, parseGrantedScopes, missingScopes } from "../../src/maintain/fix-env.js";

const has = (...present: string[]) => (name: string): boolean => present.includes(name);

describe("gov-work — doctor --fix planning", () => {
  it("prefers brew when it is present, even alongside others", () => {
    expect(detectPackageManager(has("brew", "apt-get"))).to.equal("brew");
  });

  it("drives apt through apt-get, not apt", () => {
    expect(detectPackageManager(has("apt-get"))).to.equal("apt");
  });

  it("returns null when the machine has no package manager we know", () => {
    expect(detectPackageManager(has("git"))).to.equal(null);
  });

  it("plans nothing when everything is already in place", () => {
    const plan = planFixes({ gitPresent: true, ghPresent: true, ghAuthenticated: true, platform: "linux" }, "dnf");
    expect(plan.steps).to.have.length(0);
    expect(plan.manual).to.have.length(0);
    expect(formatPlan(plan)).to.deep.equal(["doctor --fix: nothing to fix"]);
  });

  it("installs gh BEFORE trying to sign in with it", () => {
    const plan = planFixes({ gitPresent: true, ghPresent: false, ghAuthenticated: false, platform: "darwin" }, "brew");
    expect(plan.steps.map((s) => s.fixes)).to.deep.equal(["gh", "gh auth"]);
    expect(plan.steps[1]!.dependsOn).to.deep.equal(["gh"]);
  });

  it("adds GitHub's repository on RHEL-family systems, which do not ship gh", () => {
    const plan = planFixes({ gitPresent: true, ghPresent: false, ghAuthenticated: false, platform: "linux", osId: "rocky" }, "dnf");
    expect(plan.steps.map((s) => s.fixes)).to.deep.equal(["gh repo", "gh", "gh auth"]);
    // Dropped as a file, not added via `config-manager`: that is a plugin absent
    // from minimal images, and dnf5 renamed its syntax.
    expect(plan.steps[0]!.command[0]).to.equal("curl");
    expect(plan.steps[0]!.command.join(" ")).to.contain("/etc/yum.repos.d/gh-cli.repo");
    expect(plan.steps[1]!.dependsOn).to.deep.equal(["gh repo"]);
  });

  it("does NOT add a repository on Fedora, which ships gh itself", () => {
    const plan = planFixes({ gitPresent: true, ghPresent: false, ghAuthenticated: false, platform: "linux", osId: "fedora" }, "dnf");
    expect(plan.steps.map((s) => s.fixes)).to.deep.equal(["gh", "gh auth"]);
    expect(plan.steps[0]!.dependsOn).to.equal(undefined);
  });

  it("adds the repository when the distribution is unknown — the safe assumption on dnf", () => {
    const plan = planFixes({ gitPresent: true, ghPresent: false, ghAuthenticated: false, platform: "linux", osId: null }, "dnf");
    expect(plan.steps.map((s) => s.fixes)).to.deep.equal(["gh repo", "gh", "gh auth"]);
  });

  it("does not chain the login when gh is already installed — only the sign-in is missing", () => {
    const plan = planFixes({ gitPresent: true, ghPresent: true, ghAuthenticated: false, platform: "linux", osId: "rocky" }, "dnf");
    expect(plan.steps.map((s) => s.fixes)).to.deep.equal(["gh auth"]);
    expect(plan.steps[0]!.dependsOn).to.equal(undefined);
  });

  it("treats 'installed but not signed in' as its own fixable failure", () => {
    const plan = planFixes({ gitPresent: true, ghPresent: true, ghAuthenticated: false, platform: "darwin" }, "brew");
    expect(plan.steps).to.have.length(1);
    // The scopes are requested AT login: a bare `gh auth login` grants gh's own
    // minimum, and the gap would only be visible on a later run.
    expect(renderCommand(plan.steps[0]!)).to.equal("gh auth login -s repo,read:org,project");
    expect(plan.steps[0]!.interactive).to.equal(true);
  });

  it("marks system package managers as needing sudo, and brew/winget as not", () => {
    const linux = planFixes({ gitPresent: false, ghPresent: true, ghAuthenticated: true, platform: "linux" }, "apt");
    expect(linux.steps[0]!.sudo).to.equal(true);
    expect(renderCommand(linux.steps[0]!)).to.equal("sudo apt-get install -y git");

    const mac = planFixes({ gitPresent: false, ghPresent: true, ghAuthenticated: true, platform: "darwin" }, "brew");
    expect(mac.steps[0]!.sudo).to.equal(false);

    const win = planFixes({ gitPresent: false, ghPresent: true, ghAuthenticated: true, platform: "win32" }, "winget");
    expect(win.steps[0]!.sudo).to.equal(false);
  });

  it("never plans a command it cannot run — it says what to do instead", () => {
    const plan = planFixes({ gitPresent: false, ghPresent: false, ghAuthenticated: false, platform: "linux" }, null);
    // The login and the identity are still planned — neither needs a package
    // manager, and both become possible the moment the tools are installed by hand.
    expect(plan.steps.map((s) => s.fixes)).to.deep.equal(["gh auth", "git identity"]);
    expect(plan.manual).to.have.length(2);
    expect(plan.manual.join(" ")).to.contain("git-scm.com");
    expect(plan.manual.join(" ")).to.contain("cli.github.com");
  });

  it("warns apt users that older archives have no gh candidate", () => {
    const plan = planFixes({ gitPresent: true, ghPresent: false, ghAuthenticated: false, platform: "linux" }, "apt");
    expect(plan.manual.join(" ")).to.contain("install_linux.md");
  });

  it("renders a plan a non-specialist can consent to — intent above command", () => {
    const plan = planFixes({ gitPresent: false, ghPresent: true, ghAuthenticated: true, platform: "linux" }, "dnf");
    const lines = formatPlan(plan);
    expect(lines[0]).to.equal("These commands will fix what is missing:");
    expect(lines[1]).to.contain("Install Git using dnf");
    expect(lines[2]).to.contain("sudo dnf install -y git");
  });
});

describe("gov-work — gh token scopes", () => {
  it("reads the granted scopes out of gh's own status output", () => {
    const out = "github.com\n  ✓ Logged in to github.com account rkant\n  - Token scopes: 'project', 'read:org', 'repo'\n";
    expect(parseGrantedScopes(out)).to.deep.equal(["project", "read:org", "repo"]);
  });

  it("returns null when the line is absent — unknown is not the same as missing", () => {
    expect(parseGrantedScopes("You are not logged into any GitHub hosts.")).to.equal(null);
  });

  it("wants `project`, which gh's own login minimum does not grant", () => {
    // gh advertises "repo, read:org, admin:public_key". A board IS a project here.
    expect(missingScopes(["repo", "read:org", "admin:public_key"]).map((m) => m.scope)).to.deep.equal(["project"]);
  });

  it("is satisfied by a token that has all three", () => {
    expect(missingScopes(["repo", "read:org", "project", "workflow"])).to.have.length(0);
  });

  it("plans a scope refresh, and never a re-login — refresh adds, login replaces", () => {
    const plan = planFixes(
      { gitPresent: true, ghPresent: true, ghAuthenticated: true, platform: "linux", osId: "fedora", ghScopes: ["repo", "read:org"] },
      "dnf",
    );
    expect(plan.steps.map((s) => s.fixes)).to.deep.equal(["gh scopes"]);
    expect(renderCommand(plan.steps[0]!)).to.equal("gh auth refresh -s project");
    expect(plan.steps[0]!.interactive, "it opens a browser").to.equal(true);
  });

  it("asks for gov's scopes during the sign-in, not on a later run", () => {
    const plan = planFixes({ gitPresent: true, ghPresent: true, ghAuthenticated: false, platform: "linux", osId: "fedora" }, "dnf");
    const login = plan.steps.find((s) => s.fixes === "gh auth")!;
    expect(login.command).to.include("-s");
    expect(login.command.join(" ")).to.contain("project");
  });

  it("says nothing about scopes when they could not be read", () => {
    const plan = planFixes(
      { gitPresent: true, ghPresent: true, ghAuthenticated: true, platform: "linux", osId: "fedora", ghScopes: null },
      "dnf",
    );
    expect(plan.steps).to.have.length(0);
  });
});

describe("gov-work — git identity", () => {
  it("treats a git with no identity as broken, not as installed", () => {
    const plan = planFixes(
      { gitPresent: true, ghPresent: true, ghAuthenticated: true, platform: "linux", osId: "fedora",
        ghScopes: ["repo", "read:org", "project"], gitIdentity: { name: null, email: null } },
      "dnf",
    );
    expect(plan.steps.map((s) => s.fixes)).to.deep.equal(["git identity"]);
    expect(plan.steps[0]!.why).to.contain("refuses to commit");
  });

  it("names only what is actually missing", () => {
    const plan = planFixes(
      { gitPresent: true, ghPresent: true, ghAuthenticated: true, platform: "linux", osId: "fedora",
        ghScopes: ["repo", "read:org", "project"], gitIdentity: { name: "Rakesh", email: null } },
      "dnf",
    );
    expect(plan.steps[0]!.what).to.contain("user.email");
    expect(plan.steps[0]!.what).to.not.contain("user.name");
  });

  it("waits for gh when gh is being installed — the defaults come from the account", () => {
    const plan = planFixes(
      { gitPresent: true, ghPresent: false, ghAuthenticated: false, platform: "darwin",
        gitIdentity: { name: null, email: null } },
      "brew",
    );
    expect(plan.steps.find((s) => s.fixes === "git identity")!.dependsOn).to.deep.equal(["gh auth"]);
  });

  it("plans the identity even when git does not exist yet — a fresh git has none", () => {
    // The defect: the identity was planned from `facts.gitIdentity`, which is
    // unknowable on a machine with no git. Nothing was planned, git was installed
    // without one, and `gov work` refused several minutes later.
    const plan = planFixes(
      { gitPresent: false, ghPresent: false, ghAuthenticated: false, platform: "linux", osId: "rocky" },
      "dnf",
    );
    const identity = plan.steps.find((s) => s.fixes === "git identity");
    expect(identity, "a git about to be installed has no identity, by definition").to.not.equal(undefined);
    expect(identity!.dependsOn).to.deep.equal(["git", "gh auth"]);
    expect(identity!.why).to.contain("fresh git does not know who you are");
  });

  it("the whole cold-start plan, in the order it must run", () => {
    const plan = planFixes(
      { gitPresent: false, ghPresent: false, ghAuthenticated: false, platform: "linux", osId: "rocky" },
      "dnf",
    );
    expect(plan.steps.map((s) => s.fixes)).to.deep.equal(
      ["git", "gh repo", "gh", "gh auth", "git identity"],
    );
  });

  it("says nothing when git already knows who you are", () => {
    const plan = planFixes(
      { gitPresent: true, ghPresent: true, ghAuthenticated: true, platform: "linux", osId: "fedora",
        ghScopes: ["repo", "read:org", "project"], gitIdentity: { name: "R", email: "r@x.io" } },
      "dnf",
    );
    expect(plan.steps).to.have.length(0);
  });
});
