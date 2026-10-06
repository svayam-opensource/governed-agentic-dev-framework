// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE ONE ORDER CUES ARE READ IN (rule-model-design.md Q19; 2026-10-06): the framework's rules, then the
 * organization's, each by id number. A reading convenience only — position confers no precedence on a model.
 *
 * By NUMBER, not string: `GOV-SVM-1000` follows `GOV-SVM-999`. Ties (which validation forbids among in-force
 * rows) fall back to the id string so the order is total and the output byte-stable.
 */
import { parseGovId } from "../model/gov-id.js";
import { inForce, type RuleRow } from "../model/rule-row.js";
import type { RuleSet } from "../model/contracts.js";

const byId = (a: RuleRow, b: RuleRow): number => {
  const na = parseGovId(a.id)?.n ?? Number.MAX_SAFE_INTEGER, nb = parseGovId(b.id)?.n ?? Number.MAX_SAFE_INTEGER;
  return na - nb || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
};

/** Every in-force row of the set matching `keep`, framework first, each store sorted by id. Retired rows never appear. */
export const orderedInForce = (set: RuleSet, keep: (r: RuleRow) => boolean): RuleRow[] => [
  ...inForce(set.framework).filter(keep).sort(byId),
  ...inForce(set.org).filter(keep).sort(byId),
];

/** Is an agent bound by this rule? Humans get no cues (Q19). */
export const bindsAgent = (r: RuleRow): boolean => r.actor.some((a) => a === "agent" || a === "everyone");
