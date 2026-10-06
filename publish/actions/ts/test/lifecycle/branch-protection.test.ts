// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * READING BRANCH PROTECTION — and the distinction the whole check rests on (PRJ-121, 2026-09-27).
 *
 * An UNPROTECTED branch and an UNKNOWABLE one are different facts. GitHub answers the first with a 404 whose
 * body is `Branch not protected`, and the second with a 403 (protection is visible to repository admins only)
 * — so a reader that treated every failure as "could not read" would hide a wide-open default branch, and one
 * that treated every failure as "unprotected" would cry wolf at every non-admin. Both halves are asserted
 * here, with `gh` faked.
 */
import { expect } from "chai";
import {
  createGhBranchProtection, parseProtection, readProtection, whyUnreadable, UNPROTECTED,
} from "../../src/lifecycle/branch-protection.js";

/** A GitHub protection payload, as `gh api repos/o/r/branches/b/protection` prints it. */
const payload = (over: Record<string, unknown> = {}): string => JSON.stringify({
  url: "https://api.github.com/repos/o/r/branches/main/protection",
  required_status_checks: { strict: false, contexts: ["approver-check", "build"] },
  required_pull_request_reviews: { required_approving_review_count: 1 },
  enforce_admins: { enabled: true },
  ...over,
});

/** A gh that fails the way gh fails: non-zero exit, message on stderr. */
const ghFailing = (stderr: string) => () => {
  throw Object.assign(new Error(`Command failed: gh api`), { status: 1, stderr });
};

describe("gov-work — parseProtection", () => {
  it("reads the four facts GOV-FRM-447 asks about", () => {
    expect(parseProtection(payload())).to.deep.equal({
      pullRequestRequired: true,
      approvingReviews: 1,
      enforceAdmins: true,
      requiredStatusChecks: ["approver-check", "build"],
    });
  });

  it("takes check names from `checks[].context` too, without duplicating", () => {
    const facts = parseProtection(payload({
      required_status_checks: { contexts: ["build"], checks: [{ context: "build" }, { context: "approver-check" }] },
    }))!;
    expect(facts.requiredStatusChecks).to.deep.equal(["build", "approver-check"]);
  });

  it("no required reviews block → no pull request requirement, and zero reviews", () => {
    const facts = parseProtection(payload({ required_pull_request_reviews: null }))!;
    expect(facts.pullRequestRequired).to.equal(false);
    expect(facts.approvingReviews).to.equal(0);
  });

  it("enforce_admins off is read as off — the bypass GOV-FRM-447.3 forbids", () => {
    expect(parseProtection(payload({ enforce_admins: { enabled: false } }))!.enforceAdmins).to.equal(false);
  });

  it("null for anything that is not a protection payload — never invented zeroes", () => {
    expect(parseProtection("not json")).to.equal(null);
    expect(parseProtection("[]")).to.equal(null);
    expect(parseProtection(JSON.stringify({ message: "Branch not protected" }))).to.equal(null);
  });
});

describe("gov-work — whyUnreadable", () => {
  it("null for `Branch not protected` — that is an ANSWER, not a failure to read", () => {
    expect(whyUnreadable("gh: Branch not protected (HTTP 404)")).to.equal(null);
  });

  it("names the admin-rights case, which is the common one", () => {
    expect(whyUnreadable("Must have admin rights to Repository. (HTTP 403)")).to.contain("admin");
  });

  // Verified against this framework's own governance repo on 2026-09-27: GitHub Free answers 403 with this
  // message for a PRIVATE repo, on the protection endpoint AND on the rulesets one. So GOV-FRM-447 is not
  // unconfigured there, it is unconfigurable — and blaming the reader's permissions would send them hunting.
  it("names the PLAN, not the person, when GitHub Free has nothing to show", () => {
    const why = whyUnreadable("gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)")!;
    expect(why).to.contain("GitHub Free").and.contain("PRIVATE");
    expect(why, "and say why the status check is no escape hatch here").to.contain("required status checks are part of the same paid feature");
    expect(why).to.not.match(/admin/i);
  });

  it("tells 404, 403, signed-out and transport apart", () => {
    expect(whyUnreadable("Not Found (HTTP 404)")).to.contain("not found");
    expect(whyUnreadable("Resource not accessible by integration (HTTP 403)")).to.contain("403");
    expect(whyUnreadable("Bad credentials (HTTP 401)")).to.contain("gh auth login");
    expect(whyUnreadable("unexpected EOF")).to.contain("in transit");
  });

  it("falls back to gh's own first line rather than inventing a reason", () => {
    expect(whyUnreadable("something nobody predicted\nsecond line")).to.equal("gh failed: something nobody predicted");
    expect(whyUnreadable("")).to.contain("no message");
  });
});

describe("gov-work — readProtection", () => {
  it("asks gh for the right endpoint", () => {
    const seen: string[][] = [];
    readProtection("Acme/acme-gov", "main", (args) => { seen.push(args); return payload(); });
    expect(seen[0]).to.deep.equal(["api", "repos/Acme/acme-gov/branches/main/protection"]);
  });

  it("an unprotected branch reads as UNPROTECTED facts, not as null", () => {
    const r = readProtection("Acme/acme-gov", "main", ghFailing("gh: Branch not protected (HTTP 404)"));
    expect(r.facts).to.deep.equal(UNPROTECTED);
    expect(r.why, "there is nothing to excuse — gov got an answer").to.equal(undefined);
  });

  it("the same when gh prints that body on stdout and exits 0", () => {
    const r = readProtection("Acme/acme-gov", "main", () => JSON.stringify({ message: "Branch not protected" }));
    expect(r.facts).to.deep.equal(UNPROTECTED);
  });

  it("null WITH A REASON when gh cannot answer", () => {
    const r = readProtection("Acme/acme-gov", "main", ghFailing("Must have admin rights to Repository. (HTTP 403)"));
    expect(r.facts).to.equal(null);
    expect(r.why).to.contain("admin");
  });

  it("null when gh answers with something unparseable", () => {
    const r = readProtection("Acme/acme-gov", "main", () => "<html>502 Bad Gateway</html>");
    expect(r.facts).to.equal(null);
    expect(r.why).to.be.a("string");
  });
});

describe("gov-work — the BranchProtection port", () => {
  it("the gh adapter hands back facts, or null, and nothing else", () => {
    expect(createGhBranchProtection(() => payload()).fetch("Acme/acme-gov", "main")).to.include({ approvingReviews: 1 });
    expect(createGhBranchProtection(ghFailing("Bad credentials (HTTP 401)")).fetch("Acme/acme-gov", "main")).to.equal(null);
  });
});
