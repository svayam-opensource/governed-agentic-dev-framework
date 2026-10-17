// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd. — part of the OSS governed-agentic-dev-framework.
/**
 * `@svayam-opensource/gov/check-host` — THE SEAM between open gov and an optional paid module (spec 02 §5).
 *
 * Open gov runs every check, folds every verdict and enforces every gate on its own; nothing here is needed for that.
 * An installed module (Svayam's `@svayam/gov-check`) only ADDS: it writes signed evidence, runs paid actions (the
 * LLM judge, pack actions), generates auditor reports and offers packs. The dependency points one way: the module
 * imports TYPES and schemas from this subpath and receives runtime helpers through the {@link Host} object at
 * activation, so it always runs against the very gov that loaded it. Open gov names the module only as a string in
 * its loader.
 *
 * LOCK-STEP (S7). gov exports {@link HOST_API}; a module exports `api = {major, minHostMinor}`. They fit when
 * `api.major === HOST_API.major && api.minHostMinor <= HOST_API.minor` ({@link checkLockStep}); otherwise gov prints
 * one quiet line and runs exactly as with no module. A breaking change to anything in this file bumps the major; an
 * addition bumps the minor.
 */
import type { Catalog } from "../rules/model/catalog.js";
import type { SchemaName } from "./schemas.js";
import type * as Hash from "../evidence/hash.js";
import type * as Roots from "../evidence/roots.js";
import type * as Verify from "../evidence/verify.js";

export { canonicalJson, sha256Hex } from "../evidence/canonical.js";
export { SCHEMAS, SCHEMA_NAMES, type SchemaName } from "./schemas.js";
export { validate } from "./validate.js";
// The ledger's hashes, signatures, writer-certificate checks and the free verifier (spec 02 §3.2–3.3, plan 02 E06):
// the writer builds with exactly what `gov evidence verify` checks with. Types here; runtime through `host.ledger`.
export { ZERO_HASH, lineDigest, segmentRoot, sealPayload, entryPayload, entryHash, fileHash, verifyEd25519, isEd25519Jwk, type Ed25519Jwk } from "../evidence/hash.js";
export { SHIPPED_ROOTS, LEASE_GRACE_SECONDS, trustRoots, checkWriterCert, writerKid, keyFileName, decodeJws, verifyJws, type RootKey, type TrustedRoots, type CertCheck, type CertLease, type DecodedJws, type JwsCheck } from "../evidence/roots.js";
export { verifyLedger, dirSource, formatBreak, type LedgerSource, type VerifyOptions, type VerifyResult, type Break, type BreakCode, type GapInfo } from "../evidence/verify.js";
export type { Catalog } from "../rules/model/catalog.js";

/** The host API this gov offers. 1.1 added `host.ledger` (the verifier's hashes and checks). */
export const HOST_API = Object.freeze({ major: 1, minor: 1 });
export interface HostApi { readonly major: number; readonly minor: number }
/** What a module declares it needs. */
export interface ModuleApi { readonly major: number; readonly minHostMinor: number }

export type LockStep = { readonly ok: true } | { readonly ok: false; readonly line: string };

/** S7: does a module's declared API fit this gov? A mismatch is ONE line, never an error. */
export function checkLockStep(api: ModuleApi, host: HostApi = HOST_API): LockStep {
  if (!api || typeof api.major !== "number" || typeof api.minHostMinor !== "number") {
    return { ok: false, line: "gov-check: the installed module declares no host API — running without it." };
  }
  if (api.major !== host.major) {
    return { ok: false, line: `gov-check: the installed module speaks host API ${api.major}.x, this gov offers ${host.major}.${host.minor} — running without it; install a matching version.` };
  }
  if (api.minHostMinor > host.minor) {
    return { ok: false, line: `gov-check: the installed module needs host API ${host.major}.${api.minHostMinor}+, this gov offers ${host.major}.${host.minor} — running without it; upgrade gov.` };
  }
  return { ok: true };
}

// ─── Evidence records (gov-evidence/1, spec 02 §3.1; schema gov-evidence-1.schema.json) ─────────────────────────

export type Entitlement = "evidence" | "deploy" | "infra";
export type EvidenceVerdict = "pass" | "fail" | "cannot-tell" | "needs-subscription";
export type EvidenceClass = "prevented" | "detected" | "judged" | "cued" | "advisory" | "cannot-tell" | "advisory (needs subscription)";

interface RecordCommon {
  readonly schema: "gov-evidence/1";
  /** ULID. */
  readonly id: string;
  /** The org by its rename-safe numeric id ONLY. */
  readonly org: { readonly vcs: "github"; readonly id: number };
  readonly repo?: { readonly id: number; readonly name: string };
  readonly ref?: { readonly sha: string; readonly changeRequest?: number; readonly branch?: string };
  readonly actor?: { readonly login?: string; readonly kind: "human" | "agent"; readonly agent?: string; readonly trailer?: "present" | "absent" };
  readonly session?: { readonly project: string; readonly issue?: number };
  readonly source: "ci" | "local";
  /** `gh:<run>:<attempt>:<rule>:<event>` in CI, `local:<ulid>:<rule>` locally — a retried attempt never double-writes. */
  readonly runKey: string;
  /** ISO-8601 UTC, `Z`. */
  readonly at: string;
  readonly versions: { readonly gov: string; readonly govCheck?: string; readonly policy?: string; readonly pack?: string };
}

/** A check-binding verdict, a gate-verb decision, or an (observe-only) LLM judgement. */
export interface VerdictRecord extends RecordCommon {
  readonly kind: "check" | "gate" | "judge";
  readonly rule: { readonly id: string; readonly rev?: string; readonly level?: "C01" | "C02" | "C03"; readonly phase?: "build" | "deploy" | "common" | "operate" };
  readonly binding?: { readonly resource: string; readonly event: string; readonly action: string };
  readonly verdict: EvidenceVerdict;
  readonly class: EvidenceClass;
  /** A dotted message KEY, never prose. */
  readonly messageKey: string;
}

/** A governed-session boundary (`gov work` start / end). */
export interface SessionRecord extends RecordCommon {
  readonly kind: "session";
  readonly boundary: "start" | "end";
  readonly session: { readonly project: string; readonly issue?: number };
}

/** Evidence NOT created for a run (no lease). Unsigned; carries no verdict — a gap is never a pass. */
export interface GapRecord extends Omit<RecordCommon, "ref" | "session"> {
  readonly kind: "gap";
  /** A dotted reason key, e.g. `lease.refused`, `lease.expired`, `chain.contention`. */
  readonly reason: string;
}

export type EvidenceRecord = VerdictRecord | SessionRecord | GapRecord;

// ─── What the module provides ─────────────────────────────────────────────────────────────────────────────────

/** Receives records as gov produces them; the module builds the segment, signs, chains and pushes on flush. */
export interface EvidenceSink {
  record(r: EvidenceRecord): void;
  /** Ends the run's segment. `line` = one quiet line for the surface when something was not written (a gap). */
  flush(): Promise<{ readonly ok: boolean; readonly line?: string }>;
}

/** The event a paid action is asked about (the runner's EventContext, payload opaque). */
export interface ActionInput {
  readonly ruleId: string;
  readonly action: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly ctx: { readonly resource: string; readonly event: string; readonly payload: unknown };
}

export interface ActionOutcome {
  readonly verdict: "pass" | "fail" | "cannot-tell";
  readonly findings: readonly string[];
  /** True for the LLM judge (Q22): recorded, shown, NEVER folded into a blocking verdict. */
  readonly observeOnly?: boolean;
}

/** Runs one paid action (the LLM judge, a pack action). */
export type ActionDispatcher = (input: ActionInput) => Promise<ActionOutcome>;

export interface ReportRequest {
  readonly pack: string;
  /** Inclusive dates, `YYYY-MM-DD`. */
  readonly from: string;
  readonly to: string;
  readonly repo?: string;
  readonly format: "md" | "json" | "html";
  /** The gov repo checkout holding `evidence/` (the evidence branch) and `policies/`. */
  readonly govHome: string;
}

export interface ReportResult {
  readonly ok: boolean;
  /** Paths written, relative to govHome (e.g. `evidence/reports/soc2-cc8/2026-07-01_2026-09-30/report.md`). */
  readonly files: readonly string[];
  /** When the chain is broken the report stops and says where. */
  readonly broken?: { readonly file: string; readonly line?: number; readonly reason: string };
  readonly lines: readonly string[];
}

export interface ReportGenerator {
  generate(req: ReportRequest): Promise<ReportResult>;
}

export interface PackInfo {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  /** "not-audited" until the control mapping is signed off (Q8); reports carry the label. */
  readonly mappingStatus: "not-audited" | "audited";
}

export interface PackRegistry {
  list(): readonly PackInfo[];
  /**
   * The files `gov pack add <id>` proposes in a POLICY PR (never written directly): the prose at
   * `policies/common/packs/<id>.md` (Q7) and the control map at `policies/packs/<id>.yaml`. null = no such pack.
   */
  proposal(id: string): { readonly files: readonly { readonly path: string; readonly text: string }[] } | null;
}

export interface LicenceStatus {
  readonly state: "licensed" | "grace" | "refused" | "absent";
  readonly org?: { readonly vcs: "github"; readonly id: number };
  readonly plan?: string;
  readonly entitlements: readonly Entitlement[];
  /** ISO-8601 UTC. */
  readonly leaseExpiry?: string;
  /** A plain reason when refused / absent / in grace. */
  readonly reason?: string;
}

/** What a module's `activate` returns when it runs. */
export interface PaidModule {
  readonly entitlements: readonly Entitlement[];
  readonly evidenceSink: EvidenceSink;
  /** LLM judge + paid pack actions ONLY; keyed by action id. */
  readonly actions: ReadonlyMap<string, ActionDispatcher>;
  /** Pack catalogs, merged via gov's mergeCatalogs (gov's entries win on an id clash). */
  readonly catalogs: readonly Catalog[];
  readonly reports: ReportGenerator;
  readonly packs: PackRegistry;
  readonly licence: { status(): LicenceStatus; login(key: string): Promise<void> };
}

/** `activate` declining to run (no lease, not entitled …): gov runs as with no module and shows the lines quietly. */
export interface ActivationRefusal { readonly ok: false; readonly lines: readonly string[] }

// ─── What gov hands the module ────────────────────────────────────────────────────────────────────────────────

/** OS keychain (macOS `security`, Linux `secret-tool`, Windows Credential Manager); env fallback, NEVER a file. */
export interface KeychainPort {
  get(account: string): Promise<string | null>;
  set(account: string, secret: string): Promise<void>;
  delete(account: string): Promise<void>;
  /** Where secrets live here, for a plain hint (`macOS keychain`, `env only` …). */
  readonly backend: string;
}

/** Quiet output. Never pass a secret: lines may reach CI logs. */
export interface HostLog {
  info(line: string): void;
  warn(line: string): void;
  debug(line: string): void;
}

/** The ledger code the free verifier runs, handed to the writer so both use ONE implementation (host API 1.1). */
export interface LedgerHelpers {
  readonly ZERO_HASH: string;
  readonly lineDigest: typeof Hash.lineDigest;
  readonly segmentRoot: typeof Hash.segmentRoot;
  readonly sealPayload: typeof Hash.sealPayload;
  readonly entryPayload: typeof Hash.entryPayload;
  readonly entryHash: typeof Hash.entryHash;
  readonly fileHash: typeof Hash.fileHash;
  readonly verifyEd25519: typeof Hash.verifyEd25519;
  readonly keyFileName: typeof Roots.keyFileName;
  readonly writerKid: typeof Roots.writerKid;
  readonly verifyLedger: typeof Verify.verifyLedger;
  readonly dirSource: typeof Verify.dirSource;
}

export interface Host {
  readonly api: HostApi;
  readonly govVersion: string;
  /** The ONE canonicaliser and hash of the ledger. */
  readonly canonicalJson: (value: unknown) => string;
  readonly sha256Hex: (data: string | Uint8Array) => string;
  /** Strict validation against the seam schemas. */
  readonly validate: (schema: SchemaName, value: unknown) => readonly string[];
  readonly keychain: KeychainPort;
  readonly log: HostLog;
  /** Present from host API 1.1: a module declaring `minHostMinor >= 1` may rely on it. */
  readonly ledger?: LedgerHelpers;
}

export interface ActivationOptions {
  /** Which surface is running: a person's CLI, or a CI job. */
  readonly surface: "local" | "ci";
  /** The gov repo checkout, when known. */
  readonly govHome?: string;
  /** The repository the run is about, when known. */
  readonly repoDir?: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** The module's entry points (`@svayam/gov-check` exports both). */
export interface CheckModule {
  readonly api: ModuleApi;
  activate(host: Host, opts: ActivationOptions): Promise<PaidModule | ActivationRefusal>;
}
