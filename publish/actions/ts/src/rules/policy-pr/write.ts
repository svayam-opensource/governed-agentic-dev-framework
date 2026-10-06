// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WHAT A POLICY PULL REQUEST WRITES BESIDE ITS PROSE (rule-model-design.md P1 "Org version", "Propose trigger"; W5).
 *
 * The version bump, the frozen snapshot of the version it replaces, the stamps on the rows it opens and closes,
 * and its CHANGELOG entry — the four things {@link judgePolicyPr} checks for. Propose calls these; so does CI's
 * fallback. ONE IMPLEMENTATION, TWO TRIGGERS, so every writer SKIPS WHEN ITS WORK IS ALREADY DONE: run by hand
 * and then again in CI, the second run writes nothing.
 *
 * A snapshot is never overwritten: if `policies/history/<prev>/` exists, it is frozen, and a wrong one is the
 * gate's to report, not this code's to "fix".
 *
 * Pure over the injected trees: `base` is read only; `head` is the branch being prepared.
 */
import yaml from "js-yaml";
import { parseRuleStore, compareVersions, type RuleRow, type Stamp } from "../model/rule-row.js";
import { POLICY_PR_PATHS, changelogEntry, changelogVersions, isShaRefresh, nextVersion, readVersion, snapshotFiles, type BumpKind } from "./gate.js";
import { LEGACY_POLICY_HISTORY_DIR } from "../checks/policy-actions.js";
import type { TreeReader, TreeWriter } from "./tree.js";
import { REVIEWED_HEADING, renderReviewLine, type SectionReview } from "./reviewed.js";

export interface WriteResult {
  readonly wrote: boolean;
  /** What was done, or why nothing was. */
  readonly detail: string;
}

export interface ChangelogEntry {
  readonly version: string;
  /** YYYY-MM-DD. */
  readonly date: string;
  readonly pr: number;
  /** GitHub handles, with or without `@`. The approver is null until someone approves. */
  readonly author: string;
  readonly approver: string | null;
  readonly rules: readonly { readonly id: string; readonly change: "added" | "revised" | "retired"; readonly expectation: string }[];
  /** The interview that settled the change (Q18). */
  readonly qa: readonly { readonly q: string; readonly a: string }[];
  /** The governance choices this change made, in plain words (describeGovernanceChanges). */
  readonly governance?: readonly string[];
  /** Every section propose settled in this pull request, and what it came to — the gate demands one per changed section. */
  readonly reviewed?: readonly SectionReview[];
}

const CHANGELOG_TITLE = "# Policy changelog";
const CHANGELOG_INTRO =
  "Newest first. Each entry is written by the pull request that changes `policies/`: the version it made, when, " +
  "who wrote and approved it, the rules it added, revised or retired, every policy section it reviewed and what " +
  "that came to, and the questions its interview settled.";

const at = (h: string): string => (h.startsWith("@") ? h : `@${h}`);
const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/** One entry, as markdown a person reads — the format the gate's (f) finds by its `## <version>` heading. */
export function renderChangelogEntry(e: ChangelogEntry): string {
  const out = [
    `## ${e.version} — ${e.date}`, "",
    "| Pull request | Author | Approver |", "|---|---|---|",
    `| #${e.pr} | ${at(e.author)} | ${e.approver ? at(e.approver) : "_pending_"} |`, "",
  ];
  const governance = e.governance ?? [];
  if (governance.length) {
    out.push("**Governance choices** (`policies/governance.yaml`)", "");
    for (const g of governance) out.push(`- ${g.replace(/\r?\n/g, " ")}`);
    out.push("");
  }
  if (e.rules.length) {
    out.push("| Rule | Change | Expectation |", "|---|---|---|");
    for (const r of e.rules) out.push(`| ${r.id} | ${r.change} | ${cell(r.expectation)} |`);
    out.push("");
  } else if (!governance.length) {
    out.push("_No rule changed — prose only._", "");
  }
  if (e.reviewed?.length) {
    out.push(REVIEWED_HEADING, "");
    for (const r of e.reviewed) out.push(renderReviewLine(r));
    out.push("");
  }
  if (e.qa.length) {
    out.push("**Interview**", "");
    for (const { q, a } of e.qa) out.push(`- **Q:** ${q.replace(/\r?\n/g, " ")}`, `  **A:** ${a.replace(/\r?\n/g, " ")}`);
    out.push("");
  }
  return out.join("\n");
}

/** Rows to YAML, keeping the file's leading comment block (the org store is machine-written; its header is not). */
export function dumpStore(previous: string, rows: readonly RuleRow[]): string {
  const header: string[] = [];
  for (const line of previous.split("\n")) {
    if (line.startsWith("#") || line.trim() === "") header.push(line);
    else break;
  }
  while (header.length && header[header.length - 1]!.trim() === "") header.pop();
  const body = yaml.dump(JSON.parse(JSON.stringify(rows)), { lineWidth: -1, noRefs: true });
  return header.length ? `${header.join("\n")}\n\n${body}` : body;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** An entry nobody has approved yet: its approver cell still reads `_pending_`. */
const pending = (entry: string): boolean => entry.includes("| _pending_ |");
/** An entry pull request `pr` wrote. */
const byPr = (entry: string, pr: number): boolean => entry.includes(`| #${pr} | `);

/** `text` without the entry for `version` (its heading up to the next entry), or `text` unchanged. */
function withoutEntry(text: string, version: string): string {
  const entry = changelogEntry(text, version);
  if (entry === null) return text;
  const at = text.indexOf(entry);
  let end = at + entry.length;
  while (text[end] === "\n" || text[end] === "\r") end++;
  return text.slice(0, at) + text.slice(end);
}
const withoutEnd = (r: RuleRow): string => JSON.stringify({ ...r, end: undefined });

export function policyPrWriter(trees: { readonly base: TreeReader; readonly head: TreeWriter }) {
  const { base, head } = trees;

  /** `dir` ← the base's policies/, unless something is already frozen there. */
  const freeze = (dir: string): WriteResult => {
    const existing = head.files(dir);
    if (existing === null) return { wrote: false, detail: `${dir}/ could not be listed` };
    if (existing.length) return { wrote: false, detail: `${dir}/ already exists — a snapshot is frozen` };
    const files = snapshotFiles(base);
    if (files === null) return { wrote: false, detail: "the base's policies/ could not be read" };
    if (!files.size) return { wrote: false, detail: "the base has no policy to freeze" };
    for (const [rel, text] of files) head.write(`${dir}/${rel}`, text);
    return { wrote: true, detail: `froze ${files.size} file(s) in ${dir}/` };
  };

  /** Versions whose snapshot the base holds, in either folder. Null when it could not be listed. */
  const frozenInBase = (): Set<string> | null => {
    const out = new Set<string>();
    for (const dir of [POLICY_PR_PATHS.snapshots, LEGACY_POLICY_HISTORY_DIR]) {
      const files = base.files(dir);
      if (files === null) return null;
      for (const f of files) out.add(f.slice(dir.length + 1).split("/")[0]!);
    }
    return out;
  };

  /** Has this branch an APPROVED changelog entry the base lacks? Then nothing it froze is touched. */
  const approvedOnBranch = (): boolean => {
    const text = head.read(POLICY_PR_PATHS.changelog);
    if (text === null) return false;
    const b = base.read(POLICY_PR_PATHS.changelog);
    const inBase = new Set(b === null ? [] : changelogVersions(b));
    return changelogVersions(text).some((v) => !inBase.has(v) && !pending(changelogEntry(text, v)!));
  };

  /** Remove the snapshot folders this branch froze for a version other than `prev`; returns their versions. */
  const dropStaleSnapshots = (prev: string): string[] => {
    const inBase = frozenInBase();
    const files = head.files(POLICY_PR_PATHS.snapshots);
    if (inBase === null || files === null || approvedOnBranch()) return [];
    const stale = files.filter((f) => {
      const v = f.slice(POLICY_PR_PATHS.snapshots.length + 1).split("/")[0]!;
      return v !== prev && !inBase.has(v);
    });
    for (const f of stale) head.remove(f);
    return [...new Set(stale.map((f) => `${POLICY_PR_PATHS.snapshots}/${f.slice(POLICY_PR_PATHS.snapshots.length + 1).split("/")[0]!}`))];
  };

  /** Write `e` into `text` (the changelog as it stands, or null): new, rewritten, or already there. */
  const writeEntry = (text: string | null, e: ChangelogEntry): WriteResult => {
    const entry = renderChangelogEntry(e);
    const existing = text === null ? null : changelogEntry(text, e.version);
    if (text !== null && existing !== null) {
      const ours = byPr(existing, e.pr) && pending(existing);
      if (!ours || existing.trimEnd() === entry.trimEnd()) return { wrote: false, detail: `${POLICY_PR_PATHS.changelog} already has ${e.version}` };
      head.write(POLICY_PR_PATHS.changelog, text.replace(existing, entry.replace(/\n+$/, "\n")));
      return { wrote: true, detail: `${POLICY_PR_PATHS.changelog} ${e.version} rewritten for #${e.pr}` };
    }
    let next: string;
    if (text === null || !text.trim()) {
      next = `${CHANGELOG_TITLE}\n\n${CHANGELOG_INTRO}\n\n${entry}`;
    } else {
      const lines = text.split("\n");
      const first = lines.findIndex((l) => /^## \d+\.\d+\.\d+\b/.test(l));
      next = first < 0
        ? `${text.replace(/\n*$/, "")}\n\n${entry}`
        : [...lines.slice(0, first), ...entry.split("\n"), ...lines.slice(first)].join("\n");
    }
    head.write(POLICY_PR_PATHS.changelog, next);
    return { wrote: true, detail: `${POLICY_PR_PATHS.changelog} + ${e.version}` };
  };

  return {
    /**
     * VERSION = base VERSION bumped by `kind`. Skipped when the head is already there or past it — so a patch
     * after a minor is a no-op, and a minor after a patch (rows changed since) moves it on.
     */
    bumpVersion(kind: BumpKind): WriteResult & { readonly version: string } {
      const target = nextVersion(readVersion(base), kind);
      const current = readVersion(head);
      if (compareVersions(current, target) >= 0) return { wrote: false, version: current, detail: `${POLICY_PR_PATHS.version} is already ${current}` };
      head.write(POLICY_PR_PATHS.version, `${target}\n`);
      return { wrote: true, version: target, detail: `${POLICY_PR_PATHS.version} → ${target}` };
    },

    /**
     * `policies/history/<prev>/` ← the base's `policies/` minus `history/` and `actions/`. Never overwrites.
     *
     * ONE VERSION JUMP PER PULL REQUEST: a snapshot folder the base does not have, other than `<prev>`, is one an
     * earlier run of THIS branch froze for a version it has since moved past (the base moved under it). It is
     * removed — unless this branch carries an approved changelog entry, which nothing here rewrites.
     */
    writeSnapshot(prev: string): WriteResult {
      const dir = `${POLICY_PR_PATHS.snapshots}/${prev}`;
      const dropped = dropStaleSnapshots(prev);
      if (dropped.length) {
        const r = freeze(dir);
        return { wrote: true, detail: `removed this pull request's superseded snapshot(s) ${dropped.map((d) => `${d}/`).join(", ")}; ${r.detail}` };
      }
      return freeze(dir);
    },

    /**
     * The entry for `e.version`, newest first. Skipped when an entry for that version is already there — except
     * one THIS pull request wrote and nobody has approved yet, which is rewritten when the change has grown since
     * (a second section proposed on the same branch must be named in the same entry, or the gate fails it).
     *
     * ONE ENTRY PER PULL REQUEST: an entry this pull request added for ANOTHER version — an earlier run bumped to
     * 1.0.2 for prose, a later one to 1.1.0 for rules — is replaced by this one, while nobody has approved it. An
     * entry the base already has (another pull request's) or an approved one is never touched.
     */
    writeChangelogEntry(e: ChangelogEntry): WriteResult {
      const original = head.read(POLICY_PR_PATHS.changelog);
      let text = original;
      const superseded: string[] = [];
      if (text !== null) {
        const baseText = base.read(POLICY_PR_PATHS.changelog);
        const inBase = new Set(baseText === null ? [] : changelogVersions(baseText));
        for (const v of changelogVersions(text)) {
          if (v === e.version || inBase.has(v)) continue;
          const old = changelogEntry(text, v)!;
          if (byPr(old, e.pr) && pending(old)) { text = withoutEntry(text, v); superseded.push(v); }
        }
      }
      const r = writeEntry(text, e);
      if (!superseded.length) return r;
      if (!r.wrote) head.write(POLICY_PR_PATHS.changelog, text!);
      return { wrote: true, detail: `${POLICY_PR_PATHS.changelog}: this pull request's earlier entry ${superseded.join(", ")} replaced by ${e.version}` };
    },

    /**
     * Stamp the rows THIS change opened (start) and closed (end) with `version · date · pr`. A head row is a base
     * row when it equals one in everything but `end`, or is an open one with only its sha refreshed (Q17 — the same
     * row, so its start stays); any other row is new. Rows already so stamped are left alone, and when nothing
     * differs nothing is written.
     */
    stampRows(version: string, date: string, pr: number): WriteResult {
      const text = head.read(POLICY_PR_PATHS.rules);
      if (text === null) return { wrote: false, detail: `no ${POLICY_PR_PATHS.rules}` };
      const baseText = base.read(POLICY_PR_PATHS.rules);
      const baseRows = baseText === null ? [] : parseRuleStore(baseText);
      const rows = parseRuleStore(text);
      const stamp: Stamp = { version, date, pr };
      const free = baseRows.map((r, i) => ({ key: withoutEnd(r), i }));
      const out = rows.map((r) => {
        const k = free.findIndex((f) => f.key === withoutEnd(r));
        if (k >= 0) {
          const b = baseRows[free[k]!.i]!;
          free.splice(k, 1);
          return b.end === null && r.end !== null ? { ...r, end: stamp } : r;
        }
        const refreshed = free.findIndex((f) => isShaRefresh(baseRows[f.i]!, r));
        if (refreshed >= 0) { free.splice(refreshed, 1); return r; }
        return { ...r, start: stamp };
      });
      if (same(out, rows)) return { wrote: false, detail: "every row this change opened or closed is already stamped" };
      head.write(POLICY_PR_PATHS.rules, dumpStore(text, out));
      return { wrote: true, detail: `stamped rows at ${version} · ${date} · #${pr}` };
    },
  };
}
