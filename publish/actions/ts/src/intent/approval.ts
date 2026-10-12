// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WHAT "APPROVED" MEANS TO gov (PRJ-121 intent 03, D2, ruling Q2).
 *
 * An artifact is approved when its change request is MERGED and carries an approving review from a PERSON — a
 * human account on the code host, read through {@link VcsPort}. An agent can write text; it cannot approve a review
 * as a person. So a Status line saying APPROVED is a CLAIM: gov follows its change request link and checks the
 * host. No link, an unmerged change request, or only bot approvals → not approved, with the reason.
 *
 * Each reviewer counts by their LATEST verdict, ordered by time. "pending" (not submitted) and "commented" (a
 * remark, as the host itself treats it) do not change a verdict; a later "changes-requested" or "dismissed" does.
 *
 * Q8: who may approve at each gate is the policy's Gates section; a caller that knows it passes `approvers`.
 *
 * On merge, gov writes the Status line — `**Status: APPROVED by <login> <yyyy-mm-dd> (<CR url>)**` — in place.
 */
import { ok, type Result } from "../ports/result.js";
import type { ChangeRequestRef, Review, VcsPort } from "../ports/vcs.js";
import { statusOf } from "./lifecycle-policy.js";
import { replaceStatusLine } from "./status.js";

export type Approval =
  | { readonly approved: true; readonly by: string; readonly at: string; readonly url: string }
  | { readonly approved: false; readonly reason: string };

export interface ApprovalOptions {
  /** Q8: only these logins count (the policy's Gates section). Omitted → any person. */
  readonly approvers?: readonly string[];
}

/** Each reviewer's latest deciding verdict (pending and commented reviews decide nothing). */
export function latestVerdicts(reviews: readonly Review[]): Review[] {
  const deciding = reviews
    .filter((r) => r.verdict !== "pending" && r.verdict !== "commented")
    .map((r, i) => ({ r, i, t: Date.parse(r.at) }))
    .sort((a, b) => (Number.isNaN(a.t) || Number.isNaN(b.t) || a.t === b.t ? a.i - b.i : a.t - b.t));
  const latest = new Map<string, Review>();
  for (const { r } of deciding) latest.set(r.by.toLowerCase(), r);
  return [...latest.values()];
}

/** Is the change request merged with a person's approving review? A host that cannot answer is a failed Result. */
export async function approvalOf(vcs: VcsPort, ref: ChangeRequestRef, opts: ApprovalOptions = {}): Promise<Result<Approval>> {
  const cr = await vcs.changeRequest(ref);
  if (!cr.ok) return cr;
  const reviews = await vcs.reviews(ref);
  if (!reviews.ok) return reviews;
  const allowed = opts.approvers?.map((a) => a.toLowerCase());
  const humans = latestVerdicts(reviews.value).filter((r) => r.kind === "human" && r.verdict === "approved");
  const counted = allowed ? humans.filter((r) => allowed.includes(r.by.toLowerCase())) : humans;
  const where = cr.value.url || `change request #${ref.number}`;
  if (!counted.length) {
    const who = allowed ? ` from ${opts.approvers!.join(", ")}` : " from a person";
    const extra = allowed && humans.length ? ` (approved by ${humans.map((h) => h.by).join(", ")}, who may not approve this gate)` : "";
    return ok({ approved: false, reason: `${where} has no approving review${who}${extra}` });
  }
  if (!cr.value.merged) return ok({ approved: false, reason: `${where} is approved but not merged` });
  const last = counted[counted.length - 1];
  return ok({ approved: true, by: last.by, at: last.at, url: cr.value.url });
}

/** A change request link as the host prints it → its ref; null for anything gov does not recognise. */
export function changeRequestFromUrl(url: string): ChangeRequestRef | null {
  const m =
    /^https?:\/\/[^/]+\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/.exec(url) ??
    /^https?:\/\/[^/]+\/([^/]+)\/([^/]+)\/-\/merge_requests\/(\d+)\/?$/.exec(url) ??
    /^memory:\/\/([^/]+)\/([^/]+)\/change\/(\d+)$/.exec(url);
  return m ? { repo: { owner: m[1], name: m[2] }, number: Number(m[3]) } : null;
}

/**
 * Verify what an artifact's Status line claims. Only APPROVED can be true, and only when its change request link
 * leads to a merged change request that the named person approved.
 */
export async function verifyStatus(vcs: VcsPort, text: string, opts: ApprovalOptions = {}): Promise<Result<Approval>> {
  const s = statusOf(text);
  if (s === null) return ok({ approved: false, reason: "the artifact has no Status line" });
  if (s.kind !== "approved") return ok({ approved: false, reason: `Status is ${s.kind === "draft" ? "DRAFT" : "STALE"}` });
  const claim = /^by\s+(\S+)\s+.*\((\S+)\)\s*$/.exec(s.text);
  const ref = claim ? changeRequestFromUrl(claim[2]) : null;
  if (!claim || !ref) {
    return ok({ approved: false, reason: "Status says APPROVED but names no change request gov can check — text alone is not approval" });
  }
  const a = await approvalOf(vcs, ref, opts);
  if (!a.ok || !a.value.approved) return a;
  const reviews = await vcs.reviews(ref);
  if (!reviews.ok) return reviews;
  const approvers = latestVerdicts(reviews.value).filter((r) => r.kind === "human" && r.verdict === "approved").map((r) => r.by.toLowerCase());
  if (!approvers.includes(claim[1].toLowerCase())) {
    return ok({ approved: false, reason: `Status names ${claim[1]}, who did not approve ${a.value.url}` });
  }
  return a;
}

/** `**Status: APPROVED by <login> <yyyy-mm-dd> (<CR url>)**`. `on` is an ISO date or time. */
export function approvedStatusLine(a: { readonly by: string; readonly on: string; readonly url: string }): string {
  const t = Date.parse(a.on);
  if (Number.isNaN(t)) throw new Error(`approval date: not a date: ${JSON.stringify(a.on)}`);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(a.on) ? a.on : new Date(t).toISOString().slice(0, 10);
  return `**Status: APPROVED by ${a.by} ${date} (${a.url})**`;
}

/** On merge: write the APPROVED line in place of the artifact's Status line. Only a verified approval is accepted. */
export function markApproved(text: string, approval: Extract<Approval, { approved: true }>, on: string): Result<string> {
  return replaceStatusLine(text, approvedStatusLine({ by: approval.by, on, url: approval.url }));
}
