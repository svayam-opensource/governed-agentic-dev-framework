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
import { parseRepoOverrides } from "./repo-overrides.js";
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
  /**
   * `env_branches` — the env branches BETWEEN `default_branch` and `default_code_branch`, HIGHEST FIRST
   * (e.g. `[uat]`, or `[uat, sit]`). Absent → the two-rung ladder, which is what every adopter has before
   * they configure anything.
   *
   * Read by `close`, which must land a project branch in its base and then every branch below it — a HOTFIX
   * is cut from a higher env branch and has to reach both (adr-hotfix-release-line, PRJ-43).
   *
   * DELIBERATELY A SECOND COPY of something the deploy side also knows. `deploy-policy.yaml`'s `promotion:`
   * graph describes what may ADVANCE INTO what, with fan-out (`dev → [sit, uat]`); this is an ORDER to merge
   * in. A graph with fan-out has no single order, so deriving one here would mean gov-work picking a path
   * and calling it the answer. Two clients, two questions, one written down in each place — recorded here so
   * the duplication is a decision rather than something a later reader has to guess at (rkant, 2026-08-09).
   */
  readonly envBranches: readonly string[];
  /**
   * `repo_overrides` — where the WORK happens, when that is not where the issue
   * lives (#194). `owner/repo: owner/repo`, upstream on the left, the repo this org
   * can write on the right. Empty for every org that does not work from forks.
   */
  readonly repoOverrides: Readonly<Record<string, string>>;
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
/**
 * Read a top-level YAML list — both the block form and the inline form:
 *
 *   env_branches:        env_branches: [uat, sit]
 *     - uat
 *     - sit
 *
 * Kept as narrow as the scalar reader beside it: this file parses org-config in-process precisely so the
 * CLI needs no YAML dependency, and a general parser is not what is being asked for.
 */
function readTopLevelList(text: string, key: string): string[] {
  const clean = (v: string): string => v.trim().replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "").trim();
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
  if (at === -1) return [];
  const inline = new RegExp(`^${key}:\\s*\\[(.*)\\]`).exec(lines[at]!);
  if (inline) return inline[1]!.split(",").map(clean).filter(Boolean);
  const out: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (/^\S/.test(line)) break;                       // dedent → end of the block
    const m = /^\s+-\s*(.+)$/.exec(line);
    if (m) out.push(clean(m[1]!));
    else if (line.trim()) break;                       // a non-item under the key → not our list
  }
  return out.filter(Boolean);
}

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
  const envBranches = readTopLevelList(text, "env_branches");
  const repoOverrides = parseRepoOverrides(text);
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
    envBranches,
    repoOverrides,
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
