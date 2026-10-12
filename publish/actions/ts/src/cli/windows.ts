// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WHAT IS DIFFERENT ON WINDOWS, outside the spawn chokepoint (PRJ-121 plan 04 T11; spec §4.1 table, §4.4).
 *
 * Pure functions, platform and environment injected, so each rule is tested on any OS.
 *
 * THE BIN-DIRECTORY CONTRACT (for the MSI, T13). The MSI installs gov per-user under
 * `%LOCALAPPDATA%\Programs\gov\{node,app,bin}` and puts ONLY `bin\` on the user PATH. Its launcher (`bin\gov.cmd`)
 * sets `GOV_BIN_DIR` to that `bin\` directory and puts `node\` first on PATH for gov's own process. npm installs an
 * agent beside gov's Node (`node\claude.cmd` — npm's global prefix is node.exe's directory on Windows), which is not
 * on the user PATH; gov writes `bin\<agent>.cmd` pointing at it and proves it with `--version` (#209 on Windows).
 */
import * as path from "node:path";
import { PACKAGE_NAME } from "../package-identity.js";
import { envGet } from "../win-spawn.js";

/** The winget package id the MSI is listed under (I04.2, P7). */
export const WINGET_ID = "Svayam.Gov";

/** The device a synchronous question reads from: the console input buffer on Windows, the controlling tty elsewhere. */
export function ttyDevice(platform: NodeJS.Platform): string {
  return platform === "win32" ? "\\\\.\\CONIN$" : "/dev/tty";
}

/**
 * The `<agent>.cmd` gov writes into its bin directory. `setlocal` keeps the PATH change inside the shim; `call` so
 * a `.cmd` target returns here (and its exit code with it). CRLF: cmd.exe misreads labels and long lines in LF files.
 */
export function windowsAgentShim(nodeBin: string, target: string): string {
  return [
    "@echo off",
    "rem written by gov - keeps an agent gov installed reachable after gov exits (#209)",
    "setlocal",
    `set "PATH=${nodeBin};%PATH%"`,
    `call "${target}" %*`,
    "exit /b %ERRORLEVEL%",
    "",
  ].join("\r\n");
}

export type WindowsLinkPlan =
  | { readonly kind: "not-ours" }
  | { readonly kind: "nowhere-to-link"; readonly dir: string; readonly nodeBin: string }
  | { readonly kind: "write"; readonly dir: string; readonly shim: string; readonly target: string; readonly content: string };

/** Where (and whether) to put a shortcut for `cmd`, installed by npm beside gov's Node in `nodeBin`. */
export function windowsLinkPlan(f: {
  readonly cmd: string; readonly nodeBin: string;
  readonly env: Readonly<Record<string, string | undefined>>; readonly isFile: (p: string) => boolean;
}): WindowsLinkPlan {
  const target = [".cmd", ".exe"].map((e) => path.win32.join(f.nodeBin, f.cmd + e)).find((p) => f.isFile(p));
  if (!target) return { kind: "not-ours" };
  const onPath = (envGet(f.env, "PATH") ?? "").split(";").map((d) => d.replace(/[\\/]+$/, "").toLowerCase());
  const has = (d: string): boolean => onPath.includes(d.replace(/[\\/]+$/, "").toLowerCase());
  if (has(f.nodeBin)) return { kind: "not-ours" };       // a machine Node on PATH: npm's shim is already reachable
  const dir = envGet(f.env, "GOV_BIN_DIR");
  if (!dir) return { kind: "nowhere-to-link", dir: "(gov's bin directory — not known: gov was not started by its launcher)", nodeBin: f.nodeBin };
  if (!has(dir)) return { kind: "nowhere-to-link", dir, nodeBin: f.nodeBin };
  return { kind: "write", dir, shim: path.win32.join(dir, `${f.cmd}.cmd`), target, content: windowsAgentShim(f.nodeBin, target) };
}

/**
 * `icacls` argv that makes `file` readable by its owner only: inherited entries removed, the user granted full
 * control, nothing else. null when the user is unknown — the caller reports it rather than guessing an account.
 */
export function ownerOnlyAclArgv(file: string, env: Readonly<Record<string, string | undefined>>): readonly string[] | null {
  const user = envGet(env, "USERNAME");
  if (!user) return null;
  const domain = envGet(env, "USERDOMAIN");
  return ["icacls", file, "/inheritance:r", "/grant:r", `${domain ? `${domain}\\` : ""}${user}:(F)`];
}

/** How a person updates the gov CLI. On Windows the client is the MSI, updated by winget — never `npm i -g` (Q11). */
export function clientUpdateCommand(version: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? `winget upgrade ${WINGET_ID}` : `npm install -g ${PACKAGE_NAME}@${version}`;
}
