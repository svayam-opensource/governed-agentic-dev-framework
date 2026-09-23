// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The governing files, copied from the DEFAULT branch into the project (PRJ-121, 2026-09-22).
 *
 * On a walk, IBM Bob's `read_file` on `~/.gov/<slug>/gov_repo/org-config.yaml` failed — outside the folder it
 * trusts — and it read the file with `cat` instead. The snapshot puts both files inside the project. The property
 * guarded hardest: an UNRATIFIED edit on the project branch must never be what the agent reads (POL-086a/b).
 */
import { expect } from "chai";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { snapshotGovernance, GOVERNING_FILES, type SnapshotPorts } from "../../src/lifecycle/governance-snapshot.js";
import { sessionStartPrompt } from "../../src/cli/work-flow.js";

const NOW = new Date("2026-09-22T10:14:00Z");

describe("governance snapshot — the rules, where the agent can read them", () => {
  const fake = (files: Record<string, string>, refs: string[] = ["main"]) => {
    const written: Record<string, { content: string; mode: number }> = {};
    const ports: SnapshotPorts = {
      git: (args) => {
        const verb = args[2];
        const last = args[args.length - 1]!;              // the ref (or ref:file) is always the final argument
        if (verb === "rev-parse") { const ref = last.replace("^{commit}", ""); return refs.includes(ref) ? "3f2a1c9\n" : null; }
        if (verb === "show") { const [ref, file] = last.split(":"); return refs.includes(ref!) && file! in files ? files[file!]! : null; }
        return null;
      },
      write: (p, content, mode) => { written[p] = { content, mode }; },
      now: () => NOW,
    };
    return { ports, written };
  };
  const both = { "org-config.yaml": "org: x\n", "framework/policies/framework-policy.md": "# policy\n" };

  it("copies both files into <project>/.gov/governance, read-only, stamped with where they came from", () => {
    const { ports, written } = fake(both);
    const snap = snapshotGovernance(ports, "/p/PRJ-28", "acme-gov", "main")!;
    expect(snap.dir).to.equal("/p/PRJ-28/.gov/governance");
    expect(snap.source).to.equal("main@3f2a1c9");
    expect(written["/p/PRJ-28/.gov/governance/org-config.yaml"]).to.deep.equal({ content: "org: x\n", mode: 0o444 });
    expect(written["/p/PRJ-28/.gov/governance/framework-policy.md"]!.mode).to.equal(0o444);
    expect(written["/p/PRJ-28/.gov/governance/SOURCE"]!.content).to.contain("main@3f2a1c9").and.to.contain("POL-086a");
  });

  it("is ALL OR NOTHING — a missing file writes nothing, rather than mixing two sources", () => {
    const { ports, written } = fake({ "org-config.yaml": "org: x\n" });
    expect(snapshotGovernance(ports, "/p", "acme-gov", "main")).to.equal(null);
    expect(Object.keys(written)).to.deep.equal([]);
  });

  it("falls back to origin/<default> for a checkout that has only the remote-tracking branch", () => {
    const { ports } = fake(both, ["origin/main"]);
    expect(snapshotGovernance(ports, "/p", "acme-gov", "main")!.source).to.equal("origin/main@3f2a1c9");
  });

  it("gives up — and the prompt keeps its old paths — when there is no default branch to read", () => {
    const { ports } = fake(both, []);
    expect(snapshotGovernance(ports, "/p", "acme-gov", "main")).to.equal(null);
  });
});

describe("the session-start prompt points at the snapshot when there is one", () => {
  const snap = { dir: "/p/PRJ-28/.gov/governance", files: ["org-config.yaml", "framework-policy.md"], source: "main@3f2a1c9" };
  it("sends the agent INSIDE the project, and names the commit it is reading", () => {
    const p = sessionStartPrompt("PRJ-28", "acme-gov", "/home/t/.gov/acme/gov_repo", snap);
    expect(p).to.contain("/p/PRJ-28/.gov/governance/org-config.yaml");
    expect(p).to.contain("/p/PRJ-28/.gov/governance/framework-policy.md");
    expect(p).to.contain("main@3f2a1c9").and.to.contain("POL-086a");
    expect(p, "not outside the project any more").to.not.contain("/home/t/.gov/acme/gov_repo/org-config.yaml");
  });
  it("without a snapshot, is exactly what it was", () => {
    expect(sessionStartPrompt("PRJ-28", "acme-gov", "/g", null)).to.equal(sessionStartPrompt("PRJ-28", "acme-gov", "/g"));
  });
});

// AGAINST REAL GIT, SET UP THE WAY gov SETS UP A PROJECT: gov_repo on main, and the project's worktree of it on the
// project branch — where the policy has been EDITED, as a proposal. The agent must read main's policy, not that.
describe("governance snapshot — a real worktree on a project branch with an unratified edit", function () {
  this.timeout(30000);
  const g = (cwd: string, ...a: string[]) => execFileSync("git", ["-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { stdio: "pipe" }).toString();
  let root = "", govRepo = "", project = "";
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "gov-snap-"));
    govRepo = path.join(root, "gov_repo");
    fs.mkdirSync(path.join(govRepo, path.dirname(GOVERNING_FILES[1])), { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main", govRepo]);
    fs.writeFileSync(path.join(govRepo, "org-config.yaml"), "org_name: RATIFIED\n");
    fs.writeFileSync(path.join(govRepo, GOVERNING_FILES[1]), "# RATIFIED policy\n");
    g(govRepo, "add", "-A"); g(govRepo, "commit", "-qm", "ratified");
    project = path.join(root, "projects", "PRJ-7-x");
    fs.mkdirSync(project, { recursive: true });
    g(govRepo, "worktree", "add", "-q", "-b", "BRNCH-7-x", path.join(project, "acme-gov"));
    fs.writeFileSync(path.join(project, "acme-gov", GOVERNING_FILES[1]), "# UNRATIFIED edit on the project branch\n");
    g(path.join(project, "acme-gov"), "commit", "-qam", "a proposal, with no governing force");
  });
  after(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* gone */ } });

  const realPorts = (): SnapshotPorts => ({
    git: (args) => { try { return execFileSync("git", [...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; } },
    write: (file, content, mode) => { fs.mkdirSync(path.dirname(file), { recursive: true }); try { fs.chmodSync(file, 0o644); } catch { /* new */ } fs.writeFileSync(file, content); fs.chmodSync(file, mode); },
    now: () => NOW,
  });

  it("copies MAIN's policy — never the project branch's unratified edit", () => {
    const snap = snapshotGovernance(realPorts(), project, "acme-gov", "main")!;
    expect(fs.readFileSync(path.join(snap.dir, "framework-policy.md"), "utf8")).to.equal("# RATIFIED policy\n");
    expect(fs.readFileSync(path.join(snap.dir, "org-config.yaml"), "utf8")).to.equal("org_name: RATIFIED\n");
  });

  it("switches no branch — the project's worktree stays on the project branch, its edit intact", () => {
    snapshotGovernance(realPorts(), project, "acme-gov", "main");
    expect(g(path.join(project, "acme-gov"), "branch", "--show-current").trim()).to.equal("BRNCH-7-x");
    expect(fs.readFileSync(path.join(project, "acme-gov", GOVERNING_FILES[1]), "utf8")).to.contain("UNRATIFIED");
  });

  it("the copies are read-only, and a second launch still refreshes them", () => {
    const first = snapshotGovernance(realPorts(), project, "acme-gov", "main")!;
    expect(fs.statSync(path.join(first.dir, "org-config.yaml")).mode & 0o777).to.equal(0o444);
    expect(() => snapshotGovernance(realPorts(), project, "acme-gov", "main"), "0444 from last time must not block the refresh").to.not.throw();
  });
});
