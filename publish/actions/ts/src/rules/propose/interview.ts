// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE INTERVIEW FOR ONE SECTION (rule-model-design.md Q16–Q18; W4, 2026-10-06).
 *
 *   propose → refused? → corrections back to the MODEL  ─┐
 *           → questions? → asked through the CHANNEL ────┤→ re-propose with the Q&A appended
 *           → neither → done                              │   (at most `maxRounds` model calls)
 *           → an answer is pending → the run ends, nothing written
 *
 * ONE IMPLEMENTATION, TWO CHANNELS. Run by hand, the owner answers at the terminal — through the one asker that owns
 * it (cli/ask.ts: never a second reader). Run in CI on a policy PR, each question is one PR comment and the run ends
 * "pending" until the owner replies; the PR stays blocked meanwhile (Q18). The engine cannot tell them apart.
 *
 * An empty terminal answer is PENDING, never a default: #194 recorded a "yes" nobody typed.
 */
import { createHash } from "node:crypto";
import { log } from "../../log.js";
import type { ModelPort } from "./model-port.js";
import { buildProposalRequest, type PromptInput } from "./prompt.js";
import { parseProposal, checkProposal, type ModelVerdict, type ProposalQuestion, type ProposedOwnership } from "./parse.js";

const PGM = "gov-work:rules:propose";

export type Answer = { readonly kind: "answer"; readonly text: string } | { readonly kind: "pending" };

/** Where a question is put to a person. */
export interface InterviewChannel {
  /** `section` identifies the section the question is about (doc, number, sha), so a channel can key it. */
  ask(q: ProposalQuestion, section: SectionKey): Promise<Answer>;
  /** Answers already given for this section in an earlier run (a PR thread replied to since). */
  prior?(section: SectionKey): Promise<readonly QA[]>;
}

export interface SectionKey { readonly doc: string; readonly section: string; readonly sha: string; }

export interface QA { readonly id: string; readonly q: string; readonly a: string; }

export type SectionOutcome =
  | { readonly status: "done"; readonly verdicts: readonly ModelVerdict[]; readonly ownership: readonly ProposedOwnership[]; readonly qa: readonly QA[] }
  | { readonly status: "pending"; readonly open: readonly ProposalQuestion[]; readonly qa: readonly QA[] }
  | { readonly status: "failed"; readonly open: readonly ProposalQuestion[]; readonly problems: readonly string[]; readonly qa: readonly QA[] };

export const DEFAULT_MAX_ROUNDS = 4;

export type InterviewInput = Omit<PromptInput, "qa" | "corrections"> & {
  /** The org store's scope (`org_slug`): what the proposed rows are validated in. */
  readonly scope: string;
};

/**
 * Interview the model (and, through `channel`, the owner) about one section. A reply that is not a proposal at all
 * throws {@link ./parse.js ProposeError} — that is the model failing, not an ambiguity to ask about.
 */
export async function interviewSection(
  input: InterviewInput,
  deps: { readonly model: ModelPort; readonly channel: InterviewChannel; readonly maxRounds?: number },
): Promise<SectionOutcome> {
  const key: SectionKey = { doc: input.doc, section: input.section, sha: input.sha };
  const qa: QA[] = [...((await deps.channel.prior?.(key)) ?? [])];
  let corrections: readonly string[] = [];
  let lastOpen: readonly ProposalQuestion[] = [];
  const max = deps.maxRounds ?? DEFAULT_MAX_ROUNDS;

  for (let round = 1; round <= max; round++) {
    const req = buildProposalRequest({ ...input, qa: qa.map(({ q, a }) => ({ q, a })), corrections });
    const raw = await deps.model.complete(req);
    const proposal = parseProposal(raw);
    const check = checkProposal(proposal, {
      doc: input.doc, section: input.section, sha: input.sha, rows: input.rows, scope: input.scope,
      catalog: input.catalog, frameworkRules: input.frameworkRules, roles: input.roles, answered: new Set(qa.map((x) => x.id)),
    });
    log("debug", "proposal round", PGM, "interviewSection", {
      doc: input.doc, section: input.section, round, verdicts: proposal.verdicts.length, problems: check.problems.length, questions: check.questions.length,
    });
    if (check.problems.length) {
      corrections = check.problems;
      lastOpen = check.questions;
      continue;
    }
    corrections = [];
    if (check.questions.length === 0) {
      return { status: "done", verdicts: proposal.verdicts, ownership: proposal.ownership, qa };
    }
    // Ask EVERY open question before ending on a pending one: in CI each is a comment, and the owner should see
    // them all at once rather than one per push.
    const open: ProposalQuestion[] = [];
    for (const q of check.questions) {
      // Asked and answered already (an earlier round, or a PR thread from an earlier run): the answer stands.
      if (qa.some((x) => x.q === q.text)) continue;
      const ans = await deps.channel.ask(q, key);
      if (ans.kind === "pending") open.push(q);
      else qa.push({ id: q.id, q: q.text, a: ans.text });
    }
    if (open.length) {
      log("info", "interview pending — waiting for the owner", PGM, "interviewSection", { doc: input.doc, section: input.section, open: open.map((q) => q.id) });
      return { status: "pending", open, qa };
    }
    lastOpen = [];
  }
  log("info", "interview did not settle", PGM, "interviewSection", { doc: input.doc, section: input.section, rounds: max });
  return { status: "failed", open: lastOpen, problems: corrections.length ? corrections : [`section ${input.section} did not settle in ${max} rounds`], qa };
}

// ── channels ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * At the terminal, through the asker that owns it (`AskFns.line`, cli/ask.ts). A numbered option may be answered
 * by its number. An empty answer is pending — the run stops rather than invent one.
 */
export function terminalChannel(line: (question: string) => Promise<string>): InterviewChannel {
  return {
    async ask(q, key) {
      const opts = q.options?.length ? "\n" + q.options.map((o, i) => `  ${i + 1}. ${o}`).join("\n") : "";
      const raw = (await line(`\n[${key.doc} §${key.section}] ${q.text}${opts}\n> `)).trim();
      if (!raw) return { kind: "pending" };
      const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
      const picked = q.options && n >= 1 && n <= q.options.length ? q.options[n - 1]! : raw;
      return { kind: "answer", text: picked };
    },
  };
}

/** A pull request's comments, as the PR channel needs them. Implemented over the forge by the CLI (P3). */
export interface PrComment {
  readonly id: string;
  readonly author: string;
  readonly body: string;
  /** The comment this one replies to (its thread root), when it is a reply. */
  readonly inReplyTo?: string;
  readonly createdAt: string;
}

export interface PrCommentsPort {
  list(): Promise<readonly PrComment[]>;
  /** Post a new top-level comment (one thread per question); returns its id. */
  post(body: string): Promise<string>;
  /** gov's own login: its comments are questions, never answers (a bot never approves — Q17). */
  readonly self: string;
}

const MARK = /<!-- gov-propose q=(\S+) doc=(\S+) section=(\S+) sha=(\S+) -->/;
const qKey = (q: ProposalQuestion): string => createHash("sha256").update(q.text).digest("hex").slice(0, 12);

/**
 * On a policy PR (Q18): one comment per open question, marked so a later run finds it; the owner's latest reply in
 * that thread is the answer. No reply yet → pending, and the run ends with the PR blocked. Keyed by the section's
 * sha: a push that changes the section again starts a fresh interview.
 */
export function prCommentChannel(port: PrCommentsPort): InterviewChannel {
  let cache: readonly PrComment[] | null = null;
  const comments = async (): Promise<readonly PrComment[]> => (cache ??= await port.list());
  const marker = (k: string, s: SectionKey) => `<!-- gov-propose q=${k} doc=${s.doc} section=${s.section} sha=${s.sha} -->`;
  const answerTo = (all: readonly PrComment[], rootId: string): string | null => {
    const replies = all.filter((c) => c.inReplyTo === rootId && c.author !== port.self && c.body.trim() !== "")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return replies.length ? replies[replies.length - 1]!.body.trim() : null;
  };
  return {
    async prior(section) {
      const all = await comments();
      const out: QA[] = [];
      for (const c of all) {
        if (c.author !== port.self) continue;
        const m = MARK.exec(c.body);
        if (!m || m[2] !== section.doc || m[3] !== section.section || m[4] !== section.sha) continue;
        const a = answerTo(all, c.id);
        const text = c.body.replace(MARK, "").split("\n").find((l) => l.trim())?.replace(/^\*\*Question:\*\*\s*/, "").trim() ?? "";
        if (a !== null) out.push({ id: `pr:${m[1]}`, q: text, a });
      }
      return out;
    },
    async ask(q, section) {
      const k = qKey(q);
      const all = await comments();
      const root = all.find((c) => c.author === port.self && c.body.includes(marker(k, section)));
      if (!root) {
        const opts = q.options?.length ? "\n\n" + q.options.map((o, i) => `${i + 1}. ${o}`).join("\n") : "";
        await port.post(`${marker(k, section)}\n**Question:** ${q.text}${opts}\n\n_${section.doc} §${section.section} — reply in this thread; the PR stays blocked until every question is answered._`);
        return { kind: "pending" };
      }
      const a = answerTo(all, root.id);
      return a === null ? { kind: "pending" } : { kind: "answer", text: a };
    },
  };
}
