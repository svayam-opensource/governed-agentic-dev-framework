// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE ORGANIZATION'S GOVERNANCE CHOICES — `policies/governance.yaml` (org-config split, Policy Owner 2026-10-06).
 *
 * `org-config.yaml` used to hold two kinds of value with two kinds of owner: who the organization IS (its name, its
 * repositories, its service endpoints) and how it GOVERNS (its posture, who owns its policy, which agents it allows).
 * The second kind is policy — a change to it needs the Policy Owner — so it lives under `policies/` now, beside the
 * policy it configures, routed to the Policy Owner by CODEOWNERS and by the section-owner-approval check.
 *
 *   governance_posture     soft | hard — soft when absent or empty (W2-Q6)
 *   policy_owner           { email, github } — the framework's first built-in role
 *   check_owner            { github } — the second; vacant escalates to the Policy Owner (GOV-FRM-033)
 *   authorized_agents      which agents the org authorizes (config/approved-agents.ts reads the block)
 *   knowledge_publication  none | site | site+pdf | site+pdf+rag
 *   models                 which model the org approves for `gov rules propose` (framework §9.3)
 *
 * SEED-ONCE. The framework ships it empty, `gov setup` fills it, and from then on it is the organization's: `gov
 * upgrade` never writes it again, except the one recorded `org-config-split` migration that carries an older org's
 * values here out of `org-config.yaml`.
 *
 * Every read is PURE over text; {@link readGovernance} is the one function that touches the disk.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import { readAuthorizedAgents, type AuthorizedAgents } from "./approved-agents.js";

/** Where the file lives, repo-relative. */
export const GOVERNANCE_PATH = "policies/governance.yaml";

/** The top-level keys gov reads in governance.yaml — anything else is reported, never acted on. */
export const GOVERNANCE_KEYS = ["governance_posture", "policy_owner", "check_owner", "authorized_agents", "knowledge_publication", "models"] as const;

/* ─────────────────────────────── the posture ─────────────────────────────── */

/**
 * HARD OR SOFT GOVERNANCE — the posture an organization CHOOSES (Policy Owner, 2026-09-29).
 *
 * `hard`  the action (a merge, say) is stopped when a policy violation is detected.
 * `soft`  a violation record is opened so the Policy Owner can review it later.
 */
export type GovernancePosture = "hard" | "soft";

/** Every posture gov understands — the list the messages quote, so they cannot drift from the type. */
export const GOVERNANCE_POSTURES: readonly GovernancePosture[] = ["hard", "soft"];

/**
 * What the file says about the posture. ABSENT OR EMPTY IS `soft` (W2-Q6); `raw` stays `""` so a report can say
 * soft is the DEFAULT rather than a recorded choice. `unrecognised` is a value that is not a posture — someone who
 * chose and was not heard; `posture` is null only then.
 */
export interface PostureChoice {
  readonly posture: GovernancePosture | null;
  readonly raw: string;
  readonly unrecognised: boolean;
}

/** Classify a raw `governance_posture` value. Pure. */
export function classifyPosture(raw: string | null | undefined): PostureChoice {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return { posture: "soft", raw: "", unrecognised: false };
  const known = GOVERNANCE_POSTURES.find((p) => p === value);
  return known ? { posture: known, raw: value, unrecognised: false } : { posture: null, raw: value, unrecognised: true };
}

/** The posture, from governance.yaml's TEXT. Pure. */
export function readPosture(governanceText: string | null | undefined): PostureChoice {
  return parseGovernance(governanceText ?? null).posture;
}

/* ─────────────────────────────── the whole file ─────────────────────────────── */

/** The providers `gov rules propose` can call. `command` runs a CLI that reads the request on stdin. */
export type ModelProvider = "anthropic" | "command";
const PROVIDERS: readonly ModelProvider[] = ["anthropic", "command"];

export interface GovernanceConfig {
  /** The file existed (and was read). An absent file is every default — and not the same fact as a chosen default. */
  readonly present: boolean;
  readonly posture: PostureChoice;
  readonly policyOwner: { readonly email: string; readonly github: string };
  readonly checkOwner: { readonly github: string };
  readonly authorizedAgents: AuthorizedAgents;
  readonly knowledgePublication: string;
  readonly models: {
    readonly propose: { readonly provider: string; readonly model: string };
    readonly command: string;
    readonly ciAllowed: boolean;
  };
  /** What gov could not use: bad YAML, a key it does not read, a provider it does not know. Never fatal. */
  readonly problems: readonly string[];
}

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "object" ? "" : String(v)).trim();

/**
 * Parse governance.yaml text. NEVER THROWS: a file gov cannot read gives every default plus a problem saying why,
 * because a broken file must not be able to break `gov doctor`, which is how anyone would find out.
 */
export function parseGovernance(text: string | null | undefined): GovernanceConfig {
  const problems: string[] = [];
  let doc: Record<string, unknown> = {};
  if (text && text.trim()) {
    try {
      const loaded = yaml.load(text);
      if (isMap(loaded)) doc = loaded;
      else if (loaded !== null && loaded !== undefined) problems.push(`${GOVERNANCE_PATH} should be a mapping of keys — gov is using the defaults`);
    } catch (e) {
      problems.push(`${GOVERNANCE_PATH} is not valid YAML (${(e as Error).message.split("\n")[0]}) — gov is using the defaults`);
    }
  }
  for (const k of Object.keys(doc)) {
    if (!(GOVERNANCE_KEYS as readonly string[]).includes(k)) problems.push(`${k}: gov does not read this key in ${GOVERNANCE_PATH} — ignored`);
  }
  const po = isMap(doc.policy_owner) ? doc.policy_owner : {};
  const co = isMap(doc.check_owner) ? doc.check_owner : {};
  const models = isMap(doc.models) ? doc.models : {};
  const propose = isMap(models.propose) ? models.propose : {};
  const provider = str(propose.provider).toLowerCase();
  if (provider && !(PROVIDERS as readonly string[]).includes(provider)) {
    problems.push(`models.propose.provider: "${provider}" is not one gov can call (${PROVIDERS.join(" · ")}) — no model is approved`);
  }
  const ciRaw = models.ci_allowed;
  if (ciRaw !== undefined && ciRaw !== null && typeof ciRaw !== "boolean") {
    problems.push("models.ci_allowed: expected true or false — read as false");
  }
  return {
    present: text !== null && text !== undefined,
    posture: classifyPosture(str(doc.governance_posture)),
    policyOwner: { email: str(po.email), github: str(po.github) },
    checkOwner: { github: str(co.github) },
    // The agents block keeps its own reader (block or flow form, `none`, the default marker) — one reader for it.
    authorizedAgents: readAuthorizedAgents(text ?? null),
    knowledgePublication: str(doc.knowledge_publication) || "none",
    models: { propose: { provider, model: str(propose.model) }, command: str(models.command), ciAllowed: ciRaw === true },
    problems,
  };
}

/** Read `<home>/policies/governance.yaml`. Absent → the defaults, with `present: false`. */
export function readGovernance(home: string, read: (abs: string) => string | null = defaultRead): GovernanceConfig {
  return parseGovernance(read(path.join(home, GOVERNANCE_PATH)));
}

function defaultRead(abs: string): string | null {
  try { return fs.readFileSync(abs, "utf8"); } catch { return null; /* absent: the ordinary answer for a workspace not yet split */ }
}

/**
 * THE MODEL SETTINGS `gov rules propose` READS (framework §9.3). `provider` is null when no model is approved — an
 * empty provider, or one gov cannot call. `ciAllowed` is true only when the file says exactly `true`.
 */
export function modelSettings(g: GovernanceConfig): { provider: ModelProvider | null; model: string; command: string; ciAllowed: boolean } {
  const p = g.models.propose.provider;
  const provider = (PROVIDERS as readonly string[]).includes(p) ? (p as ModelProvider) : null;
  return { provider, model: g.models.propose.model, command: g.models.command, ciAllowed: g.models.ciAllowed };
}

/** The framework's two built-in roles' handles, as written (CODEOWNERS and the role checks normalise them). */
export function frameworkOwners(g: GovernanceConfig): { policyOwner: string; checkOwner: string } {
  return { policyOwner: g.policyOwner.github, checkOwner: g.checkOwner.github };
}

/** The content tokens these values fill — they came from org-config.yaml's keys before the split. */
export function governanceTokens(g: GovernanceConfig): Record<string, string> {
  const out: Record<string, string> = {};
  if (g.policyOwner.email) out.POLICY_OWNER_EMAIL = g.policyOwner.email;
  if (g.policyOwner.github) out.POLICY_OWNER_GITHUB = g.policyOwner.github;
  if (g.checkOwner.github) out.CHECK_OWNER_GITHUB = g.checkOwner.github;
  return out;
}

/* ─────────────────────────────── writing it ─────────────────────────────── */

/** What setup writes. */
export interface GovernanceValues {
  readonly governancePosture: string;
  readonly policyOwnerEmail: string;
  readonly policyOwnerGithub: string;
  readonly checkOwnerGithub: string;
  /** The default agent, or "" (setup records the full list afterwards with `withAuthorizedAgents`). */
  readonly defaultAgent: string;
  readonly knowledgePublication: string;
}

/** The framework's template is this file with nothing filled in (a test holds the shipped copy to it). */
export const EMPTY_GOVERNANCE_VALUES: GovernanceValues = {
  governancePosture: "soft", policyOwnerEmail: "", policyOwnerGithub: "", checkOwnerGithub: "", defaultAgent: "", knowledgePublication: "none",
};

/** Render governance.yaml. */
export function renderGovernance(v: GovernanceValues): string {
  return `# Governance choices — how this organization governs (policies/governance.yaml).
#
# These are POLICY: a change to this file needs the Policy Owner's approval (CODEOWNERS routes it to them, and
# the section-owner-approval check requires it). The framework ships this file once, \`gov setup\` fills it in,
# and from then on it is yours — \`gov upgrade\` never rewrites it. Who the organization IS (its name, its
# repositories, its service endpoints) is in org-config.yaml.

# HARD OR SOFT GOVERNANCE.
#   soft   a violation opens a record so the Policy Owner can review it later. The default.
#   hard   the action (for example a merge) is stopped when a policy violation is detected. Needs public
#          repositories or a paid GitHub plan: on a private repository on GitHub Free, checks run but cannot block.
governance_posture: "${v.governancePosture}"

# THE POLICY OWNER — approves your policies, and holds every role nobody else holds.
policy_owner:
  email: "${v.policyOwnerEmail}"
  github: "${v.policyOwnerGithub}"

# THE CHECK OWNER — reviews the CODE of your check actions (policies/actions/); the Policy Owner approves the rules.
# Left empty, the role is vacant and the Policy Owner approves that code too. One person in both roles turns the
# two-key review off; \`gov doctor\` says so.
check_owner:
  github: "${v.checkOwnerGithub}"

# WHICH AI AGENTS THIS ORGANIZATION AUTHORIZES, and which gov launches by default. Every id comes from the
# framework's list (\`gov agent list\`); \`gov agent approve <id>\` raises the pull request that adds one.
# \`authorized_agents: none\` is a real answer: this organization uses gov for its process and runs no AI agents.
# Left empty, gov uses the framework's defaults and says so.
authorized_agents:
  default: "${v.defaultAgent}"

# WHETHER THIS ORGANIZATION PUBLISHES ITS KNOWLEDGE: none · site · site+pdf · site+pdf+rag.
# See policies/knowledge-publication.md.
knowledge_publication: "${v.knowledgePublication}"

# WHICH MODEL THE ORGANIZATION APPROVES FOR \`gov rules propose\` (framework specification §9.3).
#   propose.provider   anthropic · command — empty means no model is approved, and propose asks you instead.
#   propose.model      the model id, for the anthropic provider.
#   command            provider=command: a CLI that reads the request on stdin and writes the reply on stdout.
#   ci_allowed         true lets CI run propose as the fallback on a policy pull request.
models:
  propose:
    provider: ""
    model: ""
  command: ""
  ci_allowed: false
`;
}
