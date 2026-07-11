// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `doctor` (SDD Part E, SDD-052) — a health check: external tools present, the
 * gov workspace resolves, an active org is selected, and the CLI version. Pure
 * over injected facts, so it's fully testable; the real facts are gathered in main().
 */
import type { ResolveResult } from "../resolve/types.js";
import { resolveFailureMessage } from "../resolve/resolve-gov.js";
import { checkVersionCompat } from "./version-compat.js";

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

export function doctor(facts: DoctorFacts): DoctorReport {
  const d: Diagnostic[] = [
    { name: "git", status: facts.gitPresent ? "ok" : "fail", detail: facts.gitPresent ? "found" : "not found — install git" },
    { name: "gh", status: facts.ghPresent ? "ok" : "fail", detail: facts.ghPresent ? "found" : "not found — install the GitHub CLI (gh)" },
    facts.resolve.ok
      ? { name: "gov workspace", status: "ok", detail: `resolved → ${facts.resolve.home} (${facts.resolve.org})` }
      : { name: "gov workspace", status: "fail", detail: resolveFailureMessage(facts.resolve) },
    facts.activeOrg
      ? { name: "active org", status: "ok", detail: facts.activeOrg }
      : { name: "active org", status: "warn", detail: "not set — run `gov-work org use <org>`" },
    { name: "CLI version", status: "ok", detail: facts.cliVersion },
    ((): Diagnostic => {
      const c = checkVersionCompat(facts.cliVersion, facts.contentVersion ?? null);
      return { name: "version compat", status: c.ok ? (c.status === "ok" || c.status === "no-marker" ? "ok" : "warn") : "fail", detail: c.message };
    })(),
    (facts.staleArtifacts && facts.staleArtifacts.length)
      ? { name: "content layout", status: "warn", detail: `old-world artifacts (${facts.staleArtifacts.join(", ")}) — run \`gov-work upgrade --from <content>\`` }
      : { name: "content layout", status: "ok", detail: "current" },
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
