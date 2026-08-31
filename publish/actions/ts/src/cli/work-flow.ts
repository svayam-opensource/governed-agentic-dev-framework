// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The guided Work flow (port of prj `cmd_work`) — the menu's primary path.
 * Pick YOUR assigned project → fail fast if you can't write its board → route:
 * seed if new, join if not cloned locally, else it's ready → session-start
 * guidance. Pure over injected deps (ports + run + prompt/print), so it's testable.
 */
import * as path from "node:path";
import type { Projects } from "../lifecycle/project-list.js";
import type { AnchorCreator } from "../lifecycle/anchor.js";
import type { Fs } from "../lifecycle/fs-io.js";
import { deriveProjectIdentity } from "../lifecycle/identity.js";
import { deriveStatus } from "../lifecycle/state.js";
import { ensureRootProtocol } from "../lifecycle/root-protocol.js";

export interface WorkProject {
  readonly boardNumber: number;
  readonly title: string;
  readonly url: string;
  readonly status: string;
  readonly projectId: string;
}

export interface WorkFlowDeps {
  readonly projects: Projects;
  readonly anchor: AnchorCreator;
  readonly fs: Fs;
  readonly config: { readonly githubOrg: string; readonly workspaceRepo: string; readonly agentWorkRoot: string; readonly ownerField?: "organization" | "user" };
  readonly me: string | null;
  readonly canWriteBoard: (boardNumber: number) => boolean;
  readonly run: (argv: readonly string[]) => Promise<number> | number;
  readonly prompt: (q: string) => Promise<string>;
  /** Fork mappings the last `seed` proposed, if any (#194). */
  readonly pendingRepoOverrides?: () => readonly { readonly from: string; readonly to: string }[];
  /** Record them in org-config.yaml. Returns whether anything was written. */
  readonly applyRepoOverrides?: (o: readonly { readonly from: string; readonly to: string }[]) => boolean;
  readonly print: (l: string) => void;
  /** Launch an interactive agent/editor/shell with `cwd` = the project dir. `inject` = the session-start
   *  kickoff prompt handed to a speak-first CLI agent (Claude / cursor-agent) so it runs the protocol
   *  immediately. Terminal agents inherit stdio + block; the GUI editor opens detached. */
  readonly launch: (agent: AgentKind, cwd: string, inject: string) => Promise<number>;
  /** `--print-prompt` writes HERE, not through `print` — stdout must carry the prompt and nothing else,
   *  so `gov work … --print-prompt` can be captured or piped. */
  readonly printPrompt?: (prompt: string) => void;
}

export type AgentKind = "claude" | "cursor" | "cursor-gui" | "shell";

/**
 * What `gov work` already knows, so the flow can skip asking. The MENU passes none of these and behaves
 * exactly as before; flags fill them in one at a time, and with both supplied the flow runs start to finish
 * without a prompt — which is what makes it usable from a script.
 */
export interface WorkFlowOpts {
  /** `--project=<regex>` — matched against project ids, case-insensitive. */
  readonly projectPattern?: string;
  /** `--agent=<kind>` — skips the agent question. */
  readonly agent?: AgentKind;
  /** `--seed` — authorises STARTING a project that nobody has seeded yet (org-visible: branches, anchor
   *  issue, assignment). Picking a `(not started)` entry from the menu IS this consent; a regex match is not. */
  readonly seedOk?: boolean;
  /** `--print-prompt` — emit the kickoff prompt and stop. Seeds nothing, clones nothing, launches nothing. */
  readonly printPromptOnly?: boolean;
  /** false when there is no TTY: an unresolved choice must then FAIL naming the flag that would resolve it,
   *  because there is nobody to ask. */
  readonly interactive?: boolean;
}

/**
 * Projects whose id matches `pattern` — a regex, so `43` finds `PRJ-43-…` and a full id still matches
 * itself. An invalid regex is matched LITERALLY rather than throwing: someone typing `gov work
 * --project=portal(v2` wants a project, not a lecture about escaping.
 */
export function matchProjects<T extends { readonly projectId: string }>(items: readonly T[], pattern: string): T[] {
  let re: RegExp;
  try { re = new RegExp(pattern, "i"); }
  catch { return items.filter((i) => i.projectId.toLowerCase().includes(pattern.toLowerCase())); }
  return items.filter((i) => re.test(i.projectId));
}

/** The kickoff prompt that makes a speak-first CLI agent run the session-start protocol immediately, before
 *  the user types anything (ports the bash prj `agent_session_start_prompt`). Paths are workspace-relative
 *  from the PROJECT ROOT (where the agent launches), so the agent reads the right files across repos. */
export function sessionStartPrompt(projectId: string, workspaceRepo: string): string {
  const w = workspaceRepo;
  return `Run the session-start protocol for ${projectId} now, before I send anything else: read ${w}/org-config.yaml, ${w}/projects/${projectId}/agent.md, ${w}/knowledge/policies/agentic-development-policy.md, and surface any "## Open" items from ${w}/projects/${projectId}/knowledge/todo.md; then post the context manifest and wait for my direction.`;
}

export interface StartSession {
  readonly projectId: string;
  /** the project directory the agent must run in — repos are its children. */
  readonly dir: string;
  /** the kickoff prompt, identical to the one the interactive menu injects. */
  readonly prompt: string;
}

/**
 * WHAT A SESSION ON AN EXISTING PROJECT NEEDS — resolved without a terminal.
 *
 * The guided Work flow (menu) does seed → join → session-start and launches an agent carrying the kickoff
 * prompt. That path is TTY-only, which is backwards: the prompt exists to drive an AGENT, and agents are
 * precisely the non-TTY case. This is the same resolution as a pure function, so `gov work` can answer a
 * script, a CI job, or an agent wrapper.
 *
 * `undefined` when the project is not cloned here — the caller says how to get it (`gov join <board-url>`),
 * because "no such directory" is not a useful thing to tell someone who asked to start work.
 */
export function startSession(
  projectWorkRoot: string, workspaceRepo: string, projectId: string, exists: (p: string) => boolean,
): StartSession | undefined {
  const dir = path.join(projectWorkRoot, projectId);   // path.join, not a literal '/': on Windows the two do not match
  if (!exists(dir)) return undefined;
  return { projectId, dir, prompt: sessionStartPrompt(projectId, workspaceRepo) };
}

/**
 * The project a path sits inside, if any: the first segment below the work root. Lets `gov work` be typed
 * with no argument from anywhere in a project — the same rule the context banner uses to decide PROJECT.
 */
export function projectFromPath(projectWorkRoot: string, cwd: string, sep = "/"): string | undefined {
  const root = projectWorkRoot.endsWith(sep) ? projectWorkRoot : projectWorkRoot + sep;
  if (!cwd.startsWith(root)) return undefined;
  return cwd.slice(root.length).split(sep).filter(Boolean)[0];
}

/** The concrete command to launch an agent kind in a project dir. Pure (env-injected) so the binary mapping
 *  + detached-GUI behaviour are regression-tested without spawning. Speak-first CLI agents (Claude,
 *  cursor-agent) get the `inject` prompt as their first message; the GUI editor opens the dir detached. */
export function agentLaunchSpec(agent: AgentKind, cwd: string, inject: string, env: NodeJS.ProcessEnv = process.env): { cmd: string; args: readonly string[]; detached: boolean } {
  switch (agent) {
    case "cursor-gui": return { cmd: "cursor", args: [cwd], detached: true };          // open the Cursor editor on the dir
    case "cursor":     return { cmd: "cursor-agent", args: [inject], detached: false }; // Cursor CLI agent — speak-first
    case "claude":     return { cmd: "claude", args: [inject], detached: false };       // Claude — speak-first
    case "shell":      return { cmd: env.SHELL || "/bin/zsh", args: [], detached: false };
  }
}

/**
 * WHICH AGENT TO LAUNCH, without asking — the non-TTY counterpart of the menu's numbered prompt.
 *
 *   --agent <kind>  >  $GOV_AGENT  >  the one that is actually installed
 *
 * The last step is what makes this work for someone who has just installed gov: if exactly one supported
 * agent is on their PATH, that is not a guess, it is the only answer. Two installed and no preference is a
 * real ambiguity, so it asks rather than picking — the same discipline as refusing an ambiguous content_sha.
 */
export type AgentChoice = { readonly ok: true; readonly agent: AgentKind } | { readonly ok: false; readonly reason: string };

export function resolveAgent(
  flag: string | undefined, env: NodeJS.ProcessEnv, onPath: (cmd: string) => boolean,
): AgentChoice {
  const KINDS: Record<string, AgentKind> = { claude: "claude", cursor: "cursor", "cursor-gui": "cursor-gui", shell: "shell" };
  const named = (flag ?? env.GOV_AGENT)?.trim();
  if (named) {
    const k = KINDS[named];
    return k ? { ok: true, agent: k } : { ok: false, reason: `unknown agent '${named}' — use one of: ${Object.keys(KINDS).join(", ")}` };
  }
  // BIN, not kind: `cursor` the agent is `cursor-agent` on disk, and `cursor` alone is the GUI editor.
  const found = ([["claude", "claude"], ["cursor-agent", "cursor"]] as const).filter(([bin]) => onPath(bin));
  if (found.length === 1) return { ok: true, agent: found[0]![1] };
  if (found.length === 0) {
    return { ok: false, reason: "no agent found on PATH (looked for: claude, cursor-agent).\n  pass --agent <claude|cursor|cursor-gui|shell>, or set $GOV_AGENT.\n  `--agent shell` just opens a shell in the project." };
  }
  return { ok: false, reason: `more than one agent is installed (${found.map(([b]) => b).join(", ")}) — say which: --agent <${found.map(([, k]) => k).join("|")}>, or set $GOV_AGENT.` };
}

/** My projects = open boards whose anchor issue lists me as an assignee (owner). */
export function myProjects(deps: WorkFlowDeps): WorkProject[] {
  if (!deps.me) return [];
  const ownerField = deps.config.ownerField ?? "organization";
  const out: WorkProject[] = [];
  // Fetch every anchor in ONE gh call when the port supports it (63 boards → 1 round-trip, not 63);
  // fall back to per-board find() for lightweight doubles that don't implement findAll.
  const allAnchors = deps.anchor.findAll?.(deps.config.githubOrg, deps.config.workspaceRepo);
  for (const b of deps.projects.listBoards(deps.config.githubOrg)) {
    if (b.closed) continue;
    const a = allAnchors ? allAnchors.get(b.number) ?? null : deps.anchor.find({ owner: deps.config.githubOrg, ownerField, number: b.number }, deps.config.workspaceRepo);
    if (!a || !a.assignees.includes(deps.me)) continue;
    const id = deriveProjectIdentity({ url: b.url, title: b.title });
    out.push({ boardNumber: b.number, title: b.title, url: b.url, status: deriveStatus(!b.closed, a.labels), projectId: id.ok ? id.projectId : `PRJ-${b.number}` });
  }
  return out;
}

/** Seedable boards = open boards I can WRITE but that have NO anchor yet (never seeded). Offered in Work so a
 *  freshly-created GitHub board (e.g. #106) can be STARTED, not only picked once already seeded. Picking one
 *  runs the not-seeded → `seed` path. (Cost: `canWriteBoard` per un-anchored board — batch if it gets slow.) */
export function seedableBoards(deps: WorkFlowDeps): WorkProject[] {
  if (!deps.me) return [];
  const ownerField = deps.config.ownerField ?? "organization";
  const allAnchors = deps.anchor.findAll?.(deps.config.githubOrg, deps.config.workspaceRepo);
  const out: WorkProject[] = [];
  for (const b of deps.projects.listBoards(deps.config.githubOrg)) {
    if (b.closed) continue;
    const a = allAnchors ? allAnchors.get(b.number) ?? null : deps.anchor.find({ owner: deps.config.githubOrg, ownerField, number: b.number }, deps.config.workspaceRepo);
    if (a) continue;                             // already seeded (has an anchor) → myProjects handles it
    if (!deps.canWriteBoard(b.number)) continue; // only boards I can actually seed
    const id = deriveProjectIdentity({ url: b.url, title: b.title });
    out.push({ boardNumber: b.number, title: b.title, url: b.url, status: "not started", projectId: id.ok ? id.projectId : `PRJ-${b.number}` });
  }
  return out;
}

export type WorkspaceState = "not-seeded" | "not-cloned" | "ready";
export function workspaceState(deps: WorkFlowDeps, p: WorkProject): WorkspaceState {
  const projRoot = path.join(deps.config.agentWorkRoot, p.projectId);
  if (!deps.fs.pathExists(projRoot)) return "not-seeded";
  if (!deps.fs.pathExists(path.join(projRoot, deps.config.workspaceRepo, ".git"))) return "not-cloned";
  return "ready";
}

/** One page of STARTABLE projects, NEWEST board first: assigned projects (I'm an anchor owner) + seedable
 *  boards (writable, un-anchored → "not started"). Paginates over BOARDS and resolves the expensive per-board
 *  `canWriteBoard` ONLY for the page (like manageList) — a large org never means a long wait. `totalBoards`
 *  is the full non-closed count (for the "more" affordance). */
export function startablePage(deps: WorkFlowDeps, limit: number, offset: number): { items: WorkProject[]; totalBoards: number } {
  if (!deps.me) return { items: [], totalBoards: 0 };
  const ownerField = deps.config.ownerField ?? "organization";
  const allAnchors = deps.anchor.findAll?.(deps.config.githubOrg, deps.config.workspaceRepo);
  const boards = deps.projects.listBoards(deps.config.githubOrg).filter((b) => !b.closed).sort((a, b) => b.number - a.number);
  const items: WorkProject[] = [];
  for (const b of boards.slice(offset, offset + limit)) {
    const a = allAnchors ? allAnchors.get(b.number) ?? null : deps.anchor.find({ owner: deps.config.githubOrg, ownerField, number: b.number }, deps.config.workspaceRepo);
    const id = deriveProjectIdentity({ url: b.url, title: b.title });
    const projectId = id.ok ? id.projectId : `PRJ-${b.number}`;
    if (a && a.assignees.includes(deps.me)) items.push({ boardNumber: b.number, title: b.title, url: b.url, status: deriveStatus(!b.closed, a.labels), projectId });
    else if (!a && deps.canWriteBoard(b.number)) items.push({ boardNumber: b.number, title: b.title, url: b.url, status: "not started", projectId });
  }
  return { items, totalBoards: boards.length };
}

// `ensureRootProtocol` (imported above) lives in a leaf lifecycle module so BOTH `seed` and this Work flow use
// it (no cli→lifecycle cycle). Re-exported so existing importers/tests keep resolving it here.
export { ensureRootProtocol };

export async function runWorkFlow(deps: WorkFlowDeps, opts: WorkFlowOpts = {}): Promise<number> {
  const { print } = deps;
  const PAGE = 15;
  const interactive = opts.interactive ?? true;
  print("");
  print("  Work — start / continue a project");

  // ── project, by pattern ──────────────────────────────────────────────────────────────────────────
  // Scans the same paginated source the menu uses, then filters. One match proceeds; several ask (or, with
  // no TTY, list them and stop — a script must not be given a project it did not name); none is an error
  // that shows what WAS available, because "no match" without the candidate list is a dead end.
  let picked: WorkProject | null = null;
  if (opts.projectPattern) {
    const all: WorkProject[] = [];
    for (let off = 0; ; off += PAGE) {
      const { items, totalBoards } = startablePage(deps, PAGE, off);
      all.push(...items);
      if (off + PAGE >= totalBoards) break;
    }
    const hits = matchProjects(all, opts.projectPattern);
    if (hits.length === 0) {
      print(`  No project matches '${opts.projectPattern}'.`);
      if (all.length) print(`  Available: ${all.slice(0, 10).map((i) => i.projectId).join(", ")}${all.length > 10 ? ", …" : ""}`);
      return 1;
    }
    if (hits.length === 1) picked = hits[0]!;
    else if (!interactive) {
      print(`  '${opts.projectPattern}' matches ${hits.length} projects: ${hits.map((i) => i.projectId).join(", ")}`);
      print("  Narrow the pattern — with no terminal there is nobody to ask.");
      return 2;
    } else {
      print("");
      print(`  '${opts.projectPattern}' matches ${hits.length} projects:`);
      hits.forEach((it, i) => print(`    ${String(i + 1).padStart(2)}) ${it.projectId}  (${it.status})`));
      const sel = (await deps.prompt("  Choose: ")).trim();
      const idx = Number(sel) - 1;
      picked = Number.isInteger(idx) && idx >= 0 && idx < hits.length ? hits[idx]! : null;
      if (!picked) { print("  unknown choice"); return 2; }
    }
  } else if (!interactive) {
    print("  No --project=<pattern>, and no terminal to choose in.");
    print("  Name one:  gov work --project=<regex> --agent=<claude|cursor|cursor-gui|shell>");
    return 2;
  }
  // Paginate over BOARDS (newest first), probing per-board access ONLY for the visible page → no long wait on
  // a large org. Print a working indicator each page (synchronous gh blocks the loop).
  let p: WorkProject | null = picked;
  let offset = 0;
  while (!p) {
    print("  ⏳ Finding your projects — assigned + boards you can start…");
    const { items, totalBoards } = startablePage(deps, PAGE, offset);
    const more = offset + PAGE < totalBoards;
    if (items.length === 0 && offset === 0 && !more) {
      print(`  No active or startable projects for you${deps.me ? ` (${deps.me})` : ""}.`);
      print("  Create a GitHub Project board (or get assigned via Admin ▸ manage), then retry.");
      return 0;
    }
    print("");
    print("  Select a project (assigned, or 'not started' = seed it now) — newest first:");
    if (items.length === 0) print("     (nothing startable on this page)");
    items.forEach((it, i) => print(`    ${String(i + 1).padStart(2)}) ${it.projectId}  (${it.status})`));
    if (more) print("     m) more");
    print("     0) back");
    const sel = (await deps.prompt("  Choose: ")).trim().toLowerCase();
    if (sel === "0" || sel === "") return 0;
    if (sel === "m" && more) { offset += PAGE; continue; }
    const idx = Number(sel) - 1;
    p = Number.isInteger(idx) && idx >= 0 && idx < items.length ? items[idx] : null;
    if (!p) print("  unknown choice");
  }

  if (!deps.canWriteBoard(p.boardNumber)) {
    print(`  You don't have write access to '${p.title}' (its GitHub Project board).`);
    print("  Ask an owner to grant access (`gov manage`), then retry.");
    return 1;
  }

  const projectDir = path.join(deps.config.agentWorkRoot, p.projectId);   // <project> — all repos live under it
  const state = workspaceState(deps, p);

  // `--print-prompt` is the scripting escape: emit the kickoff prompt, change nothing. A project that is not
  // on this machine has no directory to run an agent in, so printing a prompt for it would be a lie.
  if (opts.printPromptOnly) {
    if (state !== "ready") {
      print(`  '${p.projectId}' is not ready on this machine (${state}).`);
      print(`  Set it up first:  gov work --project=${p.projectId}`);
      return 1;
    }
    deps.printPrompt?.(sessionStartPrompt(p.projectId, deps.config.workspaceRepo));
    return 0;
  }

  if (state === "not-seeded") {
    // SEEDING IS ORG-VISIBLE — branches in every repo, an anchor issue, an assignment. Choosing a
    // `(not started)` entry from the menu IS consent; a regex that happened to match one is not. So a
    // pattern-selected project asks first, and with no terminal it refuses and names the flag.
    if (opts.projectPattern && !opts.seedOk) {
      const msg = `  '${p.projectId}' has not been started by anyone yet — seeding creates branches, an anchor issue and assigns you.`;
      if (!interactive) {
        print(msg);
        print(`  Authorise it explicitly:  gov work --project=${opts.projectPattern} --seed`);
        return 1;
      }
      print(msg);
      const yes = (await deps.prompt("  Start it now? (y/N) ")).trim().toLowerCase();
      if (!/^y(es)?$/.test(yes)) { print("  Left alone."); return 0; }
    }
    print(`  Initializing '${p.title}' (seed → branch → clone)…`);
    let code = await deps.run(["seed", p.url, ...(deps.me ? [deps.me] : [])]);

    // THE FORK QUESTION BELONGS HERE (#194), not inside seed's failure path.
    //
    // It was asked there, on /dev/tty, and the answer arrived before anyone could
    // type: this flow's readline already owns the terminal, so a second reader gets
    // an immediate empty read — which was taken for "yes" and recorded a mapping
    // nobody had agreed to. Twice. The terminal has one owner, and in this flow it
    // is `deps.prompt`; so the question is asked with it.
    const pending = deps.pendingRepoOverrides?.() ?? [];
    if (code !== 0 && pending.length && deps.applyRepoOverrides) {
      print("");
      print("  gov found a fork of that repository under your organization:");
      for (const o of pending) print(`    ${o.from}  →  ${o.to}`);
      print("");
      print("  Recording this in org-config.yaml means the branch, the pushes and the merges");
      print("  happen in your repo, while the board goes on linking theirs.");
      // Explicit yes. Anything else — including an answer we could not read — leaves
      // the file alone, because recording it silently is the failure this replaces.
      const yes = (await deps.prompt("  Record it and try again? (y/N) ")).trim().toLowerCase();
      if (/^y(es)?$/.test(yes)) {
        if (deps.applyRepoOverrides(pending)) {
          print("  Recorded. Trying again…");
          code = await deps.run(["seed", p.url, ...(deps.me ? [deps.me] : [])]);
        } else {
          print("  Could not write org-config.yaml — add the mapping by hand and run this again.");
        }
      } else {
        print("  Left alone. Add it to org-config.yaml yourself when you are ready.");
      }
    }
    if (code !== 0) return code;
  } else if (state === "not-cloned") {
    print(`  Cloning your workspace for '${p.projectId}'…`);
    const code = await deps.run(["join", p.projectId]);
    if (code !== 0) return code;
  }

  ensureRootProtocol(deps.fs, projectDir, deps.config.workspaceRepo);   // so an agent launched at <project> runs session-start
  print("");
  print(`  ✓ '${p.projectId}' is ready at:  ${projectDir}`);
  let agent: AgentKind | null = opts.agent ?? null;
  if (!agent && !interactive) {
    print("  No --agent=<claude|cursor|cursor-gui|shell>, and no terminal to choose in.");
    print(`  The project is ready at ${projectDir} — name an agent, or use --print-prompt to drive your own.`);
    return 2;
  }
  if (!agent) {
    print("  Start an agent in it now?");
    print("     1) Claude    2) cursor    3) Cursor GUI    4) shell    0) later");
    const choice = (await deps.prompt("  Choose: ")).trim();
    agent = choice === "1" ? "claude" : choice === "2" ? "cursor" : choice === "3" ? "cursor-gui" : choice === "4" ? "shell" : null;
  }
  if (!agent) { print(`  Later:  cd "${projectDir}" && claude "<session-start>"      # or your agent`); return 0; }
  print(`  Launching ${agent === "cursor-gui" ? "Cursor (GUI)" : agent} in ${projectDir}…`);
  return await deps.launch(agent, projectDir, sessionStartPrompt(p.projectId, deps.config.workspaceRepo));
}
