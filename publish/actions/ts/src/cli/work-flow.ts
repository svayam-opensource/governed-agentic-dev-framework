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

export async function runWorkFlow(deps: WorkFlowDeps): Promise<number> {
  const { print } = deps;
  print("");
  print("  Work — start / continue a project");
  // The fetch below is synchronous `gh` (blocks the event loop) — print a working indicator FIRST so it
  // never reads as hung. Now one round-trip (batched anchors), so it's seconds, not minutes.
  print("  ⏳ Finding your projects — assigned + boards you can start…");
  const startable = [...myProjects(deps), ...seedableBoards(deps)];
  if (startable.length === 0) {
    print(`  No active or startable projects for you${deps.me ? ` (${deps.me})` : ""}.`);
    print("  Create a GitHub Project board (or get assigned via Admin ▸ manage), then retry.");
    return 0;
  }
  print("");
  print("  Select a project (assigned, or 'not started' = seed it now):");
  startable.forEach((p, i) => print(`    ${String(i + 1).padStart(2)}) ${p.projectId}  (${p.status})`));
  print("     0) back");
  const sel = (await deps.prompt("  Choose: ")).trim();
  if (sel === "0" || sel === "") return 0;
  const idx = Number(sel) - 1;
  const p = Number.isInteger(idx) && idx >= 0 && idx < startable.length ? startable[idx] : null;
  if (!p) { print("  unknown choice"); return 2; }

  if (!deps.canWriteBoard(p.boardNumber)) {
    print(`  You don't have write access to '${p.title}' (its GitHub Project board).`);
    print("  Ask an owner to grant access (`gov-work manage`), then retry.");
    return 1;
  }

  const dir = path.join(deps.config.agentWorkRoot, p.projectId, deps.config.workspaceRepo);
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

  print("");
  print(`  ✓ '${p.projectId}' is ready at:`);
  print(`      ${dir}`);
  print("  Start your agent there (it runs the session-start protocol automatically):");
  print(`      cd "${dir}" && claude      # or cursor`);
  print("  Or work in TTY:  gov-work task <issue-url>   ·   gov-work status");
  return 0;
}
