// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE ORG-CONFIG SPLIT — the one-time `gov upgrade` migration `org-config-split` (Policy Owner, 2026-10-06).
 *
 * An organization set up before the split has its governance choices in `org-config.yaml`. This carries each value
 * to where it lives now, once, and changes nothing else:
 *
 *   governance_posture, policy_owner_email/_github, check_owner_github,
 *   authorized_agents, knowledge_publication                         → policies/governance.yaml
 *   legal_ / infra_ / system_arch_ / data_arch_owner_github           → the role list (policies/authorized-representatives.md)
 *   agent_work_root                                                   → this person's ~/.gov/work-roots (when not the default)
 *   workspace_repo                                                    → renamed org_gov_repo, in place
 *   org_slug_lower                                                    → removed (it is org_slug in lower case)
 *   policy_effective_date, authorized_approvers                       → commented out: retired, with no new home, and
 *                                                                       left where a person can still read them
 *
 * BYTE-SAFE. Every line that is not one of these keys (or the comment directly above one) is kept exactly as it was.
 * governance.yaml is edited value by value, so its comments survive too.
 *
 * NOTHING IS LOST, OR NOTHING IS WRITTEN. {@link splitLoss} compares what gov read BEFORE — through the old readers'
 * eyes — with what it reads AFTER, from the new places. A value the migration moved is carried; a value that would
 * end up different (governance.yaml already saying something else, say) is a loss, and the caller writes nothing.
 *
 * Pure: text in, text out. upgrade-run.ts does the reading and writing.
 */
import { readTopLevelScalar } from "../resolve/node-env.js";
import { parseOrgConfig, defaultWorkRoot } from "../config/org-config.js";
import { parseGovernance, classifyPosture, renderGovernance, EMPTY_GOVERNANCE_VALUES, setGovernanceScalar } from "../config/governance.js";

/** Re-exported: it lived here before setup needed it too. */
export { setGovernanceScalar };
import { parseAuthorizedAgents, readAuthorizedAgents, withAuthorizedAgents } from "../config/approved-agents.js";
import { normalizeHandle } from "../config/codeowners.js";
import { parseRoleList } from "../config/role-list.js";

export interface SplitInput {
  readonly orgConfig: string;
  /** governance.yaml as it stands (the framework's template when the upgrade has just created it), or null. */
  readonly governance: string | null;
  /** policies/authorized-representatives.md, or null when the workspace has none. */
  readonly roleList: string | null;
}

export interface SplitResult {
  readonly orgConfig: string;
  readonly governance: string;
  readonly roleList: string | null;
  /** The work root to record on this person's machine, or null when the org's value was the default (or absent). */
  readonly workRoot: string | null;
  /** Anything changed at all. */
  readonly changed: boolean;
}

/** org-config key → path in governance.yaml, for the scalar values. */
const TO_GOVERNANCE: readonly { readonly key: string; readonly path: readonly string[] }[] = [
  { key: "governance_posture", path: ["governance_posture"] },
  { key: "policy_owner_email", path: ["policy_owner", "email"] },
  { key: "policy_owner_github", path: ["policy_owner", "github"] },
  { key: "check_owner_github", path: ["check_owner", "github"] },
  { key: "knowledge_publication", path: ["knowledge_publication"] },
];

/** The domain roles that were org-config keys, and the role-list row each becomes. */
const DOMAIN_ROLES: readonly { readonly key: string; readonly role: string; readonly owns: string }[] = [
  { key: "legal_owner_github", role: "Legal Owner", owns: "knowledge/legal/" },
  { key: "infra_owner_github", role: "Infrastructure Owner", owns: "knowledge/infrastructure/" },
  { key: "system_arch_owner_github", role: "System Architecture Owner", owns: "knowledge/architecture/system/" },
  { key: "data_arch_owner_github", role: "Data Architecture Owner", owns: "knowledge/architecture/data/" },
];

/** Keys removed outright (moved, or derived). */
const REMOVE = [...TO_GOVERNANCE.map((t) => t.key), "authorized_agents", ...DOMAIN_ROLES.map((d) => d.key), "agent_work_root", "org_slug_lower"];
/** Keys commented out: retired with no new home, kept readable. */
const COMMENT_OUT = ["policy_effective_date", "authorized_approvers"];

const scalar = (text: string, key: string): string => (readTopLevelScalar(text, key) ?? "").trim();
const hasKey = (text: string, key: string): boolean => new RegExp(`^${key}\\s*:`, "m").test(text);

/** The governance.yaml value at a path, read from the parsed file — for "is this still the template's?". */
function governanceValue(govText: string, path: readonly string[]): string {
  const g = parseGovernance(govText);
  switch (path.join(".")) {
    case "governance_posture": return g.posture.raw;
    case "policy_owner.email": return g.policyOwner.email;
    case "policy_owner.github": return g.policyOwner.github;
    case "check_owner.github": return g.checkOwner.github;
    case "knowledge_publication": return g.knowledgePublication;
    default: return "";
  }
}

/** The template's own value at a path: an org-config value replaces only this. */
const TEMPLATE_DEFAULT: Readonly<Record<string, string>> = { governance_posture: "soft", knowledge_publication: "none" };

/** The lines of a top-level key: its own line and everything indented (or blank) beneath it, up to the next key. */
function keyExtent(lines: readonly string[], i: number): number {
  let end = i + 1;
  for (let j = i + 1; j < lines.length; j++) {
    if (/^\s+\S/.test(lines[j]!)) { end = j + 1; continue; }
    if (lines[j]!.trim() === "") continue;
    break;
  }
  return end;
}

/** org-config.yaml with the moved keys removed, the retired ones commented out and workspace_repo renamed. */
function rewriteOrgConfig(text: string): string {
  const crlf = text.includes("\r\n");
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const del = new Array<boolean>(lines.length).fill(false);
  const comment = new Array<boolean>(lines.length).fill(false);
  const renameWorkspaceRepo = hasKey(text, "workspace_repo") && !scalar(text, "org_gov_repo");
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(lines[i]!);
    if (!m) continue;
    const key = m[1]!;
    const end = keyExtent(lines, i);
    if (REMOVE.includes(key) || (key === "workspace_repo" && !renameWorkspaceRepo)) {
      for (let j = i; j < end; j++) del[j] = true;
      // …and the comment directly above it, which described it.
      for (let j = i - 1; j >= 0 && (del[j] || /^\s*#/.test(lines[j]!)); j--) del[j] = true;
    } else if (COMMENT_OUT.includes(key)) {
      for (let j = i; j < end; j++) if (lines[j]!.trim()) comment[j] = true;
    }
  }
  const out: string[] = [];
  let noted = false;
  for (let i = 0; i < lines.length; i++) {
    if (del[i]) {
      // Removing a run between two blank lines leaves one blank, not two.
      const prevBlank = out.length === 0 || out[out.length - 1] === "";
      let k = i; while (k < lines.length && del[k]) k++;
      if (prevBlank && k < lines.length && lines[k] === "" && !del[k]) del[k] = true;
      continue;
    }
    let line = lines[i]!;
    if (comment[i]) {
      if (!noted) { out.push("# Retired by the org-config split (gov upgrade) — gov no longer reads this; kept for reference, delete when ready:"); noted = true; }
      line = `# ${line}`;
    } else if (renameWorkspaceRepo && /^workspace_repo\s*:/.test(line)) {
      line = line.replace(/^workspace_repo/, "org_gov_repo");
    }
    out.push(line);
  }
  const joined = out.join("\n");
  return crlf ? joined.replace(/\n/g, "\r\n") : joined;
}

/** Fill the role list's handles for the domain roles org-config named: a token or vacant cell, or a new table. */
function fillRoleList(roleList: string | null, orgConfig: string): string | null {
  const named = DOMAIN_ROLES.map((d) => ({ ...d, handle: normalizeHandle(scalar(orgConfig, d.key)) })).filter((d) => d.handle !== null);
  if (!named.length || roleList === null) return roleList;
  const parsed = parseRoleList(roleList);
  if (!parsed.found) {
    const table = [
      "", "| Role | GitHub handle | Owns |", "|---|---|---|",
      ...named.map((d) => `| ${d.role} | ${d.handle} | \`${d.owns}\` |`), "",
    ];
    return `${roleList.replace(/\n*$/, "\n")}${table.join("\n")}`;
  }
  let text = roleList;
  for (const d of named) {
    const row = parsed.roles.find((r) => r.role.toLowerCase() === d.role.toLowerCase());
    if (row && row.holder !== null) continue;                     // the table already names someone — it is the authority
    const re = new RegExp(`^(\\|\\s*${d.role.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\|)([^|]*)(\\|.*)$`, "mi");
    if (re.test(text)) text = text.replace(re, (_all, a: string, _b: string, c: string) => `${a} ${d.handle} ${c}`);
  }
  return text;
}

/** Carry org-config's governance values out of it. Pure; idempotent. */
export function splitOrgConfig(input: SplitInput): SplitResult {
  const cfg = input.orgConfig;
  let gov = input.governance ?? "";
  // GOV-FRM-445: a value the org WROTE is never replaced — only an empty one is filled. The template's own defaults
  // (`soft`, `none`) count as empty only while the file IS the template, untouched: in a file the org has edited,
  // `soft` is their answer, and an org-config that disagrees is a loss for a person to reconcile (splitLoss).
  const isTemplate = gov.trim() === "" || gov === renderGovernance(EMPTY_GOVERNANCE_VALUES);
  for (const { key, path } of TO_GOVERNANCE) {
    const v = scalar(cfg, key);
    if (!v) continue;
    const now = governanceValue(gov, path);
    if (now === v) continue;
    if (now === "" || (isTemplate && now === TEMPLATE_DEFAULT[path.join(".")])) gov = setGovernanceScalar(gov, path, v);
  }
  if (hasKey(cfg, "authorized_agents") && readAuthorizedAgents(gov).kind === "unset") {
    const agents = parseAuthorizedAgents(cfg);
    if (agents !== null) gov = withAuthorizedAgents(gov, agents) ?? gov;
  }
  const legacyRoot = scalar(cfg, "agent_work_root");
  const workRoot = legacyRoot && legacyRoot !== defaultWorkRoot(scalar(cfg, "org_slug")) ? legacyRoot : null;
  const orgConfig = rewriteOrgConfig(cfg);
  const roleList = fillRoleList(input.roleList, cfg);
  return {
    orgConfig, governance: gov, roleList, workRoot,
    changed: orgConfig !== cfg || gov !== (input.governance ?? "") || roleList !== input.roleList,
  };
}

/**
 * EVERY VALUE GOV READ BEFORE THAT IT WOULD NOT READ THE SAME AFTER — empty means nothing is lost. Each is named
 * `key ("value")`, the way a person would look for it in the file they wrote.
 */
export function splitLoss(before: SplitInput, after: SplitResult): string[] {
  const lost: string[] = [];
  const cfg = before.orgConfig;
  const named = (key: string, v: string): string => `${key} (${JSON.stringify(v)})`;

  // Identity and infrastructure: what parseOrgConfig returns must not change (the work root is judged below).
  const b = parseOrgConfig(cfg, "/") as unknown as Record<string, unknown>;
  const a = parseOrgConfig(after.orgConfig, "/") as unknown as Record<string, unknown>;
  for (const k of Object.keys(b)) {
    if (k === "keyReport" || k === "orgTokens" || k === "agentWorkRoot") continue;
    if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) lost.push(`${k} (${JSON.stringify(b[k])})`);
  }

  // Governance values, read the old way from org-config and the new way from governance.yaml.
  const g = parseGovernance(after.governance);
  const reads: Record<string, string> = {
    governance_posture: g.posture.raw, policy_owner_email: g.policyOwner.email, policy_owner_github: g.policyOwner.github,
    check_owner_github: g.checkOwner.github, knowledge_publication: g.knowledgePublication,
  };
  for (const { key } of TO_GOVERNANCE) {
    const v = scalar(cfg, key);
    if (!v) continue;
    const want = key === "governance_posture" ? classifyPosture(v).raw : v;
    if (reads[key] !== want) lost.push(named(key, v));
  }
  if (hasKey(cfg, "authorized_agents")) {
    const was = readAuthorizedAgents(cfg);
    if (was.kind !== "unset" && JSON.stringify(was) !== JSON.stringify(g.authorizedAgents)) lost.push("authorized_agents");
  }

  // Domain owners: carried when the role list now names the same holder — or when the table already named one.
  const beforeRoles = before.roleList ? parseRoleList(before.roleList) : ({ found: false } as const);
  const afterRoles = after.roleList ? parseRoleList(after.roleList) : ({ found: false } as const);
  for (const d of DOMAIN_ROLES) {
    const h = normalizeHandle(scalar(cfg, d.key));
    if (h === null) continue;
    const held = (p: typeof beforeRoles) => (p.found ? p.roles.find((r) => r.role.toLowerCase() === d.role.toLowerCase())?.holder ?? null : null);
    if (held(beforeRoles) !== null) continue;                     // the table was already the authority
    if (held(afterRoles) !== h) lost.push(named(d.key, scalar(cfg, d.key)));
  }

  // The work root: the default, or the value handed back to record.
  const root = scalar(cfg, "agent_work_root");
  if (root && (after.workRoot ?? defaultWorkRoot(scalar(cfg, "org_slug"))) !== root) lost.push(named("agent_work_root", root));
  return lost;
}
