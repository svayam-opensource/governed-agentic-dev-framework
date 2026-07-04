// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The real filesystem/cwd-backed `ResolveEnv` adapter (SDD-040/041). Keeps all
 * OS/fs concerns out of the pure resolver core. Registry files live under
 * `${XDG_CONFIG_HOME:-~/.config}/prj/`: `gov-workspaces` (`<org>\t<home>`) and
 * `active-org`. Resolution is read-only; writes belong to `prj org add`/setup.
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

/** True if `p` sits inside a `.bases/` base clone (never a real gov home). */
export function containsBasesSegment(p: string): boolean {
  return p.split(path.sep).includes(".bases");
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
  const configDir =
    opts.configDir ??
    path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "prj");

  const govWorkspaces = path.join(configDir, "gov-workspaces");
  const activeOrgFile = path.join(configDir, "active-org");

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
