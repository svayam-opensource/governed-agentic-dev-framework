// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * PRJ-121 Item 6 (ruling Q7): merge, sync and cleanup refuse only for changes a person or agent made.
 *
 * gov writes its own harness files (ROOT_HARNESS_FILES) into every code clone, untracked, and rewrites them whenever
 * the rendered text changes. They are regenerable gov output, so they never block. Against a REAL git repository,
 * because the defect that let a nested file slip past the discount lived in the `git status` call itself: without
 * `-uall` an untracked `.cursor/` is reported as the directory, which matches no harness file by name.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { createGitVcs } from "../../src/lifecycle/vcs.js";
import { userDirtyPaths, dirtyRefusal } from "../../src/lifecycle/root-protocol.js";
import { seedPathsFor } from "../../src/lifecycle/leftover.js";
import { classify, type CleanupConfig } from "../../src/lifecycle/cleanup.js";

function git(dir: string, ...args: string[]): void {
  execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
}
function write(dir: string, rel: string, text = "x\n"): void {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
}
/** A repo with one commit that TRACKS CLAUDE.md (the gov repo commits its harness; a code repo may too). */
function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gov-dirty-"));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  write(dir, "CLAUDE.md", "old\n");
  write(dir, "README.md");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}
/** Every harness file gov places, untracked except CLAUDE.md, which is modified. */
function placeHarness(dir: string): void {
  write(dir, "CLAUDE.md", "new\n");
  for (const f of ["AGENTS.md", "CONVENTIONS.md", ".clinerules/agent.md", ".cursor/rules/agent.mdc", "GEMINI.md",
    ".github/copilot-instructions.md", ".continue/rules/agent.md", ".windsurf/rules/agent.md"]) write(dir, f);
}

describe("PRJ-121 Item 6 — gov's own harness files are not uncommitted work", function () {
  this.timeout(15_000); // real git repositories; slow on a loaded machine
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
  const fresh = (): string => { const d = repo(); made.push(d); return d; };

  it("dirtyPaths lists a nested untracked file by its own path, not its directory (-uall)", () => {
    const dir = fresh();
    write(dir, ".cursor/rules/agent.mdc");
    expect(createGitVcs().dirtyPaths(dir)).to.deep.equal([".cursor/rules/agent.mdc"]);
  });

  it("a clone holding only gov's harness (untracked + modified, incl. .cursor/rules/agent.mdc) has no user changes", () => {
    const dir = fresh();
    placeHarness(dir);
    const vcs = createGitVcs();
    expect(vcs.isClean(dir), "git itself calls it dirty").to.equal(false);
    expect(userDirtyPaths(vcs, dir)).to.deep.equal([]);
  });

  it("gov's generated skills (and an old .cursor/skills copy, D14) are not user changes; a person's own skill is (L14)", () => {
    const dir = fresh();
    placeHarness(dir);
    write(dir, ".claude/skills/gov-framework-specification-8-3-write-it-down/SKILL.md");
    write(dir, ".cursor/skills/gov-framework-specification-8-3-write-it-down/SKILL.md");
    write(dir, ".claude/skills/my-skill/SKILL.md");
    expect(userDirtyPaths(createGitVcs(), dir)).to.deep.equal([".claude/skills/my-skill/SKILL.md"]);
  });

  it("a developer's file beside the harness is reported, alone", () => {
    const dir = fresh();
    placeHarness(dir);
    write(dir, "src/main.ts");
    write(dir, "README.md", "edited\n");
    expect([...userDirtyPaths(createGitVcs(), dir)].sort()).to.deep.equal(["README.md", "src/main.ts"]);
  });

  it("cleanup: a work root whose clone holds a nested untracked .cursor/ harness file is not refused", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gov-awr-"));
    made.push(root);
    const app = path.join(root, "app");
    fs.renameSync(fresh(), app);
    write(app, ".cursor/rules/agent.mdc");
    const cfg: CleanupConfig = { defaultBranch: "main", remote: "origin", workspaceRepo: "svm-prj-work" };
    const paths = seedPathsFor({ govHome: "/gov", agentWorkRoot: "/awr", projectId: "PRJ-9-x", branch: "BRNCH-9-x" });
    const e = { vcs: createGitVcs(), fs: { pathExists: (p: string) => fs.existsSync(p) }, readdir: (d: string) => fs.readdirSync(d), rm: () => {} };
    const step = classify(e, cfg, { kind: "workspace-dir", detail: "d", path: root }, paths);
    expect(step.verdict.kind).to.not.equal("refused");
  });

  it("the refusal names up to five files, then '+N more'", () => {
    expect(dirtyRefusal("/w/app", ["a"])).to.equal("Uncommitted changes in /w/app: a — commit or stash first.");
    expect(dirtyRefusal("/w/app", ["a", "b", "c", "d", "e"])).to.equal("Uncommitted changes in /w/app: a, b, c, d, e — commit or stash first.");
    expect(dirtyRefusal("/w/app", ["a", "b", "c", "d", "e", "f", "g"]))
      .to.equal("Uncommitted changes in /w/app: a, b, c, d, e, +2 more — commit or stash first.");
  });
});
