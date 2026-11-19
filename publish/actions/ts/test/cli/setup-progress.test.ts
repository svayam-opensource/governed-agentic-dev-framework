// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
// THE SET-UP BREADCRUMB ON DISK (#391): ~/.gov/setup-state.json in a throwaway HOME — the file's mode, the machine
// probe, the workspace folders made on resume, and the redeem against a stubbed fetch.
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { advanceSetup, loadSetupState, noteSetup, probeMachine, setupStateFile } from "../../src/cli/setup-progress.js";
import { stepStatus, type FetchLike } from "../../src/setup/setup-state.js";

const CODE = "GS-disk-test-5678";
const ENV = { GOV_SETUP_CODE: CODE, GOV_SETUP_ISSUER: "https://iam-dev.svayamtech.com" };
const has = (): boolean => true;

function world(): { home: string; gov: string } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gov-setup-state-"));
  return { home, gov: path.join(home, ".gov", "acme", "gov_repo") };
}

/** A governance repository in place and registered, as adopt or join leaves it. */
function placeGovernance(w: { home: string; gov: string }): void {
  fs.mkdirSync(w.gov, { recursive: true });
  fs.writeFileSync(path.join(w.gov, "org-config.yaml"), 'org_name: "Acme Ltd"\norg_slug: "ACME"\ngithub_org: "acme"\norg_gov_repo: "acme-gov"\ndefault_branch: "main"\n');
  fs.writeFileSync(path.join(w.home, ".gov", "workspaces"), `acme\t${w.gov}\n`);
  fs.writeFileSync(path.join(w.home, ".gov", "active"), "acme\n");
}

function okFetch() {
  const calls: string[] = [];
  const fetch: FetchLike = async (url) => { calls.push(url); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  return { fetch, calls };
}

describe("gov-work — set-up breadcrumb on disk (#391)", () => {
  it("lives at ~/.gov/setup-state.json, owner-only, and holds the code only until redeemed", async function () {
    const w = world();
    noteSetup(ENV, { now: "2026-11-19T10:00:00.000Z", home: w.home, has });
    const file = setupStateFile(w.home);
    expect(file).to.equal(path.join(w.home, ".gov", "setup-state.json"));
    expect(fs.readFileSync(file, "utf8")).to.include(CODE);
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).to.equal(0o600);

    placeGovernance(w);
    const { fetch, calls } = okFetch();
    const lines: string[] = [];
    const s = await advanceSetup({ print: (l) => lines.push(l), clientVersion: "t", fetch, home: w.home, has });
    expect(calls).to.deep.equal(["https://iam-dev.svayamtech.com/gov-setup/redeem"]);
    expect(lines).to.deep.equal(["Your gov web set-up step is complete."]);
    expect(stepStatus(s!, "setup-signal")).to.equal("done");
    expect(fs.readFileSync(file, "utf8"), "the code is gone once redeemed").to.not.include(CODE);
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).to.equal(0o600);
  });

  it("RESUME: with the governance repository in place, the workspace folders are made and machine-env is done", async () => {
    const w = world();
    fs.mkdirSync(path.join(w.home, ".gov"), { recursive: true });
    placeGovernance(w);
    const before = probeMachine(w.home, has);
    expect(before["governance-repo"]).to.equal(true);
    expect(before["machine-env"], "the work root does not exist yet").to.equal(false);
    await advanceSetup({ print: () => { /* no code: silent */ }, clientVersion: "t", fetch: okFetch().fetch, home: w.home, has, create: true });
    expect(fs.existsSync(path.join(w.home, ".gov", "acme", "projects")), "~/.gov/<slug>/projects").to.equal(true);
    expect(stepStatus(loadSetupState(w.home), "machine-env")).to.equal("done");
  });

  it("nothing registered: governance-repo stays pending and the code is NOT sent", async () => {
    const w = world();
    noteSetup(ENV, { now: "2026-11-19T10:00:00.000Z", home: w.home, has });
    const { fetch, calls } = okFetch();
    const lines: string[] = [];
    const s = await advanceSetup({ print: (l) => lines.push(l), clientVersion: "t", fetch, home: w.home, has });
    expect(stepStatus(s!, "governance-repo")).to.equal("pending");
    expect(calls).to.deep.equal([]);
    expect(lines).to.deep.equal([]);
    expect(loadSetupState(w.home).setupCode?.code).to.equal(CODE);
  });

  it("an ordinary command with no code and no trail leaves nothing in ~/.gov", async () => {
    const w = world();
    noteSetup({}, { home: w.home, has });
    await advanceSetup({ print: () => { /* silent */ }, clientVersion: "t", fetch: okFetch().fetch, home: w.home, has });
    expect(fs.existsSync(setupStateFile(w.home))).to.equal(false);
    noteSetup({}, { home: w.home, has, create: true });
    expect(fs.existsSync(setupStateFile(w.home)), "a set-up step starts the trail").to.equal(true);
  });

  it("git or gh missing: prerequisites and machine-env pending", () => {
    const w = world();
    fs.mkdirSync(path.join(w.home, ".gov"), { recursive: true });
    placeGovernance(w);
    const p = probeMachine(w.home, (c) => c !== "gh");
    expect(p.prerequisites).to.equal(false);
    expect(p["machine-env"]).to.equal(false);
  });

  it("a refusal never fails the run: the code is kept and one line is printed", async () => {
    const w = world();
    fs.mkdirSync(path.join(w.home, ".gov"), { recursive: true });
    placeGovernance(w);
    fs.mkdirSync(path.join(w.home, ".gov", "acme", "projects"), { recursive: true });
    noteSetup(ENV, { now: "2026-11-19T10:00:00.000Z", home: w.home, has });
    const refuse: FetchLike = async () => ({ ok: false, status: 400, json: async () => ({ ok: false }) });
    const lines: string[] = [];
    await advanceSetup({ print: (l) => lines.push(l), clientVersion: "t", fetch: refuse, home: w.home, has });
    expect(lines).to.have.length(1);
    expect(lines[0]).to.include("Install page").and.not.include(CODE);
    expect(loadSetupState(w.home).setupCode?.code).to.equal(CODE);
  });
});
