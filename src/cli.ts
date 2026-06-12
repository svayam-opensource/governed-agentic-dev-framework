import { loadConfig } from "./config.js";
import { buildEngine } from "./factory.js";
import { createRestApp } from "./api/rest.js";
import { runStdioServer } from "./mcp/server.js";
import { runBenchmark, loadGoldQueries } from "./eval/benchmark.js";
import { headSha } from "./ingest/git.js";

// Unified CLI. Subcommands: ingest | serve | mcp | eval | search | doc | status.
export async function main(argv: string[]): Promise<void> {
  const cmd = argv[0];
  const flags = parseFlags(argv.slice(1));
  const overrides: any = {};
  if (flags.has("include-projects")) overrides.includeProjectKnowledge = true;
  const cfg = loadConfig(overrides);
  if (flags.has("memory")) process.env.RAG_FORCE_MEMORY = "true";

  switch (cmd) {
    case "ingest": return cmdIngest(cfg, flags);
    case "serve": return cmdServe(cfg, flags);
    case "mcp": return cmdMcp(cfg);
    case "eval": return cmdEval(cfg, flags);
    case "search": return cmdSearch(cfg, flags, argv.slice(1));
    case "doc": return cmdDoc(cfg, flags);
    case "status": return cmdStatus(cfg);
    default:
      process.stderr.write(
        "svm-rag <ingest|serve|mcp|eval|search|doc|status> [--full] [--memory] [--include-projects] [--no-readme-exclude]\n",
      );
      process.exit(cmd ? 1 : 0);
  }
}

async function build(cfg: ReturnType<typeof loadConfig>) {
  return buildEngine(cfg, { forceMemory: process.env.RAG_FORCE_MEMORY === "true" });
}

async function cmdIngest(cfg: any, flags: Map<string, string | boolean>) {
  const { engine, storeKind } = await build(cfg);
  const includeIndexDocs = flags.has("no-readme-exclude");
  // CLI ingest is a full rebuild unless --since given (changed-files incremental).
  const since = flags.get("since");
  const t0 = Date.now();
  const job = typeof since === "string"
    ? await engine.ingest({ mode: "incremental", sinceSha: since }, { includeIndexDocs })
    : await engine.ingest({ mode: "full" }, { includeIndexDocs });
  const ms = Date.now() - t0;
  process.stdout.write(JSON.stringify({ store: storeKind, ...job, elapsedMs: ms }, null, 2) + "\n");
  if (job.status === "failed") process.exit(1);
}

async function cmdServe(cfg: any, _flags: Map<string, any>) {
  const { engine, storeKind } = await build(cfg);
  // best-effort: ensure something is indexed; if empty, run a full ingest first
  const r = await engine.readyz();
  if ((r.chunkCount ?? 0) === 0) {
    process.stderr.write("[svm-rag] empty index — running full ingest...\n");
    await engine.ingest({ mode: "full" });
  }
  engine.setIndexedSha(headSha(cfg.corpusRoot));
  const app = createRestApp(engine);
  app.listen(cfg.port, "127.0.0.1", () =>
    process.stderr.write(`[svm-rag] REST http://127.0.0.1:${cfg.port}/rag/v1 store=${storeKind}\n`));
}

async function cmdMcp(cfg: any) {
  const { engine } = await build(cfg);
  const r = await engine.readyz();
  if ((r.chunkCount ?? 0) === 0) await engine.ingest({ mode: "full" });
  engine.setIndexedSha(headSha(cfg.corpusRoot));
  runStdioServer(engine);
}

async function cmdEval(cfg: any, flags: Map<string, any>) {
  const { engine } = await build(cfg);
  const r = await engine.readyz();
  if ((r.chunkCount ?? 0) === 0) {
    await engine.ingest({ mode: "full" }, { includeIndexDocs: flags.has("no-readme-exclude") });
  }
  const goldPath = String(flags.get("gold") ??
    `${cfg.corpusRoot}/projects/PRJ-010-practice-knowledge/knowledge/design/rag-eval-queries.jsonl`);
  const gold = loadGoldQueries(goldPath);
  const result = await runBenchmark(engine, gold, 5);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

async function cmdSearch(cfg: any, flags: Map<string, any>, rest: string[]) {
  const { engine } = await build(cfg);
  const r = await engine.readyz();
  if ((r.chunkCount ?? 0) === 0) await engine.ingest({ mode: "full" });
  const query = rest.filter((a) => !a.startsWith("--")).join(" ");
  const filter: any = {};
  for (const k of ["domain", "layer", "domainOwner", "compliance", "status"]) {
    const v = flags.get(k);
    if (typeof v === "string") filter[k] = v.split(",");
  }
  const resp = await engine.search({
    query, topK: Number(flags.get("topK") ?? 8),
    filter: Object.keys(filter).length ? filter : undefined,
    includeText: flags.has("text"),
  });
  process.stdout.write(JSON.stringify(resp, null, 2) + "\n");
}

async function cmdDoc(cfg: any, flags: Map<string, any>) {
  const { engine } = await build(cfg);
  const path = String(flags.get("path") ?? "");
  process.stdout.write(JSON.stringify(await engine.getDoc(path, flags.has("raw")), null, 2) + "\n");
}

async function cmdStatus(cfg: any) {
  const { engine } = await build(cfg);
  process.stdout.write(JSON.stringify(await engine.readyz(), null, 2) + "\n");
}

function parseFlags(args: string[]): Map<string, string | boolean> {
  const m = new Map<string, string | boolean>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith("--")) { m.set(key, next); i++; }
    else m.set(key, true);
  }
  return m;
}
