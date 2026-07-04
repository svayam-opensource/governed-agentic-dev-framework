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
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { prjResolveGov, resolveFailureMessage } from "../resolve/resolve-gov.js";
import { createNodeEnv, expandTilde } from "../resolve/node-env.js";
import { createNodeRegistryStore } from "../resolve/registry-store.js";
import { parseOrgConfig } from "../config/org-config.js";
import { createNodeFs } from "../lifecycle/fs-io.js";
import { createGitVcs } from "../lifecycle/vcs.js";
import { createGhBoard, type RunGh } from "../lifecycle/gh-board.js";
import { createGhIssues } from "../lifecycle/issues.js";
import { createGhAnchor } from "../lifecycle/anchor.js";
import { createGhPulls } from "../lifecycle/pulls.js";
import { makeCloneRepo } from "../lifecycle/code-repo.js";
import { createGhProjects } from "../lifecycle/project-list.js";
import { runSuite } from "../governance/suite.js";
import { bumpVersion } from "../maintain/bump-version.js";
import { doctor, formatDoctorReport } from "../maintain/doctor.js";
import { checkDeps, formatDepsReport } from "../maintain/deps.js";
import { publishGate, formatPublishGate } from "../maintain/publish.js";
import { upgradePlan, formatUpgradePlan } from "../maintain/upgrade.js";
import { parseArgv, flagStr } from "./args.js";
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

  // `prj deps` — report runtime prerequisites (git/gh); pre-resolve.
  if (parsed.command === "deps") {
    const report = checkDeps((n) => tryRun(n, ["--version"]) !== undefined, process.platform);
    for (const line of formatDepsReport(report)) process.stdout.write(`${line}\n`);
    return report.ok ? 0 : 1;
  }

  // `prj publish` — the pre-publish GATE (version-sync); never publishes by hand.
  if (parsed.command === "publish") {
    const gate = publishGate(fs, process.cwd());
    for (const line of formatPublishGate(gate)) process.stdout.write(`${line}\n`);
    return gate.ok ? 0 : 1;
  }

  // `prj upgrade [<x.y.z>]` — plan + guidance (full self-update deferred).
  if (parsed.command === "upgrade") {
    let cliVersion = "0.0.0";
    try {
      const pkg = fs.readFile(fileURLToPath(new URL("../../../package.json", import.meta.url)));
      if (pkg) cliVersion = (JSON.parse(pkg) as { version?: string }).version ?? "0.0.0";
    } catch {
      /* keep default */
    }
    const plan = upgradePlan(cliVersion, parsed.positionals[0] ?? null);
    for (const line of formatUpgradePlan(plan)) process.stdout.write(`${line}\n`);
    return plan.kind === "error" ? 2 : 0;
  }

  const env = createNodeEnv();

  // `prj doctor` reports on the environment (incl. whether resolution works), so
  // it runs pre-resolve too.
  if (parsed.command === "doctor") {
    const resolve = prjResolveGov(env);
    const home = resolve.ok ? resolve.home : process.cwd();
    let cliVersion = "unknown";
    try {
      const pkg = fs.readFile(fileURLToPath(new URL("../../../package.json", import.meta.url)));
      if (pkg) cliVersion = (JSON.parse(pkg) as { version?: string }).version ?? "unknown";
    } catch {
      /* leave "unknown" */
    }
    const report = doctor({
      gitPresent: tryRun("git", ["--version"]) !== undefined,
      ghPresent: tryRun("gh", ["--version"]) !== undefined,
      resolve,
      activeOrg: env.readActiveOrg(),
      cliVersion,
      frameworkVersion: fs.readFile(path.join(home, ".framework-version"))?.trim() ?? null,
    });
    for (const line of formatDoctorReport(report)) process.stdout.write(`${line}\n`);
    return report.ok ? 0 : 1;
  }

  // `prj org …` runs BEFORE resolution — it's the bootstrap that makes resolution
  // work (registering a gov home / selecting the active org).
  if (parsed.command === "org") {
    const orgResult = routeOrg(parsed.positionals, { store: createNodeRegistryStore(), govConfigAt: (p) => env.govConfigAt(p) });
    for (const line of orgResult.lines) process.stdout.write(`${line}\n`);
    return orgResult.code;
  }

  // Resolve the gov workspace (the gov home for seed, the project clone otherwise).
  // `--gov-home <path>` / $PRJ_GOV_HOME target an EXPLICIT gov workspace and skip
  // the registry/resolver (for testing, CI, or a throwaway workspace). Unlike the
  // bash `$ADF_WORKSPACE` this is a per-invocation flag, so it can't stale-misdirect.
  const govHomeOverride = flagStr(parsed.flags, "gov-home") ?? process.env.PRJ_GOV_HOME;
  let home: string;
  if (govHomeOverride) {
    home = path.resolve(expandTilde(govHomeOverride));
  } else {
    const resolved = prjResolveGov(env);
    if (!resolved.ok) {
      process.stderr.write(`${resolveFailureMessage(resolved)}\n`);
      return resolved.code;
    }
    home = resolved.home;
  }

  const cfgText = fs.readFile(path.join(home, "org-config.yaml"));
  if (cfgText === null) {
    process.stderr.write(`prj: no org-config.yaml at ${home}\n`);
    return 1;
  }
  const config = parseOrgConfig(cfgText);

  // `prj validate` — run the governance validate suite on the resolved workspace.
  if (parsed.command === "validate") {
    const files = (tryRun("git", ["-C", home, "ls-files"]) ?? "").split("\n").filter(Boolean);
    const r = runSuite({ fs, repoRoot: home, files });
    if (r.ok) {
      process.stdout.write("validate: PASS (all validators)\n");
      return 0;
    }
    process.stdout.write("validate: FAIL\n");
    for (const f of r.failures) process.stdout.write(`  - ${f}\n`);
    return 1;
  }

  // Capture (don't inherit) stderr so best-effort gh failures — e.g. an
  // unsupported board op — don't spew gh's usage text to the terminal.
  const runGh: RunGh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
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
    projects: createGhProjects(runGh),
    cloneRepo: makeCloneRepo(vcs, { rmDir: (d) => fs.rm(d) }),
    gate: () => runSuite({ fs, repoRoot: home, files: (tryRun("git", ["-C", home, "ls-files"]) ?? "").split("\n").filter(Boolean) }),
    log: (m) => process.stderr.write(`${m}\n`),
  };

  const result = route(parsed, ctx);
  for (const line of result.lines) process.stdout.write(`${line}\n`);
  return result.code;
}
