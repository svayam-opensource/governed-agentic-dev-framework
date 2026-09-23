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
const MOVES_FILE = ".gov-upgrade-moves.json";

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
const MIGRATIONS: Record<string, (adopterDir: string, from: string, to: string) => boolean> = {
  /**
   * THE ORG'S AGENTS LEAVE llm-governance.md FOR org-config.yaml (Policy Owner, 2026-09-23).
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
    if (cfg === null) return false;                         // no org-config to write into: leave everything alone
    const next = withAuthorizedAgents(cfg, agents);
    if (next === null) { fs.rmSync(fromPath, { force: true }); return true; }   // already there
    fs.writeFileSync(toPath, next, "utf8");
    fs.rmSync(fromPath, { force: true });
    log("info", "carried the org's agents into org-config.yaml", "gov-work:maintain:upgrade-run", "migrate", { agents: agents.map((a) => a.id) });
    return true;
  },
};

export function migrationNames(): string[] { return Object.keys(MIGRATIONS); }

export function runUpgradeSync(contentDir: string, adopterDir: string, opts: { apply: boolean }): UpgradeSyncResult {
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
  const plan = planUpgrade(entries, { readContent, readAdopter, adopterPaths: () => walk(adopterDir), doneMoves: () => doneMoves(adopterDir) }, manifest.moves);

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
    moveAdopter: (from, to) => {
      const src = path.join(adopterDir, from), dst = path.join(adopterDir, to);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.renameSync(src, dst);                       // byte for byte: a move, never a rewrite
      log("info", "moved a file for the new layout", "gov-work:maintain:upgrade-run", "moveAdopter", { from, to });
    },
    migrate: (how, from, to) => {
      const run = MIGRATIONS[how];
      if (!run) {
        log("warn", "a migration this gov does not know — left undone", "gov-work:maintain:upgrade-run", "migrate", { how, from, to });
        return false;
      }
      return run(adopterDir, from, to);
    },
    recordMove: (id) => recordMove(adopterDir, id),
  });
  return {
    code: 0,
    lines: [
      `gov upgrade — applied ${res.applied.length} change(s)${res.skipped.length ? `, skipped ${res.skipped.length} conflict(s) for review:` : "."}`,
      ...res.skipped.map((s) => `  ! ${s} (org-customized — reconcile by hand)`),
    ],
  };
}

import { run as runProcess } from "../run-process.js";
import { log } from "../log.js";
import { parseApprovedAgents, withAuthorizedAgents } from "../config/approved-agents.js";

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

/** Create a gov-upgrade branch with the full plan applied, push it, open a PR. */
export function runUpgradePr(contentDir: string, adopterDir: string, opts: { branch?: string } = {}): UpgradeSyncResult {
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
  const plan = planUpgrade(entries, { readContent, readAdopter, adopterPaths: () => walk(adopterDir), doneMoves: () => doneMoves(adopterDir) }, manifest.moves);
  if (plan.actions.every((a) => a.kind === "same")) return { code: 0, lines: ["gov upgrade: workspace already matches content — nothing to do."] };

  try { git(adopterDir, ["checkout", "-b", branch]); } catch { /* the branch already exists — the runner logged the git failure; the message below says what to do */ return { code: 1, lines: [`gov upgrade --pr: branch '${branch}' already exists — delete it or pass --branch <name>.`] }; }
  const res = applyUpgrade(plan, {
    readContent, readAdopter,
    writeAdopter: (rel, t) => { const p = path.join(adopterDir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); },
    removeAdopter: (rel) => fs.rmSync(path.join(adopterDir, rel.replace(/\/$/, "")), { recursive: true, force: true }),
    moveAdopter: (from, to) => {
      const src = path.join(adopterDir, from), dst = path.join(adopterDir, to);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.renameSync(src, dst);                       // byte for byte: a move, never a rewrite
      log("info", "moved a file for the new layout", "gov-work:maintain:upgrade-run", "moveAdopter", { from, to });
    },
    migrate: (how, from, to) => {
      const run = MIGRATIONS[how];
      if (!run) {
        log("warn", "a migration this gov does not know — left undone", "gov-work:maintain:upgrade-run", "migrate", { how, from, to });
        return false;
      }
      return run(adopterDir, from, to);
    },
    recordMove: (id) => recordMove(adopterDir, id),
  }, { includeConflicts: true }); // the PR diff IS the review — apply everything

  git(adopterDir, ["add", "-A"]);
  git(adopterDir, ["commit", "-m", `gov upgrade: sync framework content to ${version}`]);
  try { git(adopterDir, ["push", "-u", "origin", branch]); } catch (e) { return { code: 1, lines: [`Applied on ${branch} but push failed: ${(e as Error).message.split("\n")[0]}`] }; }
  let prUrl: string;
  try {
    prUrl = runProcess("gh", ["pr", "create", "--base", base, "--head", branch, "--title", `gov upgrade → framework content ${version}`, "--body", upgradePrBody(version, res.applied.length, plan)], { cwd: adopterDir, pgm: "gov-work:maintain:upgrade-run", fn: "pr-create" }).trim();
  } catch (e) {
    return { code: 0, lines: [`Pushed ${branch} (open the PR manually — gh failed): ${(e as Error).message.split("\n")[0]}`] };
  }
  return { code: 0, lines: [`Opened upgrade PR: ${prUrl}`, `  ${branch} → ${base} · ${res.applied.length} file(s) changed`, `  Review per-file; keep your customizations where the diff replaces them, then merge.`] };
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
