// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * READING AN EVENT'S PAYLOAD DEFENSIVELY (W6).
 *
 * `EventPayload` (contracts.ts) pins the fields every action shares. The fields only slice-2 actions read are
 * read HERE, by name and by type, until the orchestrator pins them: a field that is absent or of the wrong type is
 * `undefined`, and the action that needed it reports `cannot-tell` — never a pass.
 *
 *   forced         boolean                       push: was it a force-push (GitHub `push.forced`)
 *   commits        string[]                      push: the pushed commit shas (GitHub `push.commits[].id`)
 *   defaultBranch  string                        the repository's default branch, for `$default`
 *   baseTexts      Record<path, string | null>   pull_request: each changed file at the BASE (null = absent there)
 *   approvals      string[]                      pull_request: handles with an APPROVED review on the head commit
 *
 * Pure.
 */
import { matchesAny } from "../glob.js";
import type { EventContext } from "../model/contracts.js";

const raw = (ctx: EventContext, name: string): unknown => (ctx.payload as Readonly<Record<string, unknown>>)[name];

export const payloadString = (ctx: EventContext, name: string): string | undefined => {
  const v = raw(ctx, name);
  return typeof v === "string" && v !== "" ? v : undefined;
};
export const payloadBoolean = (ctx: EventContext, name: string): boolean | undefined => {
  const v = raw(ctx, name);
  return typeof v === "boolean" ? v : undefined;
};
export const payloadStrings = (ctx: EventContext, name: string): string[] | undefined => {
  const v = raw(ctx, name);
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? [...(v as string[])] : undefined;
};
export const payloadTextMap = (ctx: EventContext, name: string): Readonly<Record<string, string | null>> | undefined => {
  const v = raw(ctx, name);
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string | null>) : undefined;
};

/** A YAML list or a comma-separated string → a clean list. */
export const asList = (v: unknown): string[] =>
  v === undefined ? [] : (Array.isArray(v) ? v.map(String) : String(v).split(",")).map((s) => s.trim()).filter(Boolean);

/** A handle as compared: no `@`, lower case. */
export const handleKey = (h: string): string => h.trim().replace(/^@+/, "").toLowerCase();

/**
 * Is `branch` in scope of `patterns` (globs; `$default` = the default branch)? `null` when a pattern needs the
 * default branch and it is not known — the caller cannot tell.
 */
export function branchInScope(branch: string, patterns: readonly string[], defaultBranch: string | undefined): boolean | null {
  const resolved: string[] = [];
  for (const p of patterns) {
    if (p === "$default") {
      if (defaultBranch === undefined) return null;
      resolved.push(defaultBranch);
    } else resolved.push(p);
  }
  return matchesAny(branch, resolved);
}
