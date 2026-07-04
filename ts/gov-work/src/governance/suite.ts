// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The assembled validation suite (SDD-032) — the concrete validator set behind
 * `prj validate` and the close test-merge gate. `runSuite` returns a shape
 * compatible with close's injected `gate` ({ ok, failures }), so the dispatcher
 * can wire it in directly: `close({ …, gate: () => runSuite(ctx) }, …)`.
 */
import { runValidators, type Validator, type ValidateContext } from "./validate.js";
import { checkVersionSync } from "./version-sync.js";
import { checkSecrets } from "./secrets.js";
import { checkProtocol } from "./protocol.js";
import { checkKnowledge } from "./knowledge.js";

/**
 * The core test-merge validators. `privacy` is publish-branch-only (it needs
 * main's org-config values) so it is added separately by the publish gate, not
 * here.
 */
export const CORE_VALIDATORS: readonly Validator[] = [
  checkVersionSync,
  checkSecrets,
  checkProtocol,
  checkKnowledge,
];

/** Run the suite; returns `{ ok, failures }` (close-gate compatible). */
export function runSuite(
  ctx: ValidateContext,
  validators: readonly Validator[] = CORE_VALIDATORS,
): { readonly ok: boolean; readonly failures: readonly string[] } {
  const run = runValidators(ctx, validators);
  return { ok: run.ok, failures: run.failures };
}
