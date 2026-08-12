import { expect } from "chai";
import { handleMessage } from "../src/mcp/server.js";
import { TOOLS } from "../src/mcp/tools.js";
import { RagEngine } from "../src/engine.js";
import { MemoryStore } from "../src/store/memory.js";
import { loadConfig } from "../src/config.js";
import type { Embedder } from "../src/embed/ollama.js";

// Deterministic fake embedder: hashes text to a small fixed-dim vector. No Ollama.
const fakeEmbedder: Embedder = {
  model: "fake", dim: 8,
  async embed(t: string) {
    const v = new Array(8).fill(0);
    for (let i = 0; i < t.length; i++) v[i % 8] += t.charCodeAt(i) / 1000;
    return v;
  },
  async embedBatch(ts: string[]) { return Promise.all(ts.map((t) => this.embed(t))); },
  async health() { return "ok"; },
};

function engineWithData(): RagEngine {
  const store = new MemoryStore();
  const cfg = loadConfig({ embedModel: "fake", embedDim: 8 });
  const eng = new RagEngine(cfg, fakeEmbedder, store);
  return eng;
}

describe("MCP server (1:1 REST wrappers)", () => {
  it("exposes exactly the six contract tools with the contract names", async () => {
    const eng = engineWithData();
    const res = await handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }, eng);
    const names = (res!.result as any).tools.map((t: any) => t.name).sort();
    expect(names).to.deep.equal(
      ["kb_get_chunk", "kb_get_doc", "kb_ingest", "kb_search", "kb_similar_docs", "kb_status"],
    );
  });

  it("each tool input schema enumerates the 9 real domainOwner slugs", () => {
    for (const t of TOOLS) {
      const f = (t.inputSchema as any).properties?.filter;
      if (!f) continue;
      const enumVals = f.properties.domainOwner.items.enum;
      expect(enumVals).to.include("testing-quality-owner");
      expect(enumVals).to.include("deployment-release-owner");
      expect(enumVals).to.have.length(9);
    }
  });

  it("initialize advertises the svayam-knowledge server", async () => {
    const eng = engineWithData();
    const res = await handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize" }, eng);
    expect((res!.result as any).serverInfo.name).to.equal("svayam-knowledge");
  });

  it("kb_status maps to readyz", async () => {
    const eng = engineWithData();
    const res = await handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "kb_status", arguments: {} } }, eng);
    const out = (res!.result as any).structuredContent;
    expect(out).to.have.property("status");
    expect(out).to.have.property("dependencies");
  });

  it("kb_search dispatches to engine.search and returns hits", async () => {
    const store = new MemoryStore();
    const cfg = loadConfig({ embedModel: "fake", embedDim: 8 });
    const eng = new RagEngine(cfg, fakeEmbedder, store);
    await store.upsert([{
      chunkId: "a".repeat(40), vector: await fakeEmbedder.embed("deployment release pipeline cicd"),
      text: "release pipeline",
      metadata: { path: "knowledge/deployment/specs/cicd.md", heading: "Pipeline", commitSha: "x",
        domainOwner: "deployment-release-owner", domain: "deployment", layer: "spec", status: "current",
        navFacets: { roleLenses: ["deployment-release-owner"] } },
    }]);
    const res = await handleMessage({ jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "kb_search", arguments: { query: "deployment release pipeline cicd", topK: 5 } } }, eng);
    const out = (res!.result as any).structuredContent;
    expect(out.hits.length).to.equal(1);
    expect(out.hits[0].metadata.domainOwner).to.equal("deployment-release-owner");
  });

  it("returns a JSON-RPC error for an unknown tool", async () => {
    const eng = engineWithData();
    const res = await handleMessage({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "nope" } }, eng);
    expect(res!.error).to.not.equal(undefined);
  });
});
