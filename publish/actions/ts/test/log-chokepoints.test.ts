// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WHAT A RUN ACTUALLY RECORDS (PRJ-121, 2026-09-23).
 *
 * The design's claim is that coverage comes from CHOKEPOINTS rather than sprinkled calls, so the test reads a
 * real run's log file back: start a run into a temp folder, do the things gov does — write a file, run a
 * transaction, make a decision, run a process — and assert the lines are there, with no secret among them.
 *
 * It needs svm-util-log ≥ 1.1.0 (`gate: "level"`): before that, `info` was dropped unless NODE_DEBUG named the
 * module, which is the defect this whole slice began with.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { decide, endRun, log, startRun } from "../src/log.js";
import { createNodeFs } from "../src/lifecycle/fs-io.js";
import { Transaction } from "../src/lifecycle/transaction.js";
import { run } from "../src/run-process.js";

/** The run's log file, once the transport has flushed it. */
async function readRunLog(dir: string): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const f = fs.existsSync(dir) ? fs.readdirSync(dir).find((n) => n.endsWith(".log")) : undefined;
    const text = f ? fs.readFileSync(path.join(dir, f), "utf8") : "";
    if (text.includes("run finished")) return text;
    await new Promise((r) => setTimeout(r, 50));
  }
  return "";
}

describe("a run's log — the chokepoints, read back from the file", function () {
  this.timeout(20000);
  let root = "", logText = "";

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "gov-logtest-"));
    startRun({ argv: ["work", "--token", "sk-live-secret"], command: "work", project: "PRJ-9-demo", workRoot: root, login: "tester", version: "9.9.9" });

    createNodeFs().writeFile(path.join(root, "made", "file.txt"), "some content nobody should see");
    createNodeFs().rm(path.join(root, "made", "file.txt"));

    const tx = new Transaction();
    tx.step("push the branch", () => "done", () => { /* undo */ });
    tx.rollback();

    decide("agent", "ibm-bob", "org default", "gov-work:test", "chokepoints");
    run("echo", ["hello"], { pgm: "gov-work:test" });
    log("info", "hidden answer received", "gov-work:cli:ask", "secret", { chars: 14 });

    endRun(0);
    const day = new Date();
    const p = (n: number): string => String(n).padStart(2, "0");
    const dayDir = path.join(root, "preferences", "tester", "state", "logs", `${day.getFullYear()}-${p(day.getMonth() + 1)}-${p(day.getDate())}`);
    const runDir = fs.existsSync(dayDir) ? path.join(dayDir, fs.readdirSync(dayDir)[0]!) : "";
    logText = runDir ? await readRunLog(runDir) : "";
  });

  after(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* gone */ } });

  it("writes into the person's state folder, under the day and the run", () => {
    expect(logText, "the run's file was written and flushed").to.not.equal("");
    expect(logText).to.contain("run started").and.contain("run finished");
  });

  it("records the file it wrote and the one it removed — the bytes, never the content", () => {
    expect(logText).to.contain("wrote a file").and.contain("file.txt");
    expect(logText, "the content is not gov's to write down").to.not.contain("nobody should see");
    expect(logText).to.contain("removed");
  });

  it("records a transaction's step and its undo", () => {
    expect(logText).to.contain("step done").and.contain("push the branch");
    expect(logText).to.contain("undone");
  });

  it("records a decision: what was chosen, and why", () => {
    expect(logText).to.contain("chose agent").and.contain("ibm-bob").and.contain("org default");
  });

  it("records the processes it ran, with timing and exit code", () => {
    expect(logText).to.contain("ran").and.contain("echo").and.contain("exitCode: 0");
  });

  // POL-427, C01 — the one rule that is not a preference.
  it("NEVER a secret: the token on the command line is redacted, the hidden answer is a count", () => {
    expect(logText, "the token typed in argv").to.not.contain("sk-live-secret");
    expect(logText).to.contain("'***'");
    expect(logText).to.contain("chars: 14");
  });
});
