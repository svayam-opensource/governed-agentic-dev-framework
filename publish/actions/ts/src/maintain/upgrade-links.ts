// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * LINKS THE UPGRADE WOULD BREAK, REPOINTED (F55, Policy Owner ruling A, 2026-11-12).
 *
 * Every upgrade can move, migrate and retire files — the manifest's moves (e.g. flat 1.2.3 → phase folders) and the
 * 1.0 bridge's alike — but the org's own markdown that stays where it is (knowledge/ READMEs and indexes) still links
 * to the old paths, and `gov validate` then fails on every broken link: the upgraded tree is not valid. This runs for
 * EVERY upgrade plan (upgrade-run.ts `extendPlan`), whatever the layout. So, for every markdown file the upgrade leaves in place, a RELATIVE link whose target existed
 * before the upgrade and is gone after it is rewritten:
 *
 *   moved or migrated → the file's new home, as a relative link from the same document
 *   retired, with a 2.0 successor (RETIRED_SUCCESSORS) → the successor
 *   retired, with none → the link is removed and its text kept (`[roles](roles.md)` → `roles`)
 *
 * Only the link target changes — never the link text or anything else in the document. Links to what commits 1–3
 * remove are repointed in commit 3 (without it the tree does not validate); links to what commit 4 retires (the
 * superseded policy) are repointed in commit 4, so dropping that proposal leaves them, and the file, as they were —
 * see {@link bridgeRelinks}. Each change is listed in the PR body. Links to anything else (external, anchors, files that stay, targets already missing) are untouched.
 */
import * as path from "node:path";
import type { PlanAction } from "./upgrade-sync.js";

/** Homes of retired framework files that have one (the 1.0 layout's, today). A pattern's `$1` is the matched name. */
export const RETIRED_SUCCESSORS: readonly { readonly from: RegExp; readonly to: string }[] = [
  { from: /^knowledge\/policies\/exceptions\/[^/]+\/TEMPLATE\.md$/, to: "framework/common/templates/exception-template.md" },
  { from: /^knowledge\/(?:guidance|policies\/procedures\/templates)\/([a-z-]+-template\.md)$/, to: "framework/build/templates/$1" },
];

const LINK = /(!?)\[([^\]\n]*)\]\(([^)\s]+)((?:\s+"[^"\n]*")?)\)/g;
const isRelative = (t: string): boolean => !/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(t);

export interface Relink { readonly file: string; readonly from: string; readonly to: string | null }

/**
 * The relink actions for this plan. `files`: the repository before the upgrade. `exists(after)`: whether a path is
 * present once the plan is applied (kept, created, moved or migrated there).
 */
export function relinkPlan(
  files: readonly string[],
  read: (rel: string) => string | null,
  actions: readonly PlanAction[],
  commit: "migrations" | "proposed-prose" = "migrations",
): { actions: PlanAction[]; relinks: Relink[] } {
  const before = new Set(files);
  const successor = new Map<string, string | null>();
  const written = new Set<string>();
  for (const a of actions) {
    if ((a.kind === "move" || a.kind === "migrate") && a.from) {
      if (!a.from.endsWith("/")) successor.set(a.from, a.dst);
      written.add(a.dst);
    } else if (a.kind === "retire" && !a.dst.endsWith("/")) {
      if (!successor.has(a.dst)) successor.set(a.dst, null);
    } else if (a.kind === "create" || a.kind === "update" || a.kind === "conflict" || a.kind === "same" || a.kind === "keep") {
      written.add(a.dst);
    }
  }
  // A migration that leaves its source behind (org-config.yaml) does not remove it.
  for (const a of actions) if (a.kind === "migrate" && a.from && read(a.from) !== null && !actions.some((r) => r.kind === "retire" && r.dst === a.from)) {
    if (successor.get(a.from) === a.dst && keptAfterMigrate(a.from)) successor.delete(a.from);
  }
  const gone = (p: string): boolean => successor.has(p);
  const after = (p: string): boolean => written.has(p) || (before.has(p) && !gone(p));
  const homeOf = (p: string): string | null => {
    if (!gone(p)) return p;
    const s = successor.get(p);
    if (s) return s;
    for (const r of RETIRED_SUCCESSORS) if (r.from.test(p)) {
      const to = p.replace(r.from, r.to);
      if (after(to)) return to;
    }
    return null;
  };

  // The org's markdown that stays where it is: not moved, migrated, retired, or written by the framework.
  const touched = new Set(actions.flatMap((a) => [a.dst, ...(a.from ? [a.from] : [])]));
  const out: PlanAction[] = [];
  const relinks: Relink[] = [];
  for (const file of files) {
    if (!file.endsWith(".md") || touched.has(file)) continue;
    const text = read(file);
    if (text === null) continue;
    const dir = path.posix.dirname(file);
    let changed = false;
    const next = text.replace(LINK, (whole, bang: string, label: string, target: string, title: string) => {
      if (!isRelative(target)) return whole;
      const hash = target.indexOf("#");
      const bare = hash >= 0 ? target.slice(0, hash) : target;
      const frag = hash >= 0 ? target.slice(hash) : "";
      if (!bare) return whole;
      const abs = path.posix.normalize(path.posix.join(dir, decodeURI(bare))).replace(/\/+$/, "");
      if (abs.startsWith("..")) return whole;
      let home: string | null;
      if (before.has(abs)) {
        if (!gone(abs)) return whole;
        home = homeOf(abs);
      } else {
        // A folder: repointed only when EVERY file in it goes — to the folder their new homes share, if one does.
        const inside = files.filter((f) => f.startsWith(`${abs}/`));
        if (!inside.length || !inside.every(gone)) return whole;
        const homes = inside.map(homeOf);
        // The folder moved as a whole when every file keeps its place inside it: map folder → folder.
        const roots = new Set(inside.map((f, i) => {
          const h = homes[i], within = f.slice(abs.length + 1);
          return h && h.endsWith(`/${within}`) ? h.slice(0, -within.length - 1) : null;
        }));
        const asFolder = roots.size === 1 && !roots.has(null) ? [...roots][0]! : null;
        // Else (files renamed, e.g. retired templates with successors): the one folder their new homes share, if any.
        const dirs = new Set(homes.filter((h): h is string => h !== null).map((h) => path.posix.dirname(h)));
        const only = asFolder ?? (dirs.size === 1 ? [...dirs][0]! : null);
        home = only && bare.endsWith("/") ? `${only}/` : only;
      }
      changed = true;
      if (home === null) {
        relinks.push({ file, from: target, to: null });
        return bang ? whole : label;
      }
      let rel = path.posix.relative(dir, home) + (home.endsWith("/") ? "/" : "");
      if (!rel.startsWith(".")) rel = bare.startsWith("./") ? `./${rel}` : rel;
      relinks.push({ file, from: target, to: rel + frag });
      return `${bang}[${label}](${rel}${frag}${title})`;
    });
    if (changed && next !== text) {
      out.push({ kind: "relink", dst: file, text: next, commit, detail: "links to files this upgrade moves or retires, repointed" });
    }
  }
  return { actions: out, relinks };
}

/** The org's own file a migration carries values OUT of, but which stays (its remaining keys are the org's). */
function keptAfterMigrate(p: string): boolean {
  return p === "org-config.yaml";
}

/**
 * Both passes: commits 1–3, then commit 4 on top of their result. `--apply` drops commit 4's actions, so its relinks go
 * with it; `--pr` applies commit 4 last, over commit 3's text.
 */
export function upgradeRelinks(files: readonly string[], read: (rel: string) => string | null, actions: readonly PlanAction[]): PlanAction[] {
  const firstThree = relinkPlan(files, read, actions.filter((a) => a.commit !== "proposed-prose"));
  if (!actions.some((a) => a.commit === "proposed-prose" && a.kind === "retire")) return firstThree.actions;
  const after3 = new Map(firstThree.actions.map((a) => [a.dst, a.text ?? null] as const));
  const read3 = (rel: string): string | null => (after3.has(rel) ? after3.get(rel)! : read(rel));
  const fourth = relinkPlan(files, read3, actions, "proposed-prose");
  return [...firstThree.actions, ...fourth.actions];
}
