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

/**
 * NOTE (#159 finding 4, client-configuration-contract R1): setup no longer asks for Vault, OIDC or the
 * governance account id. `gov` reads none of them — they belong to `gov-cicd`/`gov-infra`, and asking
 * the free work-tier adopter about modules they have not adopted is the defect. The keys are still
 * READ when present, so existing workspaces are unaffected; they are simply no longer prompted for.
 */
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
  // NO NEXT-STEPS BLOCK HERE. `gov setup <org>/<repo>` now registers, commits and pushes on the
  // adopter's behalf and prints one manifest of what it did (#159 findings 6a/6b/6d) — this block used to
  // instruct the adopter to run `gov org add`, immediately AFTER the CLI had already done it. Two
  // instructions for one already-completed action. Bare `gov setup` (configure-in-place) needs no
  // next-steps block either: nothing was created to explain.
  return 0;
}
