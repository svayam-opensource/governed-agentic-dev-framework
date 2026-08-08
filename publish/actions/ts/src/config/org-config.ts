// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Load the org config (SDD-012) — the ONE remaining repo config file (read-only,
 * hand-authored, one per gov home). Parsed in-process from `org-config.yaml`'s
 * top-level scalars (no yq/python); paths expand `~`. This is the typed config
 * the dispatcher threads into the lifecycle commands, plus the token map seed
 * uses for tool-file substitution.
 */
import * as os from "node:os";
import { readTopLevelScalar, expandTilde } from "../resolve/node-env.js";

export interface OrgConfig {
  readonly orgName: string;
  readonly orgShortName: string;
  readonly orgSlug: string;
  readonly orgSlugLower: string;
  readonly githubOrg: string;
  readonly workspaceRepo: string;
  /** `org_repo_url` — the gov repo clone URL (used by join). */
  readonly orgRepoUrl: string;
  readonly defaultBranch: string;
  readonly defaultCodeBranch: string;
  /** `agent_work_root`, expanded to an absolute path. */
  readonly agentWorkRoot: string;
  /** `gov_workspace`, expanded to an absolute path. */
  readonly govWorkspace: string;
  readonly policyOwnerEmail: string;
  /** OpenBao/Vault address (`vault_addr` or `services.vault`) — read by the DEPLOY clients (gov-cicd/gov-infra);
   *  gov-work stores no secrets. env `GOV_BAO_ADDR` overrides. */
  readonly vaultAddr: string;
  /** IAM broker OIDC base (`services.oidc`) — the deploy clients' `auth login` target. gov-work never uses it. */
  readonly oidcBase: string;
  /** The org service endpoints (`services:` block) as a generic map — vault/oidc used by core, jenkins/npm/
   *  docker read by the gov-cicd plugin. Org-level, governed; adopters inherit them. */
  readonly services: Readonly<Record<string, string>>;
  /** Gov tenant/account (`gov_account`) — the account context service auth mints under; env `GOV_ACCOUNT` overrides. */
  readonly govAccount: string;
  /** Token → value for tool-file substitution (seed phase B.1). */
  readonly orgTokens: Readonly<Record<string, string>>;
}

/** Parse `org-config.yaml` text into a typed {@link OrgConfig}. Pure. */
/** Read a scalar under the `services:` block (one indent level), stripping quotes + inline comments. */
function readServiceScalar(text: string, key: string): string | undefined {
  let inServices = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^services:\s*$/.test(line)) { inServices = true; continue; }
    if (!inServices) continue;
    if (/^\S/.test(line)) break;                                   // dedent → end of the block
    const m = new RegExp(`^\\s+${key}:\\s*(.+)$`).exec(line);
    if (m) return m[1].trim().replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "").trim() || undefined;
  }
  return undefined;
}

export function parseOrgConfig(text: string, home: string = os.homedir()): OrgConfig {
  const get = (key: string): string => readTopLevelScalar(text, key) ?? "";
  const svc = (key: string): string | undefined => readServiceScalar(text, key);
  // The org's service endpoints (org-level, governed). gov-work USES vault/oidc/account; jenkins/npm/docker
  // are read by the gov-cicd plugin — kept here as a generic map so the banner/creds see them uniformly.
  const services: Record<string, string> = {};
  for (const k of ["vault", "oidc", "oidc_client_id", "jenkins", "npm", "docker"]) { const v = svc(k); if (v) services[k] = v; }

  const orgName = get("org_name");
  const orgShortName = get("org_short_name");
  const orgSlug = get("org_slug");
  const orgSlugLower = get("org_slug_lower");
  const githubOrg = get("github_org");
  const workspaceRepo = get("workspace_repo");
  const orgRepoUrl = get("org_repo_url");
  const defaultBranch = get("default_branch");
  const defaultCodeBranch = get("default_code_branch");
  const agentWorkRoot = expandTilde(get("agent_work_root"), home);
  const govWorkspace = expandTilde(get("gov_workspace"), home);
  const policyOwnerEmail = get("policy_owner_email");
  // vault_addr (legacy top-level) OR services.vault; oidc + account likewise. Endpoints are org-level.
  const vaultAddr = get("vault_addr") || services.vault || "";
  const oidcBase = get("oidc_base") || services.oidc || "";
  const govAccount = get("gov_account") || svc("gov_account") || "";

  const orgTokens: Record<string, string> = {
    ORG_NAME: orgName,
    ORG_SHORT_NAME: orgShortName,
    ORG_SLUG: orgSlug,
    org_slug: orgSlugLower,
    GITHUB_ORG: githubOrg,
    WORKSPACE_REPO: workspaceRepo,
    DEFAULT_BRANCH: defaultBranch,
    DEFAULT_CODE_BRANCH: defaultCodeBranch,
    AGENT_WORK_ROOT: agentWorkRoot,
    POLICY_OWNER_EMAIL: policyOwnerEmail,
  };

  return {
    orgName,
    orgShortName,
    orgSlug,
    orgSlugLower,
    githubOrg,
    workspaceRepo,
    orgRepoUrl,
    defaultBranch,
    defaultCodeBranch,
    agentWorkRoot,
    govWorkspace,
    policyOwnerEmail,
    vaultAddr,
    oidcBase,
    services,
    govAccount,
    orgTokens,
  };
}
