// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WHERE gov's OWN STATE LIVES, and how a RUN is named (PRJ-121, 2026-09-23).
 *
 * Decided with the Policy Owner: a person's things live in one folder, keyed by the identity the client
 * operates with — gov by the GitHub login, gov-cicd and gov-infra by the IAM identity. gov's folder holds what
 * the person owns (`*.md`, `preferences.json`, `credentials`) and, under `state/`, what gov writes for itself:
 *
 *   state/ack/    one file per CONFIRMED CONTEXT   — keyed by WHAT was confirmed, shared across terminals
 *   state/cache/  one file per CACHED THING        — keyed by WHAT was fetched
 *   state/logs/<day>/<run>/  ONE LOG PER RUN       — keyed by the RUN, because only a log belongs to one
 *
 * The rule: persistent state is keyed by what it is ABOUT, never by which run wrote it; logs are the exception.
 * gov is run from many terminals, on many projects, at once — so a shared daily log meant every investigation
 * began by untangling interleaved runs, and "send me the log" meant sending a slice of other people's work.
 *
 * Everything here is PURE: no fs, no clock, no platform. The paths are the part worth testing, and testing them
 * should not need a disk (the same reason `resolve/node-env.ts` takes `platform` as a parameter).
 */

/** The `state/` folder inside a person's preferences folder. */
export function stateDir(workRoot: string, login: string): string {
  return `${personDir(workRoot, login)}/state`;
}

/** A person's folder: their `*.md` (for their agent), `preferences.json` (for gov), `credentials`, `state/`. */
export const personDir = (workRoot: string, login: string): string => `${workRoot.replace(/\/+$/, "")}/preferences/${login}`;

/** THE one place a person's gov settings live (Policy Owner, 2026-09-22). */
export const preferencesFile = (workRoot: string, login: string): string => `${personDir(workRoot, login)}/preferences.json`;

export const ackDir = (workRoot: string, login: string): string => `${stateDir(workRoot, login)}/ack`;
export const cacheDir = (workRoot: string, login: string): string => `${stateDir(workRoot, login)}/cache`;
export const logsRoot = (workRoot: string, login: string): string => `${stateDir(workRoot, login)}/logs`;

/** `YYYY-MM-DD` in LOCAL time: a person looking for "today's runs" means their today, not UTC's. */
export function dayFolder(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** A run id: short, random, and readable aloud — it is quoted in a failure message and typed into `gov log`. */
export function newRunId(rand: () => number = Math.random): string {
  return Array.from({ length: 4 }, () => "0123456789abcdef"[Math.floor(rand() * 16)]).join("");
}

/**
 * A run's folder name: `HHMMSS-<run>-<project>-<command>`, sortable by time within the day and readable at a
 * glance. `project` is `none` outside a project. Anything not [A-Za-z0-9._-] is replaced, because this becomes
 * a directory on three platforms.
 */
export function runFolder(now: Date, runId: string, project: string | null, command: string): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  const time = `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  const safe = (s: string): string => (s || "none").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "none";
  return `${time}-${runId}-${safe(project ?? "none")}-${safe(command)}`;
}

/**
 * Day folders to delete: older than `keepDays`, counted in days from `today`. Names that are not a day are left
 * alone — a folder gov did not create is not gov's to remove.
 */
export function expiredDayFolders(names: readonly string[], today: Date, keepDays: number): string[] {
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - keepDays).getTime();
  return names.filter((n) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(n);
    if (!m) return false;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() < cutoff;
  });
}

/**
 * The command a run is ABOUT, for the folder name: the first argument that is not a flag, else `menu` (gov with
 * no arguments opens the menu). `work --project=x` is a `work` run; `--help` is a `help` run.
 */
export function commandOf(argv: readonly string[]): string {
  const first = argv.find((a) => !a.startsWith("-"));
  if (first) return first;
  if (argv.some((a) => a === "--help" || a === "-h")) return "help";
  if (argv.some((a) => a === "--version" || a === "-v")) return "version";
  return argv.length ? "flags" : "menu";
}

/**
 * ARGUMENTS AS THEY MAY BE WRITTEN DOWN (POL-427). A token or key passed on the command line is a secret even
 * though it was typed in the clear: `--token abc` and `--token=abc` both become `--token ***`. The VALUE goes;
 * the flag stays, because which flags were passed is exactly what a diagnosis needs.
 */
const SECRET_FLAG = /^(--?)([A-Za-z0-9-]*(token|key|secret|password|pass|pat)[A-Za-z0-9-]*)$/i;
export function redactArgv(argv: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const eq = a.indexOf("=");
    if (eq > 0 && SECRET_FLAG.test(a.slice(0, eq))) { out.push(`${a.slice(0, eq)}=***`); continue; }
    out.push(a);
    if (SECRET_FLAG.test(a) && i + 1 < argv.length && !argv[i + 1]!.startsWith("-")) { out.push("***"); i++; }
  }
  return out;
}
