// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Where a RUN's log goes, and what a run is called.
 *
 * Only the pure half is here: whether winston writes a file is winston's business, and `svm-util-log`'s own
 * tests prove the published artifact loads. What is gov's is the DECISION — which folder, given an org that may
 * not exist yet and a login that may not be known; what a run folder is named; what is kept; and what must
 * never be written down.
 */
import { expect } from "chai";
import * as path from "node:path";
import { APP_ID, runDirFor, KEEP_DAYS } from "../src/log.js";
import { commandOf, dayFolder, expiredDayFolders, newRunId, redactArgv, runFolder, stateDir, ackDir, cacheDir, logsRoot } from "../src/state-paths.js";

const NOW = new Date(2026, 8, 23, 18, 41, 7);   // 2026-09-23 18:41:07 local

describe("a run's log folder", () => {
  it("lives in the person's state folder, under the day and the run", () => {
    const d = runDirFor(NOW, "7f3a", "PRJ-121-doc", "work", "/w", "svayam-rkant", "/home/rk");
    expect(d).to.equal(path.join("/w/preferences/svayam-rkant/state/logs", "2026-09-23", "184107-7f3a-PRJ-121-doc-work"));
  });

  it("falls back to ~/.gov/logs before an org or a login is known — the same shape, somewhere that exists", () => {
    expect(runDirFor(NOW, "7f3a", null, "doctor", null, null, "/home/rk"))
      .to.equal(path.join("/home/rk/.gov/logs", "2026-09-23", "184107-7f3a-none-doctor"));
  });

  it("names the application the way the code path convention expects", () => {
    expect(APP_ID).to.equal("gov-work");
  });

  it("keeps a fortnight by default", () => {
    expect(KEEP_DAYS).to.equal(14);
  });
});

describe("state paths — one purpose per folder", () => {
  it("ack, cache and logs sit beside each other under state/", () => {
    expect(stateDir("/w/", "rk")).to.equal("/w/preferences/rk/state");
    expect(ackDir("/w", "rk")).to.equal("/w/preferences/rk/state/ack");
    expect(cacheDir("/w", "rk")).to.equal("/w/preferences/rk/state/cache");
    expect(logsRoot("/w", "rk")).to.equal("/w/preferences/rk/state/logs");
  });
});

describe("naming a run", () => {
  it("is sortable by time, and says which project and command it was", () => {
    expect(runFolder(NOW, "c19e", "PRJ-119-gov-iam", "merge")).to.equal("184107-c19e-PRJ-119-gov-iam-merge");
  });

  it("says `none` for a run outside any project", () => {
    expect(runFolder(NOW, "a02b", null, "doctor")).to.equal("184107-a02b-none-doctor");
  });

  it("is a safe directory name on every platform", () => {
    const f = runFolder(NOW, "a02b", "weird/../name with spaces", "org use");
    expect(f).to.not.match(/[^A-Za-z0-9._-]/);
    expect(f).to.contain("184107-a02b-");
  });

  it("a run id is four hex characters — short enough to quote in a failure message", () => {
    expect(newRunId(() => 0.999)).to.equal("ffff");
    expect(newRunId()).to.match(/^[0-9a-f]{4}$/);
  });

  it("the day folder is LOCAL time: 'today's runs' means the person's today", () => {
    expect(dayFolder(new Date(2026, 0, 5, 23, 59))).to.equal("2026-01-05");
  });

  it("names the command a run is about", () => {
    expect(commandOf(["work", "--project=x"])).to.equal("work");
    expect(commandOf([])).to.equal("menu");
    expect(commandOf(["--help"])).to.equal("help");
    expect(commandOf(["-v"])).to.equal("version");
    expect(commandOf(["--gov-home", "/x", "doctor"]), "a flag's VALUE is not the command").to.equal("/x");
  });
});

describe("retention — whole day folders, and only ones gov named", () => {
  const today = new Date(2026, 8, 23);
  it("deletes what is older than the window, keeps the edge", () => {
    expect(expiredDayFolders(["2026-09-08", "2026-09-09", "2026-09-23"], today, 14)).to.deep.equal(["2026-09-08"]);
  });
  it("leaves alone anything that is not a day", () => {
    expect(expiredDayFolders(["notes", "2020-01-01.bak", "ack"], today, 14)).to.deep.equal([]);
  });
});

// No secret in a log — a token typed on the command line is still a secret.
describe("redactArgv — the flag stays, the value goes", () => {
  it("redacts --token=x and --token x, in either spelling", () => {
    expect(redactArgv(["auth", "--token=sk-live-123"])).to.deep.equal(["auth", "--token=***"]);
    expect(redactArgv(["auth", "--token", "sk-live-123"])).to.deep.equal(["auth", "--token", "***"]);
    expect(redactArgv(["x", "--api-key", "abc", "--password=p"])).to.deep.equal(["x", "--api-key", "***", "--password=***"]);
  });
  it("leaves ordinary arguments, which are what a diagnosis needs", () => {
    expect(redactArgv(["work", "--project=PRJ-121", "--agent=ibm-bob"])).to.deep.equal(["work", "--project=PRJ-121", "--agent=ibm-bob"]);
  });
  it("does not eat the next FLAG when a secret flag has no value", () => {
    expect(redactArgv(["--token", "--verbose"])).to.deep.equal(["--token", "--verbose"]);
  });
});

/**
 * F25 (PRJ-121, 2026-10-08). A run ended with, on the person's screen:
 *
 *     [winston] Attempt to write logs with no transports, which can increase memory usage: {...}
 *
 * The launch closes the log before handing over the terminal (an agent can run for hours, and the lines before it
 * must be on disk). Closing a winston logger removes its transports — and the logger was kept, so the very next line,
 * "run finished", went to a logger with none, and winston complained on stderr. Rule 1 of log.ts: nothing here ever
 * writes to the screen. This holds whatever winston does: gov does not log through a closed logger.
 */
describe("ending a run (F25)", () => {
  it("close, then endRun, writes nothing to stderr — and the lines after the close still reach the file", async () => {
    const os = await import("node:os");
    const fs = await import("node:fs");
    const { startRun, endRun, closeLog, log, runDir } = await import("../src/log.js");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gov-f25-"));
    const written: string[] = [];
    const real = process.stderr.write.bind(process.stderr);
    (process.stderr as { write: unknown }).write = (chunk: unknown): boolean => { written.push(String(chunk)); return true; };
    try {
      startRun({ argv: ["work"], command: "work", workRoot: root, login: "tester" });
      log("info", "launching the agent", "gov-work:test", "f25");
      closeLog();                                   // what the launch does before handing over the terminal
      log("info", "the agent exited", "gov-work:test", "f25");
      endRun(0);                                    // "run finished", then close
      log("info", "a straggler after the end", "gov-work:test", "f25");
      await new Promise((r) => setTimeout(r, 300));
    } finally {
      (process.stderr as { write: unknown }).write = real;
    }
    expect(written.join(""), "nothing on the person's screen").to.equal("");
    const dir = runDir();
    const files = dir ? fs.readdirSync(dir).filter((f) => f.endsWith(".log")) : [];
    const text = files.map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("");
    expect(text, "the record after the close was kept, not dropped").to.contain("run finished");
  });
});
