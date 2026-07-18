// SPDX-License-Identifier: LicenseRef-Svayam-Proprietary
/**
 * NEED / GAP — the security preflight model (SDD credential-seam). Every command declares
 * the identity + authorizations its ask requires (its NEEDs); the CLI probes what's already
 * satisfied on this machine and the unmet subset is the GAP, which `gov-work creds` then fills.
 *
 * This module is PURE: a `Need` states what it is, how to satisfy it (human instructions),
 * and a `satisfied(probes)` predicate. Probes are INJECTED (git/gh/credential-store lookups),
 * so the whole thing is testable without touching the environment. The real probe adapter
 * lives with the command layer.
 */
/** The plain name shown to the end user — the explicit `label`, else the `title` with any
 *  parenthetical jargon (e.g. "(HMAC — …)") stripped. */
export function displayName(need) {
    return need.label ?? need.title.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
}
/** Turn a where/instructions blob into ordered, plain "how to get it" steps: one per line,
 *  expanding arrow-paths ("A → B → C") into separate steps and dropping list numbering and the
 *  paste boilerplate. Used when a NEED doesn't declare explicit `steps`. */
export function deriveSteps(need) {
    if (need.steps)
        return [...need.steps];
    const out = [];
    for (const raw of need.instructions.split(/\r?\n/)) {
        const line = raw.trim().replace(/^\d+[.)]\s*/, "").replace(/^[-•]\s*/, "");
        if (!line || /paste it below|paste the value|gov saves it|nothing else to set up/i.test(line))
            continue;
        if (/→|->/.test(line))
            out.push(...line.split(/\s*(?:→|->)\s*/).map((s) => s.trim()).filter(Boolean));
        else
            out.push(line);
    }
    return out;
}
// ── base NEEDs — required by essentially every command ───────────────────────
export const gitIdentityNeed = {
    id: "git-identity",
    label: "your git commit identity",
    title: "git commit identity (user.name + user.email)",
    instructions: "Open a terminal\n" +
        "Run: git config --global user.name \"Your Name\"\n" +
        "Run: git config --global user.email \"you@your-org\"",
    satisfied: (p) => !!p.gitConfig("user.name") && !!p.gitConfig("user.email"),
};
/** A NEED for an explicitly-named credential key (`gov-work creds <KEY>`) — a generic, shielded
 *  paste prompt. (gov-work is a credential MANAGER; it doesn't know what any given key is for.) */
export function credNeedForKey(key) {
    return {
        id: key,
        title: `credential ${key}`,
        credKey: key,
        instructions: `Provide the value for ${key} (get it from the relevant tool/provider).\n` +
            `  Paste it below — gov saves it for you.`,
        satisfied: (p) => p.hasCred(key),
    };
}
export const ghAuthNeed = {
    id: "gh-auth",
    label: "GitHub sign-in",
    title: "GitHub CLI authentication",
    instructions: "Open a terminal\n" +
        "Run: gh auth login\n" +
        "Follow the browser prompts to sign in to GitHub",
    satisfied: (p) => p.ghAuthOk(),
};
// ── registry publish token — contributed by the deploy path per resolved target ──
/**
 * A NEED for a publish credential to `registry`, stored under `credKey` (the standard key,
 * supplied by the plugin). Instructions SHIELD the developer — where to go, what to do, and
 * paste; no auth-method jargon, no key names. `gov-work creds` saves the answer for them.
 */
export function registryTokenNeed(registry, credKey) {
    const where = registry === "https://registry.npmjs.org"
        ? "Open npmjs.com and sign in → Account → Access Tokens → Generate a new Automation token"
        : `Open your registry's token page for ${registry} (ask your admin if you're unsure where) → create a publish/automation token`;
    return {
        id: credKey,
        label: `a publish token for ${registry}`,
        title: `a publish credential for ${registry}`,
        credKey,
        instructions: `${where}\n` +
            `Copy the token → paste it here`,
        satisfied: (p) => p.hasCred(credKey),
    };
}
/** Assemble a command's NEEDs: the base set plus any command/plugin-specific extras. */
export function assembleNeeds(extra = []) {
    return [gitIdentityNeed, ghAuthNeed, ...extra];
}
/** The GAP = the NEEDs not yet satisfied on this machine, in declared order. */
export function computeGap(need, probes) {
    return need.filter((n) => !n.satisfied(probes));
}
