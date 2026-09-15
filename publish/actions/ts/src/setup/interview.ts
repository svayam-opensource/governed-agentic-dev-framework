// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The adopter's org interview — ONE uninterrupted run of questions, then the work.
 *
 * WHY THIS EXISTS AS ITS OWN STEP. The questions used to be split across three
 * places: two in `foundNewOrg` (organization, repository name), one in
 * `runCreateWorkspace` (the slug), and six more in `runSetup` — with the repository
 * CREATED AND CLONED in the middle of that sequence. An adopter was therefore asked
 * to name a repository, watched it be created, and was then asked six further
 * questions about an organization whose repository already existed. The irreversible
 * act sat in the middle of the reversible ones.
 *
 * Everything here is asked BEFORE anything is created. Until the last answer is in,
 * Ctrl-C costs nothing and leaves nothing behind — which is the property the old
 * order quietly gave away. It also means the answers can be shown back as one block,
 * because by then they are all known.
 *
 * THE ONE CONCESSION TO ORDER (#197). The probe that asks "does this organization
 * already have a governance repository?" needs the organization, and diverting to
 * the joiner path makes every later question pointless. It therefore runs the
 * instant Q3 is answered — the earliest moment it can — which costs two answered
 * questions (the two names) in the case where the adopter should have been joining.
 * Two questions is the price of asking for the human-readable name first; the
 * alternative is opening with a GitHub org id, which is not how anyone describes
 * their own organization.
 */
import type { OrgConfigValues } from "./setup.js";

import {
  nonEmpty, orgSlug as orgSlugRule, emailShape, isoDate,
  branchChoice, parseBranchChoice, branchName, type Validator,
} from "./answers.js";
import { renderOrgChoices, resolveOrgChoice, defaultOrg } from "./org-choice.js";
import { askAgentSelection } from "../cli/agent-selection.js";
import type { ApprovedAgent } from "../config/approved-agents.js";

/** The answers under construction — `OrgConfigValues` is readonly by design. */
type Answers = { -readonly [K in keyof OrgConfigValues]?: OrgConfigValues[K] };


/** Thrown when a prompt cannot get a usable answer — never on a human's typo. */
export class InterviewRefused extends Error {}

export interface InterviewIo {
  /** Ask with a default; return the answer (default when blank). */
  readonly prompt: (question: string, def: string) => Promise<string>;
  readonly print: (line: string) => void;
  /** Derive the full config from what has been answered so far — supplies each default. */
  readonly derive: (partial: Partial<OrgConfigValues>) => OrgConfigValues;
  /**
   * Runs the moment the GitHub organization is known, before any further question.
   * Return false to abandon the interview (the caller has taken over — e.g. diverted
   * to the joiner path). Absent means "carry on".
   */
  readonly afterOrg?: (org: string) => Promise<boolean> | boolean;
  /**
   * Organizations the signed-in GitHub account belongs to, offered at Q3 as a numbered list.
   * A convenience, never a gate — see `org-choice.ts`.
   */
  readonly myOrgs?: () => readonly string[];
  /** Ask the agent-approval question (Q10). Absent = do not ask; the caller asks elsewhere. */
  readonly selectAgents?: boolean;
  readonly color?: boolean;
}

/**
 * Everything the adopter answered, in the shape the setup flow takes it.
 *
 * `agents` rides along with the org-config values because the only place the approved list can
 * be written AND still be committed is inside `createWorkspace` — see the note in main.ts. It
 * is not an org-config key, hence its own type rather than a cast at the call site.
 */
export type SetupPreAnswers = Partial<OrgConfigValues> & { readonly agents?: readonly ApprovedAgent[] };

export interface InterviewResult {
  /** The GitHub organization (Q3). */
  readonly org: string;
  /**
   * The organization's approved agents (Q10), first one default.
   *
   * IN THE INTERVIEW, not after the repository exists. It used to be asked once the clone had
   * landed, which put the single most consequential policy answer in adoption AFTER the point
   * of no return — and left it out of the block that reads every other answer back.
   */
  readonly agents?: readonly ApprovedAgent[];
  /** The governance repository to create (Q4). */
  readonly repo: string;
  /** Every answer, keyed as org-config values, ready to hand to `runSetup` as `existing`. */
  readonly answers: Partial<OrgConfigValues>;
}

const RULE_GITHUB_ORG: Validator = (v) => {
  const t = v.trim();
  if (!t) return "A GitHub organization is required — it is where the repository will be created.";
  if (t.includes("/")) return `'${t}' looks like <organization>/<repository>. Just the organization here — the repository is the next question.`;
  return /^[A-Za-z0-9._-]+$/.test(t) ? null : `'${t}' is not a GitHub organization name (letters, digits, dots, dashes).`;
};

const RULE_REPO: Validator = (v) => {
  const t = v.trim();
  if (!t) return "A repository name is required.";
  return /^[A-Za-z0-9._-]+$/.test(t) ? null : `'${t}' is not a repository name (letters, digits, dots, dashes).`;
};

/**
 * The opening block. Numbered because it makes three separate promises — a repository
 * WILL be created, here is what it is for, and here is why the next few minutes are
 * questions — and prose ran them together into something adopters skipped.
 */
export const INTERVIEW_HEADER: readonly string[] = [
  "================================================================",
  "        Adopting Governance Framework for your organization",
  "================================================================",
  "1. Adopting the framework will create a new repository in your GitHub organization.",
  "2. This repo will hold your policies, your knowledge and a record of every project.",
  "3. You will now be asked for basic information about your organization to properly",
  "   seed this new repo with your organization defaults.",
  "   Nothing is created until the last answer is in — Ctrl-C before then costs nothing.",
  "================================================================",
];

export interface InterviewOutcome {
  readonly repoUrl: string;
  readonly localPath: string;
  readonly configUrl: string;
  readonly projectsPath: string;
}

/**
 * The closing block. Every line names something that now EXISTS, with the address to
 * reach it — because the questions above were abstract and this is the only place the
 * adopter learns where their answers went.
 */
export function interviewSummary(o: InterviewOutcome): readonly string[] {
  return [
    "================================================================",
    "- Thank you. Your new repo with your preferred values is now ready.",
    "- Please note the final configuration being used from below.",
    `1. A new governance repo is created for your organization at ——> ${o.repoUrl}`,
    `2. The new governance repo is created in your local machine at —> ${o.localPath}`,
    `3. Your provided values are captured and stored in your new governance repo at ——> ${o.configUrl}`,
    `4. Your local project workspace is at  ——> ${o.projectsPath}`,
    "================================================================",
  ];
}

/**
 * Ask until the answer is usable. A rejected answer is not a reason to end the
 * command — it is a reason to ask again, having said what was wrong. Bounded, because
 * "ask again" assumes someone is there to answer; a stream that repeats itself is
 * recognised for what it is rather than looped on forever.
 */
async function ask(io: InterviewIo, n: number, question: string, def: string | undefined, rule: Validator, extra: readonly string[] = [], choices: readonly string[] = []): Promise<string> {
  io.print("");
  // ONE STRING, NOT A PRINT PLUS A PROMPT. The question travels WITH the prompt so
  // that whatever is driving the terminal — a person, the e2e `expect` harness, a unit
  // test's stub — identifies it the same way: by reading it. Printing the question and
  // then prompting with a bare "-" splits those two audiences, and only the person can
  // see both halves. The renderer supplies the ` [default]: ` tail.
  // THE LABEL SAYS WHAT KIND OF ANSWER IT WANTS. A bare `-` said only "type here"; a reader
  // could not tell a number from free text, and the offered default was doing double duty as
  // both a suggestion and the only hint about the shape. `Choose [1/2/3] :` and
  // `Enter Value :` name the two kinds, and the default rides inside the value form where it
  // belongs.
  //
  // The default is substituted HERE rather than by the renderer, because the renderer appends
  // its own ` [def]: ` and two sets of brackets on one line is worse than either.
  const fallback = def ?? "";
  const label = choices.length
    ? `Choose [${choices.join("/")}] : `
    : fallback ? `Enter Value [${fallback}] : ` : "Enter Value : ";
  const prompt = `Q${n} - ${question}\n${extra.length ? extra.join("\n") + "\n" : ""}${label}`;
  const MAX_ATTEMPTS = 10;
  let last: string | null = null;
  let repeats = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const raw = ((await io.prompt(prompt, "")) ?? "").trim();
    const answer = raw === "" ? fallback : raw;
    const problem = rule(answer);
    if (!problem) return answer;
    if (answer === last && ++repeats >= 2) {
      throw new InterviewRefused(`Q${n}: the same answer came back three times — ${problem}`);
    }
    if (answer !== last) { last = answer; repeats = 0; }
    io.print(`  ✗ ${problem}`);
  }
  throw new InterviewRefused(`Q${n}: no usable answer after ${MAX_ATTEMPTS} attempts.`);
}

/**
 * Run the nine questions in order. Returns null when `afterOrg` took over.
 *
 * Each default is re-derived from the answers so far, so Q2 can suggest a short name
 * built from Q1's legal name and Q5 can suggest a slug built from Q3's organization.
 * Offering an empty default and then refusing empty is a question that answers itself
 * wrongly (#210).
 */
export async function askOrgInterview(io: InterviewIo): Promise<InterviewResult | null> {
  const a: Answers = {};

  // ENTER STILL STOPS (#192 kept). The old flow let an adopter leave at its first
  // question by pressing Enter; reordering must not quietly take that away, so the
  // escape moves to whatever is now first. It applies ONLY when there is no default
  // to accept — where a default exists, Enter means "yes, that one", which is the
  // whole point of offering it.
  const d0 = io.derive(a);
  if (!d0.orgName) {
    const first = ((await io.prompt(`Q1 - What is full legal name of your organization ?\nEnter Value : `, "")) ?? "").trim();
    if (first === "") return null;
    const bad = nonEmpty("An organization name")(first);
    a.orgName = bad ? await ask(io, 1, "What is full legal name of your organization ?", "", nonEmpty("An organization name")) : first;
  } else {
    a.orgName = await ask(io, 1, "What is full legal name of your organization ?", d0.orgName, nonEmpty("An organization name"));
  }

  const dName = io.derive(a);
  a.orgShortName = await ask(io, 2,
    "What is short name of your organization that you would like to use in headings etc?",
    dName.orgShortName || dName.orgName, nonEmpty("A short display name"));

  // ASKED WITH THE ANSWER ON SCREEN. GitHub knows which organizations this account belongs to,
  // so the common case is a number rather than a recalled identifier. A name that is not on the
  // list is still accepted: the token needs `read:org` to see them all, and an organization that
  // gov cannot see is not thereby the wrong answer.
  const mine = io.myOrgs?.() ?? [];
  const org = resolveOrgChoice(await ask(io, 3,
    "What is the Github Organization ID of your organization? This is where your new governance repo will be created?",
    defaultOrg(mine, io.derive(a).githubOrg),
    (v) => RULE_GITHUB_ORG(resolveOrgChoice(v, mine)),
    renderOrgChoices(mine), mine.map((_, i) => String(i + 1))), mine);
  a.githubOrg = org;

  // THE PROBE, AT THE EARLIEST POSSIBLE MOMENT — see the file header.
  if (io.afterOrg && !(await io.afterOrg(org))) return null;

  const repo = await ask(io, 4,
    "What would you like the name of your new governance repo to be created as ?",
    `${org}-gov`, RULE_REPO);
  a.workspaceRepo = repo;

  const dOrg = io.derive(a);
  a.orgSlug = await ask(io, 5,
    "What would you like the identifier (2-6 chars in uppercase) for your organization? Choose it carefully — it is used\n"
    + "  throughout, including the workspace folder where all governance files live i.e. ~/.gov/<org-id>/…",
    dOrg.orgSlug || org.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase(), orgSlugRule);

  const dSlug = io.derive(a);
  // A CHOICE, not free text: only two answers mean anything here, and a typo
  // produces a branch the rest of the tool looks for and never finds.
  a.defaultBranch = parseBranchChoice(await ask(io, 6,
    "Default branch to be used for production (BaseRef) in your code repository?\n  (1 = main, 2 = master)",
    parseBranchChoice(dSlug.defaultBranch ?? "") === "master" ? "2" : "1", branchChoice, [], ["1", "2"])) ?? "main";

  a.defaultCodeBranch = await ask(io, 7,
    "Default branch to be used for development?", dSlug.defaultCodeBranch, branchName);

  a.policyOwnerEmail = await ask(io, 8,
    "What is policy owner email?", io.derive(a).policyOwnerEmail, emailShape);

  a.policyEffectiveDate = await ask(io, 9,
    "What should be the policy effective date ?", io.derive(a).policyEffectiveDate, isoDate);

  // Q10 — WHICH AGENTS THIS ORGANIZATION ALLOWS.
  //
  // Last, because it is the only answer that is a POLICY rather than a fact about the
  // organization, and because it is the one an adopter most needs the preceding context to
  // answer well. Inside the interview, though: it used to run after the clone, which put the
  // most consequential decision in adoption on the far side of the irreversible step and
  // outside the block that reads every other answer back.
  let agents: readonly ApprovedAgent[] | undefined;
  if (io.selectAgents) {
    io.print("");
    io.print("Q10 - Which AI agents may be used in this organization?");
    const picked = await askAgentSelection({
      prompt: io.prompt,
      print: io.print,
      ...(io.color === undefined ? {} : { color: io.color }),
    });
    if (picked === null) throw new InterviewRefused("Q10: no usable AI agent selection.");
    agents = picked;
  }

  io.print("");
  return { org, repo, answers: a, ...(agents ? { agents } : {}) };
}
