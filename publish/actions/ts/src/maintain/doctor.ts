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
import { missingScopes, RECOMMENDED_SCOPES } from "./fix-env.js";

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
  /**
   * Whether `gh` is SIGNED IN, which is a separate fact from being installed and
   * the commoner failure (#186): the tool installs cleanly and the person never
   * runs `gh auth login`, so every GitHub call fails later for a reason the
   * report did not mention. Undefined when `gh` is absent and the question does
   * not arise.
   */
  readonly ghAuthenticated?: boolean;
  /**
   * Scopes on the gh token, or null/undefined when unknown. Signed in is not the
   * same as sufficiently permitted (#186): `gh auth login` grants gh's own minimum,
   * which does not include `project` — and a Project board IS a project here.
   */
  readonly ghScopes?: readonly string[] | null;
  /**
   * Whether git knows who you are — `user.name` and `user.email`. Installed is not
   * the same as usable (#186): git refuses to commit without an identity, and gov
   * commits on every seed, task and merge. The failure surfaces several steps
   * later, inside a lifecycle command, as git's own "Please tell me who you are".
   */
  readonly gitIdentity?: { readonly name: string | null; readonly email: string | null };
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
    // Only when the caller actually probed it. `undefined` means "not checked",
    // which must not read as "not signed in" — a row that fails on a fact nobody
    // gathered is worse than no row.
    ...(facts.gitPresent && facts.gitIdentity
      ? [((): Diagnostic => {
          const missing = [
            ...(facts.gitIdentity.name ? [] : ["user.name"]),
            ...(facts.gitIdentity.email ? [] : ["user.email"]),
          ];
          return missing.length
            ? { name: "git identity", status: "fail" as DiagnosticStatus,
                detail: `${missing.join(" and ")} not set — git cannot commit, and gov commits on every task. Run \`gov doctor --fix\`` }
            : { name: "git identity", status: "ok" as DiagnosticStatus,
                detail: `${facts.gitIdentity.name} <${facts.gitIdentity.email}>` };
        })()]
      : []),
    ...(facts.ghPresent && facts.ghAuthenticated !== undefined
      ? [{
          name: "gh auth",
          status: (facts.ghAuthenticated ? "ok" : "fail") as DiagnosticStatus,
          detail: facts.ghAuthenticated ? "signed in" : "not signed in — run `gh auth login` (or `gov doctor --fix`)",
        }]
      : []),
    ...(facts.ghAuthenticated && facts.ghScopes
      ? [((): Diagnostic => {
          const missing = missingScopes(facts.ghScopes);
          const lacking = RECOMMENDED_SCOPES.filter((r) => !facts.ghScopes!.includes(r.scope));
          if (missing.length) {
            return {
              name: "gh scopes",
              status: "fail" as DiagnosticStatus,
              detail: `missing ${missing.map((m) => m.scope).join(", ")} — ${missing[0]!.why}. Add with \`gov doctor --fix\``,
            };
          }
          return lacking.length
            ? { name: "gh scopes", status: "warn" as DiagnosticStatus, detail: `no ${lacking.map((l) => l.scope).join(", ")} — ${lacking[0]!.why}` }
            : { name: "gh scopes", status: "ok" as DiagnosticStatus, detail: facts.ghScopes.join(", ") };
        })()]
      : []),
    facts.resolve.ok
      ? { name: "gov workspace", status: "ok", detail: `resolved → ${facts.resolve.home} (${facts.resolve.org})` }
      : { name: "gov workspace", status: "fail", detail: resolveFailureMessage(facts.resolve) },
    facts.activeOrg
      ? { name: "active org", status: "ok", detail: facts.activeOrg }
      : { name: "active org", status: "warn", detail: "not set — run `gov org use <org>`" },
    { name: "CLI version", status: "ok", detail: facts.cliVersion },
    ((): Diagnostic => {
      const c = checkVersionCompat(facts.cliVersion, facts.contentVersion ?? null);
      return { name: "version compat", status: c.ok ? (c.status === "ok" || c.status === "no-marker" ? "ok" : "warn") : "fail", detail: c.message };
    })(),
    (facts.staleArtifacts && facts.staleArtifacts.length)
      ? { name: "content layout", status: "warn", detail: `old-world artifacts (${facts.staleArtifacts.join(", ")}) — run \`gov upgrade --from <content>\`` }
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
