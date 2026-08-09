import { createHash } from "node:crypto";

// Minimal front-matter parser. The corpus front-matter is flat scalar key:value
// (domain/layer/owner/compliance/status/project/...). We deliberately keep this
// dependency-free and tolerant: trailing `# inline comments` (seen in the corpus,
// e.g. `domain: support            # one of the 9 domains`) are stripped, quotes
// trimmed. Nested facets are not present in the corpus today; if they appear we
// capture them shallowly under `facets`.

export interface FrontMatter {
  [key: string]: string | undefined;
}

export interface ParsedDoc {
  frontMatter: FrontMatter;
  body: string;          // markdown after the front-matter block
  bodyLineOffset: number; // 1-based line number in the original file where `body` starts
  title: string;         // first H1 (# ) or filename-derived
}

const FM_DELIM = /^---\s*$/;

export function parseFrontMatter(raw: string): ParsedDoc {
  const lines = raw.split("\n");
  const fm: FrontMatter = {};
  let bodyStart = 0;

  if (lines.length > 0 && FM_DELIM.test(lines[0])) {
    let end = -1;
    for (let i = 1; i < lines.length; i++) {
      if (FM_DELIM.test(lines[i])) { end = i; break; }
    }
    if (end !== -1) {
      for (let i = 1; i < end; i++) {
        const line = lines[i];
        const m = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line);
        if (!m) continue;
        const key = m[1];
        let val = m[2];
        // strip trailing inline comment: value followed by whitespace + # ...
        // (only when not quoted). Keep '#anchors' that are part of a quoted value.
        if (!/^["']/.test(val)) {
          val = val.replace(/\s+#.*$/, "");
        }
        val = val.trim().replace(/^["']|["']$/g, "");
        if (val !== "") fm[key] = val;
      }
      bodyStart = end + 1;
    }
  }

  const bodyLines = lines.slice(bodyStart);
  const body = bodyLines.join("\n");
  const title = extractTitle(bodyLines);

  return { frontMatter: fm, body, bodyLineOffset: bodyStart + 1, title };
}

function extractTitle(bodyLines: string[]): string {
  for (const l of bodyLines) {
    const m = /^#\s+(.+?)\s*$/.exec(l);
    if (m) return m[1].replace(/[*_`]/g, "").trim();
  }
  return "";
}

export function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

// chunkId = sha1(path + "#" + headingSlug) — deterministic across re-embeds.
export function chunkIdOf(path: string, headingSlug: string): string {
  return createHash("sha1").update(`${path}#${headingSlug}`).digest("hex");
}
