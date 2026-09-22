// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * gov's logging — POL-423, through `@svayam-opensource/svm-util-log`.
 *
 * ## What this is for
 *
 * Every defect found in this project's container walks was diagnosed by reading a screen recording or a pasted
 * terminal, because gov left no record of the decisions it made. #213 took four wrong fixes for exactly that
 * reason: "which asker answered?" had no answer anywhere except on a video. On 2026-09-22 it happened again —
 * a dropped `gh` connection, pages of 11/1/7, a dead active org — all diagnosed from paste.
 *
 * ## ONE FILE PER RUN (Policy Owner, 2026-09-23)
 *
 * gov is run from many terminals, on many projects, at once. A shared daily file meant every investigation began
 * by untangling interleaved runs, and rotation races when runs overlap. So each run owns a folder:
 *
 *   <work-root>/preferences/<gh-login>/state/logs/<day>/<HHMMSS-run-project-command>/
 *
 * A run announces its own path when something fails, and `gov log` lists and opens them. The folder (rather than
 * a bare file) is what the shared logger's file transport gives us today: it composes its own `%DATE%-<app>.log`
 * name. Flattening needs an exact-filename option in svm-util-log (911) — noted, not worth blocking on.
 *
 * ## Three rules this file exists to keep
 *
 * 1. **SILENT ON SCREEN.** Nothing here writes to stdout or stderr, ever. The FILE takes `info` and above on
 *    every run (2026-09-23: a log that records nothing by default is what left those defects to paste);
 *    `debug` waits for `GOV_DEBUG=1`.
 * 2. **NEVER TAKES gov DOWN.** A logger that throws during the failure it was meant to record is worse than no
 *    logger. Every path is wrapped: an unwritable disk costs a line, never a command.
 * 3. **NEVER A SECRET** (POL-427). Values of secret-looking flags are redacted before they reach a line, and
 *    callers pass presence, never the secret itself.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createApplicationLogger, LogLevel } from "@svayam-opensource/svm-util-log";
import { dayFolder, expiredDayFolders, logsRoot, newRunId, redactArgv, runFolder } from "./state-paths.js";

/** The code path convention: `<package>:<dir>:<module>` — see the logger's README. */
export const APP_ID = "gov-work";

/** How many days of run folders are kept. The Policy Owner's default; `logs.keepDays` will override it. */
export const KEEP_DAYS = 14;

type Logger = ReturnType<typeof createApplicationLogger>;

interface Run {
  readonly id: string;
  readonly dir: string;          // the run's folder, or "" when nothing could be written
  readonly started: number;
  logger: Logger | null;
}

let run: Run | null = null;
let startedArgv: readonly string[] = [];

/**
 * Where this run's folder belongs.
 *
 * The identity that keys the folder is the GitHub login (the Policy Owner's rule: each client uses the identity
 * it operates with). It is cached at `~/.gov/<slug>/login` by whoever learns it, because asking `gh` costs a
 * process — and a log that spawns a process to decide where to write is a log that slows every command.
 * Before an org exists, or before the login is known, the run goes to `~/.gov/logs/<day>/<run>/`: the same
 * shape, somewhere that always exists.
 */
export function runDirFor(
  now: Date, runId: string, project: string | null, command: string,
  workRoot: string | null, login: string | null, home: string = os.homedir(),
): string {
  const root = workRoot && login ? logsRoot(workRoot, login) : path.join(home, ".gov", "logs");
  return path.join(root, dayFolder(now), runFolder(now, runId, project, command));
}

/** Read the cached login, if some earlier run wrote it. Never asks `gh`: see runDirFor. */
export function cachedLogin(orgSlug: string | null, home: string = os.homedir()): string | null {
  if (!orgSlug) return null;
  try {
    const t = fs.readFileSync(path.join(home, ".gov", orgSlug.toLowerCase(), "login"), "utf8").trim();
    return t || null;
  } catch { return null; }
}

/** Remember the login for the next run's log path. Best effort: a failed write costs nothing. */
export function cacheLogin(orgSlug: string, login: string, home: string = os.homedir()): void {
  try {
    const dir = path.join(home, ".gov", orgSlug.toLowerCase());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "login"), `${login}\n`);
  } catch { /* the next run will ask again */ }
}

/** Delete run folders older than `keepDays`. Best effort, and only whole day folders gov itself names. */
export function pruneLogs(root: string, today: Date, keepDays: number = KEEP_DAYS): void {
  try {
    for (const name of expiredDayFolders(fs.readdirSync(root), today, keepDays)) {
      fs.rmSync(path.join(root, name), { recursive: true, force: true });
    }
  } catch { /* nothing to prune, or nowhere to prune it */ }
}

/**
 * START the run. Called once, from `bin.ts`, before anything else — so a command that dies in its first line
 * still leaves a file saying what was asked.
 */
export function startRun(opts: {
  argv: readonly string[]; command: string; project?: string | null;
  workRoot?: string | null; login?: string | null; version?: string; now?: Date;
}): string {
  const now = opts.now ?? new Date();
  const id = newRunId();
  const dir = runDirFor(now, id, opts.project ?? null, opts.command, opts.workRoot ?? null, opts.login ?? null);
  run = { id, dir, started: Date.now(), logger: null };
  startedArgv = opts.argv;
  log("info", "run started", "gov-work:cli:bin", "start", {
    run: id, argv: redactArgv(opts.argv), command: opts.command, project: opts.project ?? null,
    cwd: process.cwd(), version: opts.version, pid: process.pid, tty: !!process.stdin.isTTY, node: process.version,
  });
  return id;
}

/** END the run: the exit code and how long it took, then flush. Safe to call when no run was started. */
export function endRun(exitCode: number): void {
  if (run) log("info", "run finished", "gov-work:cli:bin", "end", { run: run.id, exitCode, ms: Date.now() - run.started });
  closeLog();
}

/** This run's id, or null before {@link startRun}. Quoted in failure messages and typed into `gov log`. */
export const runId = (): string | null => run?.id ?? null;

/** This run's folder — what gov prints when something fails. Empty string when nothing could be written. */
export const runDir = (): string => run?.dir ?? "";

/**
 * THE GATE (PRJ-121, 2026-09-23).
 *
 * The shared logger passes `error` and `warn` always; below them its default gate is `node:util.debuglog`
 * (`NODE_DEBUG=gov-work:*`, POL-425). gov CANNOT switch that on for itself — Node compiles NODE_DEBUG into a
 * matcher at bootstrap, so setting the variable from inside the process, even on the first line, does nothing.
 * The result: gov's log calls had never written a single line, and a log folder held only the transport's
 * bookkeeping file. Found 2026-09-22, the day after four defects were diagnosed from pasted screens.
 *
 * So the library gained `gate: "level"` (svm-util-log 1.1.0): each transport's own LOGLEVEL is the threshold,
 * which is what "record `info` and above on every run" means. Older versions ignore the field — with one of
 * those installed, gov logs `warn` and `error` only, unless the person sets NODE_DEBUG themselves.
 */
function logger(): Logger | null {
  if (!run) return null;
  if (run.logger) return run.logger;
  try {
    fs.mkdirSync(run.dir, { recursive: true });
    run.logger = createApplicationLogger({
      appId: APP_ID,
      logDir: run.dir,
      // `info` and above on every run (2026-09-23); `debug` only when asked, because it is verbose enough to
      // bury the line that matters.
      gate: "level",
      methods: [{ METHOD: "file", LOGLEVEL: process.env.GOV_DEBUG ? LogLevel.debug : LogLevel.info }],
    });
  } catch {
    run.logger = null;
    run = { ...run, dir: "", logger: null };
  }
  return run.logger;
}

/**
 * One line. `pgm`/`fn` are the code path (`gov-work:cli:work-flow`, `runWorkFlow`), `meta` the facts — never a
 * secret, and `argv` inside it is redacted for you.
 */
export function log(level: "error" | "warn" | "info" | "debug", msg: string, pgm: string, fn: string, meta?: unknown): void {
  try {
    logger()?.log(level, msg, pgm, fn, 0, withRun(meta));
  } catch {
    /* a lost line, never a lost command */
  }
}

/** The run id travels on every line, so a folder copied out of context still says which run it was. */
function withRun(meta: unknown): unknown {
  if (meta === undefined) return run ? { run: run.id } : undefined;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) return { run: run?.id, ...(meta as object) };
  return { run: run?.id, value: meta };
}

/** Flush before a short-lived process exits, or the last lines — the interesting ones — are lost. */
export function closeLog(): void {
  try { run?.logger?.close(); } catch { /* closing a closed logger is not news */ }
}

/** What `bin.ts` started this run with, for the handful of callers that report it. */
export const startedWith = (): readonly string[] => startedArgv;
