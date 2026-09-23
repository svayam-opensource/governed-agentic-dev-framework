// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov upgrade` overlay-sync engine — bring an adopter's gov workspace from its
 * current state to the published framework CONTENT, so the installed `gov-work`
 * actions work against a correct layout. Pure over injected readers (dry-run
 * planner) + a small applier; no network. The MANIFEST (publish/content/
 * MANIFEST.yaml) classifies every shipped file:
 *   scaffold-auto   — framework-owned; overwrite.
 *   seed-once       — the org owns it outright after the first install; leave it alone,
 *                     SILENTLY. Not a conflict: there is nothing to decide.
 *
 *                     WHY IT IS NOT scaffold-prompt. A conflict says "I could not decide, go
 *                     look" — it is reported on every upgrade and can be forced with
 *                     --include-conflicts. An org's CODEOWNERS-gated policy file naming their
 *                     own people is not an unresolved conflict, and reporting it as one every
 *                     time trains people to ignore conflict output.
 *
 *                     THE FILE THAT FORCED THIS: llm-governance.md is the only shipped file gov
 *                     WRITES INTO (`withApprovedAgents` rewrites its approved_agents fence), so
 *                     the org's copy always differs from the shipped one by design. Under
 *                     scaffold-prompt that was a permanent false conflict, and
 *                     --include-conflicts would have replaced the org's approved-agent list
 *                     with an empty template. Any file gov writes into must be seed-once or
 *                     overlay-schema.
 *
 *                     ACCEPTED LIMIT: the framework can never add required STRUCTURE to a
 *                     seed-once file. If it must, that file belongs in overlay-schema
 *                     (structured data) or should ship as a reference the org copies from.
 *   scaffold-prompt — org may extend; create if missing, update if it still
 *                     matches the shipped baseline, else flag as a conflict to
 *                     review (a full 3-way merge is a later refinement).
 *   overlay-schema  — org owns the VALUES (org-config.yaml): add template keys,
 *                     comment keys the template dropped, never touch values.
 * Plus RETIRE: old-world artifacts (framework/ subdir, registry.yaml,
 * .framework-version, vendored bash) that the new layout removes.
 */

export type EntryMode = "scaffold-auto" | "seed-once" | "scaffold-prompt" | "overlay-schema";
export interface ManifestEntry { readonly src: string; readonly dst: string; readonly mode: EntryMode; }
export interface Manifest { readonly files: readonly ManifestEntry[]; readonly owned: readonly string[]; readonly moves: readonly ManifestMove[]; }

/**
 * A RELOCATION, for the day the shipped layout changes (PRJ-121, 2026-09-23, policy-split design §9).
 *
 * `move` is a STRAIGHT MOVE (Policy Owner): the org's file arrives at the new path byte for byte, directory
 * structure and all. Nothing is rewritten — the framework owns where a file lives, never what the org wrote in
 * it. `migrate` is for the one shape a move cannot express: a value leaving one file for another (the approved
 * agents leaving llm-governance.md for org-config.yaml). Each runs ONCE, recorded in the workspace, so a
 * second `gov upgrade` is a no-op rather than a second move of something the org has since edited.
 *
 * Without this, the split would have had to CREATE the new tree and RETIRE the old — which silently drops an
 * org's own exception files and its curated standard. That is worse than the old layout, so the mechanism
 * comes first.
 */
export interface ManifestMove {
  readonly from: string;
  readonly to: string;
  readonly mode: "move" | "migrate";
  /** `migrate` only: the named, versioned migration to run. */
  readonly how?: string;
}

/** Paths (prefixes / exact) the new layout retires from an adopter repo. */
export const RETIRE_PATHS = ["framework/", "registry.yaml", ".framework-version", "bin/", "scripts/", "setup.sh", "install.sh", "prj"] as const;

/**
 * THE FRAMEWORK'S OWN FILES, LEFT IN AN ADOPTER REPO BY THE TEMPLATE COPY (PRJ-121, 2026-09-22).
 *
 * Until setup's clean slate (create.ts `cleanSlateEntries`), `gh repo create --template` copied the whole
 * framework repo and a stale delete-list let most of it through: svm-geneva-gov holds `publish/` (436 files:
 * the CLI's source and tests), `site/` and `install.ps1`. Retired by upgrade like RETIRE_PATHS, but each is
 * named by a FINGERPRINT that only the framework's copy has, so an org's own folder of the same name is never
 * touched. And only in an ADOPTER repo (one with org-config.yaml): run in the framework's own checkout,
 * `publish/` is the framework itself.
 */
export const TEMPLATE_LEFTOVERS: readonly { readonly path: string; readonly fingerprint: string }[] = [
  { path: "publish/", fingerprint: "publish/actions/ts/package.json" },
  { path: "site/", fingerprint: "site/caddyfile.mjs" },
  { path: "install.ps1", fingerprint: "install.ps1" },
];

/**
 * Which retired artifacts are present — looked for ONLY in a governance workspace (PRJ-121, 2026-09-21).
 *
 * RETIRE_PATHS describes an old ADOPTER REPO. `gov doctor` used to scan whatever directory it resolved as
 * "home" — and with no workspace resolved, that is simply where the person is standing. On a fresh machine that
 * is their home directory, which is exactly where the documented install command
 * (`curl … -o install.sh && bash install.sh`) had just saved `install.sh`. So the first thing a new adopter saw
 * after installing was `old-world artifacts (install.sh) — run gov upgrade --from <content>`: wrong advice,
 * about a file we told them to create, from a check that had no workspace to be right about. It fired just as
 * readily on any `~/bin` or `~/scripts`. Found by the first local-site walk, before it reached anyone.
 *
 *   isWorkspace  — `home` is a resolved governance workspace, or one the person named (`--gov-home`).
 *   exists(rel)  — whether `rel` exists under home. Injected, so this stays free of the filesystem.
 *
 * The framework's OWN checkout is exempt: `install.sh` is its bootstrap installer there, not a leftover
 * (#186). publish/content/MANIFEST.yaml exists only in the source repo, so it tells the two apart.
 */
export function staleArtifactsIn(isWorkspace: boolean, exists: (rel: string) => boolean): string[] {
  if (!isWorkspace) return [];
  // THE FRAMEWORK'S OWN CHECKOUT is the source repo WITHOUT an org-config.yaml. The MANIFEST alone used to decide
  // it — and an adopter repo that inherited `publish/` from the template has the MANIFEST too, so every check was
  // skipped exactly where the leftovers were (svm-geneva-gov, 2026-09-22).
  if (exists("publish/content/MANIFEST.yaml") && !exists("org-config.yaml")) return [];
  return [
    ...RETIRE_PATHS.filter((rp) => exists(rp.replace(/\/$/, ""))),
    ...TEMPLATE_LEFTOVERS.filter((t) => exists(t.fingerprint)).map((t) => t.path),
  ];
}

/** Parse the flow-style MANIFEST (files[] of {src,dst,mode} + owned[]). */
export function parseManifest(text: string): Manifest {
  const files: ManifestEntry[] = [];
  const owned: string[] = [];
  const moves: ManifestMove[] = [];
  let section: "files" | "owned" | "moves" | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t || t.startsWith("#")) continue;
    if (t === "files:") { section = "files"; continue; }
    if (t === "owned:") { section = "owned"; continue; }
    if (t === "moves:") { section = "moves"; continue; }
    if (/^[a-z_]+:/.test(t) && section === null) continue; // top-level scalars (version:)
    if (section === "files") {
      const m = t.match(/^-\s*\{\s*src:\s*([^,]+?)\s*,\s*dst:\s*([^,]+?)\s*,\s*mode:\s*([a-z-]+)\s*\}/);
      if (m) files.push({ src: m[1].trim(), dst: m[2].trim(), mode: m[3].trim() as EntryMode });
    } else if (section === "moves") {
      const m = t.match(/^-\s*\{\s*from:\s*([^,]+?)\s*,\s*to:\s*([^,]+?)\s*,\s*mode:\s*([a-z]+)\s*(?:,\s*how:\s*([^,}]+?)\s*)?\}/);
      if (m) moves.push({ from: m[1].trim(), to: m[2].trim(), mode: m[3].trim() as ManifestMove["mode"], ...(m[4] ? { how: m[4].trim() } : {}) });
    } else if (section === "owned") {
      const m = t.match(/^-\s*(.+?)(?:\s+#.*)?$/);
      if (m) owned.push(m[1].trim().replace(/^["']|["']$/g, ""));
    }
  }
  return { files, owned, moves };
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

export type ActionKind = "create" | "same" | "update" | "conflict" | "overlay" | "retire" | "move" | "migrate";
export interface PlanAction {
  readonly kind: ActionKind;
  readonly dst: string;
  readonly src?: string;
  readonly detail?: string;
  /** `move` / `migrate`: where the org's file is now, and (for migrate) the named migration. */
  readonly from?: string;
  readonly how?: string;
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
  /** Relocations already carried out in this workspace, by `<from> → <to>` — so each runs ONCE. */
  readonly doneMoves?: () => readonly string[];
}

/** The record of a relocation, as the workspace keeps it. */
export const moveId = (m: { from: string; to: string }): string => `${m.from} → ${m.to}`;

/** Compute the migration plan (no writes). */
export function planUpgrade(entries: readonly ManifestEntry[], r: PlanReaders, moves: readonly ManifestMove[] = []): UpgradePlan {
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
    if (e.mode === "seed-once") { actions.push({ kind: "same", dst: e.dst, src: e.src, detail: "yours since the first install" }); continue; }
    if (e.mode === "scaffold-auto") { actions.push({ kind: "update", dst: e.dst, src: e.src, detail: "framework-owned overwrite" }); continue; }
    // scaffold-prompt: NO MANIFEST ENTRY USES THIS ANY MORE (2026-09-15).
    //
    // It survives as a mode because the shape is sound — overwrite when the org copy still
    // matches the last-installed baseline, flag for review otherwise. What never existed is
    // `readBaseline`: declared optional below, called here, implemented nowhere. So `base` was
    // always null, every difference became a `conflict`, and every conflict was skipped. That is
    // the exact mechanism of the 2026-09-12 AGENTS.md defect, and it governed 42 of 49 entries
    // because scaffold-prompt was the default rather than an analysis.
    //
    // DO NOT USE IT AGAIN WITHOUT IMPLEMENTING readBaseline. A mode that silently skips is worse
    // than one that overwrites: the org keeps a stale file and is told nothing. The last entry
    // that wanted a 3-way merge — the CI workflow — is seed-once now, with the framework's
    // current version shipped beside it as a reference to diff against.
    const base = r.readBaseline?.(e.dst) ?? null;
    if (base !== null && base === current) actions.push({ kind: "update", dst: e.dst, src: e.src, detail: "unmodified since last sync" });
    else actions.push({ kind: "conflict", dst: e.dst, src: e.src, detail: "org-customized — review before applying" });
  }

  // ── RELOCATIONS, before anything is retired ──────────────────────────────────────────────────────────
  //
  // A move is planned only when the org HAS the file and has not been moved before: a second `gov upgrade`
  // must not move something the org has since put back, and a file that was never there is not a change.
  const present = new Set(r.adopterPaths());
  const already = new Set(r.doneMoves?.() ?? []);
  const movedAway = new Set<string>();
  for (const m of moves) {
    if (already.has(moveId(m))) continue;
    const here = m.from.endsWith("/")
      ? [...present].filter((p) => p.startsWith(m.from))
      : present.has(m.from) ? [m.from] : [];
    if (!here.length) continue;
    if (m.mode === "migrate") {
      actions.push({ kind: "migrate", dst: m.to, from: m.from, ...(m.how ? { how: m.how } : {}), detail: `carries the org's values into ${m.to}` });
    } else {
      for (const from of here) {
        const to = m.from.endsWith("/") ? `${m.to.replace(/\/$/, "")}/${from.slice(m.from.length)}` : m.to;
        actions.push({ kind: "move", dst: to, from, detail: "the org's file, moved as it stands" });
      }
    }
    for (const h of here) movedAway.add(h);
  }

  // Retire old-world artifacts present in the adopter.
  const seenRetire = new Set<string>();
  for (const p of r.adopterPaths()) {
    for (const rp of RETIRE_PATHS) {
      const hit = rp.endsWith("/") ? p.startsWith(rp) : p === rp;
      // RETIRE ONLY AFTER VERIFY (design §9.3): a path something is moving out of is not retired in the same
      // run — the move is the account of it, and retiring it as well would race the copy.
      if (hit && !seenRetire.has(rp) && ![...movedAway].some((mp) => mp === p || mp.startsWith(rp))) {
        seenRetire.add(rp); actions.push({ kind: "retire", dst: rp, detail: "removed under the new layout" });
      }
    }
  }
  // The framework's own files left by the template copy — fingerprinted, and only in an adopter repo.
  const paths = new Set(r.adopterPaths());
  if (paths.has("org-config.yaml")) {
    for (const t of TEMPLATE_LEFTOVERS) {
      if (paths.has(t.fingerprint) && !seenRetire.has(t.path)) {
        seenRetire.add(t.path);
        actions.push({ kind: "retire", dst: t.path, detail: "the framework's own files, left by the template copy" });
      }
    }
  }
  return { actions };
}

/** org-config overlay-schema merge: template schema, org values (rkant's spec). */
export function mergeOrgConfig(templateText: string, orgText: string): string {
  // Indentation-aware key: `<indent-depth>:<key>` so NESTED keys (the `services:` block) are matched +
  // preserved too — else an upgrade would clobber the org's real endpoints with the template placeholders.
  const keyOf = (line: string): string | null => {
    const m = line.match(/^(\s*)([a-z_][a-z0-9_-]*):/i);
    return m ? `${m[1].length}:${m[2]}` : null;
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
  const mark: Record<ActionKind, string> = { create: "+ create ", same: "= same   ", update: "~ update ", conflict: "! review ", overlay: "~ overlay", retire: "- retire ", move: "→ move   ", migrate: "→ migrate" };
  const shown = plan.actions.filter((a) => a.kind !== "same");
  const lines = shown.map((a) => `  ${mark[a.kind]} ${a.from ? `${a.from} → ${a.dst}` : a.dst}${a.detail ? `   (${a.detail})` : ""}`);
  const counts = plan.actions.reduce<Record<string, number>>((m, a) => ((m[a.kind] = (m[a.kind] ?? 0) + 1), m), {});
  const summary = Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(" · ");
  return [...(lines.length ? lines : ["  (workspace already matches the published content)"]), "", `plan: ${summary}`];
}

export interface ApplyDeps {
  readonly readContent: (rel: string) => string | null;
  readonly readAdopter: (rel: string) => string | null;
  readonly writeAdopter: (rel: string, text: string) => void;
  readonly removeAdopter: (rel: string) => void;
  /** Move the org's file, byte for byte. Defaults to read + write + remove when not supplied. */
  readonly moveAdopter?: (from: string, to: string) => void;
  /** Run the named migration; returns false when gov does not know it (then nothing is recorded). */
  readonly migrate?: (how: string, from: string, to: string) => boolean;
  /** Record that a relocation has happened, so the next run skips it. */
  readonly recordMove?: (id: string) => void;
}

/** Apply the plan. Conflicts are skipped unless includeConflicts. */
export function applyUpgrade(plan: UpgradePlan, deps: ApplyDeps, opts: { includeConflicts?: boolean } = {}): { applied: string[]; skipped: string[] } {
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const a of plan.actions) {
    if (a.kind === "same") continue;
    if (a.kind === "conflict" && !opts.includeConflicts) { skipped.push(a.dst); continue; }
    if (a.kind === "retire") { deps.removeAdopter(a.dst); applied.push(a.dst); continue; }
    if (a.kind === "move" && a.from) {
      // STRAIGHT MOVE: the bytes the org has, at the new path. Never a rewrite — the framework owns WHERE a
      // file lives, never WHAT the organization wrote in it.
      if (deps.moveAdopter) deps.moveAdopter(a.from, a.dst);
      else {
        const text = deps.readAdopter(a.from);
        if (text === null) { skipped.push(a.dst); continue; }
        deps.writeAdopter(a.dst, text);
        deps.removeAdopter(a.from);
      }
      deps.recordMove?.(moveId({ from: a.from, to: a.dst }));
      applied.push(a.dst);
      continue;
    }
    if (a.kind === "migrate" && a.from) {
      // A migration gov does not know is NOT an error to stop on, and NOT something to record: a newer content
      // manifest naming a migration an older CLI lacks must leave the file where it is, for the upgrade that
      // does know it.
      const ran = a.how ? deps.migrate?.(a.how, a.from, a.dst) === true : false;
      if (ran) { deps.recordMove?.(moveId({ from: a.from, to: a.dst })); applied.push(a.dst); }
      else skipped.push(a.dst);
      continue;
    }
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
