// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WHEN AN AGENT'S ACCOUNT STOPS IT, SAY SO (F24, PRJ-121, 2026-10-08).
 *
 * IBM Bob exited with "Error: Your Free trial has expired. … Upgrade your plan to continue." gov answered with its
 * first-run text — "accepting a licence, or signing in" — and offered to open Bob again. Nothing gov or the person
 * can do on this machine fixes an expired trial, so that offer was a loop with no exit.
 *
 * A licence screen and a sign-in ARE settled here, and the first-run path stays for them. An account or a bill is
 * between the person and the vendor: gov says that plainly, and moves on to the agents that can still run.
 *
 * EARLY OUTPUT ONLY. These failures are printed before the agent does anything; a session that runs and then
 * mentions a quota in its transcript is not one. So only the first {@link EARLY_BYTES} are read.
 */
import { AGENT_CATALOG, type AccountFailurePattern, type AgentCandidate } from "./agent-catalog.js";

/** How much of an agent's output counts as "early". */
export const EARLY_BYTES = 4096;

/**
 * Failures any vendor's CLI may print. Deliberately narrow: each needs a word about an ACCOUNT (trial, quota, plan,
 * credit, billing) or a key the vendor REJECTED. "API key is required" is a missing key — a sign-in step, left to
 * the first-run path, because the person can settle it here.
 */
export const GENERIC_ACCOUNT_FAILURES: readonly AccountFailurePattern[] = [
  { pattern: /free trial (period )?(has |have )?(expired|ended)|end of your free trial/i, reason: "its account's free trial has expired" },
  { pattern: /(exceeded|reached|used up) (your |the )?(current |monthly |usage )?(quota|usage limit|plan limit)|insufficient[_ ]quota/i, reason: "its account has run out of quota on its plan" },
  { pattern: /credit balance is too low|out of credits|insufficient (credits|funds|balance)/i, reason: "its account's credit balance is too low" },
  { pattern: /billing (is )?(not active|inactive|hard limit)|payment required/i, reason: "its account's billing needs attention" },
  { pattern: /subscription (has )?(expired|ended|lapsed)/i, reason: "its account's subscription has expired" },
  { pattern: /\b(invalid|incorrect|expired|revoked) (api[ _-]?key|token|credentials?)\b|\bapi[ _-]?key (is )?(invalid|expired|revoked)\b|\bapi[ _-]?key expired\b/i, reason: "its API key is invalid or has expired" },
];

export interface AccountFailure {
  /** Plain words, starting "its …": "its account's free trial has expired". */
  readonly reason: string;
}

/** Recognise an account or billing failure in an agent's early output, or null. */
export function recogniseAccountFailure(
  agentId: string, output: string, catalog: readonly AgentCandidate[] = AGENT_CATALOG,
): AccountFailure | null {
  const early = output.slice(0, EARLY_BYTES);
  const own = catalog.find((a) => a.id === agentId)?.accountFailures ?? [];
  for (const p of [...own, ...GENERIC_ACCOUNT_FAILURES]) {
    if (p.pattern.test(early)) return { reason: p.reason };
  }
  return null;
}

/** "IBM Bob cannot run: its account's free trial has expired — that is between you and IBM, gov cannot fix it." */
export function accountFailureLine(agentId: string, f: AccountFailure, catalog: readonly AgentCandidate[] = AGENT_CATALOG): string {
  const a = catalog.find((c) => c.id === agentId);
  const name = a?.tool ?? agentId;
  const vendor = a?.vendor ?? "the vendor";
  return `${name} cannot run: ${f.reason} — that is between you and ${vendor}, gov cannot fix it.`;
}
