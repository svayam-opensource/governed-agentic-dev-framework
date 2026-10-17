// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd. — part of the OSS governed-agentic-dev-framework.
/**
 * BUILDING EVIDENCE RECORDS (gov-evidence/1, spec 02 §3.1). Open gov defines what a record says and when one is
 * produced; only the paid module signs and writes it. A record names the rule, the verdict and a message KEY — never
 * code, a diff, file contents or finding prose.
 *
 * Records are built as DRAFTS without the org's numeric id: looking it up may need GitHub, and open gov makes no call
 * for evidence unless a module is running. {@link finalizeRecord} adds it at flush time — only then.
 */
import { randomBytes } from "node:crypto";
import type { EvidenceClass, EvidenceRecord, EvidenceVerdict, GapRecord, SessionRecord, VerdictRecord } from "./public.js";

type Env = Readonly<Record<string, string | undefined>>;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Draft<T> = T extends unknown ? Omit<T, "org"> & { org?: T extends { org: infer O } ? O : never } : never;
export type DraftRecord = Draft<VerdictRecord> | Draft<SessionRecord> | Draft<GapRecord>;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A ULID: 48-bit time + 80 random bits, Crockford base32. */
export function newUlid(now: number = Date.now(), rand: (n: number) => Uint8Array = (n) => randomBytes(n)): string {
  let t = now, time = "";
  for (let i = 0; i < 10; i++) { time = CROCKFORD[t % 32] + time; t = Math.floor(t / 32); }
  const r = rand(16);
  let out = "";
  for (let i = 0; i < 16; i++) out += CROCKFORD[r[i]! % 32];
  return time + out;
}

const safe = (s: string): string => s.replace(/[^A-Za-z0-9_.:@/+-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "") || "x";

/** A message KEY from an action and a verdict: `gov-builtin.list-membership.fail`. Never prose. */
export function messageKey(action: string, verdict: string): string {
  return `${action}.${verdict}`.toLowerCase().replace(/[^a-z0-9_.-]+/g, ".").replace(/^[^a-z0-9]+/, "").slice(0, 120) || "unknown";
}

/** What every record of one process shares: where it ran, which gov, the change it is about. */
export interface RunContext {
  readonly source: "ci" | "local";
  /** `gh:<run>:<attempt>` in CI, `local:<ulid>` on a machine — one per process. */
  readonly runPrefix: string;
  readonly govVersion: string;
  readonly repo?: { readonly id: number; readonly name: string };
  readonly ref?: { readonly sha: string; readonly branch?: string; readonly changeRequest?: number };
  readonly actor?: { readonly login?: string; readonly kind: "human" | "agent"; readonly agent?: string; readonly trailer?: "present" | "absent" };
  readonly orgIdFromEnv?: number;
}

let localPrefix: string | null = null;

/** The context from the environment: GitHub Actions' variables in CI, a per-process run id elsewhere. */
export function runContext(env: Env, govVersion: string): RunContext {
  const num = (v: string | undefined): number | undefined => (v && /^[1-9][0-9]*$/.test(v) ? Number(v) : undefined);
  if (env.GITHUB_ACTIONS === "true" || env.GITHUB_RUN_ID) {
    const repoId = num(env.GITHUB_REPOSITORY_ID);
    const sha = env.GITHUB_SHA && /^[0-9a-f]{40}$/.test(env.GITHUB_SHA) ? env.GITHUB_SHA : undefined;
    const login = env.GITHUB_ACTOR && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(\[bot\])?$/.test(env.GITHUB_ACTOR) ? env.GITHUB_ACTOR : undefined;
    const agent = env.GOV_AGENT;
    const ownerId = num(env.GITHUB_REPOSITORY_OWNER_ID);
    return {
      source: "ci",
      runPrefix: `gh:${safe(env.GITHUB_RUN_ID ?? "0")}:${safe(env.GITHUB_RUN_ATTEMPT ?? "1")}`,
      govVersion,
      ...(repoId && env.GITHUB_REPOSITORY ? { repo: { id: repoId, name: env.GITHUB_REPOSITORY } } : {}),
      ...(sha ? { ref: { sha, ...(env.GITHUB_REF_NAME ? { branch: env.GITHUB_REF_NAME.replace(/\s+/g, "-") } : {}) } } : {}),
      actor: { ...(login ? { login } : {}), kind: agent ? "agent" : "human", ...(agent ? { agent: safe(agent) } : {}), trailer: agent ? "present" : "absent" },
      ...(ownerId ? { orgIdFromEnv: ownerId } : {}),
    };
  }
  localPrefix ??= `local:${newUlid()}`;
  return { source: "local", runPrefix: localPrefix, govVersion };
}

const common = (ctx: RunContext, key: string) => ({
  schema: "gov-evidence/1" as const,
  id: newUlid(),
  ...(ctx.repo ? { repo: ctx.repo } : {}),
  ...(ctx.ref ? { ref: ctx.ref } : {}),
  ...(ctx.actor ? { actor: ctx.actor } : {}),
  source: ctx.source,
  runKey: `${ctx.runPrefix}:${key}`.slice(0, 300),
  at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  versions: { gov: safe(ctx.govVersion) },
});

export interface VerdictDraftInput {
  readonly kind: "check" | "gate" | "judge";
  readonly rule: { readonly id: string; readonly level?: "C01" | "C02" | "C03"; readonly rev?: string };
  readonly binding: { readonly resource: string; readonly event: string; readonly action: string };
  readonly verdict: EvidenceVerdict;
  readonly class: EvidenceClass;
}

export function verdictDraft(ctx: RunContext, v: VerdictDraftInput): DraftRecord {
  return {
    ...common(ctx, `${v.rule.id}:${v.binding.event}:${v.binding.action}`),
    kind: v.kind,
    rule: { id: v.rule.id, ...(v.rule.rev ? { rev: safe(v.rule.rev) } : {}), ...(v.rule.level ? { level: v.rule.level } : {}) },
    binding: { resource: safe(v.binding.resource), event: safe(v.binding.event), action: safe(v.binding.action) },
    verdict: v.verdict,
    class: v.class,
    messageKey: messageKey(v.binding.action, v.verdict),
  };
}

/** A session boundary; null when the project id is not a `PRJ-<n>…` id (nothing to name the session by). */
export function sessionDraft(s: { boundary: "start" | "end"; project: string; issue?: number; agent?: string; env: Env; govVersion?: string }): DraftRecord | null {
  const project = /^PRJ-\d+/i.exec(s.project)?.[0]?.toUpperCase();
  if (!project) return null;
  const ctx = runContext(s.env, s.govVersion ?? "0.0.0");
  const session = { project, ...(s.issue ? { issue: s.issue } : {}) };
  const base = common(ctx, `session:${project}:${s.boundary}`);
  return {
    ...base,
    kind: "session",
    boundary: s.boundary,
    session,
    ...(s.agent ? { actor: { ...(base.actor ?? {}), kind: "agent" as const, agent: safe(s.agent), trailer: base.actor?.trailer ?? "absent" } } : {}),
  };
}

/** The draft as a record: the org's numeric id added. */
export function finalizeRecord(d: DraftRecord, orgId: number): EvidenceRecord {
  const r = { ...d, org: { vcs: "github" as const, id: orgId } } as Mutable<EvidenceRecord>;
  return r as EvidenceRecord;
}
