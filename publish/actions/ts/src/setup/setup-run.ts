// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov setup` runner — gathers answers (interactive prompts, injected so this is
 * testable), derives the full config, writes org-config.yaml, and points origin
 * at the org repo. The pure render/derive live in setup.ts.
 */
import { confirmPosture, parsePostureAnswer, postureRule, POSTURE_QUESTION } from "./posture-question.js";
import * as path from "node:path";
import type { Fs } from "../lifecycle/fs-io.js";
import { deriveOrgConfig, renderOrgConfig, renderSetupGovernance, withSetupGovernance, type OrgConfigValues, type SetupContext } from "./setup.js";
import { defaultWorkRoot } from "../config/org-config.js";
import { parseAuthorizedAgents, readAuthorizedAgents, withAuthorizedAgents } from "../config/approved-agents.js";
import { GOVERNANCE_PATH } from "../config/governance.js";
import { nonEmpty, orgSlug as orgSlugRule, githubHandle, isReservedSlug, optionalEmail, parseOptionalEmail, branchChoice, parseBranchChoice, branchName, type Validator } from "./answers.js";

export interface SetupIo {
  readonly fs: Fs;
  readonly cwd: string;
  readonly originUrl: string;
  readonly ghUser: string | null;
  readonly gitEmail: string | null;
  readonly today: string;
  readonly existing?: Partial<OrgConfigValues>;
  /**
   * Did the org interview already ask everything (adopter path)? Set ONLY by that path.
   *
   * It cannot be inferred from `existing` being populated: a bare `gov setup` re-run in
   * a configured repo populates `existing` too, and there the values are DEFAULTS to be
   * offered, not answers to be skipped. Conflating the two would silently turn
   * reconfiguration into a no-op.
   */
  readonly interviewed?: boolean;
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

/**
 * A re-run must not drop agents the org already authorized: the `authorized_agents` block from governance.yaml, else
 * from an org-config.yaml that predates the split. Null when neither has one.
 */
function existingAgents(governanceText: string | null, orgConfigText: string | null): ReturnType<typeof parseAuthorizedAgents> {
  return parseAuthorizedAgents(governanceText) ?? parseAuthorizedAgents(orgConfigText);
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

  // ALREADY ANSWERED? The adopter path runs the whole interview (setup/interview.ts)
  // BEFORE anything is created and hands the answers down as `existing`. A question
  // re-asked here would invite a second, different answer to a settled fact, with
  // nothing reconciling the two — the defect #192 fixed for the slug alone, which
  // applies identically to every other value once the interview owns them all.
  //
  // Bare `gov setup` (configure-in-place) supplies none of these and is unchanged:
  // it still asks, in this order, exactly as before.
  const known = <K extends keyof OrgConfigValues>(k: K): string | null => {
    if (io.interviewed !== true) return null;      // defaults, not answers — see `interviewed`
    const v = io.existing?.[k];
    return typeof v === "string" && v !== "" ? v : null;
  };

  // Did the interview already run? Then these echo lines are noise: the closing
  // summary block reports every one of these values, with addresses.
  const interviewed = io.interviewed === true;

  if (interactive) {
    const d0 = deriveOrgConfig({}, ctx);
    answers.orgName = known("orgName")
      ?? await askValid(io, "Full legal name of your organization", d0.orgName, nonEmpty("An organization name"));
    // Re-derive after the legal name so the short name has a default worth
    // accepting. Offering an empty default and then refusing empty is a question
    // that answers itself wrongly.
    const dName = deriveOrgConfig(answers, ctx);
    answers.orgShortName = known("orgShortName")
      ?? await askValid(io, "Short display name (used in headings)", dName.orgShortName || dName.orgName, nonEmpty("A short display name"));
    // ASKED ONCE (#192). `gov setup <org>/<repo>` already asks for the slug — it has
    // to, because the slug decides where the workspace is created, before anything
    // exists. Asking again here invited a second, different answer to a question
    // already settled, with nothing reconciling the two.
    if (io.existing?.orgSlug) {
      answers.orgSlug = io.existing.orgSlug;
      if (!interviewed) io.print(`  Org slug                         ${answers.orgSlug}`);
    } else {
      answers.orgSlug = await askValid(io, "Org slug (uppercase, 2-6 chars; e.g. ACME)", d0.orgSlug, orgSlugRule);
    }
    // Re-derive so path/owner defaults reflect the just-entered slug + email.
    const d1 = deriveOrgConfig(answers, ctx);
    if (!interviewed) io.print(`  github_org:     ${d1.githubOrg}  (from origin)`);
    if (!interviewed) io.print(`  org_gov_repo:   ${d1.workspaceRepo}  (from origin)`);
    // A CHOICE, not free text (#192): only two answers mean anything here, and a
    // typo produces a branch the rest of the tool looks for and never finds.
    const branchDefault = parseBranchChoice(d1.defaultBranch) === "master" ? "2" : "1";
    answers.defaultBranch = known("defaultBranch") ?? parseBranchChoice(
      await askValid(io, "Default branch for all repositories (1 = main, 2 = master)", branchDefault, branchChoice),
    ) ?? "main";
    // Reworded: the old "Default base branch for code repositories" read as "the
    // base branch OF code repositories", which is not what it means.
    answers.defaultCodeBranch = known("defaultCodeBranch") ?? await askValid(
      io, "Default branch in code repositories to be used for development", d1.defaultCodeBranch, branchName,
    );
    // NOT ASKED (#192). It is derived from the org slug, and a different answer
    // produces a layout nothing else in the tool expects — the three-way
    // disagreement fixed in #186 came from exactly this value being settable in one
    // place and derived in another. Told, not asked.
    if (!interviewed) io.print(`  Project workspaces will live in  ${defaultWorkRoot(d1.orgSlug)}  (yours to change: ~/.gov/work-roots)`);
    // BOTH ROLES BY HANDLE, THEN AN OPTIONAL CONTACT (Policy Owner, 2026-10-07 — adoption walk #1). The Policy
    // Owner's handle used to be TOLD, taken from whoever was signed in to gh, while the email was asked: the one
    // answer that decides who approves every policy was the one nobody was asked for. The signed-in user is the
    // default now, not the answer.
    answers.policyOwnerGithub = known("policyOwnerGithub") ?? await askValid(io,
      "Policy Owner GitHub handle (approves your policies, and holds every role nobody else holds)",
      deriveOrgConfig(answers, ctx).policyOwnerGithub, githubHandle);
    // The Policy Owner is offered because a one-person org is the common first case — and doctor says so when it is
    // accepted.
    answers.checkOwnerGithub = known("checkOwnerGithub") ?? await askValid(io,
      "Check Owner GitHub handle (reviews the code of your check actions in policies/actions/)",
      deriveOrgConfig(answers, ctx).checkOwnerGithub, githubHandle);
    // OPTIONAL: a contact the policies show, not the role. `none` leaves it empty. An interviewed answer may be
    // empty on purpose, so it is taken as given rather than through `known` (which reads empty as "not answered").
    answers.policyOwnerEmail = interviewed && io.existing?.policyOwnerEmail !== undefined
      ? io.existing.policyOwnerEmail
      : parseOptionalEmail(await askValid(io, "Policy Owner contact email for your policies (optional — `none` for no email)",
          deriveOrgConfig(answers, ctx).policyOwnerEmail, optionalEmail));
    // W2-Q6: soft unless hard is chosen past the confirmation.
    answers.governancePosture = known("governancePosture") ?? await confirmPosture(
      parsePostureAnswer(await askValid(io, POSTURE_QUESTION, "1", postureRule)) ?? "soft", io.prompt);
    // NOT MENTIONED HERE (#192). Service endpoints are org-level values the deploy
    // clients read (gov-cicd, gov-infra); gov-work needs none of them. Announcing a
    // heading for a section that then asks nothing left an adopter waiting for a
    // question that never came, about products they have not adopted.
  }

  const v = deriveOrgConfig(answers, ctx);
  if (!v.orgName || !v.orgSlug) {
    io.print("setup: org_name and org_slug are required (run interactively, or pre-fill org-config.yaml).");
    return 1;
  }
  // Checked here as well as at the prompt: a pre-filled org-config.yaml or a non-interactive run never meets it.
  if (isReservedSlug(v.orgSlug)) {
    io.print(`setup: org_slug '${v.orgSlug}' is reserved for the framework — its own rules are numbered GOV-FRM-NNN. Choose another.`);
    return 1;
  }
  // THE CHECK OWNER MUST BE ASSIGNED (rule-model P1 rulings). Vacancy is a state an UPGRADED org may be in — the
  // key arrives empty and CODEOWNERS escalates to the Policy Owner — but an org set up now is asked, and leaves
  // with somebody named.
  if (!v.checkOwnerGithub.replace(/^@+/, "").trim()) {
    io.print(`setup: check_owner.github is empty — name who reviews the code of your check actions (policies/actions/).`);
    io.print(`  It defaults to the Policy Owner; with no Policy Owner handle either, run interactively or pre-fill ${GOVERNANCE_PATH}.`);
    return 1;
  }
  // THE POLICY OWNER MUST BE ASSIGNED (GOV-FRM-033). Every approval, every vacant role and CODEOWNERS itself fall
  // back to this one handle; an org set up without it has nobody to approve anything.
  if (!v.policyOwnerGithub.replace(/^@+/, "").trim()) {
    io.print("setup: policy_owner.github is empty — name the Policy Owner, who approves your policies and holds every vacant role.");
    io.print(`  It is derived from your GitHub login; with none signed in, run interactively or pre-fill ${GOVERNANCE_PATH}.`);
    return 1;
  }

  const configPath = path.join(io.cwd, "org-config.yaml");
  const governancePath = path.join(io.cwd, GOVERNANCE_PATH);
  // Read BEFORE either file is rewritten: an org-config that predates the split still holds the agents.
  const governanceText = io.fs.readFile(governancePath);
  const keptAgents = existingAgents(governanceText, io.fs.readFile(configPath));
  io.fs.writeFile(configPath, renderOrgConfig(v));
  io.print(`Wrote ${configPath}`);
  // THE GOVERNANCE CHOICES, beside the policy they configure (org-config split, 2026-10-06). The agents are added
  // afterwards by whoever asked for them (the adopter path records Q12's answer just before the commit).
  //
  // GOV-FRM-445: an existing governance.yaml is the ORG'S. It is never re-rendered — that dropped the org's models
  // block and every key gov does not read (adopter-e2e live tier, 2026-10-07). Setup edits only its own keys where its
  // answer differs, and fills the agent list only when the file leaves it unset. Absent: seeded from the answers.
  const withAgents = (text: string): string =>
    keptAgents !== null && readAuthorizedAgents(text).kind === "unset" ? withAuthorizedAgents(text, keptAgents) ?? text : text;
  const next = governanceText === null ? withAgents(renderSetupGovernance(v)) : withAgents(withSetupGovernance(governanceText, v));
  if (next !== governanceText) {
    io.fs.writeFile(governancePath, next);
    io.print(`Wrote ${governancePath}`);
  } else {
    io.print(`Kept ${governancePath} — it already says what setup would write`);
  }
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
