// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * PRJ-121 F160: `gov setup` shows gh's reason when the clone of the new governance repo fails, retries once, and
 * clears the partial directory before the retry.
 */
import { expect } from "chai";
import { cloneGovRepo, cloneFailureReason, cloneFailedLines, type RunClone } from "../../src/setup/clone-gov-repo.js";

const DROP = "Cloning into '/home/u/.gov/acme/gov_repo'...\nerror: RPC failed; curl 92 HTTP/2 stream 5 was not closed cleanly\n" +
  "fetch-pack: unexpected disconnect while reading sideband packet\nfatal: early EOF\nfatal: fetch-pack: invalid index-pack output\n";

function script(...results: Array<{ status: number; stderr?: string }>) {
  const calls: string[] = [];
  const removed: string[] = [];
  const notes: string[] = [];
  const runClone: RunClone = (repo, dest) => {
    calls.push(`${repo} -> ${dest}`);
    const r = results.shift() ?? { status: 1, stderr: "unexpected extra call" };
    return { status: r.status, stderr: r.stderr ?? "" };
  };
  return { calls, removed, notes, deps: { runClone, rmDir: (d: string) => { removed.push(d); }, note: (l: string) => { notes.push(l); } } };
}

describe("cloneGovRepo (F160)", () => {
  it("clones on the first try and touches nothing else", () => {
    const s = script({ status: 0 });
    expect(cloneGovRepo(s.deps, "acme/acme-gov", "/d")).to.deep.equal({ kind: "cloned", attempts: 1 });
    expect(s.calls).to.have.length(1);
    expect(s.removed).to.deep.equal([]);
    expect(s.notes).to.deep.equal([]);
  });

  it("retries once after a dropped connection, clearing the partial clone first", () => {
    const s = script({ status: 128, stderr: DROP }, { status: 0 });
    expect(cloneGovRepo(s.deps, "acme/acme-gov", "/d")).to.deep.equal({ kind: "cloned", attempts: 2 });
    expect(s.calls).to.have.length(2);
    expect(s.removed).to.deep.equal(["/d"]);
    expect(s.notes).to.have.length(1);
    expect(s.notes[0]).to.contain("trying once more").and.to.contain("invalid index-pack output");
  });

  it("gives up after two failures with gh's last lines as the reason", () => {
    const s = script({ status: 128, stderr: DROP }, { status: 128, stderr: DROP });
    const r = cloneGovRepo(s.deps, "acme/acme-gov", "/d");
    expect(r.kind).to.equal("failed");
    if (r.kind !== "failed") return;
    expect(r.attempts).to.equal(2);
    expect(r.reason.split("\n")).to.deep.equal([
      "fetch-pack: unexpected disconnect while reading sideband packet",
      "fatal: early EOF",
      "fatal: fetch-pack: invalid index-pack output",
    ]);
    expect(s.removed).to.deep.equal(["/d", "/d"]);   // no half-clone left behind for the resume
    expect(s.notes).to.have.length(1);               // told before the retry, not after the last failure
  });

  it("says so when gh printed nothing", () => {
    expect(cloneFailureReason("\n  \n")).to.equal("gh gave no reason");
  });

  it("prints the cause before the resume path", () => {
    const lines = cloneFailedLines("acme/acme-gov", "fatal: early EOF");
    expect(lines[0]).to.contain("could not be cloned. gh said:");
    expect(lines[1]).to.equal("    fatal: early EOF");
    expect(lines[2]).to.contain("re-run 'gov setup acme/acme-gov' to resume");
  });
});
