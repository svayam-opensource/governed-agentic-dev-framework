// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * e2e/token-scopes.sh — the live journeys' check, at START, that their token can delete what they create, and their
 * teardown's account of what it could not. The first live run (2026-10-07) left two repos in the sandbox and said so
 * only as a line in the teardown: TESTBED_BOT_PAT had no `delete_repo`.
 */
import { expect } from "chai";
import { spawnSync } from "node:child_process";
import * as path from "node:path";

const LIB = path.resolve(import.meta.dirname, "../../e2e/token-scopes.sh");

function run(script: string, args: string[], env: NodeJS.ProcessEnv = {}): { status: number | null; out: string; vars: string } {
  const r = spawnSync("bash", ["-c", `set -euo pipefail; source "${LIB}"; ${script}; echo "CAN_DELETE=\${CAN_DELETE:-}"`, "_", ...args],
    { env: { PATH: process.env.PATH, GITHUB_ACTIONS: "true", ...env }, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, vars: r.stdout.split("\n").filter((l) => l.startsWith("CAN_DELETE=")).join("") };
}

const CLASSIC = (scopes: string) => `HTTP/2.0 200 OK\r\nContent-Type: application/json\r\nX-Oauth-Scopes: ${scopes}\r\n\r\n{"login":"bot"}`;

describe("e2e/token-scopes.sh", function () {
  if (process.platform === "win32") return; // bash; the live tier runs on ubuntu

  it("a classic token WITH delete_repo: silent, CAN_DELETE=yes", () => {
    const r = run('scope_check "$1" o/a o/b', [CLASSIC("repo, workflow, delete_repo, read:org")]);
    expect(r.status, r.out).to.equal(0);
    expect(r.out).to.not.include("::warning::");
    expect(r.vars).to.equal("CAN_DELETE=yes");
  });

  it("a classic token WITHOUT delete_repo: ::warning:: naming the scope and every repo it will leak, and carries on", () => {
    const r = run('scope_check "$1" o/rmj-1-gov o/rmj-1-app', [CLASSIC("repo, workflow, read:org")]);
    expect(r.status, r.out).to.equal(0);
    const warning = r.out.split("\n").find((l) => l.startsWith("::warning::")) ?? "";
    expect(warning).to.include("delete_repo").and.include("o/rmj-1-gov").and.include("o/rmj-1-app");
    expect(r.vars).to.equal("CAN_DELETE=no");
  });

  it("no x-oauth-scopes header (fine-grained token or App): says it cannot tell, names the permission and the repos", () => {
    const r = run('scope_check "$1" o/a', ["HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n{}"]);
    expect(r.status, r.out).to.equal(0);
    expect(r.out).to.match(/::warning::.*Administration.*o\/a/);
    expect(r.vars).to.equal("CAN_DELETE=unknown");
  });

  it("leak_report lists exactly the repos it could not delete — nothing when there are none", () => {
    expect(run("leak_report", []).out).to.not.include("could not delete");
    const r = run('leak_report "$@"', ["o/x", "o/y"]);
    expect(r.out).to.include("could not delete 2 repo(s): o/x o/y");
    expect(r.out).to.match(/::warning::.*o\/x o\/y/);
  });
});
