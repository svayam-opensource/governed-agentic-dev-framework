// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { parseArgv, flagStr } from "../../src/cli/args.js";
import { route, type CliContext } from "../../src/cli/dispatch.js";
import { classifyPosture } from "../../src/config/governance.js";
import type { OrgConfig } from "../../src/config/org-config.js";
import type { Vcs } from "../../src/lifecycle/vcs.js";
import type { Board } from "../../src/lifecycle/board.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import type { Issues } from "../../src/lifecycle/issues.js";
import type { AnchorCreator } from "../../src/lifecycle/anchor.js";
import type { Pulls } from "../../src/lifecycle/pulls.js";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { RULE_STORE_PATHS } from "../../src/rules/model/store-io.js";

/** The shipped framework rule stores, as `git show <default>:<path>` would serve them. */
const CONTENT = path.join(import.meta.dirname, "..", "..", "..", "..", "content");
const RULE_FILES: Record<string, string> = {
  [RULE_STORE_PATHS.frameworkRules]: readFileSync(path.join(CONTENT, RULE_STORE_PATHS.frameworkRules), "utf8"),
  [RULE_STORE_PATHS.frameworkCatalog]: readFileSync(path.join(CONTENT, RULE_STORE_PATHS.frameworkCatalog), "utf8"),
  [RULE_STORE_PATHS.orgConfig]: 'org_slug: "SVM"\n',
};

describe("prj-work — parseArgv", () => {
  it("splits command, positionals, and flags", () => {
    expect(parseArgv(["task", "https://x/issues/1", "--assignee=me"])).to.deep.equal({
      command: "task",
      positionals: ["https://x/issues/1"],
      flags: { assignee: "me" },
    });
  });
  it("supports --flag value and boolean --flag", () => {
    const p = parseArgv(["seed", "url", "--login", "rk", "--force"]) as { flags: Record<string, unknown> };
    expect(p.flags).to.deep.equal({ login: "rk", force: true });
    expect(flagStr(p.flags as Record<string, string | boolean>, "login")).to.equal("rk");
  });
  it("errors on no command", () => {
    expect(parseArgv([])).to.have.property("error");
  });
});

const CONFIG: OrgConfig = {
  orgName: "Svayam", orgShortName: "Svayam", orgSlug: "SVM", orgSlugLower: "svm",
  githubOrg: "Svayamtech", workspaceRepo: "svm-prj-work", orgRepoUrl: "git@github.com:Svayamtech/svm-prj-work.git",
  defaultBranch: "main", defaultCodeBranch: "dev",
  agentWorkRoot: "/awr", govWorkspace: "/gov", policyOwnerEmail: "rk@x", orgTokens: {},
  // No posture recorded — the state every organization is in before it decides, and the one `repo protect` refuses on.
  governancePosture: classifyPosture(""),
};

/** A Vcs whose branch is a project branch so from-workspace commands resolve. */
function fakeVcs(): Vcs {
  const noop = () => {};
  return {
    localBranchExists: () => false, remoteBranchExists: () => true, headSha: () => "h",
    refExists: () => false, lsRemoteHeads: () => [],
    // The base exists; no project branch yet — the ordinary case the preflight sees.
    lsRemoteRefs: () => [{ name: "dev", sha: "base-sha" }], defaultBranch: () => null, revParse: () => null,
    currentBranch: () => "BRNCH-43-governance-common-project", isAncestor: () => false, isClean: () => true,
    remoteBranchesMatching: () => [], addPath: noop, commit: noop, resetHard: noop, resetKeepingFiles: noop, cleanUntracked: noop,
    worktreeAdd: noop, worktreeAddExisting: noop, worktreeRemove: noop, branchDelete: noop, push: noop, pushDelete: noop, clone: noop,
    fetch: noop, setIdentity: noop, checkout: noop, checkoutNew: noop, mergeNoEdit: () => "merged", tag: noop,
  };
}
const board: Board = { fetchProject: () => ({ id: "P", title: "@Governance Common Project", shortDescription: null, linkedItemCount: 1, repoUrls: [] }) };
const fs: Fs = { pathExists: () => false, readFile: () => null, mkdirp: () => {}, writeFile: () => {}, rm: () => {}, readdir: () => [] };
const issues: Issues = { state: () => "OPEN", assign: () => {}, setBoardStatus: () => {}, close: () => {}, resolveIssueUrl: () => null, closeBoard: () => {} };
const anchor: AnchorCreator = { createAnchorIssue: () => "r#1", setState: () => true };
const pulls: Pulls = { create: () => "pr", state: () => null };

function ctx(over: Partial<CliContext> = {}): CliContext {
  return {
    config: CONFIG, home: "/awr/PRJ-43-governance-common-project/svm-prj-work", today: "2026-07-03",
    // `login` is half the key the rules-pending marker is stored under. Without it `route` now REFUSES every
    // mutating verb rather than skipping the gate (Policy Owner, 2026-09-30) — so a fixture that omits it is
    // testing the refusal, not the verb. Tests for the refusal itself live in `rules-gate.test.ts`.
    seededBy: "svayam-rkant", login: "svayam-rkant", board, vcs: fakeVcs(), fs, issues, anchor, pulls, projects: { listBoards: () => [] }, cloneRepo: () => {}, authorize: () => true, gate: () => ({ ok: true, failures: [] }), ...over,
  };
}

describe("prj-work — route (dispatcher)", () => {
  it("routes `task` to the task orchestrator (exit 0)", () => {
    const r = route(parseArgv(["task", "https://github.com/Svayamtech/x/issues/9"]) as never, ctx());
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.match(/^Task BRNCH-43-governance-common-project\.ISSUE-9/);
  });

  it("routes `pause` and reports the derived status", () => {
    const r = route(parseArgv(["pause"]) as never, ctx());
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.match(/Project #43 → paused/);
  });

  it("routes `merge` (issue URL arg)", () => {
    const r = route(parseArgv(["merge", "https://github.com/Svayamtech/x/issues/9"]) as never, ctx());
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.match(/Merged .*ISSUE-9 →/);
  });

  it("returns usage (exit 2) when a required arg is missing", () => {
    expect(route(parseArgv(["task"]) as never, ctx()).code).to.equal(2);
    expect(route(parseArgv(["merge"]) as never, ctx()).code).to.equal(2);
  });

  it("rejects an unknown command (exit 2)", () => {
    const r = route(parseArgv(["frobnicate"]) as never, ctx());
    expect(r.code).to.equal(2);
    expect(r.lines[0]).to.match(/unknown command 'frobnicate'/);
  });

  it("surfaces an orchestrator failure code (e.g. not-a-project-branch)", () => {
    const badVcs = { ...fakeVcs(), currentBranch: () => "main" };
    const r = route(parseArgv(["pause"]) as never, ctx({ vcs: badVcs }));
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.match(/not a project branch/);
  });
});

// The verbs gov used to DELEGATE now belong to other binaries (adr-three-clients, PRJ-43). Removing a verb
// costs whoever types it next, so the removal has to answer them: the reader knows `deploy` exists, so the
// useful reply is which client owns it — not "unknown command".
describe("cli — verbs that MOVED to another client", () => {
  const lines = (cmd: string): string => route(parseArgv([cmd]) as never, ctx()).lines.join("\n");

  it("names the owning client and the exact command to run", () => {
    const out = lines("deploy");
    expect(out).to.match(/'deploy' is a gov-cicd verb/);
    expect(out, "the fix must be runnable, not described").to.contain("gov-cicd deploy");
    expect(out).to.contain("npm i -g @svayam/gov-cicd");
  });

  // `infra` was a NAMESPACE (`gov infra <verb>` forwarded `<verb>`), so the advice must be
  // `gov-infra <verb>` — NOT `gov-infra infra`, which is what the first version printed. The bug survived
  // a test that only matched /gov-infra/: a substring assertion passed while the instruction was useless.
  // Found by running the binary, which is the argument for running it.
  // gov-infra does not exist yet: @svayam/gov-infra is unpublished and 909 carries no such package.
  // Naming the client is right; telling anyone to INSTALL it is advice that fails when typed — the same
  // defect as `gov-infra infra`, found the same way (by running the binary, not by reading the test).
  it("an UNRELEASED client is named, but no install is promised", () => {
    const out = lines("infra");
    expect(out).to.match(/was a namespace/);
    expect(out).to.match(/gov-infra is not released yet/);
    expect(out, "nothing to install — the package 404s").to.not.contain("npm i -g @svayam/gov-infra");
    expect(out, "advice that would not work if typed").to.not.contain("gov-infra infra");
  });

  it("a RELEASED client still gets the runnable command and the install line", () => {
    const out = lines("promote");
    expect(out).to.contain("gov-cicd promote");
    expect(out).to.contain("npm i -g @svayam/gov-cicd");
  });

  // ADOPTION WALK #8 (2026-10-07): `gov auth login` printed `npm i -g @svayam/gov-cicd`. The NAME is the real
  // package's (910-GOV-CICD/package.json), but it is published only to the Svayam registry (its publishConfig), so
  // the line as printed 404s against the default npm registry. The install line names the registry.
  it("the install line is one that works when typed — the real package, from the registry it is published to", () => {
    const out = lines("auth");
    expect(out).to.contain("npm i -g @svayam/gov-cicd --registry https://npm.svayamtech.com");
    const sibling = fileURLToPath(new URL("../../../../../../910-GOV-CICD/package.json", import.meta.url));
    if (existsSync(sibling)) {
      const pkg = JSON.parse(readFileSync(sibling, "utf8")) as { name: string; publishConfig?: { registry?: string } };
      expect(out).to.contain(`npm i -g ${pkg.name} --registry ${(pkg.publishConfig?.registry ?? "").replace(/\/$/, "")}`);
    }
  });

  it("still exits 2 — a moved verb is a usage error, not a success", () => {
    expect(route(parseArgv(["deploy"]) as never, ctx()).code).to.equal(2);
  });

  it("a genuinely unknown command is still 'unknown command'", () => {
    const out = lines("wibble");
    expect(out).to.match(/unknown command 'wibble'/);
    expect(out, "no client owns it, so none may be suggested").to.not.match(/gov-cicd|gov-infra/);
  });
});

// Policy Owner, 2026-09-29 — `gov repo protect`. Routing only: what it PRINTS is repo-protect.test.ts's
// business. What matters here is that `plan` is the default, that it is the sub-command doing the work, and
// that with no way to call `gh` the verb says so rather than pretending it looked.
describe("cli — route `repo protect`", () => {
  it("`gov repo protect` defaults to plan, and plan makes no gh call it did not have to", () => {
    const calls: string[][] = [];
    const r = route(parseArgv(["repo", "protect"]) as never, ctx({ ghApi: (a) => { calls.push([...a]); return "{}"; } }));
    // The fixture's org recorded no posture, which is soft (W2-Q6): it installs nothing, before reading anything.
    expect(r.code).to.equal(0);
    expect(r.lines.join("\n")).to.contain("SOFT governance");
    expect(calls).to.deep.equal([]);
  });

  it("`apply` with no posture recorded is soft — nothing to install, exit 0", () => {
    const r = route(parseArgv(["repo", "protect", "apply"]) as never, ctx({ ghApi: () => "{}" }));
    expect(r.code).to.equal(0);
  });

  it("a sub-command gov does not have is usage (exit 2), and the usage names the flags", () => {
    expect(route(parseArgv(["repo"]) as never, ctx()).code).to.equal(2);
    const r = route(parseArgv(["repo", "protect", "install"]) as never, ctx());
    expect(r.code).to.equal(2);
    expect(r.lines.join("\n")).to.contain("--repo").and.contain("--branch");
  });

  it("derives the rules' required checks from the DEFAULT branch, and under soft lists them as `would be required under hard`", () => {
    const seen: string[] = [];
    const git = (_repo: string, args: readonly string[]): string | null => {
      seen.push(args.join(" "));
      if (args[0] === "rev-parse") return null;                     // no origin/main fetched: the local branch
      if (args[0] === "ls-tree") {
        const roots = args.slice(args.indexOf("--") + 1);
        return Object.keys(RULE_FILES).filter((f) => roots.some((r) => f === r || f.startsWith(`${r}/`))).join("\n");
      }
      if (args[0] === "show") return RULE_FILES[args[1]!.slice(args[1]!.indexOf(":") + 1)] ?? null;
      return null;
    };
    const r = route(parseArgv(["repo", "protect"]) as never, ctx({ ghApi: () => "{}", git }));
    const text = r.lines.join("\n");
    expect(r.code).to.equal(0);
    expect(text).to.contain("GOV-FRM-455 · pull_request   would be required under hard");
    expect(text).to.contain("rules read at main");
    expect(seen.some((a) => a.startsWith("show main:")), "read at the default branch, never the working tree").to.equal(true);
  });

  it("a code repo (--repo) is read for vcs.code-repo gates — the framework binds none there", () => {
    const git = (_repo: string, args: readonly string[]): string | null => {
      if (args[0] === "ls-tree") {
        const roots = args.slice(args.indexOf("--") + 1);
        return Object.keys(RULE_FILES).filter((f) => roots.some((r) => f === r || f.startsWith(`${r}/`))).join("\n");
      }
      if (args[0] === "show") return RULE_FILES[args[1]!.slice(args[1]!.indexOf(":") + 1)] ?? null;
      return null;
    };
    const text = route(parseArgv(["repo", "protect", "--repo", "billing"]) as never, ctx({ ghApi: () => "{}", git })).lines.join("\n");
    expect(text).to.contain("Svayamtech/billing@dev");
    expect(text).to.contain("no rule check").and.not.contain("GOV-FRM-455");
  });

  it("with no way to call gh, it neither reads nor writes and says so", () => {
    const r = route(parseArgv(["repo", "protect"]) as never, ctx());
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.contain("no way to call `gh`").and.contain("neither read nor wrote");
  });
});
