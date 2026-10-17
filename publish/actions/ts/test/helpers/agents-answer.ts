// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Answers the AI-agent selection a configure-in-place `gov setup` now asks (F18): `none`, then Y to the read-back.
 * For tests that drive setup with defaults and are about something else — the selection has no default to accept,
 * because which agents an organization allows is a decision, never a keystroke.
 */
import { noneOption } from "../../src/cli/agent-selection.js";

export function agentAnswer(q: string): string | undefined {
  if (/Choose \(Y\/n\)/.test(q)) return "y";
  if (/^\s*Choose \[/.test(q)) return String(noneOption());
  return undefined;
}
