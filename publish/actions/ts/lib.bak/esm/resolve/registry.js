/** Parse `gov-workspaces` text into homes. Tolerant of blanks, comments, CRLF. */
export function parseGovWorkspaces(text) {
    const byOrg = new Map();
    for (const rawLine of text.split("\n")) {
        const line = rawLine.replace(/\r$/, "").trim();
        if (line === "" || line.startsWith("#"))
            continue;
        // Split on the FIRST tab (a home path may contain spaces, never a tab).
        const tab = line.indexOf("\t");
        if (tab < 0)
            continue; // malformed line — skip, don't crash
        const org = line.slice(0, tab).trim();
        const home = line.slice(tab + 1).trim();
        if (org === "" || home === "")
            continue;
        byOrg.set(org, home); // last write wins
    }
    return [...byOrg].map(([org, home]) => ({ org, home }));
}
/** Serialize homes back to `gov-workspaces` text (stable, newline-terminated). */
export function formatGovWorkspaces(homes) {
    return homes.map((h) => `${h.org}\t${h.home}`).join("\n") + (homes.length ? "\n" : "");
}
/**
 * Upsert `{org, home}` into a home list: replace the entry for `org` if present
 * (updating a moved home), else append. Returns a new array (pure).
 */
export function upsertHome(homes, org, home) {
    const next = homes.filter((h) => h.org !== org);
    next.push({ org, home });
    return next;
}
/** Look up the home path registered for `org`, or null. */
export function homeForOrg(homes, org) {
    return homes.find((h) => h.org === org)?.home ?? null;
}
/** Remove the entry for `org` (pure; returns a new array). */
export function removeOrg(homes, org) {
    return homes.filter((h) => h.org !== org);
}
