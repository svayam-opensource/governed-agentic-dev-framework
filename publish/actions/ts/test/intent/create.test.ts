// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov intent <issue>…` (PRJ-121 intent 03, D3, rulings Q1/Q3/Q4): drafts `intents/<NN-slug>/intent.md` (DRAFT) with
 * the owner-interview questions the issues leave open, on a sub-branch of the project branch; creates the intent
 * tracking issue (Q4b) the change request traces to; opens that change request to the project branch. No adopted
 * lifecycle → it says so and does nothing.
 */
import { expect } from "chai";
import * as path from "node:path";
import { readFileSync } from "node:fs";
import {
  createIntent, nextIntentNumber, unansweredTopics, intentBranchFor, intentSlugFrom, INTERVIEW_TOPICS,
  type IntentCreateDeps, type IntentCreateInput,
} from "../../src/intent/create.js";
import { LIFECYCLE_POLICY_PATH, missingSections, statusOf } from "../../src/intent/lifecycle-policy.js";
import { createMemoryWorkTracker, type MemoryWorkTracker } from "../../src/adapters/memory/work-tracker.js";
import { createMemoryVcs, type MemoryVcs } from "../../src/adapters/memory/vcs.js";
import { parseArgv } from "../../src/cli/args.js";
import { routeAsync, type CliContext } from "../../src/cli/dispatch.js";
import { classifyPosture } from "../../src/config/governance.js";
import { DEFAULT_SELECTION } from "../../src/adapters/registry.js";
import { COMMAND_SPECS } from "../../src/cli/help-spec.js";
import type { OrgConfig } from "../../src/config/org-config.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import type { Vcs } from "../../src/lifecycle/vcs.js";
import { px } from "../helpers/paths.js";

const CONTENT = path.join(import.meta.dirname, "..", "..", "..", "..", "content");
const POLICY = readFileSync(path.join(CONTENT, LIFECYCLE_POLICY_PATH), "utf8");
const TEMPLATE_PATH = "policies/reference/lifecycles/ai-sdlc/intent.md";
const TEMPLATE = readFileSync(path.join(CONTENT, TEMPLATE_PATH), "utf8");

const ORG = "acme";
const WS = "acme-gov";
const HOME = "/w/PRJ-7-demo/acme-gov";
const PB = "BRNCH-7-demo";
const PRJ = "PRJ-7-demo";
const BOARD = { owner: ORG, number: 7 };

/**
 * An in-memory Fs rooted anywhere; paths are absolute, and keyed POSIX — gov hands it `path.join` paths, which are
 * `\w\PRJ-7-demo\…` on Windows, so every path crossing in is normalised (`px`).
 */
function memFs(files: Record<string, string>): Fs & { files: Record<string, string>; writes: string[] } {
  const writes: string[] = [];
  const self = {
    files, writes,
    pathExists: (p: string) => px(p) in files || Object.keys(files).some((f) => f.startsWith(`${px(p)}/`)),
    mkdirp: () => {},
    writeFile: (f: string, c: string) => { writes.push(px(f)); files[px(f)] = c; },
    readFile: (f: string) => (px(f) in files ? files[px(f)]! : null),
    rm: (t: string) => { for (const f of Object.keys(files)) if (f === px(t) || f.startsWith(`${px(t)}/`)) delete files[f]; },
    readdir: (d: string) => {
      const names = new Set<string>();
      for (const f of Object.keys(files)) if (f.startsWith(`${px(d)}/`)) names.add(f.slice(px(d).length + 1).split("/")[0]!);
      return [...names].sort();
    },
  };
  return self;
}

interface FakeGit extends Vcs { calls: string[]; branch: string; dirty: string[]; remoteBranches: string[] }

/** Local git, recorded. `hostBranches` is the memory host's branch table: a push makes the branch exist there. */
function fakeGit(hostBranches: Record<string, string>, opts: { branch?: string; dirty?: string[]; remoteBranches?: string[]; failPush?: boolean } = {}): FakeGit {
  const g = {
    calls: [] as string[],
    branch: opts.branch ?? PB,
    dirty: opts.dirty ?? [],
    remoteBranches: opts.remoteBranches ?? [],
    currentBranch: () => g.branch,
    isClean: () => g.dirty.length === 0,
    dirtyPaths: () => g.dirty,
    fetch: (_d: string, r: string, ref?: string) => { g.calls.push(`fetch ${r} ${ref ?? ""}`.trim()); },
    remoteBranchesMatching: (_d: string, _r: string, pattern: string) => {
      const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
      return g.remoteBranches.filter((b) => re.test(b));
    },
    localBranchExists: (_d: string, b: string) => b === PB || g.calls.includes(`checkoutNew ${b}`),
    refExists: (_d: string, ref: string) => ref === `refs/remotes/origin/${PB}`,
    revParse: () => "abc123",
    checkout: (_d: string, b: string) => { g.calls.push(`checkout ${b}`); g.branch = b; },
    checkoutNew: (_d: string, b: string, start?: string) => { g.calls.push(`checkoutNew ${b}${start ? ` ${start}` : ""}`); g.branch = b; },
    addPath: (_d: string, p: string) => { g.calls.push(`add ${p}`); },
    commit: (_d: string, m: string) => { g.calls.push(`commit ${m.split("\n")[0]}`); },
    push: (_d: string, r: string, b: string) => {
      if (opts.failPush) throw new Error("git push failed: denied");
      g.calls.push(`push ${r} ${b}`); hostBranches[b] = "def456";
    },
    pushDelete: (_d: string, _r: string, b: string) => { g.calls.push(`pushDelete ${b}`); },
    branchDelete: (_d: string, b: string) => { g.calls.push(`branchDelete ${b}`); },
  };
  return g as unknown as FakeGit;
}

const ISSUE_A_BODY = [
  "The picker pages unevenly.",
  "",
  "## Acceptance criteria",
  "Every page holds twenty rows.",
  "",
  "## Out of scope",
  "Search.",
].join("\n");

interface World {
  fs: ReturnType<typeof memFs>; git: FakeGit; tracker: MemoryWorkTracker; host: MemoryVcs; hostBranches: Record<string, string>;
  issueA: string; issueB: string; deps: IntentCreateDeps; input: IntentCreateInput;
}

async function world(o: { policy?: boolean; template?: boolean; files?: Record<string, string>; git?: Parameters<typeof fakeGit>[1]; slug?: string } = {}): Promise<World> {
  const files: Record<string, string> = { ...(o.files ?? {}) };
  if (o.policy !== false) files[`${HOME}/${LIFECYCLE_POLICY_PATH}`] = POLICY;
  if (o.template !== false) files[`${HOME}/${TEMPLATE_PATH}`] = TEMPLATE;
  const fs = memFs(files);
  const hostBranches: Record<string, string> = { main: "m1", [PB]: "p1" };
  const git = fakeGit(hostBranches, o.git);
  const tracker = createMemoryWorkTracker({ projects: [{ ref: BOARD, title: "Demo" }] });
  const host = createMemoryVcs({ repos: [{ repo: { owner: ORG, name: WS }, defaultBranch: "main", branches: hostBranches }] });
  const a = await tracker.create({ owner: ORG, name: "app" }, { title: "The picker paginates unevenly", body: ISSUE_A_BODY, assignee: "someone" });
  const b = await tracker.create({ owner: ORG, name: "app" }, { title: "Page size is not configurable", body: "Ten rows is too few.", assignee: "someone" });
  if (!a.ok || !b.ok) throw new Error("seed");
  const deps: IntentCreateDeps = { vcs: git, fs, tracker, host };
  const input: IntentCreateInput = {
    govClone: HOME, issueUrls: [a.value.url, b.value.url], assignee: "ada", githubOrg: ORG, workspaceRepo: WS, today: "2026-10-13",
    ...(o.slug ? { slug: o.slug } : {}),
  };
  return { fs, git, tracker, host, hostBranches, issueA: a.value.url, issueB: b.value.url, deps, input };
}

const intentFile = (id: string) => `${HOME}/projects/${PRJ}/intents/${id}/intent.md`;

describe("gov intent — drafting an intent from board issues (D3)", () => {
  it("writes intent.md — DRAFT, every §2.3 section, board items filled — on a sub-branch of the project branch", async () => {
    const w = await world();
    const r = await createIntent(w.deps, w.input);
    expect(r.code, r.lines.join("\n")).to.equal(0);

    const text = w.fs.files[intentFile("01-the-picker-paginates-unevenly")];
    expect(text, Object.keys(w.fs.files).join("\n")).to.be.a("string");
    expect(statusOf(text!)).to.deep.equal({ kind: "draft" });
    expect(missingSections("intent", text!)).to.deep.equal([]);
    expect(text).to.contain("# Intent 01: The picker paginates unevenly");
    expect(text).to.contain(`**Project:** ${PRJ}`);
    expect(text).to.contain(w.issueA).and.contain("The picker paginates unevenly");
    expect(text).to.contain(w.issueB).and.contain("Page size is not configurable");
    expect(text).to.not.contain("<issue link>");

    const branch = intentBranchFor(PB, "01");
    expect(branch).to.equal(`${PB}.INTENT-01-intent`);
    expect(w.git.calls).to.include(`checkoutNew ${branch} origin/${PB}`);
    expect(w.git.calls).to.include(`add projects/${PRJ}/intents/01-the-picker-paginates-unevenly`);
    expect(w.git.calls.some((c) => c.startsWith("commit intent 01:"))).to.equal(true);
    expect(w.git.calls).to.include(`push origin ${branch}`);
  });

  it("drafted by gov autorun: the commit carries its Gov-Autorun / Gov-Agent trailers (spec 03 §3.4)", async () => {
    const w = await world();
    let message = "";
    const deps = { ...w.deps, vcs: { ...w.git, commit: (_d: string, m: string) => { message = m; } } };
    const r = await createIntent(deps, { ...w.input, trailers: { runId: "ar-9", agent: "gov" } });
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(message).to.match(/^Gov-Intent: 01$/m).and.match(/^Gov-Autorun: ar-9$/m).and.match(/^Gov-Agent: gov$/m);
  });

  it("asks only what the issues do not answer — each question with a recommendation line", async () => {
    const w = await world();
    await createIntent(w.deps, w.input);
    const text = w.fs.files[intentFile("01-the-picker-paginates-unevenly")]!;
    const interview = text.slice(text.indexOf("## Interview decisions"), text.indexOf("## Out"));
    // Answered by issue A's headings: success measure (Acceptance criteria), scope (Out of scope).
    expect(interview).to.not.match(/Q\d+ — Success measure/);
    expect(interview).to.not.match(/Q\d+ — In\/out of scope/);
    expect(interview).to.contain("Success measure").and.contain("answered by");
    for (const t of ["Outcome", "Who benefits", "Priority", "Constraints", "Risks"]) expect(interview).to.match(new RegExp(`Q\\d+ — ${t}`));
    const questions = interview.match(/\*\*Q\d+ — /g) ?? [];
    const recs = interview.match(/^\s+Recommendation: /gm) ?? [];
    expect(questions.length).to.equal(5);
    expect(recs.length).to.equal(5);
    // What the record answered fills its section.
    expect(text.slice(text.indexOf("## Done when"))).to.contain("Every page holds twenty rows.");
    expect(text.slice(text.indexOf("## Out"), text.indexOf("## Done when"))).to.contain("Search.");
  });

  it("creates the intent tracking issue (Q4b): assigned to the invoker, labelled gov-intent:<NN>, on the board", async () => {
    const w = await world();
    const r = await createIntent(w.deps, w.input);
    expect(r.code, r.lines.join("\n")).to.equal(0);
    const tracking = await w.tracker.search({ labels: ["gov-intent:01"], repo: { owner: ORG, name: WS } });
    if (!tracking.ok) throw new Error(tracking.reason);
    expect(tracking.value).to.have.length(1);
    const t = tracking.value[0]!;
    expect(t.title).to.equal("Intent 01: The picker paginates unevenly");
    expect(t.assignees).to.deep.equal(["ada"]);
    expect(t.body).to.contain(w.issueA).and.contain(`projects/${PRJ}/intents/01-the-picker-paginates-unevenly/`);
    const onBoard = await w.tracker.items(BOARD);
    if (!onBoard.ok) throw new Error(onBoard.reason);
    expect(onBoard.value.map((i) => i.ref.url)).to.include(t.ref.url);
    // The source issues are tagged into the intent too.
    const a = await w.tracker.item({ url: w.issueA });
    expect(a.ok && a.value.labels).to.include("gov-intent:01");
    // The draft names its tracking issue.
    expect(w.fs.files[intentFile("01-the-picker-paginates-unevenly")]).to.contain(t.ref.url);
  });

  it("opens a change request to the project branch whose body traces to the tracking issue", async () => {
    const w = await world();
    const r = await createIntent(w.deps, w.input);
    expect(r.code, r.lines.join("\n")).to.equal(0);
    const cr = await w.host.changeRequest({ repo: { owner: ORG, name: WS }, number: 1 });
    if (!cr.ok) throw new Error(cr.reason);
    expect(cr.value.base).to.equal(PB);
    expect(cr.value.head).to.equal(`${PB}.INTENT-01-intent`);
    expect(cr.value.state).to.equal("open");
    const tracking = await w.tracker.search({ labels: ["gov-intent:01"], repo: { owner: ORG, name: WS } });
    const url = tracking.ok ? tracking.value[0]!.ref.url : "";
    // The memory host keeps no body; the tracking issue's comment carries the CR link, and the output both.
    expect(w.tracker.commentsOn({ url })).to.have.length(1);
    expect(w.tracker.commentsOn({ url })[0]).to.contain(cr.value.url);
    expect(r.lines.join("\n")).to.contain(cr.value.url).and.contain(url);
  });

  it("the CR body says Traces to: <tracking issue>", async () => {
    const w = await world();
    let body = "";
    const open = w.host.openChangeRequest.bind(w.host);
    w.deps = { ...w.deps, host: { ...w.host, openChangeRequest: async (cr) => { body = cr.body; return open(cr); } } };
    const r = await createIntent(w.deps, w.input);
    expect(r.code, r.lines.join("\n")).to.equal(0);
    const tracking = await w.tracker.search({ labels: ["gov-intent:01"], repo: { owner: ORG, name: WS } });
    const url = tracking.ok ? tracking.value[0]!.ref.url : "";
    expect(body).to.contain(`Traces to: ${url}`);
    expect(body).to.contain(w.issueA).and.contain("DRAFT");
  });

  it("refuses with no active lifecycle — says so and does nothing", async () => {
    const w = await world({ policy: false });
    const r = await createIntent(w.deps, w.input);
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.contain(LIFECYCLE_POLICY_PATH).and.match(/no lifecycle/i);
    expect(w.fs.writes).to.deep.equal([]);
    expect(w.git.calls.filter((c) => !c.startsWith("fetch"))).to.deep.equal([]);
    const made = await w.tracker.search({ repo: { owner: ORG, name: WS } });
    expect(made.ok && made.value).to.deep.equal([]);
  });

  it("refuses when the lifecycle's intent template is missing — nothing created", async () => {
    const w = await world({ template: false });
    const r = await createIntent(w.deps, w.input);
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.contain(TEMPLATE_PATH);
    expect(w.fs.writes).to.deep.equal([]);
  });

  it("numbers the intent: the next free two digits under intents/, skipping one in flight on a branch", async () => {
    const files = {
      [`${HOME}/projects/${PRJ}/intents/01-first/intent.md`]: "x",
      [`${HOME}/projects/${PRJ}/intents/03-third/intent.md`]: "x",
    };
    const w = await world({ files, slug: "paging", git: { remoteBranches: [`${PB}.INTENT-04-intent`] } });
    const r = await createIntent(w.deps, w.input);
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(w.fs.files[intentFile("05-paging")]).to.contain("# Intent 05:");
  });

  it("nextIntentNumber: max of folders and in-flight branches, plus one; none → 01; full → null", () => {
    expect(nextIntentNumber([], [])).to.equal("01");
    expect(nextIntentNumber(["01-a", "02-b", "notes.md", "xx-c"], [])).to.equal("03");
    expect(nextIntentNumber(["01-a"], ["07"])).to.equal("08");
    expect(nextIntentNumber(["99-z"], [])).to.equal(null);
  });

  it("refuses a closed issue, an unreadable one, a bad --slug, a dirty tree, and a non-project branch — nothing created", async () => {
    const closed = await world();
    closed.tracker.closeItem({ url: closed.issueB });
    expect((await createIntent(closed.deps, closed.input)).lines.join("\n")).to.contain("closed");

    const missing = await world();
    const r2 = await createIntent(missing.deps, { ...missing.input, issueUrls: ["memory://acme/app/issues/99"] });
    expect(r2.code).to.equal(1);

    const badSlug = await world({ slug: "Not A Slug" });
    expect((await createIntent(badSlug.deps, badSlug.input)).lines.join("\n")).to.contain("--slug");

    const dirty = await world({ git: { dirty: ["knowledge/todo.md"] } });
    expect((await createIntent(dirty.deps, dirty.input)).lines.join("\n")).to.contain("Uncommitted changes");

    const off = await world({ git: { branch: "main" } });
    expect((await createIntent(off.deps, off.input)).lines.join("\n")).to.contain("not a project branch");

    for (const w of [closed, missing, badSlug, dirty, off]) {
      expect(w.fs.writes).to.deep.equal([]);
      const made = await w.tracker.search({ repo: { owner: ORG, name: WS } });
      expect(made.ok && made.value).to.deep.equal([]);
    }
  });

  it("a failed push rolls the branch back and says the tracking issue exists", async () => {
    const w = await world({ git: { failPush: true } });
    const r = await createIntent(w.deps, w.input);
    expect(r.code).to.equal(1);
    const out = r.lines.join("\n");
    expect(out).to.contain("denied").and.match(/tracking issue .*exists/);
    expect(w.git.calls).to.include(`checkout ${PB}`);
    expect(w.git.calls).to.include(`branchDelete ${PB}.INTENT-01-intent`);
  });

  it("from an intent or task sub-branch, the project branch is still the base", async () => {
    const w = await world({ git: { branch: `${PB}.INTENT-02-intent` } });
    const r = await createIntent(w.deps, w.input);
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(w.git.calls).to.include(`checkoutNew ${PB}.INTENT-01-intent origin/${PB}`);
  });
});

describe("gov intent — the pure parts", () => {
  it("unansweredTopics: a heading, a bold label or a 'Label:' line answers its topic; a placeholder does not", () => {
    const left = unansweredTopics([
      { url: "u1", title: "t", body: "## Goal\nFaster paging.\n\n**Priority:** high\n" },
      { url: "u2", title: "t", body: "Risks: none known\n\n## Constraints\n<TBD>\n" },
    ]).map((t) => t.id);
    expect(left).to.not.include("outcome").and.not.include("priority").and.not.include("risks");
    expect(left).to.include("constraints").and.include("who").and.include("success").and.include("scope");
    expect(INTERVIEW_TOPICS.map((t) => t.id)).to.deep.equal(["outcome", "who", "priority", "success", "scope", "constraints", "risks"]);
  });

  it("intentSlugFrom: lowercase words joined by dashes, at most five", () => {
    expect(intentSlugFrom("The Picker: paginates unevenly!")).to.equal("the-picker-paginates-unevenly");
    expect(intentSlugFrom("one two three four five six seven")).to.equal("one-two-three-four-five");
    expect(intentSlugFrom("!!!")).to.equal("");
  });
});

// ── dispatch ────────────────────────────────────────────────────────────────────────────────────────────────

const CONFIG = {
  orgName: "A", orgShortName: "A", orgSlug: "ACME", orgSlugLower: "acme",
  githubOrg: ORG, workspaceRepo: WS, orgRepoUrl: `git@github.com:${ORG}/${WS}.git`,
  defaultBranch: "main", defaultCodeBranch: "dev", agentWorkRoot: "/w", govWorkspace: "/gov", policyOwnerEmail: "a@x",
  orgTokens: {}, governancePosture: classifyPosture(""), adapters: DEFAULT_SELECTION,
} as unknown as OrgConfig;

describe("gov intent — dispatch (help-spec, routeAsync)", () => {
  it("is in the command reference", () => {
    const spec = COMMAND_SPECS.find((s) => s.name === "intent");
    expect(spec, "help-spec entry").to.not.equal(undefined);
    expect(spec!.usage).to.contain("--slug");
  });

  it("`gov intent <url> <url>` runs through the ports and exits 0", async () => {
    const w = await world();
    const ctx = {
      config: CONFIG, home: HOME, today: "2026-10-13", seededBy: "ada", login: "ada",
      vcs: w.git, fs: w.fs, issues: {}, authorize: () => true, gate: () => ({ ok: true, failures: [] }),
      tracker: () => w.tracker, vcsHost: () => w.host,
    } as unknown as CliContext;
    const r = await routeAsync(parseArgv(["intent", w.issueA, w.issueB, "--slug", "paging"]) as never, ctx);
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(w.fs.files[intentFile("01-paging")]).to.contain("**Status:** DRAFT");
  });

  it("not authorized on the board → refused before anything is created", async () => {
    const w = await world();
    const ctx = {
      config: CONFIG, home: HOME, today: "2026-10-13", seededBy: "ada", login: "ada",
      vcs: w.git, fs: w.fs, issues: {}, authorize: () => false, gate: () => ({ ok: true, failures: [] }),
      tracker: () => w.tracker, vcsHost: () => w.host,
    } as unknown as CliContext;
    const r = await routeAsync(parseArgv(["intent", w.issueA]) as never, ctx);
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.match(/Not authorized/);
    expect(w.fs.writes).to.deep.equal([]);
  });

  it("no ports wired → refused, never a silent skip", async () => {
    const w = await world();
    const ctx = {
      config: CONFIG, home: HOME, today: "2026-10-13", seededBy: "ada", login: "ada",
      vcs: w.git, fs: w.fs, issues: {}, authorize: () => true, gate: () => ({ ok: true, failures: [] }),
    } as unknown as CliContext;
    const r = await routeAsync(parseArgv(["intent", w.issueA]) as never, ctx);
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.match(/work tracker|code host/);
  });
});
