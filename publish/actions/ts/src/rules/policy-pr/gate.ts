// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE POLICY PULL REQUEST GATE (rule-model-design.md Q5, Q6, Q16; P1 "Org version"; W5).
 *
 * A change to `policies/` carries four things with it, and this gate checks that it does:
 *
 *   its RULES      every in-force row cites its section at the section's current sha; the store validates; the
 *                  store only grew (a row is closed, never edited or deleted; a retired id is never reused) —
 *                  save the one in-place edit Q17 allows: an open row's `source.sha` refreshed, nothing else;
 *   its VERSION    `policies/VERSION` bumped exactly as the change needs — minor when rows were added, revised or
 *                  retired, or who-owns-what changed (`policies/ownership.yaml`: a row added, removed or re-pointed);
 *                  patch when only prose did (a rule's or an ownership row's sha refresh included); major whenever
 *                  the org chooses — and not at all when `policies/` is untouched;
 *   its SNAPSHOT   `policies/version/<prev>/` is the base's `policies/` byte for byte (minus `version/` and
 *                  `actions/`), and nothing already frozen there was edited or deleted;
 *   its CHANGELOG  an entry for the new version naming every rule added, revised or retired.
 *
 * DETERMINISTIC (Q16): no LLM, no network, no clock. Both trees, the PR number and "today" are injected; the same
 * inputs give the same findings. When rows are stale the gate says so and names the fix (`gov rules propose`) —
 * running the proposer is a separate step (P3), never something a check does on its own.
 *
 * Pure over two {@link TreeReader}s.
 */
import { loadRuleStores, NO_ORG_VERSION, RULE_STORE_PATHS } from "../model/store-io.js";
import { inForce, parseRuleStore, type RuleRow } from "../model/rule-row.js";
import { sectionShas } from "../checks/sections.js";
import { treeAsGit, type TreeReader } from "./tree.js";
import { OWNERSHIP_PATH, ownershipDiffers, parseOwnership } from "../checks/ownership.js";

export const POLICY_PR_PATHS = {
  root: "policies",
  version: RULE_STORE_PATHS.orgVersion,
  changelog: "policies/CHANGELOG.md",
  rules: RULE_STORE_PATHS.orgRules,
  snapshots: "policies/version",
  actions: "policies/actions",
} as const;

/** `none` when `policies/` is untouched; otherwise the smallest bump the change needs (major is always allowed). */
export type RequiredBump = "none" | "patch" | "minor";
export type BumpKind = "patch" | "minor" | "major";

export type GateCheck =
  | "unreadable" | "sha" | "store" | "append-only" | "version" | "changelog" | "snapshot" | "snapshot-immutable" | "stamp";

export interface GateFinding {
  readonly check: GateCheck;
  readonly message: string;
}

/** What the change did to the org's rules, by id. */
export interface RuleChanges {
  readonly added: readonly string[];
  readonly revised: readonly string[];
  readonly retired: readonly string[];
  /** Rows kept with their section's new sha, refreshed in place (Q17) — prose changed, the rule did not. */
  readonly refreshed: readonly string[];
  /** Any row added, edited or removed, a sha refresh aside — the bump is then at least minor. */
  readonly rowsChanged: boolean;
}

export interface PolicyPrPlan {
  /** Did anything under `policies/` differ at all? `false` → the gate passes and nothing is expected (a). */
  readonly touched: boolean;
  readonly required: RequiredBump;
  readonly baseVersion: string;
  readonly headVersion: string;
  readonly changes: RuleChanges;
  /** Did who-owns-what change (a row added, removed, or its doc/section/role)? A sha alone is not. → minor. */
  readonly ownershipChanged: boolean;
}

export interface PolicyPrJudgement extends PolicyPrPlan {
  /** `cannot-tell` when a tree could not be read: reported, never read as a pass. */
  readonly verdict: "pass" | "fail" | "cannot-tell";
  readonly findings: readonly GateFinding[];
}

export interface PolicyPrInput {
  readonly base: TreeReader;
  readonly head: TreeReader;
  /** The pull request's number: new and closed rows carry it. */
  readonly pr: number;
  /** YYYY-MM-DD: new and closed rows carry it. */
  readonly today: string;
}

// ── version arithmetic ───────────────────────────────────────────────────────────────────────────────────────

export function nextVersion(v: string, kind: BumpKind): string {
  const [M = 0, m = 0, p = 0] = v.split(".").map(Number);
  if (kind === "major") return `${M + 1}.0.0`;
  if (kind === "minor") return `${M}.${m + 1}.0`;
  return `${M}.${m}.${p + 1}`;
}

/** The versions a change needing `required` may move to from `base`. */
export function allowedVersions(base: string, required: RequiredBump): string[] {
  if (required === "none") return [base];
  return [nextVersion(base, required), nextVersion(base, "major")];
}

const VERSION_RE = /^\d+\.\d+\.\d+$/;
export const readVersion = (t: TreeReader): string => t.read(POLICY_PR_PATHS.version)?.trim() || NO_ORG_VERSION;

// ── what is in a tree ────────────────────────────────────────────────────────────────────────────────────────

const isUnder = (f: string, dir: string): boolean => f.startsWith(`${dir}/`);

/**
 * The files a snapshot freezes: `policies/` minus `version/` (earlier snapshots) and `actions/` (executable code,
 * which is the Check Owner's and versioned by its own review). Keyed by path relative to `policies/`.
 * Null when the tree could not be listed.
 */
export function snapshotFiles(tree: TreeReader): Map<string, string> | null {
  const files = tree.files(POLICY_PR_PATHS.root);
  if (files === null) return null;
  const out = new Map<string, string>();
  for (const f of files) {
    if (isUnder(f, POLICY_PR_PATHS.snapshots) || isUnder(f, POLICY_PR_PATHS.actions)) continue;
    const text = tree.read(f);
    if (text === null) return null;
    out.set(f.slice(POLICY_PR_PATHS.root.length + 1), text);
  }
  return out;
}

/** Path → text for every file under `dir`; null when the tree could not be listed or read. */
function textsUnder(tree: TreeReader, dir: string): Map<string, string> | null {
  const files = tree.files(dir);
  if (files === null) return null;
  const out = new Map<string, string>();
  for (const f of files) {
    const t = tree.read(f);
    if (t === null) return null;
    out.set(f, t);
  }
  return out;
}

/** A row as one canonical string, so rows compare by value whatever order YAML wrote their keys in. */
function canon(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(",")}}`;
}
const withoutEnd = (r: RuleRow): string => canon({ ...r, end: undefined });
const withoutSha = (r: RuleRow): string => canon({ ...r, source: { ...r.source, sha: undefined } });

/**
 * Is `now` the open row `was` with ONLY its `source.sha` changed? The one in-place edit a store allows (Q17: "keep —
 * intent unchanged; only sha updated"): expectation, actor, level, cue, checks, start and everything else are
 * byte-identical, and both are still open. Shared by the gate's append-only check and the writers' stamping.
 */
export function isShaRefresh(was: RuleRow, now: RuleRow): boolean {
  return was.end === null && now.end === null && was.source?.sha !== now.source?.sha && withoutSha(was) === withoutSha(now);
}
const rowKey = (r: RuleRow): string => `${r.id}@${r.start?.version}`;

/**
 * Pair each head row with the base row it IS (same id and start; one base row per head row), so an edited row
 * and a closed row are told apart from a new one. Head rows with no base partner are new.
 */
function pairRows(base: readonly RuleRow[], head: readonly RuleRow[]): { pairs: Map<number, number>; fresh: number[] } {
  const free = new Map<string, number[]>();
  base.forEach((r, i) => free.set(rowKey(r), [...(free.get(rowKey(r)) ?? []), i]));
  const pairs = new Map<number, number>();
  const fresh: number[] = [];
  head.forEach((r, h) => {
    const list = free.get(rowKey(r));
    if (list && list.length) pairs.set(h, list.shift()!);
    else fresh.push(h);
  });
  return { pairs, fresh };
}

/** Added, revised and retired ids, from the base and head org stores. */
export function ruleChanges(base: readonly RuleRow[], head: readonly RuleRow[]): RuleChanges {
  const { pairs, fresh } = pairRows(base, head);
  const baseIds = new Set(base.map((r) => r.id));
  const added = [...new Set(fresh.map((h) => head[h]!.id).filter((id) => !baseIds.has(id)))];
  const revised: string[] = [], retired: string[] = [];
  const refreshed = [...pairs].filter(([h, b]) => isShaRefresh(base[b]!, head[h]!)).map(([h]) => head[h]!.id);
  const headOpen = new Set(inForce(head).map((r) => r.id));
  for (const [h, b] of pairs) {
    if (base[b]!.end === null && head[h]!.end !== null) {
      const successor = fresh.some((f) => head[f]!.id === base[b]!.id && head[f]!.end === null) && headOpen.has(base[b]!.id);
      (successor ? revised : retired).push(base[b]!.id);
    }
  }
  const rowsChanged = fresh.length > 0 || pairs.size !== base.length
    || [...pairs].some(([h, b]) => canon(head[h]) !== canon(base[b]) && !isShaRefresh(base[b]!, head[h]!));
  return { added, revised: [...new Set(revised)], retired: [...new Set(retired)], refreshed, rowsChanged };
}

function readRows(tree: TreeReader): RuleRow[] | string {
  const text = tree.read(POLICY_PR_PATHS.rules);
  if (text === null) return [];
  try { return parseRuleStore(text); } catch (e) { return `${POLICY_PR_PATHS.rules} does not parse: ${(e as Error).message}`; }
}

/** Is `f` a file whose change needs a version bump? Not VERSION, the changelog or a snapshot: those ARE the bump. */
const isContent = (f: string): boolean =>
  f !== POLICY_PR_PATHS.version && f !== POLICY_PR_PATHS.changelog && !isUnder(f, POLICY_PR_PATHS.snapshots);

/**
 * What the change is and what it therefore needs — shared by the gate and by propose's writers, so the two can
 * never disagree about which bump a change needs. Null with a reason when a tree could not be read.
 */
export function planPolicyPr(base: TreeReader, head: TreeReader): PolicyPrPlan | { readonly unreadable: string } {
  const b = textsUnder(base, POLICY_PR_PATHS.root), h = textsUnder(head, POLICY_PR_PATHS.root);
  if (b === null) return { unreadable: "the base's policies/ could not be read" };
  if (h === null) return { unreadable: "the head's policies/ could not be read" };
  const differs = (f: string): boolean => b.get(f) !== h.get(f);
  const all = [...new Set([...b.keys(), ...h.keys()])];
  const touched = all.some(differs);
  const contentChanged = all.filter(isContent).some(differs);
  const baseRows = readRows(base), headRows = readRows(head);
  if (typeof baseRows === "string") return { unreadable: `base: ${baseRows}` };
  if (typeof headRows === "string") return { unreadable: `head: ${headRows}` };
  const changes = ruleChanges(baseRows, headRows);
  const baseOwn = parseOwnership(b.get(OWNERSHIP_PATH) ?? "[]"), headOwn = parseOwnership(h.get(OWNERSHIP_PATH) ?? "[]");
  if ("error" in baseOwn) return { unreadable: `base: ${OWNERSHIP_PATH} ${baseOwn.error}` };
  if ("error" in headOwn) return { unreadable: `head: ${OWNERSHIP_PATH} ${headOwn.error}` };
  const ownershipChanged = ownershipDiffers(baseOwn, headOwn);
  const required: RequiredBump = !contentChanged ? "none" : changes.rowsChanged || ownershipChanged ? "minor" : "patch";
  return { touched, required, baseVersion: readVersion(base), headVersion: readVersion(head), changes, ownershipChanged };
}

// ── the CHANGELOG's entries ──────────────────────────────────────────────────────────────────────────────────

const ENTRY_HEADING = /^## (\d+\.\d+\.\d+)\b/;

/** The text of the entry for `version` (its heading up to the next entry), or null. */
export function changelogEntry(changelog: string, version: string): string | null {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((l) => ENTRY_HEADING.exec(l)?.[1] === version);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (ENTRY_HEADING.test(lines[i]!)) { end = i; break; }
  return lines.slice(start, end).join("\n");
}

const mentions = (text: string, id: string): boolean =>
  new RegExp(`(?<![A-Za-z0-9-])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`).test(text);

// ── the gate ─────────────────────────────────────────────────────────────────────────────────────────────────

export function judgePolicyPr(input: PolicyPrInput): PolicyPrJudgement {
  const { base, head, pr, today } = input;
  const plan = planPolicyPr(base, head);
  if ("unreadable" in plan) {
    return {
      verdict: "cannot-tell", findings: [{ check: "unreadable", message: `${plan.unreadable}, so nothing was checked.` }],
      touched: false, required: "none", baseVersion: NO_ORG_VERSION, headVersion: NO_ORG_VERSION,
      changes: { added: [], revised: [], retired: [], refreshed: [], rowsChanged: false }, ownershipChanged: false,
    };
  }
  // (a) Nothing under policies/ changed: nothing to carry, nothing to bump.
  if (!plan.touched) return { ...plan, verdict: "pass", findings: [] };

  const findings: GateFinding[] = [];
  const f = (check: GateCheck, message: string) => findings.push({ check, message });
  const { required, baseVersion, headVersion } = plan;
  const baseRows = readRows(base) as RuleRow[], headRows = readRows(head) as RuleRow[];

  if (required !== "none") {
    checkShas(head, headRows, f);
    const cannot = checkStores(head, f);
    if (cannot) return { ...plan, verdict: "cannot-tell", findings: [{ check: "unreadable", message: cannot }, ...findings] };
    checkAppendOnly(baseRows, headRows, headVersion, f);
  }
  checkVersion(baseVersion, headVersion, required, f);
  if (required !== "none") {
    checkChangelog(head, headVersion, plan.changes, f);
    const cannot = checkSnapshot(base, head, baseVersion, f);
    if (cannot) return { ...plan, verdict: "cannot-tell", findings: [{ check: "unreadable", message: cannot }, ...findings] };
    checkStamps(baseRows, headRows, { version: headVersion, date: today, pr }, f);
  }
  const cannot = checkFrozen(base, head, required === "none" ? null : baseVersion, f);
  if (cannot) return { ...plan, verdict: "cannot-tell", findings: [{ check: "unreadable", message: cannot }, ...findings] };

  return { ...plan, verdict: findings.length ? "fail" : "pass", findings };
}

type Emit = (check: GateCheck, message: string) => void;

/** (b) Every row in force cites its section at the section's sha in the head's text. */
function checkShas(head: TreeReader, rows: readonly RuleRow[], f: Emit): void {
  const shas = new Map<string, Map<string, string> | null>();
  for (const r of inForce(rows)) {
    const doc = r.source?.doc;
    if (!doc) continue; // the store check reports a row with no source
    if (!shas.has(doc)) { const t = head.read(doc); shas.set(doc, t === null ? null : sectionShas(t)); }
    const s = shas.get(doc)!;
    if (s === null) { f("sha", `${r.id}: ${doc} no longer exists; run gov rules propose`); continue; }
    const now = s.get(r.source.section);
    if (now === undefined) f("sha", `${r.id}: ${doc} §${r.source.section} no longer exists; run gov rules propose`);
    else if (now !== r.source.sha) f("sha", `${r.id}: ${doc} §${r.source.section} changed; run gov rules propose`);
  }
}

/** (c) Both stores validate, and every binding resolves in the merged catalog — the reader's own diagnostics. */
function checkStores(head: TreeReader, f: Emit): string | null {
  const r = loadRuleStores(treeAsGit(head), "", "HEAD");
  if (!r.ok) return `the rule stores at the head could not be read (${r.reason}), so nothing was checked.`;
  for (const d of r.diagnostics) {
    // Notes about a gov repo the framework has not been upgraded into are not this pull request's doing.
    if (d.kind === "missing-framework-store" || d.kind === "missing-framework-catalog") continue;
    f("store", `${d.store} store: ${d.message}`);
  }
  return null;
}

/**
 * (d) The org store only grew: no base row removed or edited — save an open row's sha refreshed ({@link isShaRefresh});
 * a row closes only at the new version; no id reused.
 */
function checkAppendOnly(base: readonly RuleRow[], head: readonly RuleRow[], version: string, f: Emit): void {
  const { pairs, fresh } = pairRows(base, head);
  const paired = new Set(pairs.values());
  base.forEach((r, i) => {
    if (!paired.has(i)) f("append-only", `${r.id} (from ${r.start?.version}) was removed — the store is append-only: close a row, never delete it`);
  });
  for (const [h, b] of pairs) {
    const was = base[b]!, now = head[h]!;
    if (canon(was) === canon(now)) continue;
    if (was.end !== null) { f("append-only", `${was.id} (from ${was.start.version}) is already closed and was edited — history is never rewritten`); continue; }
    if (isShaRefresh(was, now)) continue;
    if (withoutEnd(was) !== withoutEnd(now)) { f("append-only", `${was.id} was edited in place — revise it instead: close it and open a successor`); continue; }
    if (now.end && now.end.version !== version) f("append-only", `${was.id} is closed at ${now.end.version}; it must close at the new version ${version}`);
  }
  const retiredInBase = new Set(base.filter((r) => r.end !== null && !base.some((o) => o.id === r.id && o.end === null)).map((r) => r.id));
  for (const id of new Set(fresh.map((h) => head[h]!.id))) {
    if (retiredInBase.has(id)) f("append-only", `${id} was retired before this change; a retired id is never reused — gov issues a new one`);
  }
}

/** (e) VERSION moved exactly as the change needs. */
function checkVersion(base: string, head: string, required: RequiredBump, f: Emit): void {
  if (!VERSION_RE.test(head)) { f("version", `${POLICY_PR_PATHS.version} is "${head}", not a version x.y.z`); return; }
  if (required === "none") {
    if (head !== base) f("version", `${POLICY_PR_PATHS.version} went from ${base} to ${head}, but nothing in the policy changed — put it back to ${base}`);
    return;
  }
  const [want, major] = allowedVersions(base, required);
  if (head === want || head === major) return;
  const why = required === "minor" ? "rules or section ownership changed" : "only prose changed";
  f("version", `${POLICY_PR_PATHS.version} is ${head}; ${why}, so it must be ${want} (or ${major} if the organization chooses a major version)`);
}

/** (f) The CHANGELOG has an entry for the new version naming every rule added, revised or retired. */
function checkChangelog(head: TreeReader, version: string, c: RuleChanges, f: Emit): void {
  const text = head.read(POLICY_PR_PATHS.changelog);
  const entry = text === null ? null : changelogEntry(text, version);
  if (entry === null) { f("changelog", `${POLICY_PR_PATHS.changelog} has no entry for ${version}`); return; }
  for (const [ids, change] of [[c.added, "added"], [c.revised, "revised"], [c.retired, "retired"]] as const) {
    for (const id of ids) if (!mentions(entry, id)) f("changelog", `the ${POLICY_PR_PATHS.changelog} entry for ${version} does not name ${id} (${change})`);
  }
}

/** (g) `policies/version/<prev>/` is the base's `policies/` byte for byte. */
function checkSnapshot(base: TreeReader, head: TreeReader, prev: string, f: Emit): string | null {
  const want = snapshotFiles(base);
  if (want === null) return "the base's policies/ could not be read, so the snapshot was not checked.";
  if (want.size === 0) return null; // nothing existed to freeze
  const dir = `${POLICY_PR_PATHS.snapshots}/${prev}`;
  const got = textsUnder(head, dir);
  if (got === null) return `${dir}/ could not be read, so the snapshot was not checked.`;
  if (got.size === 0) { f("snapshot", `no snapshot of ${prev}: ${dir}/ must hold the base's policies/ — run gov rules propose`); return null; }
  for (const [rel, text] of want) {
    const g = got.get(`${dir}/${rel}`);
    if (g === undefined) f("snapshot", `${dir}/${rel} is missing from the snapshot of ${prev}`);
    else if (g !== text) f("snapshot", `${dir}/${rel} differs from the base's policies/${rel}`);
  }
  for (const p of got.keys()) if (!want.has(p.slice(dir.length + 1))) f("snapshot", `${p} is in the snapshot of ${prev} but not in the base's policies/`);
  return null;
}

/** (h) Nothing already under `policies/version/` was edited or deleted, and no snapshot appeared but `prev`'s. */
function checkFrozen(base: TreeReader, head: TreeReader, prev: string | null, f: Emit): string | null {
  const b = textsUnder(base, POLICY_PR_PATHS.snapshots), h = textsUnder(head, POLICY_PR_PATHS.snapshots);
  if (b === null || h === null) return `${POLICY_PR_PATHS.snapshots}/ could not be read, so the frozen snapshots were not checked.`;
  for (const [p, text] of b) {
    const now = h.get(p);
    if (now === undefined) f("snapshot-immutable", `${p} was deleted — a snapshot is frozen`);
    else if (now !== text) f("snapshot-immutable", `${p} was edited — a snapshot is frozen`);
  }
  const dirOf = (p: string): string => p.slice(POLICY_PR_PATHS.snapshots.length + 1).split("/")[0]!;
  const baseDirs = new Set([...b.keys()].map(dirOf));
  const reported = new Set<string>();
  for (const p of h.keys()) {
    if (b.has(p)) continue;
    const d = dirOf(p);
    if (baseDirs.has(d)) f("snapshot-immutable", `${p} was added to the frozen snapshot of ${d}`);
    else if (d !== prev && !reported.has(d)) {
      reported.add(d);
      f("snapshot-immutable", `${POLICY_PR_PATHS.snapshots}/${d}/ is a new snapshot, but this change ${prev === null ? "bumps no version" : `freezes only ${prev}`}`);
    }
  }
  return null;
}

/** (i) New rows start, and newly closed rows end, at the new version, today, this PR. */
function checkStamps(base: readonly RuleRow[], head: readonly RuleRow[], at: { version: string; date: string; pr: number }, f: Emit): void {
  const { pairs, fresh } = pairRows(base, head);
  const show = (s: { version?: string; date?: string; pr?: number } | null) => (s ? `${s.version} · ${s.date} · #${s.pr ?? "?"}` : "none");
  const want = `${at.version} · ${at.date} · #${at.pr}`;
  for (const h of fresh) {
    const r = head[h]!, s = r.start;
    if (!s || s.version !== at.version || s.date !== at.date || s.pr !== at.pr) f("stamp", `${r.id} starts at ${show(s)}; a row this change opens starts at ${want}`);
  }
  for (const [h, b] of pairs) {
    const e = head[h]!.end;
    // The version is (d)'s to judge; here, the date and the PR.
    if (base[b]!.end === null && e && (e.date !== at.date || e.pr !== at.pr)) f("stamp", `${head[h]!.id} ends at ${show(e)}; a row this change closes ends at ${want}`);
  }
}

