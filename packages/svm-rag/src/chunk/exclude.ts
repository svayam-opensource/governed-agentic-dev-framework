import type { FrontMatter } from "../meta/frontmatter.js";

// C1 — index/journey-pollution exclusion (rag-stack-decision §10, observation 6a).
//
// SETTLED DECISION (grounded by the live-corpus filter test, test/exclude.test.ts,
// and the §7 recall benchmark variant (a) vs (c)):
//
// We exclude from the SEMANTIC index, at the chunker, docs that carry NO authored
// facts (POL-402) — only links/index scaffolding or a migration redirect:
//
//   1. `paths/*.md` JOURNEY docs (layer: path) — links-only by POL-410 ("Links
//      only — facts live in their domains"). Searching them returns a pointer,
//      not the fact. ALWAYS excluded.
//
//   2. README.md files THAT ARE links-only — detected by CONTENT, not by filename:
//        a. an empty layer-index stub:  "*(empty — add documents here ...)*"
//        b. a dissolved/migration redirect stub:  "# Dissolved ..." / superseded
//        c. a body that is only an `## Index` of links with no prose paragraphs.
//      A README that carries AUTHORED PROSE is KEPT (content-based, not blanket).
//
// Why content-based, not blanket-by-filename: a blanket README exclusion drops a
// whole DOMAIN whose only docs are READMEs (the `testing` domain today is six
// empty-index README stubs), making its owner-lens silently empty for the WRONG
// reason. Content detection keeps the rule honest: testing is empty because it
// has no authored content yet, and the moment a real testing doc (or a prose
// README) lands it is indexed and `testing-quality-owner` matches it — verified
// in test/exclude.test.ts with a synthesised prose README.
//
// Excluded docs remain reachable by exact path via GET /docs (they live in the
// SoT); they just never pollute ANN search.
//
// Override: includeIndexDocs=true indexes everything (benchmark variant (a)).

export interface ExcludeOptions {
  includeIndexDocs?: boolean;
}

export interface ExclusionDecision {
  excluded: boolean;
  reason?: "readme-empty-index" | "readme-dissolved" | "readme-links-only" | "journey-path-doc";
}

export function classifyExclusion(
  repoRelPath: string,
  fm: FrontMatter,
  opts: ExcludeOptions = {},
  body?: string,
): ExclusionDecision {
  if (opts.includeIndexDocs) return { excluded: false };

  // 1. journey/path docs — links-only by mandate.
  if (fm.layer === "path" || /(^|\/)paths\//.test(repoRelPath)) {
    return { excluded: true, reason: "journey-path-doc" };
  }

  const base = repoRelPath.split("/").pop() ?? "";
  if (base.toLowerCase() === "readme.md" && body !== undefined) {
    // a. empty layer-index stub
    if (/\*\(empty\s*[—-]\s*add documents here/i.test(body)) {
      return { excluded: true, reason: "readme-empty-index" };
    }
    // b. dissolved / migration redirect stub (also flagged superseded in FM)
    if (/^#\s+Dissolved\b/im.test(body) || fm.status === "superseded") {
      return { excluded: true, reason: "readme-dissolved" };
    }
    // c. links-only index: an `## Index` and no real prose paragraph elsewhere.
    if (isLinksOnlyIndex(body)) {
      return { excluded: true, reason: "readme-links-only" };
    }
  }

  return { excluded: false };
}

// A README is "links-only" if, outside front-matter and heading/badge lines, the
// only substantive content is an Index list of links (no multi-sentence prose
// paragraph). Conservative: any paragraph with >= 12 words of non-link prose
// keeps the doc.
function isLinksOnlyIndex(body: string): boolean {
  const hasIndex = /^##\s+Index\b/im.test(body);
  if (!hasIndex) return false;
  const lines = body.split("\n");
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    if (l.startsWith("#")) continue;             // headings
    if (l.startsWith(">")) continue;             // callouts/notes
    if (l.startsWith("- ") || l.startsWith("* ") || /^\d+\./.test(l)) continue; // list items
    if (l.startsWith("**") && l.endsWith("**")) continue; // badge lines
    if (l.startsWith("*(") || l.startsWith("*[")) continue; // italic notes/links
    // strip markdown links, then count words; a real prose sentence keeps it.
    const prose = l.replace(/\[[^\]]*\]\([^)]*\)/g, "").replace(/[*_`>]/g, "").trim();
    const words = prose.split(/\s+/).filter(Boolean);
    if (words.length >= 12) return false;        // substantive prose -> keep
  }
  return true;
}
