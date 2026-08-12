// Contract types — mirror rag-openapi.yaml components.schemas and rag-mcp-tools.json.
// G0-FROZEN. Field names match the OpenAPI exactly.

export type Domain =
  | "policies" | "legal" | "architecture/system" | "architecture/data"
  | "development" | "testing" | "deployment" | "infrastructure"
  | "support" | "compliance" | "navigation";

export type Layer =
  | "mandate" | "procedure" | "pattern" | "use-case" | "spec"
  | "compliance" | "path" | "decision";

export type Compliance =
  | "C01" | "C02" | "C03" | "instructional" | "descriptive" | "evidence";

export type Status = "current" | "draft" | "superseded" | "active";

// The 9 real Owner-role slugs (roles.generated.yaml). compliance-domain => policy-owner.
export type DomainOwner =
  | "policy-owner" | "legal-owner" | "infrastructure-owner"
  | "system-architecture-owner" | "data-architecture-owner"
  | "development-owner" | "testing-quality-owner"
  | "deployment-release-owner" | "support-owner";

export const DOMAIN_OWNERS: DomainOwner[] = [
  "policy-owner", "legal-owner", "infrastructure-owner",
  "system-architecture-owner", "data-architecture-owner",
  "development-owner", "testing-quality-owner",
  "deployment-release-owner", "support-owner",
];

// domain -> accountable owner (roles.generated.yaml accountable_domain, inverted).
export const DOMAIN_TO_OWNER: Record<string, DomainOwner> = {
  policies: "policy-owner",
  legal: "legal-owner",
  infrastructure: "infrastructure-owner",
  "architecture/system": "system-architecture-owner",
  "architecture/data": "data-architecture-owner",
  development: "development-owner",
  testing: "testing-quality-owner",
  deployment: "deployment-release-owner",
  support: "support-owner",
  // org-rollup domains owned by the Policy Owner (contract resolution):
  compliance: "policy-owner",
  navigation: "policy-owner",
};

export interface NavFacets {
  dimensions?: Record<string, string[]>;
  roleLenses?: string[];
  journeys?: string[];
}

export interface ChunkMetadata {
  path: string;
  heading: string;
  headingSlug?: string;
  anchor?: string;
  commitSha: string;
  domainOwner: string;
  domain: string;
  layer: string;
  compliance?: string;
  status?: string;
  navFacets?: NavFacets;
  project?: string | null;
  lineStart?: number;
  lineEnd?: number;
}

export interface Chunk {
  chunkId: string;
  text: string;          // self-containment-prefixed text used for embedding + retrieval
  body: string;          // raw section body (no prefix) for /docs reconstruction
  metadata: ChunkMetadata;
}

export interface MetadataFilter {
  domain?: string[];
  layer?: string[];
  domainOwner?: string[];
  compliance?: string[];
  status?: string[];
  roleLens?: string[];
  navFacets?: Record<string, string[]>;
  pathPrefix?: string[];
  project?: string[];
}

export interface SearchRequest {
  query: string;
  topK?: number;
  filter?: MetadataFilter;
  minScore?: number;
  includeText?: boolean;
}

export interface Hit {
  chunkId: string;
  score: number;
  text?: string | null;
  metadata: ChunkMetadata;
}

export interface SearchResponse {
  hits: Hit[];
  model: string;
  indexedSha: string;
  appliedFilter?: MetadataFilter;
}

export interface SimilarDocsRequest {
  text?: string;
  path?: string;
  topK?: number;
  groupBy?: "chunk" | "doc";
  filter?: MetadataFilter;
  minScore?: number;
}

export interface SimilarDoc {
  score: number;
  chunkId?: string;
  bestHeading?: string;
  text?: string | null;
  metadata: ChunkMetadata;
}

export interface SimilarDocsResponse {
  results: SimilarDoc[];
  coverageVerdict?: "covered" | "partial" | "novel";
  model: string;
  indexedSha: string;
}

export interface Document {
  path: string;
  metadata: ChunkMetadata;
  chunks: { chunkId: string; text: string; metadata: ChunkMetadata }[];
  rawMarkdown?: string | null;
}

export interface IngestRequest {
  mode?: "incremental" | "full";
  paths?: string[];
  sinceSha?: string;
  sourceSha?: string;
  prune?: boolean;
}

export interface IngestJob {
  jobId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  mode?: "incremental" | "full";
  sourceSha?: string;
  filesProcessed?: number;
  chunksUpserted?: number;
  chunksDeleted?: number;
  startedAt?: string;
  finishedAt?: string | null;
  error?: string | null;
}

export interface Readiness {
  status: "ready" | "degraded" | "rebuilding" | "down";
  indexedSha?: string;
  headSha?: string;
  chunkCount?: number;
  model?: string;
  dependencies: {
    qdrant?: "ok" | "down";
    embedder?: "ok" | "loading" | "down";
  };
}
