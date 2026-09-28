// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * POL-040a §3.3 AS ROWS — one per requirement, testable without GitHub (PRJ-121, 2026-09-27).
 *
 * The rows are the product here: their status decides whether `gov doctor` fails, and their wording is the
 * whole remedy a reader gets. So each requirement is asserted in both directions, and the unknowable case is
 * asserted to be a WARNING that says so — never a tick, never a cross.
 */
import { expect } from "chai";
import { assessProtection, APPROVER_CHECK } from "../../src/maintain/protection-check.js";
import { UNPROTECTED, type ProtectionFacts } from "../../src/lifecycle/branch-protection.js";

const compliant: ProtectionFacts = {
  pullRequestRequired: true,
  approvingReviews: 1,
  enforceAdmins: true,
  requiredStatusChecks: [APPROVER_CHECK],
};
const target = { repo: "Acme/acme-gov", branch: "main" };
const row = (facts: ProtectionFacts | null, name: string, opts = target) =>
  assessProtection(facts, opts).find((d) => d.name === name)!;

describe("gov-work — assessProtection", () => {
  it("a fully protected branch: four rows, all ok, each naming the branch it read", () => {
    const rows = assessProtection(compliant, target);
    expect(rows).to.have.length(4);
    expect(rows.every((r) => r.status === "ok")).to.equal(true);
    expect(rows.every((r) => r.detail.includes("Acme/acme-gov@main"))).to.equal(true);
  });

  it("POL-040a.1 — a pull request must be required", () => {
    expect(row(compliant, "protection · pull request").status).to.equal("ok");
    const bad = row({ ...compliant, pullRequestRequired: false }, "protection · pull request");
    expect(bad.status).to.equal("fail");
    expect(bad.detail).to.contain("POL-040a.1").and.contain("require a pull request");
  });

  it("POL-040a.2 — at least one approving review, and the count is reported", () => {
    expect(row({ ...compliant, approvingReviews: 2 }, "protection · approving review").detail).to.contain("2 required");
    const bad = row({ ...compliant, approvingReviews: 0 }, "protection · approving review");
    expect(bad.status).to.equal("fail");
    expect(bad.detail).to.contain("POL-040a.2");
  });

  it("POL-040a.3 — administrators may not bypass, and the row names the GitHub setting", () => {
    const bad = row({ ...compliant, enforceAdmins: false }, "protection · no bypass");
    expect(bad.status).to.equal("fail");
    expect(bad.detail).to.contain("POL-040a.3").and.contain("Do not allow bypassing");
  });

  it("POL-040a.4 — the approver check, missing, reads as a GAP IN THE PLAN and says what to add", () => {
    const bad = row({ ...compliant, requiredStatusChecks: ["build"] }, "protection · approver check");
    expect(bad.status).to.equal("fail");
    // The wording matters: on GitHub Free for private repos the alternatives are paid features, so this is
    // not somebody being careless.
    expect(bad.detail).to.contain("paid features").and.contain("GitHub Free");
    expect(bad.detail, "say what the branch does require, so the reader can see the gap").to.contain("build");
    expect(bad.detail).to.contain(`Add the framework's \`${APPROVER_CHECK}\``);
  });

  it("…and says plainly when the branch requires no checks at all", () => {
    expect(row({ ...compliant, requiredStatusChecks: [] }, "protection · approver check").detail).to.contain("requires none");
  });

  it("an org that renamed the workflow is compared against ITS check, not ours", () => {
    const opts = { ...target, approverCheck: "authorized-approver" };
    expect(row({ ...compliant, requiredStatusChecks: ["authorized-approver"] }, "protection · approver check", opts).status).to.equal("ok");
    expect(row(compliant, "protection · approver check", opts).status, "our default is not their requirement").to.equal("fail");
  });

  it("an UNPROTECTED branch fails every requirement — it is an answer, and the answer is no", () => {
    const rows = assessProtection(UNPROTECTED, target);
    expect(rows).to.have.length(4);
    expect(rows.every((r) => r.status === "fail")).to.equal(true);
  });

  it("UNKNOWABLE is ONE warning that says unknown is not unprotected, and carries the reason", () => {
    const rows = assessProtection(null, { ...target, why: "gh is signed in but not an admin of this repo" });
    expect(rows).to.have.length(1);
    expect(rows[0]!.name).to.equal("branch protection");
    expect(rows[0]!.status, "a fail would blame the reader's permissions on the repo").to.equal("warn");
    expect(rows[0]!.detail).to.contain("UNKNOWN IS NOT UNPROTECTED").and.contain("not an admin");
    expect(rows[0]!.detail, "point at the page that settles it").to.contain("github.com/Acme/acme-gov/settings/branches");
  });

  it("…and still reads sensibly when nobody said why", () => {
    const rows = assessProtection(null, target);
    expect(rows[0]!.status).to.equal("warn");
    expect(rows[0]!.detail).to.contain("could not read Acme/acme-gov@main");
  });
});
