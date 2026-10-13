// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
// bridge: deleted in D01 with e2e/bridge-journey.sh (PRJ-121 intent 01, spec §4.1)
/**
 * THE BRIDGE REHEARSAL'S DRY RUN (e2e/bridge-journey.sh --dry-run; PRJ-121 intent 01, task B09, spec 01 §4.3 step 2).
 *
 * The live rehearsal runs only on a dispatch, against the sandbox's copy of Svayamtech's gov repo — so a typo in it
 * would surface half an hour into a real run, and a wrong target would reset a real repository. The dry run walks every
 * step and prints each gh / git / gov / gov-cicd / npm call instead of making it. This test proves that it walks the
 * whole §4.3 sequence in order, touches NOTHING outside (each program is a trap on PATH), never targets a repo outside
 * the sandbox, and that the workflow job is read by intent 05's verdict rules (I05.1): never a skipped job or step.
 */
import { expect } from "chai";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import yaml from "js-yaml";

const SCRIPT = path.resolve(import.meta.dirname, "../../e2e/bridge-journey.sh");
const VERDICT = path.resolve(import.meta.dirname, "../../e2e/live-verdict.sh");
const WORKFLOW = path.resolve(import.meta.dirname, "../../../../../.github/workflows/adopter-e2e.yml");
const TRAPPED = ["gh", "git", "gov", "gov-cicd", "npm", "curl"];

interface Run { status: number | null; out: string; called: string }

function run(args: string[], extra: NodeJS.ProcessEnv = {}): Run {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-dry-"));
  try {
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    for (const p of TRAPPED) fs.writeFileSync(path.join(bin, p), `#!/usr/bin/env bash\necho "${p} $*" >> "${path.join(dir, "called.log")}"\nexit 97\n`, { mode: 0o755 });
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`, ...extra };
    for (const k of ["GH_TOKEN", "GITHUB_ACTIONS", "E2E_ORG", "GOV_TARBALL", "GOV_CICD_PACKAGE", "BRIDGE_REPO", "BRIDGE_APP_REPO", "E2E_SKIPS_FILE"]) if (!(k in extra)) delete env[k];
    const r = spawnSync("bash", [SCRIPT, ...args], { env, encoding: "utf8" });
    const log = path.join(dir, "called.log");
    return { status: r.status, out: `${r.stdout}${r.stderr}`, called: fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "" };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

describe("e2e/bridge-journey.sh --dry-run", function () {
  this.timeout(30_000);
  if (process.platform === "win32") return; // a bash script; the job runs on ubuntu

  let dry: Run;
  before(() => { dry = run(["--dry-run"], { GOV_TARBALL: "/dry/gov.tgz", E2E_SKIPS_FILE: path.join(os.tmpdir(), `bridge-skips-${process.pid}.tsv`) }); });
  after(() => fs.rmSync(path.join(os.tmpdir(), `bridge-skips-${process.pid}.tsv`), { force: true }));

  it("walks to the end and exits 0, nothing skipped", () => {
    expect(dry.status, dry.out).to.equal(0);
    expect(dry.out).to.match(/bridge-journey \(DRY RUN\): \d+ passed, 0 skipped, ok/);
    expect(fs.existsSync(path.join(os.tmpdir(), `bridge-skips-${process.pid}.tsv`)), "the dry run writes no skip for the verdict").to.equal(false);
  });

  it("calls nothing outside — every program it would run is only printed", () => {
    expect(dry.called).to.equal("");
  });

  it("walks spec §4.3 step 2 in order: reset → upgrade --pr → merge → propose --all → build → protect → install → doctor → join → work → task → merge → gov-cicd", () => {
    const order = [
      "+ git -C", // the clone
      "push -q --force origin dry-snapshot-sha:refs/heads/main",
      "gov upgrade --pr --from ",
      "gh pr merge 1 --repo dry-sandbox-org/svm-prj-work-rehearsal --merge",
      "gov rules propose --all --pr 2",
      "gh pr merge 2 --repo dry-sandbox-org/svm-prj-work-rehearsal --merge",
      "gov rules build",
      "gov repo protect apply",
      "gov check install --repo ",
      "gov doctor",
      "gov seed ",
      "gov join ",
      "gov work PRJ-",
      "gov task ",
      "gov merge ",
      "gov-cicd catalog --json",
      "gov-cicd deploy dry-unit --env dev --dry-run",
    ];
    let at = -1;
    for (const o of order) {
      const i = dry.out.indexOf(o, at + 1);
      expect(i, `"${o}" after the previous step`).to.be.greaterThan(at);
      at = i;
    }
  });

  it("the copy points at the sandbox BEFORE the first gov call — never at Svayamtech", () => {
    const pointer = dry.out.indexOf('+ set github_org: "dry-sandbox-org" in copy/org-config.yaml');
    expect(pointer, "org-config's github_org is rewritten").to.be.greaterThan(-1);
    // Both are "+ call" lines on stderr (the step banners are on stdout), so their order is the order of the calls.
    expect(pointer).to.be.lessThan(dry.out.indexOf(") gov upgrade --pr"));
    expect(dry.out).to.include("would assert: org-config.yaml names the sandbox (dry-sandbox-org), not Svayamtech");
  });

  it("the upgrade PR's CI installs the gov under test: --gov-package and gov-validate on the tarball (Q9)", () => {
    expect(dry.out).to.include("gov upgrade --pr --from ").and.include("--gov-package ./.gov-ci/gov.tgz");
    expect(dry.out).to.match(/\+ perl -pi -e s\{npm install -g \\@svayam-opensource\/gov\\S\*\}\{npm install -g \.\/\.gov-ci\/gov\.tgz\} \S+gov-validate\.yml/);
    expect(dry.out).to.include("would assert: the upgrade PR re-renders gov-checks.yml to install the gov under test (Q9)");
    expect(dry.out).to.include("would assert: the upgrade PR carries the move record at framework/upgrade-moves.json");
  });

  it("lists every assertion of the rehearsal", () => {
    for (const a of ["gov upgrade --pr opened the upgrade PR", "upgrade: CI green on PR #1", "no legacy root move record is left",
      "propose --all wrote the org's rule store", "policy (propose --all): CI green on PR #2", "gov rules check: nothing stale after the build",
      "gov check install wrote the code repo's gov-checks.yml", "gov doctor exited 0", "gov doctor says ok", "gov seed created the project branch",
      "gov work printed the session-start prompt", "gov task opened a sub-branch", "gov merge closed the issue", "gov-cicd reads the copy's catalog"]) {
      expect(dry.out, a).to.include(`would assert: ${a}`);
    }
  });

  it("tears down what it created beside the copy — and never deletes the copy", () => {
    expect(dry.out).to.match(/\+ gh project delete 1 --owner dry-sandbox-org/);
    expect(dry.out).to.match(/\+ gh api -X DELETE repos\/dry-sandbox-org\/e2e-app\/git\/refs\/heads\/bridge-dry/);
    expect(dry.out).to.not.match(/gh repo delete/);
  });

  it("never prints a token", () => {
    expect(dry.out).to.not.include("dry-token-never-used");
  });

  describe("refuses, before any call, a target outside the sandbox", () => {
    const live = { GH_TOKEN: "t-SECRET", GOV_TARBALL: "/x/gov.tgz", CONTENT_DIR: "/x/content" };
    for (const [name, env] of [
      ["the real org", { E2E_ORG: "Svayamtech", BRIDGE_REPO: "Svayamtech/svm-prj-work-rehearsal" }],
      ["a repo outside the sandbox org", { E2E_ORG: "svayam-e2e", BRIDGE_REPO: "Svayamtech/svm-prj-work" }],
      ["a sandbox repo that is not a rehearsal copy", { E2E_ORG: "svayam-e2e", BRIDGE_REPO: "svayam-e2e/svm-prj-work" }],
      ["a code repo outside the sandbox", { E2E_ORG: "svayam-e2e", BRIDGE_APP_REPO: "Svayamtech/910-GOV-CICD" }],
    ] as const) {
      it(name, () => {
        const r = run([], { ...live, ...env });
        expect(r.status, r.out).to.equal(2);
        expect(r.called, "nothing was called").to.equal("");
        expect(r.out).to.match(/refusing|real org/);
      });
    }
  });
});

describe("adopter-e2e.yml — the bridge job, read by intent 05's verdict rules (I05.1)", () => {
  type Step = { name?: string; if?: string; run?: string; env?: Record<string, string> };
  const wf = yaml.load(fs.readFileSync(WORKFLOW, "utf8")) as { on: { workflow_dispatch: { inputs: Record<string, { type: string; default: unknown }> } }; jobs: Record<string, { if?: string; steps: Step[] }> };
  const job = wf.jobs.bridge!;

  it("is dispatch-only, and the live rehearsal is an input that defaults off", () => {
    expect(job.if).to.equal("github.event_name == 'workflow_dispatch'");
    expect(wf.on.workflow_dispatch.inputs.bridge).to.deep.include({ type: "boolean", default: false });
  });

  it("no step is conditional but the verdict (always) — a dispatch never shows a skipped step (green-streak.sh)", () => {
    for (const s of job.steps) if (s.if !== undefined) expect(s.if, s.name).to.equal("always()");
    const main = job.steps.find((s) => s.name?.startsWith("Bridge journey"))!;
    expect(main.run).to.include("bridge-journey.sh --dry-run").and.include("bridge-journey.sh\n");
    expect(main.env!.LIVE).to.equal("${{ inputs.bridge && '1' || '0' }}");
  });

  it("ends with live-verdict.sh naming the bridge journey, strict", () => {
    const v = job.steps[job.steps.length - 1]!;
    expect(v.run).to.include("live-verdict.sh");
    expect(v.env).to.deep.include({ JOURNEYS: "bridge:${{ steps.bridge.outcome }}", STRICT: "true" });
  });
});

describe("e2e/live-verdict.sh — the bridge journey", () => {
  if (process.platform === "win32") return;
  const verdict = (env: NodeJS.ProcessEnv): { status: number | null; out: string } => {
    const r = spawnSync("bash", [VERDICT], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };

  it("success → exit 0, the bridge journey alone (not the adopter or rule-model journeys)", () => {
    const r = verdict({ JOURNEYS: "bridge:success", STRICT: "true" });
    expect(r.status, r.out).to.equal(0);
    expect(r.out).to.include("✓ bridge journey: success").and.not.include("adopter");
  });

  it("a skipped step of the rehearsal makes it incomplete and fails the dispatch", () => {
    const f = path.join(os.tmpdir(), `bridge-verdict-${process.pid}.tsv`);
    fs.writeFileSync(f, "bridge\t8 — GOV_CICD_PACKAGE not set\n");
    try {
      const r = verdict({ JOURNEYS: "bridge:success", STRICT: "true", E2E_SKIPS_FILE: f });
      expect(r.status).to.equal(1);
      expect(r.out).to.include("::error::bridge journey: incomplete — skipped 8 — GOV_CICD_PACKAGE not set");
    } finally { fs.rmSync(f, { force: true }); }
  });

  it("a failed rehearsal fails the job", () => {
    expect(verdict({ JOURNEYS: "bridge:failure", STRICT: "true" }).status).to.equal(1);
  });

  it("without JOURNEYS it still reads the live job's two journeys", () => {
    const r = verdict({ ADOPTER: "success", RULEMODEL: "success", STRICT: "true" });
    expect(r.status, r.out).to.equal(0);
    expect(r.out).to.include("✓ adopter journey: success").and.include("✓ rule-model journey: success");
  });
});
