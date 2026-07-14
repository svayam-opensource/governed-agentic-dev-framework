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
  /** OpenBao/Vault address (`vault_addr`) — the gov creds→Vault target; env `GOV_BAO_ADDR` overrides. */
  readonly vaultAddr: string;
  /** Token → value for tool-file substitution (seed phase B.1). */
  readonly orgTokens: Readonly<Record<string, string>>;
}

/** Parse `org-config.yaml` text into a typed {@link OrgConfig}. Pure. */
export function parseOrgConfig(text: string, home: string = os.homedir()): OrgConfig {
  const get = (key: string): string => readTopLevelScalar(text, key) ?? "";

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
  const vaultAddr = get("vault_addr");

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
    orgTokens,
  };
}
