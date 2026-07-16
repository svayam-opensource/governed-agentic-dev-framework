// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The session-start client gate (SDD-030, #54 Layer 2) — port of the bash
 * pre-tool-gate / session-ack / session-start hooks. It denies MUTATING tools
 * until the session-start protocol posts the manifest and acknowledges (writing
 * a per-session marker). Read/Grep/Glob stay ungated so the protocol's own reads
 * work; the ack command + read-only identity probes are whitelisted pre-ack.
 *
 * FAIL-OPEN: a client nudge must never brick the workspace — the tool-agnostic
 * server gate (Layer 3) is the real enforcement. Logic is pure; a thin bin shim
 * (wired at cutover) reads stdin + the marker and prints the hook JSON.
 */
import * as path from "node:path";
import type { Fs } from "../lifecycle/fs-io.js";
import type { FsProbe } from "../lifecycle/vcs.js";

/** Tools blocked until the session is acknowledged. */
export const MUTATING_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit", "Bash"]);

const DENY_REASON =
  "Complete /session-start first: run the session-start protocol and post the context manifest " +
  "(agent/session-protocol.md §0) before changing code. Mutating tools unlock once /session-start " +
  "acknowledges this session.";

const SESSION_START_MSG =
  "Session-start protocol is in effect (agent/session-protocol.md §0). Run /session-start now: post " +
  "the context manifest BEFORE changing code. Edit/Write/Bash stay blocked until /session-start " +
  "acknowledges this session.";

/** True if a Bash command is the whitelisted ack (never blocked). */
export function isAckCommand(command: string): boolean {
  return command.includes("session-ack");
}

/** True if a Bash command is a read-only identity probe the protocol needs pre-ack. */
export function isIdentityProbe(command: string): boolean {
  const c = command.trim();
  return /^gh api user(\s+--jq\s+\S+)?$/.test(c) || /^gh auth status(\s+--\S+)*$/.test(c);
}

export type GateDecision = { readonly decision: "allow" } | { readonly decision: "deny"; readonly reason: string };

/**
 * Decide whether a tool call is allowed pre-ack. Non-mutating tools always pass;
 * the ack command + identity probes pass; otherwise a mutating tool needs the
 * ack marker.
 */
export function evaluateGate(input: { toolName: string; command?: string }, ackMarkerExists: boolean): GateDecision {
  if (!MUTATING_TOOLS.has(input.toolName)) return { decision: "allow" };
  const cmd = (input.command ?? "").trim();
  if (input.toolName === "Bash" && (isAckCommand(cmd) || isIdentityProbe(cmd))) return { decision: "allow" };
  if (ackMarkerExists) return { decision: "allow" };
  return { decision: "deny", reason: DENY_REASON };
}

/** The PreToolUse hook JSON for a decision (null = allow / no output). */
export function preToolGateOutput(decision: GateDecision): string | null {
  if (decision.decision === "allow") return null;
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: decision.reason },
  });
}

/** The SessionStart hook JSON (the reminder additionalContext). */
export function sessionStartOutput(): string {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: SESSION_START_MSG } });
}

/**
 * Run the PreToolUse gate over the raw hook stdin + whether the marker exists.
 * Returns the hook JSON to print (null = allow). FAIL-OPEN on a parse error.
 */
export function runPreToolGate(stdinJson: string, ackMarkerExists: boolean): string | null {
  let toolName: string;
  let command: string;
  try {
    const d = JSON.parse(stdinJson) as { tool_name?: string; tool_input?: { command?: string } };
    toolName = d.tool_name ?? "";
    command = String(d.tool_input?.command ?? "");
  } catch {
    return null; // fail-open
  }
  return preToolGateOutput(evaluateGate({ toolName, command }, ackMarkerExists));
}

/** The per-session ack marker path under a project root. */
export function markerPath(root: string): string {
  return path.join(root, ".claude", ".session-ack");
}

/** Write the ack marker (the LAST step of /session-start) — unlocks mutating tools. */
export function writeAck(fs: Fs, root: string, timestamp: string): void {
  fs.writeFile(markerPath(root), `${timestamp}\n`);
}

/** Clear the ack marker (on SessionStart) so /session-start must run again. */
export function clearAck(fs: Fs, root: string): void {
  fs.rm(markerPath(root));
}

/** Whether the session has been acknowledged. */
export function ackExists(fs: FsProbe, root: string): boolean {
  return fs.pathExists(markerPath(root));
}
