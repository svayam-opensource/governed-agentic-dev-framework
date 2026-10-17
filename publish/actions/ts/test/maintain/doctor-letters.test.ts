// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** Spec 03 Q9 — letters between projects are retired: a NEW for-*.md is an advisory; the five that exist stay history. */
import { expect } from "chai";
import { lettersDiagnostic, LETTERS_KEPT_AS_HISTORY } from "../../src/signal/letters.js";
import { doctor, type DoctorFacts } from "../../src/maintain/doctor.js";

const base: DoctorFacts = { gitPresent: true, ghPresent: true, resolve: { ok: true, home: "/gov", org: "o", via: "active-org" }, activeOrg: "o", cliVersion: "1" };

describe("doctor — letters retired (Q9)", () => {
  it("the five existing letters raise nothing", () => {
    expect(LETTERS_KEPT_AS_HISTORY).to.have.lengthOf(5);
    expect(lettersDiagnostic([...LETTERS_KEPT_AS_HISTORY, "projects/PRJ-1-a/knowledge/todo.md"])).to.equal(null);
  });
  it("a new letter is an advisory (warn) naming it and pointing at gov signal", () => {
    const d = lettersDiagnostic(["projects/PRJ-121-x/knowledge/for-gov-iam.md"])!;
    expect(d.status).to.equal("warn");
    expect(d.detail).to.match(/projects\/PRJ-121-x\/knowledge\/for-gov-iam\.md/).and.match(/gov signal/);
  });
  it("doctor shows the row only when project files were listed", () => {
    expect(doctor(base).diagnostics.find((x) => x.name === "letters")).to.equal(undefined);
    const r = doctor({ ...base, projectFiles: ["projects/PRJ-9-z/for-them.md"] });
    expect(r.diagnostics.find((x) => x.name === "letters")!.status).to.equal("warn");
    expect(r.ok).to.equal(true);
  });
});
