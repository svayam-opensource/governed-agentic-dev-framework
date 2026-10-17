// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `policies/ownership.yaml` — READ ONCE, COMPARED ONE WAY (W2-Q8; integration, 2026-10-06).
 *
 * Each row says who approves a change to one policy section, and carries the sha of the section whose sentence
 * grants it. That sha moves whenever the granting section's prose does, so it is BOOKKEEPING, not ownership: the
 * section's own owner already approves that prose. What needs the Policy Owner is a change to WHO OWNS WHAT — a row
 * added, removed, or with its doc, section or role changed. {@link ownershipDiffers} is that one comparison, used by
 * section-owner-approval (who must approve), propose (is this an ownership change) and the policy PR gate.
 *
 * Pure.
 */
import yaml from "js-yaml";
import type { SectionOwnership } from "../model/contracts.js";

export const OWNERSHIP_PATH = "policies/ownership.yaml";

/**
 * The rows of an ownership file, or a reason it could not be read. A row missing any of doc, section, role or sha
 * is not an ownership row and is left out; empty text is no rows.
 */
export function parseOwnership(text: string): SectionOwnership[] | { readonly error: string } {
  let doc: unknown;
  try {
    doc = yaml.load(text, { schema: yaml.JSON_SCHEMA }) ?? [];
  } catch (e) {
    return { error: `does not parse: ${(e as Error).message}` };
  }
  if (!Array.isArray(doc)) return { error: "is not a list" };
  return doc
    .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
    .map((o) => ({ doc: String(o.doc ?? ""), section: String(o.section ?? ""), role: String(o.role ?? ""), sha: String(o.sha ?? "") }))
    .filter((o) => o.doc && o.section && o.role && o.sha);
}

const key = (o: Pick<SectionOwnership, "doc" | "section" | "role">): string => `${o.doc}\u0000${o.section}\u0000${o.role}`;

/** Did WHO OWNS WHAT change? Rows compared by doc, section and role; a sha moving alone is not a change. */
export function ownershipDiffers(a: readonly SectionOwnership[], b: readonly SectionOwnership[]): boolean {
  const x = new Set(a.map(key)), y = new Set(b.map(key));
  return x.size !== y.size || [...x].some((k) => !y.has(k));
}
