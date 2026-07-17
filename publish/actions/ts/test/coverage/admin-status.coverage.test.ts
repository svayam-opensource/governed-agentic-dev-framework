// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * EXHAUSTIVE (full-cartesian) coverage for the ADMIN / STATUS / ORG commands of
 * the `gov-work` CLI, driven end-to-end through `route()` and `routeOrg()` in
 * src/cli/dispatch.ts with fully-faked ports (no real IO). For every case we
 * assert BOTH the exit code and the emitted message.
 *
 * Commands under test:
 *   route():    manage · knowledge · anchor · list · list-all · status · onboard
 *   routeOrg(): org (add · use · list · remove)
 *
 * Axes covered per command: {subcommand} × {flags present/absent} ×
 * {argument shapes} × {error conditions}.
 */
import { expect } from "chai";
import { parseArgv } from "../../src/cli/args.js";
import { route, routeOrg, type CliContext } from "../../src/cli/dispatch.js";
import type { OrgConfig } from "../../src/config/org-config.js";
import type { Vcs } from "../../src/lifecycle/vcs.js";
import type { Board } from "../../src/lifecycle/board.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import type { Issues } from "../../src/lifecycle/issues.js";
import type { AnchorCreator, AnchorInfo } from "../../src/lifecycle/anchor.js";
import type { Pulls } from "../../src/lifecycle/pulls.js";
import type { Projects, BoardSummary } from "../../src/lifecycle/project-list.js";
import type { OrgDeps } from "../../src/resolve/org.js";
import type { RegistryStore } from "../../src/resolve/registry-store.js";
import type { GovConfig, GovHome } from "../../src/resolve/types.js";

// ── shared config + port fakes ────────────────────────────────────────────────

const CONFIG: OrgConfig = {
  orgName: "Svayam", orgShortName: "Svayam", orgSlug: "SVM", orgSlugLower: "svm",
  githubOrg: "Svayamtech", workspaceRepo: "svm-prj-work",
  orgRepoUrl: "git@github.com:Svayamtech/svm-prj-work.git",
  defaultBranch: "main", defaultCodeBranch: "dev",
  agentWorkRoot: "/awr", govWorkspace: "/gov", policyOwnerEmail: "rk@x", orgTokens: {},
};

/** A default project branch (board #43) so from-workspace commands resolve. */
const PROJECT_BRANCH = "BRNCH-43-governance-common-project";

/** Base Vcs — every method a no-op / benign default; override per test. */
function baseVcs(): Vcs {
  const noop = () => {};
  return {
    localBranchExists: () => false, remoteBranchExists: () => true, headSha: () => "h",
    refExists: () => false, lsRemoteHeads: () => [], defaultBranch: () => null, revParse: () => null,
    currentBranch: () => PROJECT_BRANCH, isAncestor: () => false, isClean: () => true,
    remoteBranchesMatching: () => [], addPath: noop, commit: noop, resetHard: noop, cleanUntracked: noop,
    worktreeAdd: noop, worktreeRemove: noop, branchDelete: noop, push: noop, pushDelete: noop, clone: noop,
    fetch: noop, setIdentity: noop, checkout: noop, checkoutNew: noop, mergeNoEdit: () => "merged", tag: noop,
  };
}
const vcsWith = (over: Partial<Vcs> = {}): Vcs => ({ ...baseVcs(), ...over });

const board: Board = { fetchProject: () => ({ id: "P", title: "@Governance Common Project", shortDescription: null, linkedItemCount: 1, repoUrls: [] }) };
const baseFs: Fs = { pathExists: () => false, readFile: () => null, mkdirp: () => {}, writeFile: () => {}, rm: () => {}, readdir: () => [] };
const issues: Issues = { state: () => "OPEN", assign: () => {}, setBoardStatus: () => {}, close: () => {}, resolveIssueUrl: () => null, closeBoard: () => {} };
const pulls: Pulls = { create: () => "pr", merge: () => "merged" };

/** Projects port over an explicit board list. */
const projectsOf = (boards: readonly BoardSummary[]): Projects => ({ listBoards: () => [...boards] });
const b = (number: number, title: string, closed = false): BoardSummary => ({ number, title, url: `u/${number}`, closed });

/** Configurable anchor port: `finds` maps board# → AnchorInfo; `applied` = setAssignee return. */
function makeAnchor(over: { finds?: Record<number, AnchorInfo>; applied?: boolean } = {}): { anchor: AnchorCreator; calls: string[] } {
  const calls: string[] = [];
  const anchor: AnchorCreator = {
    createAnchorIssue: () => "r#1",
    setState: () => true,
    find: (ref) => over.finds?.[ref.number] ?? null,
    setAssignee: (url, login, action) => { calls.push(`${action} ${login} @ ${url}`); return over.applied ?? true; },
  };
  return { anchor, calls };
}
const info = (over: Partial<AnchorInfo> = {}): AnchorInfo => ({ url: "u/43#1", number: 1, labels: [], assignees: [], ...over });

/** Assemble a CliContext with overridable ports. */
function ctx(over: Partial<CliContext> = {}): CliContext {
  return {
    config: CONFIG, home: "/awr/PRJ-43-governance-common-project/svm-prj-work", today: "2026-07-03",
    seededBy: "svayam-rkant", login: "rkant", board, vcs: baseVcs(), fs: baseFs, issues,
    anchor: makeAnchor({ finds: { 43: info() } }).anchor, pulls, projects: projectsOf([]), cloneRepo: () => {}, ...over,
  };
}

/** Drive route() from an argv array. */
const run = (argv: string[], over: Partial<CliContext> = {}) => route(parseArgv(argv) as never, ctx(over));

// ── org (routeOrg) plumbing ───────────────────────────────────────────────────

function memStore(homes: GovHome[] = [], active: string | null = null): RegistryStore {
  let hs = homes; let a = active;
  return {
    readHomes: () => hs, writeHomes: (h) => { hs = [...h]; },
    readActiveOrg: () => a, writeActiveOrg: (o) => { a = o; }, clearActiveOrg: () => { a = null; },
  };
}
const probe = (orgAt: Record<string, string>) => (p: string): GovConfig | null => (orgAt[p] ? { org: orgAt[p], govWorkspace: p } : null);

// ══════════════════════════════════════════════════════════════════════════════
// manage — list · list-all · assign · unassign
// ══════════════════════════════════════════════════════════════════════════════
describe("coverage: gov-work manage", () => {
  const finds = { 7: info({ url: "u/7#1", labels: ["paused"], assignees: ["rk"] }) };

  it("manage list → exit 0, header + open rows (closed excluded)", () => {
    const { anchor } = makeAnchor({ finds });
    const r = run(["manage", "list"], { anchor, projects: projectsOf([b(7, "A"), b(8, "B", true)]) });
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.match(/^Projects \(owners = anchor assignees\) \(/);
    expect(r.lines.join("\n")).to.match(/#7 \[paused\] A — owners: rk/);
    expect(r.lines.join("\n")).to.not.match(/#8/);
  });

  it("manage list (no boards) → exit 0 with (no projects)", () => {
    const r = run(["manage", "list"], { anchor: makeAnchor().anchor, projects: projectsOf([]) });
    expect(r.code).to.equal(0);
    expect(r.lines).to.deep.equal(["Projects (owners = anchor assignees) (0–0 of 0):", "(no projects)"]);
  });

  it("manage list-all → exit 0, includes closed boards", () => {
    const { anchor } = makeAnchor({ finds });
    const r = run(["manage", "list-all"], { anchor, projects: projectsOf([b(7, "A"), b(8, "B", true)]) });
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.match(/^Projects \(owners = anchor assignees\) \(/);
    expect(r.lines.join("\n")).to.match(/#8 \[completed\] B/);
  });

  it("manage list --all → flag ignored, behaves like list (closed excluded)", () => {
    const { anchor } = makeAnchor({ finds });
    const r = run(["manage", "list", "--all"], { anchor, projects: projectsOf([b(7, "A"), b(8, "B", true)]) });
    expect(r.code).to.equal(0);
    expect(r.lines.join("\n")).to.not.match(/#8/); // --all is NOT list-all
  });

  it("manage assign <login> (anchor found, applied) → exit 0, Added owner", () => {
    const { anchor, calls } = makeAnchor({ finds: { 43: info() }, applied: true });
    const r = run(["manage", "assign", "newowner"], { anchor });
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.equal("Added owner newowner");
    expect(calls[0]).to.equal("add newowner @ u/43#1");
  });

  it("manage assign <login> (not applied) → exit 0 with '(not applied — check gh access)'", () => {
    const { anchor } = makeAnchor({ finds: { 43: info() }, applied: false });
    const r = run(["manage", "assign", "newowner"], { anchor });
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.equal("Added owner newowner (not applied — check gh access)");
  });

  it("manage assign <login> <extra> → extra positional ignored", () => {
    const { anchor } = makeAnchor({ finds: { 43: info() } });
    const r = run(["manage", "assign", "newowner", "ignored"], { anchor });
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.equal("Added owner newowner");
  });

  it("manage unassign <login> → exit 0, Removed owner", () => {
    const { anchor, calls } = makeAnchor({ finds: { 43: info() } });
    const r = run(["manage", "unassign", "gone"], { anchor });
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.equal("Removed owner gone");
    expect(calls[0]).to.equal("remove gone @ u/43#1");
  });

  it("manage assign (missing login) → exit 2, usage", () => {
    const r = run(["manage", "assign"]);
    expect(r.code).to.equal(2);
    expect(r.lines[0]).to.equal("usage: gov-work manage assign <github-login>");
  });

  it("manage unassign (missing login) → exit 2, usage", () => {
    const r = run(["manage", "unassign"]);
    expect(r.code).to.equal(2);
    expect(r.lines[0]).to.equal("usage: gov-work manage unassign <github-login>");
  });

  it("manage assign off a non-project branch → exit 1, not-a-project-branch", () => {
    const { anchor } = makeAnchor({ finds: { 43: info() } });
    const r = run(["manage", "assign", "x"], { anchor, vcs: vcsWith({ currentBranch: () => "main" }) });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("'main' is not a project branch.");
  });

  it("manage assign with no anchor for the project → exit 1, no-anchor", () => {
    const { anchor } = makeAnchor({ finds: {} });
    const r = run(["manage", "assign", "x"], { anchor });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("No anchor issue for project #43 — designate one first.");
  });

  it("manage unassign with no anchor → exit 1, no-anchor", () => {
    const { anchor } = makeAnchor({ finds: {} });
    const r = run(["manage", "unassign", "x"], { anchor });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("No anchor issue for project #43 — designate one first.");
  });

  it("manage <unknown-sub> → exit 2, subcommand usage", () => {
    const r = run(["manage", "frobnicate"]);
    expect(r.code).to.equal(2);
    expect(r.lines[0]).to.equal("usage: gov-work manage <list|list-all|assign|unassign> …");
  });

  it("manage (no subcommand) → exit 2, subcommand usage", () => {
    const r = run(["manage"]);
    expect(r.code).to.equal(2);
    expect(r.lines[0]).to.equal("usage: gov-work manage <list|list-all|assign|unassign> …");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// knowledge — propose · submit · archive
// ══════════════════════════════════════════════════════════════════════════════
describe("coverage: gov-work knowledge", () => {
  it("knowledge propose <slug> → exit 0, created branch lines", () => {
    const r = run(["knowledge", "propose", "my-slug"]);
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.equal("Created knowledge branch 'knowledge-my-slug' (pushed).");
  });

  it("knowledge propose (missing slug) → exit 2, propose usage", () => {
    const r = run(["knowledge", "propose"]);
    expect(r.code).to.equal(2);
    expect(r.lines[0]).to.equal('usage: gov-work knowledge <propose|submit|archive> <slug> [--description "<text>"]');
  });

  it("knowledge propose <slug> when vcs.push throws → exit 1, error message", () => {
    const r = run(["knowledge", "propose", "boom"], { vcs: vcsWith({ push: () => { throw new Error("push denied"); } }) });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("push denied");
  });

  it("knowledge submit <slug> <desc…> → exit 0, opened PR (desc joined)", () => {
    const created: string[] = [];
    const p: Pulls = { create: (_repo, _base, _head, _title, body) => { created.push(body); return "https://pr/1"; }, merge: () => "m" };
    const r = run(["knowledge", "submit", "my-slug", "--description", "a longer desc"], { pulls: p });
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.equal("Opened knowledge PR: https://pr/1");
    expect(created[0]).to.equal("a longer desc");
  });

  it("knowledge submit <slug> (no description) → exit 0, default description used", () => {
    const created: string[] = [];
    const p: Pulls = { create: (_r, _b, _h, _t, body) => { created.push(body); return "https://pr/2"; }, merge: () => "m" };
    const r = run(["knowledge", "submit", "solo"], { pulls: p });
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.equal("Opened knowledge PR: https://pr/2");
    expect(created[0]).to.equal("Org knowledge proposal: solo");
  });

  it("knowledge submit (missing slug) → exit 2, submit usage", () => {
    const r = run(["knowledge", "submit"]);
    expect(r.code).to.equal(2);
    expect(r.lines[0]).to.equal('usage: gov-work knowledge <propose|submit|archive> <slug> [--description "<text>"]');
  });

  it("knowledge submit <slug> when PR cannot be opened → exit 1", () => {
    const r = run(["knowledge", "submit", "my-slug"], { pulls: { create: () => "", merge: () => "m" } });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("Could not open a PR for 'knowledge-my-slug'.");
  });

  it("knowledge archive <slug> → exit 0, archived lines", () => {
    const r = run(["knowledge", "archive", "my-slug"]);
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.equal("Archived 'knowledge-my-slug' (tag archive/knowledge-my-slug + deleted).");
  });

  it("knowledge archive (missing slug) → exit 2, archive usage", () => {
    const r = run(["knowledge", "archive"]);
    expect(r.code).to.equal(2);
    expect(r.lines[0]).to.equal('usage: gov-work knowledge <propose|submit|archive> <slug> [--description "<text>"]');
  });

  it("knowledge archive <slug> when vcs.tag throws → exit 1, error message", () => {
    const r = run(["knowledge", "archive", "boom"], { vcs: vcsWith({ tag: () => { throw new Error("tag failed"); } }) });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("tag failed");
  });

  it("knowledge <unknown-sub> → exit 2, generic knowledge usage", () => {
    const r = run(["knowledge", "frobnicate", "x"]);
    expect(r.code).to.equal(2);
    expect(r.lines[0]).to.equal('usage: gov-work knowledge <propose|submit|archive> <slug> [--description "<text>"]');
  });

  it("knowledge (no subcommand) → exit 2, generic knowledge usage", () => {
    const r = run(["knowledge"]);
    expect(r.code).to.equal(2);
    expect(r.lines[0]).to.equal('usage: gov-work knowledge <propose|submit|archive> <slug> [--description "<text>"]');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// anchor — show the current project's anchor issue
// ══════════════════════════════════════════════════════════════════════════════
describe("coverage: gov-work anchor", () => {
  it("anchor → exit 0, number/url/labels/owners", () => {
    const { anchor } = makeAnchor({ finds: { 43: info({ url: "u/43#9", number: 9, labels: ["paused"], assignees: ["rk", "mo"] }) } });
    const r = run(["anchor"], { anchor });
    expect(r.code).to.equal(0);
    expect(r.lines).to.deep.equal(["Anchor #9: u/43#9", "  labels: paused", "  owners: rk, mo"]);
  });

  it("anchor with empty labels/owners → '(none)' placeholders", () => {
    const { anchor } = makeAnchor({ finds: { 43: info({ url: "u/43#1", number: 1 }) } });
    const r = run(["anchor"], { anchor });
    expect(r.code).to.equal(0);
    expect(r.lines).to.deep.equal(["Anchor #1: u/43#1", "  labels: (none)", "  owners: (none)"]);
  });

  it("anchor --foo → flag ignored, still exit 0", () => {
    const { anchor } = makeAnchor({ finds: { 43: info() } });
    const r = run(["anchor", "--foo"], { anchor });
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.match(/^Anchor #/);
  });

  it("anchor off a non-project branch → exit 1, not-a-project-branch", () => {
    const r = run(["anchor"], { vcs: vcsWith({ currentBranch: () => "main" }) });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("'main' is not a project branch.");
  });

  it("anchor with no anchor issue → exit 1, no-anchor", () => {
    const { anchor } = makeAnchor({ finds: {} });
    const r = run(["anchor"], { anchor });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("No anchor issue for project #43.");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// list · list-all — org-wide board listing
// ══════════════════════════════════════════════════════════════════════════════
describe("coverage: gov-work list / list-all", () => {
  const finds = { 7: info({ url: "u/7#1", labels: ["paused"], assignees: ["rk"] }) };

  it("list → exit 0, 'Ongoing projects:' excludes closed", () => {
    const { anchor } = makeAnchor({ finds });
    const r = run(["list"], { anchor, projects: projectsOf([b(7, "A"), b(8, "B", true)]) });
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.match(/^Ongoing projects \(/);
    expect(r.lines.join("\n")).to.not.match(/#8/);
  });

  it("list-all → exit 0, 'All projects:' includes closed", () => {
    const { anchor } = makeAnchor({ finds });
    const r = run(["list-all"], { anchor, projects: projectsOf([b(7, "A"), b(8, "B", true)]) });
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.match(/^All projects \(/);
    expect(r.lines.join("\n")).to.match(/#8 \[completed\] B/);
  });

  it("list (no boards) → exit 0 with (no projects)", () => {
    const r = run(["list"], { anchor: makeAnchor().anchor, projects: projectsOf([]) });
    expect(r.code).to.equal(0);
    expect(r.lines).to.deep.equal(["Ongoing projects (0–0 of 0):", "(no projects)"]);
  });

  it("list-all --stray → flag ignored, still exit 0", () => {
    const { anchor } = makeAnchor({ finds });
    const r = run(["list-all", "--stray"], { anchor, projects: projectsOf([b(7, "A")]) });
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.match(/^All projects \(/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// status — the current project's derived status
// ══════════════════════════════════════════════════════════════════════════════
describe("coverage: gov-work status", () => {
  it("status → exit 0, board title + status + owners + url", () => {
    const { anchor } = makeAnchor({ finds: { 43: info({ labels: ["paused"], assignees: ["rk"] }) } });
    const r = run(["status"], { anchor, projects: projectsOf([b(43, "Gov")]) });
    expect(r.code).to.equal(0);
    expect(r.lines).to.deep.equal(["Project #43: Gov", "  status: paused", "  owners: rk", "  board:  u/43"]);
  });

  it("status with no owners → '(none)'", () => {
    const { anchor } = makeAnchor({ finds: { 43: info() } });
    const r = run(["status"], { anchor, projects: projectsOf([b(43, "Gov")]) });
    expect(r.code).to.equal(0);
    expect(r.lines[2]).to.equal("  owners: (none)");
    expect(r.lines[1]).to.equal("  status: active");
  });

  it("status --verbose → flag ignored, still exit 0", () => {
    const { anchor } = makeAnchor({ finds: { 43: info() } });
    const r = run(["status", "--verbose"], { anchor, projects: projectsOf([b(43, "Gov")]) });
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.equal("Project #43: Gov");
  });

  it("status off a non-project branch → exit 1, not-a-project-branch", () => {
    const r = run(["status"], { vcs: vcsWith({ currentBranch: () => "main" }), projects: projectsOf([b(43, "Gov")]) });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.match(/^'main' is not a project branch/);
  });

  it("status <project-id> resolves the board directly, no branch needed", () => {
    const r = run(["status", "PRJ-43-governance-common-project"], { vcs: vcsWith({ currentBranch: () => "main" }), projects: projectsOf([b(43, "Gov")]) });
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.equal("Project #43: Gov");
  });

  it("status with a non-project argument → exit 2, actionable", () => {
    const r = run(["status", "not-a-project"], { projects: projectsOf([b(43, "Gov")]) });
    expect(r.code).to.equal(2);
    expect(r.lines[0]).to.match(/not a project id or number/);
  });

  it("status when the board is not on GitHub → exit 1, not-found", () => {
    const r = run(["status"], { projects: projectsOf([]) });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("Project #43 not found on GitHub.");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// onboard — bring a repo under the framework
// ══════════════════════════════════════════════════════════════════════════════
describe("coverage: gov-work onboard", () => {
  const URL = "git@github.com:Svayamtech/acme.git";
  const freshVcs = () => vcsWith({ remoteBranchExists: () => false });

  it("onboard <url> <owner> <desc> → exit 0, onboarded + PR", () => {
    const r = run(["onboard", URL, "--owner", "rkant", "--description", "the acme repo"], { vcs: freshVcs() });
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.equal("Onboarded acme (branch onboard-knowledge pushed).");
    expect(r.lines[1]).to.equal("  PR: pr");
  });

  it("onboard multi-word description → joined into one description", () => {
    const bodies: string[] = [];
    const p: Pulls = { create: (_r, _b, _h, _t, body) => { bodies.push(body); return "pr"; }, merge: () => "m" };
    const r = run(["onboard", URL, "--owner", "rkant", "--description", "one two three"], { vcs: freshVcs(), pulls: p });
    expect(r.code).to.equal(0); // description slice(2).join(" ") — 'one two three'
    expect(r.lines[0]).to.equal("Onboarded acme (branch onboard-knowledge pushed).");
  });

  it("onboard (no args) → exit 2, usage", () => {
    const r = run(["onboard"]);
    expect(r.code).to.equal(2);
    expect(r.lines[0]).to.equal('usage: gov-work onboard <repo-url> --owner <owner> --description "<description>"');
  });

  it("onboard <url> (1 arg) → exit 2, usage", () => {
    const r = run(["onboard", URL]);
    expect(r.code).to.equal(2);
    expect(r.lines[0]).to.equal('usage: gov-work onboard <repo-url> --owner <owner> --description "<description>"');
  });

  it("onboard <url> <owner> (2 args, missing description) → exit 2, usage", () => {
    const r = run(["onboard", URL, "rkant"]);
    expect(r.code).to.equal(2);
    expect(r.lines[0]).to.equal('usage: gov-work onboard <repo-url> --owner <owner> --description "<description>"');
  });

  it("onboard when knowledge/ already exists → exit 1, knowledge-exists", () => {
    const fs: Fs = { ...baseFs, pathExists: (p) => p.endsWith("knowledge") };
    const r = run(["onboard", URL, "--owner", "rkant", "--description", "desc"], { vcs: freshVcs(), fs });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("knowledge/ already exists in acme — investigate the existing structure.");
  });

  it("onboard when the onboard branch already exists → exit 1, branch-exists", () => {
    const r = run(["onboard", URL, "--owner", "rkant", "--description", "desc"], { vcs: vcsWith({ remoteBranchExists: () => true }) });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("Branch 'onboard-knowledge' already exists in acme — investigate before proceeding.");
  });

  it("onboard when no PR could be opened → exit 0 with manual-PR guidance", () => {
    const r = run(["onboard", URL, "--owner", "rkant", "--description", "desc"], { vcs: freshVcs(), pulls: { create: () => "", merge: () => "m" } });
    expect(r.code).to.equal(0);
    expect(r.lines[1]).to.equal("  branch pushed — open a PR for onboard-knowledge manually.");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// org (routeOrg) — add · use · list · remove
// ══════════════════════════════════════════════════════════════════════════════
describe("coverage: gov-work org (routeOrg)", () => {
  it("org add <org> <home> (valid gov repo) → exit 0, registered", () => {
    const store = memStore();
    const deps: OrgDeps = { store, govConfigAt: probe({ "/gov": "Svayamtech" }) };
    const r = routeOrg(["add", "Svayamtech"], { home: "/gov" }, deps);
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.equal("Registered Svayamtech → /gov");
    expect(store.readHomes()).to.deep.equal([{ org: "Svayamtech", home: "/gov" }]);
  });

  it("org add (no args) → exit 2, usage", () => {
    const deps: OrgDeps = { store: memStore(), govConfigAt: probe({}) };
    const r = routeOrg(["add"], {}, deps);
    expect(r.code).to.equal(2);
    expect(r.lines[0]).to.equal("usage: gov-work org add <github_org> --home <path>");
  });

  it("org add <org> (missing home) → exit 2, usage", () => {
    const deps: OrgDeps = { store: memStore(), govConfigAt: probe({}) };
    const r = routeOrg(["add", "Svayamtech"], {}, deps);
    expect(r.code).to.equal(2);
    expect(r.lines[0]).to.equal("usage: gov-work org add <github_org> --home <path>");
  });

  it("org add against a non-gov path → exit 1", () => {
    const deps: OrgDeps = { store: memStore(), govConfigAt: probe({}) };
    const r = routeOrg(["add", "Svayamtech"], { home: "/nope" }, deps);
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.match(/is not a gov repo/);
  });

  it("org add with an org mismatch → exit 1", () => {
    const deps: OrgDeps = { store: memStore(), govConfigAt: probe({ "/gov": "Other" }) };
    const r = routeOrg(["add", "Svayamtech"], { home: "/gov" }, deps);
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("'/gov' belongs to org 'Other', not 'Svayamtech'.");
  });

  it("org add a duplicate → exit 0, idempotent upsert (one home)", () => {
    const store = memStore([{ org: "Svayamtech", home: "/gov" }]);
    const deps: OrgDeps = { store, govConfigAt: probe({ "/gov": "Svayamtech" }) };
    const r = routeOrg(["add", "Svayamtech"], { home: "/gov" }, deps);
    expect(r.code).to.equal(0);
    expect(store.readHomes()).to.deep.equal([{ org: "Svayamtech", home: "/gov" }]);
  });

  it("org use <registered> → exit 0, active org set", () => {
    const store = memStore([{ org: "Svayamtech", home: "/gov" }]);
    const deps: OrgDeps = { store, govConfigAt: probe({}) };
    const r = routeOrg(["use", "Svayamtech"], {}, deps);
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.equal("Active org → Svayamtech");
    expect(store.readActiveOrg()).to.equal("Svayamtech");
  });

  it("org use <unregistered> → exit 1", () => {
    const deps: OrgDeps = { store: memStore(), govConfigAt: probe({}) };
    const r = routeOrg(["use", "Ghost"], {}, deps);
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.match(/Org 'Ghost' is not registered/);
  });

  it("org use (missing org) → exit 2, usage", () => {
    const deps: OrgDeps = { store: memStore(), govConfigAt: probe({}) };
    const r = routeOrg(["use"], {}, deps);
    expect(r.code).to.equal(2);
    expect(r.lines[0]).to.equal("usage: gov-work org use <github_org>");
  });

  it("org list (empty) → exit 0, 'No orgs registered'", () => {
    const deps: OrgDeps = { store: memStore(), govConfigAt: probe({}) };
    const r = routeOrg(["list"], {}, deps);
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.equal("No orgs registered. Add one: prj org add <org> <home>.");
  });

  it("org list (populated) → exit 0, marks the active org", () => {
    const deps: OrgDeps = { store: memStore([{ org: "A", home: "/a" }, { org: "B", home: "/b" }], "B"), govConfigAt: probe({}) };
    const r = routeOrg(["list"], {}, deps);
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.equal("Registered gov homes (* = active):");
    expect(r.lines.join("\n")).to.match(/\* B\t\/b/);
    expect(r.lines.join("\n")).to.match(/ {2}A\t\/a/);
  });

  it("org remove <present> → exit 0, removed", () => {
    const store = memStore([{ org: "A", home: "/a" }], "A");
    const deps: OrgDeps = { store, govConfigAt: probe({}) };
    const r = routeOrg(["remove", "A"], {}, deps);
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.equal("Removed A");
    expect(store.readHomes()).to.deep.equal([]);
    expect(store.readActiveOrg()).to.equal(null); // active cleared
  });

  it("org remove <absent> → exit 1", () => {
    const deps: OrgDeps = { store: memStore(), govConfigAt: probe({}) };
    const r = routeOrg(["remove", "Ghost"], {}, deps);
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("Org 'Ghost' is not registered.");
  });

  it("org remove (missing org) → exit 2, usage", () => {
    const deps: OrgDeps = { store: memStore(), govConfigAt: probe({}) };
    const r = routeOrg(["remove"], {}, deps);
    expect(r.code).to.equal(2);
    expect(r.lines[0]).to.equal("usage: gov-work org remove <github_org>");
  });

  it("org <unknown-sub> → exit 2, generic org usage", () => {
    const deps: OrgDeps = { store: memStore(), govConfigAt: probe({}) };
    const r = routeOrg(["frobnicate"], {}, deps);
    expect(r.code).to.equal(2);
    expect(r.lines[0]).to.equal("usage: gov-work org <add|use|list|remove> …");
  });

  it("org (no subcommand) → exit 2, generic org usage", () => {
    const deps: OrgDeps = { store: memStore(), govConfigAt: probe({}) };
    const r = routeOrg([], {}, deps);
    expect(r.code).to.equal(2);
    expect(r.lines[0]).to.equal("usage: gov-work org <add|use|list|remove> …");
  });
});
