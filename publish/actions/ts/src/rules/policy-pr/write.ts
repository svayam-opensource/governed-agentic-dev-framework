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
 * A snapshot is never overwritten: if `policies/version/<prev>/` exists, it is frozen, and a wrong one is the
 * gate's to report, not this code's to "fix".
 *
 * Pure over the injected trees: `base` is read only; `head` is the branch being prepared.
 */
import yaml from "js-yaml";
import { parseRuleStore, compareVersions, type RuleRow, type Stamp } from "../model/rule-row.js";
import { POLICY_PR_PATHS, changelogEntry, nextVersion, readVersion, snapshotFiles, type BumpKind } from "./gate.js";
import type { TreeReader, TreeWriter } from "./tree.js";

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
}

const CHANGELOG_TITLE = "# Policy changelog";
const CHANGELOG_INTRO =
  "Newest first. Each entry is written by the pull request that changes `policies/`: the version it made, when, " +
  "who wrote and approved it, the rules it added, revised or retired, and the questions its interview settled.";

const at = (h: string): string => (h.startsWith("@") ? h : `@${h}`);
const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/** One entry, as markdown a person reads — the format the gate's (f) finds by its `## <version>` heading. */
export function renderChangelogEntry(e: ChangelogEntry): string {
  const out = [
    `## ${e.version} — ${e.date}`, "",
    "| Pull request | Author | Approver |", "|---|---|---|",
    `| #${e.pr} | ${at(e.author)} | ${e.approver ? at(e.approver) : "_pending_"} |`, "",
  ];
  if (e.rules.length) {
    out.push("| Rule | Change | Expectation |", "|---|---|---|");
    for (const r of e.rules) out.push(`| ${r.id} | ${r.change} | ${cell(r.expectation)} |`);
  } else {
    out.push("_No rule changed — prose only._");
  }
  out.push("");
  if (e.qa.length) {
    out.push("**Interview**", "");
    for (const { q, a } of e.qa) out.push(`- **Q:** ${q.replace(/\r?\n/g, " ")}`, `  **A:** ${a.replace(/\r?\n/g, " ")}`);
    out.push("");
  }
  return out.join("\n");
}

/** Rows to YAML, keeping the file's leading comment block (the org store is machine-written; its header is not). */
function dumpStore(previous: string, rows: readonly RuleRow[]): string {
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
const withoutEnd = (r: RuleRow): string => JSON.stringify({ ...r, end: undefined });

export function policyPrWriter(trees: { readonly base: TreeReader; readonly head: TreeWriter }) {
  const { base, head } = trees;
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

    /** `policies/version/<prev>/` ← the base's `policies/` minus `version/` and `actions/`. Never overwrites. */
    writeSnapshot(prev: string): WriteResult {
      const dir = `${POLICY_PR_PATHS.snapshots}/${prev}`;
      const existing = head.files(dir);
      if (existing === null) return { wrote: false, detail: `${dir}/ could not be listed` };
      if (existing.length) return { wrote: false, detail: `${dir}/ already exists — a snapshot is frozen` };
      const files = snapshotFiles(base);
      if (files === null) return { wrote: false, detail: "the base's policies/ could not be read" };
      if (!files.size) return { wrote: false, detail: "the base has no policy to freeze" };
      for (const [rel, text] of files) head.write(`${dir}/${rel}`, text);
      return { wrote: true, detail: `froze ${files.size} file(s) in ${dir}/` };
    },

    /** The entry for `e.version`, newest first. Skipped when an entry for that version is already there. */
    writeChangelogEntry(e: ChangelogEntry): WriteResult {
      const text = head.read(POLICY_PR_PATHS.changelog);
      if (text !== null && changelogEntry(text, e.version) !== null) return { wrote: false, detail: `${POLICY_PR_PATHS.changelog} already has ${e.version}` };
      const entry = renderChangelogEntry(e);
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
    },

    /**
     * Stamp the rows THIS change opened (start) and closed (end) with `version · date · pr`. A head row is a base
     * row when it equals one in everything but `end`; any other row is new. Rows already so stamped are left
     * alone, and when nothing differs nothing is written.
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
        return { ...r, start: stamp };
      });
      if (same(out, rows)) return { wrote: false, detail: "every row this change opened or closed is already stamped" };
      head.write(POLICY_PR_PATHS.rules, dumpStore(text, out));
      return { wrote: true, detail: `stamped rows at ${version} · ${date} · #${pr}` };
    },
  };
}
