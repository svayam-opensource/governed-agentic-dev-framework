// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE ONE DOOR FOR EXTERNAL PROCESSES (PRJ-121, 2026-09-23).
 *
 * gov's work is mostly `git`, `gh`, `npm` and an agent; until this module, none of those calls were recorded,
 * and the walks of 2026-09-22 were diagnosed from pasted terminals. These run REAL processes — the behaviour
 * under test is a process's behaviour (exit codes, stderr, a command that does not exist) — but they are the
 * cheapest ones a machine has.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ok, run, runResult, tryRun } from "../src/run-process.js";

describe("run-process — the one door every external process goes through", () => {
  it("run: returns stdout", () => {
    expect(run("echo", ["hello"]).trim()).to.equal("hello");
  });

  it("run: throws what execFileSync throws, so callers keep their own handling", () => {
    expect(() => run("false", [])).to.throw();
  });

  it("tryRun: undefined instead of a throw — the commonest shape in gov", () => {
    expect(tryRun("echo", [" x "])).to.equal("x");
    expect(tryRun("false", [])).to.equal(undefined);
    expect(tryRun("this-command-does-not-exist-gov", [])).to.equal(undefined);
  });

  it("ok: just the exit code, for the many checks that want only that", () => {
    expect(ok("true", [])).to.equal(true);
    expect(ok("false", [])).to.equal(false);
  });

  it("runResult: status, stdout and stderr, never a throw — the Vcs port's shape", () => {
    const good = runResult("echo", ["fine"]);
    expect(good.status).to.equal(0);
    expect(good.stdout.trim()).to.equal("fine");

    const bad = runResult("sh", ["-c", "echo boom >&2; exit 3"]);
    expect(bad.status).to.equal(3);
    expect(bad.stderr).to.contain("boom");
  });

  it("runs in the cwd it is given", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gov-run-"));
    try {
      expect(run("pwd", [], { cwd: dir }).trim()).to.contain(path.basename(dir));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // POL-427 — a token on a command line is still a secret. The redaction itself is tested in log.test.ts;
  // this is the guard that the runner asks for it at all.
  it("the log line redacts secret flag values (POL-427)", async () => {
    const { redactArgv } = await import("../src/state-paths.js");
    expect(redactArgv(["auth", "--token", "sk-live"])).to.deep.equal(["auth", "--token", "***"]);
  });
});
