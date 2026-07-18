import { type ParsedArgs } from "./args.js";
import type { OrgConfig } from "../config/org-config.js";
import type { Board } from "../lifecycle/board.js";
import type { Vcs } from "../lifecycle/vcs.js";
import type { Fs } from "../lifecycle/fs-io.js";
import type { Issues } from "../lifecycle/issues.js";
import type { AnchorCreator } from "../lifecycle/anchor.js";
import type { Pulls } from "../lifecycle/pulls.js";
import type { BoardRef } from "../lifecycle/identity.js";
import type { GateResult } from "../lifecycle/close-gate.js";
import { type OrgDeps } from "../resolve/org.js";
import type { Projects } from "../lifecycle/project-list.js";
/** Tool files seed token-substitutes into the project (bash TOOL_FILES). */
export declare const TOOL_FILES: readonly ["AGENTS.md", "CONVENTIONS.md", ".cursor/rules/agent.mdc", ".clinerules/agent.md", ".windsurf/rules/agent.md", ".github/copilot-instructions.md", ".gemini/styleguide.md", ".continue/rules.md", "CLAUDE.md"];
/** Everything the router needs: config, the resolved workspace, identity + ports. */
export interface CliContext {
    readonly config: OrgConfig;
    /** The resolved gov workspace — the gov HOME for seed, else the project clone. */
    readonly home: string;
    readonly today: string;
    /** The current user's git email — recorded as seeded_by. */
    readonly seededBy: string;
    /** The current user's gh login — the default issue assignee / anchor assignee. */
    readonly login?: string;
    readonly identity?: {
        name?: string;
        email?: string;
    };
    readonly board: Board;
    readonly vcs: Vcs;
    readonly fs: Fs;
    readonly issues: Issues;
    readonly anchor: AnchorCreator;
    readonly pulls: Pulls;
    readonly projects: Projects;
    readonly cloneRepo: (url: string, dest: string) => void;
    readonly authorize?: (ref: BoardRef) => boolean;
    /** close's test-merge gate (wire governance.runSuite here). */
    readonly gate?: () => GateResult;
    readonly log?: (msg: string) => void;
}
export interface CommandResult {
    readonly code: number;
    readonly lines: readonly string[];
}
/**
 * Route `prj org …` — the multi-home registry commands. Handled SEPARATELY from
 * {@link route} because they run WITHOUT a resolved workspace (`gov-work org add` is
 * the bootstrap that makes resolution work).
 */
export declare function routeOrg(positionals: readonly string[], deps: OrgDeps): CommandResult;
/** Route a parsed command to its orchestrator; returns an exit code + output. */
export declare function route(parsed: ParsedArgs, ctx: CliContext): CommandResult;
