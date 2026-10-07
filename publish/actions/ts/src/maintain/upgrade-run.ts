// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov upgrade --from <content>` runner — the fs-backed shell around the pure
 * overlay-sync engine. Walks the content source + the adopter workspace, plans
 * the migration, and (with --apply) writes it. Dry-run by default.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parseManifest, expandEntries, planUpgrade, applyUpgrade, formatPlan } from "./upgrade-sync.js";

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

export const MOVES_FILE = ".gov-upgrade-moves.json";

export function doneMoves(adopterDir: string): string[] {
  try { return JSON.parse(fs.readFileSync(path.join(adopterDir, MOVES_FILE), "utf8")) as string[]; }
  catch { return []; /* nothing moved yet — the ordinary case for every workspace but the one mid-upgrade */ }
}

function recordMove(adopterDir: string, id: string): void {
  const all = [...new Set([...doneMoves(adopterDir), id])];
  try { fs.writeFileSync(path.join(adopterDir, MOVES_FILE), `${JSON.stringify(all, null, 2)}\n`); }
  catch (e) { log("warn", "could not record a relocation — it may be planned again", "gov-work:maintain:upgrade-run", "recordMove", { id, message: (e as Error)?.message }); }
}

/**
 * THE NAMED MIGRATIONS. One entry per value that must LEAVE one file for another — the shape a straight move
 * cannot express. Each is versioned by its name: a manifest naming one an older CLI lacks is left undone, for
 * the upgrade that knows it, rather than half-applied.
 */
/** What a migration may need beyond the workspace: the person's own home, for a setting that is theirs. */
interface MigrationContext { readonly userHome: string; readonly contentDir?: string }

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
  "approved-agents-to-org-config": (adopterDir, from, to) => {
    const fromPath = path.join(adopterDir, from), toPath = path.join(adopterDir, to);
    const policy = fs.existsSync(fromPath) ? fs.readFileSync(fromPath, "utf8") : null;
    const agents = parseApprovedAgents(policy);
    if (!agents?.length) {
      // No block, or an empty one: there is nothing to carry. The file still goes (the framework no longer
      // ships it), but the org is left with gov's defaults, which is what it already had.
      fs.rmSync(fromPath, { force: true });
      log("info", "no approved-agent block to migrate — removed the retired file", "gov-work:maintain:upgrade-run", "migrate", { from });
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

/** The plan's view of a migration's losses (upgrade-sync `checkMigration`). */
function checkMigration(adopterDir: string, contentDir: string): (how: string) => readonly string[] {
  return (how) => (how === "org-config-split" ? checkOrgConfigSplit(adopterDir, contentDir) : []);
}

function runMigration(adopterDir: string, ctx: MigrationContext): (how: string, from: string, to: string) => boolean | string {
  return (how, from, to) => {
    const run = MIGRATIONS[how];
    if (!run) {
      log("warn", "a migration this gov does not know — left undone", "gov-work:maintain:upgrade-run", "migrate", { how, from, to });
      return false;
    }
    return run(adopterDir, from, to, ctx);
  };
}

export function runUpgradeSync(contentDir: string, adopterDir: string, opts: { apply: boolean; userHome?: string }): UpgradeSyncResult {
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
  const plan = planUpgrade(entries, { readContent, readAdopter, adopterPaths: () => walk(adopterDir), doneMoves: () => doneMoves(adopterDir), checkMigration: checkMigration(adopterDir, contentDir) }, manifest.moves, manifest.retire);

  if (!opts.apply) {
    return { code: 0, lines: ["gov upgrade — DRY RUN (no changes written):", "", ...formatPlan(plan), "", "Re-run with --apply to write these changes."] };
  }

  const res = applyUpgrade(plan, {
    readContent,
    readAdopter,
    writeAdopter: (rel, text) => {
      const p = path.join(adopterDir, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, text);
    },
    removeAdopter: (rel) => fs.rmSync(path.join(adopterDir, rel.replace(/\/$/, "")), { recursive: true, force: true }),
    moveAdopter: moveInWorkspace(adopterDir),
    migrate: runMigration(adopterDir, { userHome: opts.userHome ?? os.homedir(), contentDir }),
    recordMove: (id) => recordMove(adopterDir, id),
  });
  return {
    code: res.refused.length ? 1 : 0,
    lines: [
      `gov upgrade — applied ${res.applied.length} change(s)${res.skipped.length ? `, skipped ${res.skipped.length} conflict(s) for review:` : "."}`,
      ...res.skipped.map((s) => `  ! ${s} (org-customized — reconcile by hand)`),
      ...refusedLines(plan),
      ...res.why,
      ...refreshCodeowners(adopterDir),
    ],
  };
}

/**
 * CODEOWNERS FOLLOWS THE ROLE LIST (GOV-FRM-083). gov generates CODEOWNERS from policies/governance.yaml (the Policy and Check
 * Owners) and the org's role list (policies/authorized-representatives.md); a holder changes by a pull request to
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
import { expectedCodeowners } from "./roles-health.js";
import { ROLE_LIST_PATH } from "../config/role-list.js";
import { log } from "../log.js";
import { parseApprovedAgents, readAuthorizedAgents, withAuthorizedAgents } from "../config/approved-agents.js";
import { GOVERNANCE_PATH } from "../config/governance.js";
import { recordWorkRoot } from "../config/work-root.js";
import { readTopLevelScalar } from "../resolve/node-env.js";
import { splitLoss, splitOrgConfig, type SplitInput } from "./org-config-split.js";

/** Each refused merge, with what it would have lost. A refusal is the one outcome the summary must never hide. */
function refusedLines(plan: ReturnType<typeof planUpgrade>): string[] {
  return plan.actions.filter((a) => a.kind === "refuse").map((a) => `  ✗ ${a.dst} NOT updated: ${a.detail ?? "the merge would lose a value"}`);
}

function git(dir: string, args: string[]): string {
  return runProcess("git", ["-C", dir, ...args], { pgm: "gov-work:maintain:upgrade-run", fn: "git" }).trim();
}
function contentVersion(dir: string): string {
  const p = path.join(dir, "VERSION");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8").trim() : "latest";
}
function upgradePrBody(version: string, appliedCount: number, plan: ReturnType<typeof planUpgrade>): string {
  const of = (k: string) => plan.actions.filter((a) => a.kind === k).map((a) => a.dst);
  const conflicts = of("conflict");
  const retired = of("retire");
  return [
    `Syncs this gov workspace to framework content **${version}** — generated by \`gov upgrade\`.`,
    ``,
    `- ${appliedCount} file(s) created / updated / retired.`,
    retired.length ? `- Retired under the new layout: ${retired.map((r) => `\`${r}\``).join(", ")}` : ``,
    ``,
    conflicts.length ? `**Review these carefully** — they differed from the framework baseline and may hold your customizations. This branch applies the framework version; restore your edits per-file in the diff where needed:` : `No customized files were touched.`,
    ...conflicts.map((c) => `- \`${c}\``),
    ``,
    `Everything else is framework-owned. Edit anything in this branch, then merge when the diff looks right.`,
  ].filter((l) => l !== undefined).join("\n");
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
export function runUpgradePr(contentDir: string, adopterDir: string, opts: { branch?: string; compileRules?: CompileRules; userHome?: string } = {}): UpgradeSyncResult {
  if (!fs.existsSync(path.join(contentDir, "MANIFEST.yaml"))) return { code: 1, lines: [`gov upgrade: no MANIFEST.yaml under ${contentDir}`] };
  try { git(adopterDir, ["rev-parse", "--git-dir"]); } catch { /* not a git repository: the message below is the account of it */ return { code: 1, lines: ["gov upgrade --pr: not a git repository (or no remote). Use --apply for an in-place migration instead."] }; }
  if (git(adopterDir, ["status", "--porcelain"])) return { code: 1, lines: ["gov upgrade --pr: working tree has uncommitted changes — commit or stash first."] };

  const version = contentVersion(contentDir);
  const branch = opts.branch ?? `gov-upgrade-${version}`;
  const base = git(adopterDir, ["rev-parse", "--abbrev-ref", "HEAD"]);

  const manifest = parseManifest(fs.readFileSync(path.join(contentDir, "MANIFEST.yaml"), "utf8"));
  const entries = expandEntries(manifest, walk(contentDir));
  const readContent = (rel: string): string | null => { const p = path.join(contentDir, rel); return fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, "utf8") : null; };
  const readAdopter = (rel: string): string | null => { const p = path.join(adopterDir, rel); return fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, "utf8") : null; };
  const plan = planUpgrade(entries, { readContent, readAdopter, adopterPaths: () => walk(adopterDir), doneMoves: () => doneMoves(adopterDir), checkMigration: checkMigration(adopterDir, contentDir) }, manifest.moves, manifest.retire);
  if (plan.actions.every((a) => a.kind === "same")) return { code: 0, lines: ["gov upgrade: workspace already matches content — nothing to do."] };
  // Before the branch exists: a PR that silently lacks the org-config merge would read as a complete upgrade.
  if (plan.actions.some((a) => a.kind === "refuse")) return { code: 1, lines: ["gov upgrade --pr: refused — nothing was written.", ...refusedLines(plan)] };
  // A refusal can only be found once the migration runs, if the workspace changed under the plan; the PR then stops.

  try { git(adopterDir, ["checkout", "-b", branch]); } catch { /* the branch already exists — the runner logged the git failure; the message below says what to do */ return { code: 1, lines: [`gov upgrade --pr: branch '${branch}' already exists — delete it or pass --branch <name>.`] }; }
  const res = applyUpgrade(plan, {
    readContent, readAdopter,
    writeAdopter: (rel, t) => { const p = path.join(adopterDir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); },
    removeAdopter: (rel) => fs.rmSync(path.join(adopterDir, rel.replace(/\/$/, "")), { recursive: true, force: true }),
    moveAdopter: moveInWorkspace(adopterDir),
    migrate: runMigration(adopterDir, { userHome: opts.userHome ?? os.homedir(), contentDir }),
    recordMove: (id) => recordMove(adopterDir, id),
  }, { includeConflicts: true }); // the PR diff IS the review — apply everything

  // ── THE RENDER TRAVELS IN THE SAME COMMIT AS THE CLAUSES (design §7, PRJ-121, 2026-09-28) ─────────────────
  //
  // `gov upgrade --pr` puts the framework's new clause text on a branch for review. The nine agent files are
  // COMPILED from that text, so a pull request carrying new clauses and the previous resident block is a pull
  // request that looks like it updates governance and does not: the reviewer approves the prose, the agents keep
  // reading the old rules, and nothing anywhere reports a mismatch.
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
  const compiledLines = [...(opts.compileRules ? opts.compileRules(adopterDir) : []), ...refreshCodeowners(adopterDir)];

  git(adopterDir, ["add", "-A"]);
  git(adopterDir, ["commit", "-m", `gov upgrade: sync framework content to ${version}`]);
  try { git(adopterDir, ["push", "-u", "origin", branch]); } catch (e) { return { code: 1, lines: [`Applied on ${branch} but push failed: ${(e as Error).message.split("\n")[0]}`] }; }
  let prUrl: string;
  try {
    prUrl = runProcess("gh", ["pr", "create", "--base", base, "--head", branch, "--title", `gov upgrade → framework content ${version}`, "--body", upgradePrBody(version, res.applied.length, plan)], { cwd: adopterDir, pgm: "gov-work:maintain:upgrade-run", fn: "pr-create" }).trim();
  } catch (e) {
    return { code: 0, lines: [`Pushed ${branch} (open the PR manually — gh failed): ${(e as Error).message.split("\n")[0]}`, ...compiledLines] };
  }
  return { code: 0, lines: [`Opened upgrade PR: ${prUrl}`, `  ${branch} → ${base} · ${res.applied.length} file(s) changed`, ...compiledLines, `  Review per-file; keep your customizations where the diff replaces them, then merge.`] };
}

import * as os from "node:os";

/** The published framework repo — the default template source. */
export const DEFAULT_TEMPLATE = "https://github.com/svayam-opensource/governed-agentic-dev-framework.git";

/**
 * Fetch publish/content from the template remote into a temp dir (sparse, shallow
 * — only publish/content is materialized). Returns the content dir + a cleanup fn.
 * `templateUrl` may be a URL or a local path (for testing).
 */
export function fetchTemplateContent(templateUrl: string, ref: string): { contentDir: string; cleanup: () => void } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gov-content-"));
  const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
  try {
    runProcess("git", ["clone", "--depth", "1", "--filter=blob:none", "--sparse", "--branch", ref, templateUrl, tmp], { pgm: "gov-work:maintain:upgrade-run", fn: "fetch-template" });
    runProcess("git", ["-C", tmp, "sparse-checkout", "set", "publish/content"], { pgm: "gov-work:maintain:upgrade-run" });
  } catch (e) {
    cleanup();
    throw new Error(`could not fetch content from ${templateUrl}@${ref}: ${(e as Error).message.split("\n").pop()}`, { cause: e });
  }
  const contentDir = path.join(tmp, "publish", "content");
  if (!fs.existsSync(path.join(contentDir, "MANIFEST.yaml"))) {
    cleanup();
    throw new Error(`fetched ${templateUrl}@${ref} but publish/content/MANIFEST.yaml is not there`);
  }
  return { contentDir, cleanup };
}
