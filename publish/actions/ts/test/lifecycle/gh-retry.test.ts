// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** ONE RETRY FOR A DROPPED CONNECTION (PRJ-121, 2026-09-22) — gh's bare `EOF` on a 10-second query. */
import { expect } from "chai";
import { retryTransient, isTransientGhError } from "../../src/lifecycle/gh-board.js";

const fail = (message: string, stderr = ""): Error => Object.assign(new Error(message), { stderr });

describe("retryTransient — a transient gh failure is retried once; anything else is not", () => {
  it("EOF, 502/503/504, timeouts and resets are transient", () => {
    for (const m of ["Command failed: gh project list\nEOF", "HTTP 502: Bad Gateway", "HTTP 504", "i/o timeout", "read: connection reset by peer"]) {
      expect(isTransientGhError(fail(m)), m).to.equal(true);
    }
  });
  it("auth, not-found and bad arguments are not", () => {
    for (const m of ["HTTP 401: Bad credentials", "HTTP 404: Not Found", "unknown flag: --nope"]) {
      expect(isTransientGhError(fail(m)), m).to.equal(false);
    }
  });
  it("retries a transient failure ONCE and returns the second answer", () => {
    let n = 0;
    const run = retryTransient(() => { if (++n === 1) throw fail("x", "EOF"); return "ok"; }, 0);
    expect(run([])).to.equal("ok");
    expect(n).to.equal(2);
  });
  it("does not retry a real error — it fails at once", () => {
    let n = 0;
    const run = retryTransient(() => { n++; throw fail("HTTP 401: Bad credentials"); }, 0);
    expect(() => run([])).to.throw(/401/);
    expect(n).to.equal(1);
  });
  it("a second transient failure is reported, not retried forever", () => {
    let n = 0;
    const run = retryTransient(() => { n++; throw fail("EOF"); }, 0);
    expect(() => run([])).to.throw(/EOF/);
    expect(n).to.equal(2);
  });
});
