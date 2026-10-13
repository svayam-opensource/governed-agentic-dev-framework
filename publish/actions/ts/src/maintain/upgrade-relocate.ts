// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE UPGRADE RE-SOURCES THE ORG'S RULES THAT CITE A FILE IT MOVED (PRJ-121 intent 01, spec §3.5; ruling Q6).
 *
 * A rule row names the document it came from. When `gov upgrade` moves that document (a declared move, or the
 * specification split gov itself names), the row must follow in the SAME pull request, or it cites a path that is
 * not there. The policy PR gate accepts exactly this edit in place ({@link isRelocation}); this writes it:
 *
 *   - each open row whose cited file moved is re-sourced (document, section number, sha, and any path in its checks'
 *     `with:` settings) — and ONLY when the gate would accept it: the section reads the same in both files;
 *   - `policies/VERSION` takes a patch bump, `policies/history/<previous>/` freezes the policies as they were, and
 *     `policies/CHANGELOG.md` gets a "relocated" entry that names every section it carried (the gate's section review);
 *   - a row the gate would refuse is left exactly as it is and named in the lines, never rewritten.
 *
 * The rows keep their start: a relocation is the same rule, not a new one, so nothing is stamped.
 *
 * Permanent, not part of the bridge: it is how a framework file move reaches an org's rows after 2.0.0 (T8).
 */
import { run as runProcess } from "../run-process.js";
import { parseRuleStore, type RuleRow } from "../rules/model/rule-row.js";
import { policySections } from "../rules/checks/sections.js";
import { POLICY_PR_PATHS, nextVersion, readVersion } from "../rules/policy-pr/gate.js";
import { dumpStore, policyPrWriter } from "../rules/policy-pr/write.js";
import { fsTree, gitTree, type TreeReader, type TreeWriter } from "../rules/policy-pr/tree.js";
import { SPEC_SPLITS, isRelocation, readDocFrom, relocatedPath, relocatedSection, sectionBody, type Relocation } from "../rules/policy-pr/relocation.js";
import { renderReviewLine } from "../rules/policy-pr/reviewed.js";
import type { GitRead } from "../cli/policy-gate-io.js";

export interface RelocatedRows {
  /** Ids of the rows re-sourced. */
  readonly relocated: readonly string[];
  /** Rows the gate would refuse (the cited text changed): left as they were, with why. */
  readonly left: readonly string[];
  /** The new `policies/VERSION`, or null when nothing was written. */
  readonly version: string | null;
}

const NOTHING: RelocatedRows = { relocated: [], left: [], version: null };

/** A path (or a list of paths) with every moved one replaced; the same value when none moved. */
function movePaths(v: unknown, moves: readonly Relocation[]): unknown {
  if (typeof v === "string") {
    for (const m of moves) { const to = relocatedPath(v, m); if (to !== null) return to; }
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => movePaths(x, moves));
  return v;
}

/** The row `row` becomes when the file it cites moved, or null when nothing it names moved. */
function relocatedRow(row: RuleRow, moves: readonly Relocation[], head: TreeReader): RuleRow | null {
  let source = row.source;
  for (const m of moves) {
    const doc = relocatedPath(row.source.doc, m);
    if (doc === null || doc === row.source.doc) continue;
    const section = relocatedSection(row.source.section, m);
    if (section === null) continue; // a split sends this chapter elsewhere
    const text = head.read(doc);
    const found = text === null ? null : sectionBody(text, section);
    if (!found) continue;
    source = { ...row.source, doc, section, sha: found.sha };
    break;
  }
  const checks = (row.checks ?? []).map((c) => (c.with ? { ...c, with: Object.fromEntries(Object.entries(c.with).map(([k, v]) => [k, movePaths(v, moves)])) } : c));
  const next: RuleRow = { ...row, source, ...(row.checks ? { checks } : {}) };
  return JSON.stringify(next) === JSON.stringify(row) ? null : next;
}

/** Insert the changelog entry for `version`, newest first. */
function addEntry(head: TreeWriter, entry: string): void {
  const text = head.read(POLICY_PR_PATHS.changelog);
  if (text === null || !text.trim()) {
    head.write(POLICY_PR_PATHS.changelog, `# Policy changelog\n\nNewest first. Each entry is written by the pull request that changes \`policies/\`.\n\n${entry}`);
    return;
  }
  const lines = text.split("\n");
  const first = lines.findIndex((l) => /^## \d+\.\d+\.\d+\b/.test(l));
  head.write(POLICY_PR_PATHS.changelog, first < 0
    ? `${text.replace(/\n*$/, "")}\n\n${entry}`
    : [...lines.slice(0, first), ...entry.split("\n"), ...lines.slice(first)].join("\n"));
}

/**
 * Pure over two trees: `base` is the org's repository before the upgrade, `head` after the files moved. Re-sources
 * the rows, bumps the patch version, freezes the snapshot and writes the changelog entry.
 */
export function relocateRows(base: TreeReader, head: TreeWriter, moves: readonly Relocation[], today: string): RelocatedRows {
  const text = head.read(POLICY_PR_PATHS.rules);
  if (text === null) return NOTHING;
  const rows = parseRuleStore(text);
  const all = [...moves, ...SPEC_SPLITS];
  const readDoc = readDocFrom(base, head);
  const relocated: string[] = [], left: string[] = [];
  const carried = new Map<string, Set<string>>(); // new document → its sections the relocated rows cite
  const next = rows.map((row) => {
    if (row.end !== null) return row;
    const cand = relocatedRow(row, all, head);
    if (cand === null) return row;
    if (!isRelocation(row, cand, all, readDoc)) { left.push(`${row.id}: the text it cites changed, so it is not a relocation`); return row; }
    relocated.push(row.id);
    (carried.get(cand.source.doc) ?? carried.set(cand.source.doc, new Set()).get(cand.source.doc)!).add(cand.source.section);
    return cand;
  });
  if (!relocated.length) return { relocated, left, version: null };

  head.write(POLICY_PR_PATHS.rules, dumpStore(text, next));
  const prev = readVersion(base);
  const w = policyPrWriter({ base, head });
  const bumped = w.bumpVersion("patch");
  const version = bumped.version === prev ? nextVersion(prev, "patch") : bumped.version;
  if (!bumped.wrote) head.write(POLICY_PR_PATHS.version, `${version}\n`);
  w.writeSnapshot(prev);

  // The gate wants one review line for every section a changed document now holds (a moved file is all "changed").
  const reviews: string[] = [];
  for (const doc of [...carried.keys()].sort()) {
    const body = head.read(doc);
    if (body === null) continue;
    for (const s of policySections(body)) {
      if (s.section === "") continue;
      reviews.push(renderReviewLine({ doc, section: s.section, sha: s.sha, outcome: { kind: "no-rule" } }));
    }
  }
  const moved = [...carried.keys()].sort().map((d) => `\`${d}\``).join(", ");
  addEntry(head, [
    `## ${version} — ${today}`, "",
    `relocated: ${relocated.join(", ")} — re-sourced because the file each cites moved (${moved}); no rule changed.`, "",
    "**Sections reviewed**", "", ...reviews, "", "",
  ].join("\n"));
  return { relocated, left, version };
}

/** `git -C <repo> <args>` → stdout, or null. Never throws. */
const gitRead: GitRead = (repo, args) => {
  try { return runProcess("git", ["-C", repo, ...args], { pgm: "gov-work:maintain:upgrade-relocate", fn: "git-read" }); } catch { return null; /* the GitRead contract: null means git could not answer, and the caller reads it as "not there" */ }
};

/** The moves a run applied, as relocations: `plan` move actions that were written. */
export function appliedMoves(actions: readonly { readonly kind: string; readonly dst: string; readonly from?: string }[], applied: readonly string[]): Relocation[] {
  const written = new Set(applied);
  return actions.filter((a) => a.kind === "move" && a.from && written.has(a.dst)).map((a) => ({ from: a.from!, to: a.dst }));
}

/**
 * On disk: `adopterDir` after the files moved, against `baseRef` (the branch the upgrade started from). Returns the
 * lines the upgrade prints. A repository with no org rule store has nothing to carry.
 */
export function relocateOrgRows(adopterDir: string, baseRef: string, moves: readonly Relocation[], today: string = new Date().toISOString().slice(0, 10)): string[] {
  const r = relocateRows(gitTree(gitRead, adopterDir, baseRef), fsTree(adopterDir), moves, today);
  return [
    ...(r.relocated.length ? [`  org rules re-sourced to the files that moved (${r.relocated.length}): ${r.relocated.join(", ")} — policies/VERSION ${r.version}, a snapshot, and a "relocated" entry in policies/CHANGELOG.md`] : []),
    ...r.left.map((l) => `  ! ${l}; left as it is`),
  ];
}
