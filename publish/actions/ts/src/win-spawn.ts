// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * HOW A COMMAND IS SPAWNED ON WINDOWS (#223, PRJ-121 plan 04 T10, ruling Q10 B).
 *
 * `spawnSync("npm", …)` with no shell finds only a `.exe` on win32. `npm`, `code`, `claude` and every agent npm
 * installs are `.cmd` shims, so on native Windows each `gov agent install` step died with ENOENT. The fix lives in
 * ONE place, the process chokepoint (`run-process.ts`), and the rules are the ones cross-spawn has used for years,
 * written here in a few dozen lines rather than taken as a dependency (gov has two):
 *
 *   1. resolve the command through PATH × PATHEXT (a name with a directory is checked where it says);
 *   2. a resolved `.exe`/`.com` is spawned directly, by its full path;
 *   3. a resolved `.cmd`/`.bat` runs as `cmd.exe /d /s /c "<command> <args>"`, every part caret-escaped, with
 *      Node told not to quote again (`windowsVerbatimArguments`);
 *   4. not found → an error that names the command and the directories searched — not a bare ENOENT.
 *
 * Pure: platform, environment and file test are injected, so the rules are tested on any OS.
 */
import * as path from "node:path";

export interface WinSpawnDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly isFile: (p: string) => boolean;
}

export interface SpawnPlan {
  readonly file: string;
  readonly args: readonly string[];
  /** true → pass `windowsVerbatimArguments: true`; the arguments are already quoted for cmd.exe. */
  readonly verbatim: boolean;
}

const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";
/** cmd.exe acts on these unless each is preceded by `^`. Space and `"` are included so a quoted argument stays one. */
const META = /([()\][%!^"`<>&|;, *?])/g;
/** An npm-generated shim re-parses its arguments through cmd once more, so they need escaping twice. */
const NPM_SHIM = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i;

/** Environment lookup the way Windows does it: names are case-insensitive (`Path`, `PATH`, `ComSpec`). */
export function envGet(env: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  const key = Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

export class CommandNotFoundError extends Error {
  /** Kept as ENOENT so a caller that tests `code === "ENOENT"` behaves exactly as before. */
  readonly code = "ENOENT";
  constructor(readonly command: string, readonly searched: readonly string[], readonly pathext: string) {
    super(
      `'${command}' was not found. gov looked for ${command} with each of ${pathext} in every directory on PATH:\n`
      + (searched.length ? searched.map((d) => `    ${d}`).join("\n") : "    (PATH is empty)")
      + `\n  Install ${command}, or open a new terminal if you installed it a moment ago (PATH is read when a terminal starts).`,
    );
    this.name = "CommandNotFoundError";
  }
}

/** Find `cmd` the way Windows does: a directory part is checked where it says; a bare name walks PATH × PATHEXT. */
export function resolveWin32Command(cmd: string, deps: WinSpawnDeps): { path: string | undefined; searched: readonly string[]; pathext: string } {
  const pathext = envGet(deps.env, "PATHEXT") || DEFAULT_PATHEXT;
  // lower-cased: Windows file names are case-insensitive, and `npm.cmd` reads better in a message than `npm.CMD`.
  const exts = pathext.split(";").filter(Boolean).map((e) => e.toLowerCase());
  const candidates = (base: string): string[] => {
    const hasExt = exts.some((e) => base.toLowerCase().endsWith(e));
    return hasExt ? [base, ...exts.map((e) => base + e)] : exts.map((e) => base + e);
  };
  if (/[\\/]/.test(cmd)) {
    const hit = candidates(cmd).find((c) => deps.isFile(c));
    return { path: hit, searched: [path.win32.dirname(cmd)], pathext };
  }
  const dirs = (envGet(deps.env, "PATH") ?? "").split(";").map((d) => d.replace(/^"(.*)"$/, "$1")).filter(Boolean);
  for (const dir of dirs) {
    const hit = candidates(path.win32.join(dir, cmd)).find((c) => deps.isFile(c));
    if (hit) return { path: hit, searched: dirs, pathext };
  }
  return { path: undefined, searched: dirs, pathext };
}

/** Quote one argument for `cmd.exe /s /c` + the C runtime's argv parser (cross-spawn's rules). */
export function escapeCmdArg(arg: string, doubleEscape: boolean): string {
  let a = arg.replace(/(\\*)"/g, '$1$1\\"');   // backslashes before a quote double, the quote is escaped
  a = a.replace(/(\\*)$/, "$1$1");             // trailing backslashes double, so the closing quote survives
  a = `"${a}"`.replace(META, "^$1");
  return doubleEscape ? a.replace(META, "^$1") : a;
}

/** What to spawn for `cmd args` on `platform`. Off Windows it is the command itself, unchanged. */
export function spawnPlan(
  cmd: string,
  args: readonly string[],
  deps: WinSpawnDeps & { readonly platform: NodeJS.Platform },
): SpawnPlan {
  if (deps.platform !== "win32") return { file: cmd, args: [...args], verbatim: false };
  const r = resolveWin32Command(cmd, deps);
  if (!r.path) throw new CommandNotFoundError(cmd, r.searched, r.pathext);
  if (!/\.(cmd|bat)$/i.test(r.path)) return { file: r.path, args: [...args], verbatim: false };
  const shim = NPM_SHIM.test(r.path);
  const line = [r.path.replace(META, "^$1"), ...args.map((a) => escapeCmdArg(a, shim))].join(" ");
  return { file: envGet(deps.env, "ComSpec") || "cmd.exe", args: ["/d", "/s", "/c", `"${line}"`], verbatim: true };
}
