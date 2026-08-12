import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type {
  SearchRequest, SearchResponse, SimilarDocsRequest, SimilarDocsResponse,
  Document, Readiness, IngestRequest, IngestJob, MetadataFilter, Hit,
} from "./types.js";
import type { RagConfig } from "./config.js";
import { modelId } from "./config.js";
import type { Embedder } from "./embed/ollama.js";
import type { VectorStore, ScoredPoint, StoredPoint } from "./store/store.js";
import { matchesFilter } from "./store/store.js";
import { chunkDocument } from "./chunk/chunker.js";
import { classifyExclusion, type ExcludeOptions } from "./chunk/exclude.js";
import { parseFrontMatter } from "./meta/frontmatter.js";
import { headSha, lastCommitForFile, changedFiles } from "./ingest/git.js";

const DEFAULT_STATUS_FILTER = ["current"];

export class RagEngine {
  private indexedSha = "";
  private jobs = new Map<string, IngestJob>();

  constructor(
    private readonly cfg: RagConfig,
    private readonly embedder: Embedder,
    private readonly store: VectorStore,
  ) {}

  // ---- discovery -------------------------------------------------------
  /** All knowledge markdown files, repo-root-relative. */
  listCorpusFiles(): string[] {
    const roots = [join(this.cfg.corpusRoot, "knowledge")];
    if (this.cfg.includeProjectKnowledge) roots.push(join(this.cfg.corpusRoot, "projects"));
    const out: string[] = [];
    for (const root of roots) {
      walk(root, (abs) => {
        if (!abs.endsWith(".md")) return;
        if (root.endsWith("projects") && !/\/knowledge\//.test(abs)) return;
        out.push(relative(this.cfg.corpusRoot, abs));
      });
    }
    return out.sort();
  }

  // ---- ingest ----------------------------------------------------------
  async ingest(req: IngestRequest = {}, exclude: ExcludeOptions = {}): Promise<IngestJob> {
    const mode = req.mode ?? "incremental";
    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const job: IngestJob = {
      jobId, status: "running", mode,
      sourceSha: req.sourceSha ?? headSha(this.cfg.corpusRoot),
      filesProcessed: 0, chunksUpserted: 0, chunksDeleted: 0,
      startedAt: new Date().toISOString(), finishedAt: null, error: null,
    };
    this.jobs.set(jobId, job);

    try {
      await this.store.ensureCollection(this.cfg.embedDim);

      let targets: string[];
      if (mode === "full") {
        await this.store.clear();
        await this.store.ensureCollection(this.cfg.embedDim);
        targets = this.listCorpusFiles();
      } else if (req.paths && req.paths.length > 0) {
        targets = req.paths;
      } else if (req.sinceSha) {
        const changed = changedFiles(this.cfg.corpusRoot, req.sinceSha);
        for (const c of changed) {
          if (c.change === "D" || c.change === "R") {
            const del = await this.store.deleteByPath(c.oldPath ?? c.path);
            job.chunksDeleted! += del;
          }
        }
        targets = changed.filter((c) => c.change !== "D").map((c) => c.path);
      } else {
        targets = this.listCorpusFiles(); // default incremental with no scope == full set
      }

      for (const repoRel of targets) {
        // delete-then-upsert by path (handles section loss + prune)
        const del = await this.store.deleteByPath(repoRel);
        job.chunksDeleted! += del;

        const abs = join(this.cfg.corpusRoot, repoRel);
        let raw: string;
        try { raw = readFileSync(abs, "utf8"); } catch { continue; } // deleted file
        const { frontMatter, body } = parseFrontMatter(raw);
        const decision = classifyExclusion(repoRel, frontMatter, exclude, body);
        if (decision.excluded) { job.filesProcessed!++; continue; } // C1 exclusion

        const commitSha = lastCommitForFile(this.cfg.corpusRoot, repoRel) || (req.sourceSha ?? "");
        const chunks = chunkDocument({ raw, repoRelPath: repoRel, commitSha });
        if (chunks.length === 0) { job.filesProcessed!++; continue; }

        const vectors = await this.embedder.embedBatch(chunks.map((c) => c.text));
        const points: StoredPoint[] = chunks.map((c, i) => ({
          chunkId: c.chunkId, vector: vectors[i], text: c.body, metadata: c.metadata,
        }));
        await this.store.upsert(points);
        job.chunksUpserted! += points.length;
        job.filesProcessed!++;
      }

      this.indexedSha = job.sourceSha ?? this.indexedSha;
      // Persist with the index so a restart / the separate serve process see it (#49).
      if (this.indexedSha) await this.store.setIndexedSha(this.indexedSha, this.cfg.embedDim);
      job.status = "succeeded";
      job.finishedAt = new Date().toISOString();
    } catch (e: any) {
      job.status = "failed";
      job.error = String(e?.message ?? e);
      job.finishedAt = new Date().toISOString();
    }
    return job;
  }

  getIngestJob(jobId: string): IngestJob | null { return this.jobs.get(jobId) ?? null; }

  /**
   * Authoritative indexedSha, read from the durable store (#49). The PERSISTED value
   * is the source of truth so the long-running serve process never reports a stale sha
   * after a SEPARATE process (CLI ingest) advances it. The in-memory field is kept warm
   * as the fallback when the store is briefly unreachable, and honours an explicit
   * RAG_INDEXED_SHA boot override while the store is still empty. The extra point-get is
   * cheap (loopback Qdrant, tiny corpus).
   */
  private async currentIndexedSha(): Promise<string> {
    const persisted = await this.store.getIndexedSha().catch(() => "");
    if (persisted) this.indexedSha = persisted
    return persisted || this.indexedSha;
  }

  // ---- search ----------------------------------------------------------
  async search(req: SearchRequest): Promise<SearchResponse> {
    const topK = req.topK ?? 8;
    const includeText = req.includeText ?? true;
    const filter = withStatusDefault(req.filter);
    const vec = await this.embedder.embed(req.query);
    // over-fetch then apply post-filter (pathPrefix/navFacets) + minScore
    const raw = await this.store.search(vec, topK * 3, filter, req.minScore ?? 0);
    const filtered = raw.filter((p) => matchesFilter(p.metadata, filter)).slice(0, topK);
    const hits: Hit[] = filtered.map((p) => ({
      chunkId: p.chunkId, score: round(p.score),
      text: includeText ? p.text : null, metadata: p.metadata,
    }));
    return { hits, model: modelId(this.cfg), indexedSha: await this.currentIndexedSha(), appliedFilter: filter };
  }

  // ---- similar-docs ----------------------------------------------------
  async similarDocs(req: SimilarDocsRequest): Promise<SimilarDocsResponse> {
    if ((req.text && req.path) || (!req.text && !req.path)) {
      throw new BadRequest("provide exactly one of `text` or `path`");
    }
    const topK = req.topK ?? 10;
    const groupBy = req.groupBy ?? "doc";
    const minScore = req.minScore ?? 0.5;
    const filter = withStatusDefault(req.filter);

    let vec: number[];
    let selfPath: string | undefined;
    if (req.path) {
      selfPath = req.path;
      const pts = await this.store.getByPath(req.path);
      if (pts.length === 0) throw new NotFound(`no indexed chunks for path ${req.path}`);
      // centroid of the doc's chunk vectors
      vec = centroid(pts.map((p) => p.vector));
    } else {
      vec = await this.embedder.embed(req.text!);
    }

    const raw = await this.store.search(vec, topK * 4, filter, 0);
    let scored = raw.filter((p) => matchesFilter(p.metadata, filter));
    if (selfPath) scored = scored.filter((p) => p.metadata.path !== selfPath);

    let results;
    if (groupBy === "doc") {
      const best = new Map<string, ScoredPoint>();
      for (const p of scored) {
        const cur = best.get(p.metadata.path);
        if (!cur || p.score > cur.score) best.set(p.metadata.path, p);
      }
      results = [...best.values()].sort((a, b) => b.score - a.score).slice(0, topK);
    } else {
      results = scored.slice(0, topK);
    }

    const top = results[0]?.score ?? 0;
    const verdict: "covered" | "partial" | "novel" =
      top >= 0.75 ? "covered" : top >= minScore ? "partial" : "novel";

    return {
      results: results.map((p) => ({
        score: round(p.score), chunkId: p.chunkId,
        bestHeading: groupBy === "doc" ? p.metadata.heading : undefined,
        text: p.text, metadata: p.metadata,
      })),
      coverageVerdict: verdict,
      model: modelId(this.cfg), indexedSha: await this.currentIndexedSha(),
    };
  }

  // ---- get-chunk / get-doc --------------------------------------------
  async getChunk(chunkId: string) {
    const p = await this.store.getByChunkId(chunkId);
    if (!p) throw new NotFound(`no chunk ${chunkId}`);
    return { chunkId: p.chunkId, text: p.text, metadata: p.metadata };
  }

  async getDoc(path: string, raw = false): Promise<Document> {
    const pts = await this.store.getByPath(path);
    if (pts.length === 0) throw new NotFound(`no indexed doc ${path}`);
    const docMeta = { ...pts[0].metadata, heading: pts[0].metadata.path.split("/").pop()! };
    const chunks = pts.map((p) => ({ chunkId: p.chunkId, text: p.text, metadata: p.metadata }));
    const doc: Document = { path, metadata: docMeta, chunks };
    if (raw) doc.rawMarkdown = chunks.map((c) => c.text).join("\n\n");
    return doc;
  }

  // ---- ops -------------------------------------------------------------
  async readyz(): Promise<Readiness> {
    const [qdrant, embedder, count] = await Promise.all([
      this.store.health(), this.embedder.health(), this.store.count().catch(() => 0),
    ]);
    const head = headSha(this.cfg.corpusRoot);
    const indexedSha = await this.currentIndexedSha();
    let status: Readiness["status"] = "ready";
    if (qdrant === "down" || embedder === "down") status = "down";
    else if (embedder === "loading") status = "degraded";
    else if (count === 0) status = "rebuilding";
    else if (indexedSha && head && indexedSha !== head) status = "degraded";
    return {
      status, indexedSha, headSha: head,
      chunkCount: count, model: modelId(this.cfg),
      dependencies: { qdrant, embedder },
    };
  }

  setIndexedSha(sha: string) { this.indexedSha = sha; }
}

export class NotFound extends Error {}
export class BadRequest extends Error {}

function withStatusDefault(f?: MetadataFilter): MetadataFilter {
  const out: MetadataFilter = { ...(f ?? {}) };
  if (!out.status || out.status.length === 0) out.status = DEFAULT_STATUS_FILTER;
  return out;
}

function centroid(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const sum = new Array(dim).fill(0);
  for (const v of vectors) for (let i = 0; i < dim; i++) sum[i] += v[i];
  return sum.map((x) => x / vectors.length);
}

function round(n: number): number { return Math.round(n * 10000) / 10000; }

function walk(dir: string, cb: (abs: string) => void): void {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    const abs = join(dir, e);
    let s;
    try { s = statSync(abs); } catch { continue; }
    if (s.isDirectory()) walk(abs, cb);
    else cb(abs);
  }
}
