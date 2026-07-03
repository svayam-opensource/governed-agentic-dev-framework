// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
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
export function parseGovWorkspaces(text: string): GovHome[] {
  const byOrg = new Map<string, string>();
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "").trim();
    if (line === "" || line.startsWith("#")) continue;
    // Split on the FIRST tab (a home path may contain spaces, never a tab).
    const tab = line.indexOf("\t");
    if (tab < 0) continue; // malformed line — skip, don't crash
    const org = line.slice(0, tab).trim();
    const home = line.slice(tab + 1).trim();
    if (org === "" || home === "") continue;
    byOrg.set(org, home); // last write wins
  }
  return [...byOrg].map(([org, home]) => ({ org, home }));
}

/** Serialize homes back to `gov-workspaces` text (stable, newline-terminated). */
export function formatGovWorkspaces(homes: readonly GovHome[]): string {
  return homes.map((h) => `${h.org}\t${h.home}`).join("\n") + (homes.length ? "\n" : "");
}

/**
 * Upsert `{org, home}` into a home list: replace the entry for `org` if present
 * (updating a moved home), else append. Returns a new array (pure).
 */
export function upsertHome(
  homes: readonly GovHome[],
  org: string,
  home: string,
): GovHome[] {
  const next = homes.filter((h) => h.org !== org);
  next.push({ org, home });
  return next;
}

/** Look up the home path registered for `org`, or null. */
export function homeForOrg(homes: readonly GovHome[], org: string): string | null {
  return homes.find((h) => h.org === org)?.home ?? null;
}
