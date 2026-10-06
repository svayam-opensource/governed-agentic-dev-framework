// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov check run` AND `gov check install` (rule-model-design.md Q14, Q15; W6 slice 3).
 *
 *   run <GOV-ID> --resource <r> --event <e>
 *       The one entry point every rendered binding calls. Rules come from the DEFAULT branch of the governance
 *       repository (`--gov-home`); the event from the GitHub Actions environment (`GITHUB_EVENT_PATH`,
 *       `GITHUB_EVENT_NAME`, `GITHUB_REPOSITORY`); the changeset from the checked-out repository (`--repo-dir`,
 *       resolved against the directory the job runs in; default the governance repository itself). On a
 *       pull_request, the policy PR gate's inputs too ({@link policyPrFromEvent}).
 *
 *       EXIT CODES — what each verdict can still do:
 *         pass                     0
 *         fail on a GATE event     1    the gate refuses (a required check, a gov verb)
 *         fail on an OBSERVE event 0    it already happened: a violation record is opened instead (Q15)
 *         cannot-tell              1 under hard posture; 0 with a WARNING under soft — said in the output
 *
 *   install [--repo <path>]
 *       Render the in-force bindings for ONE repository into `.github/workflows/gov-checks.yml` in its working
 *       tree. The governance repository gets `vcs.gov-repo` and `pms.issue`; a linked code repository gets
 *       `vcs.code-repo`. It writes the file and says so — it never commits, pushes, or calls a settings API.
 *
 * Pure over injected readers and writers; main.ts wires them to the run-process chokepoint.
 */
import path from "node:path";
import type { GitRead } from "./policy-gate-io.js";
import { flagBool, flagStr } from "./args.js";
import type { CommandResult } from "./dispatch.js";
import type { GovernancePosture } from "../config/governance.js";
import { inForce, type RuleRow } from "../rules/model/rule-row.js";
import type { CheckBinding } from "../rules/model/catalog.js";
import type { EventContext } from "../rules/model/contracts.js";
import { createCheckRunner } from "../rules/checks/runner.js";
import { githubPullsForCommit } from "../rules/checks/gh-actions.js";
import { buildPayload } from "../rules/checks/event-payload.js";
import { githubViolationPorts, requestReviews, type Gh } from "../rules/checks/github-adapters.js";
import { recordViolation } from "../rules/checks/violation.js";
import { defaultRef, loadCheckRuleSet } from "../rules/checks/ruleset-io.js";
import { githubActionsRenderer, GOV_APP_SECRETS } from "../rules/checks/render-github.js";
import { humanGateMessage } from "../rules/cues/human-message.js";
import { gitTree } from "../rules/policy-pr/tree.js";
import type { PolicyPrInput } from "../rules/policy-pr/gate.js";
import type { BuiltinOutcome } from "../rules/checks/builtin.js";
import { PROPOSE_ACTION } from "../rules/checks/builtin.js";
import { checkInstallAll, checkStatus, type ScopeDeps } from "./check-scope.js";

export interface CheckVerbDeps {
  readonly git: GitRead;
  readonly gh: Gh;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Absolute path → text, or null. */
  readonly readFile: (file: string) => string | null;
  /** Absolute path, parent directories created. */
  readonly writeFile: (file: string, text: string) => void;
  /** `gov-builtin/rules-propose`'s outcome, run beforehand by {@link checkCommandAsync}. */
  readonly rulesPropose?: BuiltinOutcome;
  /** `install --all` and `status`: the project's linked repos, the work root, file removal (scope in check-scope.ts). */
  readonly scope?: ScopeDeps;
}

/**
 * The proposer on a pull request (cli/rules-propose-ci.ts), as `gov check run` calls it: the rule's tag, the
 * event, and the checkout it runs in. Injected so this file stays free of the model and the forge.
 */
export type ProposeOnPr = (tag: string, eventName: string, event: unknown, repoDir: string) => Promise<BuiltinOutcome>;

export interface CheckVerbConfig {
  /** The governance repository's working tree. */
  readonly home: string;
  readonly defaultBranch: string;
  readonly defaultCodeBranch: string;
  readonly githubOrg: string;
  readonly workspaceRepo: string;
  /** Null only for a value gov does not recognise. */
  readonly posture: GovernancePosture | null;
  /** `<agent_work_root>` — where `--project <id>` finds `<id>/<repo>/` clones. Absent → `--project` cannot be resolved. */
  readonly agentWorkRoot?: string;
  /**
   * What the rendered workflow `npm install -g`s — `--gov-package <spec>`. Default: the published gov. A pre-release
   * test (the sandbox journey, the live CI tier) points it at a packed tarball, so the runners run the commit under
   * test rather than whatever npm last published.
   */
  readonly govPackage?: string;
}

const RUN_USAGE = "check run <GOV-ID> --resource <resource> --event <event> [--gov-home <path>] [--repo-dir <path>]";
const INSTALL_USAGE = "check install [--repo <path> | --all [--project <id>] [--prune]] [--gov-package <spec>]";
const STATUS_USAGE = "check status [--project <id>] [--gov-package <spec>]";
const usage = (u: string): CommandResult => ({ code: 2, lines: [`usage: gov ${u}`] });

export function checkCommand(positionals: readonly string[], flags: Readonly<Record<string, string | boolean>>, deps: CheckVerbDeps, cfg0: CheckVerbConfig): CommandResult {
  const pkg = flagStr(flags, "gov-package");
  const cfg: CheckVerbConfig = pkg ? { ...cfg0, govPackage: pkg } : cfg0;
  const sub = positionals[0];
  if (sub === "run") return checkRun(positionals[1], flags, deps, cfg);
  if (sub === "install") return checkInstall(flags, deps, cfg);
  if (sub === "status") return checkStatus(flags, deps, cfg);
  return { code: 2, lines: [`usage: gov ${RUN_USAGE}`, `       gov ${INSTALL_USAGE}`, `       gov ${STATUS_USAGE}`] };
}

/**
 * `gov check run` with the one action that cannot run synchronously: when the rule in force binds
 * `gov-builtin/rules-propose` on this resource and event, the proposer runs first (a model, the pull request's
 * comments, a push to its branch) and its outcome joins the verdict like any other action's. Everything else is
 * {@link checkCommand} unchanged.
 */
export async function checkCommandAsync(
  positionals: readonly string[], flags: Readonly<Record<string, string | boolean>>,
  deps: CheckVerbDeps & { readonly proposeOnPr?: ProposeOnPr }, cfg: CheckVerbConfig,
): Promise<CommandResult> {
  const id = positionals[1], resource = flagStr(flags, "resource"), event = flagStr(flags, "event");
  if (positionals[0] !== "run" || !id || !resource || !event || !deps.proposeOnPr) return checkCommand(positionals, flags, deps, cfg);
  const loaded = loadCheckRuleSet(deps.git, cfg.home, defaultRef(deps.git, cfg.home, cfg.defaultBranch));
  const row = loaded.ok ? inForce([...loaded.set.framework, ...loaded.set.org]).find((r) => r.id === id) : undefined;
  const binds = (row?.checks ?? []).some((b) => b.action === PROPOSE_ACTION && b.on.resource === resource && b.on.event === event);
  if (!binds) return checkCommand(positionals, flags, deps, cfg);

  const eventPath = deps.env.GITHUB_EVENT_PATH;
  const text = eventPath ? deps.readFile(eventPath) : null;
  let eventJson: unknown = {};
  try { eventJson = text === null ? {} : JSON.parse(text); } catch { /* checkCommand reports the unreadable event itself */ }
  const repoDirFlag = flagStr(flags, "repo-dir");
  const repoDir = repoDirFlag === undefined ? path.resolve(cfg.home) : path.resolve(repoDirFlag);
  const outcome = await deps.proposeOnPr(`${id} [${PROPOSE_ACTION}]`, deps.env.GITHUB_EVENT_NAME ?? "", eventJson, repoDir);
  return checkCommand(positionals, flags, { ...deps, rulesPropose: outcome }, cfg);
}

function checkRun(id: string | undefined, flags: Readonly<Record<string, string | boolean>>, deps: CheckVerbDeps, cfg: CheckVerbConfig): CommandResult {
  const resource = flagStr(flags, "resource");
  const eventFlag = flagStr(flags, "event");
  if (!id || !resource || !eventFlag) return usage(RUN_USAGE);
  // Against the directory the job runs in — the rendered code-repo job passes `--gov-home .gov --repo-dir .`, and
  // `.` there is the code repository, not the governance repository checked out inside it.
  const repoDirFlag = flagStr(flags, "repo-dir");
  const repoDir = repoDirFlag === undefined ? path.resolve(cfg.home) : path.resolve(repoDirFlag);
  const hard = cfg.posture === "hard";
  const lines: string[] = [];

  const cannotTell = (detail: readonly string[]): CommandResult => ({
    code: hard ? 1 : 0,
    lines: [
      ...lines,
      ...detail,
      hard
        ? `${id}: COULD NOT TELL — under hard posture a check that cannot tell blocks (exit 1).`
        : `WARNING: ${id} could not tell. Soft posture: this does NOT block (exit 0), and it is not a pass — fix what it could not see.`,
    ],
  });

  const ref = defaultRef(deps.git, cfg.home, cfg.defaultBranch);
  const loaded = loadCheckRuleSet(deps.git, cfg.home, ref);
  if (!loaded.ok) return cannotTell([`${id}: the rules could not be read at ${ref}: ${loaded.reason}.`]);
  const rules = loaded.set;
  const row: RuleRow | undefined = inForce([...rules.framework, ...rules.org]).find((r) => r.id === id);

  // THE EVENT, from GitHub's environment. Outside Actions there is none, and the check says so.
  const repository = deps.env.GITHUB_REPOSITORY ?? "";
  const eventPath = deps.env.GITHUB_EVENT_PATH;
  const eventText = eventPath ? deps.readFile(eventPath) : null;
  let eventJson: unknown = {};
  if (eventText !== null) {
    try {
      eventJson = JSON.parse(eventText);
    } catch {
      // An unreadable event leaves the payload empty; every action that needed a field reports cannot-tell.
      lines.push(`  ! ${eventPath} is not JSON — the event's facts are unknown.`);
    }
  } else {
    lines.push("  ! no GitHub event (GITHUB_EVENT_PATH) — the event's facts are unknown.");
  }
  const built = buildPayload(deps.env.GITHUB_EVENT_NAME ?? "", eventJson, repository, { git: (a) => deps.git(repoDir, a), gh: (a) => deps.gh(a) });
  if (built.event !== null && built.event !== eventFlag) {
    lines.push(`  ! GitHub sent \`${built.event}\` but this job was rendered for \`${eventFlag}\` — judging it as \`${eventFlag}\`.`);
  }
  const ctx: EventContext = { resource, event: eventFlag, payload: built.payload };

  const policyPr = policyPrFromEvent(deps.git, repoDir, deps.env.GITHUB_EVENT_NAME ?? "", eventJson);
  const runner = createCheckRunner({
    rules,
    readDefault: (p) => deps.git(cfg.home, ["show", `${ref}:${p}`]),
    ...(policyPr ? { policyPr } : {}),
    ...(deps.rulesPropose ? { propose: deps.rulesPropose } : {}),
    ...(repository ? { github: { pullsForCommit: githubPullsForCommit((a) => deps.gh(a), repository) } } : {}),
  });
  const verdict = runner.run(id, ctx);
  const say = (): string[] => (row ? humanGateMessage(row, verdict).split("\n") : [`${id} — ${verdict.verdict}`, ...verdict.findings.map((f) => `  - ${f}`)]);

  // Reviews first: a gate that is waiting on approvers should have asked them, whatever the verdict.
  if (verdict.requestReview?.length && built.pullNumber !== undefined && repository) {
    const ok = requestReviews(deps.gh, repository, built.pullNumber, verdict.requestReview);
    lines.push(ok
      ? `requested review from ${verdict.requestReview.map((h) => `@${h}`).join(", ")}`
      : `  ! could not request review from ${verdict.requestReview.map((h) => `@${h}`).join(", ")} — ask them by hand`);
  }

  if (verdict.verdict === "pass") return { code: 0, lines: [...lines, `${id} passed (${resource} · ${eventFlag}).`] };
  if (verdict.verdict === "cannot-tell") return cannotTell(say());

  const mode = rules.catalog.resources.find((r) => r.id === resource)?.events.find((e) => e.name === eventFlag)?.mode;
  if (mode === "observe" && row) {
    const runUrl = deps.env.GITHUB_SERVER_URL && repository && deps.env.GITHUB_RUN_ID
      ? `${deps.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${deps.env.GITHUB_RUN_ID}` : undefined;
    const out = recordViolation(
      { row, ctx, verdict, rules, ...(runUrl ? { runUrl } : {}) },
      githubViolationPorts(deps.gh, repository, built.issueNumber),
    );
    return { code: 0, lines: [...lines, ...say(), ...out.lines, `${id}: the event had already happened, so this does not block (exit 0) — the record is the response.`] };
  }
  return { code: 1, lines: [...lines, ...say(), `${id}: refused (exit 1).`] };
}

/**
 * The policy PR gate's inputs (GOV-FRM-467, W5) for a pull request in `repo`: the tree at the MERGE-BASE (what the
 * pull request changes, as the changeset in event-payload.ts reads it — not what the base branch moved on to since)
 * and at the head, the PR number from the event, and the HEAD COMMIT's committer date as "today" — deterministic,
 * so a re-run judges the same inputs the same way, never by the day it happened to run. Null when this is not a pull
 * request or any of those cannot be established; the gate then reports `cannot-tell`, never a pass.
 */
export function policyPrFromEvent(git: GitRead, repo: string, eventName: string, event: unknown): PolicyPrInput | null {
  if (eventName !== "pull_request" && eventName !== "pull_request_target") return null;
  const o = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const pr = o(o(event).pull_request);
  const base = o(pr.base).sha, head = o(pr.head).sha, number = pr.number;
  if (typeof base !== "string" || typeof head !== "string" || !base || !head || typeof number !== "number") return null;
  const mb = git(repo, ["merge-base", base, head])?.trim();
  const today = git(repo, ["show", "-s", "--format=%cs", head])?.trim();
  if (!mb || !today || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  return { base: gitTree(git, repo, mb), head: gitTree(git, repo, head), pr: number, today };
}

/**
 * The one-time setup a code repository's workflow needs before it can read the governance repository: a GitHub App
 * on the org (Policy Owner, 2026-10-06 — no personal token, no stopgap). Printed, never done from here: `gov app setup`
 * is the verb that creates the App and sets its secrets; the manual steps stay for an org that prefers them.
 */
export function githubAppSetup(org: string, govRepo: string): string[] {
  const { clientId, privateKey } = GOV_APP_SECRETS;
  return [
    `One-time, for the whole ${org} organization (skip it if it is already done): this workflow reads ${govRepo}`,
    "through a GitHub App, which mints a short-lived, read-only token on every run. GitHub Apps are free on every plan.",
    "  gov does it for you — an org owner runs `gov app setup`, then `gov app check`. By hand instead:",
    `  1. Create a GitHub App owned by ${org} (Organization settings → Developer settings → GitHub Apps → New).`,
    "     No webhook. Repository permissions: Contents: Read-only, and nothing else.",
    `  2. Install it on the ${org} organization, on the repository ${govRepo} only.`,
    `  3. Store its Client ID (on the App's settings page) and a private key as organization Actions secrets,`,
    "     available to the code repositories:",
    `       gh secret set ${clientId} --org ${org} --visibility all --body <client id>`,
    `       gh secret set ${privateKey} --org ${org} --visibility all < <private-key>.pem`,
  ];
}

/** Which resources a repository's workflow serves. */
const GOV_REPO_RESOURCES = ["vcs.gov-repo", "pms.issue"];
const CODE_REPO_RESOURCES = ["vcs.code-repo"];

export type RuleSetLoad = ReturnType<typeof loadCheckRuleSet>;

/** What `install` would write for one repository, from rules already loaded. Pure; shared by install --all and status. */
export type Rendered =
  | { readonly ok: true; readonly files: readonly { readonly path: string; readonly text: string }[]; readonly bindings: readonly { readonly id: string; readonly check: CheckBinding }[] }
  | { readonly ok: false; readonly reason: string };

export function renderForRepo(isGov: boolean, loaded: RuleSetLoad, cfg: CheckVerbConfig): Rendered {
  if (!loaded.ok) return { ok: false, reason: `the rules could not be read: ${loaded.reason}` };
  const { catalog } = loaded.set;
  const wanted = new Set((isGov ? GOV_REPO_RESOURCES : CODE_REPO_RESOURCES)
    .filter((r) => catalog.resources.find((x) => x.id === r)?.renderer === "github-actions"));
  const bindings: { id: string; check: CheckBinding }[] = [];
  for (const row of inForce([...loaded.set.framework, ...loaded.set.org])) {
    for (const check of row.checks ?? []) if (wanted.has(check.on.resource)) bindings.push({ id: row.id, check });
  }
  const govRepo = govRepoOf(cfg);
  if (!isGov && !govRepo) {
    return { ok: false, reason: "org-config.yaml does not name the governance repo (`github_org`, `org_gov_repo`), which a code repository's workflow must check out to read the rules" };
  }
  const files = githubActionsRenderer({
    defaultBranch: isGov ? cfg.defaultBranch : cfg.defaultCodeBranch,
    ...(cfg.govPackage ? { govPackage: cfg.govPackage } : {}),
    ...(isGov ? {} : { govCheckout: { repository: govRepo } }),
  }).render(bindings);
  return { ok: true, files, bindings };
}

export const govRepoOf = (cfg: CheckVerbConfig): string => (cfg.githubOrg && cfg.workspaceRepo ? `${cfg.githubOrg}/${cfg.workspaceRepo}` : "");

function checkInstall(flags: Readonly<Record<string, string | boolean>>, deps: CheckVerbDeps, cfg: CheckVerbConfig): CommandResult {
  if (flagBool(flags, "all")) return checkInstallAll(flags, deps, cfg);
  const target = path.resolve(cfg.home, flagStr(flags, "repo") ?? ".");
  const isGov = target === path.resolve(cfg.home);
  const ref = defaultRef(deps.git, cfg.home, cfg.defaultBranch);
  const loaded = loadCheckRuleSet(deps.git, cfg.home, ref);
  if (!loaded.ok) return { code: 1, lines: [`check install: the rules could not be read at ${ref}: ${loaded.reason}. Nothing was written.`] };
  const rendered = renderForRepo(isGov, loaded, cfg);
  if (!rendered.ok) return { code: 1, lines: [`check install: ${rendered.reason}. Nothing was written.`] };
  const { files, bindings } = rendered;
  const govRepo = govRepoOf(cfg);
  if (!files.length) return { code: 0, lines: [`check install: no rule in force binds a check GitHub can run in ${target} — nothing to write.`] };

  const lines: string[] = [];
  for (const f of files) {
    const abs = path.join(target, f.path);
    deps.writeFile(abs, f.text);
    lines.push(`wrote ${abs}`);
  }
  const jobs = [...new Set(bindings.map((b) => `${b.id} · ${b.check.on.event}`))].sort();
  lines.push(
    `  ${bindings.length} binding(s) from ${ref}: ${jobs.join(", ")}`,
    "  NOT committed and NOT pushed — review it, then land it by pull request like any other change.",
  );
  if (!isGov) lines.push("", ...githubAppSetup(cfg.githubOrg, govRepo));

  if (cfg.posture === "hard") {
    const repo = isGov ? govRepo : `${cfg.githubOrg}/${path.basename(target)}`;
    const required = jobs.filter((j) => j.endsWith(" · pull_request"));
    lines.push(
      "",
      "Hard posture — once this workflow is on the default branch, make the platform enforce it:",
      `  gov repo protect apply --repo ${repo}`,
      ...(required.length ? ["  It makes these status checks required on the default branch:", ...required.map((r) => `    ${r}`)] : []),
      "  and blocks force pushes on BRNCH-* with a branch ruleset (GOV-FRM-466). `gov repo protect plan` shows it first.",
      "  gov does not change repository settings from here.",
    );
  }
  return { code: 0, lines };
}
