// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * PHASE MARKERS — the timed walk is cut from the log, not from a video (PRJ-121 plan 04 T17, #276).
 *
 * Spec 04 §5: "each first-run step banner is logged as a phase marker so §2.2's six steps can be cut from the
 * log". So every banner that opens a checklist step writes exactly ONE `phase step-<n>` line, and the line that
 * ticks it writes exactly one `phase step-<n>-done`. One, not "at least one": `walk-times` takes the first marker
 * of each kind, and a duplicate from a second render would be a silent wrong time, not an error.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { endRun, phase, startRun } from "../src/log.js";
import { checklist, stepBanner, stepDone } from "../src/cli/checklist.js";

async function readRunLog(root: string): Promise<string> {
  const day = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  const dayDir = path.join(root, "preferences", "tester", "state", "logs", `${day.getFullYear()}-${p(day.getMonth() + 1)}-${p(day.getDate())}`);
  for (let i = 0; i < 60; i++) {
    const runDir = fs.existsSync(dayDir) ? path.join(dayDir, fs.readdirSync(dayDir)[0] ?? "") : "";
    const f = runDir && fs.existsSync(runDir) ? fs.readdirSync(runDir).find((n) => n.endsWith(".log")) : undefined;
    const text = f ? fs.readFileSync(path.join(runDir, f), "utf8") : "";
    if (text.includes("run finished")) return text;
    await new Promise((r) => setTimeout(r, 50));
  }
  return "";
}

const count = (text: string, msg: string): number =>
  text.split("\n").filter((l) => new RegExp(`\\s${msg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( meta=|$)`).test(l)).length;

describe("phase markers: each first-run step banner writes one marker to the run log", function () {
  this.timeout(20000);
  let root = "", logText = "";
  const items = checklist({
    gitPresent: false, ghPresent: false, ghAuthenticated: false, ghScopesOk: false, gitIdentityOk: false,
    workspaceResolves: false, orgActive: null, workspacePath: null, orgSlug: "acme", role: "adopter",
    installCmd: { git: "apt-get install -y git", ghRepo: "add gh repo", gh: "apt-get install -y gh" },
  });

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "gov-phase-"));
    startRun({ argv: ["doctor", "--fix"], command: "doctor", workRoot: root, login: "tester", version: "9.9.9" });
    for (const it of items) { stepBanner(it); stepDone(it, true); }
    phase("adopt-done", "gov-work:test", { org: "acme" });
    endRun(0);
    logText = await readRunLog(root);
  });

  after(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* gone */ } });

  it("the run log was written", () => {
    expect(logText).to.contain("run started").and.contain("run finished");
  });

  it("every step banner writes exactly one `phase step-<n>` marker", () => {
    expect(items.length).to.be.greaterThan(8);
    for (const it of items) expect(count(logText, `phase step-${it.n}`), `banner ${it.n}`).to.equal(1);
  });

  it("every ticked step writes exactly one `phase step-<n>-done` marker", () => {
    for (const it of items) expect(count(logText, `phase step-${it.n}-done`), `done ${it.n}`).to.equal(1);
  });

  it("a named walk phase writes one marker, with its facts", () => {
    expect(count(logText, "phase adopt-done")).to.equal(1);
    expect(logText).to.match(/phase adopt-done meta=.*org: 'acme'/);
  });

  it("the banner's text is unchanged — a marker is a log line, never a screen line", () => {
    const lines = stepBanner(items[0]!);
    expect(lines.join("\n")).to.not.contain("phase");
  });
});
