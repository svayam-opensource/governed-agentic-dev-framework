// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE PRE-CLOSE GATE, REDUCED TO WHAT THE FRAMEWORK ACTUALLY OWNS (Policy Owner, 2026-09-27).
 *
 * WHAT THIS USED TO DO, AND WHY IT WAS WRONG. It required `knowledge/` to be non-empty, `compliance.md` to
 * exist, and `knowledge-close.md` to carry five exact headings — `## Graduated to org knowledge`,
 * `## Kept project-local`, `## Discarded`, `## Journeys created / updated`, `## Completeness critic` — with no
 * TBD anywhere. `gov seed` scaffolds exactly one of those files (`todo.md`), so nothing created them, nothing
 * templated them, and nothing mentioned them until close failed. The failure then said *"run the Knowledge
 * Harvest Protocol first"*, sending a human to a protocol written for agents.
 *
 * A walk found it end to end: a developer who seeds a project, hand-writes the changes in their IDE and uses
 * gov verbs — never `gov work` — gets through `task`, `merge` and `knowledge`, and hits a wall at `close`, at the
 * end of a project, which is the worst moment to discover a requirement. And because the adopter had written no
 * policy, nothing had told them either.
 *
 * TWO PRINCIPLES CAME OUT OF IT:
 *   · **A gate may only require an artifact the user has a path to produce.**
 *   · **Fixed behaviour must not silently depend on agentic behaviour having happened.** `gov close` assumed an
 *     agent had run a curation protocol. For an agent-run project that is invisible; for a human it is a dead end.
 *
 * SO: knowledge curation is the ORGANIZATION'S decision, expressed as a clause with a `when=verb:close` check
 * (see `../rules/verb-gate.ts`), and this gate keeps only what the framework itself needs to close a project
 * safely — facts about the repository, not judgements about content. An organization that wants the five
 * headings back writes them down and gets exactly them; one that does not, is not held to somebody else's
 * harvest protocol.
 */
import type { Fs } from "./fs-io.js";
import * as path from "node:path";

export interface GateResult {
  readonly ok: boolean;
  readonly failures: readonly string[];
}

/**
 * The framework's own pre-close conditions. Structural, and each one is something gov itself needs to be true
 * in order to do the next step of `close` — not an opinion about whether the project was documented well.
 *
 * `knowledge/` must EXIST, because close promotes that directory: proposing a directory that is not there is a
 * broken pull request rather than a governance failure. Whether it is *full* is the organization's business.
 */
export function closeGate(fs: Fs, projectDir: string): GateResult {
  const failures: string[] = [];
  const knowledgeDir = path.join(projectDir, "knowledge");

  if (!fs.pathExists(knowledgeDir)) {
    failures.push(
      `${path.join("projects", path.basename(projectDir), "knowledge")}/ does not exist — close promotes this `
      + "directory, so there must be one. `gov seed` creates it; if this project predates that, create it and "
      + "put the project's notes there.",
    );
  }

  return { ok: failures.length === 0, failures };
}
