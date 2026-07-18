import * as path from "node:path";
/** Required sections in knowledge-close.md (POL-413/414). */
export const KNOWLEDGE_CLOSE_SECTIONS = [
    "## Graduated to org knowledge",
    "## Kept project-local",
    "## Discarded",
    "## Journeys created / updated",
    "## Completeness critic",
];
const PLACEHOLDER = /\b(TBD|TODO|FIXME)\b/;
/**
 * Run the pre-close gate against a project's `knowledge/` dir. Fails (with a list
 * of reasons) unless: knowledge/ is non-empty, compliance.md exists, and
 * knowledge-close.md exists, has every required section, and has no TBD/TODO/FIXME.
 */
export function closeGate(fs, projectDir) {
    const failures = [];
    const knowledgeDir = path.join(projectDir, "knowledge");
    if (fs.readdir(knowledgeDir).length === 0) {
        failures.push("knowledge/ is empty — document project learnings first.");
    }
    if (!fs.pathExists(path.join(knowledgeDir, "compliance.md"))) {
        failures.push("knowledge/compliance.md is missing — required before close.");
    }
    const manifest = fs.readFile(path.join(knowledgeDir, "knowledge-close.md"));
    if (manifest === null) {
        failures.push("knowledge-close.md is missing — run the Knowledge Harvest Protocol first.");
    }
    else {
        for (const section of KNOWLEDGE_CLOSE_SECTIONS) {
            if (!manifest.includes(section))
                failures.push(`knowledge-close.md missing required section: '${section}'`);
        }
        if (PLACEHOLDER.test(manifest)) {
            failures.push("knowledge-close.md still contains a TBD/TODO/FIXME placeholder — harvest incomplete.");
        }
    }
    return { ok: failures.length === 0, failures };
}
