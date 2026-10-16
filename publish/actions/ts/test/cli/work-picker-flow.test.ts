// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE PICKER, DRIVEN — the four behaviours of `work-project-picker-design.md`, and what each costs GitHub.
 *
 * The design is an accounting argument as much as a UX one (§5): open a project already on this machine, 0
 * calls; open one assigned to you, 2; start a new one, 2 plus a page's worth. So these tests COUNT the calls
 * as well as reading the screen — a picker that shows the right list by asking the org twice has not done the
 * thing the design asked for.
 */
import { expect } from "chai";
import { runWorkFlow, candidateProjects, unstartedPage, localRow, markClosedOnGitHub, NOT_STARTED, type WorkFlowDeps } from "../../src/cli/work-flow.js";
import type { LocalProject } from "../../src/lifecycle/local-projects.js";
import type { Projects } from "../../src/lifecycle/project-list.js";
import type { AnchorCreator, AnchorInfo } from "../../src/lifecycle/anchor.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import { px } from "../helpers/paths.js";

interface Board { readonly number: number; readonly title: string; readonly closed?: boolean }

const boardsOf = (bs: readonly Board[]): Projects["listBoards"] => () =>
  bs.map((b) => ({ number: b.number, title: b.title, url: `https://github.com/orgs/Acme/projects/${b.number}`, closed: b.closed ?? false }));

const anchorFor = (byNum: Record<number, string[]>): AnchorCreator => ({
  createAnchorIssue: () => null, setState: () => true, setAssignee: () => true,
  find: (ref) => (byNum[ref.number] ? ({ url: "u#1", number: 1, labels: [], assignees: byNum[ref.number] } as AnchorInfo) : null),
  findAll: () => new Map(Object.entries(byNum).map(([n, who]) => [Number(n), { url: "u#1", number: 1, labels: [], assignees: who } as AnchorInfo])),
});

/** A disk with `folders` under /work, each fully cloned unless named in `halfMade`. */
function fakeFs(folders: readonly string[], halfMade: readonly string[] = [], mtimes: Record<string, number> = {}): Fs {
  const cloned = folders.filter((f) => !halfMade.includes(f));
  const paths = [...folders.map((f) => `/work/${f}`), ...cloned.map((f) => `/work/${f}/acme-gov/.git`)];
  return {
    pathExists: (p) => paths.includes(px(p)),
    readFile: (f) => (px(f).endsWith("/.git/HEAD") ? "ref: refs/heads/BRNCH-x\n" : null),
    writeFile() {}, mkdirp() {}, rm() {},
    readdir: (d) => (px(d) === "/work" ? [...folders] : []),
    mtimeMs: (p) => mtimes[px(p).replace("/work/", "")] ?? null,
  };
}

interface Harness {
  readonly deps: WorkFlowDeps;
  readonly out: string[];
  readonly screen: () => string;
  readonly ran: string[][];
  readonly launched: string[];
  readonly calls: { listBoards: number; access: number[] };
}

/** `answers` are typed in order; running out means `0` (back), so no test can loop forever. */
function harness(over: Partial<WorkFlowDeps> & { readonly boards?: readonly Board[]; readonly anchors?: Record<number, string[]>; readonly folders?: readonly string[]; readonly halfMade?: readonly string[]; readonly mtimes?: Record<string, number> }, answers: string[]): Harness {
  const out: string[] = []; const ran: string[][] = []; const launched: string[] = [];
  const calls = { listBoards: 0, access: [] as number[] };
  const { boards, anchors, folders, halfMade, mtimes, ...rest } = over;
  const deps: WorkFlowDeps = {
    projects: { listBoards: (o) => { calls.listBoards++; return boardsOf(boards ?? [])(o); } },
    anchor: anchorFor(anchors ?? {}),
    fs: fakeFs(folders ?? [], halfMade ?? [], mtimes ?? {}),
    config: { githubOrg: "Acme", workspaceRepo: "acme-gov", agentWorkRoot: "/work" },
    me: "rk",
    canWriteBoard: (n) => { calls.access.push(n); return true; },
    run: (argv) => { ran.push([...argv]); return 0; },
    // The QUESTION goes on the screen too, as a terminal shows it — otherwise a test cannot assert on what
    // the person was asked, only on what gov said afterwards.
    prompt: async (q) => { out.push(q); return answers.shift() ?? "0"; },
    print: (l) => out.push(l),
    launch: async (agent, cwd) => { launched.push(`${agent} ${px(cwd)}`); return 0; },
    hasTool: () => false,
    env: {},
    ask: { line: async () => "", secret: async () => "" },
    approvedAgents: () => [],          // structure-only: the flow stops at a shell, so no agent questions here
    ...rest,
  };
  return { deps, out, screen: () => out.join("\n"), ran, launched, calls };
}

const manyBoards = (n: number, from = 100): Board[] => Array.from({ length: n }, (_, i) => ({ number: from - i, title: `Project ${from - i}` }));

describe("Work picker — on this machine, first (0 GitHub calls)", () => {
  it("lists the folders on this machine before anything that needs a call, and opens one for free", async () => {
    const h = harness({
      boards: manyBoards(40), anchors: { 7: ["rk"] },
      folders: ["PRJ-7-alpha", "PRJ-9-infra"], mtimes: { "PRJ-9-infra": 2_000, "PRJ-7-alpha": 9_000 },
    }, ["1"]);
    expect(await runWorkFlow(h.deps)).to.equal(0);
    expect(h.screen()).to.contain("On this machine");
    expect(h.screen()).to.contain("1) PRJ-7-alpha");        // last used first
    expect(h.screen()).to.contain("2) PRJ-9-infra");
    // THE WHOLE POINT, AS A NUMBER (design §5): 2 + up to ~100 calls became 0.
    expect(h.calls.listBoards, "the board list was never fetched").to.equal(0);
    expect(h.calls.access, "and no write-access check was made").to.deep.equal([]);
    expect(h.ran, "nothing was seeded or cloned — it is already here").to.deep.equal([]);
    expect(h.launched).to.deep.equal(["shell /work/PRJ-7-alpha"]);
  });

  it("`work.picker.localOrder: number` orders it like the GitHub lists instead", async () => {
    const h = harness({ folders: ["PRJ-7-alpha", "PRJ-9-infra"], mtimes: { "PRJ-7-alpha": 9_000 } }, ["1"]);
    await runWorkFlow(h.deps, { localOrder: "number" });
    expect(h.screen()).to.contain("1) PRJ-9-infra");
  });

  it("`work.picker.localFirst: false` skips the local list entirely — the preference is read, not decorative", async () => {
    const h = harness({ boards: [{ number: 7, title: "Alpha" }], anchors: { 7: ["rk"] }, folders: ["PRJ-7-alpha"] }, ["1"]);
    await runWorkFlow(h.deps, { localFirst: false });
    expect(h.screen()).to.not.contain("On this machine");
    expect(h.screen()).to.contain("Yours on GitHub");
    expect(h.calls.listBoards).to.be.greaterThan(0);
  });

  it("a folder with no workspace clone is marked, and finishing it asks GitHub for the board URL (#206)", async () => {
    const h = harness({
      boards: [{ number: 9, title: "Infra" }], anchors: { 9: ["rk"] },
      folders: ["PRJ-9-infra"], halfMade: ["PRJ-9-infra"],
    }, ["1"]);
    await runWorkFlow(h.deps);
    expect(h.screen()).to.contain("needs cloning");
    expect(h.ran[0], "the board URL, never the project id").to.deep.equal(["join", "https://github.com/orgs/Acme/projects/9"]);
  });
});

describe("Work picker — yours, and could-start, as two lists", () => {
  it("`g` leaves the local list for the boards you are assigned on — two calls, no access checks", async () => {
    const h = harness({
      boards: manyBoards(40), anchors: { 100: ["rk"], 96: ["rk"], 92: ["someone-else"] },
      folders: ["PRJ-7-alpha"],
    }, ["g", "1"]);
    await runWorkFlow(h.deps);
    expect(h.screen()).to.contain("Yours on GitHub");
    expect(h.screen()).to.contain("1) PRJ-100-project-100");
    expect(h.screen()).to.contain("2) PRJ-96-project-96");
    expect(h.screen(), "somebody else's project is not in your list").to.not.contain("PRJ-92");
    expect(h.calls.listBoards, "fetched once for the whole flow").to.equal(1);
    expect(h.calls.access.length, "being assigned IS the access — no per-board check for this list").to.equal(1);
  });

  it("the two lists are never mixed: `not started` boards live behind `s`", async () => {
    const h = harness({ boards: manyBoards(5), anchors: { 100: ["rk"] } }, ["0"]);
    await runWorkFlow(h.deps);
    expect(h.screen()).to.contain("Yours on GitHub");
    expect(h.screen(), "no un-seeded board in the assigned list").to.not.contain(`(${NOT_STARTED})`);
    expect(h.screen()).to.contain("s) you could start");
  });

  it("`s` opens the could-start list, access-checked only as far as the page needs", async () => {
    const h = harness({ boards: manyBoards(40), anchors: { 100: ["rk"] } }, ["s", "0"]);
    await runWorkFlow(h.deps, { pageSize: 15, searchThreshold: 100 });   // a list, not the search prompt
    expect(h.screen()).to.contain("You could start");
    expect(h.screen()).to.contain(`(${NOT_STARTED})`);
    expect(h.calls.access.length, "15 of the 39 un-anchored boards, not all of them").to.equal(15);
  });

  it("with nothing assigned to you it goes straight to what you could start — no empty list to answer", async () => {
    const h = harness({ boards: manyBoards(3), anchors: {} }, ["1"]);
    await runWorkFlow(h.deps);
    expect(h.screen()).to.contain("Nothing on GitHub is assigned to you yet");
    expect(h.screen()).to.contain("You could start");
    expect(h.ran[0]![0]).to.equal("seed");
  });
});

describe("Work picker — /text instead of paging", () => {
  it("filters the level, ranks the id match first, and pages the MATCHES", async () => {
    const boards = [...manyBoards(20), { number: 5, title: "Billing rework" }, { number: 4, title: "Portal" }];
    const h = harness({ boards, anchors: Object.fromEntries(boards.map((b) => [b.number, ["rk"]])) }, ["/billing", "1"]);
    await runWorkFlow(h.deps);
    expect(h.screen()).to.contain("1 match 'billing'");
    expect(h.screen()).to.contain("press 1 to open it");
    expect(h.screen()).to.contain("PRJ-5-billing-rework");
    expect(h.ran[0], "and picking it is what opens it — a lone match is never opened unasked").to.deep.equal(["join", "https://github.com/orgs/Acme/projects/5"]);
  });

  it("a search that matches nothing keeps the level open and says how to clear it", async () => {
    const h = harness({ boards: manyBoards(5), anchors: Object.fromEntries(manyBoards(5).map((b) => [b.number, ["rk"]])) }, ["/zzz", "/", "1"]);
    await runWorkFlow(h.deps);
    expect(h.screen()).to.contain("nothing matches 'zzz'");
    expect(h.screen()).to.contain("show them all");
    expect(h.ran[0]![0], "clearing the filter brought the list back and 1 picked from it").to.equal("join");
  });

  it("searching the could-start list checks access ONLY on the matches — a search saves calls", async () => {
    const boards = [...manyBoards(40), { number: 5, title: "Billing rework" }];
    const h = harness({ boards, anchors: {} }, ["/billing", "0"]);
    await runWorkFlow(h.deps, { pageSize: 15 });
    // 41 unstarted boards is past the threshold, so the level led with search and checked NOTHING; the search
    // then narrowed it to one board, and gov paid exactly one call. That is the design's §5 line, measured:
    // "2 + checks only on matches".
    expect(h.calls.access).to.deep.equal([5]);
  });
});

describe("Work picker — past the threshold, lead with search", () => {
  const forty = manyBoards(42);
  const allMine = Object.fromEntries(forty.map((b) => [b.number, ["rk"]]));

  it("asks for a pattern and lists nothing; `m` still pages, in full pages", async () => {
    const h = harness({ boards: forty, anchors: allMine }, ["m", "m", "m", "0"]);
    await runWorkFlow(h.deps, { pageSize: 15, searchThreshold: 30 });
    expect(h.screen()).to.contain("42 projects assigned to you. Type part of a name to search (/), or m to page through them.");
    // Then the pages, in order, and every one full but the last: 15 · 15 · 12.
    const pages = h.out.filter((l) => /^\s+1\) PRJ-/.test(l));
    expect(pages.length, "three pages were shown").to.equal(3);
    const rows = h.out.filter((l) => /^\s+\d+\) PRJ-/.test(l)).length;
    expect(rows, "15 + 15 + 12 rows across them").to.equal(42);
    expect(h.screen()).to.contain("page 3 of 3");
  });

  it("a number still selects, even with nothing on screen — and it names what it chose", async () => {
    const h = harness({ boards: forty, anchors: allMine }, ["2"]);
    await runWorkFlow(h.deps, { searchThreshold: 30 });
    expect(h.screen()).to.contain("2) PRJ-99-project-99");
    expect(h.ran[0]).to.deep.equal(["join", "https://github.com/orgs/Acme/projects/99"]);
  });

  it("…but an UNSEEN pick of a `not started` board is confirmed first — seeding is org-visible", async () => {
    const h = harness({ boards: forty, anchors: {} }, ["1", "n"]);
    expect(await runWorkFlow(h.deps, { searchThreshold: 30 })).to.equal(0);
    expect(h.screen()).to.contain("Nobody has started that one");
    expect(h.screen()).to.contain("Left alone.");
    expect(h.ran, "nothing was seeded").to.deep.equal([]);
  });

  it("a search below the threshold lists as usual — the prompt only changes when a list is the wrong tool", async () => {
    const h = harness({ boards: forty, anchors: allMine }, ["/99", "0"]);
    await runWorkFlow(h.deps, { searchThreshold: 30 });
    expect(h.screen()).to.contain("1 match '99'");
    expect(h.screen()).to.contain("PRJ-99-project-99");
  });
});

describe("Work picker — GitHub throttling", () => {
  const throttled: Projects = {
    listBoards: () => [],
    lastFailure: () => "HTTP 403: API rate limit exceeded for user ID 42 (https://api.github.com/graphql)",
  };

  it("says GitHub is rate-limiting, and falls back to the projects already on this machine", async () => {
    const h = harness({ projects: throttled, folders: ["PRJ-7-alpha"] }, ["g", "1"]);
    expect(await runWorkFlow(h.deps)).to.equal(0);
    expect(h.screen()).to.contain("rate-limiting");
    expect(h.screen()).to.contain("gh api rate_limit");
    expect(h.screen(), "never 'you have no projects'").to.not.contain("No active or startable projects");
    expect(h.screen()).to.contain("On this machine");
    expect(h.launched, "and the local project still opened").to.deep.equal(["shell /work/PRJ-7-alpha"]);
  });

  it("with nothing local it stops with a non-zero code — not a hang, and not a wrong diagnosis", async () => {
    const h = harness({ projects: throttled, folders: [] }, []);
    expect(await runWorkFlow(h.deps)).to.equal(1);
    expect(h.screen()).to.contain("rate-limiting");
    expect(h.screen()).to.contain("nothing to offer offline");
    expect(h.screen()).to.not.contain("gh auth status");
  });

  it("`--project` names a folder that is here: gov opens it without GitHub", async () => {
    const h = harness({ projects: throttled, folders: ["PRJ-7-alpha"] }, []);
    expect(await runWorkFlow(h.deps, { projectPattern: "PRJ-7", agent: "shell", interactive: false })).to.equal(0);
    expect(h.screen()).to.contain("rate-limiting");
    expect(h.screen()).to.contain("already cloned here");
    expect(h.launched).to.deep.equal(["shell /work/PRJ-7-alpha"]);
  });

  it("standing IN a project that is cloned here, a throttle does not interrupt the work", async () => {
    // The sharpest form of the design's motivation: the person is inside the project, everything they need is
    // on the disk, and GitHub counting their requests is no reason to send them to a list gov cannot fetch.
    const h = harness({ projects: throttled, folders: ["PRJ-7-alpha"] }, []);
    expect(await runWorkFlow(h.deps, { currentProject: "PRJ-7-alpha", agent: "shell" })).to.equal(0);
    expect(h.screen()).to.contain("rate-limiting");
    expect(h.screen()).to.contain("Continuing PRJ-7-alpha anyway");
    expect(h.calls.access, "and not even a write check — nothing org-visible is about to happen").to.deep.equal([]);
    expect(h.launched).to.deep.equal(["shell /work/PRJ-7-alpha"]);
  });

  it("`--project` that is NOT here fails as a throttle, never as 'no such project'", async () => {
    const h = harness({ projects: throttled, folders: [] }, []);
    expect(await runWorkFlow(h.deps, { projectPattern: "PRJ-7", interactive: false })).to.equal(1);
    expect(h.screen()).to.contain("rate-limiting");
    expect(h.screen()).to.not.contain("No project matches");
  });
});

describe("Work picker — the pattern path pays for one board, not the org", () => {
  it("`--project` resolves from the board list alone; only the chosen board's access is checked", async () => {
    const h = harness({ boards: manyBoards(40), anchors: { 100: ["rk"] }, folders: [] }, []);
    await runWorkFlow(h.deps, { projectPattern: "PRJ-100", agent: "shell", interactive: false });
    expect(h.calls.listBoards).to.equal(1);
    expect(h.calls.access, "one board, the one named — it used to be every un-anchored board in the org").to.deep.equal([100]);
  });

  it("and it matches a board TITLE too, once the id regex has found nothing", async () => {
    const h = harness({ boards: [{ number: 5, title: "Billing rework" }], anchors: { 5: ["rk"] } }, []);
    await runWorkFlow(h.deps, { projectPattern: "rework", agent: "shell", interactive: false });
    expect(h.ran[0]).to.deep.equal(["join", "https://github.com/orgs/Acme/projects/5"]);
  });
});

describe("Work picker — the lists themselves", () => {
  it("candidateProjects answers who is assigned and what is unseeded, with no access checks at all", () => {
    const h = harness({ boards: [{ number: 9, title: "Infra" }, { number: 7, title: "Alpha" }, { number: 6, title: "Gone", closed: true }], anchors: { 7: ["rk"] } }, []);
    const got = candidateProjects(h.deps);
    expect(got.map((c) => c.boardNumber), "newest first, closed boards dropped").to.deep.equal([9, 7]);
    expect(got.map((c) => [c.mine, c.anchored])).to.deep.equal([[false, false], [true, true]]);
    expect(got[0]!.status).to.equal(NOT_STARTED);
    expect(h.calls.access, "the expensive question is not asked here").to.deep.equal([]);
  });

  it("a folder is marked `closed on GitHub` only once GitHub has been consulted anyway", () => {
    // The rule is about NOT making a call: the local list is the zero-call list, and a mark it had to fetch the
    // board list to earn would cost exactly what that list exists to avoid. `null` boards means "gov has not
    // asked", and then nothing is marked — absence means unknown, never "open".
    const l: LocalProject = { projectId: "PRJ-7-alpha", dir: "/work/PRJ-7-alpha", boardNumber: 7, branch: "BRNCH-7", lastUsedMs: null, cloned: true };
    expect([...markClosedOnGitHub([l], null)], "not asked → nothing claimed").to.deep.equal([]);
    expect([...markClosedOnGitHub([l], [{ number: 7, title: "Alpha", url: "u", closed: false }])]).to.deep.equal([]);
    expect([...markClosedOnGitHub([l], [{ number: 7, title: "Alpha", url: "u", closed: true }])]).to.deep.equal(["PRJ-7-alpha"]);
    expect([...markClosedOnGitHub([l], [])], "and a board that is gone counts as closed").to.deep.equal(["PRJ-7-alpha"]);
    expect(localRow(l, 0, true).note).to.contain("closed on GitHub");
    expect(localRow(l, 0).note, "a half-made folder says what it still needs")
      .to.not.contain("needs cloning");
    expect(localRow({ ...l, cloned: false }, 0).note).to.contain("needs cloning");
  });

  it("unstartedPage checks access for the page only, and reports the boards it scanned past", () => {
    const h = harness({ boards: manyBoards(40), anchors: {} }, []);
    const page = unstartedPage(h.deps, 5, 0);
    expect(page.items).to.have.length(5);
    expect(page.total, "40 boards, none of them seeded").to.equal(40);
    expect(h.calls.access.length).to.equal(5);
    expect(page.more).to.equal(true);
  });
});

/**
 * F16 (svm-geneva re-walk, 2026-10-07). Work listed boards to START in a governance repository that could not seed
 * one — the older framework layout — and the start failed at seed ("todo-template.md is missing… Run gov upgrade").
 * The layout is checked before a start is offered; the screen says what to do instead.
 */
describe("Work picker — a governance repository that cannot seed offers nothing to start (F16)", () => {
  const BLOCKED = ["  This governance repository is on an older framework than this gov, so no project can be started in it yet:",
    "  Bring it forward first — its Policy Owner (@polly) runs:  gov upgrade --pr"];

  it("no `s` list and no not-started rows; the reason and the remedy are on the screen", async () => {
    const h = harness({ boards: manyBoards(3), anchors: { 100: ["rk"] }, seedBlocked: () => BLOCKED }, ["s", "0"]);
    await runWorkFlow(h.deps);
    expect(h.screen()).to.contain("gov upgrade --pr");
    expect(h.screen()).to.not.contain("you could start");
    expect(h.screen()).to.not.contain("PRJ-99");
    expect(h.calls.access.filter((n) => n !== 100), "no write-access check for a board it will not offer").to.deep.equal([]);
  });

  it("nothing assigned and nothing startable: it says why, rather than 'create a board'", async () => {
    const h = harness({ boards: manyBoards(3), anchors: {}, seedBlocked: () => BLOCKED }, ["0"]);
    await runWorkFlow(h.deps);
    expect(h.screen()).to.contain("older framework");
    expect(h.ran, "nothing seeded").to.deep.equal([]);
  });

  it("a named project nobody has started is refused before seed runs, with --seed or without", async () => {
    const h = harness({ boards: [{ number: 5, title: "New" }], anchors: {}, seedBlocked: () => BLOCKED }, []);
    expect(await runWorkFlow(h.deps, { projectPattern: "PRJ-5", seedOk: true, interactive: false })).to.equal(1);
    expect(h.ran, "seed never ran").to.deep.equal([]);
    expect(h.screen()).to.contain("gov upgrade --pr");
  });

  it("a project already started still opens — only starting is blocked", async () => {
    const h = harness({ boards: [{ number: 7, title: "Alpha" }], anchors: { 7: ["rk"] }, seedBlocked: () => BLOCKED }, ["1"]);
    await runWorkFlow(h.deps, { localFirst: false });
    expect(h.ran[0]).to.deep.equal(["join", "https://github.com/orgs/Acme/projects/7"]);
  });
});
