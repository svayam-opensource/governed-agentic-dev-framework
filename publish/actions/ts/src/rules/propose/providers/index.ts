// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE ORG'S MODEL SETTING → A {@link ModelPort}, OR A REFUSAL THAT SAYS WHAT TO DO (P3 wave 2).
 *
 * No setting, no model: gov sends policy text only to a model the organization has approved, and the approval is
 * a line in `policies/governance.yaml` that the Policy Owner merges. CI may use it only when `ci_allowed` says so.
 */
import type { ModelPort } from "../model-port.js";
import { GOVERNANCE_PATH, type ModelSettings } from "../model-settings.js";
import { anthropicModel, ANTHROPIC_KEY_ENV, type FetchLike } from "./anthropic.js";
import { commandModel, type RunWithInput } from "./command.js";
import { geminiModel, GEMINI_KEY_ENV } from "./gemini.js";

export type ModelChoice =
  | { readonly ok: true; readonly model: ModelPort; readonly describe: string }
  | { readonly ok: false; readonly lines: readonly string[] };

export interface ModelChoiceDeps {
  /** Running in CI (the policy pull request trigger) rather than at a person's terminal. */
  readonly ci: boolean;
  /** The Anthropic key — the environment first, then gov's credentials store. Called only for `anthropic`. */
  readonly anthropicKey: () => string | null;
  /** The Gemini key — the environment first, then gov's credentials store. Called only for `gemini`. */
  readonly geminiKey: () => string | null;
  readonly runCommand: RunWithInput;
  readonly fetch?: FetchLike;
}

/** Framework specification §9.3, said in plain words. */
export const NO_APPROVED_MODEL = [
  "gov rules propose: your organization has not approved a language model for proposing rules.",
  "  gov sends your policy text only to a model your organization has approved (framework specification §9.3:",
  "  the organization declares the model it allows, and CI may use only one it has also allowed for CI).",
  `  Approve one in ${GOVERNANCE_PATH}, under \`models:\` — the Policy Owner merges that change:`,
  "    models:",
  "      propose: { provider: anthropic, model: <model id> }   # or provider: gemini, or provider: command",
  "      command: \"<a CLI that reads the prompt on stdin>\"     # for provider: command",
  "      ci_allowed: false                                      # true lets CI propose on a policy pull request",
];

export function chooseModel(s: ModelSettings, deps: ModelChoiceDeps): ModelChoice {
  if (s.provider === null) return { ok: false, lines: NO_APPROVED_MODEL };
  if (deps.ci && !s.ciAllowed) {
    return { ok: false, lines: [`gov rules propose: ${GOVERNANCE_PATH} does not allow a model in CI (models.ci_allowed is not true) — run gov rules propose locally.`] };
  }
  if (s.provider === "command") {
    if (!s.command) return { ok: false, lines: [`gov rules propose: ${GOVERNANCE_PATH} chooses provider \`command\` but sets no models.command to run.`] };
    return { ok: true, model: commandModel({ command: s.command, run: deps.runCommand }), describe: `the approved command \`${s.command}\`` };
  }
  if (!s.model) return { ok: false, lines: [`gov rules propose: ${GOVERNANCE_PATH} chooses provider \`${s.provider}\` but names no model (models.propose.model).`] };
  if (s.provider === "gemini") {
    const apiKey = deps.geminiKey();
    if (!apiKey) {
      return { ok: false, lines: [
        `gov rules propose: no Gemini API key. Set ${GEMINI_KEY_ENV} in the environment${deps.ci ? ` (the org's Actions secret ${GEMINI_KEY_ENV})` : ", or store it in gov's credentials file (`gov agent install gemini-code-assist` stores it there)"}.`,
      ] };
    }
    return { ok: true, model: geminiModel({ apiKey, model: s.model, ...(deps.fetch ? { fetch: deps.fetch } : {}) }), describe: `${s.model} (Google Gemini)` };
  }
  const apiKey = deps.anthropicKey();
  if (!apiKey) {
    return { ok: false, lines: [
      `gov rules propose: no Anthropic API key. Set ${ANTHROPIC_KEY_ENV} in the environment${deps.ci ? " (an Actions secret)" : ", or store it in gov's credentials file (`gov agent install claude-code` stores it there)"}.`,
    ] };
  }
  return { ok: true, model: anthropicModel({ apiKey, model: s.model, ...(deps.fetch ? { fetch: deps.fetch } : {}) }), describe: `${s.model} (Anthropic)` };
}

/**
 * A model resolved on its FIRST call. A run with nothing stale never needs one, so it must not refuse for the
 * lack of one; a run that does need one stops with the refusal's own words ({@link ModelRefused}).
 */
export class ModelRefused extends Error {
  constructor(readonly lines: readonly string[]) { super(lines[0] ?? "no model"); }
}

export function lazyModel(choose: () => ModelChoice, onChosen?: (describe: string) => void): ModelPort {
  let chosen: ModelChoice | null = null;
  return {
    async complete(req) {
      if (!chosen) {
        chosen = choose();
        if (chosen.ok) onChosen?.(chosen.describe);
      }
      if (!chosen.ok) throw new ModelRefused(chosen.lines);
      return chosen.model.complete(req);
    },
  };
}
