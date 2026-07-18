import { resolveFailureMessage } from "../resolve/resolve-gov.js";
import { checkVersionCompat } from "./version-compat.js";
export function doctor(facts) {
    const d = [
        { name: "git", status: facts.gitPresent ? "ok" : "fail", detail: facts.gitPresent ? "found" : "not found — install git" },
        { name: "gh", status: facts.ghPresent ? "ok" : "fail", detail: facts.ghPresent ? "found" : "not found — install the GitHub CLI (gh)" },
        facts.resolve.ok
            ? { name: "gov workspace", status: "ok", detail: `resolved → ${facts.resolve.home} (${facts.resolve.org})` }
            : { name: "gov workspace", status: "fail", detail: resolveFailureMessage(facts.resolve) },
        facts.activeOrg
            ? { name: "active org", status: "ok", detail: facts.activeOrg }
            : { name: "active org", status: "warn", detail: "not set — run `gov-work org use <org>`" },
        { name: "CLI version", status: "ok", detail: facts.cliVersion },
        (() => {
            const c = checkVersionCompat(facts.cliVersion, facts.contentVersion ?? null);
            return { name: "version compat", status: c.ok ? (c.status === "ok" || c.status === "no-marker" ? "ok" : "warn") : "fail", detail: c.message };
        })(),
        (facts.staleArtifacts && facts.staleArtifacts.length)
            ? { name: "content layout", status: "warn", detail: `old-world artifacts (${facts.staleArtifacts.join(", ")}) — run \`gov-work upgrade --from <content>\`` }
            : { name: "content layout", status: "ok", detail: "current" },
    ];
    return { ok: !d.some((x) => x.status === "fail"), diagnostics: d };
}
const MARK = { ok: "✓", warn: "!", fail: "✗" };
/** Render a report as printable lines. */
export function formatDoctorReport(report) {
    return [
        ...report.diagnostics.map((x) => `  ${MARK[x.status]} ${x.name}: ${x.detail}`),
        report.ok ? "doctor: ok" : "doctor: FAILED — fix the ✗ items above",
    ];
}
