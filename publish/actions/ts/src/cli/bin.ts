#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
// The `gov` executable entry (Node/TS) — the project and workspace CLI of the Governed Agentic
// Development Framework. It manages projects, workspaces and org registration, and shows the context
// banner. It hosts NOTHING: `gov-cicd` (deploy) and `gov-infra` (infrastructure) are independent clients
// invoked directly, not verbs of this one (adr-three-clients, PRJ-43).
import { main, runSetupCommand, runWork, runAgentInstall, runMainMenu, runFirstRunIfNeeded, readCliVersion, helpLines, isKnownCommand } from "./main.js";
import { confirmContextOrBail } from "./context-gate.js";
import { helpRequest } from "./help-request.js";
import { helpJson, topicOf } from "./help-render.js";

/** A concept page (gov help projects) is as valid an answer as a command page. */
const isTopic = (name: string): boolean => topicOf(name) !== undefined;
import { runContext } from "./run-context.js";
import { endRun, log, pruneLogs, runDir, startRun } from "../log.js";
import { commandOf, logsRoot } from "../state-paths.js";
import { numberPref } from "../preferences.js";
import { loadPreferences } from "./preferences-io.js";

const argv = process.argv.slice(2);

async function dispatch(): Promise<number> {
  // Meta flags — no workspace/plugin/context needed (an adopter's first commands).
  if (argv[0] === "--version" || argv[0] === "-v") { process.stdout.write(`gov ${readCliVersion()}\n`); return 0; }
  // HELP NEVER ACTS (PRJ-121, 2026-09-22) — `gov help [<cmd>]`, and `--help`/`-h` ANYWHERE before a `--`.
  // Answered here, before first-run, the banner and resolution: help needs no workspace and runs nothing.
  // `gov merge -h` used to attempt a merge. An unknown command asked about is a usage error (exit 2).
  const help = helpRequest(argv);
  if (help) {
    if (help.json) { process.stdout.write(`${helpJson()}\n`); return 0; }
    const known = !help.command || isKnownCommand(help.command) || isTopic(help.command);
    const lines = helpLines(help.command, { ...(help.short ? { short: true } : {}), ...(help.all ? { all: true } : {}) });
    for (const l of lines) (known ? process.stdout : process.stderr).write(`${l}\n`);
    return known ? 0 : 2;
  }

  // FIRST RUN — before the banner, which would otherwise announce "no gov workspace resolved" and hand the
  // work back with two verbs to learn.
  //
  // Only with a TERMINAL. First run is a human act (Policy Owner, 2026-08-07), and gating it here rather
  // than letting it report "blocked" keeps a bare non-TTY machine behaving exactly as it does today: the
  // commands that genuinely need no workspace (`bump-version`, `doctor --home`, `validate`) still run, and
  // the ones that do need one still fail with their own message. `gov work` prints the blocked message on
  // its own path, so nothing is lost.
  //
  // `setup` and `org` are exempt: they are how you fix the registry by hand, and intercepting them would
  // make the manual path unreachable.
  //
  // The DIAGNOSTICS are exempt for a sharper reason (#186). `gov doctor` runs pre-resolve precisely so it
  // can report on a machine that has no workspace — that is its job, not an error condition. Intercepting
  // it meant a brand-new adopter, following the documented second step, was asked to paste a governance
  // repo clone URL before being told anything. They do not have one; that is what they were trying to
  // find out. A command whose whole purpose is to answer "what state am I in?" must never be replaced by
  // a question that presumes the answer.
  const NO_FIRST_RUN = new Set(["setup", "org", "doctor", "deps", "validate", "help", "--help", "-h", "--version", "-v"]);
  if (process.stdin.isTTY && !NO_FIRST_RUN.has(argv[0] ?? "")) {
    const first = await runFirstRunIfNeeded();
    if (first !== null) return first;   // null = already set up; anything else is this invocation's answer
  }

  // context banner + prompt-on-context-change (bail = 0), then dispatch.
  if (!(await confirmContextOrBail(argv))) return 0;
  if (argv.length === 0 && process.stdin.isTTY) return runMainMenu();
  if (argv[0] === "setup") return runSetupCommand(argv);
  if (argv[0] === "work") return runWork(argv);   // prompts + launches — see runWork
  // `agent install` ASKS and SPAWNS, so it belongs here for the same reason `work` does —
  // dispatch.ts says it plainly: "neither prompting nor spawning belongs in a pure router".
  // It also needs a reader of its own, and having exactly one owner is the whole of #213.
  if (argv[0] === "agent" && argv[1] === "install") return runAgentInstall(argv);
  return main(argv);
}

/**
 * EVERY RUN LEAVES A FILE (PRJ-121, 2026-09-23) — started before dispatch, so a command that dies in its first
 * line still says what was asked; ended with the exit code, so a log answers "did it work?" without the screen.
 * The whole of it is best-effort: logging never changes what gov returns, and never takes it down.
 */
async function runCli(): Promise<number> {
  const ctx = runContext();
  try {
    startRun({ argv, command: commandOf(argv), project: ctx.project, workRoot: ctx.workRoot, login: ctx.login, version: readCliVersion() });
    // Retention runs here, once per invocation, where it costs one readdir and can never race a write: the
    // folders it removes are whole days, and this run's day is not one of them.
    if (ctx.workRoot && ctx.login) {
      // `logs.keepDays` is the person's (default 14). Read from the file gov already has open for them.
      pruneLogs(logsRoot(ctx.workRoot, ctx.login), new Date(), numberPref(loadPreferences().prefs, "logs.keepDays"));
    }
  } catch { /* a run with no log is still a run */ }

  try {
    const code = await dispatch();
    endRun(code);
    return code;
  } catch (e) {
    // The stack goes to the LOG as well as the screen: a stack in a scrollback is gone by the time it is asked
    // about, and this is the case where the run's own file is most worth naming.
    try { logFatal(e); } catch { /* … */ }
    process.stderr.write(`${(e as Error)?.stack ?? e}\n`);
    const where = runDir();
    if (where) process.stderr.write(`  details: ${where}\n`);
    endRun(1);
    return 1;
  }
}

function logFatal(e: unknown): void {
  const err = e as Error | undefined;
  log("error", "unhandled failure", "gov-work:cli:bin", "runCli", { message: err?.message ?? String(e), stack: err?.stack });
}

// EXIT BY EXIT CODE, NOT `process.exit` (PRJ-121, 2026-09-23). `process.exit` kills the process where it
// stands, and the log transport's last write goes with it: the first run under this logger left a folder with
// the bookkeeping file and no log. Setting `exitCode` lets Node finish the flush and leave with the same code.
// A hung handle would show up as a command that does not return, which the journey tier would catch at once.
runCli().then((code) => { process.exitCode = code; });
