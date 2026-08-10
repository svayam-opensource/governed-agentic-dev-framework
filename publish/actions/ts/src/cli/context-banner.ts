// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Context banner + prompt-on-context-CHANGE (a bail-out checkpoint against a wrong context/settings).
 *
 * Every invocation SHOWS the resolved context + settings (and flags anomalies). It PROMPTS `Proceed? (y/N)`
 * only when the context FINGERPRINT differs from a recently-acknowledged one — i.e. exactly at the risk
 * moments (first use here, a different project, an edited org-config, a switched user/env) — so the prompt
 * stays meaningful instead of training a reflexive `y`. Non-TTY never blocks.
 *
 * PURE (no I/O).
 *
 * NOT shared code. gov-cicd renders a byte-identical banner from its OWN copy of this module, by
 * CONVENTION rather than by import — there is no shared package and there is not going to be one
 * (ADR: no shared client core, 2026-08-10). This header used to claim a shared engine; that claim was
 * false even when gov-core existed, and acting on it is how a reader concludes there is something to
 * import. The three render lines are held identical by the golden test below/alongside; everything
 * else in the two files may differ freely and does.
 */
import { createHash } from "node:crypto";

export type ContextMode = "project" | "governed" | "none";

export interface ContextInfo {
  readonly mode: ContextMode;
  readonly projectPath?: string;
  /** The org's agent_work_root (org-config) — the parent of both project dirs and `.bases`. NOT in the
   *  fingerprint (derived from org-config, which already fingerprints via orgConfigHash). */
  readonly agentWorkRoot?: string;
  readonly govRepo?: string;
  readonly orgConfigPath?: string;
  readonly orgConfigHash?: string;
  readonly user?: string;
  readonly branch?: string;
  readonly services: Readonly<Record<string, string | undefined>>;
  readonly anomalies: readonly string[];
}

/** The FINGERPRINT — the discriminating facts that define "am I in the right place with the right settings".
 *  A change in ANY of these re-prompts: mode · project · gov_repo · org-config PATH · org-config CONTENT ·
 *  user · target env · CLI MAJOR (a major upgrade re-confirms once). */
export function contextFingerprint(info: ContextInfo, targetEnv?: string, cliVersion?: string): string {
  const parts = [
    `mode=${info.mode}`, `project=${info.projectPath ?? ""}`, `govRepo=${info.govRepo ?? ""}`,
    `orgConfigPath=${info.orgConfigPath ?? ""}`, `orgConfigHash=${info.orgConfigHash ?? ""}`,
    `user=${info.user ?? ""}`, `env=${targetEnv ?? ""}`, `cli=${(cliVersion ?? "").split(".")[0]}`,
  ];
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** The human banner (always shown). Never prints a secret value — URLs/presence only. */
export function renderBanner(info: ContextInfo, targetEnv?: string): string[] {
  const mode = info.mode === "project" ? "PROJECT" : info.mode === "governed" ? "GOVERNED" : "NONE";
  const where = info.mode === "project" ? info.projectPath : info.govRepo;
  const svc = (k: string) => (info.services[k] ? "✓" : "·");
  const lines = [
    `gov · context: ${mode}${where ? `  (${where})` : ""}${info.user ? `   user: ${info.user}` : "   user: (not logged in)"}`,
    `  gov_repo:   ${info.govRepo ?? "(unresolved)"}${info.branch ? ` (${info.branch})` : ""}`,
    `  org_config: ${info.orgConfigPath ?? "(none)"}   vault ${svc("vault")} oidc ${svc("oidc")} jenkins ${svc("jenkins")} npm ${svc("npm")}`,
  ];
  if (targetEnv) lines.push(`  target env: ${targetEnv}`);
  for (const a of info.anomalies) lines.push(`  ⚠ ${a}`);
  return lines;
}

export interface Ack { fp: string; at: number }
const TTL_MS = 12 * 60 * 60 * 1000;
const CAP = 16;

export function isAcked(records: readonly Ack[], fp: string, now: number): boolean {
  return records.some((r) => r.fp === fp && now - r.at < TTL_MS);
}
export function recordAck(records: readonly Ack[], fp: string, now: number): Ack[] {
  const kept = records.filter((r) => r.fp !== fp && now - r.at < TTL_MS);
  return [{ fp, at: now }, ...kept].slice(0, CAP);
}
