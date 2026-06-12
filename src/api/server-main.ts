import { loadConfig } from "../config.js";
import { buildEngine } from "../factory.js";
import { createRestApp } from "./rest.js";

// Standalone REST server entrypoint (npm run serve).
async function main() {
  const cfg = loadConfig();
  const { engine, storeKind } = await buildEngine(cfg);
  // adopt current corpus HEAD as indexedSha if the store already has data
  engine.setIndexedSha(process.env.RAG_INDEXED_SHA ?? "");
  const app = createRestApp(engine);
  app.listen(cfg.port, "127.0.0.1", () => {
    process.stderr.write(`[svm-rag] REST on http://127.0.0.1:${cfg.port}/rag/v1  store=${storeKind}  model=${cfg.embedModel}@${cfg.embedDim}\n`);
  });
}
main().catch((e) => { console.error(e); process.exit(1); });
