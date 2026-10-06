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
import yaml from "js-yaml";
import { parseRepoOverrides } from "./repo-overrides.js";
import { readTopLevelScalar, expandTilde } from "../resolve/node-env.js";

/**
 * THE SCALARS THIS READER READS — the one list, and the only way to name one (PRJ-121, 2026-09-27).
 *
 * `get()` below takes a {@link OrgConfigScalarKey}, so a key read without being declared here is a TYPE
 * error rather than a thing someone remembers to do, and `test/config/org-config-keys.test.ts` re-reads this
 * file's text to catch a reader that goes around `get()` entirely. The list exists because gov OWNS the
 * schema of this channel — published as `framework/config/org-config.schema.yaml`, which a test holds to
 * these lists (org-config split, Policy Owner 2026-10-06).
 *
 * IDENTITY AND INFRASTRUCTURE ONLY. How the organization governs (posture, Policy and Check Owner, agents,
 * knowledge publication, models) is in `policies/governance.yaml` (config/governance.ts); where a person's
 * project folders live is theirs ({@link defaultWorkRoot}, `~/.gov/work-roots`).
 */
const SCALARS = [
  "org_name", "org_short_name", "org_slug", "github_org",
  "org_gov_repo", "workspace_repo", "org_repo_url",
  "default_branch", "default_code_branch",
  "gov_workspace",
  "vault_addr", "oidc_base", "gov_account",
] as const;
export type OrgConfigScalarKey = (typeof SCALARS)[number];

/** The keys an org-config.yaml must carry — gov cannot work for the organization without them. */
export const REQUIRED_ORG_CONFIG_KEYS: readonly string[] = [
  "org_name", "org_short_name", "org_slug", "org_repo_url", "github_org", "org_gov_repo", "default_branch", "default_code_branch",
];

/** Keys still read under an old name, old → new. `gov upgrade` renames them (the `org-config-split` migration). */
export const REPLACED_ORG_CONFIG_KEYS: Readonly<Record<string, string>> = {
  workspace_repo: "org_gov_repo",
  vault_addr: "services.vault",
  oidc_base: "services.oidc",
};

/**
 * KEYS THAT HAVE LEFT org-config.yaml, and where each went (org-config split, Policy Owner 2026-10-06). gov no
 * longer reads any of them here; `gov upgrade` carries their values once (upgrade-run.ts `org-config-split`) and
 * `gov doctor` names any still present.
 */
export const RETIRED_ORG_CONFIG_KEYS: Readonly<Record<string, string>> = {
  governance_posture: "policies/governance.yaml (governance_posture)",
  policy_owner_email: "policies/governance.yaml (policy_owner.email)",
  policy_owner_github: "policies/governance.yaml (policy_owner.github)",
  check_owner_github: "policies/governance.yaml (check_owner.github)",
  authorized_agents: "policies/governance.yaml (authorized_agents)",
  knowledge_publication: "policies/governance.yaml (knowledge_publication)",
  legal_owner_github: "the role list in policies/authorized-representatives.md",
  infra_owner_github: "the role list in policies/authorized-representatives.md",
  system_arch_owner_github: "the role list in policies/authorized-representatives.md",
  data_arch_owner_github: "the role list in policies/authorized-representatives.md",
  authorized_approvers: "nowhere — approvers are the Policy Owner, the Check Owner and the role list's holders",
  agent_work_root: "your own machine (~/.gov/work-roots); the default is ~/.gov/<slug>/projects",
  org_slug_lower: "nowhere — it is org_slug in lower case",
  policy_effective_date: "nowhere — a policy's history is its version and CHANGELOG",
};

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
  "session",            // written by setup; `access_ttl_sec` is read by the DEPLOY clients (gov-cicd/gov-infra)
] as const;

/** Every top-level key gov reads, from the one place each is declared. Exported for `gov doctor`. */
export const ORG_CONFIG_KEYS: readonly string[] = [...SCALARS, ...BLOCKS];

/** The top-level `key:` names in the text, in order, once each. Comments, list items and nested keys are skipped. */
function topLevelKeys(text: string): string[] {
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
    if (!out.includes(m[1]!)) out.push(m[1]!);
  }
  return out;
}

/**
 * Top-level keys present in the text that gov does not read — pure, and never a reason to stop.
 *
 * WHY THIS EXISTS. A typed channel that silently drops what it does not understand cannot be trusted by the
 * person filling it in: a misspelling (`defualt_branch`) and an invention (`require_two_approvals`) both read
 * as success. A RETIRED key is not unknown — it is reported by {@link validateOrgConfig} with where it went.
 *
 * NEVER FATAL, NEVER A REASON TO STOP PARSING. An unknown key changes nothing about the keys gov did read,
 * and a config gov refuses to load is a gov that cannot tell you why.
 */
export function unknownOrgConfigKeys(text: string, known: readonly string[] = ORG_CONFIG_KEYS): string[] {
  const k = new Set(known);
  return topLevelKeys(text).filter((key) => !k.has(key) && !(key in RETIRED_ORG_CONFIG_KEYS));
}

/** What a check of org-config.yaml against the schema found. Every list empty = the file matches. */
export interface OrgConfigKeyReport {
  /** Keys neither the schema nor the retired list names. */
  readonly unknown: readonly string[];
  /** Required keys absent or empty. */
  readonly missing: readonly string[];
  /** Keys that have left the file, with where each went. */
  readonly retired: readonly { readonly key: string; readonly movedTo: string }[];
  /** Keys still read under an old name, with the new one. */
  readonly replaced: readonly { readonly key: string; readonly by: string }[];
}

/** Where the framework ships the schema in a workspace (scaffold-auto: `gov upgrade` writes it). */
export const ORG_CONFIG_SCHEMA_PATH = "framework/config/org-config.schema.yaml";

/** The parts of `framework/config/org-config.schema.yaml` a check needs. */
export interface OrgConfigSchema {
  readonly keys: readonly string[];
  readonly required: readonly string[];
  readonly replaced: Readonly<Record<string, string>>;
  readonly retired: Readonly<Record<string, string>>;
}

/** The schema gov was built with — what `parseOrgConfig` reads. A test holds the shipped schema file to it. */
export const BUILT_IN_ORG_CONFIG_SCHEMA: OrgConfigSchema = {
  keys: ORG_CONFIG_KEYS, required: REQUIRED_ORG_CONFIG_KEYS, replaced: REPLACED_ORG_CONFIG_KEYS, retired: RETIRED_ORG_CONFIG_KEYS,
};

/**
 * Parse the schema file's text. Null when it cannot be read as one — the caller then uses the built-in schema,
 * because a broken schema file must not stop `gov doctor` from checking anything.
 */
export function parseOrgConfigSchema(text: string | null | undefined): OrgConfigSchema | null {
  if (!text) return null;
  let doc: unknown;
  try { doc = yaml.load(text); } catch { return null; /* unreadable: the built-in schema applies */ }
  const isMap = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  if (!isMap(doc) || !isMap(doc.keys)) return null;
  const keys = Object.keys(doc.keys);
  const required = keys.filter((k) => isMap((doc.keys as Record<string, unknown>)[k]) && ((doc.keys as Record<string, Record<string, unknown>>)[k]!.required === true));
  const replaced: Record<string, string> = {};
  for (const k of keys) {
    const e = (doc.keys as Record<string, unknown>)[k];
    if (isMap(e) && typeof e.replaced === "string") replaced[k] = e.replaced;
  }
  const retired: Record<string, string> = {};
  if (isMap(doc.retired)) for (const [k, v] of Object.entries(doc.retired)) retired[k] = String(v);
  return { keys, required, replaced, retired };
}

/**
 * Check org-config.yaml's text against the schema (the workspace's `framework/config/org-config.schema.yaml` when
 * there is one, else the one gov was built with). Pure; never throws.
 */
export function validateOrgConfig(text: string, schema: OrgConfigSchema = BUILT_IN_ORG_CONFIG_SCHEMA): OrgConfigKeyReport {
  const present = topLevelKeys(text);
  const known = new Set(schema.keys);
  return {
    unknown: present.filter((k) => !known.has(k) && !(k in schema.retired)),
    missing: schema.required.filter((k) => {
      if ((readTopLevelScalar(text, k) ?? "").trim()) return false;
      // A required key still under its old name is not missing — it is reported as replaced.
      return !Object.entries(schema.replaced).some(([old, now]) => now === k && (readTopLevelScalar(text, old) ?? "").trim());
    }),
    retired: present.filter((k) => k in schema.retired).map((key) => ({ key, movedTo: schema.retired[key]! })),
    replaced: present.filter((k) => k in schema.replaced).map((key) => ({ key, by: schema.replaced[key]! })),
  };
}

/** The lines a command prints when org-config.yaml does not match the schema — none when it does. */
export function orgConfigLoadNotes(r: OrgConfigKeyReport): string[] {
  const out: string[] = [];
  if (r.retired.length) out.push(`gov: org-config.yaml still holds ${r.retired.map((x) => x.key).join(", ")}, which moved out of it — run \`gov upgrade\` to carry them (\`gov doctor\` says where each went).`);
  if (r.missing.length) out.push(`gov: org-config.yaml is missing ${r.missing.join(", ")} — run \`gov setup\`.`);
  if (r.unknown.length) out.push(`gov: org-config.yaml has ${r.unknown.join(", ")}, which gov does not read (ignored).`);
  return out;
}

/**
 * WHERE A PERSON'S PROJECT FOLDERS LIVE, when they have not said otherwise: `~/.gov/<slug>/projects`, beside the
 * governance repository's own `~/.gov/<slug>/gov_repo` (the workspace-resolution contract, R9/R10). Empty while
 * the org has no slug (a template not yet set up).
 *
 * It left org-config.yaml in the split: it is a fact about ONE person's machine, and one org-wide value either
 * fits everybody's disk or quietly does not. A person who wants it elsewhere records it in `~/.gov/work-roots`
 * (`<github_org>\t<path>`, the same shape as the workspace registry beside it).
 */
export function defaultWorkRoot(orgSlug: string): string {
  const s = orgSlug.trim().toLowerCase();
  return s ? `~/.gov/${s}/projects` : "";
}

export interface OrgConfig {
  readonly orgName: string;
  readonly orgShortName: string;
  readonly orgSlug: string;
  /** `org_slug` in lower case — derived, never written (the `org_slug_lower` key is retired). */
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
  /**
   * Where this person's project folders live, expanded: their own choice (`~/.gov/work-roots`) when the caller
   * passes one, else {@link defaultWorkRoot}. No longer an org-config key.
   */
  readonly agentWorkRoot: string;
  /** `gov_workspace`, expanded to an absolute path. */
  readonly govWorkspace: string;
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
  /** The file checked against the schema gov was built with: unknown, missing, retired and renamed keys. */
  readonly keyReport: OrgConfigKeyReport;
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

/** What the caller knows that the file does not: this person's own work root, when they recorded one. */
export interface OrgConfigExtras {
  readonly workRoot?: string | null;
}

export function parseOrgConfig(text: string, home: string = os.homedir(), extras: OrgConfigExtras = {}): OrgConfig {
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
  const orgSlugLower = orgSlug.toLowerCase();
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
  const agentWorkRoot = expandTilde((extras.workRoot ?? "").trim() || defaultWorkRoot(orgSlug), home);
  const govWorkspace = expandTilde(get("gov_workspace"), home);
  // vault_addr (legacy top-level) OR services.vault; oidc + account likewise. Endpoints are org-level.
  const vaultAddr = get("vault_addr") || services.vault || "";
  const oidcBase = get("oidc_base") || services.oidc || "";
  const govAccount = get("gov_account") || svc("gov_account") || "";

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
    vaultAddr,
    oidcBase,
    services,
    govAccount,
    keyReport: validateOrgConfig(text),
    orgTokens,
  };
}
