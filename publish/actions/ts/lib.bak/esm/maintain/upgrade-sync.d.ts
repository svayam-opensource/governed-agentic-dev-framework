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
export interface ManifestEntry {
    readonly src: string;
    readonly dst: string;
    readonly mode: EntryMode;
}
export interface Manifest {
    readonly files: readonly ManifestEntry[];
    readonly owned: readonly string[];
}
/** Paths (prefixes / exact) the new layout retires from an adopter repo. */
export declare const RETIRE_PATHS: readonly ["framework/", "registry.yaml", ".framework-version", "bin/", "scripts/", "setup.sh", "install.sh", "prj"];
/** Parse the flow-style MANIFEST (files[] of {src,dst,mode} + owned[]). */
export declare function parseManifest(text: string): Manifest;
/** Expand directory entries (src/dst ending in `/`) to one entry per content file. */
export declare function expandEntries(manifest: Manifest, contentFiles: readonly string[]): ManifestEntry[];
export type ActionKind = "create" | "same" | "update" | "conflict" | "overlay" | "retire";
export interface PlanAction {
    readonly kind: ActionKind;
    readonly dst: string;
    readonly src?: string;
    readonly detail?: string;
}
export interface UpgradePlan {
    readonly actions: readonly PlanAction[];
}
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
export declare function planUpgrade(entries: readonly ManifestEntry[], r: PlanReaders): UpgradePlan;
/** org-config overlay-schema merge: template schema, org values (rkant's spec). */
export declare function mergeOrgConfig(templateText: string, orgText: string): string;
export declare function formatPlan(plan: UpgradePlan): string[];
export interface ApplyDeps {
    readonly readContent: (rel: string) => string | null;
    readonly readAdopter: (rel: string) => string | null;
    readonly writeAdopter: (rel: string, text: string) => void;
    readonly removeAdopter: (rel: string) => void;
}
/** Apply the plan. Conflicts are skipped unless includeConflicts. */
export declare function applyUpgrade(plan: UpgradePlan, deps: ApplyDeps, opts?: {
    includeConflicts?: boolean;
}): {
    applied: string[];
    skipped: string[];
};
