import { checkVersionSync } from "../governance/version-sync.js";
export function publishGate(fs, repoRoot) {
    const vs = checkVersionSync({ fs, repoRoot });
    const blockers = vs.ok ? [] : vs.errors.map((e) => `version-sync: ${e}`);
    return { ok: blockers.length === 0, blockers };
}
export function formatPublishGate(g) {
    return g.ok
        ? ["publish gate: PASS — ready to publish via the governed Jenkins pipeline (never `npm publish` by hand)."]
        : ["publish gate: BLOCKED —", ...g.blockers.map((b) => `  - ${b}`)];
}
