// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov-work setup` (port of setup.sh) — the one-time workspace BOOTSTRAP: gather org
 * identity, generate `org-config.yaml` (the single source of truth), and point
 * `origin` at the org repo. Runs in the cloned framework repo, BEFORE resolution
 * (it's what makes a gov workspace exist). This module is the pure core (render +
 * defaults + URL parse); the interactive prompts + effects live in setup-run.ts.
 */

/** Every field written to org-config.yaml. */
export interface OrgConfigValues {
  readonly orgName: string;
  readonly orgShortName: string;
  readonly orgSlug: string;
  readonly orgSlugLower: string;
  readonly orgRepoUrl: string;
  readonly githubOrg: string;
  readonly workspaceRepo: string;
  readonly defaultBranch: string;
  readonly defaultCodeBranch: string;
  readonly agentWorkRoot: string;
  readonly govWorkspace: string;
  readonly policyOwnerEmail: string;
  readonly policyOwnerGithub: string;
  readonly legalOwnerGithub: string;
  readonly infraOwnerGithub: string;
  readonly systemArchOwnerGithub: string;
  readonly dataArchOwnerGithub: string;
  readonly policyEffectiveDate: string;
  /** OpenBao/Vault address for gov creds→Vault + attest (optional; empty if not using Vault). */
  readonly vaultAddr: string;
}

/** Parse a GitHub remote URL → owner/repo (ssh or https, optional .git). */
export function parseOriginOwnerRepo(url: string): { owner: string; repo: string } | null {
  const m = url.trim().match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/i);
  return m ? { owner: m[1], repo: m[2] } : null;
}

/** Context for filling defaults: what we can read from the environment. */
export interface SetupContext {
  readonly originUrl: string;
  readonly ghUser: string | null;
  readonly gitEmail: string | null;
  readonly today: string;
  readonly existing?: Partial<OrgConfigValues>;
}

/**
 * Fill every field from the user's answers + environment, applying setup.sh's
 * defaults (slug_lower derived; github_org/workspace_repo from origin; branch
 * defaults; canonical ~/.<slug>/… paths; owners default to the policy owner).
 */
export function deriveOrgConfig(answers: Partial<OrgConfigValues>, ctx: SetupContext): OrgConfigValues {
  const e = ctx.existing ?? {};
  const pick = (k: keyof OrgConfigValues, fallback: string): string =>
    (answers[k] as string | undefined) ?? (e[k] as string | undefined) ?? fallback;

  const origin = parseOriginOwnerRepo(ctx.originUrl);
  const orgSlug = pick("orgSlug", "");
  const orgSlugLower = orgSlug.toLowerCase();
  const policyOwnerGithub = pick("policyOwnerGithub", ctx.ghUser ? `@${ctx.ghUser}` : "");

  return {
    orgName: pick("orgName", ""),
    orgShortName: pick("orgShortName", ""),
    orgSlug,
    orgSlugLower,
    orgRepoUrl: pick("orgRepoUrl", ctx.originUrl),
    githubOrg: pick("githubOrg", origin?.owner ?? ""),
    workspaceRepo: pick("workspaceRepo", origin?.repo ?? ""),
    defaultBranch: pick("defaultBranch", "main"),
    defaultCodeBranch: pick("defaultCodeBranch", "dev"),
    agentWorkRoot: pick("agentWorkRoot", `~/.${orgSlugLower}/projects`),
    govWorkspace: pick("govWorkspace", `~/.${orgSlugLower}/gov_repo`),
    policyOwnerEmail: pick("policyOwnerEmail", ctx.gitEmail ?? ""),
    policyOwnerGithub,
    legalOwnerGithub: pick("legalOwnerGithub", policyOwnerGithub),
    infraOwnerGithub: pick("infraOwnerGithub", policyOwnerGithub),
    systemArchOwnerGithub: pick("systemArchOwnerGithub", policyOwnerGithub),
    dataArchOwnerGithub: pick("dataArchOwnerGithub", policyOwnerGithub),
    policyEffectiveDate: pick("policyEffectiveDate", ctx.today),
    vaultAddr: pick("vaultAddr", ""),
  };
}

/** Render org-config.yaml (byte-compatible with setup.sh's template). */
export function renderOrgConfig(v: OrgConfigValues): string {
  return `# Governed Agentic Development Framework — Organization Configuration
#
# Single source of truth for this organization's identity, defaults, and roles.
# The gov-work CLI and agents read these values at runtime — no placeholder
# substitution — so this file is the only thing that diverges from the upstream
# framework template. Re-run \`gov-work setup\` to update; avoid editing by hand.

# Full legal name of your organization
org_name: "${v.orgName}"

# Short display name (used in headings and prose)
org_short_name: "${v.orgShortName}"

# Uppercase slug for human display and multi-org disambiguation (2-6 chars).
org_slug: "${v.orgSlug}"

# Lowercase derivation of org_slug — used for filesystem paths. Auto-derived.
org_slug_lower: "${v.orgSlugLower}"

# Full URL of this workspace repository. 'origin' will be set to this.
org_repo_url: "${v.orgRepoUrl}"

# GitHub organization or username (derived from org_repo_url)
github_org: "${v.githubOrg}"

# Name of this workspace repository (derived from org_repo_url)
workspace_repo: "${v.workspaceRepo}"

# Default branch name for this workspace repo
default_branch: "${v.defaultBranch}"

# Default base branch for code repositories (used by seed)
default_code_branch: "${v.defaultCodeBranch}"

# Per-project workspaces are created under this path.
agent_work_root: "${v.agentWorkRoot}"

# The home governance-repo clone ("gov_repo") — the deterministic on-main
# workspace seed/init operate from. Keep it PORTABLE (leading ~ expanded at runtime).
gov_workspace: "${v.govWorkspace}"

# Policy Owner details (initial holder of all policy roles at launch)
policy_owner_email: "${v.policyOwnerEmail}"
policy_owner_github: "${v.policyOwnerGithub}"

# Other role GitHub handles (update as roles are formally assigned)
legal_owner_github: "${v.legalOwnerGithub}"
infra_owner_github: "${v.infraOwnerGithub}"
system_arch_owner_github: "${v.systemArchOwnerGithub}"
data_arch_owner_github: "${v.dataArchOwnerGithub}"

# Effective date of the policy (YYYY-MM-DD)
policy_effective_date: "${v.policyEffectiveDate}"

# OpenBao/Vault address — the gov creds→Vault + attest target (env GOV_BAO_ADDR overrides).
vault_addr: "${v.vaultAddr}"
`;
}

/** Read the scalar fields from an existing org-config.yaml (for re-run defaults). */
export function readExistingOrgConfig(text: string): Partial<OrgConfigValues> {
  const scalar = (key: string): string | undefined => {
    const m = text.match(new RegExp(`^${key}:\\s*"?([^"\\n]*)"?\\s*$`, "m"));
    return m ? m[1].trim() : undefined;
  };
  const map: Array<[keyof OrgConfigValues, string]> = [
    ["orgName", "org_name"], ["orgShortName", "org_short_name"], ["orgSlug", "org_slug"],
    ["orgRepoUrl", "org_repo_url"], ["githubOrg", "github_org"], ["workspaceRepo", "workspace_repo"],
    ["defaultBranch", "default_branch"], ["defaultCodeBranch", "default_code_branch"],
    ["agentWorkRoot", "agent_work_root"], ["govWorkspace", "gov_workspace"],
    ["policyOwnerEmail", "policy_owner_email"], ["policyOwnerGithub", "policy_owner_github"],
    ["policyEffectiveDate", "policy_effective_date"], ["vaultAddr", "vault_addr"],
  ];
  const out: Partial<Record<keyof OrgConfigValues, string>> = {};
  for (const [k, y] of map) {
    const val = scalar(y);
    if (val !== undefined && val !== "") out[k] = val;
  }
  return out;
}
