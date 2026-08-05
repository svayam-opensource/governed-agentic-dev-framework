// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Which Vault (OpenBao) JWT auth role a caller opens their session as, decided from the gov roles their
 * token carries.
 *
 * This replaced a POSITIONAL derivation that appeared in three places:
 *
 *     roles.includes("GOV_ADMIN") ? "gov-admin" : roles[0]?.toLowerCase().replace(/_/g, "-")
 *
 * `roles[0]` is whichever role the claim happened to serialise first. Nothing guarantees that order — not
 * the IdP, not svm-ident's query plan, not the JSON. So the PRIVILEGE a session ran with could change with
 * no code change, no config change and no error.
 *
 * It stayed invisible because everyone holding more than one role also held `GOV_ADMIN`, which the special
 * case caught first. 911#184 removes that cover: splitting `GOV_RELEASE` into `GOV_RELEASE_UAT` /
 * `GOV_RELEASE_PROD` gives release engineers THREE roles, and all three derived names now exist as real
 * Vault roles — so the coin-flip starts landing on different, valid answers.
 *
 * Two rules, both aimed at that failure mode:
 *
 *   1. PRECEDENCE IS DECLARED, not observed. The first entry of MAP that the caller holds wins, whatever
 *      order the claim arrived in. Same roles, any order, same answer.
 *   2. AN UNKNOWN ROLE IS LOUD. Deriving a name for a role nobody mapped is what let a positional pick look
 *      like it worked; a role that reaches here unmapped throws and names itself, so the next role anyone
 *      adds surfaces the moment it is used rather than the day its ordering changes.
 *      (Suggested by gov-infra on 910#21 — the right call.)
 */

/** gov role → Vault JWT auth role, MOST PRIVILEGED FIRST. Order here IS the precedence. */
export const VAULT_ROLE_MAP: ReadonlyArray<readonly [string, string]> = [
  ["GOV_ADMIN", "gov-admin"],
  ["GOV_POLICY_ADMIN", "gov-policy-admin"],
  ["GOV_RELEASE_PROD", "gov-release-prod"],
  ["GOV_RELEASE_UAT", "gov-release-uat"],
  ["GOV_RELEASE", "gov-release"],
  ["GOV_SYSADMIN", "gov-sysadmin"],
  ["GOV_DEVELOPER", "gov-developer"],
];

export class UnmappedGovRoleError extends Error {
  constructor(public readonly roles: readonly string[]) {
    super(
      `your token carries no gov role this build knows how to map to a Vault role: [${roles.join(", ")}]. ` +
      `Known roles: ${VAULT_ROLE_MAP.map(([g]) => g).join(", ")}. ` +
      `If this role is new, add it to VAULT_ROLE_MAP — do NOT let a Vault role name be guessed from it.`,
    );
    this.name = "UnmappedGovRoleError";
  }
}

/**
 * The Vault role for these gov roles. `override` (GOV_BAO_JWT_ROLE) always wins — a caller asking for a
 * specific role is being explicit, which is the opposite of the problem here.
 *
 * Throws `UnmappedGovRoleError` when the caller holds roles but none are mapped. An EMPTY role list returns
 * undefined instead: "you carry no roles" is a different condition from "you carry a role I do not know",
 * and callers already report the first one usefully.
 */
export function vaultRoleFor(roles: readonly string[], override?: string): string | undefined {
  const explicit = override?.trim();
  if (explicit) return explicit;
  const held = new Set(roles.filter((r) => typeof r === "string" && r));
  if (held.size === 0) return undefined;
  for (const [gov, vault] of VAULT_ROLE_MAP) if (held.has(gov)) return vault;
  throw new UnmappedGovRoleError([...held]);
}
