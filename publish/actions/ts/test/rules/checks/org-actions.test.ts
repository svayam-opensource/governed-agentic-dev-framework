// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// ORG-AUTHORED CHECK ACTIONS — `bash` and `python` (PRJ-121 intent 05, Item 8; Policy Owner ruling Q8).
//
// The contract pinned here: `policies/actions/<name>/action.yaml` + an entry script, read from the DEFAULT branch
// only; env in (GOV_RULE_ID, GOV_EVENT, GOV_RESOURCE, GOV_REPO_DIR, GOV_PARAMS, GOV_CHANGED_FILES); exit code out
// (0 pass, 1 miss, anything else cannot-tell; a timeout cannot-tell) plus JSON-lines findings. No token reaches the
// action unless its action.yaml declares `needs: [github]`. These run REAL bash and python3 — the behaviour under
// test is a process's.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { expect } from "chai";
import { parseCatalog, type Catalog, type CheckBinding } from "../../../src/rules/model/catalog.js";
import type { RuleRow } from "../../../src/rules/model/rule-row.js";
import type { EventContext, RuleSet } from "../../../src/rules/model/contracts.js";
import { createCheckRunner } from "../../../src/rules/checks/runner.js";
import { checkCommand, type CheckVerbConfig, type CheckVerbDeps } from "../../../src/cli/check-verb.js";
import {
  createNodeActionExecutor, parseActionSpec, ACTIONS_DIR, type ActionExecutor, type ActionRun,
} from "../../../src/rules/checks/executor.js";

const here = dirname(fileURLToPath(import.meta.url));
const FRAMEWORK = parseCatalog(readFileSync(resolve(here, "../../../../../content/framework/rules/checks-catalog.yaml"), "utf8"));
const CATALOG: Catalog = {
  ...FRAMEWORK,
  actions: [...FRAMEWORK.actions, { id: "bash/lint", tool: "bash" }, { id: "python/lint-py", tool: "python" }],
};

const row = (id: string, checks: CheckBinding[]): RuleRow => ({
  id,
  source: { doc: "policies/org-policy.md", section: "3.1", sha: "a1b2c3" },
  expectation: "Every change passes the org's lint.",
  actor: ["everyone"],
  level: "C02",
  checks,
  start: { version: "1.0.0", date: "2026-10-06" },
  end: null,
});
const bind = (action: string, w: Record<string, unknown> = {}, on_miss: "fail" | "warn" = "fail"): CheckBinding =>
  ({ on: { resource: "vcs.code-repo", event: "pull_request" }, action, with: w, on_miss });
const rules = (checks: CheckBinding[]): RuleSet => ({ framework: [], org: [row("GOV-SVM-050", checks)], orgScope: "SVM", catalog: CATALOG, orgVersion: "1.0.0" });
const PR: EventContext = {
  resource: "vcs.code-repo", event: "pull_request",
  payload: { changed: [{ path: "src/a.ts", status: "modified", addedLines: ["x"], text: "x" }, { path: "README.md", status: "added", addedLines: [], text: "" }] },
};

/** The default branch's tree: path → text. Only what is here can run. */
const tree = (files: Record<string, string>) => ({
  readDefault: (p: string): string | null => files[p] ?? null,
  listDefault: (dir: string): string[] => Object.keys(files).filter((p) => p.startsWith(`${dir}/`)),
});
const bashAction = (script: string, yaml = "tool: bash\nentry: run.sh\n"): Record<string, string> => ({
  [`${ACTIONS_DIR}/lint/action.yaml`]: yaml,
  [`${ACTIONS_DIR}/lint/run.sh`]: script,
});
const PARENT_ENV = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: "/home/x", GH_TOKEN: "ghs_secret", GITHUB_TOKEN: "ghs_secret2", GOV_BOT_TOKEN: "tok", AWS_SECRET_ACCESS_KEY: "aws" };

const runWith = (files: Record<string, string>, checks: CheckBinding[], executor: ActionExecutor = createNodeActionExecutor()) =>
  createCheckRunner({ rules: rules(checks), ...tree(files), executor, env: PARENT_ENV, repoDir: process.cwd() }).run("GOV-SVM-050", PR);

describe("org check actions — bash and python (Item 8, Q8)", () => {
  it("exit 0 → pass", () => {
    const v = runWith(bashAction("exit 0\n"), [bind("bash/lint")]);
    expect(v.verdict).to.equal("pass");
  });

  it("exit 1 → miss → fail under on_miss: fail, with the JSON-lines findings (rule, file, line, message)", () => {
    const script = [
      `echo '{"rule":"GOV-SVM-050","file":"src/a.ts","line":3,"message":"no licence header"}'`,
      "echo 'a plain log line is not a finding'",
      `echo '{"message":"second finding"}'`,
      "exit 1",
    ].join("\n");
    const v = runWith(bashAction(script), [bind("bash/lint")]);
    expect(v.verdict).to.equal("fail");
    expect(v.findings).to.have.length(2);
    expect(v.findings[0]).to.equal("GOV-SVM-050 [bash/lint]: src/a.ts:3: no licence header");
    expect(v.findings[1]).to.equal("GOV-SVM-050 [bash/lint]: second finding");
  });

  it("exit 1 with no findings still fails, and says the action reported a miss", () => {
    const v = runWith(bashAction("exit 1\n"), [bind("bash/lint")]);
    expect(v.verdict).to.equal("fail");
    expect(v.findings.join()).to.match(/bash\/lint\]: the action reported a miss \(exit 1\)/);
  });

  it("exit 1 under on_miss: warn → pass with warn: findings (the same fold as a builtin)", () => {
    const v = runWith(bashAction(`echo '{"message":"x"}'; exit 1\n`), [bind("bash/lint", {}, "warn")]);
    expect(v.verdict).to.equal("pass");
    expect(v.findings).to.deep.equal(["warn: GOV-SVM-050 [bash/lint]: x"]);
  });

  it("exit 2 (any other code) → cannot-tell, naming the code and the last of stderr", () => {
    const v = runWith(bashAction("echo 'boom' >&2; exit 2\n"), [bind("bash/lint")]);
    expect(v.verdict).to.equal("cannot-tell");
    expect(v.findings.join()).to.match(/exited 2/).and.match(/boom/);
  });

  it("timeout → cannot-tell, naming the limit", function () {
    this.timeout(10_000);
    const v = runWith(bashAction("sleep 5\n", "tool: bash\nentry: run.sh\ntimeout: 0.5\n"), [bind("bash/lint")]);
    expect(v.verdict).to.equal("cannot-tell");
    expect(v.findings.join()).to.match(/timed out after 0\.5s/);
  });

  it("a failing check is not hidden by another that could not run: fail > cannot-tell > pass", () => {
    const files = { ...bashAction("exit 1\n"), [`${ACTIONS_DIR}/other/action.yaml`]: "tool: bash\nentry: run.sh\n", [`${ACTIONS_DIR}/other/run.sh`]: "exit 7\n" };
    const cat: Catalog = { ...CATALOG, actions: [...CATALOG.actions, { id: "bash/other", tool: "bash" }] };
    const v = createCheckRunner({ rules: { ...rules([bind("bash/lint"), bind("bash/other")]), catalog: cat }, ...tree(files), executor: createNodeActionExecutor(), env: PARENT_ENV, repoDir: process.cwd() }).run("GOV-SVM-050", PR);
    expect(v.verdict).to.equal("fail");
  });

  it("the action receives the contract's inputs: rule, event, resource, repo dir, params, changed files", () => {
    const script = [
      'test "$GOV_RULE_ID" = GOV-SVM-050 || exit 3',
      'test "$GOV_EVENT" = pull_request || exit 4',
      'test "$GOV_RESOURCE" = vcs.code-repo || exit 5',
      'test "$GOV_REPO_DIR" = "$PWD" || exit 6',
      `test "$GOV_PARAMS" = '{"max":3}' || exit 7`,
      'test "$(cat "$GOV_CHANGED_FILES")" = "$(printf "src/a.ts\\nREADME.md")" || exit 8',
      "exit 0",
    ].join("\n");
    const v = runWith(bashAction(script), [bind("bash/lint", { max: 3 })]);
    expect(v.findings).to.deep.equal([]);
    expect(v.verdict).to.equal("pass");
  });

  it("no GH_TOKEN, GITHUB_TOKEN or gov token in the child env — only the allow-list", () => {
    let seen: ActionRun | undefined;
    const spy: ActionExecutor = { run: (r) => { seen = r; return { kind: "exited", status: 0, stdout: "", stderr: "" }; } };
    runWith(bashAction("exit 0\n"), [bind("bash/lint")], spy);
    expect(seen).to.exist;
    expect(seen!.env).to.not.have.any.keys("GH_TOKEN", "GITHUB_TOKEN", "GOV_BOT_TOKEN", "AWS_SECRET_ACCESS_KEY");
    expect(seen!.env.PATH).to.equal(PARENT_ENV.PATH);
    expect(seen!.env.GOV_RULE_ID).to.equal("GOV-SVM-050");
  });

  it("the real child process sees no token either", () => {
    const v = runWith(bashAction('test -z "$GH_TOKEN$GITHUB_TOKEN$GOV_BOT_TOKEN" || exit 9\n'), [bind("bash/lint")]);
    expect(v.verdict).to.equal("pass");
  });

  it("needs: [github] passes GH_TOKEN and GITHUB_TOKEN — and still no other secret", () => {
    let seen: ActionRun | undefined;
    const spy: ActionExecutor = { run: (r) => { seen = r; return { kind: "exited", status: 0, stdout: "", stderr: "" }; } };
    runWith(bashAction("exit 0\n", "tool: bash\nentry: run.sh\nneeds: [github]\n"), [bind("bash/lint")], spy);
    expect(seen!.env.GH_TOKEN).to.equal("ghs_secret");
    expect(seen!.env.GITHUB_TOKEN).to.equal("ghs_secret2");
    expect(seen!.env).to.not.have.any.keys("GOV_BOT_TOKEN", "AWS_SECRET_ACCESS_KEY");
  });

  it("an action that is only on the pull request's head (not the default branch) → cannot-tell, never run", () => {
    let ran = false;
    const spy: ActionExecutor = { run: () => { ran = true; return { kind: "exited", status: 0, stdout: "", stderr: "" }; } };
    const v = runWith({}, [bind("bash/lint")], spy);
    expect(ran).to.equal(false);
    expect(v.verdict).to.equal("cannot-tell");
    expect(v.findings.join()).to.match(/not on the default branch/);
  });

  it("python: exit 0 → pass, exit 1 → fail", () => {
    const py = (code: number): Record<string, string> => ({
      [`${ACTIONS_DIR}/lint-py/action.yaml`]: "tool: python\nentry: run.py\n",
      [`${ACTIONS_DIR}/lint-py/run.py`]: `import json, sys\nprint(json.dumps({"message": "py says"}))\nsys.exit(${code})\n`,
    });
    expect(runWith(py(0), [bind("python/lint-py")]).verdict).to.equal("pass");
    const f = runWith(py(1), [bind("python/lint-py")]);
    expect(f.verdict).to.equal("fail");
    expect(f.findings).to.deep.equal(["GOV-SVM-050 [python/lint-py]: py says"]);
  });

  it("python3 missing → cannot-tell \"python3 not found\"", () => {
    const files = { [`${ACTIONS_DIR}/lint-py/action.yaml`]: "tool: python\nentry: run.py\n", [`${ACTIONS_DIR}/lint-py/run.py`]: "pass\n" };
    const v = runWith(files, [bind("python/lint-py")], createNodeActionExecutor({ python: "python3-not-installed-gov-test" }));
    expect(v.verdict).to.equal("cannot-tell");
    expect(v.findings.join()).to.match(/python3 not found/);
  });

  it("no executor here (a gov verb gate) → cannot-tell, never a pass", () => {
    const v = createCheckRunner({ rules: rules([bind("bash/lint")]), ...tree(bashAction("exit 0\n")) }).run("GOV-SVM-050", PR);
    expect(v.verdict).to.equal("cannot-tell");
    expect(v.findings.join()).to.match(/cannot run a bash action here/);
  });

  it("action.yaml whose tool disagrees with the catalog, or whose entry is missing or escapes the folder → cannot-tell", () => {
    expect(runWith(bashAction("exit 0\n", "tool: python\nentry: run.sh\n"), [bind("bash/lint")]).findings.join()).to.match(/says tool "python".*catalog.*bash/);
    expect(runWith(bashAction("exit 0\n", "tool: bash\nentry: nope.sh\n"), [bind("bash/lint")]).findings.join()).to.match(/entry "nope.sh" is not in/);
    expect(runWith(bashAction("exit 0\n", "tool: bash\nentry: ../x.sh\n"), [bind("bash/lint")]).verdict).to.equal("cannot-tell");
    expect(runWith(bashAction("exit 0\n", "tool: bash\n"), [bind("bash/lint")]).verdict).to.equal("cannot-tell");
  });
});

describe("org check actions — action.yaml", () => {
  it("parses tool, entry, timeout (default 60s) and needs", () => {
    expect(parseActionSpec("tool: bash\nentry: run.sh\n")).to.deep.equal({ ok: true, spec: { tool: "bash", entry: "run.sh", timeoutSec: 60, needs: [] } });
    expect(parseActionSpec("tool: python\nentry: run.py\ntimeout: 5\nneeds: [github]\n")).to.deep.equal({ ok: true, spec: { tool: "python", entry: "run.py", timeoutSec: 5, needs: ["github"] } });
  });

  it("refuses an unknown tool, a bad timeout and an unknown need — never a guess", () => {
    expect(parseActionSpec("tool: ruby\nentry: run.rb\n").ok).to.equal(false);
    expect(parseActionSpec("tool: bash\nentry: run.sh\ntimeout: -1\n").ok).to.equal(false);
    expect(parseActionSpec("tool: bash\nentry: run.sh\nneeds: [aws]\n").ok).to.equal(false);
    expect(parseActionSpec(": : not yaml").ok).to.equal(false);
  });
});

describe("gov check run — an org bash action, end to end over a fake git", () => {
  const CONTENT = resolve(here, "../../../../../content");
  const ORG_ROW = [
    "- id: GOV-ACME-001",
    "  source: { doc: policies/org-policy.md, section: \"4\", sha: abc1234 }",
    "  expectation: Every change passes the org's lint.",
    "  actor: [everyone]",
    "  level: C02",
    "  checks:",
    "    - { on: { resource: vcs.code-repo, event: pull_request }, action: bash/lint, on_miss: fail }",
    "  start: { version: 1.0.0, date: \"2026-10-06\" }",
    "  end: null",
    "",
  ].join("\n");
  const DEFAULT: Record<string, string> = {
    "org-config.yaml": 'org_slug: "ACME"\n',
    "policies/governance.yaml": 'policy_owner:\n  github: "@polly"\ncheck_owner:\n  github: "chuck"\n',
    "framework/rules/rules.yaml": readFileSync(resolve(CONTENT, "framework/rules/rules.yaml"), "utf8"),
    "framework/rules/checks-catalog.yaml": readFileSync(resolve(CONTENT, "framework/rules/checks-catalog.yaml"), "utf8"),
    "policies/org-policy.md": "## 4 Lint\n\nLint it.\n",
    "policies/VERSION": "1.0.0\n",
    "policies/rules/rules.yaml": ORG_ROW,
    "policies/rules/checks-catalog.yaml": "resources: []\ntools: []\nactions:\n  - { id: bash/lint, tool: bash, reviewed: { by: chuck, pr: 3 } }\n",
    [`${ACTIONS_DIR}/lint/action.yaml`]: "tool: bash\nentry: run.sh\n",
    [`${ACTIONS_DIR}/lint/run.sh`]: `echo '{"file":"src/a.ts","line":1,"message":"default-branch code ran"}'\nexit 1\n`,
  };
  /** git -C <repo>: the gov repo at origin/main only. The PR head's copy of the action is never asked for. */
  const git = (files: Record<string, string>) => (_repo: string, args: readonly string[]): string | null => {
    if (args[0] === "rev-parse") return args.includes("origin/main") ? "abc" : null;
    if (args[0] === "ls-tree") {
      const want = args.slice(args.indexOf("--") + 1);
      return Object.keys(files).filter((f) => want.some((p) => f === p || f.startsWith(`${p}/`))).join("\n");
    }
    if (args[0] === "show" && args[1]?.startsWith("origin/main:")) return files[args[1].slice("origin/main:".length)] ?? null;
    return null;
  };
  const CFG: CheckVerbConfig = { home: "/gov", defaultBranch: "main", defaultCodeBranch: "dev", githubOrg: "acme", workspaceRepo: "acme-gov", posture: "soft" };
  const deps = (files: Record<string, string>, executor?: ActionExecutor): CheckVerbDeps => ({
    git: git(files), gh: () => null, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", GH_TOKEN: "ghs_secret" },
    readFile: () => null, writeFile: () => undefined, ...(executor ? { executor } : {}),
  });
  const ARGS = { resource: "vcs.code-repo", event: "pull_request", "repo-dir": process.cwd() };

  it("runs the default branch's code and fails the gate (exit 1) with the action's finding", () => {
    const r = checkCommand(["run", "GOV-ACME-001"], ARGS, deps(DEFAULT, createNodeActionExecutor()), CFG);
    const text = r.lines.join("\n");
    expect(r.code, text).to.equal(1);
    expect(text).to.contain("src/a.ts:1: default-branch code ran");
  });

  it("with the action only on the PR head (absent at origin/main) → cannot-tell, not a pass", () => {
    const only = Object.fromEntries(Object.entries(DEFAULT).filter(([k]) => !k.startsWith(ACTIONS_DIR)));
    const r = checkCommand(["run", "GOV-ACME-001"], ARGS, deps(only, createNodeActionExecutor()), { ...CFG, posture: "hard" });
    const text = r.lines.join("\n");
    expect(r.code, text).to.equal(1);
    expect(text).to.contain("not on the default branch").and.contain("COULD NOT TELL");
  });

  it("the child env carries no GH_TOKEN from gov's env", () => {
    let env: Readonly<Record<string, string>> = {};
    const spy: ActionExecutor = { run: (x) => { env = x.env; return { kind: "exited", status: 0, stdout: "", stderr: "" }; } };
    expect(checkCommand(["run", "GOV-ACME-001"], ARGS, deps(DEFAULT, spy), CFG).code).to.equal(0);
    expect(env).to.not.have.key("GH_TOKEN");
    expect(env.GOV_REPO_DIR).to.equal(process.cwd());
  });
});
