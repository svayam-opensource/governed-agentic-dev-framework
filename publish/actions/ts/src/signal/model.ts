// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov signal` — what one project says to another (spec 03 §4, ruling M3). One signal is one issue in the gov repo,
 * labelled `gov-signal:<kind>`, carrying a marker that says from whom, to whom and about which items. It is found
 * by label + marker, never by board membership, so a sender who cannot write the receiver's board still reaches it
 * (Q5). A person sends; an agent writes a draft only (Q6).
 */
export const SIGNAL_KINDS = ["ask", "depends", "handover", "merge", "notice"] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

export interface SignalMarker {
  readonly kind: SignalKind;
  readonly from: string;
  readonly to: string;
  readonly items: readonly string[];
}

/**
 * Set by gov in the environment of every agent session it launches (gov work, autorun). Its presence is how
 * `gov signal` knows an agent, not a person, is asking to send.
 */
export const AGENT_SESSION_ENV = "GOV_AGENT_SESSION";

export const draftsDir = (project: string): string => `projects/${project}/signals/drafts/`;

export type GuardResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** Q6(b): refuse inside a gov-launched agent session and without a person's interactive confirm. */
export function sendGuard(i: { env: Readonly<Record<string, string | undefined>>; interactive: boolean; confirmed: boolean; project: string }): GuardResult {
  if (i.env[AGENT_SESSION_ENV]) {
    return { ok: false, reason: `a signal is sent by a person, not from an agent session (${AGENT_SESSION_ENV}=${i.env[AGENT_SESSION_ENV]}). Write a draft in ${draftsDir(i.project)} and ask a person to run \`gov signal send <draft>\`.` };
  }
  if (!i.interactive) return { ok: false, reason: "gov signal needs an interactive terminal: a person confirms each signal before it is sent." };
  if (!i.confirmed) return { ok: false, reason: "not sent — you declined." };
  return { ok: true };
}
