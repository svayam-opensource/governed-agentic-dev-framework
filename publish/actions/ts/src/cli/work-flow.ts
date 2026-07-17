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
  readonly print: (l: string) => void;
  /** Launch an interactive agent/editor/shell with `cwd` = the project dir (terminal ones inherit stdio +
   *  block until exit; the GUI editor opens detached). Returns the exit code (0 for a detached GUI launch). */
  readonly launch: (agent: AgentKind, cwd: string) => Promise<number>;
}

export type AgentKind = "claude" | "cursor" | "cursor-gui" | "shell";

/** The concrete command to launch an agent kind in a project dir. Pure (env-injected) so the binary mapping
 *  + detached-GUI behaviour are regression-tested without spawning. `detached` = a GUI editor that opens and
 *  returns immediately; otherwise a terminal agent/shell that inherits stdio + blocks. */
export function agentLaunchSpec(agent: AgentKind, cwd: string, env: NodeJS.ProcessEnv = process.env): { cmd: string; args: readonly string[]; detached: boolean } {
  switch (agent) {
    case "cursor-gui": return { cmd: "cursor", args: [cwd], detached: true };   // open the Cursor editor on the dir
    case "cursor":     return { cmd: "cursor-agent", args: [], detached: false }; // Cursor CLI agent
    case "claude":     return { cmd: "claude", args: [], detached: false };
    case "shell":      return { cmd: env.SHELL || "/bin/zsh", args: [], detached: false };
  }
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

/** Ensure an agent launched at the project ROOT runs the session-start protocol: the harness is rendered
 *  into the workspace repo, so drop a root `CLAUDE.md` that `@`-imports it (single source, never stale). */
export function ensureRootProtocol(deps: WorkFlowDeps, projectDir: string): void {
  const root = path.join(projectDir, "CLAUDE.md");
  if (!deps.fs.pathExists(root)) deps.fs.writeFile(root, `@${deps.config.workspaceRepo}/CLAUDE.md\n`);
}

export async function runWorkFlow(deps: WorkFlowDeps): Promise<number> {
  const { print } = deps;
  const PAGE = 15;
  print("");
  print("  Work — start / continue a project");
  // Paginate over BOARDS (newest first), probing per-board access ONLY for the visible page → no long wait on
  // a large org. Print a working indicator each page (synchronous gh blocks the loop).
  let p: WorkProject | null = null;
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
    print("  Ask an owner to grant access (`gov-work manage`), then retry.");
    return 1;
  }

  const projectDir = path.join(deps.config.agentWorkRoot, p.projectId);   // <project> — all repos live under it
  const state = workspaceState(deps, p);
  if (state === "not-seeded") {
    print(`  Initializing '${p.title}' (seed → branch → clone)…`);
    const code = await deps.run(["seed", p.url, ...(deps.me ? [deps.me] : [])]);
    if (code !== 0) return code;
  } else if (state === "not-cloned") {
    print(`  Cloning your workspace for '${p.projectId}'…`);
    const code = await deps.run(["join", p.projectId]);
    if (code !== 0) return code;
  }

  ensureRootProtocol(deps, projectDir);   // so an agent launched at <project> runs session-start
  print("");
  print(`  ✓ '${p.projectId}' is ready at:  ${projectDir}`);
  print("  Start an agent in it now?");
  print("     1) Claude    2) cursor    3) Cursor GUI    4) shell    0) later");
  const choice = (await deps.prompt("  Choose: ")).trim();
  const agent: AgentKind | null = choice === "1" ? "claude" : choice === "2" ? "cursor" : choice === "3" ? "cursor-gui" : choice === "4" ? "shell" : null;
  if (!agent) { print(`  Later:  cd "${projectDir}" && claude      # or your agent`); return 0; }
  print(`  Launching ${agent === "cursor-gui" ? "Cursor (GUI)" : agent} in ${projectDir}…`);
  return await deps.launch(agent, projectDir);
}
