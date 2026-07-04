// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The interactive menu (`prj` with no args on a TTY) — number-pick a command,
 * type its args, run it. The command mapping is pure (testable); the readline
 * loop is thin I/O glue that delegates to `main`.
 */
import * as readline from "node:readline";

export const MENU_COMMANDS = [
  "setup", "seed", "join", "task", "merge", "sync", "add-repo", "close",
  "pause", "resume", "cancel", "manage", "anchor", "knowledge",
  "list", "status", "org", "validate", "doctor", "deps", "upgrade",
] as const;

/** Resolve a menu choice (a number or a command name) to a command, or null. */
export function resolveMenuChoice(choice: string, commands: readonly string[] = MENU_COMMANDS): string | null {
  const t = choice.trim();
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= commands.length) return commands[n - 1];
  return commands.includes(t) ? t : null;
}

/** Render the numbered command list (for the menu + tests). */
export function formatMenu(commands: readonly string[] = MENU_COMMANDS): string[] {
  return ["prj — pick a command:", ...commands.map((c, i) => `  ${String(i + 1).padStart(2)}) ${c}`), "   0) quit"];
}

/** Run the interactive menu, delegating the chosen command to `run` (main). */
export async function runMenu(run: (argv: string[]) => number): Promise<number> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const ask = (q: string): Promise<string> => new Promise((res) => rl.question(q, res));
  try {
    for (const line of formatMenu()) process.stderr.write(`${line}\n`);
    const choice = (await ask("Choose: ")).trim();
    if (choice === "0" || choice === "" || choice.toLowerCase() === "q") return 0;
    const cmd = resolveMenuChoice(choice);
    if (cmd === null) {
      process.stderr.write(`unknown choice '${choice}'\n`);
      return 2;
    }
    const argsLine = (await ask(`args for '${cmd}' (space-separated, blank if none): `)).trim();
    return run([cmd, ...(argsLine ? argsLine.split(/\s+/) : [])]);
  } finally {
    rl.close();
  }
}
