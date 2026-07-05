// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Knowledge Organization Standard (SDD-032, POL-416) — port of check_knowledge.py.
 * Checks every knowledge/**.md (org tree; framework/ is the upstream template):
 *   1. front-matter present + schema-valid; layer agrees with the folder
 *   2. orphan check — every non-README doc is linked from another knowledge doc
 *   3. journey purity — paths/*.md: no code/images, ≥3 links
 *   4. link check — relative md links resolve; no [[wikilinks]]
 *   5. diagram rule — no binary diagram embeds (Mermaid text only)
 * Superseded redirect stubs are exempt from orphan + folder-agreement (parse-only).
 *
 * Scans `ctx.files` for the doc list; `ctx.fs.pathExists` resolves link targets.
 */
import * as path from "node:path";
import type { ValidateContext, ValidationResult } from "./validate.js";

const DOMAINS = new Set([
  "policies", "legal", "architecture/system", "architecture/data", "development",
  "testing", "deployment", "infrastructure", "support", "compliance", "navigation",
]);
const LAYERS = new Set(["mandate", "procedure", "pattern", "use-case", "spec", "compliance", "path"]);
const COMPLIANCE = new Set(["C01", "C02", "C03", "instructional", "descriptive", "evidence"]);
const STATUSES = new Set(["current", "draft", "superseded"]);
const LAYER_FOLDER: Readonly<Record<string, string>> = {
  mandates: "mandate", procedures: "procedure", patterns: "pattern",
  "use-cases": "use-case", specs: "spec", compliance: "compliance", paths: "path",
};

const FM_RE = /^---\n([\s\S]*?)\n---\n/;
const LINK_RE_G = /\[[^\]]*\]\(([^)\s]+)\)/g;
const IMG_RE_G = /!\[[^\]]*\]\(([^)\s]+)\)/g;
const IMG_RE_TEST = /!\[[^\]]*\]\([^)\s]+\)/;
const WIKILINK_RE = /\[\[[^\]]+\]\]/;

/** Parse a leading `---\n…\n---\n` front-matter block into a key→value map. */
function frontMatter(text: string): Record<string, string> | null {
  const m = FM_RE.exec(text);
  if (!m) return null;
  const fm: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (line.includes(":") && !line.trimStart().startsWith("#")) {
      const idx = line.indexOf(":");
      fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return fm;
}

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
      errors.push(`${rel}: [[wikilink]] found — use relative markdown links (POL-413)`);
    }
    for (const m of text.matchAll(IMG_RE_G)) {
      const t = m[1].toLowerCase();
      if (/\.(png|jpe?g|gif)$/.test(t) && !t.includes("screenshot")) {
        errors.push(`${rel}: binary diagram embed '${m[1]}' — diagrams are Mermaid text (POL-414)`);
      }
    }
    for (const m of text.matchAll(LINK_RE_G)) {
      const target = m[1];
      if (/^(https?:\/\/|mailto:|#)/.test(target)) continue;
      const targetAbs = path.resolve(path.dirname(abs(rel)), target.split("#")[0]);
      if (!ctx.fs.pathExists(targetAbs)) {
        errors.push(`${rel}: broken link '${target}'`);
      } else {
        const relResolved = path.relative(ctx.repoRoot, targetAbs);
        if (!relResolved.startsWith("..")) linked.add(relResolved);
      }
    }
  }

  // ── Pass 2: front-matter, folder agreement, orphan, journey purity ─────────
  for (const rel of docs) {
    // Index READMEs are link SOURCES (scanned in Pass 1); they don't carry the
    // POL-408 taxonomy and are exempt from the orphan check by definition.
    if (rel.endsWith("/README.md")) continue;
    const text = content.get(rel) ?? "";
    const fm = frontMatter(text);
    if (fm === null) {
      errors.push(`${rel}: missing front-matter (POL-408)`);
      continue;
    }
    for (const [key, allowed] of [["domain", DOMAINS], ["layer", LAYERS], ["compliance", COMPLIANCE], ["status", STATUSES]] as const) {
      if (!allowed.has(fm[key] ?? "")) errors.push(`${rel}: front-matter ${key}='${fm[key]}' invalid (POL-408)`);
    }
    if (!fm.owner) errors.push(`${rel}: front-matter owner missing (POL-408)`);
    if (fm.status === "superseded") continue; // redirect stubs: parse-only

    const parts = rel.split("/"); // knowledge / <domain..> / [layer] / file
    let folderLayer: string | undefined;
    for (const seg of parts.slice(1, -1)) if (LAYER_FOLDER[seg]) folderLayer = LAYER_FOLDER[seg];
    if (folderLayer && fm.layer !== folderLayer) {
      errors.push(`${rel}: layer '${fm.layer}' disagrees with folder '${folderLayer}' (POL-408)`);
    }

    const base = parts[parts.length - 1];
    if (base !== "README.md" && !linked.has(rel)) {
      errors.push(`${rel}: orphan — not linked from any index or journey (POL-416)`);
    }

    if (parts[1] === "paths" && base !== "README.md") {
      if (text.includes("```")) errors.push(`${rel}: journey docs are links-only — code block found (POL-410)`);
      if (IMG_RE_TEST.test(text)) errors.push(`${rel}: journey docs are links-only — image found (POL-410)`);
      if ([...text.matchAll(LINK_RE_G)].length < 3) errors.push(`${rel}: journey doc has fewer than 3 links — is it a journey? (POL-410)`);
    }
  }

  return { name: "knowledge", ok: errors.length === 0, errors };
}
