import express, { type Express, type Request, type Response } from "express";
import type { RagEngine } from "../engine.js";
import { NotFound, BadRequest } from "../engine.js";

// REST surface per rag-openapi.yaml. Auth (Authentik OIDC bearer) is enforced at
// the Apache edge in prod (POL-101); local dev is bearer-optional per the spec's
// localhost server. /healthz + /readyz are unauthenticated.

export function createRestApp(engine: RagEngine, version = "0.1.0"): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
    (req: Request, res: Response) => {
      fn(req, res).catch((e) => {
        if (e instanceof NotFound) return res.status(404).json({ error: "not_found", message: e.message });
        if (e instanceof BadRequest) return res.status(400).json({ error: "bad_request", message: e.message });
        return res.status(500).json({ error: "internal", message: String(e?.message ?? e) });
      });
    };

  app.post("/rag/v1/search", wrap(async (req, res) => {
    if (!req.body?.query) return void res.status(400).json({ error: "bad_request", message: "query required" });
    res.json(await engine.search(req.body));
  }));

  app.post("/rag/v1/similar-docs", wrap(async (req, res) => {
    res.json(await engine.similarDocs(req.body ?? {}));
  }));

  app.get("/rag/v1/chunks/:chunkId", wrap(async (req, res) => {
    res.json(await engine.getChunk(String(req.params.chunkId)));
  }));

  app.get("/rag/v1/docs", wrap(async (req, res) => {
    const path = String(req.query.path ?? "");
    if (!path) return void res.status(400).json({ error: "bad_request", message: "path required" });
    res.json(await engine.getDoc(path, req.query.raw === "true"));
  }));

  app.post("/rag/v1/ingest", wrap(async (req, res) => {
    const job = await engine.ingest(req.body ?? {});
    res.status(202).json(job);
  }));

  app.get("/rag/v1/ingest/jobs/:jobId", wrap(async (req, res) => {
    const job = engine.getIngestJob(String(req.params.jobId));
    if (!job) return void res.status(404).json({ error: "not_found", message: "no such job" });
    res.json(job);
  }));

  app.get("/rag/v1/healthz", (_req, res) => { res.json({ status: "ok", version }); });

  app.get("/rag/v1/readyz", wrap(async (_req, res) => {
    const r = await engine.readyz();
    res.status(r.status === "down" ? 503 : 200).json(r);
  }));

  return app;
}
