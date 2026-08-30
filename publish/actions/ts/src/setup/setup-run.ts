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
import { nonEmpty, orgSlug as orgSlugRule, emailShape, isoDate, branchChoice, parseBranchChoice, branchName, type Validator } from "./answers.js";

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
/** Thrown when a prompt cannot get a usable answer — never on a human's typo. */
export class AnswerRefused extends Error {}

/**
 * Ask until the answer is usable (#192). A rejected answer is not a reason to end
 * the command — it is a reason to ask again, having said what was wrong. The only
 * way out is Ctrl-C, which is the user's to press.
 */
async function askValid(io: SetupIo, question: string, def: string, rule: Validator): Promise<string> {
  // BOUNDED, because "ask again" assumes someone is there to answer. Against a
  // closed or scripted stdin the same rejected value comes back forever, and an
  // unbounded loop is not patience — it is a hang, and it took the test suite out
  // of memory before it took anyone's terminal.
  //
  // A human gets as many attempts as they will plausibly use; a stream that repeats
  // itself is recognised for what it is and the command stops with a reason.
  const MAX_ATTEMPTS = 10;
  let last: string | null = null;
  let repeats = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const answer = (await io.prompt(question, def)).trim();
    const problem = rule(answer);
    if (!problem) return answer;
    if (answer === last && ++repeats >= 2) {
      throw new AnswerRefused(`${question}: the same answer came back three times — ${problem}`);
    }
    if (answer !== last) { last = answer; repeats = 0; }
    io.print(`  ✗ ${problem}`);
  }
  throw new AnswerRefused(`${question}: no usable answer after ${MAX_ATTEMPTS} attempts.`);
}

export async function runSetup(io: SetupIo, interactive: boolean): Promise<number> {
  try {
    return await runSetupInner(io, interactive);
  } catch (e) {
    if (e instanceof AnswerRefused) {
      io.print(`setup: ${e.message}`);
      io.print("Nothing was written. Re-run `gov setup` when you can answer interactively.");
      return 1;
    }
    throw e;
  }
}

async function runSetupInner(io: SetupIo, interactive: boolean): Promise<number> {
  const ctx: SetupContext = { originUrl: io.originUrl, ghUser: io.ghUser, gitEmail: io.gitEmail, today: io.today, existing: io.existing };
  const answers: Partial<Record<keyof OrgConfigValues, string>> = {};

  if (interactive) {
    const d0 = deriveOrgConfig({}, ctx);
    answers.orgName = await askValid(io, "Full legal name of your organization", d0.orgName, nonEmpty("An organization name"));
    // Re-derive after the legal name so the short name has a default worth
    // accepting. Offering an empty default and then refusing empty is a question
    // that answers itself wrongly.
    const dName = deriveOrgConfig(answers, ctx);
    answers.orgShortName = await askValid(io, "Short display name (used in headings)", dName.orgShortName || dName.orgName, nonEmpty("A short display name"));
    answers.orgSlug = await askValid(io, "Org slug (uppercase, 2-6 chars; e.g. ACME)", d0.orgSlug, orgSlugRule);
    // Re-derive so path/owner defaults reflect the just-entered slug + email.
    const d1 = deriveOrgConfig(answers, ctx);
    io.print(`  github_org:     ${d1.githubOrg}  (from origin)`);
    io.print(`  workspace_repo: ${d1.workspaceRepo}  (from origin)`);
    // A CHOICE, not free text (#192): only two answers mean anything here, and a
    // typo produces a branch the rest of the tool looks for and never finds.
    const branchDefault = parseBranchChoice(d1.defaultBranch) === "master" ? "2" : "1";
    answers.defaultBranch = parseBranchChoice(
      await askValid(io, "Default branch for all repositories (1 = main, 2 = master)", branchDefault, branchChoice),
    ) ?? "main";
    // Reworded: the old "Default base branch for code repositories" read as "the
    // base branch OF code repositories", which is not what it means.
    answers.defaultCodeBranch = await askValid(
      io, "Default branch in code repositories to be used for development", d1.defaultCodeBranch, branchName,
    );
    // NOT ASKED (#192). It is derived from the org slug, and a different answer
    // produces a layout nothing else in the tool expects — the three-way
    // disagreement fixed in #186 came from exactly this value being settable in one
    // place and derived in another. Told, not asked.
    io.print(`  Project workspaces will live in  ${d1.agentWorkRoot}`);
    answers.policyOwnerEmail = await askValid(io, "Policy Owner email", d1.policyOwnerEmail, emailShape);
    // NOT ASKED either. The email above identifies a GitHub account; the handle is
    // a lookup, not an opinion. Asking invited an answer that disagreed with the
    // email above it, and nothing downstream reconciled the two.
    const derivedHandle = deriveOrgConfig(answers, ctx).policyOwnerGithub;
    if (derivedHandle) io.print(`  Policy Owner GitHub handle       ${derivedHandle}`);
    answers.policyEffectiveDate = await askValid(io, "Policy effective date (YYYY-MM-DD)", d1.policyEffectiveDate, isoDate);
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
