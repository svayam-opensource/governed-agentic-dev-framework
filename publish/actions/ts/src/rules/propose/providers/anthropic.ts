// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE `anthropic` PROVIDER — the Messages API over `fetch` (P3 wave 2).
 *
 * Raw HTTP, not the SDK: gov's runtime dependencies are approved one by one (js-yaml was the second), and one POST
 * does not earn a third. The model id is the ORG'S setting (`policies/governance.yaml`), never a default here.
 *
 * THE KEY. Taken from the caller (the environment's `ANTHROPIC_API_KEY`, or gov's credentials store), sent only
 * as the `x-api-key` header, and never put in an error, a log line or a return value.
 *
 * The reply is untrusted text, handed back as-is: parse.ts checks it. A refusal or a reply cut off at
 * `max_tokens` is an error, not a reply — half a JSON proposal would only fail later with a worse message.
 */
import { log } from "../../../log.js";
import type { ModelPort, ModelRequest } from "../model-port.js";
import { postWithRetry, ModelProviderError, type FetchLike } from "./http.js";

// Where the other modules (and the tests) have always found them.
export { ModelProviderError, type FetchLike } from "./http.js";

const PGM = "gov-work:rules:propose:anthropic";
export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
export const ANTHROPIC_KEY_ENV = "ANTHROPIC_API_KEY";

export interface AnthropicOptions {
  readonly apiKey: string;
  /** The org's approved model id. */
  readonly model: string;
  readonly fetch?: FetchLike;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly maxTokens?: number;
  /** Retries on 429, 5xx and network failures. */
  readonly retries?: number;
  readonly url?: string;
}

export function anthropicModel(o: AnthropicOptions): ModelPort {
  return {
    async complete(req: ModelRequest): Promise<string> {
      const body = JSON.stringify({
        model: o.model,
        max_tokens: o.maxTokens ?? 16000,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
      });
      const text = await postWithRetry({
        url: o.url ?? ANTHROPIC_URL,
        headers: { "content-type": "application/json", "anthropic-version": ANTHROPIC_VERSION, "x-api-key": o.apiKey },
        body, api: "the Anthropic API", secret: o.apiKey, pgm: PGM, errorMessage,
        ...(o.fetch ? { fetch: o.fetch } : {}), ...(o.sleep ? { sleep: o.sleep } : {}), ...(o.retries !== undefined ? { retries: o.retries } : {}),
      });
      return replyText(text, o.model);
    },
  };
}

function errorMessage(text: string): string {
  try {
    const e = (JSON.parse(text) as { error?: { type?: string; message?: string } }).error;
    if (e?.message) return `${e.type ?? "error"} — ${e.message}`;
  } catch {
    // Not JSON: show the start of it below.
  }
  return text.slice(0, 200);
}

function replyText(text: string, model: string): string {
  let msg: { content?: { type?: string; text?: string }[]; stop_reason?: string; stop_details?: { category?: string | null } | null };
  try {
    msg = JSON.parse(text);
  } catch {
    throw new ModelProviderError("the Anthropic API answered with something that is not JSON");
  }
  if (msg.stop_reason === "refusal") {
    throw new ModelProviderError(`${model} declined to answer${msg.stop_details?.category ? ` (${msg.stop_details.category})` : ""}`);
  }
  if (msg.stop_reason === "max_tokens") throw new ModelProviderError(`${model}'s reply was cut off at the token limit`);
  const out = (msg.content ?? []).filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text).join("");
  if (!out.trim()) throw new ModelProviderError(`${model} answered with no text`);
  log("debug", "model replied", PGM, "complete", { model, chars: out.length, stop: msg.stop_reason });
  return out;
}
