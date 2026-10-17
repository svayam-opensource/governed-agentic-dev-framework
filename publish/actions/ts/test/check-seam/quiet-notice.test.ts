// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// ONE QUIET NOTICE PER SURFACE (spec 02 A19, S6 style). THE SUBSCRIPTION DECIDES (D6, Policy Owner 2026-10-13): there
// is no `evidence:` key in governance.yaml. With no paid module running, each surface says so ONCE: the CI run
// (`::notice`, which GitHub shows on the pull request), the session manifest line, and `gov doctor` (an advisory row,
// never a warning — an unsubscribed org is not misconfigured).
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as evidence from "../../src/check-seam/evidence.js";
import { quietNotice, noticeOnce, resetEvidence, evidenceDoctorRow } from "../../src/check-seam/evidence.js";
import { parseGovernance, GOVERNANCE_KEYS } from "../../src/config/governance.js";

describe("check-seam — the quiet notice (A19)", () => {
  beforeEach(() => resetEvidence());

  it("D6: there is no `evidence:` switch — gov does not read the key, and an old one is reported as ignored", () => {
    expect((GOVERNANCE_KEYS as readonly string[]).includes("evidence")).to.equal(false);
    expect("evidenceWanted" in evidence).to.equal(false);
    const g = parseGovernance("governance_posture: soft\nevidence: enabled\n");
    expect(g.problems).to.include("evidence: gov does not read this key in policies/governance.yaml — ignored");
  });

  it("each surface gets exactly one line, once per process", () => {
    for (const s of ["run", "manifest", "doctor"] as const) {
      const first = noticeOnce(s, {});
      expect(first, s).to.be.a("string");
      expect(first!.split("\n")).to.have.length(1);
      expect(noticeOnce(s, {}), `${s} again`).to.equal(null);
    }
  });

  it("the run notice is a single GitHub ::notice, and steps of one job share it (RUNNER_TEMP marker)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gov-notice-"));
    const env = { RUNNER_TEMP: tmp };
    expect(noticeOnce("run", env)).to.match(/^::notice title=gov evidence::/);
    resetEvidence(); // a new process: the next step of the same job
    expect(noticeOnce("run", env)).to.equal(null);
  });

  it("the text is quiet: what is off, why, and where to get it — no alarm words", () => {
    const t = quietNotice("manifest");
    expect(t).to.match(/evidence/i);
    expect(t).to.not.match(/error|fail|warning/i);
  });

  it("doctor: no module → the quiet notice as an advisory (ok, never warn); installed → ok, naming it", () => {
    const off = evidenceDoctorRow({ found: null });
    expect(off.status).to.equal("ok");
    expect(off.detail).to.equal(quietNotice("doctor"));
    const on = evidenceDoctorRow({ found: { entry: "/x", via: "global" } });
    expect(on.status).to.equal("ok");
    expect(on.detail).to.include("gov-check installed");
  });
});
