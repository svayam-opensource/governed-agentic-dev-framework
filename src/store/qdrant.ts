import { createHash } from "node:crypto";
import type { ChunkMetadata, MetadataFilter } from "../types.js";
import type { VectorStore, StoredPoint, ScoredPoint } from "./store.js";

// Real self-hosted Qdrant backend over its HTTP API (no SDK dependency — the
// REST surface is small and stable). Loopback-bound container, no egress.
//
// Point id: Qdrant point ids must be uint64 or UUID. chunkId is a sha1 hex
// string, so we map chunkId -> a deterministic UUIDv5-ish id (first 32 hex of a
// sha1 over the chunkId, formatted as a UUID). chunkId is kept verbatim in the
// payload so getByChunkId / search results carry the contract id.

function chunkIdToPointId(chunkId: string): string {
  const h = createHash("sha1").update(chunkId).digest("hex").slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

interface QPayload {
  chunkId: string;
  text: string;
  meta: ChunkMetadata;
  // flattened scalar fields for native payload filtering:
  path: string;
  domain: string;
  layer: string;
  domainOwner: string;
  compliance?: string;
  status?: string;
  project?: string | null;
  roleLenses: string[];
}

export class QdrantStore implements VectorStore {
  readonly kind = "qdrant" as const;

  constructor(
    private readonly baseUrl: string,
    private readonly collection: string,
  ) {}

  private url(p: string): string { return `${this.baseUrl}${p}`; }

  private async req(method: string, path: string, body?: unknown): Promise<any> {
    const res = await fetch(this.url(path), {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`qdrant ${method} ${path} ${res.status}: ${await res.text()}`);
    }
    return res.json();
  }

  async ensureCollection(dim: number): Promise<void> {
    const existing = await fetch(this.url(`/collections/${this.collection}`));
    if (existing.ok) return;
    await this.req("PUT", `/collections/${this.collection}`, {
      vectors: { size: dim, distance: "Cosine" },
    });
    // payload indexes for the filterable scalar fields (exact-match keyword indexes)
    for (const field of ["path", "domain", "layer", "domainOwner", "compliance", "status", "project", "roleLenses"]) {
      await this.req("PUT", `/collections/${this.collection}/index`, {
        field_name: field, field_schema: "keyword",
      }).catch(() => { /* index may already exist */ });
    }
  }

  async upsert(points: StoredPoint[]): Promise<void> {
    if (points.length === 0) return;
    const qp = points.map((p) => ({
      id: chunkIdToPointId(p.chunkId),
      vector: p.vector,
      payload: flatten(p),
    }));
    await this.req("PUT", `/collections/${this.collection}/points?wait=true`, { points: qp });
  }

  async deleteByPath(path: string): Promise<number> {
    const before = await this.countWithFilter({ path });
    await this.req("POST", `/collections/${this.collection}/points/delete?wait=true`, {
      filter: { must: [{ key: "path", match: { value: path } }] },
    });
    return before;
  }

  async search(vector: number[], topK: number, filter?: MetadataFilter, minScore = 0): Promise<ScoredPoint[]> {
    const body: any = {
      vector, limit: topK, with_payload: true,
      filter: toQdrantFilter(filter),
    };
    if (minScore > 0) body.score_threshold = minScore;
    const res = await this.req("POST", `/collections/${this.collection}/points/search`, body);
    return (res.result as any[]).map((r) => fromPayload(r.payload as QPayload, r.score));
  }

  async getByChunkId(chunkId: string): Promise<StoredPoint | null> {
    const res = await this.req("POST", `/collections/${this.collection}/points/scroll`, {
      filter: { must: [{ key: "chunkId", match: { value: chunkId } }] },
      with_payload: true, with_vector: true, limit: 1,
    });
    const pts = res.result?.points ?? [];
    if (pts.length === 0) return null;
    return toStored(pts[0]);
  }

  async getByPath(path: string): Promise<StoredPoint[]> {
    const res = await this.req("POST", `/collections/${this.collection}/points/scroll`, {
      filter: { must: [{ key: "path", match: { value: path } }] },
      with_payload: true, with_vector: true, limit: 1000,
    });
    const pts = (res.result?.points ?? []).map(toStored);
    pts.sort((a: StoredPoint, b: StoredPoint) => (a.metadata.lineStart ?? 0) - (b.metadata.lineStart ?? 0));
    return pts;
  }

  private async countWithFilter(payloadEq: Record<string, string>): Promise<number> {
    const res = await this.req("POST", `/collections/${this.collection}/points/count`, {
      filter: { must: Object.entries(payloadEq).map(([k, v]) => ({ key: k, match: { value: v } })) },
      exact: true,
    });
    return res.result?.count ?? 0;
  }

  async count(): Promise<number> {
    const res = await this.req("POST", `/collections/${this.collection}/points/count`, { exact: true });
    return res.result?.count ?? 0;
  }

  async health(): Promise<"ok" | "down"> {
    try {
      const res = await fetch(this.url(`/collections/${this.collection}`));
      return res.ok ? "ok" : "down";
    } catch { return "down"; }
  }

  async clear(): Promise<void> {
    await fetch(this.url(`/collections/${this.collection}`), { method: "DELETE" });
  }
}

function flatten(p: StoredPoint): QPayload {
  const m = p.metadata;
  return {
    chunkId: p.chunkId,
    text: p.text,
    meta: m,
    path: m.path,
    domain: m.domain,
    layer: m.layer,
    domainOwner: m.domainOwner,
    compliance: m.compliance,
    status: m.status,
    project: m.project ?? null,
    roleLenses: m.navFacets?.roleLenses ?? [],
  };
}

function fromPayload(pl: QPayload, score: number): ScoredPoint {
  return { chunkId: pl.chunkId, score, text: pl.text, metadata: pl.meta };
}

function toStored(pt: any): StoredPoint {
  const pl = pt.payload as QPayload;
  return { chunkId: pl.chunkId, vector: pt.vector ?? [], text: pl.text, metadata: pl.meta };
}

// MetadataFilter -> Qdrant filter (must = AND across fields; match.any = OR within).
function toQdrantFilter(f?: MetadataFilter): any {
  if (!f) return undefined;
  const must: any[] = [];
  const anyMatch = (key: string, vals?: string[]) => {
    if (vals && vals.length > 0) must.push({ key, match: { any: vals } });
  };
  anyMatch("domain", f.domain);
  anyMatch("layer", f.layer);
  anyMatch("domainOwner", f.domainOwner);
  anyMatch("compliance", f.compliance);
  anyMatch("status", f.status);
  anyMatch("project", f.project);
  anyMatch("roleLenses", f.roleLens);
  // pathPrefix + navFacets are applied as a post-filter in the engine (keeps the
  // backend filter to exact keyword matches; the corpus is tiny so this is cheap).
  return must.length > 0 ? { must } : undefined;
}
