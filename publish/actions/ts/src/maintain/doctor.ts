// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `doctor` (SDD Part E, SDD-052) — a health check: external tools present, the
 * gov workspace resolves, an active org is selected, and the CLI version. Pure
 * over injected facts, so it's fully testable; the real facts are gathered in main().
 */
import { paint, type Ink } from "../cli/format.js";
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
  /** A workspace was actually examined — one resolved, or one the person named (`--gov-home`). Absent means
   *  "whatever `resolve` says". Rows ABOUT a workspace (version compat, content layout) need one to exist. */
  readonly workspaceChecked?: boolean;
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
    // NOT SET UP YET IS THE NEXT STEP, NOT A FAILURE (PRJ-121, 2026-09-22). On a fresh machine — no org has
    // ever been chosen — a walk got the same fact three times: the banner's "⚠ no gov workspace resolved — run
    // `gov setup` / `gov org use`", then "✗ gov workspace: No active org is set. Run `gov org use <github_org>`",
    // then "! active org: not set — run `gov org use <org>`". Two different remedies, one premature (git and gh
    // were not even installed yet), and the ✗ made the whole report FAILED seconds after "gov is installed" —
    // on the state the installer's very next section ("Next: your organization") exists to change.
    //
    // So "never set up" is ONE warning with ONE remedy. `gov` is it, because any gov command starts the
    // first-run flow, which asks whether you are adopting the framework or joining your org's — right for
    // both roles, where `gov setup` and `gov org use` are each right for only one. A workspace that EXISTS but
    // will not resolve (an org set, its home missing; a conflict) is still a failure.
    ...(!facts.resolve.ok && facts.resolve.reason === "no-active-org"
      ? [{ name: "gov workspace", status: "warn" as DiagnosticStatus, detail: "not set up yet — run `gov`; it asks whether you are adopting the framework or joining your organization's" }]
      : [
          facts.resolve.ok
            ? { name: "gov workspace", status: "ok" as DiagnosticStatus, detail: `resolved → ${facts.resolve.home} (${facts.resolve.org})` }
            : { name: "gov workspace", status: "fail" as DiagnosticStatus, detail: resolveFailureMessage(facts.resolve) },
          facts.activeOrg
            ? { name: "active org", status: "ok" as DiagnosticStatus, detail: facts.activeOrg }
            : { name: "active org", status: "warn" as DiagnosticStatus, detail: "not set — run `gov org use <org>`" },
        ]),
    { name: "CLI version", status: "ok", detail: facts.cliVersion },
    // ROWS ABOUT A WORKSPACE NEED ONE (PRJ-121, 2026-09-22). With none resolved, doctor used to read `VERSION`
    // from wherever the person stood and print "✓ version compat: no content VERSION marker — run `gov upgrade`"
    // — a tick carrying an instruction, aimed at someone with no workspace to upgrade — and "✓ content layout:
    // current" about a layout that did not exist. The sibling of the old-world-artifact false alarm fixed in
    // 5bec707. The rule this file already states for gh auth applies: a row about a fact nobody gathered is
    // worse than no row.
    ...((facts.workspaceChecked ?? facts.resolve.ok)
      ? [
          ((): Diagnostic => {
            const c = checkVersionCompat(facts.cliVersion, facts.contentVersion ?? null);
            return { name: "version compat", status: c.ok ? (c.status === "ok" || c.status === "no-marker" ? "ok" : "warn") : "fail", detail: c.message };
          })(),
          (facts.staleArtifacts && facts.staleArtifacts.length)
            ? { name: "content layout", status: "warn" as DiagnosticStatus, detail: `old-world artifacts (${facts.staleArtifacts.join(", ")}) — run \`gov upgrade --from <content>\`` }
            : { name: "content layout", status: "ok" as DiagnosticStatus, detail: "current" },
        ]
      : []),
  ];
  return { ok: !d.some((x) => x.status === "fail"), diagnostics: d };
}

const MARK: Record<DiagnosticStatus, string> = { ok: "\u2713", warn: "!", fail: "\u2717" };
const INK: Record<DiagnosticStatus, Ink> = { ok: "green", warn: "yellow", fail: "red" };

/**
 * Render a report as printable lines.
 *
 * `color` is off by default so every caller that has not been told where it is writing keeps
 * plain text — and so the marks stay the meaning (#204). The mark is never dropped when the
 * colour is: a reader with NO_COLOR set must be able to tell a fail from an ok, and here that
 * distinction is the whole output.
 */
export function formatDoctorReport(report: DoctorReport, color = false): string[] {
  return [
    ...report.diagnostics.map((x) => `  ${paint(MARK[x.status], INK[x.status], color)} ${x.name}: ${x.detail}`),
    report.ok
      ? paint("doctor: ok", "green", color)
      : paint("doctor: FAILED \u2014 fix the \u2717 items above", "red", color),
  ];
}
