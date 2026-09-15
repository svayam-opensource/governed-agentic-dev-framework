// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * CODEOWNERS, GENERATED — never shipped as a template (Decision 13, 2026-09-14).
 *
 * WHY IT IS GENERATED. It shipped as a static file carrying seven unresolved tokens
 * (`<POLICY_OWNER_GITHUB>`, `<LEGAL_OWNER_GITHUB>`, …) because the token sweep covered only
 * `agent/` and `knowledge/`, never the repo root. GitHub cannot resolve those as users or
 * teams, so **no rule applied and `governance/policies/` was unprotected in every adopter
 * repo** — while the policy said changes there require the Policy Owner's approval. A file that
 * looks like an access gate and enforces nothing is the defect this framework keeps finding.
 *
 * Generating it removes the failure mode rather than patching it: nothing with a token in it
 * ever ships, so nothing can arrive unresolved.
 *
 * WHERE THE TWO HALVES COME FROM, and a deviation worth recording.
 *
 * Decision 13 as written said roles live in the policy ONLY and the handles leave
 * `org-config.yaml`. Implementing that literally does not work: the policy is `scaffold-auto`,
 * so an upgrade overwrites it, and an org-specific GitHub handle written there would be lost on
 * the next `gov upgrade`. A handle has to live in a file the ORG owns.
 *
 * So the split is by what each side actually knows:
 *
 *   the framework owns WHICH roles exist and WHAT each one approves  → this module
 *   the organization owns WHO holds each role                        → org-config.yaml
 *                                                                      (overlay-schema: the
 *                                                                      one mode meaning
 *                                                                      "framework owns the
 *                                                                      shape, org owns the
 *                                                                      values")
 *
 * Decision 13's intent is preserved in full — one definition of roles, CODEOWNERS generated,
 * no unresolved tokens — and `roles.md` is still deleted, because it was a SECOND definition of
 * the roles the policy already defines (POL-402).
 *
 * THE POLICY OWNER IS THE FLOOR. Every generated file protects the paths that decide who may
 * change anything: `org-config.yaml` (the handle registry itself — an ungated one is a path to
 * naming yourself the approver of every gated file), `governance/` (the doctrine), `agent/`
 * (the harness that carries the C01 digest), and `projects/`.
 *
 * DOMAIN LINES APPEAR ONLY WHEN A ROLE IS HELD. `POL-403` says a top-level domain exists if and
 * only if a named Owner role exists for it. The framework no longer ships eight domains with
 * owners TBD (Decision 10 — `knowledge/` ships empty), so an unheld role contributes no line.
 */

/** A role the framework defines, and the paths it approves. */
export interface OwnerRole {
  /** The org-config key holding the GitHub handle. */
  readonly key: string;
  /** Human name, for the generated comment. */
  readonly role: string;
  /** Paths this role approves. Empty for the floor, which is handled separately. */
  readonly paths: readonly string[];
}

/**
 * The paths the Policy Owner always approves, whoever else exists.
 *
 * `org-config.yaml` is first deliberately: it holds every other handle, so leaving it ungated
 * would let anyone with write access make themselves the approver of all the rest.
 */
export const POLICY_OWNER_PATHS: readonly string[] = [
  "/org-config.yaml",
  "/governance/",
  "/agent/",
  "/projects/",
];

/**
 * Domain roles beyond the Policy Owner.
 *
 * Their paths sit under `knowledge/`, which ships EMPTY (Decision 10) — so these lines appear
 * only once an organization has both created the domain and named a holder, which is `POL-403`
 * working as written rather than as an inherited tree.
 */
export const DOMAIN_ROLES: readonly OwnerRole[] = [
  { key: "legal_owner_github", role: "Legal Owner", paths: ["/knowledge/legal/"] },
  { key: "infra_owner_github", role: "Infrastructure Owner", paths: ["/knowledge/infrastructure/"] },
  { key: "system_arch_owner_github", role: "System Architecture Owner", paths: ["/knowledge/architecture/system/"] },
  { key: "data_arch_owner_github", role: "Data Architecture Owner", paths: ["/knowledge/architecture/data/"] },
];

/** `rkant` / `@rkant` / `` → a usable `@handle`, or null when there is nobody. */
export function normalizeHandle(raw: string | null | undefined): string | null {
  const h = (raw ?? "").trim().replace(/^@+/, "");
  return h === "" ? null : `@${h}`;
}

export interface CodeownersResult {
  readonly text: string;
  /** Roles named in org-config but with no holder — reported, never guessed at. */
  readonly unheld: readonly string[];
}

/**
 * Render CODEOWNERS from the org's handles.
 *
 * Returns null for `text` never: a repo with no Policy Owner is a hard error for the caller to
 * surface, because every path in `POLICY_OWNER_PATHS` would otherwise be left unprotected —
 * which is exactly the state the shipped template produced.
 */
export function renderCodeowners(
  handles: Readonly<Record<string, string | undefined>>,
  roles: readonly OwnerRole[] = DOMAIN_ROLES,
): CodeownersResult | null {
  const owner = normalizeHandle(handles.policy_owner_github);
  if (owner === null) return null;

  const lines: string[] = [
    "# GENERATED by gov from org-config.yaml — do not edit by hand.",
    "#",
    "# Roles and what each approves are defined by the framework; WHO holds them comes from",
    "# org-config.yaml. Change a holder there and re-run `gov upgrade` to regenerate this file.",
    "#",
    "# A domain line appears only when its role has a holder (POL-403: a domain exists if and",
    "# only if a named Owner role exists for it).",
    "",
    "# Policy Owner — the floor. org-config.yaml is listed first because it holds every other",
    "# handle: an ungated copy is a route to becoming the approver of everything else.",
  ];
  const width = Math.max(...POLICY_OWNER_PATHS.map((p) => p.length)) + 2;
  for (const p of POLICY_OWNER_PATHS) lines.push(`${p.padEnd(width)}${owner}`);

  const unheld: string[] = [];
  for (const r of roles) {
    const h = normalizeHandle(handles[r.key]);
    if (h === null) { unheld.push(r.role); continue; }
    lines.push("", `# ${r.role}`);
    const w = Math.max(...r.paths.map((p) => p.length)) + 2;
    for (const p of r.paths) lines.push(`${p.padEnd(w)}${h}`);
  }
  return { text: `${lines.join("\n")}\n`, unheld };
}

/**
 * Does this text still carry an unresolved `<TOKEN>`? (Decision 8, 2026-09-14.)
 *
 * The shipped CODEOWNERS reached every adopter with seven of them and every test passed, so the
 * guard is the point: a generated file with an unresolved handle fails exactly as silently as a
 * shipped one.
 */
export function unresolvedTokens(text: string): readonly string[] {
  return [...new Set(text.match(/<[A-Z][A-Z0-9_]*>/g) ?? [])];
}
