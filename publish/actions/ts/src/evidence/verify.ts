// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd. — part of the OSS governed-agentic-dev-framework.
/**
 * THE FREE VERIFIER (spec 02 §3.2–3.4; Policy Owner Q4: verification is free, in MIT gov). An auditor, or a customer
 * whose subscription lapsed, can prove an evidence ledger is whole with nothing but this code and the evidence branch.
 * Creation needs a certified writer key; checking needs none — so verifying weakens nothing.
 *
 *   walk evidence/chain/<yyyy>-<mm>.jsonl in order      n is 1, 2, 3 …; prev = hash of the previous entry
 *     each entry: signature by its writer; writer certified by a trusted root (roots.ts)
 *     its segment: file sha256 = entry.sha256; every record line canonical and schema-valid;
 *                  seal: count, root = sha256(h_1‖…‖h_n), writer, chainPrev = entry.prev, signature under
 *                  the lease it names (cert = jti: evidence entitlement, same org, within exp + 72 h)
 *   every other segment on the branch must be chained; gap-*.jsonl files are LISTED, never verified as evidence
 *
 * Every break names WHERE: the segment and line, or the chain file and entry n. A record edited so that its line stays
 * valid canonical JSON cannot be located inside the segment (the seal holds one root, not one hash per line): the
 * break names the segment's seal line, and the chain entry whose sha256 no longer matches.
 *
 * Pure over a {@link LedgerSource}: a directory (an auditor's checkout of the evidence branch) or a git ref.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { canonicalJson } from "./canonical.js";
import { entryHash, entryPayload, fileHash, sealPayload, segmentRoot, verifyEd25519, ZERO_HASH, type Ed25519Jwk } from "./hash.js";
import { checkWriterCert, keyFileName, LEASE_GRACE_SECONDS, SHIPPED_ROOTS, trustRoots, type CertCheck, type RootKey } from "./roots.js";
import { validate } from "../check-seam/validate.js";

/** Where the ledger is read from. Paths are POSIX, relative to the repository root, under `evidence/`. */
export interface LedgerSource {
  /** For the person: a directory, or `<repo> @ <ref>`. */
  readonly where: string;
  /** Every file under `evidence/`. */
  list(): readonly string[];
  read(rel: string): Uint8Array | null;
}

/** A checkout (or an extracted copy) holding `evidence/` at its top. */
export function dirSource(dir: string): LedgerSource {
  const top = path.join(dir, "evidence");
  return {
    where: dir,
    list: () => {
      const out: string[] = [];
      const walk = (d: string, rel: string): void => {
        let names: fs.Dirent[];
        try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { return; /* an unreadable folder lists nothing; a missing chained file is then named as a break */ }
        for (const n of names) {
          const r = `${rel}/${n.name}`;
          if (n.isDirectory()) walk(path.join(d, n.name), r);
          else if (n.isFile()) out.push(r);
        }
      };
      walk(top, "evidence");
      return out.sort();
    },
    read: (rel) => { try { return fs.readFileSync(path.join(dir, ...rel.split("/"))); } catch { return null; /* absent: the caller names the missing file as a break */ } },
  };
}

export type BreakCode =
  | "ledger.missing"
  | "chain.parse" | "chain.schema" | "chain.n" | "chain.prev" | "chain.sig" | "chain.sha256"
  | "segment.parse" | "segment.schema" | "segment.gap" | "segment.noncanonical" | "segment.unchained" | "segment.no-seal"
  | "seal.schema" | "seal.segment" | "seal.count" | "seal.root" | "seal.writer" | "seal.chainPrev" | "seal.cert" | "seal.sig"
  | "cert.missing" | "cert.invalid" | "cert.root" | "cert.key-mismatch" | "cert.expired" | "cert.entitlement" | "cert.org"
  | "gap.parse" | "gap.not-gap";

export interface Break {
  readonly code: BreakCode;
  /** Repository-relative path: the segment, the chain month file, or the writer's key file. */
  readonly file: string;
  /** 1-based line in `file`. */
  readonly line?: number;
  /** Chain entry number (`n`), for a chain break. */
  readonly entry?: number;
  readonly reason: string;
}

/** A run for which evidence was NOT created. Listed; never a pass. */
export interface GapInfo {
  readonly file: string;
  readonly line: number;
  readonly runKey: string;
  readonly at: string;
  readonly reason: string;
}

export interface VerifyOptions {
  /** Trusted roots; default: the roots shipped in this verifier. */
  readonly roots?: readonly RootKey[];
  /** Trust `test-*` roots listed in roots.json (a test ledger only; the result says so). */
  readonly trustTestRoots?: boolean;
  /** Inclusive `YYYY-MM-DD` window for segments and gaps. The chain is walked whole: every link is needed. */
  readonly from?: string;
  readonly to?: string;
}

export interface VerifyResult {
  readonly ok: boolean;
  readonly where: string;
  /** What was verified as evidence (gaps are never counted). */
  readonly counts: { readonly entries: number; readonly segments: number; readonly records: number };
  readonly head?: { readonly n: number; readonly hash: string; readonly file: string };
  /** Writer kids whose certificates hold. */
  readonly writers: readonly string[];
  readonly gaps: readonly GapInfo[];
  readonly breaks: readonly Break[];
  readonly notes: readonly string[];
}

export function formatBreak(b: Break): string {
  const at = b.entry !== undefined ? ` entry ${b.entry}${b.line !== undefined ? ` (line ${b.line})` : ""}` : b.line !== undefined ? ` line ${b.line}` : "";
  return `${b.file}${at}: ${b.reason}`;
}

const CHAIN_FILE = /^evidence\/chain\/(\d{4})-(\d{2})\.jsonl$/;
const SEGMENT_FILE = /^evidence\/(\d{4})\/(\d{2})\/(\d{2})\/([^/]+)\.jsonl$/;

const textLines = (bytes: Uint8Array): string[] => {
  const lines = Buffer.from(bytes).toString("utf8").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
};

const parse = (s: string): { ok: true; v: unknown } | { ok: false } => {
  try { return { ok: true, v: JSON.parse(s) as unknown }; } catch { return { ok: false }; /* the caller names the line as not JSON */ }
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

const inWindow = (date: string, o: VerifyOptions): boolean => (!o.from || date >= o.from) && (!o.to || date <= o.to);

/** Verify a ledger. Never throws on bad data — every problem is a {@link Break}. */
export function verifyLedger(src: LedgerSource, opts: VerifyOptions = {}): VerifyResult {
  const files = src.list();
  const breaks: Break[] = [];
  const gaps: GapInfo[] = [];
  const counts = { entries: 0, segments: 0, records: 0 };
  if (files.length === 0) {
    breaks.push({ code: "ledger.missing", file: "evidence/", reason: "no evidence/ tree here — is this a checkout of the evidence branch (gov/evidence)?" });
    return { ok: false, where: src.where, counts, writers: [], gaps, breaks, notes: [] };
  }

  const rootsBytes = src.read("evidence/keys/roots.json");
  const rootsParsed = rootsBytes ? parse(Buffer.from(rootsBytes).toString("utf8")) : { ok: true as const, v: null };
  const trusted = trustRoots(opts.roots ?? SHIPPED_ROOTS, rootsParsed.ok ? rootsParsed.v : null, opts.trustTestRoots ? { trustTestRoots: true } : {});
  const notes = [...trusted.notes];
  if (!rootsBytes) notes.push("evidence/keys/roots.json is missing — only the roots shipped in this verifier are trusted");
  else if (!rootsParsed.ok) notes.push("evidence/keys/roots.json is not JSON — only the roots shipped in this verifier are trusted");

  // ── writer certificates, once per writer ──────────────────────────────────────────────────────────────────
  const certs = new Map<string, CertCheck>();
  const certFor = (kid: string): CertCheck => {
    const known = certs.get(kid);
    if (known) return known;
    const rel = `evidence/keys/${keyFileName(kid)}`;
    const bytes = src.read(rel);
    const parsed = bytes ? parse(Buffer.from(bytes).toString("utf8")) : null;
    const c = checkWriterCert(kid, parsed ? (parsed.ok ? parsed.v : {}) : null, trusted);
    certs.set(kid, c);
    if (!c.ok) breaks.push({ code: c.code, file: rel, reason: c.reason });
    return c;
  };

  // ── the chain ─────────────────────────────────────────────────────────────────────────────────────────────
  const chainFiles = files.filter((f) => CHAIN_FILE.test(f)).sort();
  const chained = new Set<string>();
  let prevHash = ZERO_HASH;
  let expectN = 1;
  let head: VerifyResult["head"];

  for (const cf of chainFiles) {
    const lines = textLines(src.read(cf) ?? new Uint8Array());
    lines.forEach((raw, i) => {
      const line = i + 1;
      const p = parse(raw);
      if (!p.ok || !isObj(p.v)) {
        breaks.push({ code: "chain.parse", file: cf, line, reason: "not a JSON object — the chain cannot be followed past here" });
        expectN++;
        return;
      }
      const e = p.v;
      const n = typeof e.n === "number" ? e.n : expectN;
      const at = { file: cf, line, entry: n };
      const schemaErrors = validate("chain-entry", e);
      if (schemaErrors.length) breaks.push({ code: "chain.schema", ...at, reason: `not a chain entry: ${schemaErrors[0]}` });
      if (n !== expectN) breaks.push({ code: "chain.n", ...at, reason: `entry number ${n} where ${expectN} was due — an entry was deleted, added or moved` });
      if (e.prev !== prevHash) {
        breaks.push({ code: "chain.prev", ...at, reason: `prev does not link to the entry before it${n === 1 || prevHash === ZERO_HASH ? "" : ` (expected ${prevHash.slice(0, 12)}…)`} — an entry was deleted, reordered or replaced` });
      }
      const writer = typeof e.writer === "string" ? e.writer : "";
      const cert = writer ? certFor(writer) : null;
      if (cert?.ok && !verifyEd25519(cert.jwk, entryPayload(e), String(e.sig ?? ""))) {
        breaks.push({ code: "chain.sig", ...at, reason: `the signature by writer ${writer} does not verify — the entry was changed after it was signed` });
      }

      const segRel = typeof e.segment === "string" ? `evidence/${e.segment}` : "";
      if (segRel) chained.add(segRel);
      const m = SEGMENT_FILE.exec(segRel);
      const date = m ? `${m[1]}-${m[2]}-${m[3]}` : "";
      if (segRel && (!date || inWindow(date, opts))) {
        const bytes = src.read(segRel);
        if (!bytes) {
          breaks.push({ code: "chain.sha256", ...at, reason: `its segment ${segRel} is missing — deleted after it was chained` });
        } else {
          if (fileHash(bytes) !== e.sha256) breaks.push({ code: "chain.sha256", ...at, reason: `sha256 of ${segRel} does not match — the segment was changed after it was chained` });
          checkSegment(segRel, bytes, writer, cert, e.prev, breaks, counts);
        }
      }

      prevHash = entryHash(e);
      expectN = n + 1;
      counts.entries++;
      head = { n, hash: prevHash, file: cf };
    });
  }

  // ── files on the branch that the chain does not name ──────────────────────────────────────────────────────
  for (const f of files) {
    const m = SEGMENT_FILE.exec(f);
    if (!m || chained.has(f)) continue;
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    if (!inWindow(date, opts)) continue;
    if (m[4]!.startsWith("gap-")) listGaps(f, src.read(f) ?? new Uint8Array(), gaps, breaks);
    else breaks.push({ code: "segment.unchained", file: f, reason: "no chain entry names this segment — it was added outside the writer, or its chain entry was deleted" });
  }

  const writers = [...certs].filter(([, c]) => c.ok).map(([k]) => k).sort();
  return { ok: breaks.length === 0, where: src.where, counts, ...(head ? { head } : {}), writers, gaps, breaks, notes };
}

function checkSegment(rel: string, bytes: Uint8Array, writer: string, cert: CertCheck | null, entryPrev: unknown,
  breaks: Break[], counts: { segments: number; records: number }): void {
  const lines = textLines(bytes);
  const name = rel.slice(rel.lastIndexOf("/") + 1, -".jsonl".length);
  const last = lines.length ? parse(lines[lines.length - 1]!) : { ok: false as const };
  if (!last.ok || !isObj(last.v) || !isObj(last.v.seal)) {
    breaks.push({ code: "segment.no-seal", file: rel, line: Math.max(lines.length, 1), reason: "the last line is not a seal — the segment was cut short or appended to" });
    return;
  }
  const seal = last.v.seal;
  const sealLine = lines.length;
  const records: unknown[] = [];
  const times: { at: string; line: number }[] = [];
  const orgs: { id: unknown; line: number }[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const line = i + 1;
    const raw = lines[i]!;
    const p = parse(raw);
    if (!p.ok) { breaks.push({ code: "segment.parse", file: rel, line, reason: "not JSON — the line was edited" }); records.push(raw); continue; }
    records.push(p.v);
    let canonical: string | null = null;
    try { canonical = canonicalJson(p.v); } catch { /* a fraction, … */ }
    if (canonical !== raw) breaks.push({ code: "segment.noncanonical", file: rel, line, reason: "not in canonical form — a writer never writes it this way, so the line was edited" });
    const errs = validate("gov-evidence-1", p.v);
    if (errs.length) breaks.push({ code: "segment.schema", file: rel, line, reason: `not a gov-evidence/1 record: ${errs[0]}` });
    if (isObj(p.v)) {
      if (typeof p.v.at === "string") times.push({ at: p.v.at, line });
      if (isObj(p.v.org)) orgs.push({ id: p.v.org.id, line });
      if (p.v.kind === "gap") breaks.push({ code: "segment.gap", file: rel, line, reason: "a gap record inside a sealed segment — gaps are written unsigned in gap-*.jsonl, never sealed as evidence" });
    }
  }
  counts.segments++;
  counts.records += records.length;

  const at = { file: rel, line: sealLine };
  const errs = validate("seal", last.v);
  if (errs.length) breaks.push({ code: "seal.schema", ...at, reason: `not a seal: ${errs[0]}` });
  if (seal.segment !== name) breaks.push({ code: "seal.segment", ...at, reason: `sealed as ${String(seal.segment)}, stored as ${name} — the segment was renamed or moved` });
  if (seal.count !== records.length) breaks.push({ code: "seal.count", ...at, reason: `sealed ${String(seal.count)} records, holds ${records.length} — a record line was added or removed` });
  let root = "";
  try { root = segmentRoot(records); } catch { /* an unparseable line already broke */ }
  if (root !== seal.root) breaks.push({ code: "seal.root", ...at, reason: `the root does not match records 1–${records.length} — a record line was changed` });
  if (writer && seal.writer !== writer) breaks.push({ code: "seal.writer", ...at, reason: `sealed by ${String(seal.writer)}, chained by ${writer}` });
  if (seal.chainPrev !== entryPrev) breaks.push({ code: "seal.chainPrev", ...at, reason: "the seal's chainPrev is not its chain entry's prev — the segment was sealed for another place in the chain" });
  if (!cert?.ok) return;
  const lease = cert.leases.find((l) => l.jti === seal.cert);
  if (!lease) {
    breaks.push({ code: "seal.cert", ...at, reason: `sealed under lease ${String(seal.cert)}, which writer ${writer}'s key file does not hold among its certified leases` });
    return;
  }
  const jwk: Ed25519Jwk = cert.jwk;
  if (!verifyEd25519(jwk, sealPayload(seal), String(seal.sig ?? ""))) breaks.push({ code: "seal.sig", ...at, reason: `the seal's signature by writer ${writer} does not verify` });
  if (!lease.entitlements.includes("evidence")) breaks.push({ code: "cert.entitlement", ...at, reason: `lease ${lease.jti} carries no evidence entitlement` });
  if (lease.orgId !== undefined) {
    const other = orgs.find((o) => o.id !== lease.orgId);
    if (other) breaks.push({ code: "cert.org", file: rel, line: other.line, reason: `the record is for org ${other.id}, which lease ${lease.jti} does not cover` });
  }
  for (const t of times) {
    const s = Date.parse(t.at) / 1000;
    if (!Number.isFinite(s)) continue;
    if ((lease.exp !== undefined && s > lease.exp + LEASE_GRACE_SECONDS) || (lease.nbf !== undefined && s < lease.nbf - 300)) {
      breaks.push({ code: "cert.expired", file: rel, line: t.line, reason: `written at ${t.at}, outside lease ${lease.jti} (and its 72 h grace)` });
      break;
    }
  }
}

function listGaps(rel: string, bytes: Uint8Array, gaps: GapInfo[], breaks: Break[]): void {
  textLines(bytes).forEach((raw, i) => {
    const line = i + 1;
    const p = parse(raw);
    if (!p.ok || !isObj(p.v)) { breaks.push({ code: "gap.parse", file: rel, line, reason: "not a JSON object" }); return; }
    if (p.v.kind !== "gap" || validate("gov-evidence-1", p.v).length) {
      breaks.push({ code: "gap.not-gap", file: rel, line, reason: "a gap file may hold only kind: gap records — an unsigned verdict is never evidence" });
      return;
    }
    gaps.push({ file: rel, line, runKey: String(p.v.runKey), at: String(p.v.at), reason: String(p.v.reason) });
  });
}
