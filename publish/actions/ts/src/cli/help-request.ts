// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * IS THIS A REQUEST FOR HELP? — decided before anything else runs (PRJ-121, 2026-09-22).
 *
 * Only a bare `gov --help` was recognised. After a command name, `--help` / `-h` went to the command, which
 * ignored it and RAN: on a local walk `gov merge -h` attempted a merge (it stopped only because the branch was
 * not a project branch), and `gov work --help` started the work flow. `gov help <cmd>` — advertised by
 * `--help` and the menu footer — answered "unknown command 'help'".
 *
 * The rule every well-behaved CLI keeps (git, gh, kubectl, docker; clig.dev): help ALWAYS works and NEVER
 * acts. So `bin.ts` asks this first, before first-run, the context banner and any workspace resolution.
 */

export interface HelpRequest {
  /** The command or topic help was asked about; undefined = the overview. */
  readonly command?: string;
  /** `-h` — the short form: usage and an example (git's distinction). */
  readonly short?: boolean;
  /** `--all` — include the commands for building gov itself. */
  readonly all?: boolean;
  /** `--json` — the specs, for an agent. */
  readonly json?: boolean;
}

const HELP_FLAGS = new Set(["--help", "-h"]);

/**
 * `gov help`, `gov help <cmd>`, `gov --help`, `gov <cmd> … --help|-h …` → a request; anything else → null.
 * Arguments after a `--` terminator are values, never flags, so `gov issue --title x -- -h` is not help.
 */
export function helpRequest(argv: readonly string[]): HelpRequest | null {
  const end = argv.indexOf("--");
  const flags = end === -1 ? argv : argv.slice(0, end);
  const extras = {
    ...(flags.includes("--all") ? { all: true } : {}),
    ...(flags.includes("--json") ? { json: true } : {}),
  };
  if (argv[0] === "help") {
    return argv[1] && !argv[1].startsWith("-") ? { command: argv[1], ...extras } : extras;
  }
  if (!flags.some((a) => HELP_FLAGS.has(a))) return null;
  // `-h` is the SHORT page, `--help` the full one — git's distinction, and the reason both exist.
  const short = flags.includes("-h") && !flags.includes("--help");
  const first = argv[0];
  return {
    ...(first && !first.startsWith("-") ? { command: first } : {}),
    ...(short ? { short: true } : {}),
    ...extras,
  };
}
