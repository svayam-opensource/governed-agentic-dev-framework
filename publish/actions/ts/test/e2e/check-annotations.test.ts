// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * e2e/check-annotations.sh — how the rule-model journey learns what a check FOUND: the check run's annotations
 * (`gov check run` prints each finding as a workflow command in Actions), never the job's log. Twice, live, the log
 * download came back empty after minutes of polling and an assertion over it failed although the check had
 * correctly failed. Annotations can lag too, so the helper polls briefly — and on a miss prints what it DID find.
 *
 * `gh` here is a fake on PATH that answers from a fixture through the real `jq` (as `gh --jq` would), so the jq
 * expression is exercised too.
 */
import { expect } from "chai";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const LIB = path.resolve(import.meta.dirname, "../../e2e/check-annotations.sh");
const hasJq = spawnSync("jq", ["--version"]).status === 0;

const ANNOTATIONS = JSON.stringify([
  { path: "policies/org-policy.md", start_line: 9, annotation_level: "failure", title: "GOV-FRM-467",
    message: "GOV-FRM-467 [gov-builtin/policy-pr-gate]: policies/org-policy.md §2.2 (abc1234) was added or changed,\nand the entry does not list it" },
  { path: ".github", start_line: 1, annotation_level: "warning", title: "GOV-FRM-467", message: "warn: something soft" },
]);

describe("e2e/check-annotations.sh", function () {
  this.timeout(30_000);
  if (process.platform === "win32" || !hasJq) return; // bash + jq; the live tier runs on ubuntu

  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "rmj-ann-")); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  /** A fake gh: the first `emptyFor` calls answer `[]` (annotations not there yet), then the fixture. */
  function run(script: string, opts: { emptyFor?: number; fixture?: string; dry?: boolean } = {}) {
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(dir, "fixture.json"), opts.fixture ?? ANNOTATIONS);
    fs.writeFileSync(path.join(bin, "gh"), `#!/usr/bin/env bash
echo "gh $*" >> "${dir}/calls.log"
n=$(wc -l < "${dir}/calls.log")
jqx="."; while [ $# -gt 0 ]; do [ "$1" = "--jq" ] && { jqx="$2"; shift; }; shift; done
if [ "$n" -le ${opts.emptyFor ?? 0} ]; then echo '[]' | jq -r "$jqx"; else jq -r "$jqx" < "${dir}/fixture.json"; fi
`, { mode: 0o755 });
    const harness = `set -euo pipefail
DRY=${opts.dry ? 1 : 0}; exec 3>&2
expect() { local msg="$1"; shift; if [ "$DRY" = 1 ]; then echo "would assert: $msg"; return 0; fi; if "$@"; then echo "PASS $msg"; else echo "FAIL $msg"; return 1; fi; }
source "${LIB}"
${script}`;
    const r = spawnSync("bash", ["-c", harness], {
      env: { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`, ANNOTATION_WAIT_SECS: "3", ANNOTATION_POLL_SECS: "1" }, encoding: "utf8",
    });
    const calls = fs.existsSync(path.join(dir, "calls.log")) ? fs.readFileSync(path.join(dir, "calls.log"), "utf8") : "";
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, calls };
  }

  it("check_annotations: one line per annotation — level, path:line, message on one line — from the check-runs API", () => {
    const r = run("check_annotations o/r 123");
    expect(r.status, r.stderr).to.equal(0);
    expect(r.stdout.trim().split("\n")).to.deep.equal([
      "failure policies/org-policy.md:9 GOV-FRM-467 [gov-builtin/policy-pr-gate]: policies/org-policy.md §2.2 (abc1234) was added or changed, and the entry does not list it",
      "warning .github:1 warn: something soft",
    ]);
    expect(r.calls).to.include("gh api repos/o/r/check-runs/123/annotations?per_page=100");
    expect(r.calls).to.not.include("/logs");
  });

  it("expect_annotation: a match passes the assertion", () => {
    const r = run('expect_annotation "(c) unreviewed" "was added or changed" o/r 123');
    expect(r.status, r.stderr).to.equal(0);
    expect(r.stdout).to.include("PASS (c) unreviewed");
  });

  it("expect_annotation: the pattern can pin the file and line", () => {
    const r = run('expect_annotation "(c) on the policy" "policies/org-policy\\.md:[0-9]+ .*was added or changed" o/r 123');
    expect(r.stdout, r.stderr).to.include("PASS (c) on the policy");
  });

  it("expect_annotation: polls while the annotations are not there yet", () => {
    const r = run('expect_annotation "(c) unreviewed" "was added or changed" o/r 123', { emptyFor: 2 });
    expect(r.stdout, r.stderr).to.include("PASS (c) unreviewed");
    expect(r.calls.trim().split("\n")).to.have.length(3);
  });

  it("expect_annotation: a miss fails the assertion and prints the annotations it DID find", () => {
    const r = run('expect_annotation "(c) proposed" "proposed and committed" o/r 123');
    expect(r.status).to.not.equal(0);
    expect(r.stdout).to.include("FAIL (c) proposed");
    expect(r.stderr).to.include("annotations on check run 123").and.include("was added or changed").and.include("warn: something soft");
  });

  it("expect_annotation: a miss with no annotations at all says so", () => {
    const r = run('expect_annotation "(c) x" "anything" o/r 123', { fixture: "[]" });
    expect(r.stdout).to.include("FAIL (c) x");
    expect(r.stderr).to.include("annotations on check run 123: none");
  });

  it("dry: prints the call and lists the assertion, calls nothing", () => {
    const r = run('expect_annotation "(c) unreviewed" "was added or changed" o/r 123', { dry: true });
    expect(r.status, r.stderr).to.equal(0);
    expect(r.stdout).to.include("would assert: (c) unreviewed");
    expect(r.stderr).to.include("+ poll gh api repos/o/r/check-runs/123/annotations");
    expect(r.calls).to.equal("");
  });
});
