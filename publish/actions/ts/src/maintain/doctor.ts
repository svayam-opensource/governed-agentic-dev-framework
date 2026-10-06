// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `doctor` (SDD Part E, SDD-052) — a health check: external tools present, the
 * gov workspace resolves, an active org is selected, and the CLI version. Pure
 * over injected facts, so it's fully testable; the real facts are gathered in main().
 */
import { paint, type Ink } from "../cli/format.js";
import type { ResolveResult } from "../resolve/types.js";
import { workspaceStateMessage } from "../resolve/resolve-gov.js";
import { checkVersionCompat } from "./version-compat.js";
import { missingScopes, RECOMMENDED_SCOPES } from "./fix-env.js";
import { parseOrgConfigSchema, validateOrgConfig, BUILT_IN_ORG_CONFIG_SCHEMA } from "../config/org-config.js";
import { GOVERNANCE_PATH, parseGovernance } from "../config/governance.js";
import { agentsDiagnostic } from "../cli/approve-agents-step.js";
import { rulesRows, type RulesFacts } from "./rules-health.js";
import { assessProtection, postureDiagnostic, postureOf } from "./protection-check.js";
import type { ProtectionFacts } from "../lifecycle/branch-protection.js";
import { appDiagnostic, secretsDiagnostic, type AppCheckResult } from "../cli/app-verb.js";
import { checkOwnerDiagnostic, codeownersDiagnostic, policyOwnerDiagnostic, roleListDiagnostic } from "./roles-health.js";

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
  /** Orgs in the registry. Absent = not gathered (treated as none): "not set up" is said only when this is empty. */
  readonly registeredOrgs?: readonly string[];
  readonly cliVersion: string;
  /** Which content layout the workspace is on — `governance` is the pre-2026-09-23 one. */
  readonly contentLayout?: "framework" | "governance" | "none";
  /** Old-world artifacts found in the workspace (registry.yaml, bin/, …). */
  readonly staleArtifacts?: readonly string[];
  /** A workspace was actually examined — one resolved, or one the person named (`--gov-home`). Absent means
   *  "whatever `resolve` says". Rows ABOUT a workspace (version compat, content layout) need one to exist. */
  readonly workspaceChecked?: boolean;
  /** The workspace's content VERSION marker, or null. */
  readonly contentVersion?: string | null;
  /**
   * The TEXT of the workspace's `org-config.yaml`, for the unknown-key row. Absent/null = no config was
   * examined, so no row — the rule the rest of this file keeps: a row about a fact nobody gathered is worse
   * than no row. Doctor computes the row itself (`unknownOrgConfigKeys` is pure), so the caller only reads a
   * file and this stays testable from a string.
   */
  readonly orgConfigText?: string | null;
  /**
   * The workspace's `framework/config/org-config.schema.yaml` — what org-config.yaml is checked against. `null` or
   * absent: the schema gov was built with.
   */
  readonly orgConfigSchemaText?: string | null;
  /**
   * `policies/governance.yaml` (the org's governance choices): text, `null` absent, undefined = not read. Read where
   * org-config.yaml is — only in a workspace that was examined.
   */
  readonly governanceText?: string | null;
  /** `policies/authorized-representatives.md` (the org's role list): text, `null` absent, undefined = not read. */
  readonly roleListText?: string | null;
  /** The workspace's root `CODEOWNERS`: text, `null` absent, undefined = not read. */
  readonly codeownersText?: string | null;
  /**
   * What the rules compiler found. Absent when doctor could not run it (no workspace, no policies) — and then
   * there are no rows, because doctor does not report on a fact nobody gathered.
   */
  readonly rules?: RulesFacts;
  /**
   * What the branch-protection read found for the ONE branch gov can name without a board: the governance
   * repo's default branch (framework-specification.md §7.3). Absent = not probed (gh missing, not signed in, no org config).
   *
   * Participating CODE repos are equally in scope for the policy and are deliberately not here: their list
   * comes from a project's board, which `gov doctor` does not have — it is a machine/workspace check, not a
   * project one. `gov close`'s gates are where a project's own repos get read.
   */
  readonly protection?: {
    readonly repo: string;
    readonly branch: string;
    /** null = gh could not answer. NOT the same as unprotected; see protection-check.ts. */
    readonly facts: ProtectionFacts | null;
    readonly why?: string;
    /** The approver-verifying check this org requires, when it is not the framework's default name. */
    readonly approverCheck?: string;
  };
  /**
   * What `gov app check` found for the org's GitHub App (rule-model-design.md, "gov-repo access"). Absent = not
   * probed (no org config). Offline, or gh not signed in, is `cannot-tell` — and the row says so, never `ok`.
   */
  readonly githubApp?: AppCheckResult;
  /**
   * `gov check status` in one row: is each repository's `gov-checks` workflow what `gov check install` would write
   * now? Absent = not examined (no workspace, no git). Offline or not a git working tree is `cannot tell` — a warning,
   * never ok.
   */
  readonly checksInstall?: { readonly name: string; readonly status: "ok" | "warn"; readonly detail: string };
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
    // …and only when NOTHING is registered (PRJ-121, 2026-09-22). With orgs registered and none active, "not set
    // up yet" was false, and sent the person to the first-run flow; that case names the orgs and `gov org use`.
    ...(!facts.resolve.ok && facts.resolve.reason === "no-active-org" && !facts.registeredOrgs?.length
      ? [{ name: "gov workspace", status: "warn" as DiagnosticStatus, detail: "not set up yet — run `gov`; it asks whether you are adopting the framework or joining your organization's" }]
      : !facts.resolve.ok && facts.resolve.reason === "no-active-org"
      ? [{ name: "gov workspace", status: "warn" as DiagnosticStatus, detail: workspaceStateMessage(facts.resolve, facts.registeredOrgs ?? []).text }]
      : [
          facts.resolve.ok
            ? { name: "gov workspace", status: "ok" as DiagnosticStatus, detail: `resolved → ${facts.resolve.home} (${facts.resolve.org})` }
            : { name: "gov workspace", status: "fail" as DiagnosticStatus, detail: workspaceStateMessage(facts.resolve, facts.registeredOrgs ?? []).text },
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
          // THE LAYOUT, SAID PLAINLY (2026-09-23). A workspace still on `governance/` is not broken — it is
          // one `gov upgrade` behind, and the upgrade carries its own files across. Saying so beats leaving
          // someone to notice that their policy file is not where the documentation says.
          facts.contentLayout === "governance"
            ? { name: "content layout", status: "warn" as DiagnosticStatus, detail: "the older `governance/` layout — `gov upgrade --pr` moves it to framework/ + policies/, carrying your own files across" }
            : (facts.staleArtifacts && facts.staleArtifacts.length)
            ? { name: "content layout", status: "warn" as DiagnosticStatus, detail: `files that are not this org's (${facts.staleArtifacts.join(", ")}) — \`gov upgrade --apply\` removes them (or \`gov upgrade --pr\` to review first)` }
            : { name: "content layout", status: "ok" as DiagnosticStatus, detail: "current" },
        ]
      : []),
    // WHAT GOV IGNORED IN ITS OWN CHANNEL (PRJ-121, 2026-09-27). `preferences.ts` has always reported an
    // unknown setting; `org-config.yaml` — the file that gets reviewed and merged — dropped one in silence.
    // A WARNING, never a failure: the keys gov did read are unaffected, and a config gov refuses to load is a
    // gov that cannot tell you why.
    // WHICH AGENTS THIS ORGANIZATION AUTHORIZED, as a STATE and not a scolding. `none` is a decision — an
    // organization may adopt the framework for the structure alone — so it reports `ok`. What warns is an org
    // that never answered, because it is being governed by a list it did not choose.
    ...(() => { const a = facts.governanceText === undefined ? null : agentsDiagnostic(facts.governanceText); return a ? [a] : []; })(),
    // HOW MUCH OF THE POLICY IS ACTUALLY ENFORCED — the numbers a Policy Owner cannot get by reading. In this
    // framework's own policy, 92 of 107 rules are advisory; nobody could have known that from the document.
    ...rulesRows(facts.rules),
    // CHECKED AGAINST THE SCHEMA (org-config split, 2026-10-06): the framework owns the shape of org-config.yaml
    // (framework/config/org-config.schema.yaml), the org owns the values. Missing required keys FAIL — gov cannot
    // work for the org without them; unknown, retired and renamed keys WARN, each saying what to do.
    ...(facts.orgConfigText ? [orgConfigRow(facts.orgConfigText, facts.orgConfigSchemaText ?? null)] : []),
    ...(facts.governanceText !== undefined ? [governanceRow(facts.governanceText)] : []),
    // THE TWO-KEY REVIEW (rule-model P1 rulings, 2026-10-06): the Check Owner approves the code of the org's check
    // actions, the Policy Owner the rules. Vacant, or both roles on one handle, and there is only one key.
    // WHO HOLDS EACH ROLE (GOV-FRM-033, W2-Q5) and whether CODEOWNERS still routes to them (GOV-FRM-083).
    ...[
      policyOwnerDiagnostic(facts.governanceText),
      checkOwnerDiagnostic(facts.governanceText),
      roleListDiagnostic(facts.roleListText),
      codeownersDiagnostic(facts.governanceText, facts.roleListText, facts.codeownersText),
    ].filter((d): d is Diagnostic => d !== null),
    // WHICH POSTURE THIS ORGANIZATION CHOSE (Policy Owner, 2026-09-29) — the row that says what the four rows
    // below it are FOR. It comes first because it decides whether they are a finding: an organization that
    // deliberately chose `soft` is not failing GOV-FRM-447, and one that never chose is not excused from it.
    ...(() => { const p = postureDiagnostic(facts.governanceText); return p ? [p] : []; })(),
    // GOV-FRM-447 — the only enforcement that still holds for work done OUTSIDE gov, and until now the one
    // thing gov never looked at.
    //
    // NOT UNDER `soft`. An organization that chose to leave room for direct work has not misconfigured
    // anything, and four red crosses against a decision it made on purpose is the false alarm this file keeps
    // arguing against — it would teach people to ignore the rows, which is fatal for the one rule that holds
    // outside gov. UNSET is soft (W2-Q6), so it gets none either; an unrecognised value still does, because gov
    // will not guess which posture was meant.
    // No config examined is not soft: the posture is then unknown, and the rows stay.
    ...(facts.protection && (facts.governanceText === undefined || postureOf(facts.governanceText).posture !== "soft")
      ? assessProtection(facts.protection.facts, {
          repo: facts.protection.repo,
          branch: facts.protection.branch,
          ...(facts.protection.approverCheck ? { approverCheck: facts.protection.approverCheck } : {}),
          ...(facts.protection.why ? { why: facts.protection.why } : {}),
        })
      : []),
    // THE ORG'S GITHUB APP — how a code repo's checks read the governance rules. A warning at worst: an org that has
    // not run `gov app setup` yet has checks that cannot read the rules, which is a next step, not a broken machine.
    ...(facts.githubApp ? [appDiagnostic(facts.githubApp)] : []),
    // WHERE THE SECRETS REACH — every repo that will not receive a secret it needs (on GitHub Free an org secret
    // never reaches a private repository), each with its fix.
    ...(facts.githubApp && secretsDiagnostic(facts.githubApp) ? [secretsDiagnostic(facts.githubApp)!] : []),
    ...(facts.checksInstall ? [facts.checksInstall] : []),
  ];
  return { ok: !d.some((x) => x.status === "fail"), diagnostics: d };
}

/** org-config.yaml against the schema: one row, the worst finding deciding its status. */
function orgConfigRow(text: string, schemaText: string | null): Diagnostic {
  const r = validateOrgConfig(text, parseOrgConfigSchema(schemaText) ?? BUILT_IN_ORG_CONFIG_SCHEMA);
  const parts = [
    ...(r.missing.length ? [`missing ${r.missing.join(", ")} (required — \`gov setup\` writes them)`] : []),
    ...(r.retired.length ? [`moved out of this file: ${r.retired.map((x) => `${x.key} → ${x.movedTo}`).join("; ")} — \`gov upgrade\` carries them`] : []),
    ...(r.replaced.length ? [`renamed: ${r.replaced.map((x) => `${x.key} → ${x.by}`).join(", ")}`] : []),
    ...(r.unknown.length ? [`${r.unknown.length} ${r.unknown.length === 1 ? "key" : "keys"} gov does not read — ${r.unknown.join(", ")} (ignored)`] : []),
  ];
  if (!parts.length) return { name: "org-config", status: "ok", detail: "matches the schema — all keys recognised" };
  return { name: "org-config", status: r.missing.length ? "fail" : "warn", detail: parts.join("; ") };
}

/** policies/governance.yaml: present and readable, or what is wrong with it. */
function governanceRow(text: string | null): Diagnostic {
  if (text === null) return { name: "governance", status: "warn", detail: `no ${GOVERNANCE_PATH} — run \`gov upgrade\`, which moves your governance choices there from org-config.yaml` };
  const g = parseGovernance(text);
  return g.problems.length
    ? { name: "governance", status: "warn", detail: `${GOVERNANCE_PATH}: ${g.problems.join("; ")}` }
    : { name: "governance", status: "ok", detail: `${GOVERNANCE_PATH} read` };
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
