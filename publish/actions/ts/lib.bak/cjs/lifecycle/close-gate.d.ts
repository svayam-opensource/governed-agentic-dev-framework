/**
 * The C01 pre-close knowledge gate (SDD Part B, close-project; POL-087…096).
 * Model A (SDD-012): the gate checks only **authored content** — there is no
 * project.yaml field check any more (status is GitHub-derived). Presence +
 * structure only; quality is the Harvest Protocol + Owner PR review.
 */
import type { Fs } from "./fs-io.js";
/** Required sections in knowledge-close.md (POL-413/414). */
export declare const KNOWLEDGE_CLOSE_SECTIONS: readonly ["## Graduated to org knowledge", "## Kept project-local", "## Discarded", "## Journeys created / updated", "## Completeness critic"];
export interface GateResult {
    readonly ok: boolean;
    readonly failures: readonly string[];
}
/**
 * Run the pre-close gate against a project's `knowledge/` dir. Fails (with a list
 * of reasons) unless: knowledge/ is non-empty, compliance.md exists, and
 * knowledge-close.md exists, has every required section, and has no TBD/TODO/FIXME.
 */
export declare function closeGate(fs: Fs, projectDir: string): GateResult;
