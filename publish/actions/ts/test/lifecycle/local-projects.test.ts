// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE LIST THAT COSTS NOTHING — projects already on this machine, read from the disk alone.
 *
 * The design's §5 accounting turns on this: opening a project that is already cloned must cost ZERO GitHub
 * calls, down from two plus up to one write-access check per board in the org. So the scan is asserted here to
 * be a directory listing, a HEAD read and an mtime — and nothing else.
 */
import { expect } from "chai";
import { branchFromHead, isProjectDirName, lastUsedLabel, orderLocal, scanLocalProjects, type LocalProject } from "../../src/lifecycle/local-projects.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import { px } from "../helpers/paths.js";

/** A fake disk: which paths exist, what the text files say, and when each path was touched. */
function fakeFs(over: { paths?: string[]; files?: Record<string, string>; mtimes?: Record<string, number>; entries?: Record<string, string[]> } = {}): Fs {
  const paths = (over.paths ?? []).map(px);
  const files = Object.fromEntries(Object.entries(over.files ?? {}).map(([k, v]) => [px(k), v]));
  const mtimes = Object.fromEntries(Object.entries(over.mtimes ?? {}).map(([k, v]) => [px(k), v]));
  const entries = Object.fromEntries(Object.entries(over.entries ?? {}).map(([k, v]) => [px(k), v]));
  return {
    pathExists: (p) => paths.includes(px(p)) || Object.keys(files).includes(px(p)),
    readFile: (f) => files[px(f)] ?? null,
    writeFile() {}, mkdirp() {}, rm() {},
    readdir: (d) => entries[px(d)] ?? [],
    mtimeMs: (p) => mtimes[px(p)] ?? null,
  };
}

describe("on this machine — what the disk knows", () => {
  it("a project folder is `PRJ-<board>-<slug>`; preferences, state and dotfiles are not projects", () => {
    expect(isProjectDirName("PRJ-121-doc-update")).to.equal(true);
    expect(isProjectDirName("PRJ-7")).to.equal(true);
    expect(isProjectDirName("preferences")).to.equal(false);
    expect(isProjectDirName("state")).to.equal(false);
    expect(isProjectDirName(".DS_Store")).to.equal(false);
    expect(isProjectDirName("prj-121-legacy"), "the lower-case spelling still counts").to.equal(true);
    expect(isProjectDirName("PRJ-nope"), "and a board number is required — that is what makes it a project").to.equal(false);
  });

  it("reads the branch, the mtime and whether the workspace is actually cloned", () => {
    const fs = fakeFs({
      entries: { "/work": ["PRJ-9-infra", "PRJ-7-alpha", "preferences", ".DS_Store"] },
      paths: ["/work/PRJ-7-alpha/acme-gov/.git"],
      files: { "/work/PRJ-7-alpha/acme-gov/.git/HEAD": "ref: refs/heads/BRNCH-7-alpha\n" },
      mtimes: { "/work/PRJ-7-alpha": 5_000, "/work/PRJ-9-infra": 9_000 },
    });
    const got = scanLocalProjects(fs, "/work", "acme-gov");
    expect(got.map((l) => l.projectId)).to.deep.equal(["PRJ-9-infra", "PRJ-7-alpha"]);
    expect(got.map((l) => l.boardNumber)).to.deep.equal([9, 7]);
    const alpha = got.find((l) => l.projectId === "PRJ-7-alpha")!;
    expect(alpha.branch).to.equal("BRNCH-7-alpha");
    expect(alpha.lastUsedMs).to.equal(5_000);
    expect(alpha.cloned, "it has a workspace clone → launchable as it stands").to.equal(true);
    const infra = got.find((l) => l.projectId === "PRJ-9-infra")!;
    expect(infra.cloned, "a folder with no workspace clone still needs `join`").to.equal(false);
    expect(infra.branch, "and gov does not claim a branch it could not read").to.equal(null);
  });

  it("an mtime the port cannot supply is null, never a made-up timestamp", () => {
    const fs = fakeFs({ entries: { "/work": ["PRJ-7-alpha"] } });
    expect(scanLocalProjects(fs, "/work", "acme-gov")[0]!.lastUsedMs).to.equal(null);
  });

  it("a branch comes from HEAD's ref line, and nowhere else", () => {
    expect(branchFromHead("ref: refs/heads/BRNCH-121-x\n")).to.equal("BRNCH-121-x");
    expect(branchFromHead("ref: refs/heads/feature/with/slashes")).to.equal("feature/with/slashes");
    expect(branchFromHead("7f3c9e1a2b3c4d5e6f\n"), "a detached HEAD is a sha, not a branch").to.equal(null);
    expect(branchFromHead("gitdir: /elsewhere/.git/worktrees/x"), "a linked worktree keeps HEAD elsewhere").to.equal(null);
    expect(branchFromHead(null)).to.equal(null);
  });

  it("`last-used` is newest first; a folder with no mtime sorts after the ones that have one", () => {
    const l = (projectId: string, boardNumber: number, lastUsedMs: number | null): LocalProject =>
      ({ projectId, dir: `/work/${projectId}`, boardNumber, branch: null, lastUsedMs, cloned: true });
    const items = [l("PRJ-7-a", 7, 100), l("PRJ-9-b", 9, null), l("PRJ-8-c", 8, 900)];
    expect(orderLocal(items, "last-used").map((x) => x.projectId)).to.deep.equal(["PRJ-8-c", "PRJ-7-a", "PRJ-9-b"]);
    // The other answer to the design's decision 2: board order, the same as the two GitHub lists use.
    expect(orderLocal(items, "number").map((x) => x.projectId)).to.deep.equal(["PRJ-9-b", "PRJ-8-c", "PRJ-7-a"]);
  });

  it("the age reads as a person would say it", () => {
    const now = Date.UTC(2026, 8, 28);
    expect(lastUsedLabel(now - 1_000, now)).to.equal("today");
    expect(lastUsedLabel(now - 86_400_000, now)).to.equal("yesterday");
    expect(lastUsedLabel(now - 3 * 86_400_000, now)).to.equal("3 days ago");
    expect(lastUsedLabel(now - 60 * 86_400_000, now)).to.equal("2 months ago");
    expect(lastUsedLabel(null, now), "unknown says nothing at all").to.equal("");
  });
});
