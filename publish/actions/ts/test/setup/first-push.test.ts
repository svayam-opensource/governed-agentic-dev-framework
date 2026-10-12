// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov setup`'s first push of the default branch (gadf#180, PRJ-121 intent 05 Item 2).
 *
 * It was `git push -u origin HEAD`, with no fetch. When the remote moved while setup ran (another admin, a
 * template copy still landing), the push failed or — worse, on a non-fast-forward-tolerant remote — the adopter
 * was told "push failed, run: git push" with no word about why. Now: fetch, and if the remote's default branch
 * is not an ancestor of HEAD, stop with the pull hint. NEVER force.
 *
 * Real git, in temp dirs: whether a push is a fast-forward is git's question, and a fake that answers it is a
 * claim about git rather than a test of gov.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { firstPush, REMOTE_MOVED_HINT } from "../../src/setup/first-push.js";
import type { RunGit } from "../../src/lifecycle/vcs.js";

const g = (cwd: string, ...a: string[]): string =>
  execFileSync("git", ["-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { stdio: "pipe" }).toString().trim();

const realGit: RunGit = (args) => {
  try { return { status: 0, stdout: execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { const x = e as { status?: number; stdout?: string; stderr?: string }; return { status: x.status ?? 1, stdout: x.stdout ?? "", stderr: x.stderr ?? "" }; }
};

/** A bare remote with one commit on main, and a clone of it — the shape `gov setup` leaves before its commit. */
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "first-push-"));
  const remote = path.join(root, "remote.git");
  const seedDir = path.join(root, "seed");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  execFileSync("git", ["init", "-q", "-b", "main", seedDir]);
  fs.writeFileSync(path.join(seedDir, "README.md"), "template\n");
  g(seedDir, "add", "-A"); g(seedDir, "commit", "-qm", "template import");
  g(seedDir, "remote", "add", "origin", remote); g(seedDir, "push", "-q", "origin", "main");
  const home = path.join(root, "home");
  execFileSync("git", ["clone", "-q", remote, home]);
  // setup's own commit
  fs.writeFileSync(path.join(home, "org-config.yaml"), "org_name: acme\n");
  g(home, "add", "-A"); g(home, "commit", "-qm", "configure the framework for this org");
  return { root, remote, seedDir, home };
}

/** Somebody else pushes to the remote's main while setup was running. */
function remoteMoves(f: ReturnType<typeof fixture>) {
  fs.writeFileSync(path.join(f.seedDir, "other.md"), "someone else\n");
  g(f.seedDir, "add", "-A"); g(f.seedDir, "commit", "-qm", "someone else's change");
  g(f.seedDir, "push", "-q", "origin", "main");
  return g(f.seedDir, "rev-parse", "HEAD");
}

describe("gov setup — first push of the default branch (gadf#180)", () => {
  it("pushes when the remote has not moved", () => {
    const f = fixture();
    const r = firstPush(realGit, f.home);
    expect(r.kind).to.equal("pushed");
    expect(g(f.remote, "rev-parse", "main")).to.equal(g(f.home, "rev-parse", "HEAD"));
  });

  it("pushes to an empty remote (no default branch there yet)", () => {
    const f = fixture();
    const empty = path.join(f.root, "empty.git");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", empty]);
    g(f.home, "remote", "set-url", "origin", empty);
    const r = firstPush(realGit, f.home);
    expect(r.kind).to.equal("pushed");
    expect(g(empty, "rev-parse", "main")).to.equal(g(f.home, "rev-parse", "HEAD"));
  });

  it("when the remote moved: stops with the pull hint, and the remote keeps the other person's commit", () => {
    const f = fixture();
    const theirs = remoteMoves(f);
    const r = firstPush(realGit, f.home);
    expect(r.kind).to.equal("remote-moved");
    if (r.kind !== "remote-moved") return;
    expect(r.message).to.include("the remote moved");
    expect(r.message).to.include("git pull --rebase");
    expect(r.message).to.include("gov setup");
    expect(REMOTE_MOVED_HINT).to.include("git pull --rebase");
    expect(g(f.remote, "rev-parse", "main"), "nothing overwritten").to.equal(theirs);
  });

  it("never forces: no push argument it sends carries --force or a + refspec", () => {
    const f = fixture();
    remoteMoves(f);
    const seen: string[][] = [];
    const spy: RunGit = (args) => { seen.push(args); return realGit(args); };
    firstPush(spy, f.home);
    const pushes = seen.filter((a) => a.includes("push"));
    expect(pushes, "no push at all once the remote moved").to.deep.equal([]);
    // and the happy path's push is plain
    const f2 = fixture();
    const seen2: string[][] = [];
    firstPush((args) => { seen2.push(args); return realGit(args); }, f2.home);
    for (const a of seen2.filter((x) => x.includes("push"))) {
      expect(a.some((x) => /^--force|^-f$|^\+/.test(x)), a.join(" ")).to.equal(false);
    }
  });

  it("an unreachable remote is a push failure, not a silent success", () => {
    const f = fixture();
    g(f.home, "remote", "set-url", "origin", path.join(f.root, "nowhere.git"));
    const r = firstPush(realGit, f.home);
    expect(r.kind).to.equal("push-failed");
  });
});
