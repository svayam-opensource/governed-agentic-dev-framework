import type { Fs } from "../lifecycle/fs-io.js";
import type { FsProbe } from "../lifecycle/vcs.js";
/** Tools blocked until the session is acknowledged. */
export declare const MUTATING_TOOLS: Set<string>;
/** True if a Bash command is the whitelisted ack (never blocked). */
export declare function isAckCommand(command: string): boolean;
/** True if a Bash command is a read-only identity probe the protocol needs pre-ack. */
export declare function isIdentityProbe(command: string): boolean;
export type GateDecision = {
    readonly decision: "allow";
} | {
    readonly decision: "deny";
    readonly reason: string;
};
/**
 * Decide whether a tool call is allowed pre-ack. Non-mutating tools always pass;
 * the ack command + identity probes pass; otherwise a mutating tool needs the
 * ack marker.
 */
export declare function evaluateGate(input: {
    toolName: string;
    command?: string;
}, ackMarkerExists: boolean): GateDecision;
/** The PreToolUse hook JSON for a decision (null = allow / no output). */
export declare function preToolGateOutput(decision: GateDecision): string | null;
/** The SessionStart hook JSON (the reminder additionalContext). */
export declare function sessionStartOutput(): string;
/**
 * Run the PreToolUse gate over the raw hook stdin + whether the marker exists.
 * Returns the hook JSON to print (null = allow). FAIL-OPEN on a parse error.
 */
export declare function runPreToolGate(stdinJson: string, ackMarkerExists: boolean): string | null;
/** The per-session ack marker path under a project root. */
export declare function markerPath(root: string): string;
/** Write the ack marker (the LAST step of /session-start) — unlocks mutating tools. */
export declare function writeAck(fs: Fs, root: string, timestamp: string): void;
/** Clear the ack marker (on SessionStart) so /session-start must run again. */
export declare function clearAck(fs: Fs, root: string): void;
/** Whether the session has been acknowledged. */
export declare function ackExists(fs: FsProbe, root: string): boolean;
