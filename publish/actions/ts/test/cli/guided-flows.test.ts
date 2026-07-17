// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { myProjects, seedableBoards, workspaceState, runWorkFlow, type WorkFlowDeps } from "../../src/cli/work-flow.js";
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

function deps(over: Partial<WorkFlowDeps> = {}): { deps: WorkFlowDeps; out: string[]; ran: string[][] } {
  const out: string[] = []; const ran: string[][] = [];
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
    ...over,
  };
  return { deps: base, out, ran };
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

  it("picks my project, seeds when not present, ends with session-start guidance", async () => {
    const { deps: d, out, ran } = deps({ prompt: async () => "1" });
    const code = await runWorkFlow(d);
    expect(code).to.equal(0);
    expect(ran[0][0]).to.equal("seed");          // not-seeded → seed
    expect(out.join("\n")).to.match(/is ready at/);
    expect(out.join("\n")).to.match(/session-start/);
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
});

