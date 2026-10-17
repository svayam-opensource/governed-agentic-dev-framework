// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov upgrade --from <content>` runner — the fs-backed shell around the pure
 * overlay-sync engine. Walks the content source + the adopter workspace, plans
 * the migration, and (with --apply) writes it. Dry-run by default.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parseManifest, expandEntries, planUpgrade, applyUpgrade, formatPlan, MOVE_RECORD_PATH } from "./upgrade-sync.js";

const SKIP = new Set([".git", "node_modules"]);

/** Relative file paths under `root` (skips .git / node_modules). */
function walk(root: string, rel = ""): string[] {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const name of fs.readdirSync(abs)) {
    if (SKIP.has(name)) continue;
    const childRel = rel ? `${rel}/${name}` : name;
    const st = fs.statSync(path.join(root, childRel));
    if (st.isDirectory()) out.push(...walk(root, childRel));
    else out.push(childRel);
  }
  return out;
}

export interface UpgradeSyncResult { readonly code: number; readonly lines: readonly string[]; }


/**
 * WHAT THIS WORKSPACE HAS ALREADY MOVED (PRJ-121, 2026-09-23).
 *
 * A relocation runs ONCE. Without a record, a second `gov upgrade` would move a file the org has since put
 * back deliberately — and the org, not the framework, decides where its own content sits after the layout
 * change. Kept beside the content version, in the workspace, because it is a fact about THAT workspace.
 */
/**
 * Move one of the org's files, byte for byte, and take away the folders the move left EMPTY, up to the workspace.
 * An emptied folder is not harmless: `policies/version/` left behind, empty, is still the name `policies/VERSION`
 * on a case-insensitive disk, and the file could not be written beside it (Policy Owner, 2026-10-07).
 */
function moveInWorkspace(adopterDir: string): (from: string, to: string) => void {
  return (from, to) => {
    const src = path.join(adopterDir, from), dst = path.join(adopterDir, to);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);                       // byte for byte: a move, never a rewrite
    log("info", "moved a file for the new layout", "gov-work:maintain:upgrade-run", "moveAdopter", { from, to });
    const root = path.resolve(adopterDir);
    for (let d = path.dirname(path.resolve(src)); d.startsWith(`${root}${path.sep}`); d = path.dirname(d)) {
      try { if (fs.readdirSync(d).length) break; fs.rmdirSync(d); }
      catch { break; /* not there, or not ours to remove — an empty folder left is the old behaviour, not a failure */ }
    }
  };
}

/**
 * THE MOVE RECORD (PRJ-121 intent 01, spec §3.7, Policy Owner ruling Q5): `framework/upgrade-moves.json`, listed in
 * the MANIFEST's `generated:` list — never shipped, never retired, written only by `gov upgrade` (with `--pr`, on the
 * upgrade branch, so it arrives inside the upgrade pull request).
 */
export const MOVES_FILE = MOVE_RECORD_PATH;
/**
 * BRIDGE — the 1.x record at the repository root. Read only while a workspace has no record at MOVES_FILE yet, so a
 * repo the bridge (B05) has not reached keeps its relocations done and nothing moves twice. Never written. The
 * bridge moves the file once; D01 deletes this reader, and 2.0.0 reads only MOVES_FILE.
 */
export const LEGACY_MOVES_FILE = ".gov-upgrade-moves.json";

/**
 * THE RECORD'S FORMAT. A JSON array of `{ "move": "<from> → <to>", "version": "<the gov that applied it>" }` — a
 * directory move ONCE, as the directory (`"policies/version/ → policies/history/"`), never one entry per file.
 * `version` is null for a relocation carried over from a record that did not say which gov applied it.
 *
 * The reader also accepts the bare string `"<from> → <to>"`: the root record's form, which every 1.x gov wrote beside
 * the object so a gov one minor release older kept reading it. Only the root file needed that, and no gov older than
 * this one reads MOVES_FILE, so this file is written as objects only. Per-file strings written before 2026-10-12 still
 * count: any one of them under a declared directory move is that directory move applied (upgrade-sync
 * `directoryMoveDone`).
 */
export interface MoveRecord { readonly move: string; readonly version: string | null }

function readRecordAt(file: string): unknown[] | null {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch { return null; /* nothing moved yet — the ordinary case for every workspace but the one mid-upgrade */ }
}
function readMovesFile(adopterDir: string): unknown[] {
  return readRecordAt(path.join(adopterDir, MOVES_FILE)) ?? readRecordAt(path.join(adopterDir, LEGACY_MOVES_FILE)) ?? [];
}

/** Every relocation recorded here, with the gov version that applied it when that was recorded. */
export function moveRecords(adopterDir: string): MoveRecord[] {
  const out = new Map<string, string | null>();
  for (const e of readMovesFile(adopterDir)) {
    if (typeof e === "string") { if (!out.has(e)) out.set(e, null); }
    else if (e && typeof e === "object" && typeof (e as { move?: unknown }).move === "string") {
      const v = (e as { version?: unknown }).version;
      out.set((e as { move: string }).move, typeof v === "string" ? v : out.get((e as { move: string }).move) ?? null);
    }
  }
  return [...out].map(([move, version]) => ({ move, version }));
}

/** The ids of the relocations already carried out here (`<from> → <to>`). */
export function doneMoves(adopterDir: string): string[] { return moveRecords(adopterDir).map((r) => r.move); }

/**
 * Record one relocation at MOVES_FILE. The first write carries every relocation the workspace already records — the
 * root record's included, while the bridge has not moved it — so the record at the new path is complete on its own.
 */
function recordMove(adopterDir: string, id: string, version: string): void {
  const all = moveRecords(adopterDir);
  if (!all.some((r) => r.move === id)) all.push({ move: id, version });
  const file = path.join(adopterDir, MOVES_FILE);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`);
  }
  catch (e) { log("warn", "could not record a relocation — it may be planned again", "gov-work:maintain:upgrade-run", "recordMove", { id, message: (e as Error)?.message }); }
}

/**
 * BRIDGE — THE ROOT RECORD MOVES ONCE (PRJ-121 intent 01, B05; spec §3.7, ruling Q5). A workspace gov 1.x upgraded
 * (svm-geneva) keeps its record at the repository root. The bridge carries every relocation it holds to MOVES_FILE —
 * together with any this run recorded there — and removes the root file, so 2.0.0, which never reads the root, finds
 * the complete record at the new path. Dry run: says so, writes nothing. Deleted in D01 with LEGACY_MOVES_FILE.
 */
export function moveRootRecord(adopterDir: string, apply: boolean): string[] {
  const root = path.join(adopterDir, LEGACY_MOVES_FILE);
  if (!fs.existsSync(root)) return [];
  const what = `${LEGACY_MOVES_FILE} → ${MOVES_FILE}`;
  if (!apply) return [`  ~ move     ${what}   (the move record, once — 2.0 reads it only under framework/)`];
  const merged = new Map<string, string | null>();
  const take = (entries: unknown[] | null): void => {
    for (const e of entries ?? []) {
      if (typeof e === "string") { if (!merged.has(e)) merged.set(e, null); continue; }
      if (!e || typeof e !== "object" || typeof (e as { move?: unknown }).move !== "string") continue;
      const { move, version } = e as { move: string; version?: unknown };
      merged.set(move, typeof version === "string" ? version : merged.get(move) ?? null);
    }
  };
  take(readRecordAt(path.join(adopterDir, MOVES_FILE)));
  take(readRecordAt(root));
  const file = path.join(adopterDir, MOVES_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify([...merged].map(([move, version]) => ({ move, version })), null, 2)}\n`);
  fs.rmSync(root);
  log("info", "moved the root move record under framework/", "gov-work:maintain:upgrade-run", "moveRootRecord", { relocations: merged.size });
  return [`  ${what}: the move record, moved once (${merged.size} relocation(s))`];
}

/**
 * THE NAMED MIGRATIONS. One entry per value that must LEAVE one file for another — the shape a straight move
 * cannot express. Each is versioned by its name: a manifest naming one an older CLI lacks is left undone, for
 * the upgrade that knows it, rather than half-applied.
 */
/** What a migration may need beyond the workspace: the person's own home, for a setting that is theirs. */
interface MigrationContext {
  readonly userHome: string;
  readonly contentDir?: string;
  /** What a migration must SAY in the upgrade's report and PR body (D23: never silent), one line each. */
  readonly notes?: string[];
}

/** D23 (Policy Owner, 2026-10-13): the old file held no list, so gov's defaults apply — and the upgrade says so. */
export const NO_APPROVED_AGENTS_NOTE = "no approved_agents block found — gov defaults applied; edit governance.yaml if your org approves a different list";

/** true = ran · false = gov does not know it · a string = REFUSED, nothing written, and why. */
type Migration = (adopterDir: string, from: string, to: string, ctx: MigrationContext) => boolean | string;

const readIf = (p: string): string | null => (fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, "utf8") : null);

/** The split's inputs, as the workspace will have them when the migration runs: a file the upgrade creates first is the template. */
function splitInputs(adopterDir: string, contentDir?: string): SplitInput | null {
  const cfg = readIf(path.join(adopterDir, "org-config.yaml"));
  if (cfg === null) return null;
  const either = (rel: string): string | null => readIf(path.join(adopterDir, rel)) ?? (contentDir ? readIf(path.join(contentDir, rel)) : null);
  return { orgConfig: cfg, governance: either(GOVERNANCE_PATH), roleList: either(ROLE_LIST_PATH) };
}

/** What the split would lose here — empty when every value is carried. Used by the plan, before anything is written. */
export function checkOrgConfigSplit(adopterDir: string, contentDir?: string): string[] {
  const input = splitInputs(adopterDir, contentDir);
  return input ? splitLoss(input, splitOrgConfig(input)) : [];
}

const MIGRATIONS: Record<string, Migration> = {
  /**
   * THE ORG-CONFIG SPLIT (Policy Owner, 2026-10-06) — see maintain/org-config-split.ts. Writes nothing unless every
   * value gov reads is carried; then governance.yaml, the role list and org-config.yaml, and this person's work root
   * when the org's was not the default.
   */
  "org-config-split": (adopterDir, _from, _to, ctx) => {
    const input = splitInputs(adopterDir, ctx.contentDir);
    if (input === null) return true;                                   // no org-config: nothing to split
    const out = splitOrgConfig(input);
    const lost = splitLoss(input, out);
    if (lost.length) {
      log("warn", "org-config split refused — it would lose values", "gov-work:maintain:upgrade-run", "migrate", { lost });
      return `it would lose ${lost.join(", ")} — reconcile org-config.yaml and ${GOVERNANCE_PATH} by hand`;
    }
    if (out.workRoot !== null && !recordWorkRoot(readTopLevelScalar(input.orgConfig, "github_org") ?? "", out.workRoot, ctx.userHome)) {
      return `could not record your work root (${out.workRoot}) in ~/.gov/work-roots — nothing moved`;
    }
    const write = (rel: string, text: string | null, was: string | null): void => {
      if (text === null || text === was) return;
      fs.mkdirSync(path.dirname(path.join(adopterDir, rel)), { recursive: true });
      fs.writeFileSync(path.join(adopterDir, rel), text, "utf8");
    };
    write(GOVERNANCE_PATH, out.governance, readIf(path.join(adopterDir, GOVERNANCE_PATH)));
    write(ROLE_LIST_PATH, out.roleList, readIf(path.join(adopterDir, ROLE_LIST_PATH)));
    write("org-config.yaml", out.orgConfig, input.orgConfig);
    log("info", "split org-config.yaml: governance choices to policies/governance.yaml", "gov-work:maintain:upgrade-run", "migrate", { workRoot: out.workRoot });
    return true;
  },
  /**
   * THE ORG'S AGENTS LEAVE llm-governance.md (Policy Owner, 2026-09-23) — for policies/governance.yaml since the
   * org-config split; the name is the migration's history.
   *
   * The only relocation a straight move cannot express: a VALUE moves between two files of different shapes.
   * The list is what a joiner is governed by, so losing it silently would send every joiner to gov's own
   * defaults — the exact failure a walk found when the fence had never been committed.
   *
   * Nothing is written unless the list is read, and the old file is removed only after the new one is written.
   */
  "approved-agents-to-org-config": (adopterDir, from, to, ctx) => {
    const fromPath = path.join(adopterDir, from), toPath = path.join(adopterDir, to);
    const policy = fs.existsSync(fromPath) ? fs.readFileSync(fromPath, "utf8") : null;
    const agents = parseApprovedAgents(policy);
    if (!agents?.length) {
      // No block, or an empty one: there is nothing to carry. The file still goes (the framework no longer
      // ships it), but the org is left with gov's defaults, which is what it already had.
      fs.rmSync(fromPath, { force: true });
      log("info", "no approved-agent block to migrate — removed the retired file", "gov-work:maintain:upgrade-run", "migrate", { from });
      // Gov's defaults are what an unset list reads as; leave governance.yaml unset, and SAY it (D23).
      if (policy !== null) ctx.notes?.push(`\`${from}\`: ${agents === null ? NO_APPROVED_AGENTS_NOTE : NO_APPROVED_AGENTS_NOTE.replace("no approved_agents block found", "the approved_agents block is empty")}`);
      return true;
    }
    const cfg = fs.existsSync(toPath) ? fs.readFileSync(toPath, "utf8") : null;
    if (cfg === null) return false;                         // no file to write into: leave everything alone
    // GOV-FRM-445: governance.yaml that already names its agents is the org's answer — only an unset list is filled.
    if (readAuthorizedAgents(cfg).kind !== "unset") {
      fs.rmSync(fromPath, { force: true });
      log("info", `${to} already names the org's agents — kept; the retired file removed`, "gov-work:maintain:upgrade-run", "migrate", { from });
      return true;
    }
    const next = withAuthorizedAgents(cfg, agents);
    if (next === null) { fs.rmSync(fromPath, { force: true }); return true; }   // already there
    fs.writeFileSync(toPath, next, "utf8");
    fs.rmSync(fromPath, { force: true });
    log("info", `carried the org's agents into ${to}`, "gov-work:maintain:upgrade-run", "migrate", { agents: agents.map((a) => a.id) });
    return true;
  },
};

export function migrationNames(): string[] { return Object.keys(MIGRATIONS); }

/**
 * Remove a retired file or directory — but never a `generated:` file under it (§3.7): a retired directory that holds the
 * move record (the old world's `framework/`) goes, and the record, written earlier in the same run, stays.
 */
function removeKeepingGenerated(adopterDir: string, generated: readonly string[]): (rel: string) => void {
  const keep = [MOVE_RECORD_PATH, ...generated];
  return (rel) => {
    const kept = keep.filter((g) => rel.endsWith("/") && g.startsWith(rel)).map((g) => [g, readIf(path.join(adopterDir, g))] as const).filter(([, t]) => t !== null);
    fs.rmSync(path.join(adopterDir, rel.replace(/\/$/, "")), { recursive: true, force: true });
    for (const [g, t] of kept) { fs.mkdirSync(path.dirname(path.join(adopterDir, g)), { recursive: true }); fs.writeFileSync(path.join(adopterDir, g), t!); }
  };
}

/** The plan's view of a migration's losses (upgrade-sync `checkMigration`). */
function checkMigration(adopterDir: string, contentDir: string): (how: string) => readonly string[] {
  return (how) => (how === "org-config-split" ? checkOrgConfigSplit(adopterDir, contentDir) : []);
}

function runMigration(adopterDir: string, ctx: MigrationContext): (how: string, from: string, to: string) => boolean | string {
  return (how, from, to) => {
    const run = MIGRATIONS[how] ?? BRIDGE_MIGRATIONS[how];
    if (!run) {
      log("warn", "a migration this gov does not know — left undone", "gov-work:maintain:upgrade-run", "migrate", { how, from, to });
      return false;
    }
    return run(adopterDir, from, to, ctx);
  };
}

/** The manifest's plan plus what an extension (the bridge) adds — its actions after the manifest's, its left-alone list. */
function extendPlan(base: UpgradePlan, ext: UpgradeExtension, adopterDir: string, contentDir: string): { plan: UpgradePlan; leftInPlace: readonly LeftInPlace[] } {
  const more = ext.plan?.(adopterDir, contentDir, base);
  return more ? { plan: { actions: [...base.actions, ...more.actions] }, leftInPlace: more.leftInPlace } : { plan: base, leftInPlace: [] };
}

/** `govVersion`: the gov applying the upgrade, named in the record of each relocation — else the content's VERSION, which a release keeps equal to its CLI's. */
/** `seed`: `gov setup` seeding a new workspace — a seed-new starter is created like seed-once (spec §3.2). */
export function runUpgradeSync(contentDir: string, adopterDir: string, opts: { apply: boolean; userHome?: string; govVersion?: string; seed?: boolean; extension?: UpgradeExtension } & WorkflowOpts): UpgradeSyncResult {
  const manifestPath = path.join(contentDir, "MANIFEST.yaml");
  if (!fs.existsSync(manifestPath)) return { code: 1, lines: [`gov upgrade: no MANIFEST.yaml under ${contentDir}`] };

  const manifest = parseManifest(fs.readFileSync(manifestPath, "utf8"));
  const entries = expandEntries(manifest, walk(contentDir));
  const readContent = (rel: string): string | null => {
    const p = path.join(contentDir, rel);
    return fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, "utf8") : null;
  };
  const readAdopter = (rel: string): string | null => {
    const p = path.join(adopterDir, rel);
    return fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, "utf8") : null;
  };
  const { plan: extended } = extendPlan(planUpgrade(entries, { readContent, readAdopter, adopterPaths: () => walk(adopterDir), doneMoves: () => doneMoves(adopterDir), checkMigration: checkMigration(adopterDir, contentDir) }, manifest.moves, manifest.retire, manifest.owned, { seed: opts.seed === true, generated: manifest.generated }), opts.extension ?? BRIDGE, adopterDir, contentDir);
  // Commit 4 is a PROPOSAL, made only in an upgrade PR where it can be dropped (Q2): a direct --apply retires nothing it
  // would carry out of, so no clause of the org's is lost without a reviewable proposal.
  const plan: UpgradePlan = { actions: extended.actions.filter((a) => a.commit !== "proposed-prose") };

  // Read BEFORE the plan writes: the template the installed approver-check was copied from (Q9).
  const workflows = opts.seed ? null : installedWorkflowInputs(entries, readContent, readAdopter);
  if (!opts.apply) {
    const rerender = workflows ? rerenderInstalledWorkflows({ adopterDir, ...workflows, ...workflowPin(opts, contentDir, adopterDir), apply: false }).lines : [];
    return { code: 0, lines: ["gov upgrade — DRY RUN (no changes written):", "", ...formatPlan(plan), ...rerender, ...moveRootRecord(adopterDir, false), ...replaceFrameworkReadme(adopterDir, contentDir, false), "", "Re-run with --apply to write these changes."] };
  }

  const notes: string[] = [];
  const res = applyUpgrade(plan, {
    readContent,
    readAdopter,
    writeAdopter: (rel, text) => {
      const p = path.join(adopterDir, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, text);
    },
    removeAdopter: removeKeepingGenerated(adopterDir, manifest.generated),
    moveAdopter: moveInWorkspace(adopterDir),
    migrate: runMigration(adopterDir, { userHome: opts.userHome ?? os.homedir(), contentDir, notes }),
    recordMove: (id) => recordMove(adopterDir, id, opts.govVersion ?? contentVersion(contentDir)),
  });
  return {
    code: res.refused.length ? 1 : 0,
    lines: [
      `gov upgrade — applied ${res.applied.length} change(s)${res.skipped.length ? `, skipped ${res.skipped.length} conflict(s) for review:` : "."}`,
      ...res.skipped.map((s) => `  ! ${s} (org-customized — reconcile by hand)`),
      ...refusedLines(plan),
      ...res.why,
      ...notes.map((n) => `  ! ${n}`),
      ...moveRootRecord(adopterDir, true),
      ...replaceFrameworkReadme(adopterDir, contentDir, true),
      ...settleRoleList(adopterDir),
      ...(opts.seed ? [] : fillTokens(adopterDir, createdPaths(plan, res.applied))),
      ...(opts.seed ? [] : fillRunner(adopterDir, createdPaths(plan, res.applied))),
      ...refreshCodeowners(adopterDir),
      ...(workflows ? rerenderInstalledWorkflows({ adopterDir, ...workflows, ...workflowPin(opts, contentDir, adopterDir), apply: true }).lines : []),
    ],
  };
}

/** What re-rendering the installed workflows needs from the caller (B07, Q9). */
export interface WorkflowOpts {
  /** gov-checks.yml as `gov check install` renders it for this gov repo, installing `govPackage`; null = cannot. */
  readonly renderGovChecks?: (govPackage: string) => string | null;
  /** What a re-rendered gov-checks.yml installs instead of this gov, pinned (`gov upgrade --gov-package`). */
  readonly govPackage?: string;
}

/** The approver-check template before (this workspace's copy) and after (this content's) the upgrade. */
function installedWorkflowInputs(entries: readonly { src: string; dst: string }[], readContent: (rel: string) => string | null, readAdopter: (rel: string) => string | null): { oldApproverTemplate: string | null; newApproverTemplate: string | null } {
  const row = entries.find((e) => e.dst === APPROVER_TEMPLATE_POSIX);
  return {
    oldApproverTemplate: APPROVER_TEMPLATE_PATHS.map(readAdopter).find((t) => t !== null) ?? null,
    newApproverTemplate: row ? readContent(row.src) : null,
  };
}

function workflowPin(opts: { govVersion?: string } & WorkflowOpts, contentDir: string, adopterDir: string): Pick<RerenderInput, "govVersion" | "govPackage" | "renderGovChecks" | "runner"> {
  return {
    // Read when the re-render runs — after this upgrade's migrations, which may have written governance.yaml.
    runner: readGovernance(adopterDir).ci,
    govVersion: opts.govVersion ?? contentVersion(contentDir),
    ...(opts.govPackage ? { govPackage: opts.govPackage } : {}),
    ...(opts.renderGovChecks ? { renderGovChecks: opts.renderGovChecks } : {}),
  };
}

/**
 * THE ROLE LIST'S SEEDED TOKENS, SETTLED (F19). The shipped list names its holders by token; whatever seeded it — this
 * upgrade, or a setup — leaves none behind. A token cell takes the handle the org-config's pre-split key still names,
 * else `vacant` (the documented empty form). Only token cells are written (GOV-FRM-445). Run before CODEOWNERS is
 * regenerated, so the routing reads the settled list. Only in an adopter repo (one with org-config.yaml).
 */
export function settleRoleList(adopterDir: string): string[] {
  const at = (rel: string): string => path.join(adopterDir, rel);
  const cfg = readIf(at("org-config.yaml"));
  const list = readIf(at(ROLE_LIST_PATH));
  if (cfg === null || list === null) return [];
  const known = (token: string): string | null => {
    const key = ROLE_HOLDER_TOKENS[token];
    return key ? normalizeHandle(readTopLevelScalar(cfg, key)) : null;
  };
  const r = settleRoleListTokens(list, known);
  if (r.text === list) return [];
  fs.writeFileSync(at(ROLE_LIST_PATH), r.text, "utf8");
  log("info", "settled the role list's seeded tokens", "gov-work:maintain:upgrade-run", "settleRoleList", { filled: r.filled, vacated: r.vacated });
  return [
    `  ${ROLE_LIST_PATH}: ${[
      ...(r.filled.length ? [`filled ${r.filled.join(", ")} from org-config.yaml`] : []),
      ...(r.vacated.length ? [`${r.vacated.join(", ")} written as vacant — the Policy Owner holds them until the org names someone`] : []),
    ].join("; ")}`,
  ];
}

/** The files this run CREATED — planned `create` and actually written. Never a moved, updated or org-written file. */
export function createdPaths(plan: ReturnType<typeof planUpgrade>, applied: readonly string[]): string[] {
  const written = new Set(applied);
  return plan.actions.filter((a) => a.kind === "create" && written.has(a.dst)).map((a) => a.dst);
}

/**
 * EVERY FILE GOV CREATES HAS ITS ORG TOKENS FILLED (PRJ-121 intent 01, spec §3.8). Setup's sweep fills a new org
 * repo; this fills the files an UPGRADE created in this run — a seed-once policy a release added reaches the org
 * reading its name, not `<ORG_NAME>`. Only `created` (GOV-FRM-445: a file the org wrote is never rewritten, token or
 * not), only text files, only tokens org-config.yaml / policies/governance.yaml give a value (setupTokenValues), and
 * only in an adopter repo (one with org-config.yaml). Run after the role list is settled, so its holders keep the
 * upgrade's own rule (`settleRoleList`).
 */
export function fillTokens(adopterDir: string, created: readonly string[], today: string = new Date().toISOString().slice(0, 10)): string[] {
  const cfg = readIf(path.join(adopterDir, "org-config.yaml"));
  if (cfg === null || created.length === 0) return [];
  const values = setupTokenValues(cfg, readIf(path.join(adopterDir, GOVERNANCE_PATH)), today);
  const filled: string[] = [];
  for (const rel of created) {
    if (!/\.(md|ya?ml|json|txt)$/i.test(rel) && path.posix.basename(rel) !== "CODEOWNERS") continue;
    // The FRAMEWORK's files (framework/, agent/) are written byte for byte as shipped: their prose names tokens such as
    // `<ORG_NAME>` to explain them, and filling one would make the next upgrade see an edit and "update" it back.
    if (rel.startsWith("framework/") || rel.startsWith("agent/")) continue;
    const p = path.join(adopterDir, rel);
    const before = readIf(p);
    if (before === null) continue;
    const after = substituteTokens(before, values);
    if (after === before) continue;
    fs.writeFileSync(p, after, "utf8");
    filled.push(rel);
  }
  if (!filled.length) return [];
  log("info", "filled the org tokens in the files this upgrade created", "gov-work:maintain:upgrade-run", "fillTokens", { files: filled });
  return [`  org tokens filled in ${filled.length} file(s) this upgrade created: ${filled.join(", ")}`];
}

/**
 * A WORKFLOW GOV CREATES ASKS FOR THE ORGANIZATION'S RUNNER (`ci.runs_on`, config/ci-runner.ts). The framework ships
 * `.github/workflows/*.yml` asking for `ubuntu-latest`; the run that CREATES one writes the runner
 * policies/governance.yaml names. Only `created` — an existing workflow is the organization's (GOV-FRM-445) — and only
 * when a runner was chosen: none chosen, the shipped bytes stay. An unusable value is named, never written.
 */
export function fillRunner(adopterDir: string, created: readonly string[]): string[] {
  const workflows = created.filter((rel) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(rel));
  if (!workflows.length) return [];
  const runner = readGovernance(adopterDir).ci;
  if (runner.problem) return [`  ! ${GOVERNANCE_PATH} ${runner.problem} — left asking for ${runsOnYaml(DEFAULT_RUNS_ON)}: ${workflows.join(", ")}`];
  if (!runner.chosen) return [];
  const value = runsOnYaml(runner.runsOn);
  const filled: string[] = [];
  for (const rel of workflows) {
    const p = path.join(adopterDir, rel);
    const before = readIf(p);
    if (before === null) continue;
    const after = withRunsOn(before, value);
    if (after === before) continue;
    fs.writeFileSync(p, after, "utf8");
    filled.push(rel);
  }
  if (!filled.length) return [];
  log("info", "wrote the organization's runner into the workflows this upgrade created", "gov-work:maintain:upgrade-run", "fillRunner", { files: filled, runner: value });
  return [`  runner ${value} (ci.runs_on) written into ${filled.length} workflow(s) this upgrade created: ${filled.join(", ")}`];
}

/**
 * THE FRAMEWORK'S README, LEFT BY THE TEMPLATE COPY, BECOMES THE ORG'S (F22 — framework-readme.ts). Only a README
 * whose fingerprint is one the framework shipped, and only in an adopter repo (one with org-config.yaml): in the
 * framework's own checkout that README is the framework's. The org README's tokens are filled from org-config.yaml
 * and policies/governance.yaml, as setup fills them. Any other README is the org's and is never touched (GOV-FRM-445).
 */
export function replaceFrameworkReadme(adopterDir: string, contentDir: string, apply: boolean, today: string = new Date().toISOString().slice(0, 10)): string[] {
  const cfg = readIf(path.join(adopterDir, "org-config.yaml"));
  if (cfg === null) return [];
  const values = setupTokenValues(cfg, readIf(path.join(adopterDir, GOVERNANCE_PATH)), today);
  const text = settleFrameworkReadme(readIf(path.join(adopterDir, "README.md")), readIf(path.join(contentDir, "README.md")), (t) => substituteTokens(t, values));
  if (text === null) return [];
  const why = "the framework's own README, left by the template copy";
  if (!apply) return [`  ~ update   README.md   (${why} — replaced by the organization's README)`];
  fs.writeFileSync(path.join(adopterDir, "README.md"), text, "utf8");
  log("info", "replaced the framework's README left by the template copy with the org's", "gov-work:maintain:upgrade-run", "replaceFrameworkReadme", { path: "README.md" });
  return [`  README.md: ${why} — replaced by the organization's README`];
}

/**
 * CODEOWNERS FOLLOWS THE ROLE LIST (GOV-FRM-083). gov generates CODEOWNERS from policies/governance.yaml (the Policy and Check
 * Owners) and the org's role list (policies/common/authorized-representatives.md); a holder changes by a pull request to
 * those, and the file is regenerated here — the command `gov doctor`'s drift row names. Written only when it would
 * change, so an upgrade with nothing to route says nothing. No Policy Owner → untouched, and said: a file without
 * its floor protects nothing (config/codeowners.ts).
 */
export function refreshCodeowners(adopterDir: string): string[] {
  const read = (rel: string): string | null => {
    const p = path.join(adopterDir, rel);
    return fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, "utf8") : null;
  };
  if (read("org-config.yaml") === null) return [];
  const want = expectedCodeowners(read(GOVERNANCE_PATH), read(ROLE_LIST_PATH));
  if (want === null) return [`  CODEOWNERS not regenerated: ${GOVERNANCE_PATH} names no Policy Owner (policy_owner.github).`];
  if (read("CODEOWNERS") === want) return [];
  fs.writeFileSync(path.join(adopterDir, "CODEOWNERS"), want, "utf8");
  log("info", "regenerated CODEOWNERS from the role list", "gov-work:maintain:upgrade-run", "refreshCodeowners", {});
  return [`  regenerated CODEOWNERS from ${GOVERNANCE_PATH} and ${ROLE_LIST_PATH}`];
}

import { run as runProcess } from "../run-process.js";
import { rerenderInstalledWorkflows, type RerenderInput } from "./workflow-rerender.js";
import { WORKFLOW_TEMPLATE as APPROVER_TEMPLATE } from "./repo-protect.js";
import { OLD_APPROVER_TEMPLATE } from "./bridge/old-approver-template.js";

/** The template's path as the MANIFEST writes it (posix), whatever the OS. */
const APPROVER_TEMPLATE_POSIX = APPROVER_TEMPLATE.split(path.sep).join("/");
/**
 * Where a workspace may hold the approver-check template it installed from: today's path, then the 1.x path a
 * workspace still has before the upgrade that moves it.
 */
const APPROVER_TEMPLATE_PATHS = [...new Set([APPROVER_TEMPLATE_POSIX, OLD_APPROVER_TEMPLATE])];
import { expectedCodeowners } from "./roles-health.js";
import { ROLE_LIST_PATH, ROLE_HOLDER_TOKENS, settleRoleListTokens } from "../config/role-list.js";
import { normalizeHandle } from "../config/codeowners.js";
import { log } from "../log.js";
import { parseApprovedAgents, readAuthorizedAgents, withAuthorizedAgents } from "../config/approved-agents.js";
import { GOVERNANCE_PATH, readGovernance } from "../config/governance.js";
import { DEFAULT_RUNS_ON, runsOnYaml, withRunsOn } from "../config/ci-runner.js";
import { recordWorkRoot } from "../config/work-root.js";
import { readTopLevelScalar } from "../resolve/node-env.js";
import { settleFrameworkReadme } from "./framework-readme.js";
import { setupTokenValues, substituteTokens } from "../setup/create.js";
import { commitSubject, splitPlan, unrecognisedEntries, upgradePrBody, type LeftInPlace, type UpgradeCommit, type UpgradeExtension } from "./upgrade-commits.js";
import { BRIDGE } from "./bridge/index.js";
import { appliedMoves, relocateOrgRows } from "./upgrade-relocate.js";
import { BRIDGE_MIGRATIONS } from "./bridge/migrations.js";
import type { UpgradePlan } from "./upgrade-sync.js";
import { splitLoss, splitOrgConfig, type SplitInput } from "./org-config-split.js";

/** Each refused merge, with what it would have lost. A refusal is the one outcome the summary must never hide. */
function refusedLines(plan: ReturnType<typeof planUpgrade>): string[] {
  return plan.actions.filter((a) => a.kind === "refuse").map((a) => `  ✗ ${a.dst} NOT ${a.from && !a.how ? "moved" : "updated"}: ${a.detail ?? "the merge would lose a value"}`);
}

function git(dir: string, args: string[]): string {
  return runProcess("git", ["-C", dir, ...args], { pgm: "gov-work:maintain:upgrade-run", fn: "git" }).trim();
}
/** The line of a git failure that says what went wrong: its `fatal:` line, else the last one. */
function gitReason(message: string): string {
  const lines = message.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.find((l) => l.startsWith("fatal:")) ?? lines.pop() ?? "git failed";
}
function branchExists(dir: string, branch: string): boolean {
  try { git(dir, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]); return true; }
  catch { return false; /* rev-parse --verify exits non-zero for a ref that is not there: the ordinary case */ }
}
function contentVersion(dir: string): string {
  const p = path.join(dir, "VERSION");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8").trim() : "latest";
}
/**
 * Recompile the harness from the clauses this upgrade just wrote, and say what happened.
 *
 * INJECTED, NOT IMPORTED. The compiler lives in `cli/rules-lifecycle.ts`, and `maintain/` importing `cli/`
 * points the dependency the wrong way — it also produced a real load-order cycle through `src/index.ts`, which
 * re-exports `maintain/` before `cli/`, so `upgrade.ts` read `PACKAGE_NAME` before it was initialised and every
 * test file that touched `maintain/` failed to load. A port keeps the layering honest and the cycle impossible.
 */
export type CompileRules = (adopterDir: string) => readonly string[];

/** Create a gov-upgrade branch with the full plan applied, push it, open a PR. */
/** Open the pull request; returns its URL. Injected so a test never reaches gh. */
export type OpenPr = (args: { cwd: string; base: string; head: string; title: string; body: string }) => string;

const ghOpenPr: OpenPr = ({ cwd, base, head, title, body }) =>
  runProcess("gh", ["pr", "create", "--base", base, "--head", head, "--title", title, "--body", body], { cwd, pgm: "gov-work:maintain:upgrade-run", fn: "pr-create" }).trim();

export function runUpgradePr(contentDir: string, adopterDir: string, opts: { branch?: string; compileRules?: CompileRules; userHome?: string; openPr?: OpenPr; govVersion?: string; extension?: UpgradeExtension } & WorkflowOpts = {}): UpgradeSyncResult {
  if (!fs.existsSync(path.join(contentDir, "MANIFEST.yaml"))) return { code: 1, lines: [`gov upgrade: no MANIFEST.yaml under ${contentDir}`] };
  try { git(adopterDir, ["rev-parse", "--git-dir"]); } catch { /* not a git repository: the message below is the account of it */ return { code: 1, lines: ["gov upgrade --pr: not a git repository (or no remote). Use --apply for an in-place migration instead."] }; }
  if (git(adopterDir, ["status", "--porcelain"])) return { code: 1, lines: ["gov upgrade --pr: working tree has uncommitted changes — commit or stash first."] };

  const version = contentVersion(contentDir);
  const branch = opts.branch ?? `gov-upgrade-${version}`;
  const base = git(adopterDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  // A detached HEAD has no branch name to return to — its commit is the place to go back to.
  const returnTo = base === "HEAD" ? git(adopterDir, ["rev-parse", "HEAD"]) : base;

  const manifest = parseManifest(fs.readFileSync(path.join(contentDir, "MANIFEST.yaml"), "utf8"));
  const entries = expandEntries(manifest, walk(contentDir));
  const readContent = (rel: string): string | null => { const p = path.join(contentDir, rel); return fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, "utf8") : null; };
  const readAdopter = (rel: string): string | null => { const p = path.join(adopterDir, rel); return fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, "utf8") : null; };
  const ext = opts.extension ?? BRIDGE;
  const filesBefore = walk(adopterDir);
  const { plan, leftInPlace } = extendPlan(planUpgrade(entries, { readContent, readAdopter, adopterPaths: () => filesBefore, doneMoves: () => doneMoves(adopterDir), checkMigration: checkMigration(adopterDir, contentDir) }, manifest.moves, manifest.retire, manifest.owned, { generated: manifest.generated }), ext, adopterDir, contentDir);
  const workflows = installedWorkflowInputs(entries, readContent, readAdopter);
  if (plan.actions.every((a) => a.kind === "same" || a.kind === "keep" || a.kind === "starter") && !fs.existsSync(path.join(adopterDir, LEGACY_MOVES_FILE))) return { code: 0, lines: ["gov upgrade: workspace already matches content — nothing to do."] };
  // Before the branch exists: a PR that silently lacks the org-config merge would read as a complete upgrade.
  if (plan.actions.some((a) => a.kind === "refuse")) return { code: 1, lines: ["gov upgrade --pr: refused — nothing was written.", ...refusedLines(plan)] };
  // A refusal can only be found once the migration runs, if the workspace changed under the plan; the PR then stops.

  // A BRANCH LEFT BY AN EARLIER RUN (adoption walk #10): the usual cause is an upgrade PR that was closed or merged.
  // Say that, and the exact command, rather than a bare "already exists" — and change nothing.
  if (branchExists(adopterDir, branch)) {
    return { code: 1, lines: [
      `gov upgrade --pr: branch '${branch}' already exists in this clone — most likely left by an earlier \`gov upgrade --pr\`.`,
      `  If that PR is closed or merged, delete the branch and run again:  git -C ${adopterDir} branch -D ${branch}`,
      `  If that PR is still open, review and merge it instead — or upgrade on another branch: --branch <name>.`,
    ] };
  }
  try { git(adopterDir, ["checkout", "-b", branch]); } catch (e) { return { code: 1, lines: [`gov upgrade --pr: could not create branch '${branch}': ${(e as Error).message.split("\n")[0]}`] }; }
  // BACK TO WHERE IT WAS, whatever happens next (adoption walk #10). Left on the upgrade branch, a closed PR made
  // gov unable to resolve its own repository from this clone. The commit lives on the branch; the clone goes home.
  const goBack = (): string[] => {
    try { git(adopterDir, ["checkout", "-q", returnTo]); return [`  switched this clone back to ${base === "HEAD" ? returnTo.slice(0, 12) : base} — the upgrade is on ${branch}`]; }
    catch (e) { return [`  ⚠ could not switch this clone back to ${base}: ${(e as Error).message.split("\n")[0]} — run: git -C ${adopterDir} checkout ${returnTo}`]; }
  };
  const notes: string[] = [];
  const deps = {
    readContent, readAdopter,
    writeAdopter: (rel: string, t: string) => { const p = path.join(adopterDir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); },
    removeAdopter: removeKeepingGenerated(adopterDir, manifest.generated),
    moveAdopter: moveInWorkspace(adopterDir),
    migrate: runMigration(adopterDir, { userHome: opts.userHome ?? os.homedir(), contentDir, notes }),
    recordMove: (id: string) => recordMove(adopterDir, id, opts.govVersion ?? contentVersion(contentDir)),
  };
  // ── FOUR ORDERED COMMITS (Q6, upgrade-commits.ts) ──────────────────────────────────────────────────────────────
  // Each part is applied, then committed, before the next is applied; a part with nothing in it makes no commit.
  // The move record is written as the moves run but committed with the migrations (spec §4.2 commit 3).
  const parts = splitPlan(plan, manifest.owned);
  const commits: { commit: UpgradeCommit; files: number }[] = [];
  let appliedCount = 0;
  const applied: string[] = [];
  const commitPart = (commit: UpgradeCommit, exclude: readonly string[] = []): void => {
    git(adopterDir, ["add", "-A", "--", ".", ...exclude.map((e) => `:(exclude)${e}`)]);
    const staged = git(adopterDir, ["diff", "--cached", "--name-only"]);
    if (!staged) return;                                   // an empty commit is omitted
    git(adopterDir, ["commit", "-q", "-m", commitSubject(commit, version)]);
    commits.push({ commit, files: staged.split("\n").length });
  };
  const applyPart = (commit: UpgradeCommit): void => {
    // the PR diff IS the review — apply everything, conflicts included
    const done = applyUpgrade({ actions: parts[commit] }, deps, { includeConflicts: true }).applied;
    appliedCount += done.length;
    applied.push(...done);
  };
  let compiledLines: string[];
  let proposal: ReturnType<NonNullable<UpgradeExtension["propose"]>> = { substitutions: [], proposed: [] };
  try {
    applyPart("framework");
    commitPart("framework", [MOVES_FILE]);
    applyPart("org-moves");
    commitPart("org-moves", [MOVES_FILE]);
    applyPart("migrations");
    // ── THE RENDER TRAVELS WITH THE CLAUSES (design §7, PRJ-121, 2026-09-28) ─────────────────────────────────────
    //
    // `gov upgrade --pr` puts the framework's new clause text on a branch for review. The nine agent files are
    // COMPILED from that text, so a pull request carrying new clauses and the previous resident block is a pull
    // request that looks like it updates governance and does not: the reviewer approves the prose, the agents keep
    // reading the old rules, and nothing anywhere reports a mismatch. It is compiled once the org's rows have moved
    // too (commit 3), so the render reads the tree this PR leaves.
    //
    // FROM THE WORKING TREE, and this is the one place that word needs defending. The new clauses are on this
    // branch and nowhere else — the default branch still holds the OLD ones — so a default-branch read would
    // render the previous rules into the commit that ships the new ones. This is not the self-governance GOV-FRM-086 forbids:
    // the documents are the FRAMEWORK'S, arriving from published content, and the render is reviewed and ratified
    // in the same pull request as the clauses it came from. `rules()` prints "from the WORKING TREE (unratified)"
    // so the diff never claims otherwise.
    //
    // NO MARKER: nothing is ratified yet, so no session is stale. The marker is recorded by `--apply`, which does
    // put the new rules into force, and by `gov sync`.
    // Tokens are filled in every file this run created (§3.8) — with the migrations, once org-config is split.
    // The installed workflows travel in the same commit (Q9): the PR's own CI runs the gov that wrote them.
    const workflowLines = rerenderInstalledWorkflows({ adopterDir, ...workflows, ...workflowPin(opts, contentDir, adopterDir), apply: true }).lines;
    // The org's rules that cite a file this upgrade moved follow it, in this commit (spec §3.5, T8): re-sourced, patch bump, snapshot, entry.
    const relocationLines = relocateOrgRows(adopterDir, returnTo, appliedMoves(plan.actions, applied));
    compiledLines = [...moveRootRecord(adopterDir, true), ...fillTokens(adopterDir, createdPaths(plan, applied)), ...fillRunner(adopterDir, createdPaths(plan, applied)), ...relocationLines, ...workflowLines, ...(opts.compileRules ? opts.compileRules(adopterDir) : []), ...refreshCodeowners(adopterDir)];
    commitPart("migrations");
    proposal = ext.propose?.(adopterDir, contentDir) ?? proposal;   // reads what commit 4 retires, so before applying it
    applyPart("proposed-prose");
    commitPart("proposed-prose");
  } catch (e) {
    return { code: 1, lines: [`gov upgrade --pr: could not commit on ${branch}: ${(e as Error).message.split("\n")[0]}`, ...goBack()] };
  }
  if (!commits.length) {
    const back = goBack();
    try { git(adopterDir, ["branch", "-D", branch]); } catch { /* the branch is empty either way; the line below says what happened */ }
    return { code: 0, lines: ["gov upgrade: nothing changed on disk — nothing to commit, no branch left.", ...back] };
  }
  const body = upgradePrBody({
    version, plan, commits, leftInPlace, substitutions: proposal.substitutions, proposed: proposal.proposed, migrated: notes,
    unrecognised: unrecognisedEntries(filesBefore, plan, entries.map((e) => e.dst)),
  });
  try { git(adopterDir, ["push", "-u", "origin", branch]); } catch (e) { return { code: 1, lines: [`Applied on ${branch} but push failed: ${(e as Error).message.split("\n")[0]}`, ...goBack()] }; }
  let prUrl: string;
  try {
    prUrl = (opts.openPr ?? ghOpenPr)({ cwd: adopterDir, base, head: branch, title: `gov upgrade → framework content ${version}`, body });
  } catch (e) {
    return { code: 0, lines: [`Pushed ${branch} (open the PR manually — gh failed): ${(e as Error).message.split("\n")[0]}`, ...compiledLines, ...goBack()] };
  }
  return { code: 0, lines: [`Opened upgrade PR: ${prUrl}`, `  ${branch} → ${base} · ${appliedCount} file(s) changed in ${commits.length} commit(s): ${commits.map((c) => c.commit).join(" · ")}`, ...notes.map((n) => `  ! ${n}`), ...compiledLines, `  Review per-file; keep your customizations where the diff replaces them, then merge.`, ...goBack()] };
}

import * as os from "node:os";

/** The published framework repo — the default template source. */
export const DEFAULT_TEMPLATE = "https://github.com/svayam-opensource/governed-agentic-dev-framework.git";

/**
 * Fetch publish/content from the template remote into a temp dir (sparse, shallow
 * — only publish/content is materialized). Returns the content dir, the commit it
 * holds, and a cleanup fn. `ref` is a branch, a tag or a FULL commit sha — the
 * default ref is the commit gov was built from (build-identity.ts), which
 * `git clone --branch` cannot take, so this inits and fetches the one ref.
 * `templateUrl` may be a URL or a local path (for testing).
 */
export function fetchTemplateContent(templateUrl: string, ref: string): { contentDir: string; cleanup: () => void; commit: string | null } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gov-content-"));
  const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
  const g = (args: string[]): string => runProcess("git", ["-C", tmp, ...args], { pgm: "gov-work:maintain:upgrade-run", fn: "fetch-template" });
  try {
    g(["init", "-q"]);
    // THE BYTES AS COMMITTED. Git for Windows installs with core.autocrlf=true, so a checkout here wrote every text
    // file with CRLF — content that is not the framework's, whose fingerprint is not the one it was published with,
    // and which gov then copied into the organization's repository. This clone is a byte copy, not a working tree.
    g(["config", "core.autocrlf", "false"]);
    g(["remote", "add", "origin", templateUrl]);
    g(["sparse-checkout", "set", "publish/content"]);
    g(["fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", ref]);
    g(["checkout", "-q", "FETCH_HEAD"]);
  } catch (e) {
    cleanup();
    throw new Error(`could not fetch content from ${templateUrl}@${ref}: ${gitReason((e as Error).message)}`, { cause: e });
  }
  const contentDir = path.join(tmp, "publish", "content");
  if (!fs.existsSync(path.join(contentDir, "MANIFEST.yaml"))) {
    cleanup();
    throw new Error(`fetched ${templateUrl}@${ref} but publish/content/MANIFEST.yaml is not there`);
  }
  let commit: string | null = null;
  try { commit = g(["rev-parse", "HEAD"]).trim(); } catch { /* the content is there; only the label for a refusal is missing */ }
  return { contentDir, cleanup, commit };
}
