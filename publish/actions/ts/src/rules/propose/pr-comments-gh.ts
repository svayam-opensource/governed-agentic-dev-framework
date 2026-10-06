// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE PULL REQUEST'S COMMENTS, OVER `gh` — the forge side of {@link prCommentChannel} (Q18; P3 wave 2).
 *
 * A question is a REVIEW COMMENT on the policy file it is about (`subject_type: file`), because review comments
 * are threaded: the owner presses Reply, GitHub records `in_reply_to_id`, and the channel reads the latest reply
 * in that thread as the answer. Conversation comments have no threads to read an answer from.
 *
 * The run record — "this run asked these questions at these shas" — is a conversation comment on the pull request
 * ({@link runRecords}); it is what keeps CI to one model run per section sha.
 *
 * Every call goes through the injected `gh` (the run-process chokepoint in production); none throws.
 */
import { log } from "../../log.js";
import type { Gh } from "../checks/github-adapters.js";
import type { PrComment, PrCommentsPort } from "./interview.js";

const PGM = "gov-work:rules:propose:pr-comments";

/** `gh api --paginate` output → one list: pages are arrays, concatenated (`][`) or merged by gh. */
export function parsePages(out: string | null): unknown[] | null {
  if (out === null) return null;
  const t = out.trim();
  if (!t) return [];
  try {
    const one = JSON.parse(t);
    return Array.isArray(one) ? one.flat() : null;
  } catch {
    try {
      return (JSON.parse(`[${t.replace(/\]\s*\[/g, "],[")}]`) as unknown[]).flat();
    } catch (e) {
      log("warn", "gh answered something that is not a JSON list", PGM, "parsePages", { error: (e as Error).message });
      return null;
    }
  }
}

const o = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export interface PrRef {
  /** `owner/name`. */
  readonly repo: string;
  readonly pr: number;
  /** The head commit a new question is attached to. */
  readonly headSha: string;
  /** gov's own login on this repository (the bot the workflow runs as). */
  readonly self: string;
}

/** Thrown when GitHub could not be read: the run must stop rather than read "no comments" as "no answers". */
export class ForgeUnreadable extends Error {}

export function ghPrComments(gh: Gh, ref: PrRef): PrCommentsPort {
  return {
    self: ref.self,
    async list(): Promise<readonly PrComment[]> {
      const pages = parsePages(gh(["api", "--paginate", `repos/${ref.repo}/pulls/${ref.pr}/comments`]));
      if (pages === null) throw new ForgeUnreadable(`the review comments on #${ref.pr} could not be read`);
      return pages.map(o).map((c) => ({
        id: String(c.id ?? ""),
        author: String(o(c.user).login ?? ""),
        body: String(c.body ?? ""),
        ...(c.in_reply_to_id != null ? { inReplyTo: String(c.in_reply_to_id) } : {}),
        createdAt: String(c.created_at ?? ""),
      })).filter((c) => c.id);
    },
    async post(body: string): Promise<string> {
      // The question names its policy file in its marker; it is attached there.
      const path = /<!-- gov-propose [^>]*\bdoc=(\S+)/.exec(body)?.[1];
      const payload = path
        ? { body, commit_id: ref.headSha, path, subject_type: "file" }
        : null;
      const out = payload
        ? gh(["api", "-X", "POST", `repos/${ref.repo}/pulls/${ref.pr}/comments`, "--input", "-"], JSON.stringify(payload))
        : gh(["api", "-X", "POST", `repos/${ref.repo}/issues/${ref.pr}/comments`, "--input", "-"], JSON.stringify({ body }));
      if (out === null) throw new ForgeUnreadable(`could not post a question on #${ref.pr}`);
      try {
        return String(o(JSON.parse(out)).id ?? "");
      } catch {
        return ""; // posted; GitHub's answer just did not carry an id we could read — the next run finds it by marker
      }
    },
  };
}

// ── the run record (conversation comments) ──────────────────────────────────────────────────────────────────

export const RUN_MARK = /<!-- gov-propose-run key=([0-9a-f]+) -->/;

export interface RunRecordPort {
  /** Keys of the run records gov has posted on this pull request. */
  keys(): readonly string[] | null;
  post(key: string, body: string): boolean;
}

export function runRecords(gh: Gh, ref: PrRef): RunRecordPort {
  return {
    keys() {
      const pages = parsePages(gh(["api", "--paginate", `repos/${ref.repo}/issues/${ref.pr}/comments`]));
      if (pages === null) return null;
      return pages.map(o).filter((c) => String(o(c.user).login ?? "") === ref.self)
        .map((c) => RUN_MARK.exec(String(c.body ?? ""))?.[1]).filter((k): k is string => !!k);
    },
    post(key, body) {
      return gh(["api", "-X", "POST", `repos/${ref.repo}/issues/${ref.pr}/comments`, "--input", "-"],
        JSON.stringify({ body: `<!-- gov-propose-run key=${key} -->\n${body}` })) !== null;
    },
  };
}
