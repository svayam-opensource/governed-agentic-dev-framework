// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * e2e/green-streak.sh — "green" is computed, never read off a summary (PRJ-121 intent 05, I05.1; rulings Q1, Q2).
 *
 * Driven here with a fake `gh` over recorded fixtures (e2e/fixtures/green-streak/<scenario>.json: what `gh run list`,
 * `gh run view --json jobs` and the check-run annotations API return). Every way a run can look green without being
 * green — a failed job, a re-run, a skipped live journey, a skipped assertion, a skipped job, a different commit, an
 * event other than a manual dispatch — must break the streak; three clean dispatches on one commit are STREAK 3/3.
 */
import { expect } from "chai";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const SCRIPT = path.resolve(import.meta.dirname, "../../e2e/green-streak.sh");
const FIXTURES = path.resolve(import.meta.dirname, "../../e2e/fixtures/green-streak");

// The fake gh answers exactly the three calls the script makes, from one scenario file, and logs each call.
const FAKE_GH = `#!/usr/bin/env node
const fs = require("node:fs");
const fx = JSON.parse(fs.readFileSync(process.env.GS_FIXTURE, "utf8"));
const a = process.argv.slice(2);
fs.appendFileSync(process.env.GS_CALLS, a.join(" ") + "\\n");
if (a[0] === "run" && a[1] === "list") { process.stdout.write(JSON.stringify(fx.runs)); process.exit(0); }
if (a[0] === "run" && a[1] === "view") { const v = fx.views[a[2]]; if (!v) { console.error("no run " + a[2]); process.exit(1); } process.stdout.write(JSON.stringify(v)); process.exit(0); }
if (a[0] === "api") { const m = /check-runs\\/(\\d+)\\/annotations/.exec(a[1]); process.stdout.write(JSON.stringify((m && fx.annotations[m[1]]) || [])); process.exit(0); }
console.error("fake gh: unexpected call: " + a.join(" ")); process.exit(97);
`;

interface Result { status: number | null; out: string; calls: string }

function streak(scenario: string, args: string[] = ["BRNCH-121-doc-update-issue-116"]): Result {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "green-streak-"));
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "gh"), FAKE_GH, { mode: 0o755 });
  const calls = path.join(dir, "calls.log");
  const r = spawnSync("bash", [SCRIPT, ...args], {
    env: { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`, HOME: dir, GS_FIXTURE: path.join(FIXTURES, `${scenario}.json`), GS_CALLS: calls },
    encoding: "utf8",
  });
  const res = { status: r.status, out: `${r.stdout}${r.stderr}`, calls: fs.existsSync(calls) ? fs.readFileSync(calls, "utf8") : "" };
  fs.rmSync(dir, { recursive: true, force: true });
  return res;
}

describe("e2e/green-streak.sh", function () {
  this.timeout(30_000);
  if (process.platform === "win32") return; // bash; run where the live tier runs

  it("three clean workflow_dispatch runs on one commit: one line per run, STREAK 3/3, exit 0", () => {
    const r = streak("clean");
    expect(r.status, r.out).to.equal(0);
    expect(r.out).to.include("STREAK 3/3");
    for (const id of ["103", "102", "101"]) expect(r.out).to.match(new RegExp(`^${id} 921ac41 .*\\bOK\\b`, "m"));
    // It read every run's jobs — a run's own conclusion is never taken on trust.
    expect(r.calls).to.match(/run list .*--workflow adopter-e2e\.yml .*--branch BRNCH-121-doc-update-issue-116/);
    for (const id of ["103", "102", "101"]) expect(r.calls).to.include(`run view ${id} `);
  });

  const breaks: Array<[string, string, RegExp]> = [
    ["failed-job", "one job failed", /102 .*BREAK.*interactive journey \(debian\).*failure/],
    ["rerun", "a re-run (attempt 2)", /102 .*BREAK.*attempt 2/],
    ["skipped-journey", "a skipped live journey (a step skipped)", /102 .*BREAK.*skipped.*Run adopter journey/],
    ["skipped-assertion", "a skipped assertion (annotation)", /102 .*BREAK.*skipped \(f\)/],
    ["skipped-job", "a skipped job", /101 .*BREAK.*bare machine \(rocky\).*skipped/],
    ["two-shas", "a different head commit", /101 .*BREAK.*different commit/],
    ["push-event", "a push run", /102 .*BREAK.*event push/],
  ];
  for (const [scenario, what, line] of breaks) {
    it(`${what} breaks the streak: names why, exit 1`, () => {
      const r = streak(scenario);
      expect(r.status, r.out).to.equal(1);
      expect(r.out).to.match(line);
      expect(r.out).to.not.include("STREAK 3/3");
      expect(r.out).to.match(/STREAK [0-2]\/3/);
    });
  }

  it("the streak counts from the newest run: a break below a clean run leaves 1/3", () => {
    expect(streak("failed-job").out).to.include("STREAK 1/3");
    expect(streak("two-shas").out).to.include("STREAK 2/3");
  });

  it("a run still in progress is listed and not counted; the completed runs below it still count", () => {
    const r = streak("in-progress");
    expect(r.status, r.out).to.equal(0);
    expect(r.out).to.match(/^104 .*in progress/m);
    expect(r.out).to.include("STREAK 3/3");
  });

  it("an annotation that is not a skip (runner deprecation notice) does not break it", () => {
    expect(streak("unrelated-annotation").status).to.equal(0);
  });

  it("n is an argument: 2 clean runs needed → 2/2 from the same fixture", () => {
    const r = streak("two-shas", ["BRNCH-121-doc-update-issue-116", "2"]);
    expect(r.status, r.out).to.equal(0);
    expect(r.out).to.include("STREAK 2/2");
  });

  it("no branch → usage, exit 2", () => {
    const r = streak("clean", []);
    expect(r.status).to.equal(2);
    expect(r.out).to.match(/usage: .*green-streak\.sh <branch> \[n(=3)?\]/i);
  });
});
