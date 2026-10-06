// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE SECOND PLACE A CHECK CAN FIRE: a verb, not a diff (PRJ-121, 2026-09-28).
 *
 * Until now every check was defined over a changeset — "no added dependency may be unapproved" — which is right
 * for rules about editing files and useless for rules about *doing* something. "A project may not be closed
 * until its learnings are written up" has no diff to inspect; the moment it applies is the moment a person types
 * `gov close`.
 *
 * Because that was inexpressible, the requirement lived HARDCODED inside `close-gate.ts`: gov insisted on a
 * `knowledge-close.md` with five exact headings — *"## Completeness critic"* among them — whether the
 * organization wanted that or not, and told a human who hit it to *"run the Knowledge Harvest Protocol"*, a
 * thing that exists only for agents. The Policy Owner's ruling (2026-09-27) is that knowledge curation is the
 * organization's decision, not the framework's. This module is where it moves TO: without it, removing the
 * hardcoding would delete the capability rather than relocate it.
 *
 * PURE over an injected {@link WorkspaceView}. A gate that needed a real directory tree to test would be tested
 * once, by hand, at the point where it is most expensive to get wrong.
 */
import { filterByGlobs, matchesAny } from "./glob.js";
import type { Check } from "./checks/predicates.js";

/**
 * What a gate may look at. Deliberately narrow: existence, contents, and the two identifiers.
 *
 * It is NOT the `Fs` port. `Fs` can write, and a gate that can write is a gate that can satisfy its own
 * condition — the failure mode where a check "passes" because running it created the file it was looking for.
 */
export interface WorkspaceView {
  /** Does this workspace-relative path exist? */
  exists(rel: string): boolean;
  /** The file's text, or null. */
  read(rel: string): string | null;
  /** Every existing path under the workspace, relative, forward slashes. Used for glob predicates. */
  paths(): readonly string[];
  /** The current branch, when a gate needs to judge its name. */
  readonly branch?: string;
  /** The active project id, same. */
  readonly projectId?: string;
}

/** One reason a verb was refused, or one warning it carried. */
export interface GateFinding {
  readonly pol: string;
  readonly doc: string;
  readonly section: string;
  readonly severity: "fail" | "warn";
  /**
   * What is wrong and what to do, naming the FILE — never a protocol.
   *
   * The message this replaces read *"knowledge-close.md is missing — run the Knowledge Harvest Protocol first"*,
   * which sent a human to look for a document written for agents. A gate that a person can hit must say what to
   * create, where, and which clause asked for it.
   */
  readonly message: string;
}

export interface GateResult {
  readonly ok: boolean;
  readonly failures: readonly GateFinding[];
  readonly warnings: readonly GateFinding[];
}

/** A check with the clause it came from — enough to name the rule in the refusal. */
export interface AttachedCheck {
  readonly pol: string;
  readonly doc: string;
  readonly section: string;
  readonly check: Check;
}

const attr = (c: Check, key: string): string => c.attrs[key] ?? "";
const list = (c: Check, key: string): string[] => attr(c, key).split(",").map((s) => s.trim()).filter(Boolean);

/**
 * Evaluate every check attached to `verb`.
 *
 * WHAT EACH PREDICATE MEANS HERE had to be decided rather than assumed, because a predicate written for a diff
 * has no obvious reading without one. The table:
 *
 *   file-required        every glob in `require=` matches at least one existing path
 *   content-required     `file=` exists, contains `pattern=`, and contains every heading in `sections=`
 *   frontmatter-required every file matching `paths=` carries every key in `keys=`
 *   naming               `subject=` (branch | project_id) matches `pattern=`
 *   path-scope           every existing path is inside `writable=` — the workspace as it stands
 *   list-membership      REFUSED at parse time: "every ADDED entry" has no meaning without a changeset
 *   content-forbidden    REFUSED at parse time: "the CHANGED content" likewise
 *
 * The last two have no meaning without a changeset, so a binding should never carry them here. If one does — an
 * older CLI — it becomes a WARNING that says so, because a check that silently does nothing is the defect this
 * whole design keeps tripping over.
 */
export function gateVerb(checks: readonly AttachedCheck[], ws: WorkspaceView): GateResult {
  const failures: GateFinding[] = [];
  const warnings: GateFinding[] = [];

  for (const { pol, doc, section, check } of checks) {
    const where = `${pol} (${doc} §${section})`;
    const push = (message: string): void => {
      const finding: GateFinding = { pol, doc, section, severity: check.onMiss, message };
      (check.onMiss === "fail" ? failures : warnings).push(finding);
    };

    switch (check.kind) {
      case "file-required": {
        const globs = list(check, "require");
        if (!globs.length) { warnings.push({ pol, doc, section, severity: "warn", message: `${where}: file-required has no require= — it asks for nothing.` }); break; }
        for (const g of globs) {
          if (!filterByGlobs(ws.paths(), [g]).length) push(`${where}: nothing matches \`${g}\` — create it, then run this again.`);
        }
        break;
      }
      case "content-required": {
        const file = attr(check, "file");
        if (!file) { warnings.push({ pol, doc, section, severity: "warn", message: `${where}: content-required has no file=.` }); break; }
        const text = ws.read(file);
        if (text === null) { push(`${where}: \`${file}\` does not exist — create it.`); break; }
        const pattern = attr(check, "pattern");
        if (pattern && !new RegExp(pattern, "m").test(text)) push(`${where}: \`${file}\` does not contain ${pattern}.`);
        // Sections are named one by one so the author of the missing section knows which one, not merely that
        // something is absent — the complaint the five hardcoded headings never answered.
        for (const s of list(check, "sections")) {
          if (!text.includes(s)) push(`${where}: \`${file}\` has no section \`${s}\`.`);
        }
        break;
      }
      case "frontmatter-required": {
        const paths = list(check, "paths");
        const keys = list(check, "keys");
        for (const p of filterByGlobs(ws.paths(), paths)) {
          const text = ws.read(p) ?? "";
          const fm = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
          const missing = keys.filter((k) => !new RegExp(`^${k}:`, "m").test(fm));
          if (missing.length) push(`${where}: \`${p}\` is missing front matter ${missing.join(", ")}.`);
        }
        break;
      }
      case "naming": {
        const subject = attr(check, "subject");
        const value = subject === "branch" ? ws.branch : subject === "project_id" ? ws.projectId : undefined;
        const pattern = attr(check, "pattern");
        if (value === undefined) { warnings.push({ pol, doc, section, severity: "warn", message: `${where}: naming subject=${subject || "(none)"} is not known here.` }); break; }
        if (pattern && !new RegExp(pattern).test(value)) push(`${where}: ${subject} \`${value}\` does not match ${pattern}.`);
        break;
      }
      case "path-scope": {
        const writable = list(check, "writable");
        if (!writable.length) break;
        const outside = ws.paths().filter((p) => !matchesAny(p, writable));
        if (outside.length) push(`${where}: ${outside.length} path(s) outside the permitted scope, e.g. \`${outside[0]}\`.`);
        break;
      }
      default:
        // list-membership · content-forbidden — see the note above. Never silence.
        warnings.push({
          pol, doc, section, severity: "warn",
          message: `${where}: \`${check.kind}\` cannot run on a command — it is defined over a changeset. Attach it to file globs instead.`,
        });
    }
  }
  return { ok: failures.length === 0, failures, warnings };
}

/** The refusal, as a person reads it: what blocked, why, and the clause that asked. */
export function formatGate(result: GateResult, verb: string): string[] {
  const out: string[] = [];
  if (result.failures.length) {
    out.push(`gov ${verb} is blocked by ${result.failures.length} policy check${result.failures.length === 1 ? "" : "s"}:`);
    for (const f of result.failures) out.push(`  ✗ ${f.message}`);
  }
  for (const w of result.warnings) out.push(`  ! ${w.message}`);
  return out;
}
