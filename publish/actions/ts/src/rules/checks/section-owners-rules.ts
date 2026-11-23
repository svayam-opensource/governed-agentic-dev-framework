// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WHAT {@link requiredSectionOwners} NEEDS, FROM THE GOV REPO'S TEXTS (F136, Policy Owner ruling D3 A+, 2026-11-23).
 *
 * A service that reads the governance repository over an API (gov-licence) has the files' texts, not a checkout.
 * This turns the three texts at the DEFAULT branch into the `ownership` and `roles` the check routes approval by,
 * read the way the check reads them: roles as store-io's loader builds them (the Policy Owner and Check Owner from
 * governance.yaml, a vacant Check Owner reading as the Policy Owner, every other role from the role list), and
 * ownership as {@link loadCheckRuleSet} does (absent → every section is the Policy Owner's; unreadable → refused,
 * never guessed). Each role's alternate too (F143 A), and the posture, which decides whether a change nobody else
 * can approve is solo mode (Q45 C) or a plain miss. Pure.
 */
import { frameworkAlternates, frameworkOwners, parseGovernance, GOVERNANCE_PATH } from "../../config/governance.js";
import { resolveRoles, roleAlternates, roleHandles, ROLE_LIST_PATH } from "../../config/role-list.js";
import { OWNERSHIP_PATH, parseOwnership } from "./ownership.js";
import type { SectionOwnersRules } from "./policy-actions.js";

/** The gov repo's files a section-owner decision reads, at its default branch. */
export const SECTION_OWNERS_RULE_PATHS = { governance: GOVERNANCE_PATH, roleList: ROLE_LIST_PATH, ownership: OWNERSHIP_PATH } as const;

/** Each file's text, or null when it is not there. */
export interface SectionOwnersRuleTexts {
  readonly governance: string | null;
  readonly roleList: string | null;
  readonly ownership: string | null;
}

export type SectionOwnersRulesLoad = { readonly ok: true; readonly rules: SectionOwnersRules } | { readonly ok: false; readonly reason: string };

export function sectionOwnersRulesFrom(texts: SectionOwnersRuleTexts): SectionOwnersRulesLoad {
  let ownership: SectionOwnersRules["ownership"] = [];
  if (texts.ownership !== null) {
    const parsed = parseOwnership(texts.ownership);
    if ("error" in parsed) return { ok: false, reason: `${OWNERSHIP_PATH} ${parsed.error}` };
    ownership = parsed;
  }
  const gov = parseGovernance(texts.governance);
  const roleList = resolveRoles(texts.roleList).roles;
  const roles = roleHandles(frameworkOwners(gov), roleList);
  const alternates = roleAlternates(frameworkAlternates(gov), roleList);
  const posture = gov.posture.posture === "hard" ? "hard" : "soft";
  return { ok: true, rules: { ownership, roles, alternates, posture } };
}
