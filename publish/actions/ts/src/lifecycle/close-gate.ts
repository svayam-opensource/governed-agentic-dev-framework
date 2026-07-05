// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The C01 pre-close knowledge gate (SDD Part B, close-project; POL-087…096).
 * Model A (SDD-012): the gate checks only **authored content** — there is no
 * project.yaml field check any more (status is GitHub-derived). Presence +
 * structure only; quality is the Harvest Protocol + Owner PR review.
 */
import type { Fs } from "./fs-io.js";
import * as path from "node:path";

/** Required sections in knowledge-close.md (POL-413/414). */
export const KNOWLEDGE_CLOSE_SECTIONS = [
  "## Graduated to org knowledge",
  "## Kept project-local",
  "## Discarded",
  "## Journeys created / updated",
  "## Completeness critic",
] as const;

const PLACEHOLDER = /\b(TBD|TODO|FIXME)\b/;

export interface GateResult {
  readonly ok: boolean;
  readonly failures: readonly string[];
}

/**
 * Run the pre-close gate against a project's `knowledge/` dir. Fails (with a list
 * of reasons) unless: knowledge/ is non-empty, compliance.md exists, and
 * knowledge-close.md exists, has every required section, and has no TBD/TODO/FIXME.
 */
export function closeGate(fs: Fs, projectDir: string): GateResult {
  const failures: string[] = [];
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
  } else {
    for (const section of KNOWLEDGE_CLOSE_SECTIONS) {
      if (!manifest.includes(section)) failures.push(`knowledge-close.md missing required section: '${section}'`);
    }
    if (PLACEHOLDER.test(manifest)) {
      failures.push("knowledge-close.md still contains a TBD/TODO/FIXME placeholder — harvest incomplete.");
    }
  }

  return { ok: failures.length === 0, failures };
}
