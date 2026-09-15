// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Minimal argv parsing for the `prj` dispatcher — `prj <command> [positionals]
 * [--flag[=value]]`. A `--flag value` form is supported (consume-next) unless the
 * next token is itself a flag, in which case `--flag` is a boolean.
 */
export interface ParsedArgs {
  readonly command: string;
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
}

export function parseArgv(argv: readonly string[]): ParsedArgs | { error: string } {
  if (argv.length === 0) return { error: "no command given (try: gov-work <command>)" };
  const [command, ...rest] = argv;
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const body = a.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else if (i + 1 < rest.length && !rest[i + 1].startsWith("--")) {
        flags[body] = rest[++i];
      } else {
        flags[body] = true;
      }
    } else {
      positionals.push(a);
    }
  }
  return { command, positionals, flags };
}

/**
 * Read a flag as a switch: true when the name is present, whatever it carries.
 *
 * Presence rather than value, because the parser above assigns the next token to a flag that has no
 * `=`. So `--clean https://…` records the URL as the flag's value, and testing `=== true` would read
 * that as "not set" — a switch that silently does nothing when the operator puts it before the
 * positional. Here it stays true, and the missing positional is reported by the usage check.
 */
export function flagBool(flags: Readonly<Record<string, string | boolean>>, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(flags, name);
}

/** Read a flag as a string, or undefined if absent / boolean. */
export function flagStr(flags: Readonly<Record<string, string | boolean>>, name: string): string | undefined {
  const v = flags[name];
  return typeof v === "string" ? v : undefined;
}
