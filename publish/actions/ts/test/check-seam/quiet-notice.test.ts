// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// ONE QUIET NOTICE PER SURFACE (spec 02 A19, S6 style). When evidence is wanted (governance.yaml `evidence: enabled`)
// or a paid binding was met, and no module is running, each surface says so ONCE: the CI run (`::notice`, which
// GitHub shows on the pull request), the session manifest line, and `gov doctor`. An org that never asked for evidence
// and met no paid binding sees nothing at all — exactly as today.
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { evidenceWanted, quietNotice, noticeOnce, resetEvidence, evidenceDoctorRow } from "../../src/check-seam/evidence.js";

describe("check-seam — the quiet notice (A19)", () => {
  beforeEach(() => resetEvidence());

  it("evidence is wanted only when governance.yaml says `evidence: enabled`", () => {
    expect(evidenceWanted("evidence: enabled\n")).to.equal(true);
    expect(evidenceWanted("evidence: off\n")).to.equal(false);
    expect(evidenceWanted(null)).to.equal(false);
    expect(evidenceWanted("governance_posture: hard\n")).to.equal(false);
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

  it("doctor: off and not wanted → ok; wanted but not installed → warn with the notice; installed → ok", () => {
    expect(evidenceDoctorRow({ wanted: false, found: null }).status).to.equal("ok");
    const w = evidenceDoctorRow({ wanted: true, found: null });
    expect(w.status).to.equal("warn");
    expect(w.detail).to.equal(quietNotice("doctor"));
    expect(evidenceDoctorRow({ wanted: true, found: { entry: "/x", via: "global" } }).status).to.equal("ok");
  });
});
