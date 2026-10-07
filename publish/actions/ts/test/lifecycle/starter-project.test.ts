// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * ADOPTION WALK #5 (2026-10-07): every setup run created a NEW "Review our governance" project — the walk found 17
 * (PRJ-13…29). The open one is reused; a board is created only when none is open.
 */
import { expect } from "chai";
import { ensureStarterProject, starterProject, starterSummary, type StarterDeps } from "../../src/lifecycle/starter-project.js";
import type { BoardSummary } from "../../src/lifecycle/project-list.js";

function deps(boards: readonly BoardSummary[] | null): StarterDeps & { made: string[] } {
  const made: string[] = [];
  return {
    made,
    listBoards: () => boards,
    createBoard: (owner, title) => { made.push(`board ${owner} ${title}`); return "https://github.com/orgs/acme/projects/30"; },
    createIssue: (repo, title) => { made.push(`issue ${repo} ${title}`); return "https://github.com/acme/acme-gov/issues/1"; },
    addToBoard: (owner, n) => { made.push(`add ${owner} #${n}`); },
  };
}
const board = (number: number, title: string, closed = false): BoardSummary => ({ number, title, url: `https://github.com/orgs/acme/projects/${number}`, closed });

describe("gov-work — the review project is reused, not re-created (walk #5)", () => {
  it("an open 'Review our governance' board is reused — nothing is created", () => {
    const d = deps([board(12, "Something else"), board(13, "Review our governance"), board(14, "review our governance")]);
    const r = ensureStarterProject(d, "acme", "acme-gov");
    expect(d.made).to.deep.equal([]);
    expect(r.reused).to.equal(true);
    expect(r.boardUrl, "the first one made is the one to finish").to.equal("https://github.com/orgs/acme/projects/13");
    expect(starterSummary(r).join("\n")).to.match(/already have one/i);
  });

  it("a closed one (finished or cancelled) is not reused — a new one is made", () => {
    const d = deps([board(13, "Review our governance", true)]);
    const r = ensureStarterProject(d, "acme", "acme-gov");
    expect(r.reused).to.equal(false);
    expect(d.made).to.deep.equal([
      `board acme ${starterProject("acme", "acme-gov").boardTitle}`,
      "issue acme/acme-gov Make the seeded policies ours",
      "add acme #30",
    ]);
  });

  it("none at all → one is created", () => {
    const d = deps([]);
    expect(ensureStarterProject(d, "acme", "acme-gov").reused).to.equal(false);
    expect(d.made.length).to.equal(3);
  });

  it("GitHub could not list the boards → nothing is created, rather than a possible duplicate", () => {
    const d = deps(null);
    const r = ensureStarterProject(d, "acme", "acme-gov");
    expect(d.made).to.deep.equal([]);
    expect(r.boardUrl).to.equal(null);
    expect(starterSummary(r).join("\n")).to.match(/could not check/i);
  });
});
