// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE GOVERNANCE POSTURE AT SETUP (Policy Owner, W2-Q6, 2026-10-06).
 *
 * Soft is the default. Hard is chosen deliberately, past a confirmation that says what it costs — the text is the
 * Policy Owner's, verbatim, and its default is N: anything but a yes leaves the organization soft.
 *
 * Pure apart from the injected prompt; shared by the adopter interview and bare `gov setup`.
 */
import type { GovernancePosture } from "../config/governance.js";

export const HARD_POSTURE_CONFIRMATION = [
  'Choosing "hard" requires your repositories to be public, or a paid GitHub plan.',
  "hard — the action (for example a merge) is stopped when a policy violation is detected.",
  "soft — a violation record is opened so the Policy Owner can review it later.",
  'Do you still want the governance posture to be "hard"? [y/N]',
].join("\n");

export const POSTURE_QUESTION = "What governance posture should your organization use? (1 = soft, 2 = hard)";

/** `1`/`soft` → soft, `2`/`hard` → hard, anything else → null. Blank is the caller's default. */
export function parsePostureAnswer(answer: string): GovernancePosture | null {
  const a = answer.trim().toLowerCase();
  if (a === "1" || a === "soft") return "soft";
  if (a === "2" || a === "hard") return "hard";
  return null;
}

export const postureRule = (v: string): string | null =>
  parsePostureAnswer(v) ? null : `'${v}' is not a posture — 1 (soft) or 2 (hard).`;

/** After a `hard` answer: show the confirmation; only y/yes keeps hard. */
export async function confirmPosture(chosen: GovernancePosture, prompt: (question: string, def: string) => Promise<string>): Promise<GovernancePosture> {
  if (chosen !== "hard") return chosen;
  const reply = ((await prompt(`${HARD_POSTURE_CONFIRMATION} `, "")) ?? "").trim().toLowerCase();
  return reply === "y" || reply === "yes" ? "hard" : "soft";
}
