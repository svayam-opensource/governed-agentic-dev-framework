// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov-work upgrade` overlay-sync engine — bring an adopter's gov workspace from its
 * current state to the published framework CONTENT, so the installed `gov-work`
 * actions work against a correct layout. Pure over injected readers (dry-run
 * planner) + a small applier; no network. The MANIFEST (publish/content/
 * MANIFEST.yaml) classifies every shipped file:
 *   scaffold-auto   — framework-owned; overwrite.
 *   scaffold-prompt — org may extend; create if missing, update if it still
 *                     matches the shipped baseline, else flag as a conflict to
 *                     review (a full 3-way merge is a later refinement).
 *   overlay-schema  — org owns the VALUES (org-config.yaml): add template keys,
 *                     comment keys the template dropped, never touch values.
 * Plus RETIRE: old-world artifacts (framework/ subdir, registry.yaml,
 * .framework-version, vendored bash) that the new layout removes.
 */

export type EntryMode = "scaffold-auto" | "scaffold-prompt" | "overlay-schema";
export interface ManifestEntry { readonly src: string; readonly dst: string; readonly mode: EntryMode; }
export interface Manifest { readonly files: readonly ManifestEntry[]; readonly owned: readonly string[]; }

/** Paths (prefixes / exact) the new layout retires from an adopter repo. */
export const RETIRE_PATHS = ["framework/", "registry.yaml", ".framework-version", "bin/", "scripts/", "setup.sh", "install.sh", "prj"] as const;

/** Parse the flow-style MANIFEST (files[] of {src,dst,mode} + owned[]). */
export function parseManifest(text: string): Manifest {
  const files: ManifestEntry[] = [];
  const owned: string[] = [];
  let section: "files" | "owned" | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t || t.startsWith("#")) continue;
    if (t === "files:") { section = "files"; continue; }
    if (t === "owned:") { section = "owned"; continue; }
    if (/^[a-z_]+:/.test(t) && section === null) continue; // top-level scalars (version:)
    if (section === "files") {
      const m = t.match(/^-\s*\{\s*src:\s*([^,]+?)\s*,\s*dst:\s*([^,]+?)\s*,\s*mode:\s*([a-z-]+)\s*\}/);
      if (m) files.push({ src: m[1].trim(), dst: m[2].trim(), mode: m[3].trim() as EntryMode });
    } else if (section === "owned") {
      const m = t.match(/^-\s*(.+?)(?:\s+#.*)?$/);
      if (m) owned.push(m[1].trim().replace(/^["']|["']$/g, ""));
    }
  }
  return { files, owned };
}

/** Expand directory entries (src/dst ending in `/`) to one entry per content file. */
export function expandEntries(manifest: Manifest, contentFiles: readonly string[]): ManifestEntry[] {
  const out: ManifestEntry[] = [];
  for (const e of manifest.files) {
    if (e.src.endsWith("/")) {
      for (const f of contentFiles) {
        if (f.startsWith(e.src)) out.push({ src: f, dst: e.dst + f.slice(e.src.length), mode: e.mode });
      }
    } else {
      out.push(e);
    }
  }
  return out;
}

export type ActionKind = "create" | "same" | "update" | "conflict" | "overlay" | "retire";
export interface PlanAction {
  readonly kind: ActionKind;
  readonly dst: string;
  readonly src?: string;
  readonly detail?: string;
}
export interface UpgradePlan { readonly actions: readonly PlanAction[]; }

export interface PlanReaders {
  /** Content file text (relative to the content root), or null. */
  readonly readContent: (rel: string) => string | null;
  /** Adopter file text (relative to the adopter root), or null. */
  readonly readAdopter: (rel: string) => string | null;
  /** Every path present in the adopter repo (files, relative). */
  readonly adopterPaths: () => readonly string[];
  /** The previously-installed baseline for a dst, if the engine tracks it (else null). */
  readonly readBaseline?: (rel: string) => string | null;
}

/** Compute the migration plan (no writes). */
export function planUpgrade(entries: readonly ManifestEntry[], r: PlanReaders): UpgradePlan {
  const actions: PlanAction[] = [];
  const shippedDst = new Set<string>();

  for (const e of entries) {
    shippedDst.add(e.dst);
    const content = r.readContent(e.src);
    if (content === null) continue; // shipped file missing from the content source
    const current = r.readAdopter(e.dst);

    if (e.mode === "overlay-schema") {
      const merged = current === null ? content : mergeOrgConfig(content, current);
      actions.push({ kind: current === null ? "create" : "overlay", dst: e.dst, src: e.src, detail: current === null ? "seed from template" : "add new keys · comment removed · keep values" });
      void merged;
      continue;
    }
    if (current === null) { actions.push({ kind: "create", dst: e.dst, src: e.src }); continue; }
    if (current === content) { actions.push({ kind: "same", dst: e.dst, src: e.src }); continue; }
    if (e.mode === "scaffold-auto") { actions.push({ kind: "update", dst: e.dst, src: e.src, detail: "framework-owned overwrite" }); continue; }
    // scaffold-prompt: overwrite only if the org copy still matches the shipped
    // baseline (unmodified); otherwise flag for review.
    const base = r.readBaseline?.(e.dst) ?? null;
    if (base !== null && base === current) actions.push({ kind: "update", dst: e.dst, src: e.src, detail: "unmodified since last sync" });
    else actions.push({ kind: "conflict", dst: e.dst, src: e.src, detail: "org-customized — review before applying" });
  }

  // Retire old-world artifacts present in the adopter.
  const seenRetire = new Set<string>();
  for (const p of r.adopterPaths()) {
    for (const rp of RETIRE_PATHS) {
      const hit = rp.endsWith("/") ? p.startsWith(rp) : p === rp;
      if (hit && !seenRetire.has(rp)) { seenRetire.add(rp); actions.push({ kind: "retire", dst: rp, detail: "removed under the new layout" }); }
    }
  }
  return { actions };
}

/** org-config overlay-schema merge: template schema, org values (rkant's spec). */
export function mergeOrgConfig(templateText: string, orgText: string): string {
  const keyOf = (line: string): string | null => {
    const m = line.match(/^([a-z_][a-z0-9_]*):/i);
    return m ? m[1] : null;
  };
  const orgValues = new Map<string, string>();
  for (const line of orgText.split(/\r?\n/)) { const k = keyOf(line); if (k) orgValues.set(k, line); }
  const templateKeys = new Set<string>();
  const out: string[] = [];
  // Walk the TEMPLATE (canonical order + comments); fill org values where present.
  for (const line of templateText.split(/\r?\n/)) {
    const k = keyOf(line);
    if (k) { templateKeys.add(k); out.push(orgValues.has(k) ? orgValues.get(k)! : line); }
    else out.push(line);
  }
  // Append org keys the template dropped, commented out.
  const removed = [...orgValues.keys()].filter((k) => !templateKeys.has(k));
  if (removed.length) {
    out.push("", "# Removed from the framework template (kept for reference — delete when ready):");
    for (const k of removed) out.push(`# ${orgValues.get(k)}`);
  }
  return out.join("\n").replace(/\n+$/, "") + "\n";
}

export function formatPlan(plan: UpgradePlan): string[] {
  const mark: Record<ActionKind, string> = { create: "+ create ", same: "= same   ", update: "~ update ", conflict: "! review ", overlay: "~ overlay", retire: "- retire " };
  const shown = plan.actions.filter((a) => a.kind !== "same");
  const lines = shown.map((a) => `  ${mark[a.kind]} ${a.dst}${a.detail ? `   (${a.detail})` : ""}`);
  const counts = plan.actions.reduce<Record<string, number>>((m, a) => ((m[a.kind] = (m[a.kind] ?? 0) + 1), m), {});
  const summary = Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(" · ");
  return [...(lines.length ? lines : ["  (workspace already matches the published content)"]), "", `plan: ${summary}`];
}

export interface ApplyDeps {
  readonly readContent: (rel: string) => string | null;
  readonly readAdopter: (rel: string) => string | null;
  readonly writeAdopter: (rel: string, text: string) => void;
  readonly removeAdopter: (rel: string) => void;
}

/** Apply the plan. Conflicts are skipped unless includeConflicts. */
export function applyUpgrade(plan: UpgradePlan, deps: ApplyDeps, opts: { includeConflicts?: boolean } = {}): { applied: string[]; skipped: string[] } {
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const a of plan.actions) {
    if (a.kind === "same") continue;
    if (a.kind === "conflict" && !opts.includeConflicts) { skipped.push(a.dst); continue; }
    if (a.kind === "retire") { deps.removeAdopter(a.dst); applied.push(a.dst); continue; }
    if (a.kind === "overlay") {
      const tmpl = a.src ? deps.readContent(a.src) : null;
      const org = deps.readAdopter(a.dst);
      if (tmpl !== null) { deps.writeAdopter(a.dst, org === null ? tmpl : mergeOrgConfig(tmpl, org)); applied.push(a.dst); }
      continue;
    }
    const c = a.src ? deps.readContent(a.src) : null;
    if (c !== null) { deps.writeAdopter(a.dst, c); applied.push(a.dst); }
  }
  return { applied, skipped };
}
