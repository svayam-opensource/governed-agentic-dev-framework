// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Knowledge Organization Standard (SDD-032, §7) — port of check_knowledge.py.
 * Checks every knowledge/**.md (org tree; framework/ is the upstream template):
 *   1. orphan check — every non-README doc is linked from another knowledge doc
 *   2. journey purity — paths/*.md: no code/images, ≥3 links
 *   3. link check — relative md links resolve; no [[wikilinks]]
 *   4. diagram rule — no binary diagram embeds (Mermaid text only)
 * A doc whose front matter (if it has any) says `status: superseded` is a redirect stub, exempt from the orphan check.
 *
 * NO FRONT-MATTER MANDATE (Policy Owner, 2026-10-06). This validator used to require a domain / layer / compliance /
 * status block from a hard-coded taxonomy, and a layer agreeing with its folder, on every adopter's tree. Knowledge
 * front matter is the organization's choice: it is checked only when the org's own policy says so, by a rule
 * `gov rules propose` binds to `gov-builtin/frontmatter-required` with the org's fields and values (frontmatter.ts).
 *
 * Scans `ctx.files` for the doc list; `ctx.fs.pathExists` resolves link targets.
 */
import * as path from "node:path";
import type { ValidateContext, ValidationResult } from "./validate.js";
import { parseFrontMatter } from "../rules/frontmatter.js";

const LINK_RE_G = /\[[^\]]*\]\(([^)\s]+)\)/g;
const IMG_RE_G = /!\[[^\]]*\]\(([^)\s]+)\)/g;
const IMG_RE_TEST = /!\[[^\]]*\]\([^)\s]+\)/;
const WIKILINK_RE = /\[\[[^\]]+\]\]/;

/** Strip fenced/inline/indented code so wikilink detection ignores examples. */
function stripCode(text: string): string {
  const out: string[] = [];
  let fenceLen = 0;
  for (const line of text.split(/\r?\n/)) {
    const m = /^(`{3,})/.exec(line.trimStart());
    if (m) {
      const n = m[1].length;
      if (fenceLen === 0) fenceLen = n;
      else if (n >= fenceLen) fenceLen = 0;
      continue;
    }
    if (fenceLen === 0) out.push(line);
  }
  return out.join("\n").replace(/`[^`\n]*`/g, "").split(/\r?\n/).filter((l) => !l.startsWith("    ")).join("\n");
}

export function checkKnowledge(ctx: ValidateContext): ValidationResult {
  const errors: string[] = [];
  const abs = (rel: string) => path.join(ctx.repoRoot, rel);

  if (!ctx.fs.pathExists(abs("knowledge"))) {
    // The framework/template SOURCE repo has no instantiated org tree — nothing to check.
    if (ctx.fs.pathExists(abs("framework"))) return { name: "knowledge", ok: true, errors: [] };
    return { name: "knowledge", ok: false, errors: ["knowledge/ directory missing"] };
  }

  // Templates (fill-in skeletons) are not knowledge artifacts — never validated.
  const isTemplate = (f: string): boolean => {
    const b = f.split("/").pop() ?? "";
    return b === "TEMPLATE.md" || /-template\.md$/.test(b);
  };
  const docs = (ctx.files ?? []).filter((f) => f.startsWith("knowledge/") && f.endsWith(".md") && !isTemplate(f)).sort();
  const content = new Map<string, string>();
  for (const rel of docs) {
    const t = ctx.fs.readFile(abs(rel));
    if (t !== null) content.set(rel, t);
  }
  const linked = new Set<string>();

  // ── Pass 1: links, wikilinks, images, link-graph ───────────────────────────
  for (const rel of docs) {
    const text = content.get(rel) ?? "";
    if (WIKILINK_RE.test(stripCode(text))) {
      errors.push(`${rel}: [[wikilink]] found — use relative markdown links (Knowledge Organization Standard §6)`);
    }
    for (const m of text.matchAll(IMG_RE_G)) {
      const t = m[1].toLowerCase();
      if (/\.(png|jpe?g|gif)$/.test(t) && !t.includes("screenshot")) {
        errors.push(`${rel}: binary diagram embed '${m[1]}' — diagrams are Mermaid text (GOV-FRM-460)`);
      }
    }
    for (const m of text.matchAll(LINK_RE_G)) {
      const target = m[1];
      if (/^(https?:\/\/|mailto:|#)/.test(target)) continue;
      const targetAbs = path.resolve(path.dirname(abs(rel)), target.split("#")[0]);
      if (!ctx.fs.pathExists(targetAbs)) {
        errors.push(`${rel}: broken link '${target}'`);
      } else {
        // POSIX-normalise before comparing: `ctx.files` comes from `git ls-files`, which always uses
        // forward slashes, while `path.relative` uses the host separator. On Windows the two never match,
        // so EVERY linked doc read as an orphan and the validator failed its own shipped knowledge.
        const relResolved = path.relative(ctx.repoRoot, targetAbs).replace(/\\/g, "/");
        if (!relResolved.startsWith("..")) linked.add(relResolved);
      }
    }
  }

  // ── Pass 2: orphan, journey purity ─────────────────────────────────────────
  for (const rel of docs) {
    // Index READMEs are link SOURCES (scanned in Pass 1), exempt from the orphan check by definition.
    if (rel.endsWith("/README.md")) continue;
    const text = content.get(rel) ?? "";
    if (parseFrontMatter(text)?.status === "superseded") continue; // redirect stubs

    const parts = rel.split("/"); // knowledge / <domain..> / file
    const base = parts[parts.length - 1];
    if (base !== "README.md" && !linked.has(rel)) {
      errors.push(`${rel}: orphan — not linked from any index or journey (Knowledge Organization Standard §7)`);
    }

    if (parts[1] === "paths" && base !== "README.md") {
      if (text.includes("```")) errors.push(`${rel}: journey docs are links-only — code block found (Knowledge Organization Standard §5)`);
      if (IMG_RE_TEST.test(text)) errors.push(`${rel}: journey docs are links-only — image found (Knowledge Organization Standard §5)`);
      if ([...text.matchAll(LINK_RE_G)].length < 3) errors.push(`${rel}: journey doc has fewer than 3 links — is it a journey? (Knowledge Organization Standard §5)`);
    }
  }

  return { name: "knowledge", ok: errors.length === 0, errors };
}
