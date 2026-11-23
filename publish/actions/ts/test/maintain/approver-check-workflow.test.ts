// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// THE APPROVER CHECK'S OWN SCRIPT, RUN (GOV-FRM-447; alternates F143 A, solo mode Q45 C — Policy Owner rulings of
// 2026-11-23). The workflow reads governance.yaml and the role list itself, in awk, so it is tested by running it:
// the `run:` block of the shipped template, in a scratch governance repository, with a `gh` on PATH that answers the
// one reviews call it makes.
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";
import { approverLogins } from "../../src/maintain/repo-protect.js";

const CONTENT = path.join(import.meta.dirname, "..", "..", "..", "..", "content");
const WORKFLOW = path.join(CONTENT, "framework", "build", "templates", "workflows", "approver-check.yml");
const SCRIPT = (() => {
  const doc = yaml.load(fs.readFileSync(WORKFLOW, "utf8")) as { jobs: Record<string, { steps: { run?: string }[] }> };
  return doc.jobs["approver-check"]!.steps.find((s) => s.run)!.run!;
})();

const ROLES_OLD = "| Role | GitHub handle | Owns |\n|---|---|---|\n| Data Owner | @dana | `knowledge/data/` |\n";
const ROLES_ALT = "| Role | GitHub handle | Owns | Alternate |\n|---|---|---|---|\n| Data Owner | @dana | `knowledge/data/` | @dev |\n";
const gov = (posture: string, po: string, poAlt = "", co = "") =>
  `governance_posture: "${posture}"\npolicy_owner:\n  email: ""\n  github: "${po}"\n  alternate: "${poAlt}"\ncheck_owner:\n  github: "${co}"\n  alternate: ""\n`;

function run(files: { governance: string; roles?: string }, author: string, approvedBy: readonly string[]): { code: number; out: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "approver-check-"));
  try {
    fs.mkdirSync(path.join(dir, "policies", "common"), { recursive: true });
    fs.mkdirSync(path.join(dir, "bin"));
    fs.writeFileSync(path.join(dir, "policies", "governance.yaml"), files.governance);
    if (files.roles) fs.writeFileSync(path.join(dir, "policies", "common", "authorized-representatives.md"), files.roles);
    const reviews = approvedBy.map((login, i) => ({ state: "APPROVED", user: { login }, submitted_at: `2026-11-23T10:0${i}:00Z` }));
    fs.writeFileSync(path.join(dir, "reviews.json"), JSON.stringify(reviews));
    fs.writeFileSync(path.join(dir, "bin", "gh"), `#!/bin/sh\ncat "${path.join(dir, "reviews.json")}"\n`, { mode: 0o755 });
    const r = spawnSync("bash", ["-c", SCRIPT], {
      cwd: dir, encoding: "utf8",
      env: { PATH: `${path.join(dir, "bin")}:${process.env.PATH}`, REPO: "acme/acme-gov", PR: "7", AUTHOR: author, GH_TOKEN: "x", GOV_APPROVERS: "" },
    });
    return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("approver-check workflow — alternates and solo mode (F143 A, Q45 C)", () => {
  it("the Policy Owner's alternate (governance.yaml) is an authorized representative", () => {
    const r = run({ governance: gov("soft", "polly", "@pat"), roles: ROLES_OLD }, "polly", ["pat"]);
    expect(r.code, r.out).to.equal(0);
    expect(r.out).to.contain("approved by pat");
  });

  it("a role's alternate from the Alternate column is an authorized representative", () => {
    const r = run({ governance: gov("soft", "polly"), roles: ROLES_ALT }, "dana", ["dev"]);
    expect(r.code, r.out).to.equal(0);
  });

  it("an old role table without the column still lists its holders", () => {
    const r = run({ governance: gov("soft", "polly"), roles: ROLES_OLD }, "polly", ["dana"]);
    expect(r.code, r.out).to.equal(0);
  });

  it("a flow-form block's alternate is read too", () => {
    const r = run({ governance: 'governance_posture: soft\npolicy_owner: { github: "polly", alternate: "pat" }\n' }, "polly", ["pat"]);
    expect(r.code, r.out).to.equal(0);
  });

  it("SOFT, nobody but the author holds a role or alternate: still fails, saying self-merged: no second person", () => {
    const r = run({ governance: gov("soft", "solo"), roles: "| Role | GitHub handle | Owns | Alternate |\n|---|---|---|---|\n| Data Owner | vacant | — | |\n" }, "solo", []);
    expect(r.code).to.equal(1);
    expect(r.out).to.contain("self-merged: no second person").and.contain("solo mode");
  });

  it("HARD, the same: nothing changes — the plain missing-approval failure", () => {
    const r = run({ governance: gov("hard", "solo") }, "solo", []);
    expect(r.code).to.equal(1);
    expect(r.out).to.not.contain("self-merged");
    expect(r.out).to.contain("No approving review yet");
  });

  it("a role written `vacant` names nobody: a login called vacant is not an authorized representative", () => {
    const r = run({ governance: gov("hard", "polly"), roles: "| Role | GitHub handle | Owns | Alternate |\n|---|---|---|---|\n| Data Owner | vacant | — | none |\n" }, "dana", ["vacant", "none"]);
    expect(r.code).to.equal(1);
    expect(r.out).to.contain("none of them is on");
  });

  it("SOFT with an alternate named: not solo — the plain missing-approval failure", () => {
    const r = run({ governance: gov("soft", "solo", "pat") }, "solo", []);
    expect(r.code).to.equal(1);
    expect(r.out).to.not.contain("self-merged");
  });

  it("approverLogins (the GOV_APPROVERS line gov prints) carries the alternates too", () => {
    expect(approverLogins(gov("soft", "polly", "@pat", "chuck"), ROLES_ALT)).to.deep.equal(["polly", "pat", "chuck", "dana", "dev"]);
  });
});
