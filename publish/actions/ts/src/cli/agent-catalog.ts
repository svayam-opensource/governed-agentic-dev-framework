// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Which agents gov may offer, and what it knows about each (#195).
 *
 * The menu used to be four hard-coded lines — Claude, cursor, Cursor GUI, shell —
 * offered whole to a machine with none of them installed, and led by a tool the
 * policy the same install had just seeded lists as prohibited.
 *
 * WHAT MAKES AN AGENT OFFERABLE IS A HARNESS. `agent/harness-manifest.yaml` renders
 * a rules file per tool — CLAUDE.md, .cursor/rules/agent.mdc, .clinerules/agent.md
 * and the rest — and that file is how the session protocol reaches the agent at all.
 * A tool with no harness would be launched into a project it cannot read the rules
 * of, which is worse than not offering it. So the manifest is the list, and a test
 * holds this file to it rather than a second hand-kept copy drifting from the first
 * — the same fix as ADOPTER_DIRS against MANIFEST.yaml and the itinerary against
 * the checklist.
 *
 * HOW THE RULES ARRIVE differs, and the menu should say so:
 *
 *   cli   gov passes the protocol as an argument      claude "<protocol>"
 *   ide   gov opens the folder; the tool's own agent reads the rules from the repo
 *
 * Both are governed. "Run an agent" and "open my editor here" are still not the
 * same offer, and one undifferentiated row said they were.
 */

export type LaunchKind = "cli" | "ide" | "none";

export interface AgentCandidate {
  /** Matches the harness manifest's `id`, which is what makes this list checkable. */
  readonly id: string;
  readonly tool: string;
  readonly launch: LaunchKind;
  /** The executable to probe and to run. Absent when gov cannot launch it. */
  readonly cmd?: string;
  /** How to install it, per platform family. Shown, never run without consent. */
  readonly install?: { readonly npm?: string; readonly brew?: string; readonly url: string };
  /** The environment variable that would hold a key, so gov can report its absence. */
  readonly credentialEnv?: string;
}

/**
 * Every harness the framework renders. `launch: "none"` entries are governed but
 * not startable from here — a browser tool has no command to run.
 */
export const AGENT_CATALOG: readonly AgentCandidate[] = [
  { id: "claude-code", tool: "Claude Code", launch: "cli", cmd: "claude",
    install: { npm: "@anthropic-ai/claude-code", url: "https://claude.com/claude-code" },
    credentialEnv: "ANTHROPIC_API_KEY" },
  { id: "cursor", tool: "Cursor", launch: "cli", cmd: "cursor-agent",
    install: { url: "https://cursor.com/cli" } },
  { id: "openai-codex", tool: "OpenAI Codex", launch: "cli", cmd: "codex",
    install: { npm: "@openai/codex", url: "https://developers.openai.com/codex/cli" },
    credentialEnv: "OPENAI_API_KEY" },
  { id: "gemini-code-assist", tool: "Gemini Code Assist", launch: "cli", cmd: "gemini",
    install: { npm: "@google/gemini-cli", url: "https://github.com/google-gemini/gemini-cli" },
    credentialEnv: "GEMINI_API_KEY" },
  { id: "github-copilot", tool: "GitHub Copilot", launch: "cli", cmd: "copilot",
    install: { npm: "@github/copilot", url: "https://github.com/features/copilot/cli" } },
  { id: "windsurf", tool: "Windsurf", launch: "ide", cmd: "windsurf",
    install: { url: "https://windsurf.com/editor" } },
  { id: "cline", tool: "Cline / Roo Code", launch: "ide",
    install: { url: "https://cline.bot" } },
  { id: "continue", tool: "Continue.dev", launch: "ide",
    install: { url: "https://continue.dev" } },
  { id: "aider", tool: "Aider", launch: "cli", cmd: "aider",
    install: { url: "https://aider.chat" }, credentialEnv: "OPENAI_API_KEY" },
  // No command, by nature. Kept so the catalog and the manifest agree, and so
  // nobody adds it to the menu later by mistake.
  { id: "chatgpt-web", tool: "ChatGPT (web) / custom GPT", launch: "none",
    install: { url: "https://chat.openai.com" } },
];

/** The Cursor editor, which is a launch target rather than its own harness. */
export const CURSOR_GUI: AgentCandidate = { id: "cursor", tool: "Cursor (editor)", launch: "ide", cmd: "cursor" };

export interface AgentStatus {
  readonly candidate: AgentCandidate;
  readonly installed: boolean;
  /** Null when gov cannot tell — which is not the same as "no". */
  readonly credentialPresent: boolean | null;
}

/**
 * What is actually on this machine. `hasTool` and `env` are injected, so the whole
 * decision is decidable without a shell.
 */
export function agentStatuses(
  candidates: readonly AgentCandidate[],
  hasTool: (cmd: string) => boolean,
  env: Readonly<Record<string, string | undefined>>,
): readonly AgentStatus[] {
  return candidates.map((c) => ({
    candidate: c,
    installed: Boolean(c.cmd && hasTool(c.cmd)),
    credentialPresent: c.credentialEnv ? Boolean(env[c.credentialEnv]) : null,
  }));
}

/**
 * The approved set. An org that has not decided yet gets the framework's own list,
 * and is told so — an empty menu on day one would make the feature useless exactly
 * when it is needed most.
 */
export function approvedAgents(orgApproved: readonly string[] | null): {
  readonly ids: readonly string[]; readonly usingDefaults: boolean;
} {
  if (orgApproved && orgApproved.length) return { ids: orgApproved, usingDefaults: false };
  return { ids: AGENT_CATALOG.map((a) => a.id), usingDefaults: true };
}

/** Offerable = approved, launchable, and actually here. */
export function offerable(statuses: readonly AgentStatus[], approvedIds: readonly string[]): readonly AgentStatus[] {
  return statuses.filter((s) => s.installed && s.candidate.launch !== "none" && approvedIds.includes(s.candidate.id));
}

/** Approved, launchable, and missing — the ones worth offering to install. */
export function installable(statuses: readonly AgentStatus[], approvedIds: readonly string[]): readonly AgentStatus[] {
  return statuses.filter((s) => !s.installed && s.candidate.launch !== "none" && s.candidate.install && approvedIds.includes(s.candidate.id));
}

/** One line each, saying what it is rather than only what it is called. */
export function menuLines(offer: readonly AgentStatus[]): readonly string[] {
  const lines = offer.map((s, i) => {
    const kind = s.candidate.launch === "cli"
      ? "runs the agent here, with the rules loaded"
      : "opens your editor here; its own agent reads the rules from the repo";
    const cred = s.credentialPresent === false ? "  — no API key set, it may ask you to sign in" : "";
    return `     ${i + 1}) ${s.candidate.tool}  — ${kind}${cred}`;
  });
  return [
    ...lines,
    `     ${offer.length + 1}) shell  — your normal command line, in the project folder. No AI involved.`,
    "     0) later",
  ];
}

/** Shown when nothing is installed: what could be, and how. */
export function nothingInstalledLines(missing: readonly AgentStatus[], usingDefaults: boolean): readonly string[] {
  return [
    "  No AI agent is installed on this machine yet.",
    "",
    ...(usingDefaults
      ? ["  Your organization has not approved any agents yet, so these are the framework's",
         "  defaults. Narrow them in knowledge/policies/llm-governance.md when you decide.",
         ""]
      : []),
    "  Approved and available to install:",
    ...missing.map((s) => {
      const how = s.candidate.install?.npm ? `npm i -g ${s.candidate.install.npm}` : s.candidate.install?.url ?? "";
      return `    · ${s.candidate.tool.padEnd(28)} ${how}`;
    }),
    "",
    "  Install one in another terminal and re-run `gov`, or carry on with `shell` and",
    "  do the work yourself. gov shows the command; it does not run it for you yet,",
    "  and it never creates an account or holds a key — signing in stays yours.",
  ];
}

/**
 * The agent ids an org has approved, read from its own `llm-governance.md`.
 *
 * Deliberately forgiving: the file is prose with a table in it, maintained by a
 * human, and a parse failure must not empty the menu. Null means "could not tell",
 * which falls back to the framework's list and says so — never to nothing.
 */
export function approvedAgentIdsFrom(policyText: string | null): readonly string[] | null {
  if (!policyText) return null;
  const approvedSection = /###\s*Approved([\s\S]*?)(?=\n###\s|\n---\s*\n|$)/.exec(policyText)?.[1];
  if (!approvedSection) return null;
  const found = AGENT_CATALOG.filter((a) => {
    const tool = a.tool.split(" / ")[0]!.replace(/\s*\(.*\)$/, "");
    return new RegExp(`\\b${tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(approvedSection);
  }).map((a) => a.id);
  return found.length ? found : null;
}
