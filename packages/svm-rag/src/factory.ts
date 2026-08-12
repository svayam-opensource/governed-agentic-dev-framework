import type { RagConfig } from "./config.js";
import { OllamaEmbedder } from "./embed/ollama.js";
import type { VectorStore } from "./store/store.js";
import { QdrantStore } from "./store/qdrant.js";
import { MemoryStore } from "./store/memory.js";
import { RagEngine } from "./engine.js";

export interface BuiltEngine {
  engine: RagEngine;
  store: VectorStore;
  storeKind: "qdrant" | "memory";
}

/** Probe Qdrant; fall back to the in-memory store if unreachable. */
export async function buildEngine(cfg: RagConfig, opts: { forceMemory?: boolean } = {}): Promise<BuiltEngine> {
  const embedder = new OllamaEmbedder(cfg.embedModel, cfg.embedDim, cfg.ollamaUrl);

  let store: VectorStore = new MemoryStore();
  if (!opts.forceMemory) {
    const q = new QdrantStore(cfg.qdrantUrl, cfg.qdrantCollection);
    if (await qdrantReachable(cfg.qdrantUrl)) {
      store = q;
    }
  }
  const engine = new RagEngine(cfg, embedder, store);
  return { engine, store, storeKind: store.kind };
}

async function qdrantReachable(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/healthz`).catch(() => fetch(`${baseUrl}/`));
    return !!res && res.ok;
  } catch {
    return false;
  }
}
