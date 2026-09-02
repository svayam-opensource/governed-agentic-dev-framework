// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov agent` — the door that stays open (#196, Q1).
 *
 * Agent help used to exist for about ten seconds: the moment the Work flow found a
 * prepared project and nothing to run in it. Decline once and there was no way back;
 * want a second agent later and there was no way in; ask "which agents may I use
 * here?" and there was nothing to ask.
 *
 * So the same flow gets a verb as well as a step in adoption. One code path, two
 * doors — reporting is pure and lives here; installing and signing in are performed
 * by the caller, which owns the terminal.
 *
 *   gov agent                what is approved, installed, signed in
 *   gov agent install <id>   install an approved agent
 *   gov agent approve <id>   propose adding one — a pull request, not an edit
 */
import { AGENT_CATALOG, variantStatuses, runnableVariants, type AgentCandidate, type VariantStatus } from "./agent-catalog.js";
import { defaultAgent, type ApprovedAgent } from "../config/approved-agents.js";

export interface AgentReportFacts {
  /** The org's block, or null when the policy carries none. */
  readonly approved: readonly ApprovedAgent[] | null;
  readonly hasTool: (cmd: string) => boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Whether the backup copy of a key differs from the agent's own — never its value. */
  readonly credentialDrift?: (agentId: string) => boolean;
}

export interface AgentRow {
  readonly agent: AgentCandidate;
  readonly isDefault: boolean;
  readonly variants: readonly VariantStatus[];
  readonly runnable: readonly VariantStatus[];
  readonly credentialPresent: boolean | null;
  readonly credentialDrifted: boolean;
}

export interface AgentReport {
  readonly rows: readonly AgentRow[];
  /** Approved agents the framework has no harness for — should be impossible; reported if it happens. */
  readonly unknownIds: readonly string[];
  readonly usingDefaults: boolean;
}

export function agentReport(f: AgentReportFacts): AgentReport {
  // No block at all → the org has not decided, so show the framework's list and say
  // so. An empty block is different: it means somebody decided on nothing, and an
  // empty report is the honest answer to that.
  const usingDefaults = f.approved === null;
  const approved: readonly ApprovedAgent[] = f.approved ?? AGENT_CATALOG.map((a) => ({ id: a.id }));
  const def = defaultAgent(approved);

  const rows: AgentRow[] = [];
  const unknownIds: string[] = [];
  for (const a of approved) {
    const candidate = AGENT_CATALOG.find((c) => c.id === a.id);
    if (!candidate) { unknownIds.push(a.id); continue; }
    const variants = variantStatuses(candidate, f.hasTool);
    rows.push({
      agent: candidate,
      isDefault: candidate.id === def,
      variants,
      runnable: runnableVariants(variants),
      credentialPresent: candidate.credentialEnv ? Boolean(f.env[candidate.credentialEnv]) : null,
      credentialDrifted: f.credentialDrift?.(candidate.id) ?? false,
    });
  }
  return { rows, unknownIds, usingDefaults };
}

const pad = (s: string, n: number): string => (s.length >= n ? s : s + " ".repeat(n - s.length));

export function formatAgentReport(r: AgentReport): readonly string[] {
  const out: string[] = [""];
  out.push(r.usingDefaults
    ? "  Your organization has not approved any agents yet — showing the framework's list."
    : "  Approved by your organization  (knowledge/policies/llm-governance.md)");
  out.push("");

  if (!r.rows.length && !r.unknownIds.length) {
    out.push("  Nothing is approved. Add one with `gov agent approve <id>`, which raises a");
    out.push("  pull request to whoever owns this policy.");
    return out;
  }

  for (const row of r.rows) {
    const name = pad(row.agent.tool + (row.isDefault ? "  (default)" : ""), 30);
    // "not installed" is wrong for a browser tool — there is nothing to install, and
    // saying otherwise invites someone to try.
    const ready = row.runnable.length
      ? row.runnable.map((v) => v.variant.label + (v.host ? ` — in ${v.host}` : "")).join(", ")
      : row.agent.launch === "none" ? "in your browser — nothing to install" : "not installed";
    out.push(`    ${name} ${ready}`);
    // A key's PRESENCE, never its value: the honest half of "is this ready?" is the
    // half that needs no secret.
    if (row.credentialPresent === false) {
      out.push(`    ${pad("", 30)} no ${row.agent.credentialEnv} set — it may ask you to sign in`);
    }
    if (row.credentialDrifted) {
      out.push(`    ${pad("", 30)} ⚠ your saved copy of this key differs from the one the agent uses`);
    }
    for (const v of row.variants) {
      if (v.variant.kind === "extension" && v.host === null) {
        out.push(`    ${pad("", 30)} ${v.variant.label}: needs VS Code or Cursor — gov will not install an editor`);
      }
    }
  }

  if (r.unknownIds.length) {
    out.push("");
    out.push(`  ⚠ approved but unknown to this version of gov: ${r.unknownIds.join(", ")}`);
    out.push("    Nothing can be launched for these — check the id, or upgrade gov.");
  }
  out.push("");
  out.push("  gov agent install <id>   install one");
  out.push("  gov agent approve <id>   propose adding one (raises a pull request)");
  return out;
}

/** What `install` will do, decided before anything runs. */
export type InstallPlan =
  | { readonly ok: false; readonly message: string }
  | {
      readonly ok: true;
      readonly agent: AgentCandidate;
      readonly steps: readonly { readonly what: string; readonly command: readonly string[] }[];
      readonly signIn: readonly string[] | null;
      readonly signupUrl: string | null;
    };

export function planAgentInstall(
  id: string,
  approved: readonly ApprovedAgent[] | null,
  hasTool: (cmd: string) => boolean,
): InstallPlan {
  const agent = AGENT_CATALOG.find((a) => a.id === id);
  if (!agent) {
    return { ok: false, message: `'${id}' is not an agent this version of gov knows. Try \`gov agent\` for the list.` };
  }
  // Approval is the gate, and the only one. An unapproved agent is Prohibited by
  // default (C01, POL-136) — gov installing it would put the tool in breach of the
  // policy it exists to enforce.
  const list = approved ?? AGENT_CATALOG.map((a) => ({ id: a.id }));
  if (!list.some((a) => a.id === id)) {
    return {
      ok: false,
      message: `${agent.tool} is not approved by your organization, so gov will not install it.\n` +
        `  Propose it with:  gov agent approve ${id}\n` +
        "  That raises a pull request to whoever owns knowledge/policies/llm-governance.md.",
    };
  }

  const steps: { what: string; command: readonly string[] }[] = [];
  for (const v of variantStatuses(agent, hasTool)) {
    if (v.variant.kind === "extension") {
      if (v.host) steps.push({ what: `${v.variant.label} (into ${v.host})`, command: [v.host, "--install-extension", v.variant.extensionId!] });
      continue;                                     // no host → skipped, never created
    }
    if (v.installed) continue;
    const inst = v.variant.install;
    if (inst?.npm) steps.push({ what: v.variant.label, command: ["npm", "install", "-g", inst.npm] });
    else if (inst?.script) steps.push({ what: v.variant.label, command: ["sh", "-c", inst.script] });
  }

  if (!steps.length) {
    return { ok: false, message: `${agent.tool} is already installed. \`gov agent\` shows what is signed in.` };
  }
  const cli = (agent.variants ?? []).find((v) => v.kind === "cli" && v.login);
  return { ok: true, agent, steps, signIn: cli?.login ?? null, signupUrl: agent.signupUrl ?? null };
}
