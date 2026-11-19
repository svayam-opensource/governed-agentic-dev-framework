// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE SET-UP BREADCRUMB'S I/O (#391) — the file, the machine probes, and the one network call. The decisions are in
 * setup/setup-state.ts, which is pure; this file is plumbing and must never take a run down: every entry point
 * catches, logs, and carries on, because a breadcrumb that cannot be written is a missing nicety, not a failure.
 *
 * WHERE: `~/.gov/setup-state.json`, beside the registry (`~/.gov/workspaces`, `~/.gov/active`) — the same home-
 * relative folder on every platform (R10), and so the same `HOME` override every test world already sets.
 * MODE 0600: until it is redeemed the file holds a one-time code.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { log } from "../log.js";
import { tryRun } from "../run-process.js";
import { govRegistryDir } from "../resolve/node-env.js";
import { createNodeRegistryStore } from "../resolve/registry-store.js";
import { loadOrgConfigText } from "../config/work-root.js";
import {
  captureSetupCode, emptySetupState, parseSetupState, reconcile, redeemSetupCode, serializeSetupState, settled, stepStatus,
  type FetchLike, type SetupState, type SetupStepId,
} from "../setup/setup-state.js";

const PGM = "gov-work:cli:setup-progress";

export const setupStateFile = (home: string = os.homedir()): string => path.join(govRegistryDir(home), "setup-state.json");

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

export function loadSetupState(home: string = os.homedir()): SetupState {
  try { return parseSetupState(fs.readFileSync(setupStateFile(home), "utf8")); }
  catch { return emptySetupState(); /* no file yet: nothing has been recorded */ }
}

/** Write atomically, owner-only. Returns false (logged) when it cannot — the run goes on either way. */
export function saveSetupState(state: SetupState, home: string = os.homedir()): boolean {
  const file = setupStateFile(home);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, serializeSetupState(state), { encoding: "utf8", mode: 0o600 });
    // `mode` applies only when the file is CREATED, and umask can narrow it further but never widen it — chmod makes
    // an existing temp (a crashed earlier run with the same pid) owner-only too. No-op on Windows, which has no modes.
    try { fs.chmodSync(tmp, 0o600); } catch { /* Windows: the profile folder is already the person's own */ }
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    log("warn", "could not write the set-up breadcrumb", PGM, "saveSetupState", { file, error: (e as Error).message });
    return false;
  }
}

/** The active governance home and its work root, or null when no organization is in place on this machine. */
function governanceHome(home: string): { readonly gov: string; readonly workRoot: string } | null {
  const store = createNodeRegistryStore({ home });
  const homes = store.readHomes();
  const active = store.readActiveOrg();
  const entry = homes.find((h) => h.org === active) ?? (homes.length === 1 ? homes[0] : undefined);
  if (!entry) return null;
  let text: string;
  try { text = fs.readFileSync(path.join(entry.home, "org-config.yaml"), "utf8"); }
  catch { return null; /* registered but not there: the governance repository is not in place */ }
  return { gov: entry.home, workRoot: loadOrgConfigText(text, home).agentWorkRoot };
}

/** What the machine shows, step by step. Cheap probes only: two `--version` calls and a few file reads. */
export type MachineProbe = Partial<Record<Exclude<SetupStepId, "setup-signal">, boolean>>;

const onPath = (cmd: string): boolean => tryRun(cmd, ["--version"], { pgm: PGM }) !== undefined;

export function probeMachine(home: string = os.homedir(), has: (cmd: string) => boolean = onPath): MachineProbe {
  const prerequisites = has("git") && has("gh");
  const gov = governanceHome(home);
  const workRootReady = !!gov && !!gov.workRoot && fs.existsSync(gov.workRoot);
  return {
    "client-installed": true,              // this code is running: the client is installed
    prerequisites,
    "governance-repo": gov !== null,
    "machine-env": gov !== null && prerequisites && workRootReady,
  };
}

/**
 * The (d) step's own repair: the workspace folder structure. The work root is where every project folder goes; on a
 * new machine nothing has made it yet, and it is the one part of "environment ready" gov can do without asking.
 */
export function ensureWorkRoot(home: string = os.homedir()): void {
  const gov = governanceHome(home);
  if (!gov?.workRoot) return;
  try { fs.mkdirSync(gov.workRoot, { recursive: true }); }
  catch (e) { log("warn", "could not create the work root", PGM, "ensureWorkRoot", { error: (e as Error).message }); }
}

/**
 * Write the trail only where there is one to keep: the file already exists, a code is waiting, or the caller is a
 * set-up step itself (`create`). A command that merely RAN — a refused `gov setup --join`, a `doctor` on a CI runner —
 * must leave nothing behind in `~/.gov` (smoke 35-setup-join holds gov to that).
 */
function keep(s: SetupState, home: string, create: boolean): void {
  if (create || s.setupCode || fs.existsSync(setupStateFile(home))) saveSetupState(s, home);
}

/**
 * EVERY RUN: take a set-up code from the environment (the installer hands it over this way), and — while the trail
 * is unfinished — bring it up to what the machine shows. A settled trail costs one file read. Returns the trail as it
 * was before this run and as it is now, so the caller can say "resuming".
 */
export function noteSetup(
  env: Readonly<Record<string, string | undefined>> = process.env,
  opts: { readonly now?: string; readonly home?: string; readonly has?: (cmd: string) => boolean; readonly create?: boolean } = {},
): { readonly before: SetupState; readonly after: SetupState } {
  const home = opts.home ?? os.homedir();
  const now = opts.now ?? new Date().toISOString();
  try {
    const before = loadSetupState(home);
    let s = captureSetupCode(before, env, now, sha256);
    if (!settled(s)) s = reconcile(s, probeMachine(home, opts.has), now);
    if (serializeSetupState(s) !== serializeSetupState(before)) keep(s, home, opts.create === true);
    return { before, after: s };
  } catch (e) {
    log("warn", "could not note set-up progress", PGM, "noteSetup", { error: (e as Error).message });
    return { before: emptySetupState(), after: emptySetupState() };
  }
}

/**
 * AFTER THE FIRST-RUN STEPS: finish (d) if (b) is in place, re-detect, and send the code when (a), (b) and (d) are
 * done. Prints at most one line. Never throws; a failure here never changes the run's exit code.
 */
export async function advanceSetup(opts: {
  readonly print: (line: string) => void;
  readonly clientVersion: string;
  readonly fetch?: FetchLike;
  readonly now?: string;
  readonly home?: string;
  /** Is a command on PATH? Injected by tests; the real probe runs `<cmd> --version`. */
  readonly has?: (cmd: string) => boolean;
  /** Start a trail if there is none — a set-up step calls this; an ordinary command only keeps an existing one. */
  readonly create?: boolean;
}): Promise<SetupState | null> {
  const home = opts.home ?? os.homedir();
  const now = opts.now ?? new Date().toISOString();
  const probe = (): MachineProbe => probeMachine(home, opts.has);
  try {
    const loaded = loadSetupState(home);
    if (settled(loaded)) return loaded;
    let s = loaded;
    if (stepStatus(s, "governance-repo") !== "done" || stepStatus(s, "machine-env") !== "done") {
      s = reconcile(s, probe(), now);
      if (stepStatus(s, "governance-repo") === "done" && stepStatus(s, "machine-env") !== "done") {
        ensureWorkRoot(home);
        s = reconcile(s, probe(), now);
      }
    }
    const r = await redeemSetupCode(s, {
      fetch: opts.fetch ?? (globalThis.fetch as unknown as FetchLike),
      clientVersion: opts.clientVersion,
      now,
      sha256,
    });
    if (r.outcome !== "no-code" && r.outcome !== "not-ready") log("info", "set-up code", PGM, "advanceSetup", { outcome: r.outcome });
    if (serializeSetupState(r.state) !== serializeSetupState(loaded)) keep(r.state, home, opts.create === true);
    if (r.line) opts.print(r.line);
    return r.state;
  } catch (e) {
    log("warn", "could not advance set-up", PGM, "advanceSetup", { error: (e as Error).message });
    return null;
  }
}
