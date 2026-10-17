// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * A WORKFLOW GOV CREATES ASKS FOR THE ORGANIZATION'S RUNNER (`ci.runs_on`, Policy Owner 2026-10-17).
 *
 * `.github/workflows/gov-validate.yml` ships with `runs-on: ubuntu-latest` and is the organization's once installed
 * (seed-once). The run that CREATES it writes the runner policies/governance.yaml names. A copy that already exists is
 * the organization's: only its runs-on lines follow ci.runs_on (ruling 2026-10-17, org-workflow-runner.test.ts). No
 * runner chosen → the shipped bytes, as before.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { runUpgradeSync, runUpgradePr, fillRunner } from "../../src/maintain/upgrade-run.js";

const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));
const put = (root: string, rel: string, text: string): void => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const read = (root: string, rel: string): string | null => { try { return fs.readFileSync(path.join(root, rel), "utf8"); } catch { return null; /* absent */ } };

const VALIDATE = ".github/workflows/gov-validate.yml";
const SHIPPED = "name: gov-validate\non: [pull_request]\njobs:\n  validate:\n    runs-on: ubuntu-latest\n    steps:\n      - run: gov validate\n";
const ORG_OWN = SHIPPED.replace("ubuntu-latest", "[self-hosted, windows]");

function content(): string {
  const c = tmp("fillrun-content-");
  put(c, "MANIFEST.yaml", [
    "files:",
    "  - { src: VERSION, dst: VERSION, mode: scaffold-auto }",
    `  - { src: ${VALIDATE}, dst: ${VALIDATE}, mode: seed-once }`,
    "",
  ].join("\n"));
  put(c, "VERSION", "2.0.0\n");
  put(c, VALIDATE, SHIPPED);
  return c;
}
function workspace(governance: string | null): string {
  const ws = tmp("fillrun-ws-");
  put(ws, "org-config.yaml", 'org_name: "Acme Corp"\ngithub_org: "acme"\n');
  if (governance !== null) put(ws, "policies/governance.yaml", governance);
  put(ws, "VERSION", "1.9.0\n");
  return ws;
}
const SELF_HOSTED = "ci:\n  runs_on: [self-hosted, linux]\n";

describe("gov upgrade writes the org's runner into a workflow it creates — and only there", function () {
  this.timeout(30000);

  it("--apply creates gov-validate.yml asking for ci.runs_on", () => {
    const ws = workspace(SELF_HOSTED);
    const r = runUpgradeSync(content(), ws, { apply: true });
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(read(ws, VALIDATE)).to.equal(SHIPPED.replace("ubuntu-latest", "[self-hosted, linux]"));
    expect(r.lines.join("\n")).to.include(`runner [self-hosted, linux] (ci.runs_on) written into 1 workflow(s) this upgrade created: ${VALIDATE}`);
  });

  it("no runner chosen → the shipped bytes; nothing said", () => {
    for (const gov of [null, "governance_posture: soft\n"]) {
      const ws = workspace(gov);
      const r = runUpgradeSync(content(), ws, { apply: true });
      expect(read(ws, VALIDATE)).to.equal(SHIPPED);
      expect(r.lines.join("\n")).to.not.include("ci.runs_on");
    }
  });

  it("an existing copy is the organization's: only its runs-on follows ci.runs_on (ruling 2026-10-17; org-workflow-runner.test.ts)", () => {
    const ws = workspace(SELF_HOSTED);
    const own = ORG_OWN.replace("gov validate\n", "gov validate\n      - run: ./ours.sh\n");
    put(ws, VALIDATE, own);
    runUpgradeSync(content(), ws, { apply: true });
    expect(read(ws, VALIDATE)).to.equal(own.replace("[self-hosted, windows]", "[self-hosted, linux]"));
  });

  it("an unusable ci.runs_on → the shipped default, and the key named", () => {
    const ws = workspace("ci:\n  runs_on: 12\n");
    const r = runUpgradeSync(content(), ws, { apply: true });
    expect(read(ws, VALIDATE)).to.equal(SHIPPED);
    expect(r.lines.join("\n")).to.match(/ci\.runs_on: 12 .*— left asking for ubuntu-latest/);
  });

  it("--pr: the created workflow on the upgrade branch asks for the runner", () => {
    const ws = workspace(SELF_HOSTED);
    const remote = tmp("fillrun-remote-");
    execFileSync("git", ["init", "-q", "--bare", remote]);
    const g = (...a: string[]): string => execFileSync("git", ["-C", ws, ...a], { encoding: "utf8" });
    g("init", "-q", "-b", "main"); g("config", "user.email", "t@example.com"); g("config", "user.name", "t");
    g("remote", "add", "origin", remote);
    g("add", "-A"); g("commit", "-qm", "seed");
    const r = runUpgradePr(content(), ws, { userHome: tmp("fillrun-home-"), openPr: () => "https://example.test/pr/1", govVersion: "2.0.0" });
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(g("show", `gov-upgrade-2.0.0:${VALIDATE}`)).to.equal(SHIPPED.replace("ubuntu-latest", "[self-hosted, linux]"));
  });

  it("fillRunner touches only created workflow files", () => {
    const ws = workspace(SELF_HOSTED);
    put(ws, VALIDATE, SHIPPED);
    put(ws, "docs/ci.yml", SHIPPED);
    expect(fillRunner(ws, ["docs/ci.yml"])).to.deep.equal([]);
    expect(read(ws, "docs/ci.yml")).to.equal(SHIPPED);
    fillRunner(ws, [VALIDATE]);
    expect(read(ws, VALIDATE)).to.include("runs-on: [self-hosted, linux]");
  });
});
