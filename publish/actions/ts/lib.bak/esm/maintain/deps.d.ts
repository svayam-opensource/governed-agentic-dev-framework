/**
 * `deps` (SDD Part E, install-deps.sh) — report the runtime prerequisites and,
 * for any missing, the per-OS install command. Under the Node cutover the deps
 * reduce to `git` + `gh` (no more yq/python3). Pure over an injected tool probe;
 * report-only (the actual install is the printed command — no auto-install).
 */
export declare const REQUIRED_TOOLS: readonly ["git", "gh"];
export interface ToolCheck {
    readonly name: string;
    readonly present: boolean;
    readonly installHint: string;
}
export interface DepsReport {
    readonly ok: boolean;
    readonly tools: readonly ToolCheck[];
}
export declare function checkDeps(hasTool: (name: string) => boolean, platform: string): DepsReport;
export declare function formatDepsReport(r: DepsReport): string[];
