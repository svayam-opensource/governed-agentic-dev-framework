/**
 * `publish` (SDD Part E, SDD-050) — the PRE-PUBLISH GATE, not the publish itself.
 * SDD-050: never `npm publish` by hand — real publish is the governed Jenkins
 * pipeline. This command runs the readiness gate (version-sync must pass) and
 * reports whether the package is publishable. Pure over the Fs port + validators.
 */
import type { Fs } from "../lifecycle/fs-io.js";
export interface PublishGate {
    readonly ok: boolean;
    readonly blockers: readonly string[];
}
export declare function publishGate(fs: Fs, repoRoot: string): PublishGate;
export declare function formatPublishGate(g: PublishGate): string[];
