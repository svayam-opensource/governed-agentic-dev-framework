// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// `gov check install --all` and `gov check status` (P3 wave 3): the check workflow across a project's repositories —
// the governance repo and every linked code repo, at its clone — over fakes and the shipped rule stores.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { expect } from "chai";
import { checkCommand, type CheckVerbDeps, type CheckVerbConfig } from "../../../src/cli/check-verb.js";
import { boardLinkedRepos, checksDiagnostic, checkStatusReport, GENERATED_MARK, type LinkedRepos, type ScopeDeps } from "../../../src/cli/check-scope.js";
import { BoardFetchError } from "../../../src/lifecycle/board.js";
import { doctor } from "../../../src/maintain/doctor.js";

const here = dirname(fileURLToPath(import.meta.url));
const CONTENT = resolve(here, "../../../../../content");
const read = (rel: string) => readFileSync(resolve(CONTENT, rel), "utf8");

const ROOT = "/work";
const PRJ = `${ROOT}/PRJ-7-billing`;
const GOV = `${PRJ}/acme-gov`;
const BILLING = `${PRJ}/billing`;
const LEDGER = `${PRJ}/ledger`;
const WF = ".github/workflows/gov-checks.yml";
const APP = 'services:\n  github_app:\n    client_id: "Iv1.abc"\n    slug: "acme-gov"\n';

function govFiles(rules = read("framework/rules/rules.yaml")): Record<string, string> {
  return {
    "org-config.yaml": 'org_slug: "ACME"\n',
    "policies/governance.yaml": 'policy_owner:\n  github: "@polly"\n',
    "framework/rules/rules.yaml": rules,
    "framework/rules/catalog.yaml": read("framework/rules/catalog.yaml"),
  };
}

interface World {
  branches: Record<string, string | null>;
  disk: Record<string, string>;
  dirs: Set<string>;
  linked: LinkedRepos;
  rules?: string;
}

function world(over: Partial<World> = {}): World {
  return {
    branches: { [GOV]: "BRNCH-7-billing.ISSUE-3", [BILLING]: "BRNCH-7-billing.ISSUE-3", [LEDGER]: "dev" },
    disk: { [`${GOV}/org-config.yaml`]: `org_slug: "ACME"\n${APP}` },
    dirs: new Set([GOV, `${GOV}/.git`, BILLING, `${BILLING}/.git`, LEDGER, `${LEDGER}/.git`]),
    linked: { ok: true, names: ["billing", "ledger"] },
    ...over,
  };
}

function deps(w: World): CheckVerbDeps & { removed: string[] } {
  const files = govFiles(w.rules);
  const removed: string[] = [];
  const scope: ScopeDeps = {
    linkedRepos: () => w.linked,
    pathExists: (p) => w.dirs.has(p),
    listDir: (d) => (d === ROOT ? ["PRJ-7-billing", "PRJ-8-other", "preferences"] : []),
    removeFile: (p) => { removed.push(p); delete w.disk[p]; },
  };
  return {
    removed,
    git: (repo, args) => {
      if (args[0] === "symbolic-ref") return w.branches[repo] ?? null;
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") return w.dirs.has(`${repo}/.git`) ? "true" : null;
      if (args[0] === "rev-parse") return args.includes("origin/main") ? "abc" : null;
      if (args[0] === "ls-tree") {
        const want = args.slice(args.indexOf("--") + 1);
        return Object.keys(files).filter((f) => want.some((p) => f === p || f.startsWith(`${p}/`))).join("\n");
      }
      if (args[0] === "show" && args[1]?.startsWith("origin/main:")) return files[args[1].slice("origin/main:".length)] ?? null;
      return null;
    },
    gh: () => { throw new Error("install and status call no GitHub API"); },
    env: {},
    readFile: (f) => w.disk[f] ?? null,
    writeFile: (f, t) => { w.disk[f] = t; },
    scope,
  };
}

const CFG: CheckVerbConfig = {
  home: GOV, defaultBranch: "main", defaultCodeBranch: "dev", githubOrg: "acme", workspaceRepo: "acme-gov", posture: "soft", agentWorkRoot: ROOT,
};
const install = (w: World, flags: Record<string, string | boolean> = {}, cfg = CFG) => {
  const d = deps(w);
  const r = checkCommand(["install"], { all: true, ...flags }, d, cfg);
  return { ...r, text: r.lines.join("\n"), removed: d.removed };
};
const status = (w: World, flags: Record<string, string | boolean> = {}, cfg = CFG) => {
  const r = checkCommand(["status"], flags, deps(w), cfg);
  return { ...r, text: r.lines.join("\n") };
};

describe("gov check install --all", () => {
  it("writes the governance repo and each linked code repo on the task branch; refuses the one on its default branch", () => {
    const w = world();
    const r = install(w);
    expect(r.text).to.match(/written\s+acme-gov\s+\/work\/PRJ-7-billing\/acme-gov\/\.github\/workflows\/gov-checks\.yml/);
    expect(r.text).to.match(/written\s+billing\s+/);
    expect(r.text).to.match(/refused\s+ledger\s+on `dev`, not a project or task branch — gov never writes a default branch/);
    expect(w.disk[`${GOV}/${WF}`]).to.contain("--resource vcs.gov-repo");
    expect(w.disk[`${BILLING}/${WF}`]).to.contain("--resource vcs.code-repo").and.contain("repository: acme/acme-gov");
    expect(w.disk[`${LEDGER}/${WF}`]).to.equal(undefined);
    expect(r.code, "a refused repo is not success").to.equal(1);
  });

  it("never commits or pushes: it ends with the git commands and `gov merge` for a task branch", () => {
    const r = install(world());
    expect(r.text).to.contain("NOT committed and NOT pushed");
    expect(r.text).to.contain(`git -C ${BILLING} add ${WF}`).and.contain(`git -C ${BILLING} push origin BRNCH-7-billing.ISSUE-3`);
    expect(r.text).to.contain("gov merge BRNCH-7-billing.ISSUE-3");
    expect(r.text).to.not.contain(`git -C ${LEDGER}`);
  });

  it("a project branch gets a pull request command against the repo's default branch", () => {
    const w = world({ branches: { [GOV]: "BRNCH-7-billing", [BILLING]: "BRNCH-7-billing", [LEDGER]: "BRNCH-7-billing" } });
    const r = install(w);
    expect(r.code, r.text).to.equal(0);
    expect(r.text).to.contain("gh pr create --repo acme/billing --base dev --head BRNCH-7-billing");
    expect(r.text).to.contain("gh pr create --repo acme/acme-gov --base main --head BRNCH-7-billing");
    expect(r.text).to.not.contain("gov merge");
  });

  it("idempotent: identical bytes are reported unchanged and not rewritten", () => {
    const w = world({ branches: { [GOV]: "BRNCH-7-billing", [BILLING]: "BRNCH-7-billing", [LEDGER]: "BRNCH-7-billing" } });
    install(w);
    let writes = 0;
    const d = deps(w);
    const r = checkCommand(["install"], { all: true }, { ...d, writeFile: () => { writes++; } }, CFG);
    const text = r.lines.join("\n");
    expect(writes).to.equal(0);
    expect(text).to.match(/unchanged\s+acme-gov/).and.match(/unchanged\s+billing/).and.match(/unchanged\s+ledger/);
    expect(text).to.contain("Nothing changed on disk");
  });

  it("refuses a repo that is not cloned, not git, detached, or on another project's branch — and says which", () => {
    const w = world({
      linked: { ok: true, names: ["billing", "ledger", "web", "notes"] },
      branches: { [GOV]: "BRNCH-7-billing", [BILLING]: null, [LEDGER]: "BRNCH-8-other" },
    });
    w.dirs.add(`${PRJ}/notes`);
    const r = install(w);
    expect(r.text).to.match(/refused\s+billing\s+HEAD is detached/);
    expect(r.text).to.match(/refused\s+ledger\s+on `BRNCH-8-other`, a branch of another project \(#8\)/);
    expect(r.text).to.match(/refused\s+web\s+not cloned at \/work\/PRJ-7-billing\/web/);
    expect(r.text).to.match(/refused\s+notes\s+.* is not a git working tree/);
  });

  it("no GitHub App recorded: still writes, but prints the `gov app setup` line first", () => {
    const w = world();
    w.disk[`${GOV}/org-config.yaml`] = 'org_slug: "ACME"\n';
    const r = install(w);
    expect(r.lines[1]).to.contain("services.github_app").and.contain("`gov app setup`");
    expect(w.disk[`${BILLING}/${WF}`]).to.be.a("string");
    // Recorded: no such line.
    expect(install(world()).text).to.not.contain("gov app setup");
  });

  it("a repo no rule binds gets nothing; a stale gov-written workflow there is offered for --prune, and removed with it", () => {
    // Every code-repo binding moved to the gov repo: nothing binds vcs.code-repo.
    const rules = read("framework/rules/rules.yaml").replaceAll("vcs.code-repo", "vcs.gov-repo");
    const w = world({ rules, branches: { [GOV]: "BRNCH-7-billing", [BILLING]: "BRNCH-7-billing", [LEDGER]: "BRNCH-7-billing" } });
    w.disk[`${BILLING}/${WF}`] = `${GENERATED_MARK} — do not edit; re-render instead.\nname: gov-checks\n`;
    w.disk[`${LEDGER}/${WF}`] = "name: hand-written\n";
    const r = install(w);
    expect(r.text).to.match(/stale\s+billing\s+.*--prune/);
    expect(r.text).to.match(/nothing\s+ledger\s+.*not written by gov, left alone/);
    expect(w.disk[`${BILLING}/${WF}`]).to.be.a("string");
    const p = install(w, { prune: true });
    expect(p.removed).to.deep.equal([`${BILLING}/${WF}`]);
    expect(p.text).to.match(/removed\s+billing/).and.contain(`git -C ${BILLING} add ${WF}`);
    expect(w.disk[`${LEDGER}/${WF}`], "a file gov did not write is never pruned").to.equal("name: hand-written\n");
  });

  it("the board cannot be read: the governance repo is still handled, the code repos are 'cannot tell'", () => {
    const w = world({ linked: { ok: false, reason: "the board could not be read (offline)" } });
    const r = install(w);
    expect(r.text).to.match(/written\s+acme-gov/);
    expect(r.text).to.match(/cannot tell\s+code repos\s+cannot tell which code repos are linked — the board could not be read \(offline\)/);
    expect(r.code).to.equal(1);
  });

  it("no active project: the governance repo on main is refused, and --project is suggested", () => {
    const w = world({ branches: { [GOV]: "main" } });
    const r = install(w);
    expect(r.text).to.match(/refused\s+acme-gov\s+on `main`/);
    expect(r.text).to.contain("pass --project <id>");
    expect(w.disk[`${GOV}/${WF}`]).to.equal(undefined);
  });

  it("--project <id> finds the project's clones under the work root, from anywhere", () => {
    const w = world({ branches: { [GOV]: "BRNCH-7-billing", [BILLING]: "BRNCH-7-billing", [LEDGER]: "BRNCH-7-billing" } });
    const r = install(w, { project: "PRJ-7" }, { ...CFG, home: "/elsewhere/acme-gov" });
    expect(r.code, r.text).to.equal(0);
    expect(r.text).to.contain("PRJ-7-billing");
    expect(w.disk[`${LEDGER}/${WF}`]).to.be.a("string");
    expect(install(world(), { project: "PRJ-99" }).text).to.contain("no single clone of project #99");
  });
});

describe("gov check status", () => {
  it("in-sync / stale / missing per repo, and never writes", () => {
    const w = world({ branches: { [GOV]: "BRNCH-7-billing", [BILLING]: "BRNCH-7-billing", [LEDGER]: "BRNCH-7-billing" } });
    install(w);
    w.disk[`${BILLING}/${WF}`] += "# edited by hand\n";
    delete w.disk[`${LEDGER}/${WF}`];
    const before = JSON.stringify(w.disk);
    const r = status(w);
    expect(r.text).to.match(/in-sync\s+acme-gov/).and.match(/stale\s+billing/).and.match(/missing\s+ledger/);
    expect(r.code).to.equal(1);
    expect(JSON.stringify(w.disk)).to.equal(before);
  });

  it("everything in sync: exit 0, and doctor's row is ok", () => {
    const w = world({ branches: { [GOV]: "BRNCH-7-billing", [BILLING]: "BRNCH-7-billing", [LEDGER]: "BRNCH-7-billing" } });
    install(w);
    expect(status(w).code).to.equal(0);
    const d = checksDiagnostic(checkStatusReport({}, deps(w), CFG));
    expect(d.status).to.equal("ok");
    expect(d.detail).to.contain("3 repo(s)");
  });

  it("offline (board unreadable) and non-git are 'cannot tell', never in-sync", () => {
    const w = world({ linked: { ok: false, reason: "the board could not be read (offline)" } });
    const r = status(w);
    expect(r.text).to.match(/cannot tell\s+code repos/);
    expect(checksDiagnostic(checkStatusReport({}, deps(w), CFG))).to.include({ status: "warn" });
    expect(checksDiagnostic(checkStatusReport({}, deps(w), CFG)).detail).to.contain("cannot tell");

    const notGit = world();
    notGit.dirs.delete(`${GOV}/.git`);
    const s = status(notGit);
    expect(s.code).to.equal(1);
    expect(s.text).to.contain("cannot tell").and.contain("not a git working tree");
    const d = checksDiagnostic(checkStatusReport({}, deps(notGit), CFG));
    expect(d.status).to.equal("warn");
    expect(d.detail).to.match(/^cannot tell/);
  });

  it("a linked repo that is not cloned is 'cannot tell'", () => {
    const w = world({ linked: { ok: true, names: ["billing", "web"] } });
    expect(status(w).text).to.match(/cannot tell\s+web\s+not cloned/);
  });
});

describe("boardLinkedRepos", () => {
  it("the board's repositories by name, the governance repo left out; a failed read is a reason, not a throw", () => {
    const board = { fetchProject: () => ({ id: "x", title: "t", shortDescription: null, linkedItemCount: 3, repoUrls: ["https://github.com/acme/billing", "https://github.com/acme/acme-gov", "https://github.com/acme/billing"] }) };
    expect(boardLinkedRepos(board, "acme", "acme-gov")(7)).to.deep.equal({ ok: true, names: ["billing"] });
    const broken = { fetchProject: () => { throw new BoardFetchError("gh failed: offline"); } };
    const r = boardLinkedRepos(broken, "acme", "acme-gov")(7);
    expect(r.ok).to.equal(false);
    expect(!r.ok && r.reason).to.contain("offline");
  });
});

describe("gov doctor — one gov-checks row from `gov check status`", () => {
  const base = { gitPresent: true, ghPresent: true, resolve: { ok: false, code: 1 } as never, activeOrg: null, cliVersion: "1" };
  it("the row is the status, as given; not examined → no row", () => {
    const w = world({ linked: { ok: false, reason: "the board could not be read (offline)" } });
    const checksInstall = checksDiagnostic(checkStatusReport({}, deps(w), CFG));
    const row = doctor({ ...base, checksInstall }).diagnostics.find((d) => d.name === "gov-checks")!;
    expect(row.status).to.equal("warn");
    expect(row.detail).to.contain("cannot tell");
    expect(doctor(base).diagnostics.find((d) => d.name === "gov-checks")).to.equal(undefined);
  });
});
