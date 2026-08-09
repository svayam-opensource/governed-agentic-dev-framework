import { parseFrontMatter, slugify, chunkIdOf } from "../meta/frontmatter.js";
import type { ParsedDoc } from "../meta/frontmatter.js";
import { buildMetadata } from "../meta/metadata.js";
import type { Chunk, ChunkMetadata } from "../types.js";

// Per-`##` section chunking (rag-stack-decision §5).
//  - Unit = one `##` section. Preamble (content above first `##`) is its own chunk.
//  - Sub-`###` stay within their parent `##` chunk.
//  - Self-containment prefix: "Document: <H1>\nSection: <##>\n\n<body>" — embedding
//    context only, NOT a second authority (POL-402). Stored separately as `text`
//    (prefixed, for embedding) vs `body` (raw, for /docs reconstruction).
//  - Code fences are respected so a `## ...` inside a ``` block is not a heading.

export interface ChunkInput {
  /** raw file contents */
  raw: string;
  /** repo-root-relative path, e.g. "knowledge/policies/llm-governance.md" */
  repoRelPath: string;
  /** last commit that MODIFIED this file (provenance) — resolved by caller */
  commitSha: string;
}

interface RawSection {
  heading: string;        // "" for preamble
  headingSlug: string;    // "(preamble)" slug for preamble
  body: string;
  lineStart: number;      // 1-based, in the original file
  lineEnd: number;
}

const H2 = /^##\s+(.+?)\s*#*\s*$/;
const FENCE = /^(\s*)(```|~~~)/;

function splitSections(parsed: ParsedDoc): RawSection[] {
  const lines = parsed.body.split("\n");
  const offset = parsed.bodyLineOffset; // line number of body line 0 in original file
  const sections: RawSection[] = [];
  let cur: { heading: string; start: number; buf: string[] } | null = null;
  let inFence = false;

  const flush = (endLineIdx: number) => {
    if (cur === null) return;
    const body = cur.buf.join("\n").trim();
    sections.push({
      heading: cur.heading,
      headingSlug: cur.heading === "" ? "preamble" : slugify(cur.heading),
      body,
      lineStart: offset + cur.start,
      lineEnd: offset + endLineIdx,
    });
  };

  // start with an implicit preamble section
  cur = { heading: "", start: 0, buf: [] };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE.test(line)) inFence = !inFence;
    const m = !inFence ? H2.exec(line) : null;
    if (m) {
      flush(i - 1);
      cur = { heading: m[1].replace(/[*`]/g, "").trim(), start: i, buf: [] };
    } else {
      cur.buf.push(line);
    }
  }
  flush(lines.length - 1);
  return sections;
}

export function chunkDocument(input: ChunkInput): Chunk[] {
  const parsed = parseFrontMatter(input.raw);
  const title = parsed.title || input.repoRelPath.split("/").pop()!.replace(/\.md$/, "");
  const sections = splitSections(parsed);
  const baseMeta = buildMetadata(input.repoRelPath, parsed.frontMatter, input.commitSha);

  const out: Chunk[] = [];
  for (const s of sections) {
    if (s.body.trim() === "") continue; // guard blanks (rag-stack-decision: 589 non-empty)
    const headingForMeta = s.heading === "" ? "(preamble)" : s.heading;
    const slug = s.headingSlug;
    const chunkId = chunkIdOf(input.repoRelPath, slug);

    const prefix =
      s.heading === ""
        ? `Document: ${title}\n\n`
        : `Document: ${title}\nSection: ${s.heading}\n\n`;
    const text = prefix + s.body;

    const meta: ChunkMetadata = {
      ...baseMeta,
      heading: headingForMeta,
      headingSlug: slug,
      anchor: anchorFor(input.repoRelPath, slug),
      lineStart: s.lineStart,
      lineEnd: s.lineEnd,
    };

    out.push({ chunkId, text, body: s.body, metadata: meta });
  }
  return out;
}

// /policies/roles#policy-owner — site deep link derived from path + slug.
function anchorFor(repoRelPath: string, slug: string): string {
  const sitePath = repoRelPath
    .replace(/^knowledge\//, "/")
    .replace(/^projects\//, "/projects/")
    .replace(/\.md$/, "");
  return slug === "preamble" ? sitePath : `${sitePath}#${slug}`;
}
