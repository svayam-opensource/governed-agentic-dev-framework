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
 * agent's context, and there is no code path here that returns one.
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
): readonly CredentialWrite[] {
  return [
    { path: agentConfigPath, contents: `${key}\n`, mode: 0o600 },
    {
      path: `${preferencesDir}/credentials`,
      // Named and dated, because a bare key in a file tells whoever finds it nothing
      // about what it opens or whether it is still current.
      contents: `# ${agentId} — saved by gov as a backup. The agent's own config is what it reads.\n${agentId.toUpperCase().replace(/-/g, "_")}_KEY=${key}\n`,
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
    `    and to       ${preferencesDir}/credentials   — your own backup`,
    "",
    "  Both are 0600, outside any repository, and never committed. gov keeps no other",
    "  copy, does not log it, and never puts it in an agent's context.",
    "",
  ];
}
