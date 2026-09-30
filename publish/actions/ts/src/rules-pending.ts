// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * A CHANGED RULE STOPS WORK UNTIL THE SESSION RESTARTS (rules-and-cues-design §8, PRJ-121, 2026-09-28).
 *
 * THE FAILURE THIS EXISTS FOR. `gov sync` and `gov upgrade` are exactly the two moments a ratified rule
 * reaches a working developer, and both of them re-render the resident block the agent reads. An agent that is
 * ALREADY RUNNING read that block when its session opened; gov cannot reach into the session and replace it —
 * nine vendors, no common mechanism, and the one vendor-specific hook that could was removed on purpose
 * (2026-09-11, consistency over capability). So without this module the sequence is: the rule changes, gov says
 * "Governance may have changed — paste this into your session", the person does not, and the next `gov merge`
 * lands work judged against a rule the session never saw. Nothing fails. That is the shape of defect this
 * project keeps removing: a guarantee that degrades to a suggestion.
 *
 * WHAT IT DOES INSTEAD. The build records a marker — `state/rules-pending`, beside the ack and cache dirs, in
 * the person's own state folder (`state-paths.ts`: persistent state is keyed by WHAT it is about, never by the
 * run that wrote it, and a rules change is about this person's sessions on this machine). While the marker is
 * there the MUTATING verbs refuse; the read-only ones do not, because a workspace nobody can inspect is a
 * workspace nobody can get out of this state.
 *
 * WHY IT IS KEYED BY PERSON AND NOT BY WORKSPACE. The thing that is stale is a SESSION, and a session belongs
 * to a person at a terminal. Two people sharing one governance clone have two sessions, started at different
 * times, and only one of them may need to restart. A workspace-level marker would refuse both or neither.
 *
 * PURE, except for four functions that take the `Fs` port. The interesting parts — what counts as a change,
 * what the refusal says — are testable without a disk.
 */
import { createHash } from "node:crypto";
import * as path from "node:path";
import type { Fs } from "./lifecycle/fs-io.js";
import { stateDir } from "./state-paths.js";

/** The marker's file name inside `state/`. Flat, like `ack/` and `cache/` beside it. */
export const PENDING_FILE = "rules-pending";

/** What the marker holds — the new hash, and enough of WHY to name the changed rules in the refusal. */
export interface RulesPending {
  /** The rendered rules' hash AFTER the build — what a restarted session will be reading. */
  readonly hash: string;
  /** The hash that was there before, or null when nothing was rendered yet. */
  readonly previous: string | null;
  /** The citations whose resident text changed, as the resident block names them (`POL-086b · C01`). */
  readonly clauses: readonly string[];
  /** ISO 8601, so `gov log` and the marker agree about when. */
  readonly at: string;
  /** Which command recorded it — `sync` or `upgrade`. Named in the refusal so the person knows what happened. */
  readonly by: string;
}

/** `<work-root>/preferences/<login>/state/rules-pending`. */
export const pendingPath = (workRoot: string, login: string): string =>
  path.join(stateDir(workRoot, login), PENDING_FILE);

/**
 * THE RULES HASH — one value over every rendered file, path included.
 *
 * Path included because a file appearing or disappearing is a change to what an agent reads, and a hash over
 * contents alone would miss it. Sorted, because the caller's ordering is not part of the fact.
 *
 * Sixteen hex characters, the same width `context-banner.ts` uses for a fingerprint a human compares by eye.
 */
export function rulesHash(files: readonly { readonly path: string; readonly content: string }[]): string {
  const h = createHash("sha256");
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) h.update(`${f.path}\n${f.content}\n`);
  return h.digest("hex").slice(0, 16);
}

/**
 * The resident cues in a rendered harness file, keyed by the citation its heading names.
 *
 * WHY PARSE THE RENDERED FILE rather than diff the policy documents. The question the refusal has to answer is
 * "which of the rules in your context changed", and the rules in an agent's context are exactly the resident
 * block — not every clause in the policy. A clause reworded without a cue changes nothing an agent reads, and
 * refusing work for it would train people to run `gov rules reload` reflexively, which is the one habit that
 * makes this whole mechanism worthless.
 *
 * The heading shape is `harness-render.ts`'s (`> **<cite> · <level>**`) and a test pins the two together, so a
 * change to the renderer that this parser cannot read is caught rather than silently reporting "nothing changed".
 */
export function residentCues(content: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = content.split("\n");
  let cite: string | null = null;
  let body: string[] = [];
  const flush = (): void => { if (cite !== null) out.set(cite, body.join("\n").trim()); cite = null; body = []; };
  for (const line of lines) {
    const head = /^>\s\*\*(.+?)\s·\s(\S+)\*\*\s*$/.exec(line);
    if (head) { flush(); cite = `${head[1]} · ${head[2]}`; continue; }
    if (cite !== null && line.startsWith(">")) { body.push(line.slice(1).trim()); continue; }
    if (cite !== null && line.trim() === "") continue;   // markdown needs the blank line between blockquotes
    if (cite !== null) flush();
  }
  flush();
  return out;
}

/** Citations whose resident text is new, gone, or different — sorted, so the refusal reads the same twice. */
export function changedCites(before: Map<string, string>, after: Map<string, string>): string[] {
  const changed = new Set<string>();
  for (const [cite, text] of after) if (before.get(cite) !== text) changed.add(cite);
  for (const cite of before.keys()) if (!after.has(cite)) changed.add(`${cite} (removed)`);
  return [...changed].sort();
}

/** How many changed clauses the refusal prints before it stops listing. A wall of citations is not read. */
const LIST_CAP = 12;

/**
 * THE REFUSAL. One message, so `task`, `merge`, `close` and `knowledge propose` cannot drift apart in what
 * they tell the person — the whole point is that the instruction is the same everywhere it appears.
 *
 * It names the CHANGED CLAUSES, because "the rules changed" with no referent is indistinguishable from a bug,
 * and a person who cannot see what changed cannot judge whether their in-flight work is affected.
 */
export function refuseForPendingRules(pending: RulesPending, command: string): string[] {
  const shown = pending.clauses.slice(0, LIST_CAP);
  const rest = pending.clauses.length - shown.length;
  return [
    `gov ${command}: refused — the rules changed after your session started.`,
    "",
    pending.clauses.length
      ? `  ${pending.clauses.length} rule(s) in your agent's context changed:`
      : "  the rendered rules changed (no resident clause could be named — run `gov rules report`):",
    ...shown.map((c) => `    ${c}`),
    ...(rest > 0 ? [`    … and ${rest} more`] : []),
    "",
    `  recorded by \`gov ${pending.by}\` at ${pending.at} · rules ${pending.hash}${pending.previous ? ` (was ${pending.previous})` : ""}`,
    "",
    "  gov cannot replace the rules inside a session that is already running, so it will not let work",
    "  land under rules that session never read. Restart your agent session:",
    "",
    "    gov work            re-places the harness, verifies it, and clears this by itself",
    "",
    "  If you have already restarted it, say so:  gov rules reload",
  ];
}

/**
 * Which verbs refuse while the marker is present.
 *
 * Design §8 names `task · merge · close · knowledge propose`. `submit` and `archive` are added (2026-09-28):
 * `submit` opens the pull request that asks an owner to ratify a change, and `archive` retires a knowledge
 * document — both LAND work, and landing work under rules the session never read is the whole thing this gate
 * exists to stop. Following the letter of §8 there would have gated the cheapest of the three governance verbs
 * and left the two that actually reach GitHub open.
 *
 * AN ALLOW-LIST WOULD BE WRONG HERE. gov gains verbs; a new read-only verb added to a deny-list keeps working,
 * whereas a new read-only verb missing from an allow-list starts refusing for a reason unrelated to itself.
 * The cost of the deny-list — a new MUTATING verb not being gated — is caught by the test that asserts this
 * list against the verbs `route` dispatches to a lifecycle orchestrator.
 */
export function isMutatingVerb(command: string, sub?: string): boolean {
  if (command === "task" || command === "merge" || command === "close") return true;
  // `knowledge search|show|list` are reads and stay open — the verb that tells you what a rule SAYS must not be
  // the one the rule change blocks.
  return command === "knowledge" && (sub === "propose" || sub === "submit" || sub === "archive");
}

// ── the disk side ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Read the marker, or null when there is none.
 *
 * A CORRUPT MARKER IS A PRESENT MARKER. Returning null on a parse failure would let a truncated write — or an
 * editor saving over it — silently re-open every mutating verb, which is the one direction this must never
 * fail. So an unreadable marker refuses with what little it knows.
 */
export function readPending(fs: Pick<Fs, "readFile">, workRoot: string, login: string): RulesPending | null {
  const text = fs.readFile(pendingPath(workRoot, login));
  if (text === null || text.trim() === "") return null;
  try {
    const d = JSON.parse(text) as Partial<RulesPending>;
    return {
      hash: typeof d.hash === "string" ? d.hash : "unknown",
      previous: typeof d.previous === "string" ? d.previous : null,
      clauses: Array.isArray(d.clauses) ? d.clauses.filter((c): c is string => typeof c === "string") : [],
      at: typeof d.at === "string" ? d.at : "an unrecorded time",
      by: typeof d.by === "string" ? d.by : "a build",
    };
  } catch {
    // Unreadable, and therefore still pending — see the note above. `gov rules reload` clears it either way.
    return { hash: "unreadable", previous: null, clauses: [], at: "an unrecorded time", by: "a build" };
  }
}

export function writePending(fs: Pick<Fs, "writeFile">, workRoot: string, login: string, pending: RulesPending): void {
  fs.writeFile(pendingPath(workRoot, login), `${JSON.stringify(pending, null, 2)}\n`);
}

export function clearPending(fs: Pick<Fs, "rm">, workRoot: string, login: string): void {
  fs.rm(pendingPath(workRoot, login));
}

/**
 * REFUSED BECAUSE gov COULD NOT TELL — the third state, added 2026-09-30.
 *
 * The marker is keyed on (work root, login). Either half can be missing: `agent_work_root` is unset in a
 * workspace nobody finished configuring, and the login came from a live `gh api user` with no fallback, so being
 * offline, signed out or rate-limited was enough. A missing key meant `readPending` was never called, which meant
 * every mutating verb PROCEEDED — while the specification said flatly that they refuse.
 *
 * That is the same conflation `gov doctor` refuses to make between a branch that is unprotected and one it could
 * not read: "no marker" and "no answer" lead to opposite actions and must not share a code path. A lapsed `gh`
 * token is not evidence that the rules are unchanged.
 *
 * The login now falls back to the cache first, so the common cases never reach here. What reaches here is a
 * machine that has never resolved a login, or a workspace with no work root — and for those, refusing is right:
 * gov cannot say whether the rules moved, and the honest answer to "may this work land?" is "I cannot tell".
 */
export function refuseForUnknownRulesState(command: string, missing: { workRoot: boolean; login: boolean }): string[] {
  const what: string[] = [];
  if (missing.login) what.push("who you are (`gh api user` failed and no login is cached)");
  if (missing.workRoot) what.push("where your state lives (`agent_work_root` is unset in org-config.yaml)");
  return [
    `gov ${command}: refused — gov cannot tell whether the rules changed since your session started.`,
    "",
    `  It could not determine ${what.join(", nor ")}.`,
    "",
    "  This is NOT the same as 'the rules are unchanged'. The marker that records a rules change is kept per",
    "  person, per work root; without both, gov has no answer rather than a clean one — and letting work land on",
    "  no answer is how a change comes to be recorded as reviewed under rules nobody read.",
    "",
    ...(missing.login ? ["    gh auth login       then re-run"] : []),
    ...(missing.workRoot ? ["    gov doctor          says what this workspace is missing"] : []),
    "",
    "  Read-only commands — `gov status`, `gov knowledge`, `gov rules report`, `gov validate` — keep working.",
  ];
}
