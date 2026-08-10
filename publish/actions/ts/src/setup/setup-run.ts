// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov setup` runner — gathers answers (interactive prompts, injected so this is
 * testable), derives the full config, writes org-config.yaml, and points origin
 * at the org repo. The pure render/derive live in setup.ts.
 */
import * as path from "node:path";
import type { Fs } from "../lifecycle/fs-io.js";
import { deriveOrgConfig, renderOrgConfig, type OrgConfigValues, type SetupContext } from "./setup.js";

export interface SetupIo {
  readonly fs: Fs;
  readonly cwd: string;
  readonly originUrl: string;
  readonly ghUser: string | null;
  readonly gitEmail: string | null;
  readonly today: string;
  readonly existing?: Partial<OrgConfigValues>;
  /** Ask a question with a default; return the answer (default if blank). Injected. */
  readonly prompt: (question: string, def: string) => Promise<string>;
  readonly print: (line: string) => void;
  /** Configure the origin remote (git remote set-url/add). Optional. */
  readonly setOriginRemote?: (url: string) => void;
}

export async function runSetup(io: SetupIo, interactive: boolean): Promise<number> {
  const ctx: SetupContext = { originUrl: io.originUrl, ghUser: io.ghUser, gitEmail: io.gitEmail, today: io.today, existing: io.existing };
  const answers: Partial<Record<keyof OrgConfigValues, string>> = {};

  if (interactive) {
    const d0 = deriveOrgConfig({}, ctx);
    answers.orgName = await io.prompt("Full legal name of your organization", d0.orgName);
    answers.orgShortName = await io.prompt("Short display name (used in headings)", d0.orgShortName);
    answers.orgSlug = await io.prompt("Org slug (uppercase, 2-6 chars; e.g. ACME)", d0.orgSlug);
    // Re-derive so path/owner defaults reflect the just-entered slug + email.
    const d1 = deriveOrgConfig(answers, ctx);
    io.print(`  github_org:     ${d1.githubOrg}  (from origin)`);
    io.print(`  workspace_repo: ${d1.workspaceRepo}  (from origin)`);
    answers.defaultBranch = await io.prompt("Default branch for this workspace repo", d1.defaultBranch);
    answers.defaultCodeBranch = await io.prompt("Default base branch for code repositories", d1.defaultCodeBranch);
    answers.agentWorkRoot = await io.prompt("Agent work root path", d1.agentWorkRoot);
    answers.policyOwnerEmail = await io.prompt("Policy Owner email", d1.policyOwnerEmail);
    answers.policyOwnerGithub = await io.prompt("Policy Owner GitHub @-handle", d1.policyOwnerGithub);
    answers.policyEffectiveDate = await io.prompt("Policy effective date (YYYY-MM-DD)", d1.policyEffectiveDate);
    // Org service endpoints (ORG-LEVEL, inherited by adopters). Prompt the CORE ones gov-work uses; the
    // deploy endpoints (jenkins/npm/docker) are added later as the org adopts gov-cicd. Blank is fine.
    io.print("  Service endpoints — shared org infrastructure (adopters inherit these):");
    answers.vaultAddr = await io.prompt("  Vault/OpenBao base URL (blank if none)", d1.vaultAddr);
    answers.oidcBase = await io.prompt("  IAM OIDC base URL for the deploy clients' `auth login` (blank if none)", d1.oidcBase);
    answers.govAccount = await io.prompt("  Governance account id (blank = single-tenant)", d1.govAccount);
  }

  const v = deriveOrgConfig(answers, ctx);
  if (!v.orgName || !v.orgSlug) {
    io.print("setup: org_name and org_slug are required (run interactively, or pre-fill org-config.yaml).");
    return 1;
  }

  const configPath = path.join(io.cwd, "org-config.yaml");
  io.fs.writeFile(configPath, renderOrgConfig(v));
  io.print(`Wrote ${configPath}`);
  if (io.setOriginRemote && v.orgRepoUrl) {
    io.setOriginRemote(v.orgRepoUrl);
    io.print(`Set origin → ${v.orgRepoUrl}`);
  }
  io.print("");
  io.print("Next steps:");
  io.print(`  gov org add ${v.githubOrg} ${v.govWorkspace}   # register this gov workspace`);
  io.print(`  gov org use ${v.githubOrg}                      # make it the active org`);
  return 0;
}
