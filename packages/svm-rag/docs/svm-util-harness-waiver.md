# Waiver — `@svayam/svm-rag` HTTP surface off the `svm-util` harness

- **Status:** Granted (conscious exception, not drift)
- **Date:** 2026-06-23
- **Decision owner:** platform/standards owner (rkant@svayam.ai)
- **Issue:** [911 #91](https://github.com/Svayamtech/911-SVM-LIB-SVC/issues/91)
- **Project:** PRJ-014-knowledge-app-backlog · see `decisions.md` DEC-002
- **Scope:** `@svayam/svm-rag` (`knowledge-api`) only. Does **not** relax the
  `svm-util` convention for IAM, support, or any DB-backed HTTP application.

## Decision

`@svayam/svm-rag`'s HTTP/transport surface **will not adopt the `@svayam/svm-util`
harness**. The divergence is recorded here as a **deliberate exception** with
**compliance-equivalent guarantees** (below) that `svm-rag` must meet on its own.

## Why the harness is the wrong abstraction here

`svm-util` is an **HTTP/Express + JWT + DB application** harness. `svm-rag` is a
**loopback, DB-less, auth-at-edge, dual-transport (REST + MCP) embedding library**.
The core assumptions of the harness do not hold for this service:

1. **Dual transport — the decisive reason.** `svm-rag` exposes both a REST API
   (`rest.ts`) and an **MCP server over stdio** (`mcp/server.ts`, 6 tools), sharing
   one `RagEngine`. `svm-util` is **strictly Express/HTTP** — it has no notion of
   MCP/stdio/SSE. MCP would sit *outside* the harness regardless, so migration
   cannot unify the transports; it would yield REST-under-harness **+**
   MCP-standalone = *more* surface inconsistency, not less.
2. **Config model clash.** `svm-util` mandates **file-based JSON + AJV** with a
   fixed schema (`API_CONFIG`/`DATABASE`/`JWT`/`DOC`/`COMM`). `svm-rag` is
   configured by env (Ollama/Qdrant URLs, embed model/dim, corpus root, bind host)
   and has **no DB, no JWT, no uploads, no comms** — the schema does not apply.
3. **Auth model clash.** `svm-util` auth is JWT-bearer + DB + `verifyPrincipal`.
   `svm-rag` is **loopback-bound** (`127.0.0.1`) and delegates authentication to
   the **Apache edge (Authentik OIDC, POL-101)**. There is no in-process auth to
   migrate.
4. **Readiness regression risk.** `svm-rag`'s `/readyz` probes Qdrant + the
   embedder and reports **`indexedSha` vs `headSha`** — semantics the publish
   pipeline ([#49]) depends on. `svm-util`'s `/health` is a DB `SELECT 1`;
   adopting it would *weaken* readiness.
5. **Frozen API contract.** REST responses follow `rag-openapi.yaml`
   (`{ error: <code>, message }`). `svm-util`'s envelope is `{ error: <bool>, data }`
   — adopting it would break the frozen contract that clients and `close-knowledge`
   dedup rely on.

## Compliance-equivalent guarantees (the price of the waiver)

The point of the `svm-util` convention — config discipline, structured logging,
health/readiness, error envelopes, security, graceful shutdown — still binds.
`svm-rag` must meet each **standalone**:

| Guarantee | Status | Note / gap to close |
|---|---|---|
| **Health/readiness** | ✅ Met (exceeds) | `/rag/v1/healthz` + `/rag/v1/readyz` (dependency-aware + `indexedSha`/`headSha`). |
| **Error envelopes** | ✅ Met | Central `wrap()` → `{error, message}` per `rag-openapi.yaml`; typed `NotFound`/`BadRequest`/500. |
| **Auth / network posture** | ✅ Met (by design) | Loopback bind + edge OIDC (POL-101). Documented, not absent. |
| **Config discipline** | ⚠️ Gap | Env-only with **no validation**. Close: add startup schema validation + fail-fast on bad/missing required vars. |
| **Structured logging** | ⚠️ Gap | Bare `stderr`/`console`. Close: adopt a structured (JSON-line) logger with levels; keep stdout clean for MCP framing. |
| **Graceful shutdown** | ⚠️ Gap | No `SIGTERM`/`SIGINT` handling. Close: drain HTTP server + close store/embedder handles on signal. |

The three ⚠️ gaps are tracked as a **hardening punch-list** in
[911 #103](https://github.com/Svayamtech/911-SVM-LIB-SVC/issues/103) (Thread A) and
must be closed for the waiver to remain in good standing. They are **independent
of `svm-util`** — closing them does not require the harness. #103 Thread B also
asks whether `svm-util` should *evolve* a transport-agnostic core (MCP/stdio) and
a lighter config profile — if it does, this waiver is re-evaluated (see below).

## Review / expiry

Re-evaluate this waiver if **any** becomes true:
- `svm-util` gains a transport-agnostic core (first-class MCP/stdio), **or**
- `svm-rag` gains DB-backed state or in-process IAM/route-composition needs, **or**
- the three hardening gaps remain open beyond the next knowledge platform cycle.

## Graduation

`knowledge/` is read-only during an active project (POL-086). At PRJ-014
knowledge-close, propose this as a formal **development-domain exception**
(`knowledge/policies/exceptions/development/`) so the conscious exception is
durable org record, not just a repo-local note.
