// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * STAMPING A CUE WITH ITS CLAUSE'S HASH — the step that made the staleness guard usable.
 *
 * §2.5 of the design says a stored cue carries `clause-sha=<hash>` so that editing the clause without
 * re-approving the cue is a policy ERROR rather than a silent divergence. Writing that hash by hand is not
 * something anyone will do reliably: it has to be computed from the clause, and every clause I authored carried
 * `clause-sha=TBD` until a throwaway script filled them in. A guard whose input is maintained by a script that
 * lives in nobody's repository is a guard that stops working the first week nobody runs it.
 *
 * So this is the fill path, in gov, called by `gov rules build`. It is PURE — text in, text out — because the
 * property that matters is that stamping twice changes nothing, and that is only cheap to assert on a pure
 * function.
 *
 * IT STAMPS, IT NEVER APPROVES. A cue's wording is drafted and approved by a person in a pull request (§2.3);
 * this only records WHICH CLAUSE the approved wording was approved against. Nothing here writes or edits cue
 * text, and a cue whose clause has genuinely changed still reports `stale-cue` — the hash is how that is
 * detected, so filling it in for an unreviewed edit would defeat the whole mechanism. See `stampMode`.
 */
import { parseClauses, type Clause } from "./notation.js";
import { parseCueBlocks, clauseSha, type CueBlock } from "./cue-block.js";

/**
 * When may a hash be written?
 *
 * - `fill-missing` (the default, and what `build` uses): stamp only a cue with NO hash, or the literal `TBD`
 *   placeholder an author leaves behind. A cue that already carries a hash is left exactly as it is, so a real
 *   rewording still surfaces as `stale-cue` and still needs a person.
 * - `restamp`: overwrite an existing hash too. This is the "yes, I re-read the cue and it still says the right
 *   thing" action, and it belongs behind an explicit flag a person types — never in an automatic build, or the
 *   guard would silently approve every edit it was built to catch.
 */
export type StampMode = "fill-missing" | "restamp";

export interface StampResult {
  readonly text: string;
  /** `POL-210 §4.2` for each cue stamped — enough for the build to report what it touched. */
  readonly stamped: readonly string[];
  /** Cues left alone because they already carry a hash, under `fill-missing`. */
  readonly kept: readonly string[];
}

/** The clause a cue block belongs to: the nearest one ABOVE it. Same ownership rule `staleCues` uses. */
export function ownerOf(clauses: readonly Clause[], block: CueBlock): Clause | undefined {
  return [...clauses].filter((c) => c.line < block.line).pop();
}

/**
 * Fill in the hashes a document's cue blocks are missing.
 *
 * Works on the line the `gov:cue` comment sits on, replacing only the `clause-sha=` attribute, so nothing else
 * about an author's comment — the approval note, their spacing — is disturbed. Rewriting the whole comment would
 * be tidier and would throw away `approved in PR #214`, which is the one part of it a person wrote.
 */
export function stampCues(doc: string, text: string, mode: StampMode = "fill-missing"): StampResult {
  const { clauses } = parseClauses(doc, text);
  const { blocks } = parseCueBlocks(doc, text);
  const lines = text.split("\n");
  const stamped: string[] = [];
  const kept: string[] = [];

  for (const block of blocks) {
    const owner = ownerOf(clauses, block);
    if (!owner) continue;                         // an orphan cue is `parseCueBlocks`'s diagnostic, not ours
    const already = block.clauseSha && block.clauseSha !== "TBD";
    const where = `${block.pol} §${block.section || "-"}`;
    if (already && mode === "fill-missing") { kept.push(where); continue; }

    const want = clauseSha(owner.text);
    if (block.clauseSha === want) { kept.push(where); continue; }

    const i = block.line - 1;
    const line = lines[i];
    if (line === undefined) continue;
    lines[i] = /clause-sha=\S+/.test(line)
      ? line.replace(/clause-sha=\S+/, `clause-sha=${want}`)
      // No attribute at all: insert one after `generated`, where every stamped block carries it, so the blocks
      // stay uniform and a reader can spot an unstamped one by shape.
      : line.replace(/gov:cue\s+generated/, `gov:cue generated clause-sha=${want}`);
    stamped.push(where);
  }
  return { text: lines.join("\n"), stamped, kept };
}
