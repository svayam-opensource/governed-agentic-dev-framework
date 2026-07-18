/**
 * CLI ↔ content version compatibility. The installed `gov-work` CLI operates on a gov
 * workspace whose content is at some VERSION (the laid-down marker). Running an
 * OLDER CLI against NEWER content is unsafe — it may not understand the layout —
 * so a MAJOR-version gap hard-stops; smaller gaps warn (semver back-compat within
 * a major). Content behind the CLI just wants a `gov-work upgrade`.
 */
export type CompatStatus = "ok" | "no-marker" | "content-behind" | "cli-behind" | "cli-behind-major";
export interface CompatResult {
    readonly status: CompatStatus;
    /** false only for a hard-stop (cli-behind-major). */
    readonly ok: boolean;
    readonly message: string;
}
export declare function checkVersionCompat(cliVersion: string, contentVersion: string | null): CompatResult;
