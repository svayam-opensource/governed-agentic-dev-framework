// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * HEADLESS AGENT MODE (PRJ-121 intent 03, L16; spec 03 §3.3–§3.4, Q10, Q16).
 *
 * `gov autorun` runs an agent with nobody at the terminal. Three things must hold before it may:
 *
 *   1. ONLY AN AGENT WHOSE NON-INTERACTIVE MODE WAS SEEN (Q16 (b)). `headlessArgv` in the catalog, with a dated
 *      note of the run that verified it. Anything else is refused with a reason — never launched "interactively,
 *      and hope", which would hang a run on a prompt nobody will answer.
 *   2. THE SAME SESSION-START PROTOCOL (§3.4). The headless kickoff is the prompt `gov work` injects, from ONE
 *      function, so the two cannot drift.
 *   3. AN EXIT THAT CARRIES A C01 ID HALTS (Q10 (b)); any other non-zero exit is a per-item failure (Q10 (c) is
 *      NOT a halt); zero is ok.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_CATALOG, type AgentCandidate } from "../../src/cli/agent-catalog.js";
import {
  classifyHeadlessExit, c01IdsFromRules, headlessLaunchSpec, kickoffPrompt, runHeadless, runWorkFlow,
  type WorkFlowDeps,
} from "../../src/cli/work-flow.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import { runCaptureAsync } from "../../src/run-process.js";
import type { RuleRow } from "../../src/rules/model/rule-row.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE_AGENT = path.resolve(here, "../../e2e/stub/headless-agent");

const C01 = new Set(["GOV-FRM-124", "GOV-ACME-007"]);
const isC01 = (id: string): boolean => C01.has(id);

/** A catalog of two: one with a verified headless mode (the fake agent), one without. */
const fakeCatalog = (cmd = FAKE_AGENT): readonly AgentCandidate[] => [
  { id: "fake", tool: "Fake Agent", launch: "cli", cmd, promptArgv: ["{prompt}"],
    headlessArgv: ["-p", "{prompt}", "--output-format", "text"], headlessVerified: "2026-10-12 fake 9.9.9: test double" },
  { id: "chatty", tool: "Chatty", launch: "cli", cmd: "chatty", promptArgv: ["{prompt}"] },
];

describe("headless launch — who may run without a person (03-Q16)", () => {
  it("refuses an agent with no headlessArgv, and says why", () => {
    const r = headlessLaunchSpec("chatty", "kick", fakeCatalog());
    expect(r).to.have.property("refused");
    const reason = (r as { refused: string }).refused;
    expect(reason).to.contain("Chatty");
    expect(reason).to.match(/no verified headless mode/);
    expect(reason).to.contain("headlessArgv");
  });

  it("refuses an agent gov does not know, and a launch kind with no command", () => {
    expect(headlessLaunchSpec("nobody", "kick", fakeCatalog())).to.have.property("refused").that.contains("nobody");
    expect(headlessLaunchSpec("chatgpt-web", "kick")).to.have.property("refused");
    expect(headlessLaunchSpec("shell", "kick")).to.have.property("refused");
  });

  it("every catalog headlessArgv carries {prompt} once and a dated verification note", () => {
    const headless = AGENT_CATALOG.filter((a) => a.headlessArgv);
    expect(headless.length, "at least one agent can run headless").to.be.greaterThan(0);
    for (const a of headless) {
      expect(a.headlessArgv!.filter((x) => x.includes("{prompt}")), a.id).to.have.length(1);
      expect(a.headlessVerified ?? "", `${a.id}: headlessArgv without a dated verification note`).to.match(/^\d{4}-\d{2}-\d{2} /);
    }
    // L16's scope: only the two agents the plan names may carry one.
    for (const a of headless) expect(["claude-code", "cursor"]).to.include(a.id);
  });

  it("claude-code runs headless with -p and plain-text output", () => {
    const s = headlessLaunchSpec("claude-code", "KICK");
    expect(s).to.deep.include({ cmd: "claude" });
    expect((s as { args: readonly string[] }).args).to.deep.equal(["-p", "KICK", "--output-format", "text"]);
  });

  it("an agent run headless is refused at run time too, without spawning", async () => {
    let spawned = 0;
    const r = await runHeadless({ exec: async () => { spawned++; return { code: 0, stdout: "", stderr: "" }; } },
      { agent: "chatty", cwd: "/w/PRJ-1", kickoff: "kick", isC01 }, fakeCatalog());
    expect(r.outcome).to.equal("refused");
    expect(r.reason).to.match(/no verified headless mode/);
    expect(spawned).to.equal(0);
  });
});

/** The harness the interactive tests use, cut to one cloned project and one installed, approved agent. */
function interactiveDeps(launched: { agent: string; cwd: string; inject: string }[]): WorkFlowDeps {
  const paths = ["/work/PRJ-7-alpha", "/work/PRJ-7-alpha/acme-gov/.git"];
  const fakeFs: Fs = {
    pathExists: (p) => paths.includes(p.replaceAll("\\", "/")),
    readFile: (f) => (f.replaceAll("\\", "/").endsWith("/.git/HEAD") ? "ref: refs/heads/BRNCH-7-alpha\n" : null),
    writeFile() {}, mkdirp() {}, rm() {},
    readdir: (d) => (d.replaceAll("\\", "/") === "/work" ? ["PRJ-7-alpha"] : []),
    mtimeMs: () => null,
  };
  return {
    projects: { listBoards: () => [{ number: 7, title: "Alpha", url: "https://github.com/orgs/Acme/projects/7", closed: false }] },
    anchor: { createAnchorIssue: () => null, setState: () => true, setAssignee: () => true, find: () => null, findAll: () => new Map() },
    fs: fakeFs,
    config: { githubOrg: "Acme", workspaceRepo: "acme-gov", agentWorkRoot: "/work", govHome: "/home/rk/.gov/acme/gov_repo" },
    me: "rk",
    canWriteBoard: () => true,
    run: () => 0,
    prompt: async () => "",
    print: () => {},
    launch: async (agent, cwd, inject) => { launched.push({ agent, cwd: cwd.replaceAll("\\", "/"), inject }); return 0; },
    hasTool: (c) => c === "claude",
    env: {},
    ask: { line: async () => "", secret: async () => "" },
    approvedAgents: () => [{ id: "claude-code", default: true }],
    snapshotGovernance: (dir) => ({ dir: `${dir}/.gov/governance`, files: ["org-config.yaml", "framework-specification.md"], source: "main@abc1234" }),
  };
}

describe("headless launch — the same kickoff as `gov work` (§3.4)", () => {
  it("the prompt an interactive launch injects is kickoffPrompt(), and the headless argv carries it verbatim", async () => {
    const launched: { agent: string; cwd: string; inject: string }[] = [];
    const deps = interactiveDeps(launched);
    const code = await runWorkFlow(deps, { currentProject: "PRJ-7-alpha", agent: "claude-code", interactive: false, agentAsk: "never" });
    expect(code).to.equal(0);
    expect(launched).to.have.length(1);
    const interactive = launched[0]!.inject;

    const snap = deps.snapshotGovernance!(path.join("/work", "PRJ-7-alpha"));
    const kick = kickoffPrompt("PRJ-7-alpha", deps.config, snap);
    expect(kick).to.equal(interactive);

    const s = headlessLaunchSpec("claude-code", kick) as { args: readonly string[]; promptText: string };
    expect(s.args).to.include(interactive);
    expect(s.promptText).to.equal(interactive);
  });

  it("a task brief goes AFTER the kickoff, never instead of it", () => {
    const s = headlessLaunchSpec("fake", "KICK", fakeCatalog(), "Draft spec.md for intent 04.") as { args: readonly string[]; promptText: string };
    expect(s.promptText.startsWith("KICK\n\n")).to.equal(true);
    expect(s.promptText.endsWith("Draft spec.md for intent 04.")).to.equal(true);
    expect(s.args[1]).to.equal(s.promptText);
  });
});

describe("headless launch — reading the exit (03-Q10)", () => {
  it("zero → ok, even when the output cites a C01 rule (a manifest names its rules)", () => {
    expect(classifyHeadlessExit(0, "read GOV-FRM-124, posted the manifest", isC01)).to.deep.equal({ outcome: "ok", c01Ids: [] });
  });

  it("non-zero with a C01 id in the output → c01, naming the ids", () => {
    const r = classifyHeadlessExit(1, "refused: GOV-ACME-007 — the board is closed\nalso GOV-FRM-124", isC01);
    expect(r.outcome).to.equal("c01");
    expect(r.c01Ids).to.deep.equal(["GOV-ACME-007", "GOV-FRM-124"]);
  });

  it("non-zero with only non-C01 ids, or none → failed (a per-item failure, not a halt)", () => {
    expect(classifyHeadlessExit(2, "GOV-FRM-999 is a C03 nudge", isC01).outcome).to.equal("failed");
    expect(classifyHeadlessExit(1, "tests failed", isC01).outcome).to.equal("failed");
  });

  it("killed or timed out (no exit code) → failed", () => {
    expect(classifyHeadlessExit(null, "", isC01).outcome).to.equal("failed");
  });

  it("the C01 set is the in-force C01 rows of the rule stores", () => {
    const row = (id: string, level: RuleRow["level"], end: RuleRow["end"] = null): RuleRow => ({
      id, level, end, source: { doc: "d", section: "s", sha: "x" }, expectation: "agent does x", actor: ["agent"],
      start: { version: "1.0.0", date: "2026-10-01" },
    });
    const set = c01IdsFromRules([row("GOV-FRM-001", "C01"), row("GOV-FRM-002", "C02"),
      row("GOV-FRM-003", "C01", { version: "1.1.0", date: "2026-10-02" })]);
    expect([...set]).to.deep.equal(["GOV-FRM-001"]);
  });
});

describe("headless launch — the fake agent L17 drives (e2e/stub/headless-agent)", function () {
  this.timeout(20_000);
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "gov-headless-")); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const run = (env: Record<string, string>, timeoutMs?: number) => runHeadless(
    { exec: (cmd, args, o) => runCaptureAsync(cmd, args, { ...o, env: { ...process.env, ...env } }) },
    { agent: "fake", cwd: dir, kickoff: "KICKOFF", task: "TASK", isC01, timeoutMs }, fakeCatalog());

  it("ok path: writes the files it is told to, records its prompt, exits 0", async () => {
    const r = await run({ FAKE_AGENT_WRITE: "notes/a.md:hello|b.txt:world", FAKE_AGENT_PROMPT_FILE: path.join(dir, "prompt.txt") });
    expect(r.outcome).to.equal("ok");
    expect(r.exitCode).to.equal(0);
    expect(fs.readFileSync(path.join(dir, "notes/a.md"), "utf8")).to.equal("hello");
    expect(fs.readFileSync(path.join(dir, "b.txt"), "utf8")).to.equal("world");
    expect(fs.readFileSync(path.join(dir, "prompt.txt"), "utf8")).to.equal("KICKOFF\n\nTASK");
  });

  it("prints a C01 id and exits non-zero → c01", async () => {
    const r = await run({ FAKE_AGENT_C01: "GOV-FRM-124", FAKE_AGENT_EXIT: "3" });
    expect(r.outcome).to.equal("c01");
    expect(r.c01Ids).to.deep.equal(["GOV-FRM-124"]);
    expect(r.exitCode).to.equal(3);
  });

  it("other non-zero → failed", async () => {
    const r = await run({ FAKE_AGENT_PRINT: "something broke", FAKE_AGENT_EXIT: "1" });
    expect(r.outcome).to.equal("failed");
    expect(r.output).to.contain("something broke");
  });

  it("runs a scripted step in the project directory (FAKE_AGENT_RUN)", async () => {
    const r = await run({ FAKE_AGENT_RUN: "printf x > ran-here" });
    expect(r.outcome).to.equal("ok");
    expect(fs.existsSync(path.join(dir, "ran-here"))).to.equal(true);
  });

  it("a sleep past the time budget is killed and reported failed", async () => {
    const t0 = Date.now();
    const r = await run({ FAKE_AGENT_SLEEP: "5" }, 300);
    expect(Date.now() - t0, "killed with what it started, not waited out").to.be.lessThan(3_000);
    expect(r.outcome).to.equal("failed");
    expect(r.timedOut).to.equal(true);
  });
});
