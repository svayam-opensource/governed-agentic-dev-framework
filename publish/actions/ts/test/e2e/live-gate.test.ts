// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The live tier's guard and verdict (e2e/live-guard.sh, e2e/live-verdict.sh) — PRJ-121 intent 05, Item 1, ruling Q2:
 * a skipped live journey or a skipped assertion FAILS the run on a manual dispatch and on PRs into dev/main; it may
 * skip, visibly, only where no gate depends on it (a push to a feature branch, a PR between feature branches).
 *
 * Until 2026-10-12 the guard set run=false and the job SUCCEEDED when TESTBED_BOT_PAT was missing, so a live tier that
 * never ran read green. These tests run the exact guard the workflow runs, with the secrets unset — the regression the
 * spec asks for, without touching the repository's real secrets.
 */
import { expect } from "chai";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const GUARD = path.resolve(import.meta.dirname, "../../e2e/live-guard.sh");
const VERDICT = path.resolve(import.meta.dirname, "../../e2e/live-verdict.sh");

interface Run { status: number | null; out: string; output: string; summary: string }

function runScript(script: string, env: Record<string, string>, files: Record<string, string> = {}): Run {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-gate-"));
  const output = path.join(dir, "output"), summary = path.join(dir, "summary");
  fs.writeFileSync(output, ""); fs.writeFileSync(summary, "");
  for (const [k, v] of Object.entries(files)) fs.writeFileSync(path.join(dir, k), v);
  const r = spawnSync("bash", [script], {
    env: { PATH: process.env.PATH, GITHUB_ACTIONS: "true", GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary,
      ...Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v.replace("$DIR", dir)])) },
    encoding: "utf8",
  });
  const res = { status: r.status, out: `${r.stdout}${r.stderr}`, output: fs.readFileSync(output, "utf8"), summary: fs.readFileSync(summary, "utf8") };
  fs.rmSync(dir, { recursive: true, force: true });
  return res;
}

const ALL = { TOK: "t", ORG: "svayam-e2e", APP_ID: "a", APP_KEY: "k" };

describe("e2e/live-guard.sh", function () {
  if (process.platform === "win32") return;

  it("REGRESSION: a manual dispatch with TESTBED_BOT_PAT unset FAILS, naming the missing secret (never a green skip)", () => {
    const r = runScript(GUARD, { ...ALL, TOK: "", EVENT: "workflow_dispatch", REF_NAME: "BRNCH-121-x" });
    expect(r.status, r.out).to.equal(1);
    expect(r.out).to.match(/^::error::.*secret:TESTBED_BOT_PAT/m);
    expect(r.output).to.include("run=false");
  });

  it("a dispatch with nothing configured names every missing value, App secrets included", () => {
    const r = runScript(GUARD, { EVENT: "workflow_dispatch", REF_NAME: "dev" });
    expect(r.status).to.equal(1);
    const err = r.out.split("\n").find((l) => l.startsWith("::error::")) ?? "";
    for (const n of ["secret:TESTBED_BOT_PAT", "var:TESTBED_SANDBOX_ORG", "secret:GOV_E2E_APP_CLIENT_ID", "secret:GOV_E2E_APP_PRIVATE_KEY"]) expect(err).to.include(n);
  });

  for (const base of ["dev", "main"]) {
    it(`a PR into ${base} with secrets missing fails`, () => {
      const r = runScript(GUARD, { ...ALL, APP_KEY: "", EVENT: "pull_request", BASE_REF: base, REF_NAME: "1/merge" });
      expect(r.status, r.out).to.equal(1);
      expect(r.out).to.match(/::error::.*secret:GOV_E2E_APP_PRIVATE_KEY/);
    });
  }

  it("a push to dev with secrets missing fails (a long-lived branch is not a feature branch)", () => {
    expect(runScript(GUARD, { EVENT: "push", REF_NAME: "dev" }).status).to.equal(1);
  });

  it("a push to a feature branch without secrets skips VISIBLY: run=false, exit 0, a notice and a summary line saying skipped", () => {
    const r = runScript(GUARD, { EVENT: "push", REF_NAME: "BRNCH-121-x" });
    expect(r.status, r.out).to.equal(0);
    expect(r.output).to.include("run=false");
    expect(r.out).to.match(/::notice::live journeys skipped — missing:.*secret:TESTBED_BOT_PAT/);
    expect(r.summary).to.match(/live journeys: SKIPPED/);
  });

  it("everything configured on a dispatch: run=true strict=true, no error", () => {
    const r = runScript(GUARD, { ...ALL, EVENT: "workflow_dispatch", REF_NAME: "BRNCH-121-x" });
    expect(r.status, r.out).to.equal(0);
    expect(r.output).to.include("run=true").and.include("strict=true");
    expect(r.out).to.not.include("::error::");
  });

  it("real_model asked for without GEMINI_API_KEY fails a dispatch", () => {
    const r = runScript(GUARD, { ...ALL, REAL_MODEL: "true", EVENT: "workflow_dispatch", REF_NAME: "x" });
    expect(r.status).to.equal(1);
    expect(r.out).to.include("secret:GEMINI_API_KEY(real_model)");
  });
});

describe("e2e/live-verdict.sh", function () {
  if (process.platform === "win32") return;

  it("both journeys success, nothing skipped: exit 0, a row per journey", () => {
    const r = runScript(VERDICT, { ADOPTER: "success", RULEMODEL: "success", STRICT: "true", E2E_SKIPS_FILE: "$DIR/skips.tsv" });
    expect(r.status, r.out).to.equal(0);
    expect(r.summary).to.match(/\| adopter .*\| success \|/).and.match(/\| rule-model \| success \|/);
  });

  it("a skipped assertion makes its journey INCOMPLETE, named, and fails a strict run", () => {
    const r = runScript(VERDICT, { ADOPTER: "success", RULEMODEL: "success", STRICT: "true", E2E_SKIPS_FILE: "$DIR/skips.tsv" },
      { "skips.tsv": "rule-model\t(f) — no sandbox App (set GOV_E2E_APP_CLIENT_ID + GOV_E2E_APP_PRIVATE_KEY; see e2e/README.md)\n" });
    expect(r.status, r.out).to.equal(1);
    expect(r.out).to.match(/::error::rule-model journey: incomplete — skipped \(f\) — no sandbox App/);
    expect(r.summary).to.match(/\| rule-model \| incomplete \|/).and.include("skipped: (f) — no sandbox App");
  });

  it("not strict (feature-branch push): an incomplete journey warns, still says skipped, does not fail", () => {
    const r = runScript(VERDICT, { ADOPTER: "success", RULEMODEL: "success", STRICT: "false", E2E_SKIPS_FILE: "$DIR/skips.tsv" },
      { "skips.tsv": "rule-model\t(d) — the real model asked questions\n" });
    expect(r.status, r.out).to.equal(0);
    expect(r.out).to.match(/::warning::rule-model journey: incomplete — skipped \(d\)/);
  });

  it("a failed or not-run journey fails the job whatever STRICT says", () => {
    expect(runScript(VERDICT, { ADOPTER: "failure", RULEMODEL: "success", STRICT: "false" }).status).to.equal(1);
    const r = runScript(VERDICT, { ADOPTER: "success", RULEMODEL: "", STRICT: "false" });
    expect(r.status).to.equal(1);
    expect(r.out).to.include("::error::rule-model journey: not run");
  });
});
