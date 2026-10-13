// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd. — part of the OSS governed-agentic-dev-framework.
/**
 * `gov evidence verify [--from <date>] [--to <date>] [--gov-home <path>] [--test-roots]` — the FREE verifier
 * (spec 02 §3.3, Policy Owner Q4). It needs no licence, no network and no Svayam account: an auditor, or a customer
 * whose subscription lapsed, proves the evidence branch is whole with this command alone. Exit 0 only when every
 * link, hash, seal, signature and writer certificate holds; any break exits 1 and names the segment and line or the
 * chain file and entry. Gaps (runs whose evidence was NOT created) are listed — never counted as a pass.
 *
 * The command logic is pure over {@link EvidenceDeps}; main.ts wires where the ledger is read from (a checkout of the
 * evidence branch, or the gov repo's `gov/evidence` branch through git).
 */
import { flagBool, flagStr } from "./args.js";
import { formatBreak, verifyLedger, type LedgerSource } from "../evidence/verify.js";
import { SHIPPED_ROOTS, type RootKey } from "../evidence/roots.js";

export interface EvidenceDeps {
  /** Where the ledger is: `--gov-home`, or the resolved governance repo. */
  readonly source: (govHome: string | undefined) => { ok: true; src: LedgerSource; cleanup?: () => void } | { ok: false; line: string };
  /** Trusted roots (default: the roots shipped in this verifier). */
  readonly roots?: readonly RootKey[];
  /** `gov evidence enable` (lifecycle/evidence-setup.ts), wired by evidence-run.ts with the org's config. */
  readonly enable?: (govHome: string | undefined) => Promise<EvidenceResult>;
}

export interface EvidenceResult { readonly code: number; readonly lines: readonly string[] }

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const validDate = (s: string): boolean => {
  const m = DATE.exec(s);
  if (!m) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const USAGE = "usage: gov evidence <verify [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--gov-home <path>] [--test-roots] | enable [--gov-home <path>]>";

export async function evidenceCommand(positionals: readonly string[], flags: Readonly<Record<string, string | boolean>>, deps: EvidenceDeps): Promise<EvidenceResult> {
  const sub = positionals[0];
  if (sub === "verify") return Promise.resolve(evidenceVerify(flags, deps));
  if (sub === "enable") return deps.enable ? deps.enable(flagStr(flags, "gov-home")) : { code: 1, lines: ["gov evidence enable: not available here"] };
  return { code: 2, lines: [USAGE] };
}

export function evidenceVerify(flags: Readonly<Record<string, string | boolean>>, deps: EvidenceDeps): EvidenceResult {
  const from = flagStr(flags, "from");
  const to = flagStr(flags, "to");
  for (const [name, v] of [["from", from], ["to", to]] as const) {
    if (flagBool(flags, name) && (v === undefined || !validDate(v))) return { code: 2, lines: [`gov evidence verify: --${name} takes a date, YYYY-MM-DD`, USAGE] };
  }
  if (from && to && from > to) return { code: 2, lines: [`gov evidence verify: --from ${from} is after --to ${to}`, USAGE] };

  const s = deps.source(flagStr(flags, "gov-home"));
  if (!s.ok) return { code: 1, lines: [`gov evidence verify: ${s.line}`] };
  try {
    const r = verifyLedger(s.src, {
      roots: deps.roots ?? SHIPPED_ROOTS,
      ...(flagBool(flags, "test-roots") ? { trustTestRoots: true } : {}),
      ...(from ? { from } : {}), ...(to ? { to } : {}),
    });
    const lines: string[] = [];
    const window = from || to ? `, segments dated ${from ?? "…"} to ${to ?? "…"}` : "";
    lines.push(`gov evidence verify — ${r.where}${window}`);
    lines.push(`  chain     ${r.counts.entries} entries${r.head ? `, head #${r.head.n} ${r.head.hash.slice(0, 12)} (${r.head.file})` : ""}`);
    lines.push(`  segments  ${r.counts.segments} segments re-hashed, ${r.counts.records} records — every seal root and signature checked`);
    lines.push(`  writers   ${r.writers.length ? `${r.writers.length} certified: ${r.writers.join(", ")}` : "none certified"}`);
    if (r.gaps.length) {
      lines.push(`  gaps      ${r.gaps.length} run${r.gaps.length === 1 ? "" : "s"} with NO evidence (listed, never a pass):`);
      for (const g of r.gaps) lines.push(`    ${g.file} line ${g.line}  ${g.runKey}  ${g.at}  ${g.reason}`);
    } else {
      lines.push("  gaps      none");
    }
    for (const n of r.notes) lines.push(`  note      ${n}`);
    if (r.ok) {
      lines.push("verified — every chain link, segment hash, seal and signature holds, and every writer is certified.");
      return { code: 0, lines };
    }
    lines.push(`  BROKEN    ${r.breaks.length} break${r.breaks.length === 1 ? "" : "s"}:`);
    for (const b of r.breaks) lines.push(`    ${formatBreak(b)}`);
    lines.push(`NOT VERIFIED — ${r.breaks.length} break${r.breaks.length === 1 ? "" : "s"}; the first: ${formatBreak(r.breaks[0]!)}`);
    return { code: 1, lines };
  } finally {
    s.cleanup?.();
  }
}
