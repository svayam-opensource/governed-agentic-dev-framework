// Runtime config — all overridable by env. Defaults chosen for LOCAL dev
// (loopback Qdrant, local Ollama). No corpus egress.

export interface RagConfig {
  corpusRoot: string;        // absolute path to the git repo whose knowledge/ is indexed
  repoRootRelBase: string;   // prefix used to make `path` repo-root-relative (usually "")
  includeProjectKnowledge: boolean;
  ollamaUrl: string;
  embedModel: string;
  embedDim: number;
  qdrantUrl: string;
  qdrantCollection: string;
  port: number;
  bindHost: string;          // listen address; 127.0.0.1 for local dev, 0.0.0.0 in a container
}

const SVM_WORK = "/Users/rkant/.svm/projects/PRJ-010-practice-knowledge/svm-prj-work";

export function loadConfig(overrides: Partial<RagConfig> = {}): RagConfig {
  return {
    corpusRoot: process.env.RAG_CORPUS_ROOT ?? SVM_WORK,
    repoRootRelBase: process.env.RAG_PATH_BASE ?? "",
    includeProjectKnowledge: (process.env.RAG_INCLUDE_PROJECT ?? "false") === "true",
    ollamaUrl: process.env.OLLAMA_URL ?? "http://127.0.0.1:11434",
    embedModel: process.env.RAG_EMBED_MODEL ?? "nomic-embed-text",
    embedDim: Number(process.env.RAG_EMBED_DIM ?? 768),
    qdrantUrl: process.env.QDRANT_URL ?? "http://127.0.0.1:6333",
    qdrantCollection: process.env.QDRANT_COLLECTION ?? "svayam_knowledge",
    port: Number(process.env.RAG_PORT ?? 8080),
    // Loopback by default (local dev / single-host). In the chinhut container set
    // RAG_BIND_HOST=0.0.0.0 so the published VPC port reaches the listener; the
    // host-side port-map (deploy/knowledge) restricts exposure to the VPC IP.
    bindHost: process.env.RAG_BIND_HOST ?? "127.0.0.1",
    ...overrides,
  };
}

// model id echoed on responses, e.g. "nomic-embed-text@768"
export function modelId(cfg: RagConfig): string {
  return `${cfg.embedModel}@${cfg.embedDim}`;
}
