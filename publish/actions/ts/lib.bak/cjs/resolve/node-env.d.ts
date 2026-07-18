import type { ResolveEnv } from "./types.js";
/** Expand a leading `~` / `~/…` against `$HOME` (matches the bash pointer read). */
export declare function expandTilde(p: string, home?: string): string;
/**
 * The OS-idiomatic per-user config dir holding the CLI-local registry
 * (`gov-workspaces` + `active-org`). Windows → `%APPDATA%\prj`; elsewhere →
 * `$XDG_CONFIG_HOME/prj` or `~/.config/prj`. The `prj` leaf is kept for
 * continuity with existing registries (shared multi-home store). Pure — env /
 * platform / home are injectable for tests.
 */
export declare function configDir(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, home?: string): string;
/** True if `p` sits inside a `.bases/` base clone (never a real gov home). */
export declare function containsBasesSegment(p: string): boolean;
/**
 * Extract a TOP-LEVEL scalar (`key: value`) from YAML text. Deliberately tiny —
 * only what the resolver needs (`github_org`, `gov_workspace`), mirroring what
 * the bash `yq` / `python3` one-liners return for a simple string field. Ignores
 * indented keys; tolerates single/double quotes and trailing `#` comments on
 * unquoted values.
 */
export declare function readTopLevelScalar(text: string, key: string): string | null;
/** Options for the Node adapter (all overridable for tests). */
export interface NodeEnvOptions {
    readonly cwd?: string;
    readonly configDir?: string;
    readonly home?: string;
}
/** Build a read-only, filesystem-backed `ResolveEnv`. */
export declare function createNodeEnv(opts?: NodeEnvOptions): ResolveEnv;
