// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd. — part of the OSS governed-agentic-dev-framework.
/**
 * THE EVIDENCE SINK, AS OPEN GOV SEES IT (spec 02 §5). Every site that produces a record — a check run, a gov-verb
 * gate, a governed session's start and end — calls {@link recordEvidence}. The records wait in this process. At the
 * end of the command, {@link flushEvidence} looks for the paid module: found and running, it receives the records and
 * signs and writes them; not found, they are dropped. The default sink does nothing, opens no socket, writes no file.
 *
 * THE QUIET NOTICE (S6 style, A19). THE SUBSCRIPTION DECIDES (D6, Policy Owner 2026-10-13) — there is no
 * governance.yaml switch. With no paid module running, each surface says so once, in one calm line: the CI run
 * (`::notice`, shown on the pull request), the session manifest, `gov doctor` (an advisory row, not a warning).
 * Checks run and enforce exactly as before either way.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createHost } from "./host.js";
import { discoverModule, loadCheckModule, type LoadedModule } from "./loader.js";
import type { KeychainPort } from "./public.js";
import { finalizeRecord, sessionDraft, type DraftRecord } from "./record.js";

type Env = Readonly<Record<string, string | undefined>>;

let drafts: DraftRecord[] = [];
const noticed = new Set<NoticeSurface>();
let cached: Promise<LoadedModule> | null = null;
let context: (EvidenceContext & { readonly orgId: () => Promise<number | null>; readonly keychain?: KeychainPort }) | null = null;

/** Called by every site. Cheap and synchronous: the record waits for the end of the command. */
export function recordEvidence(d: DraftRecord | null): void {
  if (d) drafts.push(d);
}

/** What is waiting (tests and the flush). */
export function evidenceDrafts(): readonly DraftRecord[] {
  return drafts;
}

/** A fresh process, for tests. */
export function resetEvidence(): void {
  drafts = [];
  noticed.clear();
  cached = null;
  context = null;
}

/** Where this process's records belong — set once the command knows its governance repo. */
export function setEvidenceContext(c: EvidenceContext & { readonly orgId: () => Promise<number | null>; readonly keychain?: KeychainPort }): void {
  context = c;
}

/** The paid module for this process, looked for and started at most once. Absent costs file look-ups only. */
export function ensureCheckModule(ctx: EvidenceContext, extra: { readonly keychain?: KeychainPort; readonly govRoot?: string } = {}): Promise<LoadedModule> {
  cached ??= loadCheckModule({
    env: ctx.env,
    host: createHost({ govVersion: ctx.govVersion, ...(extra.keychain ? { keychain: extra.keychain } : {}) }),
    opts: { surface: ctx.surface, ...(ctx.govHome ? { govHome: ctx.govHome } : {}), ...(ctx.repoDir ? { repoDir: ctx.repoDir } : {}) },
    ...(extra.govRoot ? { govRoot: extra.govRoot } : {}),
  });
  return cached;
}

/** End of a command (bin.ts): flush whatever the sites recorded, with the context the command set. Never throws. */
export async function flushPendingEvidence(): Promise<readonly string[]> {
  if (!drafts.length) return [];
  if (!context) { drafts = []; return []; }
  try {
    return (await flushEvidence({ ctx: context, orgId: context.orgId, ...(context.keychain ? { keychain: context.keychain } : {}) })).lines;
  } catch {
    // Evidence is best-effort by contract: a failure here must never change what the command returns.
    return [];
  }
}

export interface EvidenceContext {
  readonly surface: "local" | "ci";
  readonly govHome?: string;
  readonly repoDir?: string;
  readonly env: Env;
  readonly govVersion: string;
}

export interface FlushDeps {
  readonly ctx: EvidenceContext;
  /** The org's numeric id — asked ONLY when a module is running (CI has it in the environment). */
  readonly orgId: () => Promise<number | null>;
  readonly keychain?: KeychainPort;
  readonly govRoot?: string;
  readonly load?: typeof loadCheckModule;
}

/**
 * Hand the waiting records to the module, or drop them. Never throws; returns at most one quiet line. The buffer is
 * empty afterwards either way.
 */
export async function flushEvidence(d: FlushDeps): Promise<{ readonly state: LoadedModule["state"]; readonly lines: readonly string[] }> {
  const waiting = drafts;
  drafts = [];
  if (!waiting.length) return { state: "absent", lines: [] };
  const loaded = d.load
    ? await d.load({
      env: d.ctx.env,
      host: createHost({ govVersion: d.ctx.govVersion, ...(d.keychain ? { keychain: d.keychain } : {}) }),
      opts: { surface: d.ctx.surface, ...(d.ctx.govHome ? { govHome: d.ctx.govHome } : {}), ...(d.ctx.repoDir ? { repoDir: d.ctx.repoDir } : {}) },
      ...(d.govRoot ? { govRoot: d.govRoot } : {}),
    })
    : await ensureCheckModule(d.ctx, { ...(d.keychain ? { keychain: d.keychain } : {}), ...(d.govRoot ? { govRoot: d.govRoot } : {}) });
  if (loaded.state !== "active") return { state: loaded.state, lines: loaded.state === "refused" ? loaded.lines.slice(0, 1) : [] };
  try {
    const id = await d.orgId();
    if (!id) return { state: "active", lines: ["gov-check: the organization's numeric id could not be read — no evidence was written for this run."] };
    for (const w of waiting) loaded.module.evidenceSink.record(finalizeRecord(w, id));
    const out = await loaded.module.evidenceSink.flush();
    return { state: "active", lines: out.line ? [out.line] : [] };
  } catch (e) {
    return { state: "active", lines: [`gov-check: evidence was not written (${(e as Error).message.split("\n")[0]}).`] };
  }
}

/** Wrap an agent launch: a `session` record at start and at end (spec 02 §3.1). */
export function withSessionEvidence<A extends unknown[], R>(
  launch: (...a: A) => Promise<R>,
  s: { readonly project: string; readonly issue?: number; readonly agent?: string; readonly env: Env; readonly govVersion?: string },
  agentOf?: (...a: A) => string | undefined,
): (...a: A) => Promise<R> {
  return async (...a: A): Promise<R> => {
    const agent = agentOf?.(...a) ?? s.agent;
    const base = { ...s, ...(agent ? { agent } : {}) };
    recordEvidence(sessionDraft({ ...base, boundary: "start" }));
    try {
      return await launch(...a);
    } finally {
      recordEvidence(sessionDraft({ ...base, boundary: "end" }));
    }
  };
}

// ─── the quiet notice ────────────────────────────────────────────────────────────────────────────────────────

export type NoticeSurface = "run" | "manifest" | "doctor";

const PORTAL = "https://portal.svayamtech.com";

/** The one line, per surface. Calm: what is off, why, where to get it. */
export function quietNotice(surface: NoticeSurface): string {
  const text = `Signed evidence is off: gov-check is not installed here. Checks still run and enforce as usual. Evidence and auditor reports come with a subscription (${PORTAL}).`;
  if (surface === "run") return `::notice title=gov evidence::${text}`;
  if (surface === "manifest") return `Evidence: off — ${text.slice("Signed evidence is off: ".length)}`;
  return text;
}

/**
 * The surface's notice the first time it is asked for in this process, then null. In CI the steps of one job are
 * separate processes, so the run surface also leaves a marker in RUNNER_TEMP: one notice per job, not per step.
 */
export function noticeOnce(surface: NoticeSurface, env: Env): string | null {
  if (noticed.has(surface)) return null;
  noticed.add(surface);
  if (surface === "run" && env.RUNNER_TEMP) {
    const marker = path.join(env.RUNNER_TEMP, "gov-evidence-notice");
    try {
      fs.writeFileSync(marker, "1", { flag: "wx" });
    } catch {
      // The marker exists: an earlier step of this job already gave the notice.
      return null;
    }
  }
  return quietNotice(surface);
}

/**
 * `gov doctor`'s evidence row. File look-ups only: doctor never starts the module (that could ask for a lease).
 * No module → the quiet notice as an ADVISORY: status ok, because an unsubscribed org is not misconfigured (D6).
 */
export function evidenceDoctorRow(f: { readonly found: ReturnType<typeof discoverModule> }): { name: string; status: "ok" | "warn"; detail: string } {
  if (f.found) return { name: "evidence", status: "ok", detail: `gov-check installed (${f.found.via}: ${f.found.entry})` };
  return { name: "evidence", status: "ok", detail: quietNotice("doctor") };
}
