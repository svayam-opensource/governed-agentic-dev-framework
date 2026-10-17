// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE LIVE SIGNAL ROUND-TRIP, HERMETICALLY (PRJ-121 intent 03, task L09, gadf#287; spec 03 §4 and its live tier).
 *
 * The live journey needs two svayam-e2e accounts and runs inside the adopter-e2e `live` job; its dry run walks every
 * step and prints each call instead of making it. This proves the order the spec asks for — two projects, then each
 * signal kind sent by bot A, seen in bot B's manifest as "Incoming signals", closed by bot B, gone from bot A's
 * Outgoing line — that every send and ack goes through a person's terminal (Q6), that nothing outside is touched,
 * and that the workflow runs it between the joiner and the finish phase and lists it in the verdict.
 */
import { expect } from "chai";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import yaml from "js-yaml";

const SCRIPT = path.resolve(import.meta.dirname, "../../e2e/signal-journey.sh");
const WORKFLOW = path.resolve(import.meta.dirname, "../../../../../.github/workflows/adopter-e2e.yml");
const TRAPPED = ["gh", "git", "gov", "npm", "script", "curl"];

function run(args: string[], extra: NodeJS.ProcessEnv = {}): { status: number | null; out: string; called: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "signal-dry-"));
  try {
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    for (const p of TRAPPED) fs.writeFileSync(path.join(bin, p), `#!/usr/bin/env bash\necho "${p} $*" >> "${path.join(dir, "called.log")}"\nexit 97\n`, { mode: 0o755 });
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`, ...extra };
    for (const k of ["GH_TOKEN", "GITHUB_ACTIONS", "E2E_ORG", "E2E_HANDOFF", "E2E_JOINER_TOKEN", "E2E_JOINER_LOGIN", "E2E_JOINER_HOME", "GOV_TARBALL"]) if (!(k in extra)) delete env[k];
    const r = spawnSync("bash", [SCRIPT, ...args], { env, encoding: "utf8" });
    const log = path.join(dir, "called.log");
    return { status: r.status, out: `${r.stdout}${r.stderr}`, called: fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "" };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

describe("e2e/signal-journey.sh --dry-run", function () {
  this.timeout(30_000);
  if (process.platform === "win32") return;

  let dry: ReturnType<typeof run>;
  before(() => { dry = run(["--dry-run"]); });

  it("walks to the end and exits 0, calling nothing outside", () => {
    expect(dry.status, dry.out).to.equal(0);
    expect(dry.out).to.match(/signal-journey \(DRY RUN\): \d+ passed, ok/);
    expect(dry.called).to.equal("");
  });

  it("two projects first, then ask → depends → notice → handover → merge, in that order", () => {
    const order = [
      "+ gov project sig-a-dry --seed",
      "+ gov project sig-b-dry --seed",
      "--no-launch",
      "person gov signal ask --to PRJ-102-sig-b-dry",
      "person gov signal depends --to PRJ-102-sig-b-dry",
      "person gov signal notice --to PRJ-102-sig-b-dry",
      "person gov signal handover --to PRJ-102-sig-b-dry",
      "person gov signal merge --to PRJ-102-sig-b-dry",
    ];
    let at = -1;
    for (const line of order) {
      const i = dry.out.indexOf(line, at + 1);
      expect(i, `missing or out of order: ${line}`).to.be.greaterThan(at);
      at = i;
    }
  });

  it("the round-trip, for each request kind: sent by A, Incoming in B's manifest, closed by B, gone from A's Outgoing", () => {
    for (const kind of ["ask", "depends", "notice"]) {
      const block = dry.out.slice(dry.out.indexOf(`▶ ${kind} — `));
      expect(block).to.include(`(A in PRJ-101-sig-a-dry) person gov signal ${kind}`);
      expect(block).to.include("(B in PRJ-102-sig-b-dry) gov signal list");
      expect(block).to.include(`…and it names this ${kind} from PRJ-101-sig-a-dry`);
      expect(block).to.match(/\(B in PRJ-102-sig-b-dry\) person gov signal ack /);
      expect(block).to.include("bot A's Outgoing signals no longer list it");
    }
  });

  it("every send and every ack is a PERSON's, through a terminal (spec 03 Q6) — never a bare gov signal send", () => {
    const sends = dry.out.split("\n").filter((l) => / gov signal (ask|depends|notice|handover|merge|ack) /.test(l));
    expect(sends.length).to.be.greaterThan(0);
    for (const l of sends) expect(l, l).to.include("person gov signal");
  });

  it("live, it refuses to start without the handoff, both tokens and bot B's HOME — before calling anything", () => {
    const r = run([], { GOV_TARBALL: "/x.tgz" });
    expect(r.status).to.not.equal(0);
    expect(r.out).to.match(/E2E_HANDOFF/);
    expect(r.called).to.equal("");
  });
});

describe("adopter-e2e.yml — the live job runs the signal round-trip (L09)", () => {
  interface Step { id?: string; name?: string; if?: string; env?: Record<string, string>; run?: string }
  const live = (): Step[] => (yaml.load(fs.readFileSync(WORKFLOW, "utf8")) as { jobs: Record<string, { steps: Step[] }> }).jobs["live"]!.steps;

  it("after the joiner, before the finish phase deletes the org's gov repo", () => {
    const want = ["adopter", "joiner", "signal", "finish"];
    expect(live().map((s) => s.id).filter((id): id is string => want.includes(id ?? ""))).to.deep.equal(want);
  });

  it("bot A sends with TESTBED_BOT_PAT; bot B receives with TESTBED_JOINER_PAT in the joiner's HOME", () => {
    const s = live().find((x) => x.id === "signal")!;
    expect(s.env?.["GH_TOKEN"]).to.equal("${{ secrets.TESTBED_BOT_PAT }}");
    expect(s.env?.["E2E_JOINER_TOKEN"]).to.equal("${{ secrets.TESTBED_JOINER_PAT }}");
    expect(s.env?.["E2E_JOINER_HOME"]).to.equal(live().find((x) => x.id === "joiner")!.env?.["E2E_JOINER_HOME"]);
  });

  it("the verdict lists it — unconfigured (a failure on a strict run) when the joiner's secrets are missing", () => {
    const v = live().find((x) => (x.name ?? "").includes("verdict"))!;
    expect(v.env?.["JOURNEYS"]).to.include("signal:${{ steps.guard.outputs.joiner == 'true' && (steps.identity.outcome == 'success' && steps.signal.outcome || 'identity-failed') || 'unconfigured' }}");
  });
});
