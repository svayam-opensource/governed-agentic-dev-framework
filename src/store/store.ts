import type { ChunkMetadata, MetadataFilter } from "../types.js";

export interface StoredPoint {
  chunkId: string;
  vector: number[];
  text: string;       // body (raw section, for /docs + getChunk)
  metadata: ChunkMetadata;
}

export interface ScoredPoint {
  chunkId: string;
  score: number;
  text: string;
  metadata: ChunkMetadata;
}

export interface VectorStore {
  readonly kind: "qdrant" | "memory";
  ensureCollection(dim: number): Promise<void>;
  upsert(points: StoredPoint[]): Promise<void>;
  /** delete all points whose payload.path === path (delete-then-upsert correctness) */
  deleteByPath(path: string): Promise<number>;
  search(
    vector: number[],
    topK: number,
    filter?: MetadataFilter,
    minScore?: number,
  ): Promise<ScoredPoint[]>;
  getByChunkId(chunkId: string): Promise<StoredPoint | null>;
  getByPath(path: string): Promise<StoredPoint[]>;
  count(): Promise<number>;
  health(): Promise<"ok" | "down">;
  clear(): Promise<void>;
  /**
   * The git sha the index was last ingested up to, PERSISTED with the index so it
   * survives process boundaries (the CLI `ingest` and `serve` are separate processes)
   * and restarts. Returns "" if never set. This is what makes `/readyz.indexedSha`
   * truthful and lets incremental re-embed self-compute `--sinceSha` (#49).
   */
  getIndexedSha(): Promise<string>;
  setIndexedSha(sha: string, dim: number): Promise<void>;
}

// ---- shared payload-filter semantics (AND across fields, OR within a field) ----
// Identical logic is implemented natively as a Qdrant filter and in JS for the
// memory store, so behavior is byte-for-byte the same in tests and in Qdrant.

export function matchesFilter(meta: ChunkMetadata, f?: MetadataFilter): boolean {
  if (!f) return true;
  const anyOf = (vals: string[] | undefined, got: string | undefined) =>
    !vals || vals.length === 0 || (got !== undefined && vals.includes(got));

  if (!anyOf(f.domain, meta.domain)) return false;
  if (!anyOf(f.layer, meta.layer)) return false;
  if (!anyOf(f.domainOwner, meta.domainOwner)) return false;
  if (!anyOf(f.compliance, meta.compliance)) return false;
  if (!anyOf(f.status, meta.status)) return false;
  if (f.project && f.project.length > 0) {
    if (!meta.project || !f.project.includes(meta.project)) return false;
  }
  if (f.pathPrefix && f.pathPrefix.length > 0) {
    if (!f.pathPrefix.some((p) => meta.path.startsWith(p))) return false;
  }
  if (f.roleLens && f.roleLens.length > 0) {
    const lenses = meta.navFacets?.roleLenses ?? [];
    if (!f.roleLens.some((r) => lenses.includes(r))) return false;
  }
  if (f.navFacets) {
    const dims = meta.navFacets?.dimensions ?? {};
    for (const [dim, allowed] of Object.entries(f.navFacets)) {
      const got = dims[dim] ?? [];
      if (!allowed.some((v) => got.includes(v))) return false;
    }
  }
  return true;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
