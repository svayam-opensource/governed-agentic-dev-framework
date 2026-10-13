// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * EVERY EXTERNAL PROCESS GOES THROUGH HERE, and is logged (PRJ-121, 2026-09-23).
 *
 * gov's work is mostly other programs: `git`, `gh`, `npm`, an agent. When one of them is slow, or answers
 * something surprising, that is the fact a diagnosis needs — and until now none of it was written down. The
 * walks of 2026-09-22 are the argument: `gh project list` failed with a bare `EOF` after 11 seconds, and the
 * only record was a person's screen.
 *
 * COVERAGE BY CONSTRUCTION, not by remembering. `src/cli`, `src/lifecycle` and `src/maintain` are forbidden by
 * lint from importing `node:child_process` directly, so a new call site cannot be added without coming through
 * here and being logged. The exceptions are this file and the two places that hand the TERMINAL over — an
 * interactive agent and a paged view — which need `stdio: "inherit"` and are logged by their own callers.
 *
 * WHAT IS LOGGED: the command, its arguments with secret values redacted, the working directory, how
 * long it took, the exit code, and the last lines of stderr when it failed. Never stdout: it is the answer, it
 * can be large, and it is often the thing that must not be written down (a token, a key, a private file).
 */
import { execFileSync, spawnSync, type SpawnSyncOptions } from "node:child_process";
import { statSync } from "node:fs";
import { log } from "./log.js";
import { redactArgv, redactText } from "./state-paths.js";
import { spawnPlan, type SpawnPlan } from "./win-spawn.js";

/**
 * WHAT IS ACTUALLY SPAWNED (#223). Off Windows: the command itself. On Windows: resolved through PATH × PATHEXT,
 * a `.cmd`/`.bat` run through cmd.exe with its arguments escaped — see `win-spawn.ts`. Throws a
 * `CommandNotFoundError` (code ENOENT) naming the PATH searched when nothing is found. Exported for the two
 * call sites that hand the terminal over (`main.ts` agent launch) and so spawn for themselves.
 */
export function plan(cmd: string, args: readonly string[], env?: NodeJS.ProcessEnv): SpawnPlan {
  return spawnPlan(cmd, args, {
    platform: process.platform,
    env: env ?? process.env,
    isFile: (p) => { try { return statSync(p).isFile(); } catch { return false; } },
  });
}

/**
 * The tail of a failed process's stderr — enough to recognise the failure, short enough to keep a log readable.
 *
 * REDACTED FIRST (2026-09-30). This wrote whatever the process printed, verbatim, at `warn`, for every
 * `git`, `gh`, `npm` and vendor installer gov runs — and `git` and `gh` echo the remote URL in an error, carrying
 * the token they were handed. The file's header claimed "arguments with secret values redacted" and said nothing
 * about output, so the one unredacted channel was the one nobody had thought about.
 */
const tail = (s: string | undefined, lines = 3): string | undefined =>
  s ? redactText(s.split(/\r?\n/).filter(Boolean).slice(-lines).join(" · ")).slice(0, 500) : undefined;

export interface RunOptions {
  readonly cwd?: string;
  /** Where the code path is, for the log line (`gov-work:lifecycle:vcs`). */
  readonly pgm?: string;
  readonly fn?: string;
  /** Extra facts worth having beside the command (which unit, which ref). Never a secret. */
  readonly meta?: Record<string, unknown>;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  readonly input?: string;
}

/**
 * Run a process and return its stdout, or throw as `execFileSync` does. Logged either way: `info` when it
 * worked, `warn` when it did not — a failure gov handles is still the fact that explains the next surprise.
 */
export function run(cmd: string, args: readonly string[], opts: RunOptions = {}): string {
  const started = Date.now();
  try {
    const p = plan(cmd, args, opts.env);
    const out = execFileSync(p.file, p.args as string[], {
      encoding: "utf8",
      ...(p.verbatim ? { windowsVerbatimArguments: true } : {}),
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      ...(opts.env ? { env: opts.env } : {}),
      ...(opts.timeoutMs ? { timeout: opts.timeoutMs } : {}),
      ...(opts.input !== undefined ? { input: opts.input } : {}),
      // STDIN IS A PIPE ONLY WHEN THERE IS INPUT (2026-10-06). With `ignore` here, Node drops `input` without a
      // word — the process reads an empty stdin — so every caller that streamed a value (`gh api --input -`, a
      // secret for `gh secret set`) silently sent nothing. Input is never logged: it is often the secret.
      stdio: [opts.input !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
    });
    logRun("info", cmd, args, opts, Date.now() - started, 0, undefined);
    return out;
  } catch (e) {
    const err = e as { status?: number; stderr?: string | Buffer; message?: string };
    logRun("warn", cmd, args, opts, Date.now() - started, err?.status ?? 1, tail(err?.stderr?.toString() ?? err?.message));
    throw e;
  }
}

/**
 * `run`, but stdout comes back as the exact BYTES the process wrote — for a download whose digest is checked
 * (vendor-script.ts). Decoding to a string and back could change bytes that are not valid UTF-8.
 */
export function runBytes(cmd: string, args: readonly string[], opts: RunOptions = {}): Uint8Array {
  const started = Date.now();
  try {
    const p = plan(cmd, args, opts.env);
    const out = execFileSync(p.file, p.args as string[], {
      ...(p.verbatim ? { windowsVerbatimArguments: true } : {}),
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      ...(opts.env ? { env: opts.env } : {}),
      ...(opts.timeoutMs ? { timeout: opts.timeoutMs } : {}),
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    logRun("info", cmd, args, opts, Date.now() - started, 0, undefined);
    return new Uint8Array(out);
  } catch (e) {
    const err = e as { status?: number; stderr?: string | Buffer; message?: string };
    logRun("warn", cmd, args, opts, Date.now() - started, err?.status ?? 1, tail(err?.stderr?.toString() ?? err?.message));
    throw e;
  }
}

/** Run a process, returning its trimmed stdout, or `undefined` when it fails. The commonest shape in gov. */
export function tryRun(cmd: string, args: readonly string[], opts: RunOptions = {}): string | undefined {
  try { return run(cmd, args, opts).trim(); } catch { return undefined; }
}

/**
 * Run a process and hand back its RESULT — status, stdout, stderr — without throwing. The shape the `Vcs` port
 * speaks: every lifecycle command wants to decide what a non-zero git status means, not catch an exception.
 */
export function runResult(cmd: string, args: readonly string[], opts: RunOptions = {}): { status: number; stdout: string; stderr: string } {
  try {
    return { status: 0, stdout: run(cmd, args, opts), stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer };
    return { status: err?.status ?? 1, stdout: err?.stdout?.toString() ?? "", stderr: err?.stderr?.toString() ?? "" };
  }
}

/**
 * Run a process to completion and say exactly how it ended — never a throw. For a caller that must tell apart an
 * exit code, a TIMEOUT and a command that is not installed (an org check action: 1 is a miss, a timeout or a missing
 * `python3` is "could not tell"), which {@link runResult} folds together. The env given is the WHOLE env: nothing
 * of gov's own is inherited, so a caller that allow-lists gets exactly the list.
 */
export function runCapture(cmd: string, args: readonly string[], opts: RunOptions = {}): {
  status: number | null; stdout: string; stderr: string; timedOut: boolean; notFound: boolean; error?: string;
} {
  const started = Date.now();
  const r = spawnSync(cmd, args as string[], {
    encoding: "utf8",
    stdio: [opts.input !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    ...(opts.env ? { env: opts.env } : {}),
    ...(opts.timeoutMs ? { timeout: opts.timeoutMs, killSignal: "SIGKILL" as const } : {}),
    ...(opts.input !== undefined ? { input: opts.input } : {}),
    maxBuffer: 16 * 1024 * 1024,
  });
  const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
  const timedOut = code === "ETIMEDOUT" || (r.status === null && r.signal !== null && !!opts.timeoutMs && Date.now() - started >= opts.timeoutMs);
  const notFound = code === "ENOENT";
  const status = r.status;
  logRun(status === 0 ? "info" : "warn", cmd, args, { ...opts, meta: { ...(opts.meta ?? {}), ...(timedOut ? { timedOut } : {}), ...(notFound ? { notFound } : {}) } },
    Date.now() - started, status ?? 1, tail(r.stderr ?? r.error?.message));
  return {
    status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", timedOut, notFound,
    ...(r.error && !timedOut && !notFound ? { error: r.error.message } : {}),
  };
}

/** Did it succeed? For the many checks that care only about the exit code. */
export function ok(cmd: string, args: readonly string[], opts: RunOptions = {}): boolean {
  try { run(cmd, args, opts); return true; } catch { return false; }
}

/**
 * Hand the TERMINAL to another program (an agent, an interactive `gh auth login`) and wait for it. stdout and
 * stderr belong to that program, so nothing is captured — the log records that it ran, and what it returned.
 */
export function runInteractive(cmd: string, args: readonly string[], opts: RunOptions & { spawn?: SpawnSyncOptions } = {}): number {
  const started = Date.now();
  let p: SpawnPlan;
  try {
    p = plan(cmd, args, opts.env);
  } catch (e) {
    // NAMED, NOT ENOENT (#223): the person sees which command, and where gov looked for it.
    process.stderr.write(`${(e as Error).message}\n`);
    logRun("warn", cmd, args, { ...opts, meta: { ...(opts.meta ?? {}), interactive: true } }, Date.now() - started, 127, (e as Error).message);
    return 127;
  }
  const r = spawnSync(p.file, p.args as string[], {
    stdio: "inherit", ...(opts.cwd ? { cwd: opts.cwd } : {}), ...(opts.env ? { env: opts.env } : {}),
    ...(p.verbatim ? { windowsVerbatimArguments: true } : {}), ...(opts.spawn ?? {}),
  });
  const code = r.status ?? (r.error ? 1 : 0);
  logRun(code === 0 ? "info" : "warn", cmd, args, { ...opts, meta: { ...(opts.meta ?? {}), interactive: true } }, Date.now() - started, code, r.error?.message);
  return code;
}

function logRun(
  level: "info" | "warn", cmd: string, args: readonly string[], opts: RunOptions, ms: number, exitCode: number, why?: string,
): void {
  log(level, exitCode === 0 ? "ran" : "ran (failed)", opts.pgm ?? "gov-work:run-process", opts.fn ?? cmd, {
    cmd, args: redactArgv(args), ...(opts.cwd ? { cwd: opts.cwd } : {}), ms, exitCode,
    ...(why ? { stderr: why } : {}), ...(opts.meta ?? {}),
  });
}
