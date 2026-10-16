// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** Spec 03 §3.4 — one autorun per project; a stale lock is REPORTED, never silently broken. */
import { expect } from "chai";
import { acquireLock, releaseLock, lockPath, type LockFs } from "../../src/autorun/lock.js";

function memFs(): LockFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    createExclusive(p, text) { if (files.has(p)) return false; files.set(p, text); return true; },
    read(p) { return files.get(p) ?? null; },
    remove(p) { files.delete(p); },
  };
}
const DIR = "/state";
const t0 = new Date("2026-10-12T22:00:00Z");

describe("autorun — lock", () => {
  it("the first run takes the lock; the path is per project in gov's state dir", () => {
    const fs = memFs();
    const r = acquireLock(fs, DIR, "PRJ-1", "run-a", t0, 60 * 60_000);
    expect(r).to.deep.equal({ ok: true, path: lockPath(DIR, "PRJ-1") });
    expect(lockPath(DIR, "PRJ-1")).to.equal("/state/autorun/PRJ-1.lock");
  });

  it("a second run is refused, naming the holder and when it started", () => {
    const fs = memFs();
    acquireLock(fs, DIR, "PRJ-1", "run-a", t0, 60 * 60_000);
    const r = acquireLock(fs, DIR, "PRJ-1", "run-b", new Date(t0.getTime() + 60_000), 60 * 60_000);
    expect(r.ok).to.equal(false);
    if (!r.ok) { expect(r.stale).to.equal(false); expect(r.message).to.match(/run-a/).and.match(/2026-10-12T22:00:00/); }
  });

  it("a lock older than the run budget is reported STALE — and still not broken", () => {
    const fs = memFs();
    acquireLock(fs, DIR, "PRJ-1", "run-a", t0, 60 * 60_000);
    const r = acquireLock(fs, DIR, "PRJ-1", "run-b", new Date(t0.getTime() + 2 * 60 * 60_000), 60 * 60_000);
    expect(r.ok).to.equal(false);
    if (!r.ok) { expect(r.stale).to.equal(true); expect(r.message).to.match(/stale/i).and.match(/remove/); }
    expect(fs.read(lockPath(DIR, "PRJ-1"))).to.match(/run-a/);
  });

  it("another project is not blocked; release frees only our own lock", () => {
    const fs = memFs();
    acquireLock(fs, DIR, "PRJ-1", "run-a", t0, 1000);
    expect(acquireLock(fs, DIR, "PRJ-2", "run-b", t0, 1000).ok).to.equal(true);
    releaseLock(fs, DIR, "PRJ-1", "run-x");
    expect(fs.read(lockPath(DIR, "PRJ-1"))).to.match(/run-a/);
    releaseLock(fs, DIR, "PRJ-1", "run-a");
    expect(fs.read(lockPath(DIR, "PRJ-1"))).to.equal(null);
  });
});
