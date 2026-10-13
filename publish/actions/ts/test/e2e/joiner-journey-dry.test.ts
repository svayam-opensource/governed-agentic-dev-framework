// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE LIVE JOINER JOURNEY, HERMETICALLY (PRJ-121 intent 05, Item 4 — task T15; rulings I05.5, Q2, Q5).
 *
 * The live journey runs only in the sandbox org as a second account (TESTBED_JOINER_PAT), so a mistake in it would
 * surface half an hour into a real run. Its dry run walks every step and prints each gh / git / gov / npm call instead
 * of making it. This test proves it walks join → work → task → merge in order through FLAGS ONLY (ruling Q5: no pty,
 * stdin closed), touches nothing outside (every program is a trap on PATH), refuses to run as the adopter's own
 * account, and that adopter-e2e.yml wires it between the adopter's two phases with the two new secrets.
 */
import { expect } from "chai";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import yaml from "js-yaml";

const SCRIPT = path.resolve(import.meta.dirname, "../../e2e/joiner-journey.sh");
const IDENTITY = path.resolve(import.meta.dirname, "../../e2e/joiner-identity.sh");
const ADOPTER = path.resolve(import.meta.dirname, "../../e2e/adopter-journey.sh");
const WORKFLOW = path.resolve(import.meta.dirname, "../../../../../.github/workflows/adopter-e2e.yml");
const TRAPPED = ["gh", "git", "gov", "npm", "curl"];

interface Run { status: number | null; out: string; called: string }

function run(script: string, args: string[], extra: NodeJS.ProcessEnv = {}): Run {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "joiner-dry-"));
  try {
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    for (const p of TRAPPED) fs.writeFileSync(path.join(bin, p), `#!/usr/bin/env bash\necho "${p} $*" >> "${path.join(dir, "called.log")}"\nexit 97\n`, { mode: 0o755 });
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`, ...extra };
    for (const k of ["GH_TOKEN", "GITHUB_ACTIONS", "E2E_ORG", "GOV_TARBALL", "E2E_HANDOFF", "E2E_JOINER_LOGIN", "E2E_JOINER_HOME", "E2E_PHASE"]) if (!(k in extra)) delete env[k];
    const r = spawnSync("bash", [script, ...args], { env, encoding: "utf8" });
    const log = path.join(dir, "called.log");
    return { status: r.status, out: `${r.stdout}${r.stderr}`, called: fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "" };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

describe("e2e/joiner-journey.sh --dry-run", function () {
  this.timeout(30_000);
  if (process.platform === "win32") return; // a bash script; the job runs on ubuntu

  let dry: Run;
  before(() => { dry = run(SCRIPT, ["--dry-run"]); });

  it("walks to the end and exits 0", () => {
    expect(dry.status, dry.out).to.equal(0);
    expect(dry.out).to.match(/joiner-journey \(DRY RUN\): \d+ passed, ok — as joiner-bot/);
  });

  it("calls nothing outside — every program it would run is only printed", () => {
    expect(dry.called).to.equal("");
  });

  it("walks the joiner's path in order, through flags only: install → whoami → setup --join → work --no-launch → task → merge", () => {
    const order = [
      "+ npm i -g /dry/gov.tgz",
      "+ gh api user --jq .login",
      "+ gov setup --join svayam-e2e/gov-e2e-dry-gov",
      "+ gov work --project=PRJ-0-gov-e2e-dry --no-launch",
      "+ gov task https://github.com/svayam-e2e/gov-e2e-dry-svc/issues/2",
      "+ gov merge https://github.com/svayam-e2e/gov-e2e-dry-svc/issues/2",
    ];
    let at = -1;
    for (const line of order) {
      const i = dry.out.indexOf(line);
      expect(i, `missing or out of order: ${line}`).to.be.greaterThan(at);
      at = i;
    }
  });

  it("asserts what Item 4 accepts: In progress after task, closed BY the joiner, Done after merge", () => {
    expect(dry.out).to.include("board Status would be 'In progress' after gov task");
    expect(dry.out).to.include("closed by joiner-bot — the second identity, not the adopter");
    expect(dry.out).to.include("board Status would be 'Done' after gov merge");
  });

  it("FAILS LOUDLY when the joiner is the adopter's own account — a second identity or nothing", () => {
    const same = run(SCRIPT, ["--dry-run"], { E2E_JOINER_LOGIN: "adopter-bot" });
    expect(same.status).to.equal(1);
    expect(same.out).to.match(/the joiner and the adopter are the SAME account \(adopter-bot\)/);
    expect(same.out).to.match(/joiner-journey \(DRY RUN\): \d+ passed, FAILED/);
  });

  it("live, it refuses to start without the handoff, the token or the expected login — naming which", () => {
    const r = run(SCRIPT, [], { GOV_TARBALL: "/x.tgz" });
    expect(r.status).to.not.equal(0);
    expect(r.out).to.match(/E2E_HANDOFF/);
    expect(r.called).to.equal("");
  });

  it("never prints a token: no GH_TOKEN value in its output", () => {
    const r = run(SCRIPT, ["--dry-run"], { GH_TOKEN: "ghp_SHOULD_NEVER_APPEAR" });
    expect(r.out).to.not.include("ghp_SHOULD_NEVER_APPEAR");
  });
});

describe("e2e/adopter-journey.sh phases (the joiner handoff)", function () {
  if (process.platform === "win32") return;

  it("rejects an unknown phase, and a split phase with no handoff file, before touching anything", () => {
    const env = { E2E_ORG: "o", GH_TOKEN: "t", GOV_TARBALL: "/x", CONTENT_DIR: "/x" };
    const bad = run(ADOPTER, [], { ...env, E2E_PHASE: "middle" });
    expect(bad.status).to.equal(2);
    expect(bad.called).to.equal("");
    const noHandoff = run(ADOPTER, [], { ...env, E2E_PHASE: "work" });
    expect(noHandoff.status).to.equal(2);
    expect(noHandoff.out).to.match(/needs E2E_HANDOFF/);
  });

  it("a finish phase with no handoff (the work phase never ran) has nothing to tear down and says so", () => {
    const r = run(ADOPTER, [], { E2E_ORG: "o", GH_TOKEN: "t", GOV_TARBALL: "/x", CONTENT_DIR: "/x", E2E_PHASE: "finish", E2E_HANDOFF: path.join(os.tmpdir(), `nope-${process.pid}.env`) });
    expect(r.status).to.equal(0);
    expect(r.out).to.match(/no handoff/);
    expect(r.called).to.equal("");
  });

  it("the work phase grants bot B only through bot A (collaborator + board WRITER), and refuses bot B = bot A", () => {
    const text = fs.readFileSync(ADOPTER, "utf8");
    expect(text).to.match(/collaborators\/\$JOINER_LOGIN" -f permission=push/);
    expect(text).to.match(/updateProjectV2Collaborators/);
    expect(text).to.match(/TESTBED_JOINER_LOGIN must be a SECOND account/);
  });
});

describe("adopter-e2e.yml — the live job runs the joiner (T15)", () => {
  interface Step { id?: string; name?: string; if?: string; env?: Record<string, string>; run?: string }
  const live = (): Step[] => (yaml.load(fs.readFileSync(WORKFLOW, "utf8")) as { jobs: Record<string, { steps: Step[] }> }).jobs["live"]!.steps;

  it("work phase → joiner → finish (always) → rule-model → verdict, in that order", () => {
    const want = ["guard", "pack", "adopter", "joiner", "finish", "rulemodel"];
    expect(live().map((s) => s.id).filter((id): id is string => want.includes(id ?? ""))).to.deep.equal(want);
    const finish = live().find((s) => s.id === "finish")!;
    expect(finish.if).to.match(/always\(\)/);
    expect(finish.env?.["E2E_PHASE"]).to.equal("finish");
    expect(live().find((s) => s.id === "adopter")!.env?.["E2E_PHASE"]).to.equal("work");
  });

  it("the joiner runs as TESTBED_JOINER_PAT with TESTBED_JOINER_LOGIN, never bot A's token", () => {
    const j = live().find((s) => s.id === "joiner")!;
    expect(j.env?.["GH_TOKEN"]).to.equal("${{ secrets.TESTBED_JOINER_PAT }}");
    expect(j.env?.["E2E_JOINER_LOGIN"]).to.equal("${{ secrets.TESTBED_JOINER_LOGIN }}");
    expect(j.run).to.include("e2e/joiner-journey.sh");
  });

  it("the guard reads both joiner secrets, and the verdict lists the joiner (unconfigured when the guard says so)", () => {
    const guard = live().find((s) => s.id === "guard")!;
    expect(guard.env?.["JOINER_TOK"]).to.equal("${{ secrets.TESTBED_JOINER_PAT }}");
    expect(guard.env?.["JOINER_LOGIN"]).to.equal("${{ secrets.TESTBED_JOINER_LOGIN }}");
    const verdict = live().find((s) => (s.name ?? "").includes("verdict"))!;
    expect(verdict.env?.["JOURNEYS"]).to.include("joiner:${{ steps.guard.outputs.joiner == 'true' && (steps.identity.outcome == 'success' && steps.joiner.outcome || 'identity-failed') || 'unconfigured' }}")
      .and.match(/adopter-close:/);
  });
});

// The live job's first look at the joiner (T15): before the adopter spends minutes, is TESTBED_JOINER_PAT a usable
// SECOND identity? A fake gh answers per token: "tokA" is the adopter (id 1), "tokB" the joiner (id 2, login joiner-bot).
describe("e2e/joiner-identity.sh", function () {
  if (process.platform === "win32") return;
  const FAKE_GH = `#!/usr/bin/env bash
case "$GH_TOKEN:$*" in
  "tokA:api user --jq .login") echo adopter-bot ;;
  "tokA:api user --jq .id") echo 1 ;;
  "tokB:api user --jq .login") echo joiner-bot ;;
  "tokB:api user --jq .id") echo 2 ;;
  "tokA:api users/joiner-bot --jq .id") echo 2 ;;
  "tokA:api users/someone-else --jq .id") echo 3 ;;
  "tokA:api orgs/svayam-e2e/memberships/joiner-bot --jq "*) echo "\${MEMBERSHIP:-active member}" ;;
  *) echo '{"message":"Not Found","status":"404"}'; exit 1 ;;
esac
`;
  function id(env: Record<string, string>): { status: number | null; out: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "joiner-id-"));
    try {
      fs.writeFileSync(path.join(dir, "gh"), FAKE_GH, { mode: 0o755 });
      const r = spawnSync("bash", [IDENTITY], { encoding: "utf8",
        env: { PATH: `${dir}${path.delimiter}${process.env.PATH ?? ""}`, E2E_ORG: "svayam-e2e", ADOPTER_TOKEN: "tokA", JOINER_TOKEN: "tokB", JOINER_LOGIN: "joiner-bot", ...env } });
      return { status: r.status, out: `${r.stdout}${r.stderr}` };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }

  it("a second, active member passes — and prints account ids, never a token", () => {
    const r = id({ JOINER_LOGIN: "Joiner-Bot\n" });   // case and a pasted newline do not matter
    expect(r.status, r.out).to.equal(0);
    expect(r.out).to.include("account id 2").and.include("account id 1");
    expect(r.out).to.not.match(/tok[AB]/);
  });

  it("FAILS LOUDLY when the joiner token is the adopter bot's own account", () => {
    const r = id({ JOINER_TOKEN: "tokA", JOINER_LOGIN: "adopter-bot" });
    expect(r.status).to.equal(1);
    expect(r.out).to.match(/::error::joiner identity: TESTBED_JOINER_PAT belongs to the adopter bot itself/);
  });

  it("a login that names no account is described by its shape, not printed", () => {
    const r = id({ JOINER_LOGIN: "joiner@example.com" });
    expect(r.status).to.equal(1);
    expect(r.out).to.include("names no GitHub account").and.include("shaped 'aaaaaa@aaaaaaa.aaa'");
    expect(r.out).to.not.include("joiner@example.com");
  });

  it("two secrets for two different accounts are named as that", () => {
    expect(id({ JOINER_LOGIN: "someone-else" }).out).to.match(/names account id 3, but TESTBED_JOINER_PAT is account id 2/);
  });

  it("an invitation not yet accepted is said as that", () => {
    const r = id({ MEMBERSHIP: "pending member" });
    expect(r.status).to.equal(1);
    expect(r.out).to.match(/invited to svayam-e2e but has not accepted/);
  });
});
