// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE PRACTICE PROJECT (F136, PRJ-121) — "Make the policy ours", made at first run without a question, against the
 * memory ports: board + anchor (`anchor` + `practice`, Q39 A) + one task issue + `gov seed`.
 *
 * And the reuse rule it inherited (adoption walk #5, 2026-10-07): every setup run used to create a NEW project — the
 * walk found 17. The open one is reused; one is created only when none is open.
 */
import { expect } from "chai";
import {
  ensurePracticeProject, practicePolicyTitle, practiceSlug, practiceSummary, practiceTask,
  PRACTICE_BOARD_TITLE, PRACTICE_FILE, PRACTICE_LABEL, type PracticeDeps,
} from "../../src/lifecycle/starter-project.js";
import type { BoardSummary } from "../../src/lifecycle/project-list.js";
import { createMemoryWorkTracker } from "../../src/adapters/memory/work-tracker.js";
import { createMemoryVcs } from "../../src/adapters/memory/vcs.js";

const GOV = { owner: "acme", name: "acme-gov" };

function world(boards: readonly BoardSummary[] | null, opts: { seedCode?: number; identity?: boolean; seedThrows?: boolean } = {}) {
  const tracker = createMemoryWorkTracker();
  const vcs = createMemoryVcs({
    repos: [{ repo: GOV, defaultBranch: "main", branches: { main: "abc" } }],
    ...(opts.identity === false ? {} : { identity: { login: "alice", kind: "human" as const } }),
  });
  const seeded: string[] = [];
  const deps: PracticeDeps = {
    tracker, vcs, owner: "acme", govRepo: GOV, defaultCodeBranch: "main",
    listBoards: () => boards,
    seed: (url) => { seeded.push(url); if (opts.seedThrows) throw new Error("BoardFetchError"); return opts.seedCode ?? 0; },
    boardWaitMs: 1, sleep: async () => {},
  };
  return { tracker, deps, seeded };
}
const board = (number: number, title: string, closed = false): BoardSummary => ({ number, title, url: `https://github.com/orgs/acme/projects/${number}`, closed });

describe("F136 — the practice project is made at first run, the way `gov project --seed` makes any project", () => {
  it("a board 'Make the policy ours', its anchor labelled anchor + practice, one task issue on the board, then seed", async () => {
    const { tracker, deps, seeded } = world([]);
    const r = await ensurePracticeProject(deps, "Acme Ltd");
    expect(r.boardUrl).to.be.a("string");
    expect(r.seeded).to.equal(true);
    expect(seeded, "gov seed ran on the new board").to.deep.equal([r.boardUrl]);

    const items = await tracker.search({});
    expect(items.ok).to.equal(true);
    if (!items.ok) return;
    const anchor = items.value.find((i) => i.labels.includes("anchor"))!;
    expect(anchor.title).to.equal(`${PRACTICE_BOARD_TITLE}: project scope & anchor`);
    expect(anchor.labels, "gov-licence recognises the practice board by this label (Q39 A)").to.include(PRACTICE_LABEL);
    expect(anchor.assignees).to.deep.equal(["alice"]);

    const task = items.value.find((i) => !i.labels.includes("anchor"))!;
    expect(task.title).to.equal(practiceTask("Acme Ltd").title);
    expect(task.assignees).to.deep.equal(["alice"]);
    expect(task.labels, "only the anchor is the practice marker").to.not.include(PRACTICE_LABEL);

    const onBoard = await tracker.items({ owner: "acme", number: Number(r.boardUrl!.match(/(\d+)$/)![1]) });
    expect(onBoard.ok && onBoard.value.map((i) => i.ref.url).sort()).to.deep.equal([anchor.ref.url, task.ref.url].sort());
    const text = practiceSummary(r).join("\n");
    expect(text).to.contain(r.boardUrl!).and.to.contain("Seeded");
  });

  it("the project id it seeds is PRJ-<board#>-make-the-policy-ours — the slug gov work is pointed at", () => {
    expect(practiceSlug()).to.equal("make-the-policy-ours");
  });

  it("a seed that does not finish is reported, with the command to finish it — the board and anchor stand", async () => {
    const { deps } = world([], { seedCode: 1 });
    const r = await ensurePracticeProject(deps, "Acme Ltd");
    expect(r.seeded).to.equal(false);
    expect(practiceSummary(r).join("\n")).to.match(/Not seeded yet/).and.to.contain(`gov seed ${r.boardUrl}`);
  });

  it("a seed that THROWS is reported the same way — it never ends an adoption that otherwise succeeded", async () => {
    const { deps } = world([], { seedThrows: true });
    const r = await ensurePracticeProject(deps, "Acme Ltd");
    expect(r.seeded).to.equal(false);
    expect(r.taskUrl).to.be.a("string");
    expect(practiceSummary(r).join("\n")).to.match(/Not seeded yet/);
  });

  it("gov cannot tell who you are → nothing is created, and the summary says how to make it later", async () => {
    const { tracker, deps, seeded } = world([], { identity: false });
    const r = await ensurePracticeProject(deps, "Acme Ltd");
    expect(r.stopped).to.be.an("array");
    expect(seeded).to.deep.equal([]);
    const items = await tracker.search({});
    expect(items.ok && items.value.length).to.equal(0);
    expect(practiceSummary(r).join("\n")).to.contain(`gov project "${PRACTICE_BOARD_TITLE}" --seed`);
  });
});

describe("F136 — the task issue: the change, how to make it, and why the pull request stops", () => {
  const body = practiceTask("Acme Ltd").body;

  it("names the change exactly: the title page of policies/policy-document.yaml (Q29 A / Q30 A)", () => {
    expect(body).to.contain(PRACTICE_FILE);
    expect(body).to.contain('`title:` becomes `"Acme Ltd Development and Operations Policy"`');
    expect(body).to.contain('`approved_by:` becomes `"Policy Owner"`');
    expect(body, "the dates are left for the merge").to.match(/Leave `approved_on` and `effective_from` empty/);
  });

  it("tells the agent to make it with gov rules propose, and why — the policy change carries its paperwork (G4)", () => {
    expect(body).to.contain("gov rules propose");
    for (const part of ["policies/VERSION", "policies/history/", "policies/CHANGELOG.md", "sections reviewed", "rule rows"]) {
      expect(body, part).to.contain(part);
    }
  });

  it("says ahead of time that the pull request stops for someone else's approval, and that the stop is the point", () => {
    expect(body).to.match(/will not merge on your own approval/);
    expect(body).to.match(/that is the point/);
  });

  it("a solo organization is told to invite a teammate — no self-approval, no exception (Q38 B+)", () => {
    expect(body).to.match(/invite a teammate/);
    expect(body).to.match(/no way to approve it yourself, and no exception/);
    expect(body, "never offers a way round the approval").to.not.match(/self-approv|--admin|bypass/i);
  });

  it("is plain prose — no rule ids", () => {
    expect(body).to.not.match(/GOV-[A-Z]+-\d+/);
  });

  it("an org with no name yet still gets a title that reads", () => {
    expect(practicePolicyTitle("  ")).to.equal("Development and Operations Policy");
  });
});

describe("F136 — the practice project is reused, not re-created (walk #5)", () => {
  it("an open 'Make the policy ours' board is reused — nothing is created, nothing seeded", async () => {
    const { tracker, deps, seeded } = world([board(12, "Something else"), board(13, "Make the policy ours"), board(14, "make the policy ours")]);
    const r = await ensurePracticeProject(deps, "Acme Ltd");
    expect(r.reused).to.equal(true);
    expect(r.boardUrl, "the first one made is the one to finish").to.equal("https://github.com/orgs/acme/projects/13");
    expect(seeded).to.deep.equal([]);
    const items = await tracker.search({});
    expect(items.ok && items.value.length).to.equal(0);
    expect(practiceSummary(r).join("\n")).to.match(/already have one/i);
  });

  it("a closed one (finished or cancelled) is not reused — a new one is made", async () => {
    const { deps } = world([board(13, "Make the policy ours", true)]);
    const r = await ensurePracticeProject(deps, "Acme Ltd");
    expect(r.reused).to.not.equal(true);
    expect(r.boardUrl).to.be.a("string");
  });

  it("GitHub could not list the boards → nothing is created, rather than a possible duplicate", async () => {
    const { tracker, deps } = world(null);
    const r = await ensurePracticeProject(deps, "Acme Ltd");
    expect(r.boardUrl).to.equal(null);
    const items = await tracker.search({});
    expect(items.ok && items.value.length).to.equal(0);
    expect(practiceSummary(r).join("\n")).to.match(/could not check/i);
  });
});
