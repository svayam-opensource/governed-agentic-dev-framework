// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `doctor` (SDD Part E, SDD-052) — a health check: external tools present, the
 * gov workspace resolves, an active org is selected, and the CLI version matches
 * the workspace's `.framework-version` (drift detection). Pure over injected
 * facts, so it's fully testable; the real facts are gathered in main().
 */
import type { ResolveResult } from "../resolve/types.js";
import { resolveFailureMessage } from "../resolve/resolve-gov.js";

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
  /** The workspace's `.framework-version`, or null if absent. */
  readonly frameworkVersion: string | null;
}

export function doctor(facts: DoctorFacts): DoctorReport {
  const d: Diagnostic[] = [
    { name: "git", status: facts.gitPresent ? "ok" : "fail", detail: facts.gitPresent ? "found" : "not found — install git" },
    { name: "gh", status: facts.ghPresent ? "ok" : "fail", detail: facts.ghPresent ? "found" : "not found — install the GitHub CLI (gh)" },
    facts.resolve.ok
      ? { name: "gov workspace", status: "ok", detail: `resolved → ${facts.resolve.home} (${facts.resolve.org})` }
      : { name: "gov workspace", status: "fail", detail: resolveFailureMessage(facts.resolve) },
    facts.activeOrg
      ? { name: "active org", status: "ok", detail: facts.activeOrg }
      : { name: "active org", status: "warn", detail: "not set — run `prj org use <org>`" },
    facts.frameworkVersion === null
      ? { name: "version drift", status: "warn", detail: "no .framework-version in the workspace" }
      : facts.frameworkVersion === facts.cliVersion
        ? { name: "version drift", status: "ok", detail: `CLI ${facts.cliVersion} == workspace ${facts.frameworkVersion}` }
        : { name: "version drift", status: "warn", detail: `CLI ${facts.cliVersion} != workspace ${facts.frameworkVersion} — run \`prj upgrade\`` },
  ];
  return { ok: !d.some((x) => x.status === "fail"), diagnostics: d };
}

const MARK: Record<DiagnosticStatus, string> = { ok: "✓", warn: "!", fail: "✗" };

/** Render a report as printable lines. */
export function formatDoctorReport(report: DoctorReport): string[] {
  return [
    ...report.diagnostics.map((x) => `  ${MARK[x.status]} ${x.name}: ${x.detail}`),
    report.ok ? "doctor: ok" : "doctor: FAILED — fix the ✗ items above",
  ];
}
