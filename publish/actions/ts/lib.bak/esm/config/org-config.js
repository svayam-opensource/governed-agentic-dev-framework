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
/** Parse `org-config.yaml` text into a typed {@link OrgConfig}. Pure. */
export function parseOrgConfig(text, home = os.homedir()) {
    const get = (key) => readTopLevelScalar(text, key) ?? "";
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
    const orgTokens = {
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
        orgTokens,
    };
}
