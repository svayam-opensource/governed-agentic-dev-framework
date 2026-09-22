// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The tier-2 key: written twice, read back never (#196, Q6).
 *
 * Most agents have their own login command, and gov hands them the terminal and
 * never sees a secret. A few are API-key only, and for those gov opens the console,
 * waits, reads the key with the echo off, and writes it:
 *
 *   1. where the AGENT expects it            — so the tool works
 *   2. ~/.gov/<slug>/projects/preferences/<gh_user>/credentials
 *                                            — so the person can recover it
 *
 * The second copy is the owner's decision, and it is defensible: that path is
 * outside every repository (`agent_work_root` is never committed, POL-128), so
 * POL-143/144 still holds. But two copies of a secret drift, and a stale one is
 * discovered during an outage. So:
 *
 *   the agent's config is the TRUTH
 *   the preferences copy is a BACKUP — written once, never read back
 *   `gov agent` COMPARES them and reports a difference, printing neither
 *
 * Comparison is by digest. gov never puts a key on screen, in a log, or in an
 * agent's context.
 *
 * ── SUPERSEDED IN PART, Policy Owner, 2026-09-22 ─────────────────────────────────────────────────────────────
 *
 * "Any credentials, including agent API keys, should be stored/loaded in/from the designated user preferences
 * folder/file." The preferences credentials file is now THE STORE, and gov LOADS from it.
 *
 * Why the old rule could not stand: "never read back" guarded against TWO copies drifting. For an agent that
 * only reads an environment variable — every catalogued agent; `credentialFile` is set on none — gov can write
 * no first copy, so the backup was the ONLY copy, and nothing read it. On a walk, a key pasted once was gone the
 * moment gov exited: every later session started without it, and a headless machine was sent to a browser
 * sign-in that cannot complete there.
 *
 * What still holds: never on screen, never in a log (presence only, POL-427), never in an agent's context; the
 * file is 0600 and gov will not load one that others can read. `storedCredential` is the one code path that
 * returns a key, and it returns it only to be placed in the environment of a process gov starts.
 */
import { createHash } from "node:crypto";

/** A short, stable fingerprint. Enough to compare, useless to steal. */
export function fingerprint(secret: string): string {
  return createHash("sha256").update(secret.trim()).digest("hex").slice(0, 12);
}

/** Do two copies of a key match? Neither is returned, logged, or shown. */
export function keysAgree(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return true;         // nothing to disagree about yet
  return fingerprint(a) === fingerprint(b);
}

export interface CredentialWrite {
  readonly path: string;
  readonly contents: string;
  readonly mode: number;
}

/**
 * The two writes, planned. `0600` on the file and `0700` on its directory: a key
 * readable by every process on a shared machine is a key that has already leaked.
 */
export function planCredentialWrites(
  agentId: string,
  key: string,
  agentConfigPath: string,
  preferencesDir: string,
  /** The variable the AGENT reads (catalog `credentialEnv`). Absent → the old id-derived name. */
  envVar?: string,
  /** What the backup file holds already, so a second agent's key does not erase the first's. */
  existingBackup?: string | null,
): readonly CredentialWrite[] {
  // THE BACKUP NAMES THE VARIABLE THE AGENT READS (PRJ-121, 2026-09-22). It used to be derived from the
  // agent's id — `ibm-bob` → `IBM_BOB_KEY` — while Bob reads `BOB_API_KEY`. The backup exists "so the person
  // can recover it", and recovering means sourcing it; under the derived name that set a variable nothing reads.
  const name = envVar ?? `${agentId.toUpperCase().replace(/-/g, "_")}_KEY`;
  const legacy = `${agentId.toUpperCase().replace(/-/g, "_")}_KEY`;
  // ONE FILE PER PERSON, SO MERGE (PRJ-121, 2026-09-22). This was a plain overwrite: storing a second agent's
  // key erased the first's. Keep every other line; replace only this agent's — under its real name, or the
  // legacy name an older gov wrote — and its comment.
  const kept = (existingBackup ?? "").split("\n").filter((l) =>
    l.trim() !== "" &&
    !l.startsWith(`${name}=`) && !l.startsWith(`${legacy}=`) &&
    !l.startsWith(`# ${agentId} — saved by gov`));
  return [
    { path: agentConfigPath, contents: `${key}\n`, mode: 0o600 },
    {
      path: `${preferencesDir}/credentials`,
      // Named and dated, because a bare key in a file tells whoever finds it nothing
      // about what it opens or whether it is still current.
      contents: [...kept, `# ${agentId} — saved by gov; gov loads it into the sessions it starts.`, `${name}=${key}`, ""].join("\n"),
      mode: 0o600,
    },
  ];
}

/** What to say while doing it, since a key is being handled and that deserves saying. */
export function credentialNotice(agentId: string, agentConfigPath: string, preferencesDir: string): readonly string[] {
  return [
    "",
    `  ${agentId} signs in with an API key rather than a browser, so gov has to handle it.`,
    "",
    `    it goes to   ${agentConfigPath}          — where the agent reads it`,
    `    and to       ${preferencesDir}/credentials   — gov's store, loaded into the sessions it starts`,
    "",
    "  Both are 0600, outside any repository, and never committed. gov keeps no other",
    "  copy, does not log it, and never puts it in an agent's context.",
    "",
  ];
}


/** The store: `<agent_work_root>/preferences/<gh_user>/credentials` — beside the person's preferences file. */
export function credentialsPathFor(agentWorkRoot: string, login: string): string {
  return `${agentWorkRoot.replace(/\/+$/, "")}/preferences/${login}/credentials`;
}

/**
 * The stored value of `envVar`, or null. Also accepts the id-derived name an older gov wrote (`IBM_BOB_KEY`), so
 * a key stored before 2026-09-22 still loads rather than being asked for again.
 */
export function storedCredential(fileText: string | null, envVar: string, agentId: string): string | null {
  if (!fileText) return null;
  const legacy = `${agentId.toUpperCase().replace(/-/g, "_")}_KEY`;
  for (const name of [envVar, legacy]) {
    const line = fileText.split("\n").find((l) => l.startsWith(`${name}=`));
    const v = line?.slice(name.length + 1).trim();
    if (v) return v;
  }
  return null;
}

/** May gov load this store? Only if no one else can read it. Windows has no such mode bits to check. */
export function storeIsPrivate(mode: number, platform: string): boolean {
  return platform === "win32" || (mode & 0o077) === 0;
}
