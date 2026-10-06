// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WHICH MODEL THE ORG HAS APPROVED FOR PROPOSING RULES (rule-model-design.md Q16/17, "org-config"; P3 wave 2).
 *
 * The setting lives in `policies/governance.yaml`, the governance choices the Policy Owner approves:
 *
 *   models:
 *     propose: { provider: anthropic, model: <the model the org approved> }   # or provider: command
 *     command: "<a CLI that reads a prompt on stdin and writes the reply on stdout>"
 *     ci_allowed: false                                                        # may CI run it on a policy PR?
 *
 * Read from the DEFAULT branch by both triggers: a branch that turns `ci_allowed` on, or swaps the model, has
 * proposed that change, not made it.
 *
 * Pure.
 */
import yaml from "js-yaml";

/** The shape `modelSettings(g)` in src/config/governance.ts returns. */
export interface ModelSettings {
  /** null = no model approved: propose refuses. */
  readonly provider: "anthropic" | "command" | null;
  readonly model: string;
  readonly command: string;
  readonly ciAllowed: boolean;
}

export const GOVERNANCE_PATH = "policies/governance.yaml";

export const NO_MODEL: ModelSettings = { provider: null, model: "", command: "", ciAllowed: false };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

// ORCH-MERGE: replace with modelSettings() from src/config/governance.ts
/** `models:` from the text of `policies/governance.yaml`. Absent, unparseable or unknown → no model approved. */
export function readModelSettings(text: string | null | undefined): ModelSettings {
  if (!text) return NO_MODEL;
  let doc: unknown;
  try {
    doc = yaml.load(text, { schema: yaml.JSON_SCHEMA });
  } catch {
    // An unreadable file approves nothing; propose then refuses and names the file.
    return NO_MODEL;
  }
  const m = obj(obj(doc).models);
  const p = obj(m.propose);
  const provider = str(p.provider);
  return {
    provider: provider === "anthropic" || provider === "command" ? provider : null,
    model: str(p.model),
    command: str(m.command),
    ciAllowed: m.ci_allowed === true,
  };
}
