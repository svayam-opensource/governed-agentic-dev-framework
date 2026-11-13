// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE INSTALL-SIGNUP JOURNEY, HERMETICALLY (PRJ-121 intent 02 addendum, IS-E6 "now" half; spec
 * addendum-install-signup §9 live journey, §10 acceptance IS-A*).
 *
 * Three modes, three proofs:
 *  - --dry-run walks every step, prints each call instead of making it, and lists every assertion by its IS-A id.
 *  - --stub against the stub portal + IAM and the FIXTURE scripts host (no Docker, no network) passes end to end —
 *    and FAILS, naming the IS-A id, when the fixture or the stub serves a defect the spec forbids. That is what makes
 *    the journey's assertions worth trusting when it runs against the real gov-install and, later, uat.
 *  - --live is wired but refuses to pretend: it stops at its guard, SKIPPED, naming what it waits on, and records
 *    the skip for live-verdict.sh (a skip is never green — ruling Q2).
 */
import { expect } from "chai";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import yaml from "js-yaml";

const SCRIPT = path.resolve(import.meta.dirname, "../../e2e/signup-journey.sh");
const WORKFLOW = path.resolve(import.meta.dirname, "../../../../../.github/workflows/adopter-e2e.yml");
const TRAPPED = ["gh", "git", "gov", "npm", "docker"];
const SCRUB = ["GH_TOKEN", "GITHUB_ACTIONS", "E2E_ORG", "E2E_GOV_INSTALL", "E2E_GOV_INSTALL_URL", "E2E_FIXTURE_BREAK", "E2E_PORTAL_BREAK", "E2E_SKIPS_FILE", "E2E_DRY_RUN"];

function run(args: string[], extra: NodeJS.ProcessEnv = {}, trapCurl = false): { status: number | null; out: string; called: string; skips: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "signup-journey-"));
  try {
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    for (const p of [...TRAPPED, ...(trapCurl ? ["curl"] : [])]) {
      fs.writeFileSync(path.join(bin, p), `#!/usr/bin/env bash\necho "${p} $*" >> "${path.join(dir, "called.log")}"\nexit 97\n`, { mode: 0o755 });
    }
    const skipsFile = path.join(dir, "skips.tsv");
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` };
    for (const k of SCRUB) delete env[k];
    Object.assign(env, { E2E_SKIPS_FILE: skipsFile }, extra);
    // stdout and stderr into ONE file, in the order they were written: the dry run's "+ call" lines go to stderr and
    // its assertions to stdout, and the order test reads them as one story.
    const logFile = path.join(dir, "out.log");
    const fd = fs.openSync(logFile, "w");
    let status: number | null;
    try { status = spawnSync("bash", [SCRIPT, ...args], { env, stdio: ["ignore", fd, fd], timeout: 90_000 }).status; } finally { fs.closeSync(fd); }
    const read = (f: string): string => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");
    return { status, out: read(logFile), called: read(path.join(dir, "called.log")), skips: read(skipsFile) };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// What each mode must prove, by acceptance id (spec §10). IS-A18 and IS-A21 are not this journey's in stub mode.
const STUB_IDS = ["IS-A1", "IS-A2", "IS-A3", "IS-A4", "IS-A5", "IS-A6", "IS-A7", "IS-A8", "IS-A9", "IS-A10", "IS-A11", "IS-A12", "IS-A13", "IS-A14", "IS-A15", "IS-A16", "IS-A17", "IS-A19", "IS-A20"];

describe("e2e/signup-journey.sh", function () {
  this.timeout(120_000);
  if (process.platform === "win32") return;

  describe("--dry-run", () => {
    let dry: ReturnType<typeof run>;
    before(() => { dry = run(["--dry-run"], {}, true); });

    it("walks to the end and exits 0, calling nothing — not even curl", () => {
      expect(dry.status, dry.out).to.equal(0);
      expect(dry.out).to.match(/signup-journey \(DRY RUN\): \d+ passed, 0 skipped, ok/);
      expect(dry.called).to.equal("");
    });

    it("lists an assertion for every acceptance id the stub mode proves", () => {
      for (const id of STUB_IDS) expect(dry.out, id).to.match(new RegExp(`would assert: ${id} · `));
    });

    it("follows spec §9's order: scripts host, signed out, register, refused again, invite, join, remove, suspend, environments", () => {
      const order = [
        "▶ Scripts host — gov-uat.svayamtech.com",
        "would assert: IS-A11 ·",
        "+ curl -X POST /uat/api/registrations",
        "would assert: IS-A4 ·",
        "▶ Members → invite B by email",
        "▶ Members → invite D by GitHub login",
        "▶ C → Request to join",
        "would assert: IS-A10 ·",
        "▶ Platform admin suspends the account",
        "▶ The uat account does not exist in dev or prod",
      ];
      let at = -1;
      for (const line of order) {
        const i = dry.out.indexOf(line, at + 1);
        expect(i, `missing or out of order: ${line}`).to.be.greaterThan(at);
        at = i;
      }
    });

    it("asks the scripts host anonymously and never follows a redirect", () => {
      const fetches = dry.out.split("\n").filter((l) => l.includes("+ curl -sS --max-redirs 0"));
      expect(fetches.length).to.be.greaterThan(10);
      for (const l of fetches) { expect(l).to.include("(anonymous)"); expect(l).to.not.match(/ -L\b|--location/); }
    });

    it("prints no credential: identities are named, tokens never appear", () => {
      expect(dry.out).to.not.match(/Bearer|stub:admin|E2E_SIGNUP_TOKEN_\w+=/);
    });
  });

  describe("--stub, against the stub portal and the fixture scripts host", () => {
    it("passes end to end", () => {
      const r = run(["--stub"], { E2E_GOV_INSTALL: "fixture" });
      expect(r.status, r.out).to.equal(0);
      expect(r.out).to.match(/signup-journey \(stub\): \d+ passed, 0 skipped, ok/);
      for (const id of STUB_IDS) expect(r.out, id).to.match(new RegExp(`✓ ${id} · `));
      expect(r.called, "no gh, git, gov, npm or docker").to.equal("");
    });

    const defects: [string, Record<string, string>, RegExp][] = [
      ["a script path that redirects", { E2E_FIXTURE_BREAK: "script-redirect" }, /✗ IS-A17 · dev: \/install\.sh is 200 with no redirect/],
      ["a script that is HTML", { E2E_FIXTURE_BREAK: "html-script" }, /✗ IS-A17 · dev: \/install\.sh .* no HTML/],
      ["`/` that does not redirect to the portal", { E2E_FIXTURE_BREAK: "no-302" }, /✗ IS-A16 · dev: GET \/ /],
      ["versions.json without its CORS origin", { E2E_FIXTURE_BREAK: "no-cors" }, /✗ §7\.2 · dev: \/versions\.json is readable cross-origin/],
      ["versions.json that disagrees with the scripts' pins", { E2E_FIXTURE_BREAK: "pin-mismatch" }, /✗ IS-A12 · dev: versions\.json's pkg and registry equal the pins/],
      ["a refusal that names the account", { E2E_PORTAL_BREAK: "leak-account" }, /✗ IS-A4 · the refusal names neither the account nor its admins/],
      ["an approved join request that makes an admin", { E2E_PORTAL_BREAK: "approve-as-admin" }, /✗ IS-A9 · …as a member, never an admin/],
      ["a piped install command", { E2E_PORTAL_BREAK: "piped-command" }, /✗ IS-A13 · macOS\/Linux: fetch to a file, then run — never piped/],
    ];
    for (const [what, env, failure] of defects) {
      it(`fails on ${what}, naming the IS-A id`, () => {
        const r = run(["--stub"], { E2E_GOV_INSTALL: "fixture", ...env });
        expect(r.status, r.out).to.equal(1);
        expect(r.out).to.match(failure);
        expect(r.out).to.match(/signup-journey \(stub\): \d+ passed, 0 skipped, FAILED/);
      });
    }
  });

  describe("--live", () => {
    it("is wired but SKIPPED until PRJ-119's signals, the gov-uat App and the sandbox identities exist — said, recorded, never green", () => {
      const r = run(["--live"], {}, true);
      expect(r.status, r.out).to.equal(0);
      expect(r.out).to.include("cannot run yet. It waits on:");
      for (const w of ["S-g", "S-h", "S-i", "S-k", "P3", "P4", "910#282"]) expect(r.out, w).to.include(w);
      expect(r.out).to.match(/signup-journey \(live\): 0 passed, 1 skipped, INCOMPLETE/);
      expect(r.skips).to.match(/^signup\tlive install-signup journey \(IS-A22\)/);
      expect(r.called).to.equal("");
    });

    it("refuses any org but the sandbox, before anything else", () => {
      const r = run(["--live"], { E2E_ORG: "Svayamtech" }, true);
      expect(r.status).to.equal(1);
      expect(r.out).to.include("runs only in svayam-e2e");
      expect(r.called).to.equal("");
    });
  });

  it("refuses to start without a mode", () => {
    const r = run([]);
    expect(r.status).to.equal(2);
    expect(r.out).to.match(/usage: .* --dry-run \| --stub \| --live/);
  });
});

describe("adopter-e2e.yml — the signup job (IS-E6)", () => {
  interface Step { id?: string; name?: string; if?: string; env?: Record<string, string>; run?: string }
  interface Job { if?: string; steps: Step[]; needs?: string | string[] }
  const wf = (): { on: { workflow_dispatch: { inputs: Record<string, { options?: string[]; default?: string }> } }; jobs: Record<string, Job> } =>
    yaml.load(fs.readFileSync(WORKFLOW, "utf8")) as never;

  it("is its own job, outside the required live job", () => {
    const jobs = wf().jobs;
    expect(jobs["signup"], "a signup job").to.exist;
    expect(JSON.stringify(jobs["live"]!.steps)).to.not.include("signup-journey.sh");
  });

  it("runs the hermetic stub by default, a local gov-install or live only when dispatched with them", () => {
    const input = wf().on.workflow_dispatch.inputs["signup"]!;
    expect(input.options).to.deep.equal(["fixture", "local", "live"]);
    expect(input.default).to.equal("fixture");
    const run = wf().jobs["signup"]!.steps.find((s) => s.id === "signup")!;
    expect(run.run).to.include("signup-journey.sh --stub");
    expect(run.run).to.include("signup-journey.sh --live");
  });

  it("ends with live-verdict.sh, so a skipped live run is incomplete, never green", () => {
    const v = wf().jobs["signup"]!.steps.find((s) => (s.name ?? "").includes("verdict"))!;
    expect(v.run).to.include("live-verdict.sh");
    expect(v.env?.["JOURNEYS"]).to.equal("signup:${{ steps.signup.outcome }}");
  });
});
