// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov setup <org>/<repo>` — the create path (#159).
 *
 * The behaviour worth protecting here is mostly about what does NOT happen: no repository is created
 * until every precondition holds, because `gh` cannot delete one back without the `delete_repo` scope
 * that a normal `gh auth login` does not grant. A half-made repo in an adopter's GitHub org is not
 * recoverable by this tool, so the tests below are largely about refusing early and saying why.
 */
import { expect } from "chai";
import { parseTarget, derivedPaths, suggestRepoName, preflight, explainFailure, findExistingGovernanceRepo, waitForTemplateContent, canAdoptExisting, archivePathFor, substituteTokens, leftoverTokens, type CreateIo, expectedDirs, tokenValuesFromOrgConfig, PER_PROJECT_TOKENS } from "../../src/setup/create.js";

/** A machine where everything is fine: signed in, org reachable, no governance repo, nothing at the path. */
const okIo = (over: Partial<CreateIo> = {}): CreateIo => ({
  gh: (a) => {
    if (a[0] === "auth") return "Token scopes: 'project', 'read:org', 'repo', 'workflow'";
    // BEFORE the plain `api` branch — otherwise the graphql probe gets "acme", the JSON parse throws,
    // and "no governance repo found" is reached by accident rather than by the code under test.
    if (a[0] === "api" && a[1] === "graphql") return '{"repos":[],"more":false}';
    if (a[0] === "api") return "acme";
    return null;
  },
  home: "/home/u",
  exists: () => false,
  print: () => {},
  ...over,
});

describe("gov setup <org>/<repo> — target parsing", () => {
  it("accepts <org>/<repo>", () => {
    expect(parseTarget("acme/acme-gov")).to.deep.equal({ org: "acme", repo: "acme-gov" });
    expect(parseTarget("  acme/acme-gov  ")).to.deep.equal({ org: "acme", repo: "acme-gov" });
    expect(parseTarget("Acme-Corp/gov.work_1")).to.deep.equal({ org: "Acme-Corp", repo: "gov.work_1" });
  });

  // Each of these is something a hurried adopter types, and each would otherwise create a repository
  // somewhere they did not intend.
  it("rejects everything that is not exactly <org>/<repo>", () => {
    for (const bad of ["acme", "acme/", "/repo", "acme/repo/extra", "https://github.com/acme/repo",
                       "git@github.com:acme/repo.git", "", "   ", "-acme/repo", "acme/.hidden"]) {
      expect(parseTarget(bad), `should reject ${JSON.stringify(bad)}`).to.equal(null);
    }
  });
});

describe("derived locations (contract R9)", () => {
  it("puts the mirror, work root and registry where the contract says", () => {
    expect(derivedPaths("/home/u", "ACME")).to.deep.equal({
      govRepo: "/home/u/.gov/acme/gov_repo",
      workRoot: "/home/u/.gov/acme/projects",
      registry: "/home/u/.gov/workspaces",
      active: "/home/u/.gov/active",
    });
  });

  it("lowercases the slug — one hidden root, plain names inside, never ~/.gov/.acme", () => {
    const p = derivedPaths("/home/u", "AcMe");
    expect(p.govRepo).to.equal("/home/u/.gov/acme/gov_repo");
    expect(p.govRepo).to.not.contain("/.acme");
  });

  it("suggests a repo name so the adopter need not invent one", () => {
    expect(suggestRepoName("ACME")).to.equal("acme-gov");
  });
});

describe("preflight — nothing is created until all of this holds", () => {
  it("passes on a healthy machine and reports where the mirror will go", () => {
    const r = preflight(okIo(), "acme/acme-gov", "ACME");
    expect(r.ok).to.equal(true);
    if (r.ok) {
      expect(r.govRepo).to.equal("/home/u/.gov/acme/gov_repo");
      expect(r.warnings).to.deep.equal([]);
    }
  });

  it("honours --path, and still checks it is free", () => {
    const r = preflight(okIo(), "acme/acme-gov", "ACME", "/opt/work/acme-gov");
    expect(r.ok && r.govRepo).to.equal("/opt/work/acme-gov");
    // An occupied path is the RETRY case, not a failure — the caller archives and adopts (#159 finding 2).
    const occupied = preflight(okIo({ exists: (p) => p === "/opt/work/acme-gov" }), "acme/acme-gov", "ACME", "/opt/work/acme-gov");
    expect(occupied.ok, "occupied path must not refuse — it is the retry path").to.equal(true);
  });

  it("refuses a malformed target before touching GitHub at all", () => {
    let calls = 0;
    const r = preflight(okIo({ gh: (a) => { calls++; return a[0] === "auth" ? "ok" : null; } }), "not-a-target", "ACME");
    expect(r.ok).to.equal(false);
    expect(calls, "a bad argument must not reach the network").to.equal(0);
  });

  it("refuses when gh is not signed in", () => {
    const r = preflight(okIo({ gh: () => null }), "acme/acme-gov", "ACME");
    expect(r.ok === false && r.failure.why).to.equal("not-authenticated");
  });

  // An org can forbid member repo creation with every scope present, so the scope list is not the
  // authority — ask GitHub about the org itself.
  it("refuses when the org is unreachable, naming the org", () => {
    const r = preflight(okIo({ gh: (a) => (a[0] === "auth" ? "scopes: repo" : null) }), "acme/acme-gov", "ACME");
    expect(r.ok === false && r.failure.why).to.equal("cannot-create");
    if (!r.ok && r.failure.why === "cannot-create") expect(r.failure.org).to.equal("acme");
  });

  it("warns — but does NOT fail — when the project scope is missing", () => {
    const r = preflight(okIo({ gh: (a) => {
      if (a[0] === "auth") return "Token scopes: 'read:org', 'repo'";
      if (a[0] === "api" && a[1] === "graphql") return '{"repos":[],"more":false}';
      if (a[0] === "api") return "acme";
      return "";
    } }), "acme/acme-gov", "ACME");
    expect(r.ok, "a missing project scope must not block adoption — it matters at `gov seed`, not now").to.equal(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.what)).to.deep.equal(["no-project-scope"]);
      expect(r.warnings[0].detail).to.contain("gh auth refresh -s project");
    }
  });
});

/**
 * The framework's worst silent failure. A second developer at an adopting org runs create — and they are
 * new, which is why they are running it — and makes a SECOND governance repo. The org's policy forks, and
 * nothing downstream notices: both repos validate and both resolve.
 */
describe("second-adopter safety", () => {
  const governed = okIo({ gh: (a) => {
    if (a[0] === "auth") return "Token scopes: 'project', 'repo'";
    if (a[0] === "api" && a[1] === "graphql") return '{"repos":["acme/acme-gov"],"more":false}';
    if (a[0] === "api") return "acme";
    return null;
  } });

  it("finds an existing governance repo by CONTENT, not by name", () => {
    // Searched by org-config.yaml because the NAME is exactly what a second adopter picks differently.
    expect(findExistingGovernanceRepo(governed, "acme").repos).to.deep.equal(["acme/acme-gov"]);
    expect(findExistingGovernanceRepo(okIo(), "acme").repos).to.deep.equal([]);
  });

  // REGRESSION. The first implementation used `gh search code`, which does NOT index private
  // repositories — and every governance repo is private. Verified against a real org: search/code
  // reported total_count 0 while the contents API served org-config.yaml immediately. It would have
  // reported "clear" and created a second governance repo on the org it was meant to protect.
  it("does not use code search, which is blind to the private repos this must find", () => {
    const seen: string[][] = [];
    findExistingGovernanceRepo(okIo({ gh: (a) => { seen.push([...a]); return '{"repos":[],"more":false}'; } }), "acme");
    expect(seen.some((a) => a[0] === "search"), "code search cannot see private repos").to.equal(false);
    expect(seen.some((a) => a[0] === "api" && a[1] === "graphql"), "must ask each repo for the file").to.equal(true);
  });

  it("reports more than one, because an org can already have forked", () => {
    const many = okIo({ gh: (a) => {
      if (a[0] === "auth") return "scopes: project repo";
      if (a[0] === "api" && a[1] === "graphql") return '{"repos":["acme/a-gov","acme/b-gov"],"more":false}';
      if (a[0] === "api") return "acme";
      return null;
    } });
    const r = preflight(many, "acme/c-gov", "ACME");
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(explainFailure(r.failure).join("\n")).to.contain("already has 2 governance repos");
  });

  // No silent caps: an org past GraphQL's 100-repo page must not read as "none found".
  it("warns rather than silently limiting the scan on a large org", () => {
    const big = okIo({ gh: (a) => {
      if (a[0] === "auth") return "scopes: project repo";
      if (a[0] === "api" && a[1] === "graphql") return '{"repos":[],"more":true}';
      if (a[0] === "api") return "acme";
      return null;
    } });
    const r = preflight(big, "acme/acme-gov", "ACME");
    expect(r.ok).to.equal(true);
    if (r.ok) expect(r.warnings.map((w) => w.what)).to.contain("governance-scan-truncated");
  });

  it("refuses to create a second one", () => {
    const r = preflight(governed, "acme/acme-gov-2", "ACME");
    expect(r.ok).to.equal(false);
    if (!r.ok && r.failure.why === "already-governed") expect(r.failure.repo).to.equal("acme/acme-gov");
  });

  it("refuses INTO the join path — a bare refusal sends them off to create one under another name", () => {
    const r = preflight(governed, "acme/acme-gov-2", "ACME");
    const lines = r.ok ? [] : explainFailure(r.failure);
    expect(lines.join("\n")).to.contain("fork its policy");
    expect(lines.join("\n"), "must show HOW to join").to.contain("git clone git@github.com:acme/acme-gov.git");
    expect(lines.join("\n")).to.contain("gov setup");
  });
});

describe("failure messages name the next action, not just the problem", () => {
  it("a bad target explains BOTH modes of the one verb", () => {
    const lines = explainFailure({ why: "bad-target", got: "acme" }).join("\n");
    expect(lines, "the create form").to.contain("gov setup <github-org>/<repo-name>");
    expect(lines, "the configure form — bare setup must remain obviously available").to.contain("inside an existing workspace");
  });

  it("every failure prints a fix", () => {
    const all = [
      { why: "bad-target", got: "x" }, { why: "not-authenticated" }, { why: "cannot-create", org: "acme" },
      { why: "already-governed", repo: "acme/acme-gov", all: ["acme/acme-gov"] }, { why: "path-occupied", path: "/p" },
    ] as const;
    for (const f of all) {
      const lines = explainFailure(f);
      expect(lines.length, `${f.why} must say more than the problem`).to.be.greaterThan(1);
      expect(lines.join("\n"), `${f.why} must name an action`).to.match(/fix:|gov setup|git clone|--path/);
    }
  });
});

/**
 * Findings 1b and 1c, both from the FIRST real adoption run. Together they made a run that looked like
 * it worked produce a duplicate governance repo containing nothing.
 */
describe("#159 manual-test findings", () => {
  it("1b · a probe that could not run refuses, rather than reporting 'clear'", () => {
    // The org's governance repo was invisible to the token (404). The probe saw nothing and a duplicate
    // was created in an org that already had one. Blind is blind, whatever the cause.
    const blind = okIo({ gh: (a) => {
      if (a[0] === "auth") return "scopes: repo";
      if (a[0] === "api" && a[1] === "graphql") return null;      // cannot read the org
      if (a[0] === "api") return "acme";
      return null;
    } });
    expect(findExistingGovernanceRepo(blind, "acme").verified).to.equal(false);
    const r = preflight(blind, "acme/acme-gov", "ACME");
    expect(r.ok, "must not proceed on an unverified check").to.equal(false);
    if (!r.ok) {
      expect(r.failure.why).to.equal("cannot-verify");
      expect(explainFailure(r.failure).join("\n")).to.contain("fork your org's policy");
    }
  });

  it("1b · unparseable output is also unverified, not empty", () => {
    const junk = okIo({ gh: (a) => (a[0] === "api" && a[1] === "graphql" ? "not json" : a[0] === "auth" ? "scopes" : "acme") });
    expect(findExistingGovernanceRepo(junk, "acme").verified).to.equal(false);
  });

  it("1c · waits for the template copy instead of cloning an empty repo", () => {
    // `gh repo create --template` returns BEFORE the copy completes; the adopter's clone came back empty
    // while the remote ended up with 16 files.
    let calls = 0;
    const waits: number[] = [];
    const io = okIo({ gh: () => (++calls < 3 ? "0" : "16") });
    expect(waitForTemplateContent(io, { org: "acme", repo: "acme-gov" }, 10, (ms) => waits.push(ms))).to.equal(true);
    expect(calls, "must keep asking until content appears").to.equal(3);
    expect(waits, "backoff widens").to.deep.equal([1000, 2000]);
  });

  it("1c · gives up rather than cloning nothing, and says the repo still exists", () => {
    const io = okIo({ gh: () => "0" });
    expect(waitForTemplateContent(io, { org: "acme", repo: "acme-gov" }, 3, () => {})).to.equal(false);
  });

  it("1c · an unreadable contents API counts as not-ready, never as ready", () => {
    const io = okIo({ gh: () => null });
    expect(waitForTemplateContent(io, { org: "acme", repo: "acme-gov" }, 2, () => {})).to.equal(false);
  });
});

describe("#159 finding 2 — retry: archive, then adopt only what is provably ours", () => {
  const gh = (admin: string | null, commits: string | null) => okIo({ gh: (a) => {
    if (a[1]?.startsWith("repos/") && a.includes(".permissions.admin")) return admin;
    if (a[1]?.endsWith("/commits")) return commits;
    return admin;
  } });

  it("adopts a repo with no commits — a failed run left it", () => {
    expect(canAdoptExisting(gh("true", "0"), { org: "a", repo: "b" })).to.deep.equal({ adopt: true, why: "empty" });
  });

  it("adopts a single template-import commit", () => {
    expect(canAdoptExisting(gh("true", "1"), { org: "a", repo: "b" }).adopt).to.equal(true);
  });

  it("REFUSES a repo with real history — overwriting it would be unrecoverable", () => {
    const v = canAdoptExisting(gh("true", "7"), { org: "a", repo: "b" });
    expect(v.adopt).to.equal(false);
    if (!v.adopt) { expect(v.why).to.equal("not-ours"); expect(v.detail).to.contain("7 commits"); }
  });

  it("REFUSES when we are not an admin", () => {
    const v = canAdoptExisting(gh("false", "0"), { org: "a", repo: "b" });
    expect(v.adopt === false && v.why).to.equal("not-ours");
  });

  it("REFUSES when it cannot tell, rather than assuming the safe-looking answer", () => {
    const v = canAdoptExisting(gh(null, null), { org: "a", repo: "b" });
    expect(v.adopt === false && v.why).to.equal("cannot-tell");
  });

  it("archives beside the workspace, never inside it", () => {
    const a = archivePathFor("/home/u", "ACME", "2026-08-13T00-00-00Z");
    expect(a).to.equal("/home/u/.gov/acme/archive/2026-08-13T00-00-00Z/gov_repo");
    expect(a.startsWith("/home/u/.gov/acme/gov_repo"), "must not nest inside the live clone").to.equal(false);
  });
});

describe("#159 finding 6e — token sweep", () => {
  it("resolves org tokens and leaves unknown ones visible", () => {
    const out = substituteTokens("<ORG_NAME> runs <WORKSPACE_REPO>; <MYSTERY> stays", { ORG_NAME: "Acme", WORKSPACE_REPO: "acme-gov" });
    expect(out).to.equal("Acme runs acme-gov; <MYSTERY> stays");
  });

  it("reports leftovers, because a policy that still says <ORG_NAME> is the bug", () => {
    expect(leftoverTokens("hi <ORG_NAME> and <POLICY_OWNER_EMAIL>")).to.deep.equal(["<ORG_NAME>", "<POLICY_OWNER_EMAIL>"]);
    expect(leftoverTokens("no tokens here"), "lowercase <b> is markup, not a token").to.deep.equal([]);
  });
});

describe("gov-work — setup's own warnings (#193)", () => {
  it("expects every directory the manifest scaffolds, not a hand-kept list", () => {
    const manifest = `
files:
  - { src: .claude/hooks/, dst: .claude/hooks/, mode: scaffold-auto }
  - { src: .cursor/rules/agent.mdc, dst: .cursor/rules/agent.mdc, mode: scaffold-prompt }
  - { src: docs/USER_GUIDE.md, dst: docs/USER_GUIDE.md, mode: scaffold-prompt }
  - { src: projects/README.md, dst: projects/README.md, mode: scaffold-auto }
  - { src: README.md, dst: README.md, mode: scaffold-prompt }
`;
    const dirs = expectedDirs(manifest);
    for (const d of [".claude", ".cursor", "docs", "projects"]) expect(dirs, d).to.include(d);
    expect(dirs, "the floor is still there").to.include.members(["agent", "knowledge", "publish"]);
    expect(dirs, "a root-level FILE is not a directory").to.not.include("README.md");
  });

  it("survives a missing manifest by falling back to the floor", () => {
    expect(expectedDirs(null)).to.deep.equal(["agent", "knowledge", "publish"]);
  });

  it("reads token values from the file, including keys gov-work itself never parses", () => {
    const cfg = [
      'org_name: "Svayam Geneva"',
      'policy_owner_github: "svayam-rkant"',
      'legal_owner_github: "svayam-rkant"',
      'policy_effective_date: "2026-05-15"',
      '# a comment',
      'services:',
      '  vault: "https://vault.example"',
    ].join("\n");
    const v = tokenValuesFromOrgConfig(cfg);
    // These four are exactly what leaked into an adopter's policy documents: the
    // typed OrgConfig has no owner handles and no effective date.
    expect(v["POLICY_OWNER_GITHUB"]).to.equal("svayam-rkant");
    expect(v["LEGAL_OWNER_GITHUB"]).to.equal("svayam-rkant");
    expect(v["POLICY_EFFECTIVE_DATE"]).to.equal("2026-05-15");
    expect(v["ORG_NAME"]).to.equal("Svayam Geneva");
    expect(v["SERVICES"], "a nested block has no scalar of its own").to.equal(undefined);
  });

  it("treats per-project tokens as expected at setup time", () => {
    // There is no project yet. `gov seed` resolves these, and reporting them here
    // alongside real leaks is what taught readers to skim the warning.
    expect(PER_PROJECT_TOKENS.has("<PROJECT_ID>")).to.equal(true);
    expect(PER_PROJECT_TOKENS.has("<PRJ>")).to.equal(true);
    expect(PER_PROJECT_TOKENS.has("<POLICY_OWNER_GITHUB>")).to.equal(false);
  });
});
