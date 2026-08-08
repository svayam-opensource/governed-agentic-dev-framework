# @svayam/svm-rag — Svayam Knowledge Retrieval Service (RAG, Form 3)

PRJ-010 Track B (#40). A self-hosted RAG retrieval engine over the Svayam
org-knowledge corpus (`knowledge/` + optionally `projects/*/knowledge/`), for
coding agents (session-protocol §2) and the `close-knowledge` dedup step.

**No corpus egress.** Embeddings are computed locally via Ollama; the corpus
never leaves the host. Index/link/search ONLY over the single markdown source of
truth — never a second authored copy (POL-402, C01).

Implements the G0-frozen contracts:
- `rag-stack-decision.md` — `nomic-embed-text` (local Ollama) + Qdrant, per-`##`
  chunking, git-diff incremental re-embed, the §7 recall benchmark.
- `rag-api-contract.md` / `rag-openapi.yaml` — the REST surface + `ChunkMetadata`.
- `rag-mcp-tools.json` — the 6 MCP tools, 1:1 over the REST ops.

## Architecture

```
src/
  types.ts            contract types (ChunkMetadata, MetadataFilter, ...) — mirror the OpenAPI
  config.ts           env-driven config (corpus root, Ollama, Qdrant, model/dim)
  meta/frontmatter.ts front-matter parse (tolerant: strips inline comments), slug, chunkId
  meta/metadata.ts    front-matter -> ChunkMetadata; domain->owner mapping; navFacets
  chunk/chunker.ts    per-## section chunking + self-containment prefix + line spans
  chunk/exclude.ts    C1 index/journey-pollution exclusion (content-based, not blanket)
  embed/ollama.ts     local Ollama embeddings (/api/embed, truncate)
  store/store.ts      VectorStore interface + shared filter semantics + cosine
  store/qdrant.ts     real self-hosted Qdrant backend (HTTP API, no SDK)
  store/memory.ts     in-memory cosine fallback (same filter semantics)
  ingest/git.ts       git helpers: per-file last-commit (commitSha), changed-files diff
  engine.ts           RagEngine: ingest / search / similarDocs / getChunk / getDoc / readyz
  factory.ts          wires config -> embedder + store (Qdrant if reachable, else memory)
  api/rest.ts         Express REST app per rag-openapi.yaml
  api/server-main.ts  standalone REST server entrypoint
  mcp/tools.ts        the 6 MCP tools (1:1 REST wrappers)
  mcp/server.ts       dependency-free MCP server over stdio (JSON-RPC 2.0)
  eval/benchmark.ts   §7 recall@k / MRR harness
  eval/rag-eval-queries.jsonl   gold query set (grounded in the live corpus)
  cli.ts              unified CLI (ingest | serve | mcp | eval | search | doc | status)
bin/svm-rag.mjs       CLI shim (tsx in dev, node lib/ after build)
test/                 chunker, C1 exclusion, filter semantics, MCP — 26 tests (no Ollama/Qdrant)
```

## Run it

Prereqs: Node 20+, local Ollama with `nomic-embed-text` pulled. A local Qdrant is
optional — without it the engine falls back to an in-memory store that exercises
the same ingest→embed→store→query path.

```bash
# 1. (optional) stand up a local loopback Qdrant
docker compose -f deploy/local-rag/qdrant/docker-compose.yml up -d

# 2. install + build
npm install --workspace @svayam/svm-rag
npm run build  --workspace @svayam/svm-rag

# 3. full ingest of the corpus (164 docs -> chunks in Qdrant/memory)
npx tsx bin/svm-rag.mjs ingest --full

# 4. serve the REST API (loopback) — auto-ingests if the index is empty
RAG_PORT=8088 npx tsx bin/svm-rag.mjs serve
#   POST http://127.0.0.1:8088/rag/v1/search   etc.

# 5. MCP stdio server (for an agent)
npx tsx bin/svm-rag.mjs mcp

# 6. run the §7 recall benchmark
npx tsx bin/svm-rag.mjs eval --gold src/eval/rag-eval-queries.jsonl

# incremental re-embed of files changed since a merge sha (delete-by-path + re-upsert)
npx tsx bin/svm-rag.mjs ingest --since <sha>

# tear down the test Qdrant
docker compose -f deploy/local-rag/qdrant/docker-compose.yml down
```

Config via env: `RAG_CORPUS_ROOT`, `OLLAMA_URL`, `RAG_EMBED_MODEL`, `RAG_EMBED_DIM`,
`QDRANT_URL`, `QDRANT_COLLECTION`, `RAG_PORT`, `RAG_INCLUDE_PROJECT`.

## Auth

Internal-only (POL-101). In prod the REST + MCP-HTTP transports sit behind the
Authentik OIDC + gomtinagar Apache edge; `/healthz` + `/readyz` are unauthenticated;
`/ingest` needs the `ingest:write` scope. Local dev is bearer-optional (per the
OpenAPI localhost server).
