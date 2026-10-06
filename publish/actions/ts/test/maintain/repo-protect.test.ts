// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov repo protect` — WHAT IT INSTALLS, AND WHAT IT REFUSES TO PRETEND (Policy Owner, 2026-09-29).
 *
 * The behaviour under test is mostly HONESTY, so the assertions are mostly about exit codes and about calls
 * that must NOT have happened. A command that installs branch protection can fail in one uniquely bad way —
 * leaving an organization believing it is protected — and every case below is a shape of that failure:
 *
 *   the platform refuses            → non-zero on apply, and the three ways out §3.4 already states
 *   gov could not read the branch   → non-zero, and NO write: "did not find out" is not "nothing is there"
 *   the workflow is not on the branch yet → no required check, because one that never runs blocks every PR
 *   the write is not confirmed      → non-zero, and no claim of success
 *   already correct                 → no write at all
 *
 * NO NETWORK. `gh` is injected, and the fake records every call, because "did it write?" is the question.
 */
import { expect } from "chai";
import * as path from "node:path";
import {
  approverLogins, buildProtectionBody, protectRepo, WORKFLOW_DEST, WORKFLOW_TEMPLATE,
  type GhApi, type ProtectFs,
} from "../../src/maintain/repo-protect.js";
import { protectionChanges, APPROVER_CHECK } from "../../src/maintain/protection-check.js";
import { UNPROTECTED } from "../../src/lifecycle/branch-protection.js";
import { classifyPosture } from "../../src/config/governance.js";

const HOME = "/gov/acme";
const REPO = "Acme/acme-gov";
const BRANCH = "main";
const HARD = classifyPosture("hard");

/** A gh failure shaped like the one `execFileSync` throws, which is what the production code reads. */
const ghFailure = (stderr: string): Error =>
  Object.assign(new Error("Command failed: gh"), { status: 1, stderr, stdout: "" });

const PLAN_403 = "gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)";
const NOT_ADMIN = "gh: You must have admin rights to Repository to perform this operation. (HTTP 403)";
const NO_PROTECTION = "gh: Branch not protected (HTTP 404)";
const NOT_FOUND = "gh: Not Found (HTTP 404)";

/** A protection payload GitHub would return, compliant unless overridden. */
function payload(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    url: `https://api.github.com/repos/${REPO}/branches/${BRANCH}/protection`,
    required_status_checks: { strict: false, contexts: [APPROVER_CHECK], checks: [{ context: APPROVER_CHECK }] },
    enforce_admins: { enabled: true },
    required_pull_request_reviews: { required_approving_review_count: 1, dismiss_stale_reviews: true },
    restrictions: null,
    ...over,
  });
}

interface Call { readonly args: readonly string[]; readonly body?: string }

/** A `gh` that answers the three calls this command makes, and remembers every one of them. */
function fakeGh(h: { get?: () => string; put?: (body: string) => string; contents?: () => string }): { gh: GhApi; calls: Call[] } {
  const calls: Call[] = [];
  const gh: GhApi = (args, body) => {
    calls.push({ args: [...args], ...(body === undefined ? {} : { body }) });
    if (args.includes("PUT")) {
      if (!h.put) throw ghFailure(NOT_ADMIN);
      return h.put(body ?? "");
    }
    if (args.join(" ").includes("/contents/")) {
      if (!h.contents) throw ghFailure(NOT_FOUND);
      return h.contents();
    }
    if (!h.get) throw ghFailure(NO_PROTECTION);
    return h.get();
  };
  return { gh, calls };
}

function fakeFs(files: Record<string, string> = {}): ProtectFs & { readonly files: Record<string, string> } {
  return {
    files,
    readFile: (f) => files[f] ?? null,
    writeFile: (f, c) => { files[f] = c; },
    pathExists: (p) => p in files,
  };
}

const withTemplate = (): Record<string, string> => ({ [path.join(HOME, WORKFLOW_TEMPLATE)]: "# the framework's workflow\n" });
const base = { repo: REPO, branch: BRANCH, home: HOME, posture: HARD, isGovernanceRepo: true, repoDir: "/clones/acme-gov" };
const wrote = (calls: readonly Call[]): readonly Call[] => calls.filter((c) => c.args.includes("PUT"));

describe("gov-work — protectionChanges (the pure assessment of what needs changing)", () => {
  it("an unprotected branch: every requirement needs changing, with the current value beside the wanted one", () => {
    const rows = protectionChanges(UNPROTECTED);
    expect(rows).to.have.length(4);
    expect(rows.every((r) => r.changes)).to.equal(true);
    expect(rows.map((r) => r.rule)).to.deep.equal(["GOV-FRM-447.1", "GOV-FRM-447.2", "GOV-FRM-447.3", "GOV-FRM-447.4"]);
    expect(rows[0]!.current).to.equal("no");
    expect(rows[0]!.wanted).to.equal("yes");
    expect(rows[2]!.current).to.equal("allowed");
    expect(rows[3]!.current).to.contain("no checks");
  });

  it("a compliant branch needs no change — which is what makes `already correct` a fact and not a mood", () => {
    const rows = protectionChanges({ pullRequestRequired: true, approvingReviews: 1, enforceAdmins: true, requiredStatusChecks: [APPROVER_CHECK] });
    expect(rows.filter((r) => r.changes)).to.deep.equal([]);
  });

  it("names the checks the branch ALREADY requires, because a write replaces the whole list", () => {
    const rows = protectionChanges({ ...UNPROTECTED, requiredStatusChecks: ["build", "lint"] });
    const check = rows[3]!;
    expect(check.current).to.contain("build").and.contain("lint");
    expect(check.wanted, "and says they are kept").to.contain("alongside build, lint");
  });

  it("two approvals already required is not a failure — the policy says AT LEAST one", () => {
    const rows = protectionChanges({ pullRequestRequired: true, approvingReviews: 2, enforceAdmins: true, requiredStatusChecks: [APPROVER_CHECK] });
    expect(rows[1]!.changes).to.equal(false);
    expect(rows[1]!.current).to.equal("2");
  });
});

describe("gov-work — repo protect plan", () => {
  it("prints one row per setting, current beside wanted, and says nothing was written", () => {
    const { gh, calls } = fakeGh({ contents: () => "{}" });   // no protection → UNPROTECTED; workflow present
    const r = protectRepo({ gh, fs: fakeFs(withTemplate()) }, base, "plan");
    const text = r.lines.join("\n");
    expect(r.code).to.equal(0);
    expect(text).to.contain(`gov repo protect plan — ${REPO}@${BRANCH}`);
    expect(text).to.contain("setting").and.contain("current").and.contain("wanted");
    expect(text).to.contain("pull request required").and.contain("approving reviews").and.contain("bypass");
    expect(text).to.contain("GOV-FRM-447.1").and.contain("GOV-FRM-447.4");
    expect(text).to.contain("4 of 4 settings would change");
    expect(text).to.contain("NOTHING HAS BEEN WRITTEN");
    expect(wrote(calls), "plan writes nothing, ever").to.deep.equal([]);
  });

  it("says the workflow would be written too, and that the order matters", () => {
    const { gh } = fakeGh({});                                // no protection, no workflow
    const text = protectRepo({ gh, fs: fakeFs(withTemplate()) }, base, "plan").lines.join("\n");
    expect(text).to.contain(WORKFLOW_DEST).and.contain("absent");
    expect(text).to.contain("ORDER MATTERS").and.contain("pending for ever");
  });

  it("A REPOSITORY ALREADY CORRECT reports `already correct`, not a plan to re-apply", () => {
    const { gh, calls } = fakeGh({ get: () => payload(), contents: () => "{}" });
    const r = protectRepo({ gh, fs: fakeFs(withTemplate()) }, base, "plan");
    expect(r.code).to.equal(0);
    expect(r.lines.join("\n")).to.contain("ALREADY CORRECT");
    expect(wrote(calls)).to.deep.equal([]);
  });
});

describe("gov-work — repo protect apply", () => {
  it("already correct: writes NOTHING and says so — the write-only-when-it-changes discipline", () => {
    const { gh, calls } = fakeGh({ get: () => payload(), contents: () => "{}" });
    const r = protectRepo({ gh, fs: fakeFs(withTemplate()) }, base, "apply");
    expect(r.code).to.equal(0);
    expect(r.lines.join("\n")).to.contain("ALREADY CORRECT").and.contain("Nothing was written");
    expect(wrote(calls)).to.deep.equal([]);
  });

  it("THE WORKFLOW FIRST: writes the file, touches no branch protection, and exits non-zero", () => {
    const fs = fakeFs(withTemplate());
    const { gh, calls } = fakeGh({});                          // no workflow on the branch
    const r = protectRepo({ gh, fs }, base, "apply");
    expect(r.code, "INCOMPLETE is not success").to.equal(1);
    expect(fs.files[path.join("/clones/acme-gov", ".github", "workflows", "approver-check.yml")]).to.equal("# the framework's workflow\n");
    expect(wrote(calls), "a required check that has never run blocks every pull request").to.deep.equal([]);
    expect(r.lines.join("\n")).to.contain("STOPPED BEFORE TOUCHING BRANCH PROTECTION").and.contain("NOT yet protected");
  });

  it("…and does not rewrite a workflow that already matches the framework's copy", () => {
    const dest = path.join("/clones/acme-gov", ".github", "workflows", "approver-check.yml");
    const fs = fakeFs({ ...withTemplate(), [dest]: "# the framework's workflow\n" });
    const { gh } = fakeGh({});
    const text = protectRepo({ gh, fs }, base, "apply").lines.join("\n");
    expect(text).to.contain("already correct in the working tree");
  });

  it("GOV-FRM-447 writes the four settings, RE-READS, and reports from the re-read", () => {
    let stored: string | null = null;
    const { gh, calls } = fakeGh({
      get: () => (stored === null ? ghThrow(NO_PROTECTION) : payload()),
      put: (body) => { stored = body; return "{}"; },
      contents: () => "{}",
    });
    const r = protectRepo({ gh, fs: fakeFs(withTemplate()) }, base, "apply");
    expect(r.code).to.equal(0);
    expect(wrote(calls)).to.have.length(1);
    expect(r.lines.join("\n")).to.contain("written and RE-READ");
    // The re-read is a SECOND get after the PUT — not the one the plan was computed from.
    const order = calls.map((c) => (c.args.includes("PUT") ? "put" : c.args.join(" ").includes("/contents/") ? "contents" : "get"));
    expect(order.filter((o) => o === "get"), "read, write, read").to.have.length(2);
    expect(order.indexOf("put")).to.be.lessThan(order.lastIndexOf("get"));
  });

  it("a write the RE-READ does not confirm is a FAILURE, not a success", () => {
    // GitHub accepts the PUT and the branch still reports no bypass protection. The exit code follows the
    // re-read, because a command that trusted the PUT would have called this protected.
    const { gh } = fakeGh({
      get: () => payload({ enforce_admins: { enabled: false } }),
      put: () => "{}",
      contents: () => "{}",
    });
    const r = protectRepo({ gh, fs: fakeFs(withTemplate()) }, base, "apply");
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.contain("PARTIALLY APPLIED").and.contain("from the re-read");
  });

  it("a write gov could not re-read reports NEITHER success nor a setting — it says it did not confirm", () => {
    let puts = 0;
    const { gh } = fakeGh({
      get: () => (puts === 0 ? ghThrow(NO_PROTECTION) : ghThrow(NOT_ADMIN)),
      put: () => { puts++; return "{}"; },
      contents: () => "{}",
    });
    const r = protectRepo({ gh, fs: fakeFs(withTemplate()) }, base, "apply");
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.contain("could NOT re-read").and.contain("not reporting success");
  });
});

describe("gov-work — repo protect and a repository the PLATFORM will not protect (§3.4)", () => {
  it("GOV-FRM-449 apply says exactly what GitHub said, names the three ways out, and EXITS NON-ZERO", () => {
    const { gh, calls } = fakeGh({ get: () => ghThrow(PLAN_403) });
    const r = protectRepo({ gh, fs: fakeFs(withTemplate()) }, base, "apply");
    expect(r.code, "a silent partial apply is the worst outcome available").to.equal(1);
    const text = r.lines.join("\n");
    expect(text).to.contain("Upgrade to GitHub Pro or make this repository public");
    expect(text).to.contain(`1. make ${REPO} public`);
    expect(text).to.contain("2. move this organization to a plan that provides branch protection");
    expect(text).to.contain("3. approve an exception that NAMES the gap");
    expect(text).to.contain("GOV-FRM-449");
    expect(text).to.contain("is NOT protected, and gov will not report that it is");
    expect(wrote(calls)).to.deep.equal([]);
  });

  it("…and says it is a PLATFORM limit, not a missing setting — required checks are the same paid feature", () => {
    const { gh } = fakeGh({ get: () => ghThrow(PLAN_403) });
    const text = protectRepo({ gh, fs: fakeFs(withTemplate()) }, base, "plan").lines.join("\n");
    expect(text).to.contain("not even the approver check");
    expect(text).to.contain("nothing to plan here. This is a platform limit, not a missing setting");
  });

  it("CANNOT and DID NOT are different answers: a non-admin read refuses WITHOUT the plan advice", () => {
    const { gh, calls } = fakeGh({ get: () => ghThrow(NOT_ADMIN) });
    const r = protectRepo({ gh, fs: fakeFs(withTemplate()) }, base, "apply");
    expect(r.code).to.equal(1);
    const text = r.lines.join("\n");
    expect(text).to.contain("could not read").and.contain("not an admin");
    expect(text).to.contain("this is gov failing to find out, not");
    expect(text, "the ways out are about a plan limit, and this is not one").to.not.contain("Upgrade to GitHub Pro");
    expect(wrote(calls), "gov does not write onto a rule it could not read").to.deep.equal([]);
  });
});

describe("gov-work — repo protect and the posture", () => {
  it("UNSET is SOFT by default (W2-Q6): installs nothing, writes nothing, succeeds", () => {
    const { gh, calls } = fakeGh({ get: () => payload(), contents: () => "{}" });
    const r = protectRepo({ gh, fs: fakeFs(withTemplate()) }, { ...base, posture: classifyPosture("") }, "apply");
    expect(r.code).to.equal(0);
    expect(r.lines.join("\n")).to.contain("SOFT governance").and.contain("the default");
    expect(calls).to.deep.equal([]);
  });

  it("UNSET on plan is soft too", () => {
    const { gh } = fakeGh({});
    expect(protectRepo({ gh, fs: fakeFs() }, { ...base, posture: classifyPosture(undefined) }, "plan").code).to.equal(0);
  });

  it("SOFT: installs nothing, on purpose, and says the gates that remain do not bind an agent outside gov", () => {
    const { gh, calls } = fakeGh({ get: () => payload(), contents: () => "{}" });
    const r = protectRepo({ gh, fs: fakeFs(withTemplate()) }, { ...base, posture: classifyPosture("soft") }, "apply");
    expect(r.code, "a deliberate choice is not a failure").to.equal(0);
    expect(r.lines.join("\n")).to.contain("chose SOFT governance, so gov installs nothing");
    expect(calls).to.deep.equal([]);
  });

  it("a posture gov does not recognise is NOT read as either one", () => {
    const { gh } = fakeGh({});
    const r = protectRepo({ gh, fs: fakeFs() }, { ...base, posture: classifyPosture("strict") }, "apply");
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.contain("`strict`").and.contain("will not guess");
  });
});

describe("gov-work — the body gov PUTs", () => {
  it("GOV-FRM-447 keeps the checks the branch already requires and adds the approver check to them", () => {
    const body = JSON.parse(buildProtectionBody(JSON.parse(payload({
      required_status_checks: { strict: true, contexts: ["build"], checks: [{ context: "lint" }] },
    })) as never)) as { required_status_checks: { strict: boolean; contexts: string[] } };
    expect(body.required_status_checks.contexts).to.deep.equal(["build", "lint", APPROVER_CHECK]);
    expect(body.required_status_checks.strict, "`strict` is the org's business, not GOV-FRM-447's").to.equal(true);
  });

  it("GOV-FRM-447 sets the four settings the policy asks for, and nothing it did not", () => {
    const body = JSON.parse(buildProtectionBody(null)) as Record<string, unknown>;
    expect(body.enforce_admins).to.equal(true);
    expect((body.required_pull_request_reviews as { required_approving_review_count: number }).required_approving_review_count).to.equal(1);
    expect(body.restrictions, "null is REQUIRED in the body, and means nobody is restricted").to.equal(null);
    expect(body, "a flag GitHub never reported is not invented here").to.not.have.property("allow_force_pushes");
  });

  it("does not lower a bar the organization already set higher", () => {
    const body = JSON.parse(buildProtectionBody(JSON.parse(payload({
      required_pull_request_reviews: { required_approving_review_count: 2, dismiss_stale_reviews: true },
    })) as never)) as { required_pull_request_reviews: { required_approving_review_count: number; dismiss_stale_reviews: boolean } };
    expect(body.required_pull_request_reviews.required_approving_review_count).to.equal(2);
    expect(body.required_pull_request_reviews.dismiss_stale_reviews, "and does not turn off what it did not ask about").to.equal(true);
  });

  it("carries back the optional flags the payload stated — a PUT replaces the whole rule", () => {
    const body = JSON.parse(buildProtectionBody(JSON.parse(payload({
      required_conversation_resolution: { enabled: true },
      allow_force_pushes: { enabled: false },
    })) as never)) as Record<string, unknown>;
    expect(body.required_conversation_resolution).to.equal(true);
    expect(body.allow_force_pushes).to.equal(false);
  });
});

describe("gov-work — the organization's approver logins (governance.yaml + the role list)", () => {
  const GOV = 'policy_owner:\n  github: "@carol"\ncheck_owner:\n  github: "@dave"\n';
  const LIST = "| Role | GitHub handle | Owns |\n|---|---|---|\n| Data Owner | @dana | `knowledge/data/` |\n| Legal Owner | | `knowledge/legal/` |\n";

  it("the Policy Owner, the Check Owner and every role holder — a vacant role adds nobody", () => {
    expect(approverLogins(GOV, LIST)).to.deep.equal(["carol", "dave", "dana"]);
  });

  it("on day one that is the Policy Owner alone", () => {
    expect(approverLogins('policy_owner:\n  github: "@carol"\n', null)).to.deep.equal(["carol"]);
  });

  it("one person in several roles is listed once", () => {
    expect(approverLogins('policy_owner:\n  github: "carol"\ncheck_owner:\n  github: "@carol"\n', "| Role | GitHub handle | Owns |\n|---|---|---|\n| X | @carol | |\n"))
      .to.deep.equal(["carol"]);
  });

  it("the retired authorized_approvers list is not read — who may approve IS who holds a role", () => {
    expect(approverLogins("authorized_approvers:\n  - mallory\n", null)).to.deep.equal([]);
  });

  it("has nothing to say when nobody is named", () => {
    expect(approverLogins(null, null)).to.deep.equal([]);
    expect(approverLogins("governance_posture: soft\n", "# no table\n")).to.deep.equal([]);
  });

  it("a code repo's apply prints the variable command with the org's own handles", () => {
    const { gh } = fakeGh({});
    const text = protectRepo({ gh, fs: fakeFs(withTemplate()) }, {
      ...base, repo: "Acme/billing", isGovernanceRepo: false, approvers: ["alice", "bob"],
    }, "apply").lines.join("\n");
    expect(text).to.contain('gh variable set GOV_APPROVERS --repo Acme/billing --body "alice bob"');
  });
});

/** Throwing from inside a `() => string` handler, which TypeScript needs typed as returning one. */
function ghThrow(stderr: string): never {
  throw ghFailure(stderr);
}
