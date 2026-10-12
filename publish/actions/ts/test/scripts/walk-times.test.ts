// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// THE WALK IS CUT FROM THE LOG (PRJ-121 plan 04 T17, #276). `scripts/walk-times.mjs` reads gov's run logs and
// cuts spec 04 §2.2's six steps, each against its budget. The clock is ruling Q3: README opened → the agent posts
// its context manifest. Three marks are the observer's (gov is not running yet, or has handed the terminal to the
// agent): README opened, install command running, manifest posted. Everything else comes from the log.
//
// The fixture (fixtures/walk-linux) is three runs of one walk, as install.sh drives them: `gov --version`,
// `gov doctor --fix`, `gov list` (first-run → adopt → review offer → agent → launch).
import { expect } from "chai";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../../scripts/walk-times.mjs", import.meta.url));
const fixture = fileURLToPath(new URL("./fixtures/walk-linux", import.meta.url));
const OBSERVER = ["--start", "2026-10-12T10:00:00Z", "--install-at", "2026-10-12T10:00:25Z", "--manifest-at", "2026-10-12T10:08:30Z"];

interface Step { n: number; name: string; start: string | null; end: string | null; seconds: number | null; budget: number; over: boolean | null; source: string }
interface Cut { os: string; steps: Step[]; totalSeconds: number | null; complete: boolean; withinGate: boolean | null }

const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
const cut = (...args: string[]): Cut => {
  const r = run("--json", ...args);
  expect(r.status, r.stderr).to.equal(0);
  return JSON.parse(r.stdout) as Cut;
};

describe("walk-times: §2.2's six steps, cut from a run log", () => {
  it("fixture log + the observer's three marks → six durations", () => {
    const c = cut(...OBSERVER, fixture);
    expect(c.steps.map((s) => s.seconds)).to.deep.equal([25, 85, 110, 140, 75, 75]);
    expect(c.steps.map((s) => s.n)).to.deep.equal([1, 2, 3, 4, 5, 6]);
  });

  it("each step against its budget: over / under (macOS / Linux)", () => {
    const c = cut("--os", "linux", ...OBSERVER, fixture);
    expect(c.steps.map((s) => s.budget)).to.deep.equal([30, 90, 90, 150, 90, 90]);
    expect(c.steps.map((s) => s.over)).to.deep.equal([false, false, true, false, false, false]);
  });

  it("the total is README → manifest, and the gate is ≤ 10:00", () => {
    const c = cut(...OBSERVER, fixture);
    expect(c.totalSeconds).to.equal(510);
    expect(c.complete).to.equal(true);
    expect(c.withinGate).to.equal(true);
  });

  it("Windows has its own budgets: install 1:00, dependencies 2:00", () => {
    const c = cut("--os", "windows", ...OBSERVER, fixture);
    expect(c.steps.map((s) => s.budget)).to.deep.equal([45, 60, 120, 150, 90, 90]);
    expect(c.steps[1]!.over, "1:25 against 1:00").to.equal(true);
    expect(c.steps[2]!.over, "1:50 against 2:00").to.equal(false);
  });

  it("without the observer's marks: steps 1–2 unknown, step 6 ends at the launch, and the cut says it is partial", () => {
    const c = cut(fixture);
    expect(c.steps[0]!.seconds).to.equal(null);
    expect(c.steps[1]!.seconds).to.equal(null);
    expect(c.steps.slice(2, 5).map((s) => s.seconds)).to.deep.equal([110, 140, 75]);
    expect(c.steps[5]!.seconds).to.equal(25);
    expect(c.steps[5]!.source).to.match(/launch/);
    expect(c.complete).to.equal(false);
    expect(c.withinGate).to.equal(null);
  });

  it("an agent that was already installed: step 5 ends at the agent gov chose", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "walk-times-"));
    try {
      fs.cpSync(fixture, dir, { recursive: true });
      const f = path.join(dir, "2026-10-12", "100345-e5f6-list", "2026-10-12-gov-work.log");
      fs.writeFileSync(f, fs.readFileSync(f, "utf8").split("\n").filter((l) => !l.includes("phase agent-ready")).join("\n"));
      const c = cut(...OBSERVER, dir);
      expect(c.steps[4]!.seconds).to.equal(80);
      expect(c.steps[4]!.source).to.match(/chose agent/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("--markdown prints the walk record's table (spec 04 §5)", () => {
    const r = run("--markdown", ...OBSERVER, fixture);
    expect(r.status, r.stderr).to.equal(0);
    expect(r.stdout).to.contain("| step | start | end | duration | budget | over? |");
    expect(r.stdout).to.match(/\| 3 Dependencies \+ GitHub sign-in \| 10:01:50Z \| 10:03:40Z \| 1:50 \| 1:30 \| \*\*over\*\* \|/);
    expect(r.stdout).to.match(/\| \*\*Total\*\* \| 10:00:00Z \| 10:08:30Z \| 8:30 \| ≤ 10:00 \| under \|/);
  });

  it("no log to read is a usage error, not an empty table", () => {
    const r = run(path.join(os.tmpdir(), "no-such-walk-log-dir"));
    expect(r.status).to.equal(2);
    expect(r.stderr).to.match(/no gov run log/i);
  });
});
