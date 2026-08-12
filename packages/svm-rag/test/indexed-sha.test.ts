import { expect } from "chai";
import { MemoryStore } from "../src/store/memory.js";
import { RagEngine } from "../src/engine.js";
import { loadConfig } from "../src/config.js";

// #49: indexedSha must be PERSISTED with the index so it survives process boundaries
// (the CLI `ingest` and `serve` are separate processes) and restarts — the bug was that
// the live service reported indexedSha:"" because it was in-memory only.

// corpusRoot is this package dir (inside the git repo) so engine.readyz()'s headSha() works.
const cfg = loadConfig({ embedDim: 3, corpusRoot: process.cwd() });
const stubEmbedder = {
  embed: async () => [0, 0, 0],
  embedBatch: async (texts: string[]) => texts.map(() => [0, 0, 0]),
  health: async () => "ok" as const,
} as any;

describe("indexedSha persistence (#49)", () => {
  it("the store round-trips indexedSha", async () => {
    const s = new MemoryStore();
    expect(await s.getIndexedSha()).to.equal("");
    await s.setIndexedSha("abc123", 3);
    expect(await s.getIndexedSha()).to.equal("abc123");
  });

  it("readyz reports the sha persisted in the store, even on a fresh (boot) engine", async () => {
    const store = new MemoryStore();
    // simulate a SEPARATE process having ingested + persisted the sha:
    await store.setIndexedSha("deadbeefcafe", 3);
    // a fresh engine boots with an EMPTY in-memory value — it must still report the
    // persisted sha (this is the bug #49 fixes):
    const engine = new RagEngine(cfg, stubEmbedder, store);
    const r = await engine.readyz();
    expect(r.indexedSha).to.equal("deadbeefcafe");
  });

  it("search + similar-docs responses carry the persisted indexedSha", async () => {
    const store = new MemoryStore();
    await store.setIndexedSha("feedface", 3);
    const engine = new RagEngine(cfg, stubEmbedder, store);
    const s = await engine.search({ query: "anything" });
    expect(s.indexedSha).to.equal("feedface");
    const sim = await engine.similarDocs({ text: "anything" });
    expect(sim.indexedSha).to.equal("feedface");
  });

  it("a later persisted update is reflected (no stale in-memory cache)", async () => {
    const store = new MemoryStore();
    await store.setIndexedSha("v1", 3);
    const engine = new RagEngine(cfg, stubEmbedder, store);
    expect((await engine.readyz()).indexedSha).to.equal("v1");
    // a separate process advances the persisted sha while serve keeps running:
    await store.setIndexedSha("v2", 3);
    expect((await engine.readyz()).indexedSha).to.equal("v2");
  });
});
