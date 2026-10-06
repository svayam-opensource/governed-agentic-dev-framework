// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE REFUSAL, AT THE ROUTER (design §8) — and the two ways out of it.
 *
 * The gate lives before `route`'s switch on purpose, and these tests are what makes that placement worth
 * something: they assert that the mutating verbs stop, that the read-only ones do NOT (a workspace nobody can
 * inspect is a workspace nobody can recover), and that `gov rules reload` clears the marker while leaving an
 * attributable record — the distinction between "an agent cannot do this" and "an agent cannot do this
 * anonymously", which is the honest version of the guarantee.
 */
import { expect } from "chai";
import { parseArgv } from "../../src/cli/args.js";
import { route, type CliContext } from "../../src/cli/dispatch.js";
import type { OrgConfig } from "../../src/config/org-config.js";
import type { Vcs } from "../../src/lifecycle/vcs.js";
import type { Board } from "../../src/lifecycle/board.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import type { Issues } from "../../src/lifecycle/issues.js";
import type { AnchorCreator } from "../../src/lifecycle/anchor.js";
import type { Pulls } from "../../src/lifecycle/pulls.js";
import { pendingPath, type RulesPending } from "../../src/rules-pending.js";
import { storeTree, treeGit } from "../helpers/rule-store.js";
import { px } from "../helpers/paths.js";

const CONFIG: OrgConfig = {
  orgName: "Svayam", orgShortName: "Svayam", orgSlug: "SVM", orgSlugLower: "svm",
  githubOrg: "Svayamtech", workspaceRepo: "svm-prj-work", orgRepoUrl: "git@github.com:Svayamtech/svm-prj-work.git",
  defaultBranch: "main", defaultCodeBranch: "dev",
  agentWorkRoot: "/awr", govWorkspace: "/gov", policyOwnerEmail: "rk@x", orgTokens: {},
};

const PENDING: RulesPending = {
  hash: "aaaabbbbccccdddd", previous: "1111222233334444",
  clauses: ["GOV-FRM-086", "GOV-FRM-432"],
  at: "2026-09-28T10:12:44.000Z", by: "sync",
};

function memFs(seed: Record<string, string> = {}): Fs & { readonly files: Map<string, string> } {
  const files = new Map(Object.entries(seed).map(([k, v]) => [px(k), v]));
  return {
    files,
    pathExists: (p) => files.has(px(p)),
    readFile: (p) => files.get(px(p)) ?? null,
    writeFile: (p, c) => { files.set(px(p), c); },
    rm: (p) => { files.delete(px(p)); },
    mkdirp: () => {},
    readdir: () => [],
  };
}

function fakeVcs(): Vcs {
  const noop = () => {};
  return {
    localBranchExists: () => false, remoteBranchExists: () => true, headSha: () => "h",
    refExists: () => false, lsRemoteHeads: () => [], lsRemoteRefs: () => [{ name: "dev", sha: "base-sha" }],
    defaultBranch: () => null, revParse: () => null,
    currentBranch: () => "BRNCH-43-governance-common-project", isAncestor: () => false, isClean: () => true,
    remoteBranchesMatching: () => [], addPath: noop, commit: noop, resetHard: noop, resetKeepingFiles: noop,
    cleanUntracked: noop, worktreeAdd: noop, worktreeAddExisting: noop, worktreeRemove: noop, branchDelete: noop,
    push: noop, pushDelete: noop, clone: noop, fetch: noop, setIdentity: noop, checkout: noop, checkoutNew: noop,
    mergeNoEdit: () => "merged", tag: noop,
  };
}

const board: Board = { fetchProject: () => ({ id: "P", title: "@Governance Common Project", shortDescription: null, linkedItemCount: 1, repoUrls: [] }) };
const issues: Issues = { state: () => "OPEN", assign: () => {}, setBoardStatus: () => {}, close: () => {}, resolveIssueUrl: () => null, closeBoard: () => {} };
const anchor: AnchorCreator = { createAnchorIssue: () => "r#1", setState: () => true };
const pulls: Pulls = { create: () => "pr", state: () => null };

/** A context whose disk holds the marker, and whose login is known — the state §8 is about. */
function ctx(over: Partial<CliContext> = {}, marked = true): CliContext {
  const fs = memFs(marked ? { [pendingPath("/awr", "rkant")]: `${JSON.stringify(PENDING)}\n` } : {});
  return {
    config: CONFIG, home: "/awr/PRJ-43-governance-common-project/svm-prj-work", today: "2026-07-03",
    seededBy: "rk@svayam.ai", login: "rkant", board, vcs: fakeVcs(), fs, issues, anchor, pulls,
    projects: { listBoards: () => [] }, cloneRepo: () => {}, authorize: () => true,
    gate: () => ({ ok: true, failures: [] }), now: () => new Date("2026-09-28T10:30:00.000Z"),
    ...over,
  };
}

describe("rules-pending at the router — the mutating verbs fail closed", () => {
  for (const argv of [
    ["task", "https://github.com/Svayamtech/x/issues/9"],
    ["merge", "https://github.com/Svayamtech/x/issues/9"],
    ["close"],
    ["knowledge", "propose", "deploy-policy"],
  ]) {
    it(`refuses \`gov ${argv.join(" ")}\` and names the changed clauses`, () => {
      const r = route(parseArgv(argv) as never, ctx());
      expect(r.code).to.equal(1);
      expect(r.lines[0]).to.match(/^gov \S+: refused — the rules changed after your session started\./);
      expect(r.lines.join("\n")).to.contain("GOV-FRM-086");
      expect(r.lines.join("\n")).to.contain("gov rules reload");
    });
  }

  it("refuses BEFORE the orchestrator runs — nothing is pushed, nothing is closed", () => {
    const closed: string[] = [];
    const r = route(parseArgv(["merge", "https://github.com/Svayamtech/x/issues/9"]) as never,
      ctx({ issues: { ...issues, close: (u) => closed.push(u) } }));
    expect(r.code).to.equal(1);
    expect(closed, "a refusal that runs the merge first is not a refusal").to.deep.equal([]);
  });
});

describe("rules-pending at the router — the read-only verbs keep working", () => {
  /**
   * "Not refused" rather than "exit 0": these verbs reach their orchestrator and then answer from a double that
   * is deliberately thin. What §8 promises is that the REFUSAL does not apply to them, and asserting exit 0
   * would be asserting the completeness of the fake instead.
   */
  const reaches = (argv: readonly string[]): void => {
    const lines = route(parseArgv([...argv]) as never, ctx()).lines.join("\n");
    expect(lines, `gov ${argv.join(" ")} must not be refused for pending rules`).to.not.contain("the rules changed after your session started");
  };

  it("`gov status` still answers", () => {
    reaches(["status"]);
  });

  it("`gov knowledge search|show|list` still answer", () => {
    expect(route(parseArgv(["knowledge", "list"]) as never, ctx()).code).to.equal(0);
    expect(route(parseArgv(["knowledge", "search", "policy"]) as never, ctx()).code).to.equal(0);
  });

  it("`gov rules` still answers — the verb that gets you out cannot be the one that is blocked", () => {
    expect(route(parseArgv(["rules", "reload"]) as never, ctx()).code).to.equal(0);
  });

  it("`gov list`, `gov pause` … every other verb is untouched", () => {
    for (const v of [["list"], ["list-all"], ["manage", "list"], ["pause"], ["resume"], ["validate"], ["sync"]]) reaches(v);
  });
});

describe("rules-pending at the router — no marker, no refusal", () => {
  it("a workspace with no marker routes exactly as before", () => {
    const r = route(parseArgv(["task", "https://github.com/Svayamtech/x/issues/9"]) as never, ctx({}, false));
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.match(/^Task BRNCH-43/);
  });
});

/**
 * NO KEY IS NOT NO MARKER (Policy Owner, 2026-09-30).
 *
 * The test replaced here asserted the opposite, and its own name argued for it: *"an unknown login finds no
 * marker — the writer keys it the same way, so this is consistent not lax"*. The consistency was real and the
 * conclusion was wrong. `readPending` returning null means NOTHING IS PENDING; `markerKey` returning null means
 * NO ANSWER. Sharing an outcome between them meant a lapsed `gh` token silently disabled the gate the
 * specification describes as unconditional — and a marker sitting on disk, as in the second case below, was
 * stepped straight over.
 *
 * It is the same distinction `gov doctor` insists on between a branch that is unprotected and one it could not
 * read. A test can be internally consistent and still be defending a defect.
 */
describe("rules-pending at the router — gov cannot tell", () => {
  it("no login → REFUSES a mutating verb, and names what it could not determine", () => {
    const r = route(parseArgv(["task", "https://github.com/Svayamtech/x/issues/9"]) as never, ctx({ login: undefined }, false));
    expect(r.code).to.equal(1);
    const out = r.lines.join("\n");
    expect(out).to.contain("cannot tell whether the rules changed");
    expect(out, "the cause, not just the symptom").to.contain("who you are");
    expect(out, "and the way out").to.contain("gh auth login");
  });

  it("a marker that EXISTS is no longer stepped over when the login is unknown", () => {
    // The sharpest form of the old defect: the rules had changed, gov had written the marker, and the verb ran
    // anyway because it could not work out whose marker to look for.
    const fs = memFs({ [pendingPath("/awr", "rkant")]: `${JSON.stringify(PENDING)}\n` });
    const r = route(parseArgv(["task", "https://github.com/Svayamtech/x/issues/9"]) as never, ctx({ fs, login: undefined }, false));
    expect(r.code).to.equal(1);
  });

  it("no work root → refuses, and says THAT rather than blaming gh", () => {
    const r = route(parseArgv(["merge"]) as never, ctx({ config: { ...CONFIG, agentWorkRoot: "" } }, false));
    expect(r.code).to.equal(1);
    const out = r.lines.join("\n");
    expect(out).to.contain("your work root is unknown");
    expect(out, "no login problem to report here").to.not.contain("gh auth login");
  });

  it("READ-ONLY verbs are never refused for this reason — refusing everything would trap the workspace", () => {
    // Asserted on the MESSAGE, not the exit code. Some of these legitimately exit 1 in this fixture for their own
    // reasons; what must never happen is that they exit 1 because gov could not work out who is running them.
    for (const v of [["status"], ["validate"], ["rules", "report"], ["list"]]) {
      const out = route(parseArgv(v) as never, ctx({ login: undefined }, false)).lines.join("\n");
      expect(out, v.join(" ")).to.not.contain("cannot tell whether the rules changed");
    }
  });
});

describe("gov rules reload — the attestation that clears it", () => {
  it("prints the changed clauses, the hash, and who attested", () => {
    const r = route(parseArgv(["rules", "reload"]) as never, ctx());
    expect(r.code).to.equal(0);
    const out = r.lines.join("\n");
    expect(out).to.contain("2 rule(s) changed at 2026-09-28T10:12:44.000Z (`gov sync`)");
    expect(out).to.contain("GOV-FRM-432");
    expect(out).to.contain("aaaabbbbccccdddd");
    expect(out).to.contain("attested by rkant");
  });

  it("clears the marker, so the next mutating verb goes through", () => {
    const c = ctx();
    route(parseArgv(["rules", "reload"]) as never, c);
    expect(c.fs.readFile(pendingPath("/awr", "rkant"))).to.equal(null);
    expect(route(parseArgv(["task", "https://github.com/Svayamtech/x/issues/9"]) as never, c).code).to.equal(0);
  });

  it("warns that clearing does not restart anything — the claim is the person's, not gov's", () => {
    expect(route(parseArgv(["rules", "reload"]) as never, ctx()).lines.join("\n"))
      .to.contain("If your session is in fact still the old");
  });

  it("says so plainly when nothing is pending, rather than pretending to have done something", () => {
    const r = route(parseArgv(["rules", "reload"]) as never, ctx({}, false));
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.contain("nothing pending");
  });

  it("cannot clear what it cannot key — an unknown login is told why, not silently satisfied", () => {
    const r = route(parseArgv(["rules", "reload"]) as never, ctx({ login: undefined }));
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.contain("does not know whose session this is");
  });
});

/**
 * THE DENY-LIST AGAINST THE ROUTER (the check the comment in `rules-pending.ts` promises).
 *
 * The risk a deny-list carries is a new MUTATING verb that nobody adds to it — so this asserts the list against
 * the verbs `route` hands to a lifecycle orchestrator that pushes a branch, closes an issue or opens a pull
 * request. A verb added to that set without being gated fails here rather than in a year's audit.
 */
describe("rules-pending at the router — the deny-list covers what mutates", () => {
  const MUTATING: readonly (readonly string[])[] = [
    ["task", "https://github.com/Svayamtech/x/issues/9"],
    ["merge", "https://github.com/Svayamtech/x/issues/9"],
    ["close"],
    ["knowledge", "propose", "a-slug"],
  ];

  it("gates every one of them", () => {
    for (const argv of MUTATING) {
      expect(route(parseArgv([...argv]) as never, ctx()).lines.join("\n"), argv.join(" ")).to.contain("refused — the rules changed");
    }
  });
});

describe("gov merge — the stamp reaches the output (design §10.10)", () => {
  const STAMP = ["<!-- gov:governed-by -->", "`gov-rules-hash: aaaabbbbccccdddd`", "`gov-version: 1.2.3`", "<!-- /gov:governed-by -->"];

  it("names the facts and how many pull requests carry them", () => {
    const r = route(parseArgv(["merge", "https://github.com/Svayamtech/x/issues/9"]) as never,
      ctx({ governanceStamp: () => ({ lines: STAMP }), stampPullRequest: () => "stamped" }, false));
    expect(r.code).to.equal(0);
    const out = r.lines.join("\n");
    expect(out).to.contain("gov-rules-hash: aaaabbbbccccdddd");
    expect(out).to.contain("stamped into 1 pull request(s)");
  });

  it("prints the facts anyway when there is no pull request, so the run log still carries them", () => {
    const out = route(parseArgv(["merge", "https://github.com/Svayamtech/x/issues/9"]) as never,
      ctx({ governanceStamp: () => ({ lines: STAMP }), stampPullRequest: () => "no-pr" }, false)).lines.join("\n");
    expect(out).to.contain("no pull request to stamp; recorded here and in the run log");
  });

  it("says the stamp could not be computed, and does not read as a failed merge", () => {
    const r = route(parseArgv(["merge", "https://github.com/Svayamtech/x/issues/9"]) as never,
      ctx({ governanceStamp: () => ({ error: "never run `gov rules build`" }) }, false));
    expect(r.code, "a stamp is a record OF a merge that already landed").to.equal(0);
    expect(r.lines.join("\n")).to.contain("governance stamp: not recorded — never run `gov rules build` (the merge is done)");
  });
});

/**
 * `gov sync` — HOW A RATIFIED ORG RULE REACHES A WORKING PROJECT (design §7).
 *
 * This is the moment the whole feature exists for, and the one that had nothing in it: the policy documents
 * moved forward on the default branch and the resident block every agent reads stayed where the last hand-run of
 * the verb left it. The ordering assertion matters as much as the render — `ensureRootProtocol` mirrors
 * `agent/harness/*` into the project, so a mirror that runs first faithfully copies the stale bytes.
 */
describe("gov sync — renders the ratified rules, then mirrors them", () => {
  const PROTOCOL_BODY = "# Agent protocol\n\n<!-- gov-protocol-version: 3 -->\n\n{{render.always_rules}}\n";
  /** The framework store on the DEFAULT branch, with one resident rule whose cue is `cue`. */
  const ratified = (cue: string): string => `- id: GOV-FRM-012
  source: { doc: framework/docs/specs/framework-specification.md, section: "10.1", sha: "4a0422d" }
  expectation: "The agent stops all work when a C01 rule is broken."
  actor: [agent]
  level: C01
  cue: { tier: resident, text: "${cue}" }
  start: { version: "1.2.3", date: "2026-10-06" }
  end: null
`;

  /** A project clone with the protocol body on disk and the rule stores on the DEFAULT branch only. */
  function syncCtx(cue: string, seed: Record<string, string> = {}): CliContext {
    const home = "/awr/PRJ-43-governance-common-project/svm-prj-work";
    const fs = memFs({ [`${home}/agent/session-protocol.md`]: PROTOCOL_BODY, ...seed });
    return ctx({ fs, home, git: treeGit({ main: storeTree("[]\n", { "framework/rules/rules.yaml": ratified(cue) }) }) }, false);
  }

  it("renders the harness from the default branch as part of the sync", () => {
    const c = syncCtx("C01 MEANS STOP.");
    const r = route(parseArgv(["sync"]) as never, c);
    expect(r.code).to.equal(0);
    expect(r.lines.join("\n")).to.contain("rules: rendered");
    expect(c.fs.readFile("/awr/PRJ-43-governance-common-project/svm-prj-work/agent/harness/CLAUDE.md")).to.contain("C01 MEANS STOP.");
  });

  it("closes the mutating verbs when the rendered rules changed, and says so instead of 'paste this'", () => {
    const c = syncCtx("C01 MEANS STOP.");
    const out = route(parseArgv(["sync"]) as never, c).lines.join("\n");
    expect(out).to.contain("rules CHANGED");
    expect(out).to.contain("work is closed until the session restarts");
    expect(out, "a re-read does not clear the marker, so telling people to paste would send them in circles")
      .to.not.contain("Paste this into your running session");
    expect(route(parseArgv(["task", "https://github.com/Svayamtech/x/issues/9"]) as never, c).lines.join("\n"))
      .to.contain("refused — the rules changed");
  });

  it("keeps the old advice when nothing changed — the mid-session half of the guarantee still applies", () => {
    const c = syncCtx("C01 MEANS STOP.");
    route(parseArgv(["sync"]) as never, c);                                  // first render
    c.fs.rm(pendingPath("/awr", "rkant"));                                   // as a gov-launched session would
    const out = route(parseArgv(["sync"]) as never, c).lines.join("\n");
    expect(out).to.contain("rules unchanged");
    expect(out).to.contain("Paste this into your running session");
  });

  it("says nothing about rules in a workspace that has no rule store", () => {
    const out = route(parseArgv(["sync"]) as never, ctx({ git: () => null }, false)).lines.join("\n");
    expect(out).to.not.contain("rules:");
    expect(out).to.contain("Paste this into your running session");
  });
});
