// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * F68 (Policy Owner, RULED A 2026-11-16): `gov signal`'s writes to the tracker — create, comment, close — survive a
 * brief GitHub hiccup. A write that fails with a transient error (the port's `retryable`: 5xx, 429 / rate limit,
 * the network) is tried again up to 3 times, after ~2 s, 4 s and 8 s. BEFORE each retry gov checks whether the
 * failed attempt went through after all, so nothing is ever made twice:
 *
 * - create  — the body carries a one-off `<!-- gov-write <id> -->` line; the repository's newest items are read
 *             directly (`recent`, no search-index lag) for it
 * - comment — the text carries the same kind of line; the item's comments are read (`comments`) for it
 * - close   — the item is read; closed means done
 *
 * A tracker that cannot answer the check (no `recent` / `comments`) is not retried for that write — a duplicate is
 * worse than a clear failure. A permanent refusal (404, 422, a permission 403) is returned at once. After the last
 * try the failure says how many attempts were made; the caller says what was saved and how to finish by hand.
 *
 * ```mermaid
 * flowchart LR
 *   W["write"] -->|ok| D["done"]
 *   W -->|"4xx"| F["fail now"]
 *   W -->|"transient"| S["wait 2/4/8 s"] --> C{"landed?"}
 *   C -->|yes| D
 *   C -->|"no"| W
 *   C -->|"cannot tell"| F
 * ```
 */
import { randomBytes } from "node:crypto";
import { fail, ok, type Result } from "../ports/result.js";
import type { WorkTrackerPort } from "../ports/work-tracker.js";

/** The pauses before each retry (ms). Three retries, four attempts in all. */
export const SIGNAL_RETRY_DELAYS_MS: readonly number[] = [2000, 4000, 8000];

export interface RetryOptions {
  /** Injectable for tests (instant). Default: a real timer. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Default {@link SIGNAL_RETRY_DELAYS_MS}. */
  readonly delays?: readonly number[];
  /** Default: 12 random hex characters. */
  readonly id?: () => string;
}

/** The hidden line that lets gov recognise its own write. */
export const writeMarker = (id: string): string => `<!-- gov-write ${id} -->`;

type Landed<T> = () => Promise<Result<{ readonly value: T } | null>>;

async function retrying<T>(attempt: () => Promise<Result<T>>, landed: Landed<T> | null, delays: readonly number[], sleep: (ms: number) => Promise<void>): Promise<Result<T>> {
  let r = await attempt();
  let tries = 1;
  for (const pause of delays) {
    if (r.ok || !r.retryable) return r;
    if (!landed) return fail(`${r.reason} (not retried: gov cannot check whether it went through)`, true);
    await sleep(pause);
    const l = await landed();
    if (!l.ok) return fail(`${r.reason} (not retried: could not check whether it went through — ${l.reason})`, true);
    if (l.value) return ok(l.value.value);
    r = await attempt();
    tries++;
  }
  return r.ok ? r : fail(`${r.reason} (tried ${tries} times)`, r.retryable);
}

/** The same tracker, with create / comment / close retried as above. Every other call passes straight through. */
export function retryingTracker(t: WorkTrackerPort, o: RetryOptions = {}): WorkTrackerPort {
  const delays = o.delays ?? SIGNAL_RETRY_DELAYS_MS;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)));
  const newId = o.id ?? (() => randomBytes(6).toString("hex"));
  const recent = t.recent?.bind(t), comments = t.comments?.bind(t);
  return {
    ...t,   // every other call passes straight through (the adapters are closures, not `this`-bound)

    create(where, item, onto) {
      const m = writeMarker(newId());
      const marked = { ...item, body: `${item.body}\n\n${m}` };
      const landed: Landed<{ url: string }> | null = recent
        ? async () => {
            const r = await recent(where, item.labels ?? []);
            if (!r.ok) return r;
            const hit = r.value.find((x) => x.body.includes(m));
            return ok(hit ? { value: { url: hit.ref.url } } : null);
          }
        : null;
      return retrying(() => t.create(where, marked, onto), landed, delays, sleep);
    },

    comment(i, text) {
      if (!text.trim()) return t.comment(i, text);
      const m = writeMarker(newId());
      const landed: Landed<void> | null = comments
        ? async () => {
            const r = await comments(i);
            if (!r.ok) return r;
            return ok(r.value.some((c) => c.includes(m)) ? { value: undefined } : null);
          }
        : null;
      return retrying(() => t.comment(i, `${text}\n\n${m}`), landed, delays, sleep);
    },

    close(i) {
      const landed: Landed<void> = async () => {
        const r = await t.item(i);
        if (!r.ok) return r;
        return ok(r.value.state === "closed" ? { value: undefined } : null);
      };
      return retrying(() => t.close(i), landed, delays, sleep);
    },
  };
}
