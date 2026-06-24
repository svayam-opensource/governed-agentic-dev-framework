import { loadConfig } from "../config.js";
import { buildEngine } from "../factory.js";
import { createRestApp } from "./rest.js";

// Standalone REST server entrypoint (npm run serve).
async function main() {
  const cfg = loadConfig();
  const { engine, storeKind } = await buildEngine(cfg);
  // indexedSha is now PERSISTED with the index (#49): the engine hydrates it lazily
  // from the store on first use, so a clean restart reports the real sha without any
  // env. RAG_INDEXED_SHA remains an explicit override (break-glass / first boot only).
  if (process.env.RAG_INDEXED_SHA) engine.setIndexedSha(process.env.RAG_INDEXED_SHA);
  const app = createRestApp(engine);
  app.listen(cfg.port, cfg.bindHost, () => {
    process.stderr.write(`[svm-rag] REST on http://${cfg.bindHost}:${cfg.port}/rag/v1  store=${storeKind}  model=${cfg.embedModel}@${cfg.embedDim}\n`);
  });
}
main().catch((e) => { console.error(e); process.exit(1); });
