// SPDX-License-Identifier: LicenseRef-Svayam-Proprietary
/**
 * Per-user store for the `gov auth login` session (the svayam_jwt + refresh). Lives beside the
 * credential store, keyed by identity, 0600 — so gov-cicd reads the same token to open its
 * Vault session (the `exchange()` seam). Short-lived; re-run `gov auth login` when it expires.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Tokens } from "./oidc.js";

/** `<agent_work_root>/preferences/<identity>/gov-auth.json` (mirrors the credentials path). */
export function authPath(agentWorkRoot: string, identity: string): string {
  const root = agentWorkRoot.replace(/^~(?=$|\/)/, os.homedir());
  return path.join(root, "preferences", identity, "gov-auth.json");
}

export function saveAuth(file: string, tokens: Tokens): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export function loadAuth(file: string): Tokens | null {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as Tokens; } catch { return null; }
}

export function clearAuth(file: string): void {
  try { fs.unlinkSync(file); } catch { /* already gone */ }
}
