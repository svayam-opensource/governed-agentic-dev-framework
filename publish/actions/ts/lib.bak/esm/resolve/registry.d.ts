/**
 * The CLI-local multi-home registry model (SDD-041 / SDD-042). This is the
 * `gov-workspaces` file — a per-developer map of `github_org → gov home` used
 * for resolution. It is DISTINCT from the gov repo's `registry.yaml` (the
 * vestigial project-numbering archive); do not conflate them (SDD-042).
 *
 * File format: one `<github_org>\t<home_path>` per line. Blank lines and
 * `#`-comments are ignored. Later entries win on duplicate org (upsert order).
 */
import type { GovHome } from "./types.js";
/** Parse `gov-workspaces` text into homes. Tolerant of blanks, comments, CRLF. */
export declare function parseGovWorkspaces(text: string): GovHome[];
/** Serialize homes back to `gov-workspaces` text (stable, newline-terminated). */
export declare function formatGovWorkspaces(homes: readonly GovHome[]): string;
/**
 * Upsert `{org, home}` into a home list: replace the entry for `org` if present
 * (updating a moved home), else append. Returns a new array (pure).
 */
export declare function upsertHome(homes: readonly GovHome[], org: string, home: string): GovHome[];
/** Look up the home path registered for `org`, or null. */
export declare function homeForOrg(homes: readonly GovHome[], org: string): string | null;
/** Remove the entry for `org` (pure; returns a new array). */
export declare function removeOrg(homes: readonly GovHome[], org: string): GovHome[];
