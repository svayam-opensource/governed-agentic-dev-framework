// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * gov's logging — POL-423, through `@svayam-opensource/svm-util-log`.
 *
 * ## What this is for
 *
 * Every defect found in this project's container walks between #197 and #218 was diagnosed by
 * reading a screen recording, frame by frame, because gov left no record of the decisions it
 * made. #213 took four wrong fixes for exactly that reason: the question "which asker
 * answered?" had no answer anywhere except on a video.
 *
 * So the call sites are chosen to answer the questions those hunts actually asked, not to
 * narrate the program. A line that would not have shortened one of those investigations does
 * not belong here.
 *
 * ## Three rules this file exists to keep
 *
 * 1. **SILENT BY DEFAULT.** `error` and `warn` always reach the log; everything below is off
 *    until `NODE_DEBUG` names it. An adopter's ordinary run must look exactly as it does now.
 *
 * 2. **NEVER TAKES gov DOWN.** A logger that throws during the failure it was meant to record
 *    is worse than no logger. Every path here is wrapped: an unwritable home, a full disk or a
 *    bad configuration costs a line, never a command.
 *
 * 3. **THE DIRECTORY IS RESOLVED, NOT ASSUMED.** gov has a first run where no organization
 *    exists, so `~/.gov/<slug>/logs` is not yet a place. Before an org resolves the log goes to
 *    `~/.gov/logs`; afterwards to the org's own directory, beside the workspace it describes.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createApplicationLogger, LogLevel } from "@svayam-opensource/svm-util-log";

/** The code path convention: `<package>:<dir>:<module>` — see the logger's README. */
export const APP_ID = "gov-work";

/**
 * Where this run's log belongs.
 *
 * PURE, and separate from everything that writes, because the branch that matters — "is there
 * an organization yet?" — is the one worth testing, and testing it should not require a disk.
 */
export function logDirFor(activeOrg: string | null, home: string = os.homedir()): string {
  const base = path.join(home, ".gov");
  // A slug is a directory name here; anything that could climb out of `~/.gov` is not one.
  const slug = activeOrg?.trim().toLowerCase() ?? "";
  const safe = /^[a-z0-9][a-z0-9._-]*$/.test(slug) && !slug.startsWith(".");
  return safe ? path.join(base, slug, "logs") : path.join(base, "logs");
}

type Logger = ReturnType<typeof createApplicationLogger>;

let built: Logger | null | undefined;         // undefined = not built yet, null = could not build

/**
 * Build the transports once, on first use.
 *
 * THE IMPORT IS STATIC, THE CONSTRUCTION IS LAZY, and the split is deliberate. A lazy
 * `require()` would be `undefined` in gov's ESM build — caught by the catch below, and gov
 * would then log nothing at all while reporting nothing wrong. That is the same
 * fallback-indistinguishable-from-success shape this project has now filed three times; it
 * does not get to appear in the module whose job is to make such things visible.
 *
 * So the dependency is imported normally, and only the expensive half — opening a rotating
 * file transport, creating a directory — waits until something actually logs. `gov --version`
 * still touches no disk.
 */
function logger(): Logger | null {
  if (built !== undefined) return built;
  try {
    built = createApplicationLogger({
      appId: APP_ID,
      logDir: logDirFor(readActiveOrgQuietly()),
      methods: [
        // FILE ONLY. gov's console IS its user interface — every screen in this CLI is
        // deliberate, and a second stream of diagnostics arriving in the middle of a question
        // would undo the work of #204. The file is what gets sent to whoever is helping.
        { METHOD: "file", LOGLEVEL: LogLevel.debug },
      ],
    });
  } catch {
    // An unwritable home is a reason to log nothing, never a reason to fail a command.
    built = null;
  }
  return built;
}

/** The active org, read directly rather than through the registry, so this module has no cycle. */
function readActiveOrgQuietly(): string | null {
  try {
    const at = path.join(os.homedir(), ".gov", "active");
    return fs.existsSync(at) ? (fs.readFileSync(at, "utf8").trim() || null) : null;
  } catch {
    return null;
  }
}

/**
 * Record one decision.
 *
 * `pgm` is the CODE PATH — `gov-work:cli:ask` is `src/cli/ask.ts` — so a reader can get from a
 * line to the file without guessing, and can switch that one module on by name:
 *
 *     NODE_DEBUG=gov-work:cli:ask gov work
 *
 * Never throws. A logging failure must not become the user's problem.
 */
export function log(level: "error" | "warn" | "info" | "debug", msg: string, pgm: string, fn: string, meta?: unknown): void {
  try {
    logger()?.log(level, msg, pgm, fn, 0, meta);
  } catch {
    /* a lost line, never a lost command */
  }
}

/** Flush before a short-lived process exits, or the last lines — the interesting ones — are lost. */
export function closeLog(): void {
  try {
    built?.close();
  } catch {
    /* closing a closed logger is not news */
  }
}
