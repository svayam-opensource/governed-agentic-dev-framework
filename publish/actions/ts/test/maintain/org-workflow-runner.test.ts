// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE ORG'S OWN COPY OF A WORKFLOW GOV INSTALLED FOLLOWS ci.runs_on — ITS runs-on LINES, NOTHING ELSE
 * (Policy Owner ruling, 2026-10-17).
 *
 * `.github/workflows/gov-validate.yml` is seeded once and is the organization's from then on (GOV-FRM-445). When
 * `ci.runs_on` is set, `gov upgrade` and `gov check install` rewrite ONLY its job-level `runs-on:` lines to that runner
 * and report each line they changed; every other byte stays the organization's. When `ci.runs_on` is absent, the file
 * is never touched. A workflow gov did not install (`validate.yml`, the org's own) is never touched either.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { GOV_SEEDED_WORKFLOWS, syncSeededWorkflowRunners } from "../../src/maintain/org-workflow-runner.js";
import { classifyRunsOn, DEFAULT_RUNNER } from "../../src/config/ci-runner.js";
import { runUpgradeSync, runUpgradePr } from "../../src/maintain/upgrade-run.js";

const CONTENT = fileURLToPath(new URL("../../../../content/", import.meta.url));
const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));
const put = (root: string, rel: string, text: string): void => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const read = (root: string, rel: string): string | null => { try { return fs.readFileSync(path.join(root, rel), "utf8"); } catch { return null; /* absent */ } };
const io = { read: (abs: string): string | null => (fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null), write: (abs: string, t: string): void => fs.writeFileSync(abs, t) };

const VALIDATE = ".github/workflows/gov-validate.yml";
/** The org's copy: its own trigger branches, an extra job, a comment, a step of its own, a matrix job. */
const ORG_COPY = `# Acme: our validation — edited by us.
name: gov-validate
on:
  pull_request:
  push:
    branches: ["main", "release/*"]   # ours
jobs:
  validate:
    name: gov validate
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - run: gov validate
      - run: ./scripts/our-extra-check.sh
  lint:
    runs-on:   ubuntu-latest   
    steps:
      - run: npm run lint
  cross:
    runs-on: \${{ matrix.os }}
    strategy:
      matrix: { os: [ubuntu-latest, windows-latest] }
    steps:
      - run: echo cross
`;
const SELF = classifyRunsOn(["self-hosted", "linux"]);
const expected = (value: string): string =>
  ORG_COPY.replace("    runs-on: ubuntu-latest\n", `    runs-on: ${value}\n`).replace("    runs-on:   ubuntu-latest   \n", `    runs-on:   ${value}\n`);

describe("gov rewrites only the runs-on lines of a workflow it installed (ruling 2026-10-17)", () => {
  it("the workflows gov installs into an org's repo are exactly the MANIFEST's .github/workflows rows", () => {
    const manifest = fs.readFileSync(path.join(CONTENT, "MANIFEST.yaml"), "utf8");
    const rows = [...manifest.matchAll(/dst: (\.github\/workflows\/[^,\s]+)/g)].map((m) => m[1]).sort();
    expect([...GOV_SEEDED_WORKFLOWS].sort()).to.deep.equal(rows);
  });

  it("a list: every job's runs-on set, a matrix job kept, every other byte the org's — and each line reported", () => {
    const dir = tmp("owr-");
    put(dir, VALIDATE, ORG_COPY);
    const r = syncSeededWorkflowRunners(dir, SELF, io, true);
    expect(read(dir, VALIDATE)).to.equal(expected("[self-hosted, linux]"));
    expect(r.changed).to.deep.equal([VALIDATE]);
    expect(r.lines).to.deep.equal([
      `  ${VALIDATE}:10  runs-on: ubuntu-latest → [self-hosted, linux]   (ci.runs_on in policies/governance.yaml)`,
      `  ${VALIDATE}:17  runs-on: ubuntu-latest → [self-hosted, linux]   (ci.runs_on in policies/governance.yaml)`,
    ]);
  });

  it("one label: written as a plain scalar", () => {
    const dir = tmp("owr-");
    put(dir, VALIDATE, ORG_COPY);
    syncSeededWorkflowRunners(dir, classifyRunsOn("acme-runner"), io, true);
    expect(read(dir, VALIDATE)).to.equal(expected("acme-runner"));
  });

  it("CRLF line endings survive", () => {
    const dir = tmp("owr-");
    put(dir, VALIDATE, ORG_COPY.replace(/\n/g, "\r\n"));
    syncSeededWorkflowRunners(dir, SELF, io, true);
    expect(read(dir, VALIDATE)).to.equal(expected("[self-hosted, linux]").replace(/\n/g, "\r\n"));
  });

  it("ci.runs_on ABSENT → never touched, nothing said — even a file still on ubuntu-latest", () => {
    const dir = tmp("owr-");
    put(dir, VALIDATE, ORG_COPY);
    const before = fs.statSync(path.join(dir, VALIDATE)).mtimeMs;
    const r = syncSeededWorkflowRunners(dir, DEFAULT_RUNNER, io, true);
    expect(r).to.deep.equal({ lines: [], changed: [] });
    expect(read(dir, VALIDATE)).to.equal(ORG_COPY);
    expect(fs.statSync(path.join(dir, VALIDATE)).mtimeMs).to.equal(before);
  });

  it("an unusable ci.runs_on → untouched, and said, naming the key", () => {
    const dir = tmp("owr-");
    put(dir, VALIDATE, ORG_COPY);
    const r = syncSeededWorkflowRunners(dir, classifyRunsOn("two words"), io, true);
    expect(read(dir, VALIDATE)).to.equal(ORG_COPY);
    expect(r.lines.join("\n")).to.contain("ci.runs_on:").and.contain("left as it is");
  });

  it("a workflow gov did not install (the org's own validate.yml) is never touched", () => {
    const dir = tmp("owr-");
    put(dir, ".github/workflows/validate.yml", ORG_COPY);
    const r = syncSeededWorkflowRunners(dir, SELF, io, true);
    expect(read(dir, ".github/workflows/validate.yml")).to.equal(ORG_COPY);
    expect(r.changed).to.deep.equal([]);
  });

  it("already on the runner → no write, nothing said; a dry run lists and writes nothing", () => {
    const dir = tmp("owr-");
    put(dir, VALIDATE, expected("[self-hosted, linux]"));
    expect(syncSeededWorkflowRunners(dir, SELF, io, true)).to.deep.equal({ lines: [], changed: [] });
    put(dir, VALIDATE, ORG_COPY);
    const dry = syncSeededWorkflowRunners(dir, SELF, io, false);
    expect(read(dir, VALIDATE)).to.equal(ORG_COPY);
    expect(dry.lines[0]).to.equal(`  ~ update   ${VALIDATE}:10  runs-on: ubuntu-latest → [self-hosted, linux]   (ci.runs_on in policies/governance.yaml)`);
  });
});

describe("gov upgrade keeps the org's gov-validate.yml on ci.runs_on", function () {
  this.timeout(30000);
  function content(): string {
    const c = tmp("owr-content-");
    put(c, "MANIFEST.yaml", ["files:", "  - { src: VERSION, dst: VERSION, mode: scaffold-auto }",
      `  - { src: ${VALIDATE}, dst: ${VALIDATE}, mode: seed-once }`, ""].join("\n"));
    put(c, "VERSION", "2.0.0\n");
    put(c, VALIDATE, "name: gov-validate\njobs:\n  validate:\n    runs-on: ubuntu-latest\n");
    return c;
  }
  function workspace(governance: string | null): string {
    const ws = tmp("owr-ws-");
    put(ws, "org-config.yaml", 'org_name: "Acme Corp"\ngithub_org: "acme"\n');
    if (governance !== null) put(ws, "policies/governance.yaml", governance);
    put(ws, "VERSION", "1.9.0\n");
    put(ws, VALIDATE, ORG_COPY);
    return ws;
  }

  it("--apply: the existing copy's runs-on lines follow ci.runs_on, the rest is the org's, the lines are reported", () => {
    const ws = workspace("ci:\n  runs_on: [self-hosted, linux]\n");
    const r = runUpgradeSync(content(), ws, { apply: true });
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(read(ws, VALIDATE)).to.equal(expected("[self-hosted, linux]"));
    expect(r.lines.join("\n")).to.contain(`${VALIDATE}:10  runs-on: ubuntu-latest → [self-hosted, linux]`);
  });

  it("--apply with no ci.runs_on: byte for byte", () => {
    const ws = workspace("governance_posture: soft\n");
    runUpgradeSync(content(), ws, { apply: true });
    expect(read(ws, VALIDATE)).to.equal(ORG_COPY);
  });

  it("dry run: listed, not written", () => {
    const ws = workspace("ci:\n  runs_on: [self-hosted, linux]\n");
    const r = runUpgradeSync(content(), ws, { apply: false });
    expect(read(ws, VALIDATE)).to.equal(ORG_COPY);
    expect(r.lines.join("\n")).to.contain(`~ update   ${VALIDATE}:10`);
  });

  it("--pr: the change is on the upgrade branch", () => {
    const ws = workspace("ci:\n  runs_on: [self-hosted, linux]\n");
    const remote = tmp("owr-remote-");
    execFileSync("git", ["init", "-q", "--bare", remote]);
    const g = (...a: string[]): string => execFileSync("git", ["-C", ws, ...a], { encoding: "utf8" });
    g("init", "-q", "-b", "main"); g("config", "user.email", "t@example.com"); g("config", "user.name", "t");
    g("remote", "add", "origin", remote);
    g("add", "-A"); g("commit", "-qm", "seed");
    const r = runUpgradePr(content(), ws, { userHome: tmp("owr-home-"), openPr: () => "https://example.test/pr/1", govVersion: "2.0.0" });
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(g("show", `gov-upgrade-2.0.0:${VALIDATE}`)).to.equal(expected("[self-hosted, linux]"));
  });
});
