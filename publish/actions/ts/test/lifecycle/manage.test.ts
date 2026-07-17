// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { manageList, manageAssign, anchorShow, formatOwnerRows, projectStatus } from "../../src/lifecycle/manage.js";
import type { AnchorCreator, AnchorInfo } from "../../src/lifecycle/anchor.js";
import type { Projects } from "../../src/lifecycle/project-list.js";
import type { Vcs } from "../../src/lifecycle/vcs.js";

const CONFIG = { githubOrg: "Svayamtech", workspaceRepo: "svm-prj-work" };

const projects = (boards: Array<{ number: number; title: string; closed: boolean }>): Projects => ({
  listBoards: () => boards.map((b) => ({ ...b, url: `u/${b.number}` })),
});
function anchorPort(byNum: Record<number, { labels: string[]; assignees: string[] }>) {
  const calls: string[] = [];
  const anchor: AnchorCreator = {
    createAnchorIssue: () => null,
    setState: () => true,
    find: (ref) => {
      const a = byNum[ref.number];
      return a ? ({ url: `u/${ref.number}#1`, number: 1, labels: a.labels, assignees: a.assignees } as AnchorInfo) : null;
    },
    setAssignee: (url, login, action) => {
      calls.push(`${action} ${login} @ ${url}`);
      return true;
    },
  };
  return { anchor, calls };
}
const fakeVcs = (branch: string): Vcs =>
  ({ currentBranch: () => branch } as unknown as Vcs);

describe("prj-work — manage", () => {
  it("assign targets an EXPLICIT board (--board) — works from GOVERNED where there's no project branch", () => {
    const { anchor, calls } = anchorPort({ 106: { labels: [], assignees: [] } });
    const deps = { vcs: fakeVcs("main"), anchor };   // org-home (not a project branch)
    expect(manageAssign(deps, CONFIG, "/gov", "rk", "add").ok).to.equal(false);       // no board derivable → refused
    const r = manageAssign(deps, CONFIG, "/gov", "rk", "add", 106);                    // explicit board → assigns
    expect(r.ok).to.equal(true);
    expect(calls).to.deep.equal(["add rk @ u/106#1"]);
  });

  it("list shows open boards with derived status + owners; list-all includes closed", () => {
    const { anchor } = anchorPort({ 7: { labels: ["paused"], assignees: ["rk"] }, 8: { labels: [], assignees: [] } });
    const deps = { projects: projects([{ number: 7, title: "A", closed: false }, { number: 8, title: "B", closed: true }]), anchor };
    const open = manageList(deps, CONFIG, false);
    expect(open.rows.map((r) => r.boardNumber)).to.deep.equal([7]); // closed excluded
    expect(open.total).to.equal(1);
    expect(open.rows[0]).to.include({ status: "paused" });
    expect(open.rows[0].owners).to.deep.equal(["rk"]);
    const all = manageList(deps, CONFIG, true);
    expect(all.rows.map((r) => r.boardNumber)).to.deep.equal([7, 8]);
    expect(all.rows[1].status).to.equal("completed"); // closed + no cancelled
    expect(formatOwnerRows(open.rows)[0]).to.match(/#7 \[paused\] A — owners: rk/);
  });

  it("paginates: a page of `limit` from `offset`, with the full `total` reported (limit<=0 → all)", () => {
    const boards = Array.from({ length: 5 }, (_, i) => ({ number: i + 1, title: `P${i}`, closed: false }));
    const { anchor } = anchorPort(Object.fromEntries(boards.map((b) => [b.number, { labels: [], assignees: [] }])));
    const deps = { projects: projects(boards), anchor };
    const p1 = manageList(deps, CONFIG, false, 2, 0);
    expect(p1.rows.map((r) => r.boardNumber)).to.deep.equal([1, 2]);
    expect(p1.total).to.equal(5);
    expect(manageList(deps, CONFIG, false, 2, 2).rows.map((r) => r.boardNumber)).to.deep.equal([3, 4]);   // page 2
    expect(manageList(deps, CONFIG, false, 0, 0).rows).to.have.length(5);                                  // limit<=0 → all
  });

  it("assign/unassign add/remove an owner on the current project's anchor", () => {
    const { anchor, calls } = anchorPort({ 43: { labels: [], assignees: [] } });
    const r = manageAssign({ vcs: fakeVcs("BRNCH-43-x"), anchor }, CONFIG, "/gov", "newowner", "add");
    expect(r.ok).to.equal(true);
    if (r.ok) expect(r).to.include({ login: "newowner", action: "add", applied: true });
    expect(calls[0]).to.match(/add newowner @ u\/43#1/);
  });

  it("assign refuses off a non-project branch / missing anchor", () => {
    const { anchor } = anchorPort({});
    expect(manageAssign({ vcs: fakeVcs("main"), anchor }, CONFIG, "/gov", "x", "add")).to.include({ ok: false, reason: "not-a-project-branch" });
    expect(manageAssign({ vcs: fakeVcs("BRNCH-43-x"), anchor }, CONFIG, "/gov", "x", "add")).to.include({ ok: false, reason: "no-anchor" });
  });

  it("status derives the current project's status from board + anchor labels", () => {
    const { anchor } = anchorPort({ 43: { labels: ["paused"], assignees: ["rk"] } });
    const deps = { vcs: fakeVcs("BRNCH-43-x"), projects: projects([{ number: 43, title: "Gov", closed: false }]), anchor };
    const r = projectStatus(deps, CONFIG, "/gov");
    expect(r.ok).to.equal(true);
    if (r.ok) expect(r).to.include({ boardNumber: 43, title: "Gov", status: "paused" });
    // off a project branch → not-a-project-branch; board missing → not-found
    expect(projectStatus({ ...deps, vcs: fakeVcs("main") }, CONFIG, "/gov")).to.include({ ok: false, reason: "not-a-project-branch" });
    expect(projectStatus({ ...deps, projects: projects([]) }, CONFIG, "/gov")).to.include({ ok: false, reason: "not-found" });
  });

  it("anchor show returns the anchor's url/labels/owners", () => {
    const { anchor } = anchorPort({ 43: { labels: ["paused"], assignees: ["rk", "mo"] } });
    const r = anchorShow({ vcs: fakeVcs("BRNCH-43-x"), anchor }, CONFIG, "/gov");
    expect(r.ok).to.equal(true);
    if (r.ok) expect(r).to.deep.include({ number: 1, labels: ["paused"], owners: ["rk", "mo"] });
  });
});
