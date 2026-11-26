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
 * THREE QUESTIONS, NOT TWELVE (PRJ-121 F158, Policy Owner rulings, 2026-11-25). An adopter is asked only what gov
 * cannot know or safely assume: Q1 the GitHub organization, Q2 the organization's identifier, Q3 its AI agents.
 * Everything else takes a default — the names from the organization's display name on GitHub, the repository
 * `gov_repo`, branches `main` and `dev`, the Policy Owner the signed-in GitHub login, no second person (the
 * practice project asks to invite one), no contact email, soft posture — and every value, asked or not, is
 * printed back before anything is created, with where to change it later.
 *
 * THE PROBE RUNS THE INSTANT Q1 IS ANSWERED (#197): "does this organization already have a governance
 * repository?" needs only the organization, and diverting to the joiner path makes every later question
 * pointless. With the organization first, a would-be joiner answers nothing else.
 */
import type { OrgConfigValues } from "./setup.js";

import { orgSlug as orgSlugRule, type Validator } from "./answers.js";
import { renderOrgChoices, resolveOrgChoice, defaultOrg } from "./org-choice.js";
import { askAgentSelection, namesSentence, DEFAULT_AGENT_QUESTION } from "../cli/agent-selection.js";
import type { PickerTerminal } from "../cli/picker.js";
import type { ApprovedAgent } from "../config/approved-agents.js";

/** The answers under construction — `OrgConfigValues` is readonly by design. */
type Answers = { -readonly [K in keyof OrgConfigValues]?: OrgConfigValues[K] };


/** Thrown when a prompt cannot get a usable answer — never on a human's typo. */
export class InterviewRefused extends Error {}

/**
 * Thrown when the interview stops on a FACT, not a missing answer — `gov_repo` taken, nobody signed in (F158).
 * Re-running interactively would not help, so the caller says what to change instead.
 */
export class InterviewStopped extends InterviewRefused {}

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
  /**
   * The organization's display name on GitHub (`gh api orgs/<org> --jq .name`, or `users/<login>` for a personal
   * account) — the default for org_name and org_short_name. Null or empty = unknown; the login is used instead.
   */
  readonly orgDisplayName?: (org: string) => string | null;
  /**
   * Runs once the organization is known and found NOT governed: may `gov_repo` be created there? Returns null when
   * it may, or the lines that say why not (a repository of that name exists and is not a failed run of setup).
   */
  readonly checkRepoName?: (org: string, repo: string) => readonly string[] | null;
  /** Ask the agent-approval question (Q3). Absent = do not ask; the caller asks elsewhere. */
  readonly selectAgents?: boolean;
  readonly color?: boolean;
  /**
   * The terminal Q3's picker may take for arrow keys (F158, ruling Q12 A). Absent = the numbered form, which is
   * also what the picker falls back to on its own wherever arrows cannot run (see picker.ts).
   */
  readonly terminal?: PickerTerminal | null;
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
  /** The GitHub organization (Q1). */
  readonly org: string;
  /**
   * The organization's approved agents (Q3), first one default.
   *
   * IN THE INTERVIEW, not after the repository exists. It used to be asked once the clone had
   * landed, which put the single most consequential policy answer in adoption AFTER the point
   * of no return — and left it out of the block that reads every other answer back.
   */
  readonly agents?: readonly ApprovedAgent[];
  /** The governance repository to create — always {@link NEW_GOV_REPO} for a new organization (F158). */
  readonly repo: string;
  /** Every answer, keyed as org-config values, ready to hand to `runSetup` as `existing`. */
  readonly answers: Partial<OrgConfigValues>;
}

const RULE_GITHUB_ORG: Validator = (v) => {
  const t = v.trim();
  if (!t) return "A GitHub organization is required — it is where the repository will be created.";
  if (t.includes("/")) return `'${t}' looks like <organization>/<repository>. Just the organization here — gov names the repository itself.`;
  return /^[A-Za-z0-9._-]+$/.test(t) ? null : `'${t}' is not a GitHub organization name (letters, digits, dots, dashes).`;
};

/** The governance repository every NEW organization gets (F158). Existing organizations keep theirs. */
export const NEW_GOV_REPO = "gov_repo";

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
async function ask(io: InterviewIo, n: number, question: string, def: string | undefined, rule: Validator, extra: readonly string[] = [], choices: readonly string[] = [], defaultName?: string): Promise<string> {
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
  //
  // A NUMBERED QUESTION SAYS WHAT ENTER DOES (adoption walk #3, 2026-10-07). `Choose [1/2] :` hid that "1" was the
  // default, so the one keystroke most people press was the one nobody was told about. The default is printed on
  // every choice, with the option it stands for when the number alone does not say ("1, soft").
  const fallback = def ?? "";
  const enter = fallback ? ` (Enter = ${fallback}${defaultName ? `, ${defaultName}` : ""})` : "";
  const label = choices.length
    ? `Choose [${choices.join("/")}]${enter} : `
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

/** One value the interview settled, as the summary prints it. */
export interface SettledValue {
  readonly what: string;
  readonly value: string;
  /** Asked, or taken as a default. */
  readonly asked: boolean;
  /** The file a pull request changes it in. */
  readonly file: "org-config.yaml" | "policies/governance.yaml";
}

/**
 * Every value used, asked and defaulted, before the irreversible step — and where each one is changed later.
 * Pure, so the block is tested as text.
 */
export function settledSummary(values: readonly SettledValue[]): readonly string[] {
  const w = Math.max(...values.map((v) => v.what.length));
  return [
    "",
    "================================================================",
    "  These are the values your new governance repo will be set up with:",
    "",
    ...values.map((v) => `  ${v.what.padEnd(w)}  ${v.value || "(none)"}   (${v.asked ? "your answer" : "default"} · ${v.file})`),
    "",
    "  Any of these can be changed later by a pull request to the file named beside it",
    "  (org-config.yaml or policies/governance.yaml).",
    "================================================================",
  ];
}

/**
 * Run the questions in order. Returns null when `afterOrg` took over, or Enter was pressed at Q1 with no default.
 *
 * Q2's default is re-derived from Q1's organization (#210): offering an empty default and then refusing empty is a
 * question that answers itself wrongly.
 */
export async function askOrgInterview(io: InterviewIo): Promise<InterviewResult | null> {
  const a: Answers = {};

  // Q1 — THE GITHUB ORGANIZATION, ASKED WITH THE ANSWER ON SCREEN. GitHub knows which organizations this account
  // belongs to, so the common case is a number rather than a recalled identifier. A name that is not on the list is
  // still accepted: the token needs `read:org` to see them all.
  const mine = io.myOrgs?.() ?? [];
  const orgDefault = defaultOrg(mine, io.derive(a).githubOrg);
  const Q1 = "What is the GitHub organization where your new governance repo will be created?";
  // ENTER STILL STOPS (#192 kept) — at whatever question is first, and only when there is no default to accept.
  let orgAnswer: string;
  if (!orgDefault) {
    const choices = renderOrgChoices(mine);
    const first = ((await io.prompt(`Q1 - ${Q1}\n${choices.length ? choices.join("\n") + "\n" : ""}Enter Value : `, "")) ?? "").trim();
    if (first === "") return null;
    const bad = RULE_GITHUB_ORG(resolveOrgChoice(first, mine));
    if (bad) io.print(`  ✗ ${bad}`);
    orgAnswer = bad
      ? await ask(io, 1, Q1, "", (v) => RULE_GITHUB_ORG(resolveOrgChoice(v, mine)), choices, mine.map((_, i) => String(i + 1)))
      : first;
  } else {
    orgAnswer = await ask(io, 1, Q1, orgDefault, (v) => RULE_GITHUB_ORG(resolveOrgChoice(v, mine)),
      renderOrgChoices(mine), mine.map((_, i) => String(i + 1)));
  }
  const org = resolveOrgChoice(orgAnswer, mine);
  a.githubOrg = org;

  // THE PROBE, AT THE EARLIEST POSSIBLE MOMENT — see the file header.
  if (io.afterOrg && !(await io.afterOrg(org))) return null;

  // THE REPOSITORY IS NOT ASKED: every new organization's is `gov_repo`. A repository of that name that is not a
  // governance repo (the probe above found none) is refused, never written over.
  const repo = NEW_GOV_REPO;
  const refused = io.checkRepoName?.(org, repo);
  if (refused) throw new InterviewStopped(refused.join("\n"));
  a.workspaceRepo = repo;

  // THE NAMES ARE NOT ASKED: GitHub's display name for the organization, or its login.
  const display = (io.orgDisplayName?.(org) ?? "").trim() || org;
  a.orgName = display;
  a.orgShortName = display;

  // Q2 — THE IDENTIFIER. Asked, because it names the workspace folder and every rule id, and cannot be changed
  // cheaply afterwards.
  const dOrg = io.derive(a);
  a.orgSlug = await ask(io, 2,
    "What would you like the identifier (2-6 chars in uppercase) for your organization? Choose it carefully — it is used\n"
    + "  throughout, including the workspace folder where all governance files live i.e. ~/.gov/<org-id>/…",
    dOrg.orgSlug || org.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase(), orgSlugRule);

  // NOT ASKED — the defaults the rulings set (F158). Each is in the summary below, with where to change it.
  a.defaultBranch = "main";
  a.defaultCodeBranch = "dev";
  // The Policy Owner is whoever is signed in to GitHub and running setup. With nobody signed in there is no honest
  // default, and setup would refuse later anyway — so refuse now, before anything is created.
  const owner = io.derive(a).policyOwnerGithub ?? "";
  if (!owner.replace(/^@+/, "").trim()) {
    throw new InterviewStopped("Could not tell who is signed in to GitHub, so there is no Policy Owner to record. Sign in with `gh auth login`, then re-run `gov`.");
  }
  a.policyOwnerGithub = owner;
  a.checkOwnerGithub = owner;            // no second person yet: the Policy Owner holds Check Owner (Q44 A)
  a.policyOwnerEmail = "";               // no contact email is written
  a.governancePosture = "soft";

  // Q3 — WHICH AGENTS THIS ORGANIZATION ALLOWS. A single-select for the default, then a multi-select for the others,
  // through the one shared picker (F158, ruling Q12 A). The only answer that is a POLICY rather than a fact.
  let agents: readonly ApprovedAgent[] | undefined;
  if (io.selectAgents) {
    io.print("");
    io.print(`Q3 - ${DEFAULT_AGENT_QUESTION}`);
    const picked = await askAgentSelection({
      prompt: io.prompt,
      print: io.print,
      ...(io.color === undefined ? {} : { color: io.color }),
      ...(io.terminal ? { terminal: io.terminal } : {}),
    });
    if (picked === null) throw new InterviewRefused("Q3: no usable AI agent selection.");
    agents = picked;
  }

  for (const l of settledSummary([
    { what: "GitHub organization", value: org, asked: true, file: "org-config.yaml" },
    { what: "Organization identifier", value: a.orgSlug, asked: true, file: "org-config.yaml" },
    { what: "Organization name", value: a.orgName, asked: false, file: "org-config.yaml" },
    { what: "Short name", value: a.orgShortName, asked: false, file: "org-config.yaml" },
    { what: "Governance repository", value: `${org}/${repo}`, asked: false, file: "org-config.yaml" },
    { what: "Production branch", value: a.defaultBranch, asked: false, file: "org-config.yaml" },
    { what: "Development branch", value: a.defaultCodeBranch, asked: false, file: "org-config.yaml" },
    { what: "Policy Owner", value: owner, asked: false, file: "policies/governance.yaml" },
    { what: "Check Owner", value: `${owner} (the Policy Owner, until you name a second person)`, asked: false, file: "policies/governance.yaml" },
    { what: "Policy Owner contact email", value: "", asked: false, file: "policies/governance.yaml" },
    { what: "Governance posture", value: "soft", asked: false, file: "policies/governance.yaml" },
    ...(agents ? [{ what: "AI agents", value: namesSentence(agents), asked: true, file: "policies/governance.yaml" as const }] : []),
  ])) io.print(l);

  io.print("");
  return { org, repo, answers: a, ...(agents ? { agents } : {}) };
}
