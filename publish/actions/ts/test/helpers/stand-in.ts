// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * STAND-IN PROGRAMS THAT GOV CAN FIND ON EVERY OS (node-ci run 38838958583).
 *
 * A test that puts a fake `gh` first on PATH writes a shell script with no extension. bash finds it; gov does not on
 * Windows, and must not: gov spawns the way Windows does (PATH × PATHEXT, `src/win-spawn.ts`), so an extensionless
 * file is not a program there, and the REAL `gh.exe` further down PATH answered instead. The stand-in therefore gets
 * a `<name>.cmd` beside it on Windows that hands the script to Git Bash — exactly the shape of an npm shim, which is
 * what most of the programs gov runs are on a Windows machine.
 *
 * A `.cmd` goes through cmd.exe, which ends a command at a newline: a stand-in that must receive a multi-line
 * argument is run as `bash <script>` instead ({@link bashExe}).
 */
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Git Bash's bash.exe on Windows (never System32's, which is WSL's launcher); plain `bash` elsewhere. The suite runs
 * under Git Bash on Windows (`npm config set script-shell bash`), so its directory is on PATH.
 */
export function bashExe(): string {
  if (process.platform !== "win32") return "bash";
  const dirs = (process.env.PATH ?? process.env.Path ?? "").split(";").filter(Boolean);
  const hit = dirs
    .filter((d) => !/\\(system32|windowsapps)\\?$/i.test(d) && !/\\windows\\?$/i.test(d))
    .map((d) => path.join(d, "bash.exe"))
    .find((f) => fs.existsSync(f));
  return hit ?? "C:\\Program Files\\Git\\bin\\bash.exe";
}

/**
 * Write `<dir>/<name>` so that gov's spawn finds it on this OS, and return its path. The script is bash unless it is
 * `node` (a `#!/usr/bin/env node` script): on Windows that one is handed to this Node, not to Git Bash.
 */
export function writeStandIn(dir: string, name: string, script: string, interpreter: "bash" | "node" = "bash"): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, script, { mode: 0o755 });
  const runner = interpreter === "node" ? process.execPath : bashExe();
  if (process.platform === "win32") fs.writeFileSync(path.join(dir, `${name}.cmd`), `@"${runner}" "%~dp0${name}" %*\r\n`);
  return file;
}
