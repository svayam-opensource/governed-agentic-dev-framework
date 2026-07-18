import { type MenuContext } from "./menu.js";
/**
 * `gov-work setup` — the interactive workspace BOOTSTRAP (port of setup.sh). Async
 * (readline prompts), so bin.ts routes it here instead of through sync `main`.
 * Runs in cwd (the cloned framework repo), before any resolution.
 */
export declare function runSetupCommand(argv: readonly string[], now?: string): Promise<number>;
/** Read the CLI's own version from its package.json. Walks up from this module
 *  so it resolves in both the built layout (lib/esm/cli) and src-via-tsx. */
export declare function readCliVersion(): string;
/** Gather the best-effort banner context for the interactive menu (all optional). */
export declare function gatherMenuContext(): Promise<MenuContext>;
/**
 * `gov-work creds` — the interactive GAP-filler (SDD credential-seam, client half). Resolves
 * the org work root, computes the base NEED/GAP for the chosen identity, and walks the
 * user through placing anything missing. Async (readline prompts); routed from bin.ts.
 */
export declare function runCredsCommand(argv: readonly string[]): Promise<number>;
/** Route any command (setup / creds / normal) — used by the menu. */
export declare function runAny(argv: readonly string[]): Promise<number> | number;
/** The command reference shown under the Help menu (grouped) / per-command. */
export declare function helpLines(command?: string): string[];
/** Build + run the interactive main menu (no-args TTY). Async — routed from bin.ts. */
export declare function runMainMenu(): Promise<number>;
/**
 * The `gov-work` entry point. Returns a process exit code. `now` is injected (an
 * ISO-8601 instant) so the composition stays deterministic + testable.
 */
export declare function main(argv: readonly string[], now?: string): number;
