// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE `gemini` PROVIDER — Google's generateContent API over `fetch` (Policy Owner, 2026-10-07).
 *
 * The same shape as the `anthropic` provider: raw HTTP, no SDK (gov's runtime dependencies are approved one by one),
 * and the model id is the ORG'S setting (`policies/governance.yaml`), never a default here.
 *
 * THE KEY. From the environment's `GEMINI_API_KEY` (in CI, the org secret of that name), else gov's credentials
 * store. Sent only as the `x-goog-api-key` header — never as `?key=` in the URL, where a proxy or an error could log
 * it — and never put in an error, a log line or a return value.
 *
 * The reply is untrusted text, handed back as-is: parse.ts checks it. Anything but a clean finish is an error, not a
 * reply ({@link ModelReplyRejected}): a reply cut off at the token limit (half a JSON proposal would only fail later
 * with a worse message), a refusal, a blocked prompt, no candidates at all.
 */
import { log as defaultLog } from "../../../log.js";
import type { ModelPort, ModelRequest } from "../model-port.js";
import { postWithRetry, ModelProviderError, type FetchLike, type LogFn } from "./http.js";

const PGM = "gov-work:rules:propose:gemini";
/** `${GEMINI_URL}/{model}:generateContent`. */
export const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
export const GEMINI_KEY_ENV = "GEMINI_API_KEY";

export interface GeminiOptions {
  readonly apiKey: string;
  /** The org's approved model id, e.g. as Google names it (`gemini-…`). */
  readonly model: string;
  readonly fetch?: FetchLike;
  readonly sleep?: (ms: number) => Promise<void>;
  /** `maxOutputTokens`. On a thinking model the thinking counts against it too. */
  readonly maxTokens?: number;
  /** Retries on 429, 5xx and network failures. */
  readonly retries?: number;
  readonly url?: string;
  readonly log?: LogFn;
}

/** Why a 200 reply is still not a reply. */
export type RejectedKind = "cut-off" | "refused" | "blocked" | "no-candidates" | "stopped";

export class ModelReplyRejected extends ModelProviderError {
  constructor(readonly kind: RejectedKind, readonly reason: string, message: string) { super(message); }
}

/** finishReason values that mean the model declined — or was stopped from — answering. */
const REFUSED = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "LANGUAGE"]);

export function geminiModel(o: GeminiOptions): ModelPort {
  const log = o.log ?? defaultLog;
  return {
    async complete(req: ModelRequest): Promise<string> {
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts: [{ text: req.user }] }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: o.maxTokens ?? 16000 },
      });
      const text = await postWithRetry({
        url: `${o.url ?? GEMINI_URL}/${encodeURIComponent(o.model)}:generateContent`,
        headers: { "content-type": "application/json", "x-goog-api-key": o.apiKey },
        body, api: "the Gemini API", secret: o.apiKey, pgm: PGM, errorMessage, log,
        ...(o.fetch ? { fetch: o.fetch } : {}), ...(o.sleep ? { sleep: o.sleep } : {}), ...(o.retries !== undefined ? { retries: o.retries } : {}),
      });
      return replyText(text, o.model, log);
    },
  };
}

function errorMessage(text: string): string {
  try {
    const e = (JSON.parse(text) as { error?: { status?: string; message?: string } }).error;
    if (e?.message) return `${e.status ?? "error"} — ${e.message}`;
  } catch {
    // Not JSON: show the start of it below.
  }
  return text.slice(0, 200);
}

interface GenerateContentReply {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

function replyText(text: string, model: string, log: LogFn): string {
  let msg: GenerateContentReply;
  try {
    msg = JSON.parse(text);
  } catch {
    throw new ModelProviderError("the Gemini API answered with something that is not JSON");
  }
  const blocked = msg.promptFeedback?.blockReason;
  if (blocked) throw new ModelReplyRejected("blocked", blocked, `the Gemini API blocked the request (${blocked}) — ${model} did not answer`);
  const c = msg.candidates?.[0];
  if (!c) throw new ModelReplyRejected("no-candidates", "", `${model} returned no answer (no candidates)`);
  const finish = c.finishReason ?? "STOP";
  if (finish === "MAX_TOKENS") throw new ModelReplyRejected("cut-off", finish, `${model}'s reply was cut off at the token limit (MAX_TOKENS)`);
  if (REFUSED.has(finish)) throw new ModelReplyRejected("refused", finish, `${model} declined to answer (${finish})`);
  if (finish !== "STOP") throw new ModelReplyRejected("stopped", finish, `${model} stopped before finishing its answer (${finish})`);
  const out = (c.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");
  if (!out.trim()) throw new ModelProviderError(`${model} answered with no text`);
  log("debug", "model replied", PGM, "complete", { model, chars: out.length, finish });
  return out;
}
