// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * READING THE WORKSPACE FOR {@link ../knowledge-search.js} — the one side of knowledge search that touches disk.
 *
 * THERE IS NO INDEX, AND THAT IS THE FINDING (2026-09-23). The design called for a cached index under the
 * person's `state/cache/`, keyed by the workspace's git tree sha, so "a second search is instant". Built and
 * measured against this workspace — 681 documents — it came to:
 *
 *     read every file from disk   31 ms
 *     read the cached index       19 ms
 *     rank the results            25 ms
 *
 * Twelve milliseconds, bought with a 5.5 MB second copy of every policy the organization has, sitting in a
 * state directory, able to go stale, and needing a correctness story about when it must not be trusted. The
 * FIRST search is already instant; there was nothing for a cache to fix. So the cache is gone and the reading
 * verbs hold no state at all: `search`, `show` and `list` read the markdown, rank it, print it, and leave
 * nothing behind. If a workspace ever grows to where this is felt, the measurement above is the one to repeat.
 *
 * WHAT IT SEARCHES: org knowledge (`knowledge/`), the org's policies (`policies/`), the framework's own
 * documents (`framework/`), and every project's knowledge (`projects/<id>/knowledge/`) — the four places the
 * knowledge layers actually live (§2 of the session protocol).
 */
import { log } from "../log.js";
import type { Fs } from "../lifecycle/fs-io.js";
import type { Doc } from "../knowledge-search.js";

/** The roots that hold knowledge, in the order the layers are read. */
export const KNOWLEDGE_ROOTS = ["knowledge", "policies", "framework", "projects"] as const;

/** Skipped wherever they appear — none of it is knowledge, and `node_modules` alone would dwarf the rest. */
const SKIP_DIRS = new Set([".git", "node_modules", ".gov", "dist", "lib", "coverage", ".venv", "__pycache__"]);

const MAX_BYTES = 512 * 1024;   // a markdown file larger than this is a data dump, not a document

/** Every markdown document under the knowledge roots, as workspace-relative paths, depth-first. */
export function collectDocs(fs: Fs, home: string, roots: readonly string[] = KNOWLEDGE_ROOTS): Doc[] {
  const docs: Doc[] = [];
  const walk = (rel: string): void => {
    for (const name of fs.readdir(`${home}/${rel}`).sort()) {
      if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
      const childRel = `${rel}/${name}`;
      if (/\.mdx?$/i.test(name)) {
        const text = fs.readFile(`${home}/${childRel}`);
        // Content over the cap is indexed by its head: findable, without pulling a megabyte into memory.
        if (text !== null) docs.push({ path: childRel, text: text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) : text });
      } else {
        // Descend by ASKING, not by guessing from the name: the port has no stat, and a folder is allowed to
        // be called `adr-2026.01`. `readdir` of a file is empty, so a non-markdown file costs one failed read.
        walk(childRel);
      }
    }
  };
  for (const root of roots) if (fs.pathExists(`${home}/${root}`)) walk(root);
  return docs;
}

/** The documents to search — read fresh, every time. See the note above on why there is no cache. */
export function loadDocs(fs: Fs, home: string): Doc[] {
  const docs = collectDocs(fs, home);
  log("debug", "knowledge read", "gov-work:cli:knowledge-io", "loadDocs", { home, docs: docs.length });
  return docs;
}

/**
 * Resolve what `gov knowledge show <path>` was given. A person types what the search printed, but they also
 * type the tail of it, or the name alone — all three should open the document.
 */
export function resolveDoc(docs: readonly Doc[], query: string): { doc?: Doc; candidates: string[] } {
  const q = query.replace(/^\.?\//, "").toLowerCase();
  const exact = docs.find((d) => d.path.toLowerCase() === q);
  if (exact) return { doc: exact, candidates: [] };
  const matches = docs.filter((d) => d.path.toLowerCase().endsWith(`/${q}`) || d.path.toLowerCase().includes(q));
  if (matches.length === 1) return { doc: matches[0]!, candidates: [] };
  return { candidates: matches.map((d) => d.path).slice(0, 10) };
}
