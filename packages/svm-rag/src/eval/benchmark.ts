import { readFileSync } from "node:fs";
import type { RagEngine } from "../engine.js";

// §7 recall benchmark. Reads gold queries (jsonl), runs /search per query, and
// computes recall@1, recall@5, MRR — overall and broken down by the expected
// doc's layer. A query is "hit@k" if any expected_path appears in the top-k hits.

export interface GoldQuery {
  query: string;
  expected_paths: string[];      // 1+ acceptable authoritative docs
  layer?: string;                // for the mandate breakdown
  domain?: string;
}

export interface BenchmarkResult {
  total: number;
  recallAt1: number;
  recallAt5: number;
  mrr: number;
  byLayer: Record<string, { n: number; recallAt5: number; recallAt1: number }>;
  perQuery: { query: string; expected: string[]; rank: number | null; topPath?: string }[];
}

export function loadGoldQueries(path: string): GoldQuery[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//"))
    .map((l) => JSON.parse(l) as GoldQuery);
}

export async function runBenchmark(
  engine: RagEngine,
  gold: GoldQuery[],
  topK = 5,
): Promise<BenchmarkResult> {
  let hit1 = 0, hit5 = 0, rrSum = 0;
  const byLayer: Record<string, { n: number; h5: number; h1: number }> = {};
  const perQuery: BenchmarkResult["perQuery"] = [];

  for (const g of gold) {
    // benchmark searches without the default status filter masking expected docs,
    // but we still honor [current] default — gold set targets current docs.
    const resp = await engine.search({ query: g.query, topK });
    const paths = resp.hits.map((h) => h.metadata.path);
    let rank: number | null = null;
    for (let i = 0; i < paths.length; i++) {
      if (g.expected_paths.includes(paths[i])) { rank = i + 1; break; }
    }
    if (rank === 1) hit1++;
    if (rank !== null && rank <= topK) hit5++;
    if (rank !== null) rrSum += 1 / rank;

    const layer = g.layer ?? "unspecified";
    byLayer[layer] ??= { n: 0, h5: 0, h1: 0 };
    byLayer[layer].n++;
    if (rank === 1) byLayer[layer].h1++;
    if (rank !== null && rank <= topK) byLayer[layer].h5++;

    perQuery.push({ query: g.query, expected: g.expected_paths, rank, topPath: paths[0] });
  }

  const n = gold.length;
  const byLayerOut: BenchmarkResult["byLayer"] = {};
  for (const [k, v] of Object.entries(byLayer)) {
    byLayerOut[k] = {
      n: v.n,
      recallAt5: round(v.h5 / v.n),
      recallAt1: round(v.h1 / v.n),
    };
  }

  return {
    total: n,
    recallAt1: round(hit1 / n),
    recallAt5: round(hit5 / n),
    mrr: round(rrSum / n),
    byLayer: byLayerOut,
    perQuery,
  };
}

function round(n: number): number { return Math.round(n * 1000) / 1000; }
