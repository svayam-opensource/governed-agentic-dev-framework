// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd. — part of the OSS governed-agentic-dev-framework.
/**
 * `@svayam-opensource/gov/policy-pr` — THE POLICY PULL REQUEST, AS A LIBRARY (F127 slice G3, 2026-11-20).
 *
 * For a service that changes an organization's policy on a person's behalf (gov-licence's write side): prepare the
 * head of a branch with {@link applyPolicyEdit}, check it with {@link judgePolicyPr} exactly as the gov repo's CI
 * will, and read rows and the policy document with the same parsers gov uses. Pure over {@link TreeReader} /
 * {@link TreeWriter}: the caller decides where the trees come from (GitHub's contents API, a clone, memory).
 */
export { applyPolicyEdit, writeStatementInto, type PolicyEdit, type PolicyEditInput, type PolicyEditResult } from "./edit.js";
export { judgePolicyPr, planPolicyPr, POLICY_PR_PATHS, type PolicyPrInput, type PolicyPrJudgement, type PolicyPrPlan, type GateFinding, type RuleChanges } from "./gate.js";
export { memTree, type TreeReader, type TreeWriter } from "./tree.js";
export { CHAPTERS, isChapter, inForce, openRows, parseRuleStore, validateRuleStore, type Chapter, type Level, type Actor, type RuleRow, type Stamp } from "../model/rule-row.js";
export { parsePolicyDocument, mergePolicyDocuments, POLICY_DOCUMENT_PATHS, type PolicyDocument } from "../model/policy-document.js";
export {
  requiredSectionOwners, POLICY_OWNER, CHECK_OWNER, MACHINE_WRITTEN_POLICY_PATHS,
  type RequiredSectionOwners, type RequiredSectionOwnersOptions, type SectionOwnersFile, type SectionOwnersRules,
} from "../checks/policy-actions.js";
export { parseOwnership, OWNERSHIP_PATH } from "../checks/ownership.js";
export type { SectionOwnership } from "../model/contracts.js";
export { sectionOwnersRulesFrom, SECTION_OWNERS_RULE_PATHS, type SectionOwnersRuleTexts, type SectionOwnersRulesLoad } from "../checks/section-owners-rules.js";
