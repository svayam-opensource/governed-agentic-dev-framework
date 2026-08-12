// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The real filesystem/cwd-backed `ResolveEnv` adapter (SDD-040/041). Keeps all
 * OS/fs concerns out of the pure resolver core. Registry files live under
 * `~/.gov/`: `workspaces` (`<org>\t<home>`) and `active` (contract R10 — one location every
 * client reads). Resolution is read-only; writes belong to `gov org add`/setup. The legacy
 * `${XDG_CONFIG_HOME:-~/.config}/prj/` pair is migrated forward on first read (ensureRegistryMigrated).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { GovConfig, ResolveEnv } from "./types.js";
import { homeForOrg, parseGovWorkspaces } from "./registry.js";

/** Expand a leading `~` / `~/…` against `$HOME` (matches the bash pointer read). */
export function expandTilde(p: string, home: string = os.homedir()): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return path.join(home, p.slice(2));
  return p;
}

/**
 * The OS-idiomatic per-user config dir holding the CLI-local registry
 * (`gov-workspaces` + `active-org`). Windows → `%APPDATA%\prj`; elsewhere →
 * `$XDG_CONFIG_HOME/prj` or `~/.config/prj`. The `prj` leaf is kept for
 * continuity with existing registries (shared multi-home store). Pure — env /
 * platform / home are injectable for tests.
 */
export function configDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home: string = os.homedir()): string {
  // Compose with the flavour of the platform we were TOLD about, not the one we happen to run on. The
  // function takes `platform` as a parameter, so `configDir(env, "linux", …)` promising a POSIX path and
  // returning `\x\cfg\prj` on a Windows host is simply wrong — latent today only because real callers pass
  // `process.platform`, and found the first time this suite ran on Windows.
  const j = platform === "win32" ? path.win32 : path.posix;
  if (platform === "win32") {
    const appData = env.APPDATA && env.APPDATA.trim() ? env.APPDATA : j.join(home, "AppData", "Roaming");
    return j.join(appData, "prj");
  }
  const xdg = env.XDG_CONFIG_HOME;
  return j.join(xdg && xdg.trim() ? xdg : j.join(home, ".config"), "prj");
}

/**
 * The registry directory — `~/.gov` on every platform (workspace-resolution contract R10).
 *
 * DELIBERATELY NOT OS-IDIOMATIC, unlike {@link configDir}. R10 requires ONE location that every client
 * reads: if `gov` looks in `~/.gov` while another looks in `%APPDATA%\prj`, the two report different
 * ACTIVE ORGS — the same divergence `svm-prj-work#310` exists to end, one level down and harder to see.
 * A per-platform answer cannot satisfy "one location", so the contract picks home-relative and every
 * client complies.
 *
 * `${XDG_CONFIG_HOME:-~/.config}/prj/` is the legacy location — named after the RETIRED `prj` CLI. It is
 * read for migration and never written; see {@link legacyRegistryFiles}.
 */
export function govRegistryDir(home: string = os.homedir(), platform: NodeJS.Platform = process.platform): string {
  const j = platform === "win32" ? path.win32 : path.posix;
  return j.join(home, ".gov");
}

/** The canonical registry files (R10). */
export function registryFiles(home: string = os.homedir(), platform: NodeJS.Platform = process.platform): { readonly workspaces: string; readonly active: string } {
  const j = platform === "win32" ? path.win32 : path.posix;
  const dir = govRegistryDir(home, platform);
  return { workspaces: j.join(dir, "workspaces"), active: j.join(dir, "active") };
}

/** Where a pre-R10 install kept the same two facts. Read-only: migrated from, never written to. */
export function legacyRegistryFiles(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home: string = os.homedir()): { readonly workspaces: string; readonly active: string } {
  const j = platform === "win32" ? path.win32 : path.posix;
  const dir = configDir(env, platform, home);
  return { workspaces: j.join(dir, "gov-workspaces"), active: j.join(dir, "active-org") };
}

/** Has the legacy→canonical migration already been attempted in this process? */
let registryMigrationAttempted = false;

/**
 * Carry a pre-R10 registry forward to `~/.gov/`, once per process.
 *
 * MUST run wherever the registry is READ, not only where it is written. The registry has two readers —
 * the resolver ({@link createNodeEnv}) and the store — and migrating in only one means a command that
 * merely resolves (`gov doctor`, and every governance read) sees an empty registry and hard-fails
 * `no-active-org` on a machine that worked before the upgrade. Found exactly that way.
 *
 * Copies, never moves: the legacy files stay so a downgrade still works. Only ever writes when the
 * canonical location is absent, so it cannot overwrite anything current. Failure is swallowed — a
 * migration that cannot write must not break the command, and the legacy files remain to retry from.
 */
export function ensureRegistryMigrated(home: string = os.homedir(), platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): void {
  if (registryMigrationAttempted) return;
  registryMigrationAttempted = true;
  try {
    const canonical = registryFiles(home, platform);
    if (fs.existsSync(canonical.workspaces) || fs.existsSync(canonical.active)) return;
    const legacy = legacyRegistryFiles(env, platform, home);
    const read = (f: string): string | null => { try { return fs.readFileSync(f, "utf8"); } catch { return null; } };
    const w = read(legacy.workspaces);
    const a = read(legacy.active);
    if (w === null && a === null) return;                       // fresh machine — nothing to carry
    fs.mkdirSync(govRegistryDir(home, platform), { recursive: true });
    if (w !== null) fs.writeFileSync(canonical.workspaces, w, "utf8");
    if (a !== null) fs.writeFileSync(canonical.active, a, "utf8");
  } catch {
    /* never break a command over a migration */
  }
}

/** Test seam: forget that migration ran, so a fresh fixture is not skipped. */
export function resetRegistryMigrationForTests(): void {
  registryMigrationAttempted = false;
}

/** True if `p` sits inside a `.bases/` base clone (never a real gov home). */
export function containsBasesSegment(p: string): boolean {
  // BOTH separators, deliberately. Splitting on `path.sep` alone means that on Windows a POSIX-shaped path
  // never matches — and POSIX-shaped paths are normal here: `agent_work_root: "~/.svm/projects"` is written
  // with forward slashes in every org-config, on every platform. The guard would then miss a `.bases` clone
  // and treat it as a real gov home, which is the exact confusion it exists to prevent.
  return p.split(/[\\/]/).includes(".bases");
}

/**
 * Extract a TOP-LEVEL scalar (`key: value`) from YAML text. Deliberately tiny —
 * only what the resolver needs (`github_org`, `gov_workspace`), mirroring what
 * the bash `yq` / `python3` one-liners return for a simple string field. Ignores
 * indented keys; tolerates single/double quotes and trailing `#` comments on
 * unquoted values.
 */
export function readTopLevelScalar(text: string, key: string): string | null {
  const re = new RegExp(`^${key}\\s*:\\s*(.*)$`);
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (/^\s/.test(line)) continue; // indented → not a top-level key
    const m = line.match(re);
    if (!m) continue;
    return cleanScalar(m[1]);
  }
  return null;
}

function cleanScalar(value: string): string {
  let v = value.trim();
  if (v.startsWith('"')) {
    const end = v.indexOf('"', 1);
    return end >= 0 ? v.slice(1, end) : v.slice(1);
  }
  if (v.startsWith("'")) {
    const end = v.indexOf("'", 1);
    return end >= 0 ? v.slice(1, end) : v.slice(1);
  }
  const hash = v.indexOf(" #"); // inline comment on an unquoted scalar
  if (hash >= 0) v = v.slice(0, hash);
  return v.trim();
}

/** Options for the Node adapter (all overridable for tests). */
export interface NodeEnvOptions {
  readonly cwd?: string;
  readonly configDir?: string;
  readonly home?: string;
}

/** Build a read-only, filesystem-backed `ResolveEnv`. */
export function createNodeEnv(opts: NodeEnvOptions = {}): ResolveEnv {
  const home = opts.home ?? os.homedir();
  const cwd = opts.cwd ?? process.cwd();
  // R10 — the resolver reads the SAME canonical location the store writes. These were two separate
  // readers of two separate paths; leaving this one on the legacy dir would mean `gov org use` wrote
  // somewhere resolution never looked, which is this bug's own failure mode reproduced inside one client.
  const configDirPath = opts.configDir ?? govRegistryDir(home, process.platform);
  if (!opts.configDir) ensureRegistryMigrated(home);            // upgrade path — see the function's note

  const govWorkspaces = path.join(configDirPath, "workspaces");
  const activeOrgFile = path.join(configDirPath, "active");

  const readText = (file: string): string | null => {
    try {
      return fs.readFileSync(file, "utf8");
    } catch {
      return null;
    }
  };

  /** Normalize a home path for identity comparison: expand `~`, then realpath
   *  (falling back to path.resolve for paths that don't exist on disk). */
  const normalizeHome = (p: string): string => {
    const expanded = expandTilde(p, home);
    try {
      return fs.realpathSync(expanded);
    } catch {
      return path.resolve(expanded);
    }
  };

  return {
    cwd,

    parentOf(p: string): string | null {
      const parent = path.dirname(p);
      return parent === p ? null : parent; // dirname('/') === '/'
    },

    govConfigAt(p: string): GovConfig | null {
      if (containsBasesSegment(p)) return null;
      const text = readText(path.join(p, "org-config.yaml"));
      if (text === null) return null;
      const org = readTopLevelScalar(text, "github_org");
      if (!org) return null;
      const gwRaw = readTopLevelScalar(text, "gov_workspace");
      const govWorkspace = gwRaw ? path.resolve(expandTilde(gwRaw, home)) : null;
      return { org, govWorkspace };
    },

    readActiveOrg(): string | null {
      const raw = readText(activeOrgFile);
      if (raw === null) return null;
      const first = raw.split("\n")[0].trim();
      return first || null;
    },

    homeForOrg(org: string): string | null {
      const text = readText(govWorkspaces);
      if (text === null) return null;
      return homeForOrg(parseGovWorkspaces(text), org);
    },

    sameHome(a: string, b: string): boolean {
      return normalizeHome(a) === normalizeHome(b);
    },
  };
}
