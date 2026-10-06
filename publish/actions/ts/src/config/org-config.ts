// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Load the org config (SDD-012) — the ONE remaining repo config file (read-only,
 * hand-authored, one per gov home). Parsed in-process from `org-config.yaml`'s
 * top-level scalars (no yq/python); paths expand `~`. This is the typed config
 * the dispatcher threads into the lifecycle commands, plus the token map seed
 * uses for tool-file substitution.
 */
import * as os from "node:os";
import { parseRepoOverrides } from "./repo-overrides.js";
import { DOMAIN_ROLES, CHECK_OWNER } from "./codeowners.js";
import { readTopLevelScalar, expandTilde } from "../resolve/node-env.js";

/**
 * THE SCALARS THIS READER READS — the one list, and the only way to name one (PRJ-121, 2026-09-27).
 *
 * `get()` below takes a {@link OrgConfigScalarKey}, so a key read without being declared here is a TYPE
 * error rather than a thing someone remembers to do, and `test/config/org-config-keys.test.ts` re-reads this
 * file's text to catch a reader that goes around `get()` entirely. The list exists because gov OWNS the
 * schema of this channel: an org that writes `require_two_approvals: true`, has it reviewed and merged, and
 * is told nothing has configured nothing — and only a list gov publishes can say so (see
 * {@link unknownOrgConfigKeys}).
 */
const SCALARS = [
  "org_name", "org_short_name", "org_slug", "org_slug_lower", "github_org",
  "org_gov_repo", "workspace_repo", "org_repo_url",
  "default_branch", "default_code_branch",
  "agent_work_root", "gov_workspace", "policy_owner_email",
  "vault_addr", "oidc_base", "gov_account",
  "governance_posture",
] as const;
export type OrgConfigScalarKey = (typeof SCALARS)[number];

/**
 * HARD OR SOFT GOVERNANCE — the posture an organization CHOOSES (Policy Owner, 2026-09-29).
 *
 * `hard`  install repository controls, so that work attempted OUTSIDE gov is stopped by the platform.
 * `soft`  deliberately leave room for direct work — clone, commit and push by hand.
 *
 * WHY IT HAS TO BE WRITTEN DOWN. Until this key, the posture was whatever somebody had configured on GitHub by
 * hand, and gov only READ it (`lifecycle/branch-protection.ts`). Two organizations with identical
 * `org-config.yaml` files could be in opposite positions, neither of them on purpose, and gov had no way to
 * tell a deliberate soft posture from a hard one nobody got round to installing. Those are the same facts and
 * opposite findings.
 */
export type GovernancePosture = "hard" | "soft";

/** Every posture gov understands — the list the messages quote, so they cannot drift from the type. */
export const GOVERNANCE_POSTURES: readonly GovernancePosture[] = ["hard", "soft"];

/**
 * What the file says about the posture.
 *
 * ABSENT OR EMPTY IS `soft` (Policy Owner, W2-Q6, 2026-10-06). The "nobody chose" third state is gone: `hard`
 * needs public repositories or a paid GitHub plan, so it is the one an organization opts into — at setup, past a
 * confirmation that says what it costs. `raw` stays `""` so a report can say soft is the DEFAULT rather than a
 * recorded choice.
 *
 * `unrecognised` is the one state that is neither: `governance_posture: strict` is someone who chose and was not
 * heard, which is the failure mode {@link unknownOrgConfigKeys} exists for, one level down — the key is known, the
 * value is not. `posture` is null only then.
 */
export interface PostureChoice {
  /** Null only when {@link unrecognised}. */
  readonly posture: GovernancePosture | null;
  /** Exactly what the file said, lower-cased and trimmed. `""` when the key is absent or empty. */
  readonly raw: string;
  /** There IS a value and it is not a posture. Never the same fact as unset. */
  readonly unrecognised: boolean;
}

/** Classify a raw `governance_posture` value. Pure. */
export function classifyPosture(raw: string | null | undefined): PostureChoice {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return { posture: "soft", raw: "", unrecognised: false };
  const known = GOVERNANCE_POSTURES.find((p) => p === value);
  return known
    ? { posture: known, raw: value, unrecognised: false }
    : { posture: null, raw: value, unrecognised: true };
}

/**
 * The posture, read straight from `org-config.yaml`'s text. Pure.
 *
 * A second spelling of one fact, and deliberately so: `parseOrgConfig` gives it to the commands, and `doctor`
 * holds the TEXT (it reports on a workspace it may not have parsed) — one classifier under both, so the row
 * and the command can never disagree about what the file said.
 */
export function readPosture(text: string | null | undefined): PostureChoice {
  return classifyPosture(text ? readTopLevelScalar(text, "governance_posture") : null);
}

/** Endpoints copied out of the `services:` block into {@link OrgConfig.services}. */
const SERVICE_ENDPOINTS = ["vault", "oidc", "oidc_client_id", "jenkins", "npm", "docker"] as const;

/**
 * Every key gov reads UNDER `services:` — the endpoints plus `gov_account`, which is read there as a
 * fallback for the top-level spelling and is not an endpoint.
 */
export const ORG_CONFIG_SERVICE_KEYS = [...SERVICE_ENDPOINTS, "gov_account"] as const;
export type OrgConfigServiceKey = (typeof ORG_CONFIG_SERVICE_KEYS)[number];

/**
 * Top-level keys whose value is a BLOCK or a LIST gov reads with its own parser rather than `get()`. Listed
 * so the block heading is recognised, and so everything indented beneath it is skipped as gov's business
 * (nested keys are never reported unknown — the block's own parser owns them).
 */
const BLOCKS = [
  "services",           // readServiceScalar, below
  "repo_overrides",     // config/repo-overrides.ts
  "env_branches",       // readTopLevelList, below
  "authorized_agents",  // config/approved-agents.ts — which agents this org authorizes
  "session",            // written by setup; `access_ttl_sec` is read by the DEPLOY clients (gov-cicd/gov-infra)
] as const;

/**
 * Keys gov reads SOMEWHERE ELSE than this file. They belong on the list for one reason: the list answers
 * "does gov read this key", and an org told `legal_owner_github` is ignored would be told a falsehood — the
 * false-alarm failure mode `maintain/doctor.ts` keeps arguing against. Each names its reader; the role
 * handles come from CODEOWNERS' own table, so adding a role cannot drift from this.
 */
const READ_ELSEWHERE: readonly string[] = [
  "policy_owner_github",                    // config/codeowners.ts — the Policy Owner line
  CHECK_OWNER.key,                          // check_owner_github — config/codeowners.ts, the policies/actions/ line
  ...DOMAIN_ROLES.map((r) => r.key),        // legal_ / infra_ / system_arch_ / data_arch_owner_github
  "policy_effective_date",                  // setup.ts round-trip + <POLICY_EFFECTIVE_DATE> substitution
  // READ BY THE WORKFLOW THE FRAMEWORK SHIPS, not by this CLI (framework/templates/workflows/approver-check.yml).
  // §3.2's list of authorized representatives lives in `policies/authorized-representatives.md`, which names
  // PEOPLE by email and is seed-once — so the framework can never add machine-readable structure to it
  // (MANIFEST.yaml states that limit outright). The approver check needs GitHub logins, and this is where an
  // organization writes them. Optional: with no list, the workflow falls back to the role handles above.
  "authorized_approvers",
];

/** Every top-level key gov reads, from the one place each is declared. Exported for `gov doctor`. */
export const ORG_CONFIG_KEYS: readonly string[] = [...SCALARS, ...BLOCKS, ...READ_ELSEWHERE];

/**
 * Top-level keys present in the text that gov does not read — pure, and never a reason to stop.
 *
 * WHY THIS EXISTS. `preferences.ts` has said "gov does not know this setting — ignored" since it was
 * written, and `org-config.yaml` — the governed channel, the one reviewed and merged — said nothing at all.
 * A typed channel that silently drops what it does not understand cannot be trusted by the person filling
 * it in: a misspelling (`defualt_branch`) and an invention (`require_two_approvals`) both read as success.
 *
 * NEVER FATAL, NEVER A REASON TO STOP PARSING. An unknown key changes nothing about the keys gov did read,
 * and a config gov refuses to load is a gov that cannot tell you why.
 *
 * ONE CAVEAT, SAID OUT LOUD: `setup/create.ts`'s token sweep turns EVERY top-level scalar into a
 * `<UPPERCASE>` token for content substitution, so a key on nobody's list may still reach an adopter's
 * documents that way. "gov does not read this" is a statement about gov's typed readers, which is what the
 * person writing a governance value is relying on.
 */
export function unknownOrgConfigKeys(text: string): string[] {
  const known = new Set(ORG_CONFIG_KEYS);
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim()) continue;                       // blank
    if (/^\s/.test(line)) continue;                   // indented → inside a block, not a top-level key
    if (line.trimStart().startsWith("#")) continue;   // comment
    if (/^-\s/.test(line)) continue;                  // a list item, not a mapping key
    if (/^(---|\.\.\.)\s*$/.test(line)) continue;     // document markers
    const m = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*:/.exec(line);
    if (!m) continue;                                 // not a `key:` line at all
    const key = m[1]!;
    if (known.has(key) || out.includes(key)) continue;
    out.push(key);
  }
  return out;
}

export interface OrgConfig {
  readonly orgName: string;
  readonly orgShortName: string;
  readonly orgSlug: string;
  readonly orgSlugLower: string;
  readonly githubOrg: string;
  readonly workspaceRepo: string;
  /** `org_repo_url` — the gov repo clone URL (used by join). */
  readonly orgRepoUrl: string;
  readonly defaultBranch: string;
  readonly defaultCodeBranch: string;
  /**
   * `env_branches` — the env branches BETWEEN `default_branch` and `default_code_branch`, HIGHEST FIRST
   * (e.g. `[uat]`, or `[uat, sit]`). Absent → the two-rung ladder, which is what every adopter has before
   * they configure anything.
   *
   * Read by `close`, which must land a project branch in its base and then every branch below it — a HOTFIX
   * is cut from a higher env branch and has to reach both (adr-hotfix-release-line, PRJ-43).
   *
   * DELIBERATELY A SECOND COPY of something the deploy side also knows. `deploy-policy.yaml`'s `promotion:`
   * graph describes what may ADVANCE INTO what, with fan-out (`dev → [sit, uat]`); this is an ORDER to merge
   * in. A graph with fan-out has no single order, so deriving one here would mean gov-work picking a path
   * and calling it the answer. Two clients, two questions, one written down in each place — recorded here so
   * the duplication is a decision rather than something a later reader has to guess at (rkant, 2026-08-09).
   */
  readonly envBranches: readonly string[];
  /**
   * `repo_overrides` — where the WORK happens, when that is not where the issue
   * lives (#194). `owner/repo: owner/repo`, upstream on the left, the repo this org
   * can write on the right. Empty for every org that does not work from forks.
   */
  readonly repoOverrides: Readonly<Record<string, string>>;
  /** `agent_work_root`, expanded to an absolute path. */
  readonly agentWorkRoot: string;
  /** `gov_workspace`, expanded to an absolute path. */
  readonly govWorkspace: string;
  readonly policyOwnerEmail: string;
  /** OpenBao/Vault address (`vault_addr` or `services.vault`) — read by the DEPLOY clients (gov-cicd/gov-infra);
   *  gov-work stores no secrets. env `GOV_BAO_ADDR` overrides. */
  readonly vaultAddr: string;
  /** IAM broker OIDC base (`services.oidc`) — the deploy clients' `auth login` target. gov-work never uses it. */
  readonly oidcBase: string;
  /** The org service endpoints (`services:` block) as a generic map — vault/oidc used by core, jenkins/npm/
   *  docker read by the gov-cicd plugin. Org-level, governed; adopters inherit them. */
  readonly services: Readonly<Record<string, string>>;
  /** Gov tenant/account (`gov_account`) — the account context service auth mints under; env `GOV_ACCOUNT` overrides. */
  readonly govAccount: string;
  /**
   * `governance_posture` — hard or soft; absent or empty is soft (W2-Q6). See {@link PostureChoice}.
   */
  readonly governancePosture: PostureChoice;
  /** Token → value for tool-file substitution (seed phase B.1). */
  readonly orgTokens: Readonly<Record<string, string>>;
}

/** Parse `org-config.yaml` text into a typed {@link OrgConfig}. Pure. */
/** Read a scalar under the `services:` block (one indent level), stripping quotes + inline comments. */
/**
 * Read a top-level YAML list — both the block form and the inline form:
 *
 *   env_branches:        env_branches: [uat, sit]
 *     - uat
 *     - sit
 *
 * Kept as narrow as the scalar reader beside it: this file parses org-config in-process precisely so the
 * CLI needs no YAML dependency, and a general parser is not what is being asked for.
 */
function readTopLevelList(text: string, key: string): string[] {
  const clean = (v: string): string => v.trim().replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "").trim();
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
  if (at === -1) return [];
  const inline = new RegExp(`^${key}:\\s*\\[(.*)\\]`).exec(lines[at]!);
  if (inline) return inline[1]!.split(",").map(clean).filter(Boolean);
  const out: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (/^\S/.test(line)) break;                       // dedent → end of the block
    const m = /^\s+-\s*(.+)$/.exec(line);
    if (m) out.push(clean(m[1]!));
    else if (line.trim()) break;                       // a non-item under the key → not our list
  }
  return out.filter(Boolean);
}

/** Read a scalar under the `services:` block (one indent level), stripping quotes + inline comments. */
function readServiceScalar(text: string, key: OrgConfigServiceKey): string | undefined {
  let inServices = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^services:\s*$/.test(line)) { inServices = true; continue; }
    if (!inServices) continue;
    if (/^\S/.test(line)) break;                                   // dedent → end of the block
    const m = new RegExp(`^\\s+${key}:\\s*(.+)$`).exec(line);
    if (m) return m[1].trim().replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "").trim() || undefined;
  }
  return undefined;
}

export function parseOrgConfig(text: string, home: string = os.homedir()): OrgConfig {
  // TYPED, so the reader cannot read a key the published list does not name (see SCALARS above).
  const get = (key: OrgConfigScalarKey): string => readTopLevelScalar(text, key) ?? "";
  const svc = (key: OrgConfigServiceKey): string | undefined => readServiceScalar(text, key);
  // The org's service endpoints (org-level, governed). gov-work USES vault/oidc/account; jenkins/npm/docker
  // are read by the gov-cicd plugin — kept here as a generic map so the banner/creds see them uniformly.
  const services: Record<string, string> = {};
  for (const k of SERVICE_ENDPOINTS) { const v = svc(k); if (v) services[k] = v; }

  const orgName = get("org_name");
  const orgShortName = get("org_short_name");
  const orgSlug = get("org_slug");
  const orgSlugLower = get("org_slug_lower");
  const githubOrg = get("github_org");
  // `org_gov_repo`, with `workspace_repo` still read (Policy Owner, 2026-09-23). The name says what the
  // repository IS — the organization's governance repo — where "workspace" named where it happened to sit.
  // BOTH are read for one release, so an adopter who upgrades late is never broken; `gov upgrade` adds the new
  // key with the old value, and the old one can go a release later.
  const workspaceRepo = get("org_gov_repo") || get("workspace_repo");
  const orgRepoUrl = get("org_repo_url");
  const defaultBranch = get("default_branch");
  const defaultCodeBranch = get("default_code_branch");
  const envBranches = readTopLevelList(text, "env_branches");
  const repoOverrides = parseRepoOverrides(text);
  const agentWorkRoot = expandTilde(get("agent_work_root"), home);
  const govWorkspace = expandTilde(get("gov_workspace"), home);
  const policyOwnerEmail = get("policy_owner_email");
  // vault_addr (legacy top-level) OR services.vault; oidc + account likewise. Endpoints are org-level.
  const vaultAddr = get("vault_addr") || services.vault || "";
  const oidcBase = get("oidc_base") || services.oidc || "";
  const govAccount = get("gov_account") || svc("gov_account") || "";
  const governancePosture = classifyPosture(get("governance_posture"));

  const orgTokens: Record<string, string> = {
    ORG_NAME: orgName,
    ORG_SHORT_NAME: orgShortName,
    ORG_SLUG: orgSlug,
    org_slug: orgSlugLower,
    GITHUB_ORG: githubOrg,
    ORG_GOV_REPO: workspaceRepo,
    WORKSPACE_REPO: workspaceRepo,     // the old spelling, resolved for one release (see above)
    DEFAULT_BRANCH: defaultBranch,
    DEFAULT_CODE_BRANCH: defaultCodeBranch,
    AGENT_WORK_ROOT: agentWorkRoot,
    POLICY_OWNER_EMAIL: policyOwnerEmail,
  };

  return {
    orgName,
    orgShortName,
    orgSlug,
    orgSlugLower,
    githubOrg,
    workspaceRepo,
    orgRepoUrl,
    defaultBranch,
    defaultCodeBranch,
    envBranches,
    repoOverrides,
    agentWorkRoot,
    govWorkspace,
    policyOwnerEmail,
    vaultAddr,
    oidcBase,
    services,
    govAccount,
    governancePosture,
    orgTokens,
  };
}
