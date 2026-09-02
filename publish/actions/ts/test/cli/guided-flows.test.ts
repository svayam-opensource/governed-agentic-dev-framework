// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { myProjects, seedableBoards, workspaceState, runWorkFlow, agentLaunchSpec, sessionStartPrompt, ensureRootProtocol, startSession, projectFromPath, matchProjects, resolveAgent, type WorkFlowDeps } from "../../src/cli/work-flow.js";
import type { Projects } from "../../src/lifecycle/project-list.js";
import type { AnchorCreator, AnchorInfo } from "../../src/lifecycle/anchor.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import { px, pxAbs, pxAll, pxDeep } from "../helpers/paths.js";

const projects = (boards: Array<{ number: number; title: string; closed?: boolean }>): Projects => ({
  listBoards: () => boards.map((b) => ({ number: b.number, title: b.title, url: `https://github.com/orgs/Acme/projects/${b.number}`, closed: b.closed ?? false })),
});
const anchorFor = (byNum: Record<number, string[]>): AnchorCreator => ({
  createAnchorIssue: () => null, setState: () => true, setAssignee: () => true,
  find: (ref) => (byNum[ref.number] ? ({ url: `u#1`, number: 1, labels: [], assignees: byNum[ref.number] } as AnchorInfo) : null),
});
const fsWith = (paths: string[]): Fs => ({ pathExists: (p) => paths.some((x) => x === px(p) || x.startsWith(px(p) + "/")), readFile: () => null, writeFile() {}, mkdirp() {}, rm() {}, readdir: () => [] });

function deps(over: Partial<WorkFlowDeps> = {}): { deps: WorkFlowDeps; out: string[]; ran: string[][]; launched: Array<[string, string]> } {
  const out: string[] = []; const ran: string[][] = []; const launched: Array<[string, string]> = [];
  const base: WorkFlowDeps = {
    projects: projects([{ number: 7, title: "Alpha" }, { number: 8, title: "Beta" }]),
    anchor: anchorFor({ 7: ["rk"], 8: ["someone-else"] }),
    fs: fsWith([]),
    config: { githubOrg: "Acme", workspaceRepo: "acme-gov", agentWorkRoot: "/work" },
    me: "rk",
    canWriteBoard: () => true,
    run: (argv) => { ran.push([...argv]); return 0; },
    prompt: async () => "1",
    print: (l) => out.push(l),
    launch: async (agent, cwd) => { launched.push([agent, cwd]); return 0; },
    // A machine with the two agents this suite's tests assume. The menu now offers
    // only what is installed (#195), so "nothing installed" is its own case below
    // rather than the silent default every test inherits.
    hasTool: (cmd: string) => cmd === "claude" || cmd === "cursor-agent",
    env: {},
    ...over,
  };
  return { deps: base, out, ran, launched };
}

describe("gov-work — guided Work flow", () => {
  it("myProjects = open boards where I'm an anchor assignee", () => {
    const { deps: d } = deps();
    const mine = myProjects(d);
    expect(mine.map((p) => p.boardNumber)).to.deep.equal([7]); // board 8 is someone else's
    expect(mine[0].projectId).to.match(/^PRJ-7-alpha$/);
  });

  it("seedableBoards = open boards I can WRITE but that have NO anchor yet (startable in Work, not just pickable)", () => {
    // Regression guard (2026-07-17): a freshly-created board (e.g. #106) wasn't offered in Work because it had
    // no anchor yet. Work must surface writable, un-seeded boards so they can be started.
    const { deps: d } = deps({
      projects: projects([{ number: 7, title: "Alpha" }, { number: 9, title: "Infra" }, { number: 10, title: "Locked" }]),
      anchor: anchorFor({ 7: ["rk"] }),   // 7 is already seeded; 9 + 10 are un-anchored
      canWriteBoard: (n) => n !== 10,     // I can't seed 10
    });
    expect(seedableBoards(d).map((p) => p.boardNumber)).to.deep.equal([9]);   // 7 anchored (myProjects), 10 not writable
    expect(seedableBoards(d)[0].status).to.equal("not started");
  });

  it("workspaceState: not-seeded → not-cloned → ready", () => {
    const p = { boardNumber: 7, title: "Alpha", url: "u", status: "active", projectId: "PRJ-7-alpha" };
    expect(workspaceState({ ...deps().deps, fs: fsWith([]) }, p)).to.equal("not-seeded");
    expect(workspaceState({ ...deps().deps, fs: fsWith(["/work/PRJ-7-alpha"]) }, p)).to.equal("not-cloned");
    expect(workspaceState({ ...deps().deps, fs: fsWith(["/work/PRJ-7-alpha/acme-gov/.git"]) }, p)).to.equal("ready");
  });

  it("picks my project, seeds when not present, then LAUNCHES the chosen agent in <project>", async () => {
    const { deps: d, out, ran, launched } = deps({ prompt: async () => "1" });   // project 1, then agent 1 (Claude)
    const code = await runWorkFlow(d);
    expect(ran[0][0]).to.equal("seed");          // not-seeded → seed
    expect(out.join("\n")).to.match(/is ready at/);
    expect(launched.map(([a, c]) => [a, px(c)])).to.deep.equal([["claude", "/work/PRJ-7-alpha"]]);   // launch-in-<project> (NOT the workspace subdir)
    expect(code).to.equal(0);
  });

  it("agent picker '0) later' → no launch, prints the manual command", async () => {
    let calls = 0;
    const { deps: d, out, launched } = deps({ prompt: async () => (++calls === 1 ? "1" : "0") });   // project 1, then 'later'
    await runWorkFlow(d);
    expect(launched).to.deep.equal([]);
    expect(out.join("\n")).to.match(/Later:.*cd/);
  });

  it("lists newest board first + paginates, probing access ONLY for the visible page (no long wait)", async () => {
    const boards = Array.from({ length: 20 }, (_, i) => ({ number: i + 1, title: `P${i + 1}` }));   // 1..20, all un-anchored
    const probed: number[] = [];
    const { deps: d, out } = deps({
      projects: projects(boards), anchor: anchorFor({}),
      canWriteBoard: (n) => { probed.push(n); return true; },
      prompt: async () => "0",   // back after page 1
    });
    await runWorkFlow(d);
    expect(probed.length).to.equal(15);   // only the first page probed, not all 20
    expect(probed[0]).to.equal(20);       // newest board first (sorted desc)
    expect(out.join("\n")).to.match(/m\) more/);
  });

  it("blocks when the board isn't writable by me", async () => {
    const { deps: d, out } = deps({ canWriteBoard: () => false, prompt: async () => "1" });
    expect(await runWorkFlow(d)).to.equal(1);
    expect(out.join("\n")).to.match(/write access/);
  });

  it("tells me to get assigned when I own no projects", async () => {
    const { deps: d, out } = deps({ anchor: anchorFor({ 8: ["x"] }), canWriteBoard: () => false });   // 8 is someone else's; nothing seedable
    expect(await runWorkFlow(d)).to.equal(0);
    expect(out.join("\n")).to.match(/No active or startable projects/);
  });

  it("agent picker maps every choice to the right agent, launched in <project>", async () => {
    // The numbering is derived from what is installed now (#195), so the machine has
    // to be stated: claude, cursor-agent and the cursor editor all present gives
    // 1) Claude  2) Cursor  3) Cursor editor  4) shell.
    const machine = (c: string) => ["claude", "cursor-agent", "cursor"].includes(c);
    for (const [choice, kind] of [["1", "claude"], ["2", "cursor"], ["3", "cursor-gui"], ["4", "shell"]] as const) {
      let calls = 0;
      const { deps: d, launched } = deps({ hasTool: machine, prompt: async () => (++calls === 1 ? "1" : choice) });
      await runWorkFlow(d);
      expect(launched.map(([a, c]) => [a, px(c)]), `choice ${choice}`).to.deep.equal([[kind, "/work/PRJ-7-alpha"]]);
    }
  });

  it("agentLaunchSpec: right binary + detached flag + inject-as-first-message (guards the launch mapping)", () => {
    expect(agentLaunchSpec("claude", "/p", "GO")).to.deep.equal({ cmd: "claude", args: ["GO"], detached: false });          // speak-first
    expect(agentLaunchSpec("cursor", "/p", "GO")).to.deep.equal({ cmd: "cursor-agent", args: ["GO"], detached: false });    // speak-first
    expect(agentLaunchSpec("cursor-gui", "/p", "GO")).to.deep.equal({ cmd: "cursor", args: ["/p"], detached: true });        // GUI opens the dir, detached
    expect(agentLaunchSpec("shell", "/p", "GO", { SHELL: "/bin/fish" } as NodeJS.ProcessEnv)).to.deep.equal({ cmd: "/bin/fish", args: [], detached: false });
  });

  it("sessionStartPrompt: kickoff runs session-start first + references the right workspace-relative files", () => {
    const p = sessionStartPrompt("PRJ-106-infra", "svm-prj-work");
    expect(p).to.match(/Run the session-start protocol for PRJ-106-infra now, before I send anything else/);
    expect(p).to.contain("svm-prj-work/org-config.yaml");
    expect(p).to.contain("svm-prj-work/projects/PRJ-106-infra/knowledge/todo.md");
    expect(p).to.match(/post the context manifest/);
  });

  it("ensureRootProtocol drops a root CLAUDE.md (@-import) + a SessionStart hook — idempotent, never clobbers", () => {
    const writes: Array<[string, string]> = [];
    const d = { ...deps().deps, fs: { ...fsWith([]), writeFile: (p: string, c: string) => writes.push([p, c]) } };
    ensureRootProtocol(d.fs, "/work/PRJ-9-infra", "acme-gov");
    const byPath = Object.fromEntries(writes.map(([f, c]) => [px(f), c]));
    expect(byPath["/work/PRJ-9-infra/CLAUDE.md"]).to.equal("@acme-gov/agent/session-protocol.md\n@acme-gov/framework/agent.md\n");
    expect(byPath["/work/PRJ-9-infra/.claude/settings.json"]).to.match(/SessionStart/);
    // idempotent: nothing re-written when the root protocol + hook already exist
    const w2: Array<[string, string]> = [];
    const d2 = { ...deps().deps, fs: { ...fsWith(["/work/PRJ-9-infra/CLAUDE.md", "/work/PRJ-9-infra/.claude/settings.json"]), writeFile: (p: string, c: string) => w2.push([p, c]) } };
    ensureRootProtocol(d2.fs, "/work/PRJ-9-infra", "acme-gov");
    expect(w2).to.have.length(0);
  });

  it("ensureRootProtocol mirrors the FULL harness — every agent's entrypoint at <project>, not just Claude", () => {
    const writes: Array<[string, string]> = []; const dirs: string[] = [];
    const fs = {
      ...fsWith([]),
      readFile: (f: string) => (f.endsWith("AGENTS.md") || f.endsWith("agent.mdc")) ? `# rendered protocol (${f})` : null,   // these rendered; others absent
      writeFile: (p: string, c: string) => writes.push([p, c]),
      mkdirp: (dir: string) => dirs.push(dir),
    };
    ensureRootProtocol(fs, "/work/PRJ-9", "acme-gov");
    const written = writes.map(([p]) => p);
    expect(pxAll(written)).to.include("/work/PRJ-9/CLAUDE.md");                 // Claude via @-import stub
    expect(pxAll(written)).to.include("/work/PRJ-9/AGENTS.md");                 // Codex/Cursor — copied
    expect(pxAll(written)).to.include("/work/PRJ-9/.cursor/rules/agent.mdc");   // Cursor — copied (nested)
    expect(pxAll(dirs)).to.include("/work/PRJ-9/.cursor/rules");               // mkdirp for the nested path
    expect(written).to.not.include("/work/PRJ-9/CONVENTIONS.md");        // not rendered here → skipped
  });

  it("session-start FIRES for Claude — root CLAUDE.md import + SessionStart hook + injected kickoff", () => {
    const w: Array<[string, string]> = []; const dirs: string[] = [];
    const fs = { ...fsWith([]), writeFile: (p: string, c: string) => w.push([p, c]), mkdirp: (d: string) => dirs.push(d) };
    ensureRootProtocol(fs, "/work/PRJ-9", "acme-gov");
    const byPath = Object.fromEntries(w.map(([f, c]) => [px(f), c]));
    expect(byPath["/work/PRJ-9/CLAUDE.md"], "protocol loaded at root").to.match(/@acme-gov\/agent\/session-protocol\.md/);
    expect(byPath["/work/PRJ-9/.claude/settings.json"], "fires on a bare/`/clear` launch").to.match(/"SessionStart"/);
    expect(pxAll(dirs)).to.include("/work/PRJ-9/.claude");
    expect(agentLaunchSpec("claude", "/work/PRJ-9", "KICK").args, "speak-first on Work launch").to.deep.equal(["KICK"]);
  });

  it("session-start FIRES for cursor (CLI) — injected kickoff + alwaysApply rule mirrored to root", () => {
    const w: Array<[string, string]> = [];
    const fs = { ...fsWith([]), readFile: (f: string) => f.endsWith("agent.mdc") ? "---\nalwaysApply: true\n---\n<protocol>" : null, writeFile: (p: string, c: string) => w.push([p, c]), mkdirp: () => {} };
    ensureRootProtocol(fs, "/work/PRJ-9", "acme-gov");
    expect(Object.fromEntries(w.map(([f, c]) => [px(f), c]))["/work/PRJ-9/.cursor/rules/agent.mdc"], "always-on rule at root").to.match(/alwaysApply: true/);
    expect(agentLaunchSpec("cursor", "/work/PRJ-9", "KICK").args, "speak-first").to.deep.equal(["KICK"]);
  });

  it("session-start FIRES for cursor GUI — alwaysApply rule mirrored to <project> (auto-applies; GUI opens the dir)", () => {
    const w: Array<[string, string]> = [];
    const fs = { ...fsWith([]), readFile: (f: string) => f.endsWith("agent.mdc") ? "---\nalwaysApply: true\nglobs: [\"**/*\"]\n---\n<protocol>" : null, writeFile: (p: string, c: string) => w.push([p, c]), mkdirp: () => {} };
    ensureRootProtocol(fs, "/work/PRJ-9", "acme-gov");
    expect(Object.fromEntries(w.map(([f, c]) => [px(f), c]))["/work/PRJ-9/.cursor/rules/agent.mdc"]).to.match(/alwaysApply: true/);
    expect(agentLaunchSpec("cursor-gui", "/work/PRJ-9", "KICK")).to.deep.equal({ cmd: "cursor", args: ["/work/PRJ-9"], detached: true });   // cwd passes through verbatim
  });
});


/**
 * `gov work` — starting a session on an existing project WITHOUT a terminal.
 *
 * The guided Work flow does this from the menu and launches an agent, but that path is gated on
 * `process.stdin.isTTY`. The kickoff prompt exists to drive an AGENT, and agents are precisely the non-TTY
 * case — so the resolution is pure and the verb prints what a script needs.
 */
describe("work — non-TTY session start", () => {
  const ROOT = "/w/projects";
  const has = (dirs: string[]) => (p: string): boolean => dirs.includes(px(p));

  it("resolves the project, its directory, and the SAME prompt the menu injects", () => {
    const s = startSession(ROOT, "gov_repo", "PRJ-43-gov", has([`${ROOT}/PRJ-43-gov`]));
    expect(px(s!.dir)).to.equal(`${ROOT}/PRJ-43-gov`);
    expect(s?.prompt).to.equal(sessionStartPrompt("PRJ-43-gov", "gov_repo"));
    // the prompt must name the four files the session-start protocol requires
    expect(s?.prompt).to.contain("gov_repo/org-config.yaml");
    expect(s?.prompt).to.contain("gov_repo/projects/PRJ-43-gov/agent.md");
    expect(s?.prompt).to.contain("agentic-development-policy.md");
    expect(s?.prompt).to.contain("todo.md");
  });

  it("a project that is not cloned resolves to nothing — the caller says how to get it", () => {
    expect(startSession(ROOT, "gov_repo", "PRJ-99", has([]))).to.equal(undefined);
  });

  // THE BUG THIS VERB SHIPPED WITH, caught by running it: the work root must be org-config's
  // `agent_work_root`, not dispatch's `projectWorkRoot` (= dirname(ctx.home), relative to whichever clone
  // resolved). With the wrong root, `gov work` inside a project resolved the project as "projects" and
  // produced a prompt pointing at `projects/projects/agent.md` — confidently wrong, and it ran fine.
  it("infers the project from the cwd, at any depth, and only under the work root", () => {
    expect(projectFromPath(ROOT, `${ROOT}/PRJ-43-gov`)).to.equal("PRJ-43-gov");
    expect(projectFromPath(ROOT, `${ROOT}/PRJ-43-gov/910-GOV-CICD/src`)).to.equal("PRJ-43-gov");
    expect(projectFromPath(`${ROOT}/`, `${ROOT}/PRJ-43-gov/x`), "a trailing separator changes nothing").to.equal("PRJ-43-gov");
  });

  it("outside the work root there is no project — not a guess", () => {
    expect(projectFromPath(ROOT, "/somewhere/else")).to.equal(undefined);
    expect(projectFromPath(ROOT, ROOT), "the work root itself is not a project").to.equal(undefined);
    expect(projectFromPath(ROOT, `${ROOT}-old/PRJ-1`), "prefix match is not containment").to.equal(undefined);
  });
});

/**
 * `gov work` with flags — the ladder, the consent rule, and refusing to guess without a terminal.
 *
 * The flow already did state resolution (seed if new, join if not cloned, else launch). What is new is that
 * it can be TOLD the project and the agent, so a script reaches the same place a menu user does — and that
 * it asks before doing anything the rest of the org can see.
 */
describe("work — flags, consent, and no-terminal behaviour", () => {
  const seeded = "/work/PRJ-7-alpha";
  // READY means the project dir AND its governance-repo clone exist (workspaceState) — a project dir alone
  // is 'not-cloned', which is a different rung of the ladder.
  const ready = [seeded, `${seeded}/acme-gov/.git`];

  it("--project matches by regex, so a board number finds its project", () => {
    const items = [{ projectId: "PRJ-7-alpha" }, { projectId: "PRJ-43-governance" }, { projectId: "PRJ-107-infra" }];
    expect(matchProjects(items, "43").map((i) => i.projectId)).to.deep.equal(["PRJ-43-governance"]);
    expect(matchProjects(items, "^PRJ-7").map((i) => i.projectId)).to.deep.equal(["PRJ-7-alpha"]);
    expect(matchProjects(items, "PRJ-1").map((i) => i.projectId)).to.deep.equal(["PRJ-107-infra"]);
  });

  // Someone typing `--project=portal(v2` wants a project, not a lecture about escaping.
  it("an invalid regex is matched literally rather than thrown", () => {
    expect(matchProjects([{ projectId: "portal(v2)" }], "portal(v2").map((i) => i.projectId)).to.deep.equal(["portal(v2)"]);
  });

  describe("agent resolution", () => {
    const onPath = (...found: string[]) => (c: string): boolean => found.includes(c);

    it("--agent wins, then $GOV_AGENT, then the one that is installed", () => {
      expect(resolveAgent("cursor", { GOV_AGENT: "claude" }, onPath())).to.deep.equal({ ok: true, agent: "cursor" });
      expect(resolveAgent(undefined, { GOV_AGENT: "claude" }, onPath())).to.deep.equal({ ok: true, agent: "claude" });
      expect(resolveAgent(undefined, {}, onPath("claude"))).to.deep.equal({ ok: true, agent: "claude" });
      // the BIN is `cursor-agent`; bare `cursor` is the GUI editor, which is a different choice
      expect(resolveAgent(undefined, {}, onPath("cursor-agent"))).to.deep.equal({ ok: true, agent: "cursor" });
    });

    it("two installed and no preference is a real ambiguity — it asks rather than picking", () => {
      const r = resolveAgent(undefined, {}, onPath("claude", "cursor-agent"));
      expect(r.ok).to.equal(false);
      expect(r.ok === false && r.reason).to.match(/more than one agent/);
      expect(r.ok === false && r.reason, "the fix must be in the message").to.match(/--agent/);
    });

    it("none installed names the flag AND the escape hatch", () => {
      const r = resolveAgent(undefined, {}, onPath());
      expect(r.ok === false && r.reason).to.match(/no agent found/);
      expect(r.ok === false && r.reason, "`--agent shell` needs no agent at all").to.match(/shell/);
    });

    it("an unknown name is refused with the list, not silently ignored", () => {
      expect(resolveAgent("wibble", {}, onPath("claude")).ok).to.equal(false);
    });
  });

  describe("consent — org-visible acts ask, local ones do not", () => {
    // Picking a `(not started)` entry from the menu IS consent. A regex that happened to match one is not:
    // seeding creates branches in every repo, an anchor issue, and an assignment other people see.
    it("a pattern-matched UNSEEDED project is not seeded without --seed", async () => {
      const { deps: d, ran, out } = deps({ fs: fsWith([]), prompt: async () => "n" });
      const code = await runWorkFlow(d, { projectPattern: "Alpha|PRJ-7", interactive: true });
      expect(ran.map((a) => a[0]), "nothing was seeded").to.not.include("seed");
      expect(out.join("\n")).to.match(/has not been started/);
      expect(code).to.equal(0);
    });

    it("--seed authorises it", async () => {
      const { deps: d, ran } = deps({ fs: fsWith([]) });
      await runWorkFlow(d, { projectPattern: "PRJ-7", agent: "shell", seedOk: true, interactive: false });
      expect(ran.map((a) => a[0])).to.include("seed");
    });

    it("with no terminal it refuses and names the flag — there is nobody to ask", async () => {
      const { deps: d, ran, out } = deps({ fs: fsWith([]) });
      const code = await runWorkFlow(d, { projectPattern: "PRJ-7", agent: "shell", interactive: false });
      expect(code).to.equal(1);
      expect(ran.map((a) => a[0])).to.not.include("seed");
      expect(out.join("\n")).to.match(/--seed/);
    });

    // Joining only clones. Nobody else sees it, so it needs no permission.
    it("joining a project someone else seeded happens silently", async () => {
      const { deps: d, ran } = deps({ fs: fsWith([]), projects: projects([{ number: 7, title: "Alpha", seeded: true }]) as never });
      await runWorkFlow(d, { projectPattern: "PRJ-7", agent: "shell", seedOk: true, interactive: false });
      expect(ran.some((a) => a[0] === "seed" || a[0] === "join"), "one or the other ran, unprompted").to.equal(true);
    });
  });

  describe("no terminal", () => {
    it("without --project it fails, naming what would have resolved it", async () => {
      const { deps: d, out } = deps();
      const code = await runWorkFlow(d, { interactive: false });
      expect(code).to.equal(2);
      expect(out.join("\n")).to.match(/--project=/);
    });

    it("without --agent it fails AFTER the project is ready, and says where it is", async () => {
      const { deps: d, out, launched } = deps({ fs: fsWith(ready) });
      const code = await runWorkFlow(d, { projectPattern: "PRJ-7", interactive: false });
      expect(code).to.equal(2);
      expect(launched, "nothing was launched").to.deep.equal([]);
      expect(out.join("\n")).to.match(/--agent=/);
      expect(pxAbs(out.join("\n")), "the work was not wasted — say where it landed").to.contain(seeded);
    });

    it("with both flags it runs start to finish, no prompt", async () => {
      const { deps: d, launched } = deps({ fs: fsWith(ready), prompt: async () => { throw new Error("must not prompt"); } });
      const code = await runWorkFlow(d, { projectPattern: "PRJ-7", agent: "claude", interactive: false });
      expect(code).to.equal(0);
      expect(pxDeep(launched)).to.deep.equal([["claude", seeded]]);
    });
  });

  describe("--print-prompt", () => {
    it("emits the prompt through the stdout channel and launches nothing", async () => {
      const printed: string[] = [];
      const { deps: d, launched, ran } = deps({ fs: fsWith(ready), printPrompt: (p) => printed.push(p) });
      const code = await runWorkFlow(d, { projectPattern: "PRJ-7", printPromptOnly: true, interactive: false });
      expect(code).to.equal(0);
      expect(printed).to.deep.equal([sessionStartPrompt("PRJ-7-alpha", "acme-gov")]);
      expect(launched, "printing is not starting").to.deep.equal([]);
      expect(ran, "and it changes nothing").to.deep.equal([]);
    });

    // A project that is not on this machine has no directory to run an agent in, so a prompt for it would
    // be a lie — and the caller would paste it into a shell that then fails somewhere less obvious.
    it("refuses for a project that is not ready here, and says how to get it", async () => {
      const printed: string[] = [];
      const { deps: d, out } = deps({ fs: fsWith([]), printPrompt: (p) => printed.push(p) });
      const code = await runWorkFlow(d, { projectPattern: "PRJ-7", printPromptOnly: true, interactive: false });
      expect(code).to.equal(1);
      expect(printed).to.deep.equal([]);
      expect(out.join("\n")).to.match(/gov work --project=/);
    });
  });
});

describe("gov-work — the agent menu offers what exists (#195)", () => {
  it("nothing installed and an org default → offers to install THAT, then starts it", async () => {
    // The joiner's ordinary case, not an edge one: a new machine, a new person, a
    // container. The adopter chose a default for exactly this moment (#196, Q3), so
    // printing a list and stepping aside leaves the person who most needs help
    // holding a command to retype.
    const installed: string[] = [];
    const { deps: d, out, launched } = deps({
      hasTool: () => false,
      approvedAgents: () => [{ id: "claude-code", default: true }],
      installAgent: (id: string) => { installed.push(id); return true; },
      prompt: async (q: string) => (/Install/.test(q) ? "y" : "1"),
    });
    await runWorkFlow(d);
    expect(out.join("\n")).to.contain("Your organization's default is Claude Code");
    expect(installed).to.deep.equal(["claude-code"]);
    expect(launched[0]?.[0], "and it starts, rather than telling you to re-run").to.equal("claude");
  });

  it("declining the install still gets you a working shell", async () => {
    const { deps: d, out, launched } = deps({
      hasTool: () => false,
      approvedAgents: () => [{ id: "claude-code", default: true }],
      installAgent: () => { throw new Error("must not be called"); },
      prompt: async (q: string) => (/Install/.test(q) ? "n" : "1"),
    });
    await runWorkFlow(d);
    expect(out.join("\n")).to.contain("No AI agent is installed");
    expect(launched[0]?.[0]).to.equal("shell");
  });

  it("with nothing installed and no default it explains and opens a shell", async () => {
    // The old menu offered Claude, cursor and Cursor GUI to a machine with none of
    // them, and led with a tool the seeded policy lists as prohibited.
    const { deps: d, out, launched } = deps({ hasTool: () => false });
    await runWorkFlow(d);
    const text = out.join("\n");
    expect(text).to.contain("No AI agent is installed");
    expect(text, "and what could be, with the command").to.contain("npm i -g @anthropic-ai/claude-code");
    expect(text, "and that gov will not sign you up").to.contain("signing in stays yours");
    expect(launched.map(([a]) => a), "shell was always the answer here").to.deep.equal(["shell"]);
  });

  it("one installed approved agent needs no question — it says which and why", async () => {
    // The menu is for the case where neither the org nor the person has an answer
    // (#196, Q9). One installed agent is not that case.
    const { deps: d, out, launched } = deps({ hasTool: (c: string) => c === "claude" });
    await runWorkFlow(d);
    expect(out.join("\n")).to.contain("the only approved agent installed here");
    expect(out.join("\n"), "no menu for a choice of one").to.not.contain("0) later");
    expect(launched[0]?.[0]).to.equal("claude");
  });

  it("offers a menu when neither layer decides, and says what each choice does", async () => {
    const { deps: d, out } = deps({
      hasTool: (c: string) => c === "claude" || c === "cursor-agent",
      approvedAgents: () => [{ id: "claude-code" }, { id: "cursor" }],   // two, no default
    });
    await runWorkFlow(d);
    const text = out.join("\n");
    expect(text).to.contain("runs the agent here, with the rules loaded");
    expect(text, "the option that always works, explained").to.contain("No AI involved");
  });

  it("honours the org's approved list over what happens to be installed", async () => {
    const { deps: d, out, launched } = deps({
      hasTool: (c: string) => c === "claude" || c === "cursor-agent",
      approvedAgents: () => [{ id: "cursor", default: true }],
    });
    await runWorkFlow(d);
    // Claude is installed and NOT approved here — offering it would put gov's own
    // menu in breach of the policy it seeded.
    expect(out.join("\n")).to.not.contain("Claude Code");
    expect(out.join("\n")).to.contain("the only approved agent installed here");
    expect(launched[0]?.[0]).to.equal("cursor");
  });
});

describe("gov-work — the fork question is asked where the terminal is (#194)", () => {
  /** seed refuses once with a fork suggestion, then succeeds. */
  function forkDeps(answer: string) {
    const proposed = [{ from: "genevaers/Workbench", to: "svm-geneva/Workbench" }];
    let recorded: readonly { from: string; to: string }[] = [];
    let seedCalls = 0;
    let promptCalls = 0;
    const { deps: base, out, ran } = deps({
      prompt: async (q: string) => {
        promptCalls++;
        if (/Record it and try again/.test(q)) return answer;
        return "1";                                   // project 1, then agent 1
      },
    });
    const d: WorkFlowDeps = {
      ...base,
      run: async (argv: readonly string[]) => {
        ran.push([...argv]);
        // The first seed hits the fork; a seed after the mapping is recorded works.
        if (argv[0] === "seed") return ++seedCalls === 1 && !recorded.length ? 1 : 0;
        return 0;
      },
      pendingRepoOverrides: () => (recorded.length ? [] : proposed),
      applyRepoOverrides: (o) => { recorded = o; return true; },
    };
    return { d, out, ran, recorded: () => recorded, promptCalls: () => promptCalls };
  }

  it("asks with the flow's own prompt, records on yes, and tries again", async () => {
    const w = forkDeps("y");
    await runWorkFlow(w.d);
    expect(w.out.join("\n"), "explains before asking").to.match(/found a fork of that repository/);
    expect(w.recorded()).to.deep.equal([{ from: "genevaers/Workbench", to: "svm-geneva/Workbench" }]);
    expect(w.ran.filter((a) => a[0] === "seed"), "seeded again after recording").to.have.length(2);
  });

  it("records nothing on anything but yes — an unreadable answer is not agreement", async () => {
    // Two earlier attempts asked on a terminal a readline already owned, got an
    // instant empty read, and took it for agreement. Twice.
    for (const answer of ["", "n", "no"]) {
      const w = forkDeps(answer);
      await runWorkFlow(w.d);
      expect(w.recorded(), `answer '${answer}'`).to.have.length(0);
      expect(w.ran.filter((a) => a[0] === "seed"), "and did not retry").to.have.length(1);
      expect(w.out.join("\n")).to.match(/Left alone/);
    }
  });
});
