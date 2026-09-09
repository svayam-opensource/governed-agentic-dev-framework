// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The joiner's interview — the counterpart to `interview.ts`, and a much shorter one.
 *
 * WHAT CHANGED, AND WHY IT IS TWO QUESTIONS. The joiner used to be asked for a **clone URL**,
 * with the advice to "ask your governance administrator". That is a question about plumbing put
 * to the person least likely to know the answer, on their first minute with the tool — and it
 * has a shape only someone who already understands the layout can produce.
 *
 * gov can find it instead. The organization is one question, and GitHub already knows which
 * organizations the signed-in account belongs to. The governance repository inside it is the
 * same `probeGovernance` call the adopter path makes at #197, pointed the other way: there it
 * asks "has someone already adopted?" to divert AWAY, here it asks "which repo is it?" to answer
 * the second question before it is asked.
 *
 * So both answers are usually a number or an Enter, and neither requires knowing what a clone
 * URL is. Typing either one by hand still works, for the same reason the org list is offered
 * rather than enforced: an unverified probe must not become a gate.
 */
import { type Validator } from "./answers.js";
import { renderOrgChoices, resolveOrgChoice, defaultOrg } from "./org-choice.js";

/** Thrown when a prompt cannot get a usable answer — never on a human's typo. */
export class JoinRefused extends Error {}

export interface JoinInterviewIo {
  readonly prompt: (question: string, def: string) => Promise<string>;
  readonly print: (line: string) => void;
  /** Organizations the signed-in GitHub account belongs to. Empty when gov cannot tell. */
  readonly myOrgs?: () => readonly string[];
  /**
   * Governance repositories inside `org`, as `owner/repo`. Runs the instant Q1 is answered.
   * Returns null when the probe could not run — which must read as "gov does not know", never
   * as "there are none".
   */
  readonly governanceReposIn?: (org: string) => readonly string[] | null;
}

export interface JoinInterviewResult {
  readonly org: string;
  /** Repository name only, not `owner/repo`. */
  readonly repo: string;
}

const RULE_GITHUB_ORG: Validator = (v) => {
  const t = v.trim();
  if (!t) return "A GitHub organization is required — it is where your governance repo lives.";
  if (t.includes("/")) return `'${t}' looks like <organization>/<repository>. Just the organization here — the repository is the next question.`;
  return /^[A-Za-z0-9._-]+$/.test(t) ? null : `'${t}' is not a GitHub organization name (letters, digits, dots, dashes).`;
};

const RULE_REPO: Validator = (v) => {
  const t = v.trim();
  if (!t) return "A repository name is required.";
  return /^[A-Za-z0-9._-]+$/.test(t) ? null : `'${t}' is not a repository name (letters, digits, dots, dashes).`;
};

/**
 * The opening block. Says what joining DOES before asking for anything, because the joiner's
 * first fear is that they are about to create something in their organization — and they are
 * not; this path only clones.
 */
export const JOIN_HEADER: readonly string[] = [
  "================================================================",
  "        Joining Governance Framework of your organization",
  "================================================================",
  "1. Joining the framework will clone your organization's governance repository in your",
  "   local machine/environment.",
  "2. This repo holds your organization's policies, knowledge and a record of every project.",
  "3. You will now be asked some basic information in order to identify your organization",
  "   and your organization's governance repo.",
  "   Nothing is cloned until both answers are in — Ctrl-C before then costs nothing.",
  "================================================================",
];

export interface JoinOutcome {
  readonly repoUrl: string;
  readonly localPath: string;
  readonly projectsPath: string;
}

/**
 * The closing block. "Cloned to", never "created": the repository already existed, and telling a
 * joiner they created it is the one sentence that could make them think they had done something
 * to their organization.
 */
export function joinSummary(o: JoinOutcome): readonly string[] {
  return [
    "================================================================",
    "- Thank you. Your organization and governance repo in it is now identified.",
    "- Please note the final configuration being used from below.",
    `1. Your organization's governance repo (${o.repoUrl})`,
    `   is cloned to your local machine at ——> ${o.localPath}`,
    `2. Your local project workspace is at  ——> ${o.projectsPath}`,
    "================================================================",
  ];
}

/** Ask until the answer is usable; bounded, so a scripted stdin stops rather than spins. */
async function ask(io: JoinInterviewIo, n: number, question: string, def: string, rule: Validator, extra: readonly string[] = []): Promise<string> {
  io.print("");
  // ONE STRING, NOT A PRINT PLUS A PROMPT (#218). The question travels WITH the prompt so that
  // whatever is driving the terminal — a person, the e2e `expect` harness, a unit stub —
  // identifies it the same way: by reading it. Printing it separately and prompting with a bare
  // "-" splits those audiences, and only the person can see both halves. The renderer supplies
  // the ` [default]: ` tail.
  const prompt = `Q${n} - ${question}\n${extra.length ? extra.join("\n") + "\n" : ""}-`;
  const MAX_ATTEMPTS = 10;
  let last: string | null = null;
  let repeats = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const answer = ((await io.prompt(prompt, def)) ?? "").trim();
    const problem = rule(answer);
    if (!problem) return answer;
    if (answer === last && ++repeats >= 2) throw new JoinRefused(`Q${n}: the same answer came back three times — ${problem}`);
    if (answer !== last) { last = answer; repeats = 0; }
    io.print(`  ✗ ${problem}`);
  }
  throw new JoinRefused(`Q${n}: no usable answer after ${MAX_ATTEMPTS} attempts.`);
}

/**
 * Two questions. Returns null when the joiner pressed Enter at the first with nothing to accept,
 * which is the clean stop the old clone-URL prompt also offered.
 */
export async function askJoinInterview(io: JoinInterviewIo): Promise<JoinInterviewResult | null> {
  const orgs = io.myOrgs?.() ?? [];
  const choices = renderOrgChoices(orgs);
  const Q1 = "What is the Github Organization ID of your organization? This is where all your\n"
    + "organization's repos exists.";
  const orgDefault = defaultOrg(orgs, "");

  // ENTER STILL STOPS, but only where there is nothing to accept. With exactly one organization
  // on the list it becomes the default, and Enter there means "yes, that one" — which is the
  // whole point of having asked GitHub.
  if (!orgDefault) {
    io.print("");
    const q1 = `Q1 - ${Q1}\n${choices.length ? choices.join("\n") + "\n" : ""}-`;
    const first = ((await io.prompt(q1, "")) ?? "").trim();
    if (first === "") return null;
    const picked = resolveOrgChoice(first, orgs);
    const bad = RULE_GITHUB_ORG(picked);
    if (!bad) return askAfterOrg(io, picked);
    io.print(`  ✗ ${bad}`);                        // fall through and ask properly
  }

  const answered = await ask(io, 1, Q1, orgDefault, (v) => RULE_GITHUB_ORG(resolveOrgChoice(v, orgs)), choices);
  return askAfterOrg(io, resolveOrgChoice(answered, orgs));
}

/** Q2, with the probe's answer already in hand. */
async function askAfterOrg(io: JoinInterviewIo, org: string): Promise<JoinInterviewResult | null> {

  // THE PROBE, RUN THE MOMENT THE ORGANIZATION IS KNOWN. Same call the adopter path makes to
  // divert away; here it answers the next question instead of asking it.
  const found = io.governanceReposIn?.(org) ?? null;
  const names = (found ?? []).map((r) => r.split("/")[1] ?? r);

  const extra: string[] = [];
  if (found === null) {
    // SAY NOTHING RATHER THAN GUESS. A probe that could not run must not be reported as "none
    // found" — that would send a joiner to adopt, and a second governance repo forks the policy.
    extra.push("  (gov could not list repositories in this organization — type the name.)");
  } else if (names.length === 1) {
    extra.push(`  Found one governance repository in ${org}: ${names[0]}`);
  } else if (names.length > 1) {
    extra.push(`  ${org} has more than one governance repository — which is yours?`);
    names.forEach((n, i) => extra.push(`    ${i + 1}. ${n}`));
    extra.push("  Answer with a number, or type the name.");
  } else {
    extra.push(`  gov found no governance repository in ${org}.`);
    extra.push("  If nobody has adopted the framework for your organization yet, re-run and choose A.");
  }

  const def = names.length === 1 ? (names[0] as string) : "";
  const answered = await ask(io, 2, "What is the name of your org's governance repo?", def,
    (v) => RULE_REPO(resolveOrgChoice(v, names)), extra);
  const repo = resolveOrgChoice(answered, names);

  io.print("");
  return { org, repo };
}

/** For the caller: what to clone, given the two answers. */
export function cloneTargetFor(r: JoinInterviewResult): { readonly nameWithOwner: string; readonly url: string } {
  const nameWithOwner = `${r.org}/${r.repo}`;
  return { nameWithOwner, url: `https://github.com/${nameWithOwner}.git` };
}
