// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WHAT A RUN IS ABOUT, cheaply enough to ask on every single invocation (PRJ-121, 2026-09-23).
 *
 * The log folder is keyed by the person (their GitHub login) and named for the project they are standing in, so
 * `bin.ts` needs both before anything else happens. Both come from FILES — the registry, the org's config, the
 * cached login — and never from a process: a log that spawns `gh` to decide where to write is a log that makes
 * every command slower, including the ones that need no network at all.
 *
 * Everything here is best-effort. A missing registry, an unreadable config or a login nobody has cached yet is
 * not an error: the run simply logs to `~/.gov/logs/` until gov learns more (see log.ts `runDirFor`).
 */
import * as fsSync from "node:fs";
import * as path from "node:path";
import { createNodeRegistryStore } from "../resolve/registry-store.js";
import { parseOrgConfig } from "../config/org-config.js";
import { cachedLogin } from "../log.js";
import { projectFromPath } from "./work-flow.js";

export interface RunContext {
  /** `agent_work_root` of the active org, expanded — where preferences and state live. */
  readonly workRoot: string | null;
  /** The person's GitHub login, if an earlier run cached it. */
  readonly login: string | null;
  /** The project the cwd sits in, if any. */
  readonly project: string | null;
  /** The active org's slug, for the login cache. */
  readonly orgSlug: string | null;
}

/** Facts for this run, from files only. Never throws. */
export function runContext(cwd: string = process.cwd()): RunContext {
  let workRoot: string | null = null, orgSlug: string | null = null;
  try {
    const store = createNodeRegistryStore();
    const active = store.readActiveOrg();
    const home = active ? store.readHomes().find((h) => h.org === active)?.home ?? null : null;
    if (home) {
      const cfg = parseOrgConfig(fsSync.readFileSync(path.join(home, "org-config.yaml"), "utf8"));
      workRoot = cfg.agentWorkRoot || null;
      orgSlug = cfg.orgSlug || null;
    }
  } catch { /* no org yet, or nothing readable — the fallback path is correct */ }
  const login = cachedLogin(orgSlug);
  const project = workRoot ? projectFromPath(workRoot, cwd, path.sep) ?? null : null;
  return { workRoot, login, project, orgSlug };
}
