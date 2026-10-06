// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WHICH RULES WAS THIS JUDGED AGAINST? (rules-and-cues-design §10.10, PRJ-121, 2026-09-28)
 *
 * A year after a change lands, that question has no answer anywhere. The policies moved on; the resident block
 * an agent actually read was re-rendered three times since; the POL numbers are stable but the TEXT behind them
 * was reworded twice, each time legitimately. So "the reviewer approved this under GOV-FRM-086" is a sentence
 * nobody can check — which is the part of an audit trail that costs the most to be missing, because it is the
 * part you only need once, under pressure, long after everyone has forgotten.
 *
 * Three facts close it, and they are cheap:
 *
 *   gov-rules-hash   the rendered harness's hash — the exact resident block the agent was told to obey
 *   gov-pol-lock     the lock's file version and entry count, per tree — how many numbers had been issued
 *   gov-version      which gov compiled and checked it, because the checks are gov's code
 *
 * MACHINE-READABLE ENOUGH TO GREP, and no more. Each fact is one `key: value` line inside a marker-delimited
 * block, so `grep gov-rules-hash` over a year of pull requests answers the question in one pass, and a later
 * stamp REPLACES the block rather than appending a second one. It is not a schema, not JSON and not a
 * provenance format: the moment this needs a parser, somebody will write a second producer for it.
 *
 * NOTHING HERE MAY FAIL A MERGE. The stamp is a record OF a merge that already happened — every branch pushed,
 * every issue closed. Refusing at that point would leave the work landed and the command reporting failure,
 * which is worse than an unstamped pull request. So every path returns a reason instead of throwing, and the
 * caller prints it.
 *
 * Pure except `gatherGovernanceFacts`, which takes the `Fs` port.
 */
import * as path from "node:path";
import { rulesHash } from "../rules-pending.js";
import { HARNESS_TARGETS } from "../rules/harness-render.js";
import { LOCK_FILE } from "../rules/pol-lock-io.js";
import type { Fs } from "./fs-io.js";

/** Where the canonical rendered copies live inside the governance repo. */
const HARNESS_DIR = path.join("agent", "harness");
/** One lock per tree — the framework's numbers and an organization's are never mixed. */
const LOCK_DIRS: readonly { readonly which: string; readonly dir: string }[] = [
  { which: "framework", dir: path.join("framework", "policies") },
  { which: "org", dir: "policies" },
];

/** One lock's identity, as the stamp names it: the FILE format version and how many numbers it holds. */
export interface LockFact {
  readonly which: string;
  readonly version: number;
  readonly entries: number;
}

export interface GovernanceFacts {
  readonly rulesHash: string;
  readonly locks: readonly LockFact[];
  readonly govVersion: string;
}

/** The markers that make a re-stamp replace rather than duplicate. */
export const STAMP_BEGIN = "<!-- gov:governed-by -->";
export const STAMP_END = "<!-- /gov:governed-by -->";

/** The block, as it appears in a pull request body. Four lines and two markers — a stamp, not a report. */
export function stampLines(f: GovernanceFacts): string[] {
  return [
    STAMP_BEGIN,
    "**Governed by** — the rules this change was judged against (`gov merge`):",
    `\`gov-rules-hash: ${f.rulesHash}\``,
    `\`gov-pol-lock: ${f.locks.map((l) => `${l.which}=v${l.version}/${l.entries}`).join(" ") || "none"}\``,
    `\`gov-version: ${f.govVersion}\``,
    STAMP_END,
  ];
}

/**
 * The `key: value` facts back out of a rendered block, for a terminal line.
 *
 * HERE RATHER THAN AT THE CALL SITE, so the one module that knows the block's shape is the one that produced it.
 * `gov merge` prints the same facts it stamped, and a second place picking them apart with its own pattern is
 * how the printed line and the stamped block come to disagree about what was recorded.
 */
export const stampFacts = (lines: readonly string[]): string[] =>
  lines.filter((l) => /^`[a-z-]+: /.test(l)).map((l) => l.replace(/`/g, ""));

/**
 * Put the block in a body, replacing any block already there.
 *
 * REPLACING, NOT APPENDING, because `gov merge` is forward-idempotent: a conflict pauses the merge and a re-run
 * finishes it, so the same pull request can be stamped twice. Two blocks with different hashes is worse than
 * none — a reader cannot tell which one is the answer.
 */
export function withStamp(body: string, lines: readonly string[]): string {
  const block = lines.join("\n");
  const from = body.indexOf(STAMP_BEGIN);
  if (from !== -1) {
    const to = body.indexOf(STAMP_END, from);
    if (to !== -1) return `${body.slice(0, from)}${block}${body.slice(to + STAMP_END.length)}`;
  }
  return body.trim() ? `${body.replace(/\s+$/, "")}\n\n${block}\n` : `${block}\n`;
}

/**
 * Read the three facts out of the governance workspace.
 *
 * THE RENDERED FILES, NOT THE POLICIES. What governed the change is what the agent had in context, and that is
 * the rendered harness — the same bytes `rules-pending.ts` hashes, by the same function, so a stamp and a
 * "the rules changed" marker can be compared directly. Hashing the policy documents instead would produce a
 * value that moves when a paragraph is reflowed and nothing an agent reads has changed.
 *
 * A MISSING HARNESS IS AN ANSWER, NOT A CRASH: an organization that never ran `gov rules build` has nothing to
 * stamp, and saying so is more useful than a hash of the empty string, which would look like a real value.
 */
export function gatherGovernanceFacts(
  fs: Pick<Fs, "readFile">,
  home: string,
  govVersion: string,
): { readonly facts?: GovernanceFacts; readonly error?: string } {
  const rendered = HARNESS_TARGETS
    .map((t) => ({ path: t.path, content: fs.readFile(path.join(home, HARNESS_DIR, t.path)) }))
    .filter((f): f is { path: string; content: string } => f.content !== null);
  if (!rendered.length) {
    return { error: `no rendered harness under ${HARNESS_DIR}/ — this workspace has never run \`gov rules build\`` };
  }
  const locks: LockFact[] = [];
  for (const { which, dir } of LOCK_DIRS) {
    const text = fs.readFile(path.join(home, dir, LOCK_FILE));
    if (text === null) continue;                       // a tree with no lock has issued no numbers — nothing to state
    try {
      // READ DIRECTLY, not through `parseLock`: that function deliberately returns the POL model and drops the
      // FILE's `version`, which is one of the three facts the stamp exists to carry.
      const d = JSON.parse(text) as { version?: unknown; entries?: unknown };
      locks.push({
        which,
        version: typeof d.version === "number" ? d.version : 0,
        entries: Array.isArray(d.entries) ? d.entries.length : 0,
      });
    } catch {
      // A lock nobody can parse is a fact worth stating, and it is not this function's business to fix it —
      // `gov rules build` refuses on the same file and says how to restore it.
      return { error: `${path.join(dir, LOCK_FILE)} is not valid JSON, so the POL-lock version cannot be stated` };
    }
  }
  return { facts: { rulesHash: rulesHash(rendered), locks, govVersion } };
}
