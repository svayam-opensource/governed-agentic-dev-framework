import type { RagEngine } from "../engine.js";

// The 6 MCP tools (rag-mcp-tools.json), each a thin wrapper over one engine op.
// Tool names + input shapes are byte-for-byte the contract. Returned as the
// `tools/list` payload and dispatched by `tools/call`.

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  call(args: any, engine: RagEngine): Promise<unknown>;
}

const MetadataFilterSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    domain: { type: "array", items: { type: "string" } },
    layer: { type: "array", items: { type: "string" } },
    domainOwner: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "policy-owner", "legal-owner", "infrastructure-owner",
          "system-architecture-owner", "data-architecture-owner",
          "development-owner", "testing-quality-owner",
          "deployment-release-owner", "support-owner",
        ],
      },
    },
    compliance: { type: "array", items: { type: "string" } },
    status: { type: "array", items: { type: "string" }, default: ["current"] },
    roleLens: { type: "array", items: { type: "string" } },
    navFacets: { type: "object", additionalProperties: { type: "array", items: { type: "string" } } },
    pathPrefix: { type: "array", items: { type: "string" } },
    project: { type: "array", items: { type: "string" } },
  },
};

export const TOOLS: McpTool[] = [
  {
    name: "kb_search",
    title: "Search org knowledge",
    description:
      "Semantically search the Svayam org-knowledge corpus and get back ranked, citable chunks (one '##' section each). CALL THIS when you need org context you do not already have. Returns each hit's text plus citation metadata. Use `filter` to scope by domain/layer/compliance/role-lens. Wraps POST /search.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        query: { type: "string", minLength: 1 },
        topK: { type: "integer", minimum: 1, maximum: 50, default: 8 },
        filter: MetadataFilterSchema,
        minScore: { type: "number", default: 0 },
        includeText: { type: "boolean", default: true },
      },
      required: ["query"],
    },
    call: (a, e) => e.search(a),
  },
  {
    name: "kb_similar_docs",
    title: "Find already-covered knowledge (dedup)",
    description:
      "Find the existing corpus chunks most similar to a candidate text or an existing doc. CALL THIS during close-knowledge to answer 'is this learning already covered?'. Provide EITHER `text` OR `path`. Returns nearest docs/chunks + a coverageVerdict (covered|partial|novel). Wraps POST /similar-docs.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        text: { type: "string" },
        path: { type: "string" },
        topK: { type: "integer", minimum: 1, maximum: 50, default: 10 },
        groupBy: { type: "string", enum: ["chunk", "doc"], default: "doc" },
        minScore: { type: "number", default: 0.5 },
        filter: MetadataFilterSchema,
      },
    },
    call: (a, e) => e.similarDocs(a),
  },
  {
    name: "kb_get_chunk",
    title: "Get one knowledge chunk",
    description:
      "Fetch one chunk (one '##' section) verbatim by its stable chunkId. CALL THIS to re-read a specific hit without re-querying. Wraps GET /chunks/{chunkId}.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { chunkId: { type: "string", pattern: "^[0-9a-f]{40}$" } },
      required: ["chunkId"],
    },
    call: (a, e) => e.getChunk(a.chunkId),
  },
  {
    name: "kb_get_doc",
    title: "Get a whole knowledge document",
    description:
      "Fetch a whole markdown document — all chunks in source order plus doc metadata — by repo-relative path. Wraps GET /docs.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { path: { type: "string" }, raw: { type: "boolean", default: false } },
      required: ["path"],
    },
    call: (a, e) => e.getDoc(a.path, a.raw ?? false),
  },
  {
    name: "kb_status",
    title: "Knowledge index status",
    description:
      "Report whether the retrieval index is ready and current (indexedSha vs headSha, chunkCount, model, dependency health). CALL THIS before a quality-sensitive flow; degrade on status != 'ready'. Wraps GET /readyz.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    call: (_a, e) => e.readyz(),
  },
  {
    name: "kb_ingest",
    title: "Trigger (re-)embedding",
    description:
      "Trigger (re-)embedding of the corpus. PRIVILEGED — requires ingest:write (CI / Infrastructure Owner). mode 'incremental' (changed files) or 'full' (rebuild). Wraps POST /ingest.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        mode: { type: "string", enum: ["incremental", "full"], default: "incremental" },
        paths: { type: "array", items: { type: "string" } },
        sinceSha: { type: "string" },
        sourceSha: { type: "string" },
        prune: { type: "boolean", default: true },
      },
    },
    call: (a, e) => e.ingest(a),
  },
];
