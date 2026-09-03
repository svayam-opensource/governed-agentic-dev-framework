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

/**
 * One way to run an approved agent (#196, Q8). The policy approves the AGENT — its
 * real question is which provider may see your code, and that does not change
 * between a CLI and an extension of the same tool — so a single approval brings all
 * of its variants.
 */
export interface AgentVariant {
  readonly kind: "cli" | "editor" | "extension";
  readonly label: string;
  /** The command to probe and to launch. Extensions have none of their own. */
  readonly cmd?: string;
  /** npm package, or a shell line for a vendor installer. */
  readonly install?: { readonly npm?: string; readonly script?: string; readonly url: string };
  /** For extensions: the marketplace id, installed through the host's own CLI. */
  readonly extensionId?: string;
  /** The hosts that can carry this extension, in preference order. */
  readonly hosts?: readonly string[];
  /** The agent's own login command, when it has one — tier 1 of the sign-in design. */
  readonly login?: readonly string[];
}

export interface AgentCandidate {
  /** Matches the harness manifest's `id`, which is what makes this list checkable. */
  readonly id: string;
  readonly tool: string;
  readonly launch: LaunchKind;
  /** The executable to probe and to run. Absent when gov cannot launch it. */
  readonly cmd?: string;
  /**
   * How to install it. `npm` is a named package from a named publisher; `script` is
   * a vendor's own installer, piped into a shell. gov runs either — but only for an
   * agent the org has approved, because approval IS the trust decision (#196, Q2).
   */
  readonly install?: { readonly npm?: string; readonly brew?: string; readonly script?: string; readonly url: string };
  /** The environment variable that would hold a key, so gov can report its absence. */
  readonly credentialEnv?: string;
  /** Where a tier-2 key belongs — the agent's own config, never gov's. */
  readonly credentialFile?: string;
  /** Where to go to create an account, when there is no automating it. */
  readonly signupUrl?: string;
  /** Every way to run it. The policy approves the agent; this is what that buys. */
  readonly variants?: readonly AgentVariant[];
}

/**
 * Every harness the framework renders. `launch: "none"` entries are governed but
 * not startable from here — a browser tool has no command to run.
 */
export const AGENT_CATALOG: readonly AgentCandidate[] = [
  { id: "claude-code", tool: "Claude Code", launch: "cli", cmd: "claude",
    install: { npm: "@anthropic-ai/claude-code", url: "https://claude.com/claude-code" },
    credentialEnv: "ANTHROPIC_API_KEY", signupUrl: "https://claude.com/claude-code",
    variants: [
      { kind: "cli", label: "in the terminal", cmd: "claude",
        install: { npm: "@anthropic-ai/claude-code", url: "https://claude.com/claude-code" },
        login: ["claude", "/login"] },
      { kind: "extension", label: "in VS Code", extensionId: "anthropic.claude-code", hosts: ["code", "cursor", "windsurf"] },
    ] },
  { id: "cursor", tool: "Cursor", launch: "cli", cmd: "cursor-agent",
    install: { script: "curl https://cursor.com/install -fsS | bash", url: "https://cursor.com/cli" },
    signupUrl: "https://cursor.com",
    variants: [
      { kind: "cli", label: "in the terminal", cmd: "cursor-agent",
        install: { script: "curl https://cursor.com/install -fsS | bash", url: "https://cursor.com/cli" },
        login: ["cursor-agent", "login"] },
      // The editor IS the agent here — there is no Cursor extension for someone
      // else's host — so choosing it means installing an editor. That is the one
      // case where gov may (#196, Q7).
      { kind: "editor", label: "the Cursor editor", cmd: "cursor", install: { url: "https://cursor.com/downloads" } },
    ] },
  { id: "openai-codex", tool: "OpenAI Codex", launch: "cli", cmd: "codex",
    install: { npm: "@openai/codex", url: "https://developers.openai.com/codex/cli" },
    credentialEnv: "OPENAI_API_KEY", signupUrl: "https://platform.openai.com/signup",
    variants: [
      { kind: "cli", label: "in the terminal", cmd: "codex",
        install: { npm: "@openai/codex", url: "https://developers.openai.com/codex/cli" },
        login: ["codex", "login"] },
      { kind: "extension", label: "in VS Code", extensionId: "openai.chatgpt", hosts: ["code", "cursor", "windsurf"] },
    ] },
  { id: "gemini-code-assist", tool: "Gemini Code Assist", launch: "cli", cmd: "gemini",
    install: { npm: "@google/gemini-cli", url: "https://github.com/google-gemini/gemini-cli" },
    credentialEnv: "GEMINI_API_KEY", signupUrl: "https://aistudio.google.com/apikey",
    variants: [
      { kind: "cli", label: "in the terminal", cmd: "gemini",
        install: { npm: "@google/gemini-cli", url: "https://github.com/google-gemini/gemini-cli" } },
      { kind: "extension", label: "in VS Code", extensionId: "Google.geminicodeassist", hosts: ["code", "cursor", "windsurf"] },
    ] },
  { id: "github-copilot", tool: "GitHub Copilot", launch: "cli", cmd: "copilot",
    install: { npm: "@github/copilot", url: "https://github.com/features/copilot/cli" },
    signupUrl: "https://github.com/features/copilot",
    variants: [
      { kind: "cli", label: "in the terminal", cmd: "copilot",
        install: { npm: "@github/copilot", url: "https://github.com/features/copilot/cli" } },
      { kind: "extension", label: "in VS Code", extensionId: "GitHub.copilot", hosts: ["code", "cursor", "windsurf"] },
    ] },
  // A standalone editor, like Cursor: the editor IS the agent, so there is no
  // extension for someone else's host.
  { id: "windsurf", tool: "Windsurf", launch: "ide", cmd: "windsurf",
    install: { url: "https://windsurf.com/editor" },
    variants: [{ kind: "editor", label: "the Windsurf editor", cmd: "windsurf", install: { url: "https://windsurf.com/editor" } }] },
  // Extension-only: there is no Cline CLI, so an adopter with no editor cannot run
  // it — which the menu says rather than silently offering nothing.
  { id: "cline", tool: "Cline / Roo Code", launch: "ide",
    install: { url: "https://cline.bot" },
    variants: [{ kind: "extension", label: "in VS Code", extensionId: "saoudrizwan.claude-dev", hosts: ["code", "cursor", "windsurf"] }] },
  { id: "continue", tool: "Continue.dev", launch: "ide",
    install: { url: "https://continue.dev" },
    variants: [{ kind: "extension", label: "in VS Code", extensionId: "Continue.continue", hosts: ["code", "cursor", "windsurf"] }] },
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

/** Which variants of an agent can run on this machine right now (#196, Q7). */
export interface VariantStatus {
  readonly agent: AgentCandidate;
  readonly variant: AgentVariant;
  readonly installed: boolean;
  /** For an extension: the host it would attach to, or null when none is present. */
  readonly host: string | null;
}

/**
 * Enumerate an approved agent's variants against this machine.
 *
 * An extension with no host is NOT offered, and gov does not install the host to
 * create one: putting a desktop IDE on someone's machine is a provisioning decision,
 * not an agent one — irreversible by `npm rm -g`, meaningless headless, and usually
 * IT's call. Nobody is stranded by that, because an approved agent almost always has
 * a CLI variant too (#196, Q7).
 */
export function variantStatuses(
  agent: AgentCandidate,
  hasTool: (cmd: string) => boolean,
): readonly VariantStatus[] {
  // A catalog entry without an explicit variant list has exactly one: itself. The
  // label says HOW it runs, not what it is called — the name is already on the row.
  const variants = agent.variants ?? (agent.cmd
    ? [{
        kind: agent.launch === "ide" ? "editor" as const : "cli" as const,
        label: agent.launch === "ide" ? "the editor" : "in the terminal",
        cmd: agent.cmd, install: agent.install,
      }]
    : []);
  return variants.map((v) => {
    if (v.kind === "extension") {
      const host = (v.hosts ?? []).find((h) => hasTool(h)) ?? null;
      return { agent, variant: v, installed: false, host };
    }
    return { agent, variant: v, installed: Boolean(v.cmd && hasTool(v.cmd)), host: null };
  });
}

/** Runnable now: a CLI or editor that is installed, or an extension with a host. */
export function runnableVariants(all: readonly VariantStatus[]): readonly VariantStatus[] {
  return all.filter((v) => (v.variant.kind === "extension" ? v.host !== null : v.installed));
}
