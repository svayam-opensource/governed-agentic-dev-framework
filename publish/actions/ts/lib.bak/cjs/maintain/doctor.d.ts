/**
 * `doctor` (SDD Part E, SDD-052) — a health check: external tools present, the
 * gov workspace resolves, an active org is selected, and the CLI version. Pure
 * over injected facts, so it's fully testable; the real facts are gathered in main().
 */
import type { ResolveResult } from "../resolve/types.js";
export type DiagnosticStatus = "ok" | "warn" | "fail";
export interface Diagnostic {
    readonly name: string;
    readonly status: DiagnosticStatus;
    readonly detail: string;
}
export interface DoctorReport {
    /** True when nothing is a hard failure (warnings are allowed). */
    readonly ok: boolean;
    readonly diagnostics: readonly Diagnostic[];
}
/** The facts doctor inspects (gathered from the real environment by main()). */
export interface DoctorFacts {
    readonly gitPresent: boolean;
    readonly ghPresent: boolean;
    readonly resolve: ResolveResult;
    readonly activeOrg: string | null;
    readonly cliVersion: string;
    /** Old-world artifacts found in the workspace (framework/, registry.yaml, …). */
    readonly staleArtifacts?: readonly string[];
    /** The workspace's content VERSION marker, or null. */
    readonly contentVersion?: string | null;
}
export declare function doctor(facts: DoctorFacts): DoctorReport;
/** Render a report as printable lines. */
export declare function formatDoctorReport(report: DoctorReport): string[];
