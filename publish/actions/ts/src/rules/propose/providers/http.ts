// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * ONE POST TO A MODEL API, RETRIED — shared by the `anthropic` and `gemini` providers.
 *
 * Retries 408, 409, 429, every 5xx and a request that never reached the provider, honouring `retry-after` and
 * otherwise backing off 1s, 2s, 4s… Any other status is final. Returns the body of the first 2xx reply.
 *
 * THE KEY. The caller passes it as `secret` so it can be scrubbed: it never reaches a log line or an error
 * message, even when the provider (or a network error) echoes it back.
 */
import { log as defaultLog } from "../../../log.js";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

/** The shape of gov's `log` — a provider may be handed another one (a test's) in its place. */
export type LogFn = (level: "error" | "warn" | "info" | "debug", msg: string, pgm: string, fn: string, meta?: unknown) => void;

export class ModelProviderError extends Error {}

const RETRYABLE = (s: number): boolean => s === 408 || s === 409 || s === 429 || s >= 500;

export interface RetryingPost {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
  /** "the Anthropic API", "the Gemini API" — for the error messages. */
  readonly api: string;
  readonly secret: string;
  readonly pgm: string;
  /** The API's error body → one readable line. */
  readonly errorMessage: (text: string) => string;
  readonly fetch?: FetchLike;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly retries?: number;
  readonly log?: LogFn;
}

/** `text` with every occurrence of `secret` replaced. */
export function scrub(text: string, secret: string): string {
  return secret ? text.split(secret).join("[redacted]") : text;
}

export async function postWithRetry(o: RetryingPost): Promise<string> {
  const doFetch: FetchLike = o.fetch ?? ((url, init) => fetch(url, init));
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = o.log ?? defaultLog;
  const retries = o.retries ?? 2;
  for (let attempt = 0; ; attempt++) {
    let status: number, text: string, retryAfter: string | null;
    try {
      const res = await doFetch(o.url, { method: "POST", headers: o.headers, body: o.body });
      status = res.status;
      retryAfter = res.headers.get("retry-after");
      text = await res.text();
    } catch (e) {
      const why = scrub((e as Error)?.message ?? String(e), o.secret);
      log("warn", "model request failed to reach the provider", o.pgm, "complete", { attempt, error: why });
      if (attempt < retries) { await sleep(1000 * 2 ** attempt); continue; }
      throw new ModelProviderError(`could not reach ${o.api}: ${why}`);
    }
    if (status >= 200 && status < 300) return text;
    log("warn", "model request refused by the provider", o.pgm, "complete", { attempt, status });
    if (RETRYABLE(status) && attempt < retries) {
      const s = Number(retryAfter);
      await sleep(Number.isFinite(s) && s > 0 ? s * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    throw new ModelProviderError(scrub(`${o.api} answered ${status}: ${o.errorMessage(text)}`, o.secret));
  }
}
