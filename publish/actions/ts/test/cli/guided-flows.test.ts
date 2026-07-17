// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { myProjects, seedableBoards, workspaceState, runWorkFlow, agentLaunchSpec, ensureRootProtocol, type WorkFlowDeps } from "../../src/cli/work-flow.js";
import type { Projects } from "../../src/lifecycle/project-list.js";
import type { AnchorCreator, AnchorInfo } from "../../src/lifecycle/anchor.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";

const projects = (boards: Array<{ number: number; title: string; closed?: boolean }>): Projects => ({
  listBoards: () => boards.map((b) => ({ number: b.number, title: b.title, url: `https://github.com/orgs/Acme/projects/${b.number}`, closed: b.closed ?? false })),
});
const anchorFor = (byNum: Record<number, string[]>): AnchorCreator => ({
  createAnchorIssue: () => null, setState: () => true, setAssignee: () => true,
  find: (ref) => (byNum[ref.number] ? ({ url: `u#1`, number: 1, labels: [], assignees: byNum[ref.number] } as AnchorInfo) : null),
});
const fsWith = (paths: string[]): Fs => ({ pathExists: (p) => paths.some((x) => x === p || x.startsWith(p + "/")), readFile: () => null, writeFile() {}, mkdirp() {}, rm() {}, readdir: () => [] });

function deps(over: Partial<WorkFlowDeps> = {}): { deps: WorkFlowDeps; out: string[]; ran: string[][]; launched: Array<[string, string]> } {
  const out: string[] = []; const ran: string[][] = []; const launched: Array<[string, string]> = [];
  const base: WorkFlowDeps = {
    projects: projects([{ number: 7, title: "Alpha" }, { number: 8, title: "Beta" }]),
    anchor: anchorFor({ 7: ["rk"], 8: ["someone-else"] }),
    fs: fsWith([]),
    config: { githubOrg: "Acme", workspaceRepo: "acme-gov", agentWorkRoot: "/work" },
    me: "rk",
    canWriteBoard: () => true,
    run: (argv) => { ran.push([...argv]); return 0; },
    prompt: async () => "1",
    print: (l) => out.push(l),
    launch: async (agent, cwd) => { launched.push([agent, cwd]); return 0; },
    ...over,
  };
  return { deps: base, out, ran, launched };
}

describe("gov-work — guided Work flow", () => {
  it("myProjects = open boards where I'm an anchor assignee", () => {
    const { deps: d } = deps();
    const mine = myProjects(d);
    expect(mine.map((p) => p.boardNumber)).to.deep.equal([7]); // board 8 is someone else's
    expect(mine[0].projectId).to.match(/^PRJ-7-alpha$/);
  });

  it("seedableBoards = open boards I can WRITE but that have NO anchor yet (startable in Work, not just pickable)", () => {
    // Regression guard (2026-07-17): a freshly-created board (e.g. #106) wasn't offered in Work because it had
    // no anchor yet. Work must surface writable, un-seeded boards so they can be started.
    const { deps: d } = deps({
      projects: projects([{ number: 7, title: "Alpha" }, { number: 9, title: "Infra" }, { number: 10, title: "Locked" }]),
      anchor: anchorFor({ 7: ["rk"] }),   // 7 is already seeded; 9 + 10 are un-anchored
      canWriteBoard: (n) => n !== 10,     // I can't seed 10
    });
    expect(seedableBoards(d).map((p) => p.boardNumber)).to.deep.equal([9]);   // 7 anchored (myProjects), 10 not writable
    expect(seedableBoards(d)[0].status).to.equal("not started");
  });

  it("workspaceState: not-seeded → not-cloned → ready", () => {
    const p = { boardNumber: 7, title: "Alpha", url: "u", status: "active", projectId: "PRJ-7-alpha" };
    expect(workspaceState({ ...deps().deps, fs: fsWith([]) }, p)).to.equal("not-seeded");
    expect(workspaceState({ ...deps().deps, fs: fsWith(["/work/PRJ-7-alpha"]) }, p)).to.equal("not-cloned");
    expect(workspaceState({ ...deps().deps, fs: fsWith(["/work/PRJ-7-alpha/acme-gov/.git"]) }, p)).to.equal("ready");
  });

  it("picks my project, seeds when not present, then LAUNCHES the chosen agent in <project>", async () => {
    const { deps: d, out, ran, launched } = deps({ prompt: async () => "1" });   // project 1, then agent 1 (Claude)
    const code = await runWorkFlow(d);
    expect(ran[0][0]).to.equal("seed");          // not-seeded → seed
    expect(out.join("\n")).to.match(/is ready at/);
    expect(launched).to.deep.equal([["claude", "/work/PRJ-7-alpha"]]);   // launch-in-<project> (NOT the workspace subdir)
    expect(code).to.equal(0);
  });

  it("agent picker '0) later' → no launch, prints the manual command", async () => {
    let calls = 0;
    const { deps: d, out, launched } = deps({ prompt: async () => (++calls === 1 ? "1" : "0") });   // project 1, then 'later'
    await runWorkFlow(d);
    expect(launched).to.deep.equal([]);
    expect(out.join("\n")).to.match(/Later:.*cd/);
  });

  it("lists newest board first + paginates, probing access ONLY for the visible page (no long wait)", async () => {
    const boards = Array.from({ length: 20 }, (_, i) => ({ number: i + 1, title: `P${i + 1}` }));   // 1..20, all un-anchored
    const probed: number[] = [];
    const { deps: d, out } = deps({
      projects: projects(boards), anchor: anchorFor({}),
      canWriteBoard: (n) => { probed.push(n); return true; },
      prompt: async () => "0",   // back after page 1
    });
    await runWorkFlow(d);
    expect(probed.length).to.equal(15);   // only the first page probed, not all 20
    expect(probed[0]).to.equal(20);       // newest board first (sorted desc)
    expect(out.join("\n")).to.match(/m\) more/);
  });

  it("blocks when the board isn't writable by me", async () => {
    const { deps: d, out } = deps({ canWriteBoard: () => false, prompt: async () => "1" });
    expect(await runWorkFlow(d)).to.equal(1);
    expect(out.join("\n")).to.match(/write access/);
  });

  it("tells me to get assigned when I own no projects", async () => {
    const { deps: d, out } = deps({ anchor: anchorFor({ 8: ["x"] }), canWriteBoard: () => false });   // 8 is someone else's; nothing seedable
    expect(await runWorkFlow(d)).to.equal(0);
    expect(out.join("\n")).to.match(/No active or startable projects/);
  });

  it("agent picker maps EVERY choice (1-4) to the right agent, launched in <project>", async () => {
    for (const [choice, kind] of [["1", "claude"], ["2", "cursor"], ["3", "cursor-gui"], ["4", "shell"]] as const) {
      let calls = 0;
      const { deps: d, launched } = deps({ prompt: async () => (++calls === 1 ? "1" : choice) });   // project 1, then agent
      await runWorkFlow(d);
      expect(launched, `choice ${choice}`).to.deep.equal([[kind, "/work/PRJ-7-alpha"]]);
    }
  });

  it("agentLaunchSpec: correct binary + detached flag per agent (guards the launch mapping)", () => {
    expect(agentLaunchSpec("claude", "/p")).to.deep.equal({ cmd: "claude", args: [], detached: false });
    expect(agentLaunchSpec("cursor", "/p")).to.deep.equal({ cmd: "cursor-agent", args: [], detached: false });
    expect(agentLaunchSpec("cursor-gui", "/p")).to.deep.equal({ cmd: "cursor", args: ["/p"], detached: true });   // GUI opens the dir, detached
    expect(agentLaunchSpec("shell", "/p", { SHELL: "/bin/fish" } as NodeJS.ProcessEnv)).to.deep.equal({ cmd: "/bin/fish", args: [], detached: false });
  });

  it("ensureRootProtocol drops a root CLAUDE.md that @-imports the workspace protocol (session-start runs at <project>)", () => {
    const writes: Array<[string, string]> = [];
    const d = { ...deps().deps, fs: { ...fsWith([]), writeFile: (p: string, c: string) => writes.push([p, c]) } };
    ensureRootProtocol(d, "/work/PRJ-9-infra");
    expect(writes).to.deep.equal([["/work/PRJ-9-infra/CLAUDE.md", "@acme-gov/CLAUDE.md\n"]]);
    const d2 = { ...deps().deps, fs: { ...fsWith(["/work/PRJ-9-infra/CLAUDE.md"]), writeFile: (p: string, c: string) => writes.push([p, c]) } };
    ensureRootProtocol(d2, "/work/PRJ-9-infra");   // idempotent — doesn't overwrite an existing root protocol
    expect(writes).to.have.length(1);
  });

  it("ensureRootProtocol mirrors the FULL harness — every agent's entrypoint at <project>, not just Claude", () => {
    const writes: Array<[string, string]> = []; const dirs: string[] = [];
    const fs = {
      ...fsWith([]),
      readFile: (f: string) => (f.endsWith("AGENTS.md") || f.endsWith("agent.mdc")) ? `# rendered protocol (${f})` : null,   // these rendered; others absent
      writeFile: (p: string, c: string) => writes.push([p, c]),
      mkdirp: (dir: string) => dirs.push(dir),
    };
    ensureRootProtocol({ ...deps().deps, fs }, "/work/PRJ-9");
    const written = writes.map(([p]) => p);
    expect(written).to.include("/work/PRJ-9/CLAUDE.md");                 // Claude via @-import stub
    expect(written).to.include("/work/PRJ-9/AGENTS.md");                 // Codex/Cursor — copied
    expect(written).to.include("/work/PRJ-9/.cursor/rules/agent.mdc");   // Cursor — copied (nested)
    expect(dirs).to.include("/work/PRJ-9/.cursor/rules");               // mkdirp for the nested path
    expect(written).to.not.include("/work/PRJ-9/CONVENTIONS.md");        // not rendered here → skipped
  });
});

