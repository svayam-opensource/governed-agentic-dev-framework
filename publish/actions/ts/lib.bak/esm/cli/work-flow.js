// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The guided Work flow (port of prj `cmd_work`) — the menu's primary path.
 * Pick YOUR assigned project → fail fast if you can't write its board → route:
 * seed if new, join if not cloned locally, else it's ready → session-start
 * guidance. Pure over injected deps (ports + run + prompt/print), so it's testable.
 */
import * as path from "node:path";
import { deriveProjectIdentity } from "../lifecycle/identity.js";
import { deriveStatus } from "../lifecycle/state.js";
/** My projects = open boards whose anchor issue lists me as an assignee (owner). */
export function myProjects(deps) {
    if (!deps.me)
        return [];
    const ownerField = deps.config.ownerField ?? "organization";
    const out = [];
    for (const b of deps.projects.listBoards(deps.config.githubOrg)) {
        if (b.closed)
            continue;
        const a = deps.anchor.find({ owner: deps.config.githubOrg, ownerField, number: b.number }, deps.config.workspaceRepo);
        if (!a || !a.assignees.includes(deps.me))
            continue;
        const id = deriveProjectIdentity({ url: b.url, title: b.title });
        out.push({ boardNumber: b.number, title: b.title, url: b.url, status: deriveStatus(!b.closed, a.labels), projectId: id.ok ? id.projectId : `PRJ-${b.number}` });
    }
    return out;
}
export function workspaceState(deps, p) {
    const projRoot = path.join(deps.config.agentWorkRoot, p.projectId);
    if (!deps.fs.pathExists(projRoot))
        return "not-seeded";
    if (!deps.fs.pathExists(path.join(projRoot, deps.config.workspaceRepo, ".git")))
        return "not-cloned";
    return "ready";
}
export async function runWorkFlow(deps) {
    const { print } = deps;
    print("");
    print("  Work — start / continue a project");
    const mine = myProjects(deps);
    if (mine.length === 0) {
        print(`  No active projects assigned to you${deps.me ? ` (${deps.me})` : ""}.`);
        print("  Get assigned first: Admin ▸ manage (or `gov-work manage assign <you>`), then retry.");
        return 0;
    }
    print("");
    print("  Select a project assigned to you:");
    mine.forEach((p, i) => print(`    ${String(i + 1).padStart(2)}) ${p.projectId}  (${p.status})`));
    print("     0) back");
    const sel = (await deps.prompt("  Choose: ")).trim();
    if (sel === "0" || sel === "")
        return 0;
    const idx = Number(sel) - 1;
    const p = Number.isInteger(idx) && idx >= 0 && idx < mine.length ? mine[idx] : null;
    if (!p) {
        print("  unknown choice");
        return 2;
    }
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
        if (code !== 0)
            return code;
    }
    else if (state === "not-cloned") {
        print(`  Cloning your workspace for '${p.projectId}'…`);
        const code = await deps.run(["join", p.projectId]);
        if (code !== 0)
            return code;
    }
    print("");
    print(`  ✓ '${p.projectId}' is ready at:`);
    print(`      ${dir}`);
    print("  Start your agent there (it runs the session-start protocol automatically):");
    print(`      cd "${dir}" && claude      # or cursor`);
    print("  Or work in TTY:  gov-work task <issue-url>   ·   gov-work status");
    return 0;
}
