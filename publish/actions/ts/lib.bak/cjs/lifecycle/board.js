/** Raised when the board can't be fetched or parsed. */
export class BoardFetchError extends Error {
    constructor(message) {
        super(message);
        this.name = "BoardFetchError";
    }
}
/**
 * C01 gates (SDD seed): a non-empty title and ≥1 linked Issue/PR are **fatal**
 * requirements; a missing description is a warning. Pure — the orchestrator
 * decides how to act on the result.
 */
export function validateBoard(p) {
    if (p.title.trim() === "")
        return { ok: false, code: 1, reason: "no-title" };
    if (p.linkedItemCount <= 0)
        return { ok: false, code: 1, reason: "no-linked-items" };
    const warnings = [];
    if (!p.shortDescription || p.shortDescription.trim() === "") {
        warnings.push("Project has no description.");
    }
    return { ok: true, warnings };
}
/** A human message for a failed gate (matches the bash hard_stop wording). */
export function boardValidationMessage(v) {
    return v.reason === "no-title"
        ? "GitHub Project has no name."
        : "GitHub Project has no linked Issues or PRs.";
}
