// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov project <name> [--repo r] [--seed]` (plan 03 L06, spec 03 §7, gadf#182) — against the memory ports.
 *
 *   pre-seed checks ─► createProject ─► anchor (label anchor, assigned to the invoker) ─► on the board
 *   ─► each --repo on the board ─► --seed hands to `gov seed <board-url>`
 *
 * A pre-seed failure creates NOTHING; a failure after the board exists reports exactly what exists.
 */
import { expect } from "chai";
import { createGovProject, preSeedChecks, type ProjectEnv } from "../../src/project/create.js";
import { projectCommand, type ProjectVerbDeps } from "../../src/cli/project-verb.js";
import { createMemoryWorkTracker, type MemoryWorkTracker } from "../../src/adapters/memory/work-tracker.js";
import { createMemoryVcs } from "../../src/adapters/memory/vcs.js";
import { fail } from "../../src/ports/result.js";
import type { WorkTrackerPort } from "../../src/ports/work-tracker.js";
import type { VcsPort } from "../../src/ports/vcs.js";

const GOV = { owner: "acme", name: "acme-gov" };
const API = { owner: "acme", name: "invoice-api" };

function world(opts: { identity?: { login: string; kind: "human" | "bot" } | null; repos?: { owner: string; name: string }[] } = {}) {
  const tracker = createMemoryWorkTracker();
  const identity = opts.identity === null ? undefined : (opts.identity ?? { login: "alice", kind: "human" as const });
  const vcs = createMemoryVcs({
    repos: (opts.repos ?? [GOV, API]).map((repo) => ({ repo, defaultBranch: "main", branches: { main: "abc" } })),
    ...(identity ? { identity } : {}),
  });
  const env: ProjectEnv = { tracker, vcs, owner: "acme", govRepo: GOV, defaultCodeBranch: "dev" };
  return { tracker, vcs, env };
}

/** Nothing on the tracker at all: no board, no item. */
async function nothingCreated(t: MemoryWorkTracker): Promise<void> {
  const p = await t.project({ owner: "acme", number: 1 });
  expect(p.ok, "no board was created").to.equal(false);
  const s = await t.search({});
  expect(s.ok && s.value.length, "no item was created").to.equal(0);
}

describe("gov project — pre-seed checks — the board contract (nothing created on failure)", () => {
  it("name: a blank name is refused with a fixable message, and nothing is created", async () => {
    const { tracker, env } = world();
    const r = await createGovProject(env, { name: "   ", repos: [] });
    expect(r.ok).to.equal(false);
    if (r.ok) return;
    expect(r.stage).to.equal("pre-seed");
    expect(r.lines.join("\n")).to.match(/✗ name:/).and.to.match(/gov project "<name>"/);
    await nothingCreated(tracker);
  });

  it("name: a name with no letters or digits cannot become a project id — refused before anything exists", async () => {
    const { tracker, env } = world();
    const r = await createGovProject(env, { name: "!!!", repos: [] });
    expect(r.ok).to.equal(false);
    expect(r.lines.join("\n")).to.match(/✗ name:/).and.to.contain("letter or digit");
    await nothingCreated(tracker);
  });

  it("linked-item: the governance repo cannot be read → no board (its anchor would be the board's only linked item)", async () => {
    const { tracker, env } = world({ repos: [API] });
    const r = await createGovProject(env, { name: "Invoice API", repos: [] });
    expect(r.ok).to.equal(false);
    expect(r.lines.join("\n")).to.match(/✗ linked-item:/).and.to.contain("acme/acme-gov");
    await nothingCreated(tracker);
  });

  it("linked-item: gov cannot tell who you are → refused (the anchor must be assigned to the invoker)", async () => {
    const { tracker, env } = world({ identity: null });
    const r = await createGovProject(env, { name: "Invoice API", repos: [] });
    expect(r.ok).to.equal(false);
    expect(r.lines.join("\n")).to.match(/✗ linked-item:/).and.to.contain("gh auth login");
    await nothingCreated(tracker);
  });

  it("a bot cannot start a project — intent stays human (#182, not in scope)", async () => {
    const { tracker, env } = world({ identity: { login: "gov-bot[bot]", kind: "bot" } });
    const r = await createGovProject(env, { name: "Invoice API", repos: [] });
    expect(r.ok).to.equal(false);
    expect(r.lines.join("\n")).to.contain("a person");
    await nothingCreated(tracker);
  });

  it("repositories: a --repo that is not an identifiable repository is refused, naming it, and nothing is created", async () => {
    const { tracker, env } = world();
    const r = await createGovProject(env, { name: "Invoice API", repos: ["acme/no-such-repo", "a/b/c/d"] });
    expect(r.ok).to.equal(false);
    const text = r.lines.join("\n");
    expect(text).to.match(/✗ repositories:/).and.to.contain("acme/no-such-repo").and.to.contain("a/b/c/d");
    expect(text).to.contain("nothing was created");
    await nothingCreated(tracker);
  });

  it("every failing check is reported at once, not one per run", async () => {
    const { env } = world({ identity: null });
    const r = await createGovProject(env, { name: "", repos: ["acme/nope"] });
    const text = r.lines.join("\n");
    expect(text).to.match(/✗ name:/).and.to.match(/✗ linked-item:/).and.to.match(/✗ repositories:/);
  });

  it("description/scope never block: no description is advisory, and the anchor is the scope marker", async () => {
    const { env } = world();
    const pre = await preSeedChecks(env, { name: "Invoice API", repos: [] });
    expect(pre.ok).to.equal(true);
    const by = Object.fromEntries(pre.checks.map((c) => [c.rule, c]));
    expect(by["description"]!.advisory).to.equal(true);
    expect(by["scope"]!.ok).to.equal(true);
  });
});

describe("gov project — board + labelled anchor, assigned to the invoker, on the board", () => {
  it("creates the board, then the anchor in the governance repo: labelled anchor, assigned to the invoker, on the board", async () => {
    const { tracker, env } = world();
    const r = await createGovProject(env, { name: "Invoice API", repos: [] });
    expect(r.ok, r.lines.join("\n")).to.equal(true);
    if (!r.ok) return;

    const board = await tracker.project(r.created.board!.ref);
    expect(board.ok && board.value.title).to.equal("Invoice API");
    const items = await tracker.items(r.created.board!.ref);
    expect(items.ok).to.equal(true);
    if (!items.ok) return;
    expect(items.value).to.have.length(1);
    const anchor = items.value[0]!;
    expect(anchor.ref.url).to.match(/^memory:\/\/acme\/acme-gov\/issues\//);
    expect(anchor.labels).to.deep.equal(["anchor"]);
    expect(anchor.assignees).to.deep.equal(["alice"]);
    // The body gov seed and gov manage read the board number from — the anchor is findable as this board's.
    expect(anchor.body).to.contain(`Project #${r.created.board!.ref.number}`);
    expect(anchor.title).to.equal("Invoice API: project scope & anchor");
  });

  it("each --repo takes part: an item in that repo, assigned to the invoker, on the board; the base branch is recorded", async () => {
    const { tracker, env } = world();
    const r = await createGovProject(env, { name: "Invoice API", repos: ["invoice-api", "acme/acme-gov"] });
    expect(r.ok, r.lines.join("\n")).to.equal(true);
    if (!r.ok) return;
    const items = await tracker.items(r.created.board!.ref);
    if (!items.ok) throw new Error(items.reason);
    const urls = items.value.map((i) => i.ref.url);
    expect(urls.some((u) => u.startsWith("memory://acme/invoice-api/issues/"))).to.equal(true);
    // The governance repo always takes part through the anchor — naming it again creates nothing more.
    expect(urls.filter((u) => u.startsWith("memory://acme/acme-gov/")).length).to.equal(1);
    expect(items.value.every((i) => i.assignees.includes("alice"))).to.equal(true);
    const anchor = items.value.find((i) => i.labels.includes("anchor"))!;
    expect(anchor.body).to.contain("Base branch: `dev`");
    expect(r.lines.join("\n")).to.contain("invoice-api");
  });

  it("the report names the board, the anchor and what to do next", async () => {
    const { env } = world();
    const r = await createGovProject(env, { name: "Invoice API", repos: [] });
    const text = r.lines.join("\n");
    expect(text).to.contain("memory://projects/acme#1");
    expect(text).to.contain("labelled anchor, assigned to alice");
    expect(text).to.contain("gov seed memory://projects/acme#1");
  });
});

/** The memory tracker, with one call made to fail — the "failure after create" world. */
function failing(t: MemoryWorkTracker, what: "anchor" | "anchor-on-board" | "repo-item" | "board-read"): WorkTrackerPort {
  return {
    ...t,
    async create(where, item, onto) {
      if (what === "anchor" && where.name === "acme-gov") return fail("HTTP 502 from the tracker", true);
      if (what === "repo-item" && where.name === "invoice-api") return fail("you cannot open issues in acme/invoice-api");
      return t.create(where, item, onto);
    },
    async addToProject(p, i) {
      if (what === "anchor-on-board" && i.url.includes("acme-gov")) return fail("the token lacks the project scope");
      return t.addToProject(p, i);
    },
    async project(p) {
      if (what === "board-read") return fail("HTTP 502 reading the board", true);
      return t.project(p);
    },
  };
}

describe("gov project — a failure after the board exists is reported, never silent", () => {
  it("the anchor could not be created → non-ok, and the report lists the board that exists and what is missing", async () => {
    const { tracker, env } = world();
    const r = await createGovProject({ ...env, tracker: failing(tracker, "anchor") }, { name: "Invoice API", repos: [] });
    expect(r.ok).to.equal(false);
    if (r.ok) return;
    expect(r.stage).to.equal("after-create");
    expect(r.created.board).to.not.equal(null);
    expect(r.created.anchor).to.equal(null);
    const text = r.lines.join("\n");
    expect(text).to.contain("What exists now");
    expect(text).to.contain("memory://projects/acme#1");
    expect(text).to.contain("HTTP 502 from the tracker");
    expect(text).to.contain("not created: the anchor issue");
    // Re-running would make a second board: the report says so.
    expect(text).to.contain("second board");
  });

  it("the anchor exists but could not join the board → both are listed, the anchor as NOT on the board", async () => {
    const { tracker, env } = world();
    const r = await createGovProject({ ...env, tracker: failing(tracker, "anchor-on-board") }, { name: "Invoice API", repos: [] });
    expect(r.ok).to.equal(false);
    if (r.ok) return;
    expect(r.created.anchor).to.not.equal(null);
    expect(r.created.anchorOnBoard).to.equal(false);
    const text = r.lines.join("\n");
    expect(text).to.contain(r.created.anchor!.url);
    expect(text).to.contain("NOT on the board");
    expect(text).to.contain("project scope");
  });

  it("a --repo item fails → the board and the anchor are listed as existing, the repo as not taking part", async () => {
    const { tracker, env } = world();
    const r = await createGovProject({ ...env, tracker: failing(tracker, "repo-item") }, { name: "Invoice API", repos: ["acme/invoice-api"] });
    expect(r.ok).to.equal(false);
    if (r.ok) return;
    const text = r.lines.join("\n");
    expect(text).to.contain("memory://projects/acme#1");
    expect(text).to.contain(r.created.anchor!.url);
    expect(text).to.contain("acme/invoice-api");
    expect(text).to.contain("you cannot open issues in acme/invoice-api");
  });

  it("the board cannot be read back → its number is still reported", async () => {
    const { tracker, env } = world();
    const r = await createGovProject({ ...env, tracker: failing(tracker, "board-read") }, { name: "Invoice API", repos: [] });
    expect(r.ok).to.equal(false);
    expect(r.lines.join("\n")).to.contain("acme#1");
  });
});

describe("gov project — the verb, and --seed", () => {
  const deps = (over: Partial<ProjectVerbDeps> & { tracker?: WorkTrackerPort; vcs?: VcsPort } = {}) => {
    const { env } = world();
    const printed: string[] = [];
    const seeded: string[] = [];
    const d: ProjectVerbDeps = {
      ...env,
      print: (l) => printed.push(l),
      seed: (url) => { seeded.push(url); return 0; },
      ...over,
    };
    return { d, printed, seeded };
  };

  it("no name → usage, exit 2, nothing created", async () => {
    const { d, seeded } = deps();
    const code = await projectCommand([], {}, d);
    expect(code).to.equal(2);
    expect(seeded).to.deep.equal([]);
  });

  it("--seed hands the new board's URL to gov seed, after the report", async () => {
    const { d, printed, seeded } = deps();
    const code = await projectCommand(["Invoice", "API"], { seed: true }, d);
    expect(code).to.equal(0);
    expect(seeded).to.deep.equal(["memory://projects/acme#1"]);
    expect(printed.join("\n")).to.contain("gov seed memory://projects/acme#1");
  });

  it("gov seed's exit code is the command's — and a failed seed says the project still exists", async () => {
    const { d, printed } = deps({ seed: () => 1 });
    const code = await projectCommand(["Invoice API"], { seed: true }, d);
    expect(code).to.equal(1);
    expect(printed.join("\n")).to.contain("board and its anchor exist");
  });

  it("without --seed, gov seed is not run", async () => {
    const { d, seeded } = deps();
    expect(await projectCommand(["Invoice API"], {}, d)).to.equal(0);
    expect(seeded).to.deep.equal([]);
  });

  it("--seed is NOT run after a partial result — the exit is non-zero", async () => {
    const { tracker, env } = world();
    const printed: string[] = [];
    const seeded: string[] = [];
    const code = await projectCommand(["Invoice API"], { seed: true }, {
      ...env, tracker: failing(tracker, "anchor"), print: (l) => printed.push(l), seed: (u) => { seeded.push(u); return 0; },
    });
    expect(code).to.equal(1);
    expect(seeded).to.deep.equal([]);
  });

  it("`gov project --seed <name>`: the word the parser gave --seed is the name, and seed still runs", async () => {
    const { d, seeded, printed } = deps();
    expect(await projectCommand([], { seed: "Invoice API" }, d)).to.equal(0);
    expect(printed.join("\n")).to.contain('Created project "Invoice API"');
    expect(seeded).to.have.length(1);
  });

  // LIVE (L09, run 38481578886): `gov project --seed` created the board and its anchor, and seed — a second later —
  // read "GitHub Project has no linked Issues or PRs": the board's item list is eventually consistent. --seed now
  // waits until the board lists the anchor before handing over, and says so if it never does.
  it("--seed waits until the board LISTS the new anchor (GitHub's index lags), then seeds", async () => {
    const { tracker, env } = world();
    let reads = 0;
    const lagging: WorkTrackerPort = { ...tracker, items: async (p) => (++reads < 3 ? { ok: true, value: [] } : tracker.items(p)) };
    const seeded: string[] = [];
    const naps: number[] = [];
    const code = await projectCommand(["Invoice API"], { seed: true }, {
      ...env, tracker: lagging, print: () => {}, seed: (u) => { seeded.push(u); return 0; }, sleep: async (ms) => { naps.push(ms); },
    });
    expect(code).to.equal(0);
    expect(reads).to.equal(3);
    expect(naps.length, "it waited between reads").to.equal(2);
    expect(seeded).to.have.length(1);
  });

  it("--seed does not hand over a board that never lists its anchor — it says why and what to run", async () => {
    const { tracker, env } = world();
    const printed: string[] = [];
    const seeded: string[] = [];
    const empty: WorkTrackerPort = { ...tracker, items: async () => ({ ok: true, value: [] }) };
    const code = await projectCommand(["Invoice API"], { seed: true }, {
      ...env, tracker: empty, print: (l) => printed.push(l), seed: (u) => { seeded.push(u); return 0; }, sleep: async () => {}, boardWaitMs: 10_000,
    });
    expect(code).to.equal(1);
    expect(seeded).to.deep.equal([]);
    expect(printed.join("\n")).to.match(/does not list its anchor yet/).and.match(/gov seed memory:\/\/projects\/acme#1/);
  });

  it("--repo takes a comma-separated list", async () => {
    const { env, tracker } = world();
    const code = await projectCommand(["Invoice API"], { repo: "invoice-api, acme/acme-gov" }, { ...env, print: () => {}, seed: () => 0 });
    expect(code).to.equal(0);
    const items = await tracker.items({ owner: "acme", number: 1 });
    expect(items.ok && items.value.length).to.equal(2);
  });
});
