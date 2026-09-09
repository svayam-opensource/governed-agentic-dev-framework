// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * "Which GitHub organization?" — asked with the answer already on screen where possible.
 *
 * Both interviews ask this: the adopter at Q3, the joiner at Q1. GitHub knows the answer —
 * `gh api user/orgs` lists the organizations the signed-in account belongs to — so asking
 * someone to recall and retype an identifier that is one API call away is a question gov does
 * not need to ask blind.
 *
 * THE LIST IS A CONVENIENCE, NEVER A GATE. `user/orgs` needs the `read:org` scope and returns
 * only what the token can see; an organization can be real, correct, and absent from it. So a
 * name that is not on the list is accepted exactly as before, and an empty list changes nothing
 * about what can be answered. This is the #197 discipline applied to a different probe: an
 * unverified answer says nothing and refuses nothing.
 */

/** Lines offering what GitHub knows, or none at all when it knows nothing. */
export function renderOrgChoices(orgs: readonly string[]): readonly string[] {
  if (orgs.length === 0) return [];
  return [
    "  Your GitHub account belongs to:",
    ...orgs.map((o, i) => `    ${i + 1}. ${o}`),
    "  Answer with a number, or type the organization if it is not listed.",
  ];
}

/**
 * Turn an answer into an organization name.
 *
 * A bare number picks from the list; anything else is taken literally, trimmed. A number
 * OUTSIDE the list is returned untouched rather than rejected — an organization may legitimately
 * be called `42`, and inventing a refusal for a name gov cannot see is how the probe would stop
 * being a convenience and start being a gate.
 */
export function resolveOrgChoice(answer: string, orgs: readonly string[]): string {
  const t = answer.trim();
  if (!/^\d+$/.test(t)) return t;
  const n = Number(t);
  return n >= 1 && n <= orgs.length ? (orgs[n - 1] as string) : t;
}

/**
 * The default to offer.
 *
 * Only when there is exactly ONE organization: a default is a suggestion that Enter accepts, and
 * suggesting the first of several is not a suggestion, it is a coin toss with consequences —
 * the adopter's answer decides where a repository gets created.
 */
export function defaultOrg(orgs: readonly string[], fallback: string): string {
  return orgs.length === 1 ? (orgs[0] as string) : fallback;
}
