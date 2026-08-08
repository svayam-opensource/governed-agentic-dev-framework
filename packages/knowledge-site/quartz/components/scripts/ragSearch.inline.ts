// ragSearch — same-origin semantic search via the knowledge-rp /rag/v1 proxy (#92).
//
// POSTURE (verified, #92): browser -> SAME-ORIGIN RP (/rag/v1) -> loopback knowledge-api.
// The browser NEVER holds a RAG key — the RP injects the rp-read key server-side. So this
// module sends NO Authorization header and uses same-origin credentials (the OIDC cookie).
//
// The site search is semantic-FIRST with a lexical (FlexSearch) FALLBACK: if the RAG call
// errors, aborts, or returns nothing, the caller falls back to the static contentIndex.
// This mirrors the /readyz indexedSha-degradation story — the site keeps working when the
// semantic backend is behind or down. (That is why contentIndex.json is KEPT, not dropped.)

const RAG_SEARCH_URL = "/rag/v1/search" // same-origin; the RP proxies to 127.0.0.1:8080

export interface RagHitMetadata {
  path: string
  heading?: string
  headingSlug?: string
  title?: string
  domain?: string
  layer?: string
}
export interface RagHit {
  score: number
  text?: string | null
  metadata: RagHitMetadata
}
export interface RagSearchOutcome {
  ok: boolean // false => caller should fall back to lexical
  hits: RagHit[]
}
export interface RagItem {
  slug: string
  title: string
  content: string
  score: number
  headingSlug?: string
}

// POST the query to the RAG API. Never throws — returns ok:false so the caller falls back.
export async function ragSearch(
  query: string,
  topK = 8,
  signal?: AbortSignal,
): Promise<RagSearchOutcome> {
  try {
    const res = await fetch(RAG_SEARCH_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, topK, includeText: true }),
      credentials: "same-origin", // send the OIDC session cookie; no API key in the browser
      signal,
    })
    if (!res.ok) return { ok: false, hits: [] }
    const data = await res.json()
    return { ok: true, hits: Array.isArray(data?.hits) ? data.hits : [] }
  } catch {
    return { ok: false, hits: [] } // network error or abort → lexical fallback
  }
}

// Map a hit's CORPUS path (e.g. "knowledge/policies/foo.md") to a REAL site slug by
// longest-suffix match against the slugs the page already loaded (contentIndex keys).
// Grounding in real slugs avoids guessing the content-root prefix → no broken links.
export function pathToSlug(path: string, slugs: Set<string>): string | null {
  if (!path) return null
  const noExt = path
    .replace(/\.md$/i, "")
    .replace(/\/(README|index)$/i, "")
  if (slugs.has(noExt)) return noExt
  let best: string | null = null
  for (const s of slugs) {
    if ((noExt === s || noExt.endsWith("/" + s)) && (!best || s.length > best.length)) best = s
  }
  return best
}

// Collapse chunk-level hits to BEST-per-document, mapped to display items, score-sorted.
export function hitsToItems(hits: RagHit[], slugs: Set<string>): RagItem[] {
  const bySlug = new Map<string, RagItem>()
  for (const h of hits) {
    const slug = pathToSlug(h.metadata?.path ?? "", slugs)
    if (!slug) continue
    const prev = bySlug.get(slug)
    if (prev && prev.score >= h.score) continue
    bySlug.set(slug, {
      slug,
      title: h.metadata?.title || h.metadata?.heading || slug,
      content: (h.text ?? "").replace(/\s+/g, " ").trim().slice(0, 300),
      score: h.score,
      headingSlug: h.metadata?.headingSlug,
    })
  }
  return [...bySlug.values()].sort((a, b) => b.score - a.score)
}
