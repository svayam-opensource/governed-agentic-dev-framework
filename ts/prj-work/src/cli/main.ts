// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The `prj` bin composition (SDD-011) — assemble the real environment and route.
 * Resolve the gov workspace (model A, active-org anchored) → load org-config →
 * build the git/gh/fs adapters → run the command. `git`/`gh` are the only
 * external tools; no bash/python. This is the integration seam; the pure router
 * (dispatch.ts) is exhaustively unit-tested.
 */
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { prjResolveGov, resolveFailureMessage } from "../resolve/resolve-gov.js";
import { createNodeEnv } from "../resolve/node-env.js";
import { createNodeRegistryStore } from "../resolve/registry-store.js";
import { parseOrgConfig } from "../config/org-config.js";
import { createNodeFs } from "../lifecycle/fs-io.js";
import { createGitVcs } from "../lifecycle/vcs.js";
import { createGhBoard, type RunGh } from "../lifecycle/gh-board.js";
import { createGhIssues } from "../lifecycle/issues.js";
import { createGhAnchor } from "../lifecycle/anchor.js";
import { createGhPulls } from "../lifecycle/pulls.js";
import { makeCloneRepo } from "../lifecycle/code-repo.js";
import { runSuite } from "../governance/suite.js";
import { bumpVersion } from "../maintain/bump-version.js";
import { parseArgv } from "./args.js";
import { route, routeOrg, type CliContext } from "./dispatch.js";

/** Run a command, swallowing failures (returns undefined). */
function tryRun(cmd: string, args: string[]): string | undefined {
  try {
    return execFileSync(cmd, args, { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

/**
 * The `prj` entry point. Returns a process exit code. `now` is injected (an
 * ISO-8601 instant) so the composition stays deterministic + testable.
 */
export function main(argv: readonly string[], now: string = new Date().toISOString()): number {
  const parsed = parseArgv(argv);
  if ("error" in parsed) {
    process.stderr.write(`${parsed.error}\n`);
    return 2;
  }

  const fs = createNodeFs();

  // `prj bump-version <x.y.z>` maintains the PACKAGE (cwd), not a gov workspace —
  // runs before resolution.
  if (parsed.command === "bump-version") {
    const r = bumpVersion(fs, process.cwd(), parsed.positionals[0] ?? "");
    if (r.ok) {
      process.stdout.write(`bumped → ${r.version} (${r.written.join(", ")})\n`);
      return 0;
    }
    process.stderr.write(`${r.error}\n`);
    return r.code;
  }

  const env = createNodeEnv();

  // `prj org …` runs BEFORE resolution — it's the bootstrap that makes resolution
  // work (registering a gov home / selecting the active org).
  if (parsed.command === "org") {
    const orgResult = routeOrg(parsed.positionals, { store: createNodeRegistryStore(), govConfigAt: (p) => env.govConfigAt(p) });
    for (const line of orgResult.lines) process.stdout.write(`${line}\n`);
    return orgResult.code;
  }

  // Resolve the gov workspace (the gov home for seed, the project clone otherwise).
  const resolved = prjResolveGov(env);
  if (!resolved.ok) {
    process.stderr.write(`${resolveFailureMessage(resolved)}\n`);
    return resolved.code;
  }
  const home = resolved.home;

  const cfgText = fs.readFile(path.join(home, "org-config.yaml"));
  if (cfgText === null) {
    process.stderr.write(`prj: no org-config.yaml at ${home}\n`);
    return 1;
  }
  const config = parseOrgConfig(cfgText);

  const runGh: RunGh = (args) => execFileSync("gh", args, { encoding: "utf8" });
  const vcs = createGitVcs();
  const seededBy = tryRun("git", ["-C", home, "config", "user.email"]) ?? "";
  const name = tryRun("git", ["-C", home, "config", "user.name"]);
  const login = tryRun("gh", ["api", "user", "--jq", ".login"]);

  const ctx: CliContext = {
    config,
    home,
    today: now.slice(0, 10),
    seededBy,
    login,
    identity: name || seededBy ? { name, email: seededBy || undefined } : undefined,
    board: createGhBoard(runGh),
    vcs,
    fs,
    issues: createGhIssues(runGh),
    anchor: createGhAnchor(runGh),
    pulls: createGhPulls(runGh),
    cloneRepo: makeCloneRepo(vcs, { rmDir: (d) => fs.rm(d) }),
    gate: () => runSuite({ fs, repoRoot: home, files: (tryRun("git", ["-C", home, "ls-files"]) ?? "").split("\n").filter(Boolean) }),
    log: (m) => process.stderr.write(`${m}\n`),
  };

  const result = route(parsed, ctx);
  for (const line of result.lines) process.stdout.write(`${line}\n`);
  return result.code;
}
