import type { MetadataFilter } from "../types.js";
import {
  type VectorStore, type StoredPoint, type ScoredPoint,
  matchesFilter, cosine,
} from "./store.js";

// In-memory cosine store — the local fallback when no container runtime is
// available. Exercises the SAME ingest->embed->store->query path and the SAME
// filter semantics as Qdrant (see store.matchesFilter). Not persistent.
export class MemoryStore implements VectorStore {
  readonly kind = "memory" as const;
  private points = new Map<string, StoredPoint>();

  async ensureCollection(_dim: number): Promise<void> { /* no-op */ }

  async upsert(points: StoredPoint[]): Promise<void> {
    for (const p of points) this.points.set(p.chunkId, p);
  }

  async deleteByPath(path: string): Promise<number> {
    let n = 0;
    for (const [id, p] of this.points) {
      if (p.metadata.path === path) { this.points.delete(id); n++; }
    }
    return n;
  }

  async search(vector: number[], topK: number, filter?: MetadataFilter, minScore = 0): Promise<ScoredPoint[]> {
    const scored: ScoredPoint[] = [];
    for (const p of this.points.values()) {
      if (!matchesFilter(p.metadata, filter)) continue;
      const score = cosine(vector, p.vector);
      if (score < minScore) continue;
      scored.push({ chunkId: p.chunkId, score, text: p.text, metadata: p.metadata });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  async getByChunkId(chunkId: string): Promise<StoredPoint | null> {
    return this.points.get(chunkId) ?? null;
  }

  async getByPath(path: string): Promise<StoredPoint[]> {
    return [...this.points.values()]
      .filter((p) => p.metadata.path === path)
      .sort((a, b) => (a.metadata.lineStart ?? 0) - (b.metadata.lineStart ?? 0));
  }

  async count(): Promise<number> { return this.points.size; }
  async health(): Promise<"ok" | "down"> { return "ok"; }
  async clear(): Promise<void> { this.points.clear(); }
}
