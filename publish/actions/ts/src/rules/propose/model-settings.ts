// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WHICH MODEL THE ORG HAS APPROVED FOR PROPOSING RULES (rule-model-design.md Q16/17, "org-config"; P3 wave 2).
 *
 * The setting lives in `policies/governance.yaml`, the governance choices the Policy Owner approves:
 *
 *   models:
 *     propose: { provider: anthropic, model: <the model the org approved> }   # or provider: gemini · command
 *     command: "<a CLI that reads a prompt on stdin and writes the reply on stdout>"
 *
 * Read from the DEFAULT branch: a branch that swaps the model has proposed that change, not made it. Only
 * `gov rules propose` at a person's terminal uses it — the policy pull request check never calls a model (F154).
 *
 * Pure.
 */
import { parseGovernance, modelSettings, GOVERNANCE_PATH } from "../../config/governance.js";

export { GOVERNANCE_PATH };

/** The shape `modelSettings(g)` in src/config/governance.ts returns. */
export interface ModelSettings {
  /** null = no model approved: propose refuses. */
  readonly provider: "anthropic" | "gemini" | "command" | null;
  readonly model: string;
  readonly command: string;
}

export const NO_MODEL: ModelSettings = { provider: null, model: "", command: "" };

/**
 * `models:` from the text of `policies/governance.yaml`, through the ONE governance reader (src/config/governance.ts).
 * Absent, unparseable or unknown → no model approved; propose then refuses and names the file.
 */
export function readModelSettings(text: string | null | undefined): ModelSettings {
  if (!text) return NO_MODEL;
  try {
    return modelSettings(parseGovernance(text));
  } catch {
    // Neither logged nor rethrown on purpose: an unreadable governance.yaml approves no model, and propose's refusal
    // then names the file — the person sees it there, where they can fix it.
    return NO_MODEL;
  }
}
