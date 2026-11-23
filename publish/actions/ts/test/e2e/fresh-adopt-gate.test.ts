// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The timed fresh-adoption job (Q62 A, Q64 A): its guard (e2e/fresh-adopt-guard.sh) and its measurement
 * (e2e/fresh-timing.sh), run as the workflow runs them — with the secret unset, and with no GitHub.
 *
 *   guard   strict like live-guard.sh, EXCEPT that a missing FRESH_ADOPT_PAT is INCOMPLETE (exit 0, warning) until the
 *           variable FRESH_ADOPT_REQUIRED is true — the journey lands before its secret exists (Q64 A)
 *   timing  install is reported, never counted; over budget fails; the summary carries the table
 */
import { expect } from "chai";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const E2E = path.resolve(import.meta.dirname, "../../e2e");
const GUARD = path.join(E2E, "fresh-adopt-guard.sh");
const JOURNEY = path.join(E2E, "fresh-adoption-journey.sh");

interface Run { status: number | null; out: string; output: string; summary: string }

function run(args: readonly string[], env: Record<string, string>): Run {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-gate-"));
  const output = path.join(dir, "output"), summary = path.join(dir, "summary");
  fs.writeFileSync(output, ""); fs.writeFileSync(summary, "");
  const r = spawnSync("bash", [...args], {
    env: { PATH: process.env.PATH, GITHUB_ACTIONS: "true", GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, ...env },
    encoding: "utf8",
  });
  const res = { status: r.status, out: `${r.stdout}${r.stderr}`, output: fs.readFileSync(output, "utf8"), summary: fs.readFileSync(summary, "utf8") };
  fs.rmSync(dir, { recursive: true, force: true });
  return res;
}

const timing = (budget: number, ...phases: string[]): Run =>
  run(["-c", `. "${path.join(E2E, "fresh-timing.sh")}"; timing_report "$@"; rc=$?; echo "TOTAL=$TIMING_TOTAL"; exit $rc`, "x", String(budget), ...phases], {});

describe("e2e/fresh-adopt-guard.sh", function () {
  if (process.platform === "win32") return;

  for (const [event, extra] of [["pull_request", { BASE_REF: "dev" }], ["workflow_dispatch", { REF_NAME: "BRNCH-121-x" }], ["push", { REF_NAME: "dev" }]] as const) {
    it(`Q64 A: ${event} without FRESH_ADOPT_PAT is INCOMPLETE — exit 0, run=false, a warning that says incomplete, never green`, () => {
      const r = run([GUARD], { ORG: "svayam-e2e-3", EVENT: event, ...extra });
      expect(r.status, r.out).to.equal(0);
      expect(r.output).to.include("run=false").and.include("strict=true");
      // green-streak.sh breaks a streak on an annotation that says "incomplete": the run is not counted as green.
      expect(r.out).to.match(/^::warning::fresh-adoption journey: incomplete — missing: secret:FRESH_ADOPT_PAT/m);
      expect(r.summary).to.match(/INCOMPLETE/);
    });
  }

  it("once FRESH_ADOPT_REQUIRED is true, a strict run without the secret FAILS, naming it", () => {
    const r = run([GUARD], { ORG: "svayam-e2e-3", REQUIRED: "true", EVENT: "pull_request", BASE_REF: "main" });
    expect(r.status, r.out).to.equal(1);
    expect(r.out).to.match(/^::error::.*secret:FRESH_ADOPT_PAT/m);
  });

  it("a missing org variable is named too", () => {
    const r = run([GUARD], { TOK: "t", REQUIRED: "true", EVENT: "workflow_dispatch" });
    expect(r.status).to.equal(1);
    expect(r.out).to.include("var:FRESH_ADOPT_ORG");
  });

  it("off dev/main it skips visibly (a notice), whatever FRESH_ADOPT_REQUIRED says", () => {
    const r = run([GUARD], { REQUIRED: "true", EVENT: "pull_request", BASE_REF: "BRNCH-121-x" });
    expect(r.status, r.out).to.equal(0);
    expect(r.output).to.include("run=false").and.include("strict=false");
    expect(r.out).to.match(/::notice::fresh-adoption journey skipped/);
  });

  it("configured: run=true, nothing said", () => {
    const r = run([GUARD], { TOK: "t", ORG: "svayam-e2e-3", EVENT: "workflow_dispatch" });
    expect(r.status, r.out).to.equal(0);
    expect(r.output).to.include("run=true");
    expect(r.out).to.not.match(/::(error|warning)::/);
  });
});

describe("e2e/fresh-timing.sh — the promise, measured", function () {
  if (process.platform === "win32") return;

  it("totals the timed phases, never install, and passes within budget", () => {
    const r = timing(600, "install=90", "setup=200", "practice=150", "stop=60");
    expect(r.status, r.out).to.equal(0);
    expect(r.out).to.include("TOTAL=410");
    expect(r.out).to.match(/install\s+90s\s+\(not counted\)/);
    expect(r.summary).to.include("| **total** | **410 s** | budget 600 s — within budget |");
  });

  it("over budget fails, and says so in the log and the summary", () => {
    const r = timing(600, "setup=400", "practice=150", "stop=60");
    expect(r.status).to.equal(1);
    expect(r.out).to.include("OVER BUDGET");
    expect(r.summary).to.include("OVER BUDGET");
  });

  it("exactly the budget is within it", () => {
    expect(timing(600, "setup=600").status).to.equal(0);
  });

  it("a phase that is not whole seconds is refused, not counted as zero", () => {
    expect(timing(600, "setup=abc").status).to.equal(2);
  });
});

describe("e2e/fresh-adoption-journey.sh — refuses before touching anything", function () {
  if (process.platform === "win32") return;

  it("without its org and token it stops at once, naming them", () => {
    const r = run([JOURNEY], {});
    expect(r.status).to.not.equal(0);
    expect(r.out).to.include("E2E_ORG");
  });

  it("an unknown mode is a usage error", () => {
    expect(run([JOURNEY, "nonsense"], { E2E_ORG: "o", GH_TOKEN: "t" }).status).to.equal(2);
  });

  it("teardown with no ledger has nothing to do and says so", () => {
    const r = run([JOURNEY, "teardown"], { E2E_ORG: "o", GH_TOKEN: "t", E2E_LEDGER: "/nonexistent/ledger.env" });
    expect(r.status, r.out).to.equal(0);
    expect(r.out).to.include("created nothing to tear down");
  });
});
