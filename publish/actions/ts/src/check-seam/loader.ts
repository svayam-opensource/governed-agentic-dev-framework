// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd. — part of the OSS governed-agentic-dev-framework.
/**
 * FINDING AND STARTING THE OPTIONAL PAID MODULE (spec 02 §5). This is the only place open gov names it, and only as
 * a string.
 *
 * Discovery, first hit wins — and every step is a local file-system look, never a network call:
 *   1. `GOV_CHECK_PATH` — a directory holding the module's package.json (or the module's entry file);
 *   2. the GLOBAL SIBLING — `@svayam/gov-check` installed next to this gov (`npm i -g` puts both under one root);
 *   3. the `gov licence install` location — {@link govCheckInstallDir}.
 *
 * Nothing found is the normal case and costs nothing: no import, no activation, no line. A module that is found but
 * does not fit (S7 lock-step), will not load, or declines to activate yields `refused` with ONE quiet line; gov then
 * runs exactly as it does without it. The loader never throws.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkLockStep, type ActivationOptions, type CheckModule, type Host, type PaidModule } from "./public.js";

export const MODULE_NAME = "@svayam/gov-check";

/** Where `gov licence install` puts the module (a private npm prefix): `<dir>/node_modules/@svayam/gov-check`. */
export function govCheckInstallDir(env: Readonly<Record<string, string | undefined>>, platform: NodeJS.Platform = process.platform, home: string = os.homedir()): string {
  if (env.GOV_CHECK_HOME) return env.GOV_CHECK_HOME;
  if (platform === "win32") return path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "gov", "gov-check");
  return path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "gov", "gov-check");
}

/** This gov's own package root (…/node_modules/@svayam-opensource/gov when installed). */
function ownPackageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    dir = path.dirname(dir);
  }
  return dir;
}

export interface Discovery {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Injected for tests; default: real fs. */
  readonly exists?: (p: string) => boolean;
  /** This gov's package root; default: found from this file. */
  readonly govRoot?: string;
  readonly installDir?: string;
}

/** The module's entry (a directory with package.json, or a file), or null. Local look-ups only. */
export function discoverModule(d: Discovery): { readonly entry: string; readonly via: "GOV_CHECK_PATH" | "global" | "licence-install" } | null {
  const exists = d.exists ?? fs.existsSync;
  const explicit = d.env.GOV_CHECK_PATH;
  if (explicit) return exists(explicit) ? { entry: path.resolve(explicit), via: "GOV_CHECK_PATH" } : null;
  const govRoot = d.govRoot ?? ownPackageRoot();
  if (path.basename(path.dirname(govRoot)) === "@svayam-opensource") {
    const sibling = path.join(path.dirname(path.dirname(govRoot)), ...MODULE_NAME.split("/"));
    if (exists(path.join(sibling, "package.json"))) return { entry: sibling, via: "global" };
  }
  const installed = path.join(d.installDir ?? govCheckInstallDir(d.env), "node_modules", ...MODULE_NAME.split("/"));
  if (exists(path.join(installed, "package.json"))) return { entry: installed, via: "licence-install" };
  return null;
}

/** A directory's import target: its package.json `exports["."]` (import) or `main`, else index.js. */
function entryFile(entry: string): string {
  if (!fs.statSync(entry).isDirectory()) return entry;
  const pkg = JSON.parse(fs.readFileSync(path.join(entry, "package.json"), "utf8")) as { exports?: unknown; main?: string; module?: string };
  const e = pkg.exports;
  const dot = typeof e === "string" ? e : e && typeof e === "object" ? (e as Record<string, unknown>)["."] ?? e : undefined;
  const pick = (x: unknown): string | undefined => {
    if (typeof x === "string") return x;
    if (x && typeof x === "object") { const o = x as Record<string, unknown>; return pick(o.import) ?? pick(o.default) ?? pick(o.require); }
    return undefined;
  };
  return path.join(entry, pick(dot) ?? pkg.module ?? pkg.main ?? "index.js");
}

export type LoadedModule =
  | { readonly state: "absent" }
  | { readonly state: "refused"; readonly lines: readonly string[] }
  | { readonly state: "active"; readonly module: PaidModule; readonly via: string };

export interface LoadDeps extends Discovery {
  readonly host: Host;
  readonly opts: Omit<ActivationOptions, "env">;
  /** Injected for tests; default: dynamic import of a file URL. */
  readonly importModule?: (file: string) => Promise<unknown>;
}

const quiet = (what: string): string => `gov-check: ${what} — running without it.`;

export async function loadCheckModule(d: LoadDeps): Promise<LoadedModule> {
  const found = discoverModule(d);
  if (!found) return { state: "absent" };
  let mod: Partial<CheckModule>;
  try {
    const file = entryFile(found.entry);
    mod = (await (d.importModule ?? ((f: string) => import(pathToFileURL(f).href)))(file)) as Partial<CheckModule>;
  } catch (e) {
    return { state: "refused", lines: [quiet(`the module at ${found.entry} could not be loaded (${(e as Error).message.split("\n")[0]})`)] };
  }
  if (!mod || typeof mod.activate !== "function" || !mod.api) return { state: "refused", lines: [quiet(`${found.entry} is not a gov-check module`)] };
  const fit = checkLockStep(mod.api);
  if (!fit.ok) return { state: "refused", lines: [fit.line] };
  try {
    const out = await mod.activate(d.host, { ...d.opts, env: d.env });
    if (!out || (out as { ok?: unknown }).ok === false) {
      const lines = ((out as { lines?: readonly string[] } | undefined)?.lines ?? []).slice(0, 1);
      return { state: "refused", lines: lines.length ? lines : [quiet("it declined to start")] };
    }
    return { state: "active", module: out as PaidModule, via: found.via };
  } catch (e) {
    return { state: "refused", lines: [quiet(`it failed to start (${(e as Error).message.split("\n")[0]})`)] };
  }
}
