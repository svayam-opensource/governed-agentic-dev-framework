// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd. — part of the OSS governed-agentic-dev-framework.
/**
 * `gov evidence verify [--from <date>] [--to <date>] [--gov-home <path>] [--test-roots]` — the FREE verifier
 * (spec 02 §3.3, Policy Owner Q4). It needs no licence, no network and no Svayam account: an auditor, or a customer
 * whose subscription lapsed, proves the evidence branch is whole with this command alone. Exit 0 only when every
 * link, hash, seal, signature and writer certificate holds; any break exits 1 and names the segment and line or the
 * chain file and entry. Gaps (runs whose evidence was NOT created) are listed — never counted as a pass.
 *
 * `gov evidence report --pack <id> --from <date> --to <date> [--repo <name>] [--format md|json|html] [--gov-home <path>]`
 * (spec 02 §3.5, Q6) is the PAID half: the module generates the auditor report, and gov commits the files on
 * `gov/evidence` from a temporary worktree of `origin/gov/evidence` — never the person's checkout, never the default
 * branch — and pushes fast-forward only.
 *
 * The command logic is pure over {@link EvidenceDeps}; main.ts wires where the ledger is read from (a checkout of the
 * evidence branch, or the gov repo's `gov/evidence` branch through git).
 */
import { EVIDENCE_BRANCH } from "../lifecycle/evidence-setup.js";
import { flagBool, flagStr } from "./args.js";
import { formatBreak, verifyLedger, type LedgerSource } from "../evidence/verify.js";
import { SHIPPED_ROOTS, type RootKey } from "../evidence/roots.js";
import type { ReportGenerator } from "../check-seam/public.js";

export interface EvidenceDeps {
  /** Where the ledger is: `--gov-home`, or the resolved governance repo. */
  readonly source: (govHome: string | undefined) => { ok: true; src: LedgerSource; cleanup?: () => void } | { ok: false; line: string };
  /** Trusted roots (default: the roots shipped in this verifier). */
  readonly roots?: readonly RootKey[];
  /** `gov evidence enable` (lifecycle/evidence-setup.ts), wired by evidence-run.ts with the org's config. */
  readonly enable?: (govHome: string | undefined) => Promise<EvidenceResult>;
  /** `gov evidence report`, wired by evidence-run.ts. */
  readonly report?: ReportDeps;
}

/** What `gov evidence report` needs from the world — all injectable. */
export interface ReportDeps {
  /** The paid module's report generator, or null when it is not running here. */
  readonly generator: () => Promise<ReportGenerator | null>;
  /** The git repository holding `origin/gov/evidence`: `--gov-home`, or the resolved governance repo. */
  readonly home: (govHome: string | undefined) => { ok: true; home: string } | { ok: false; line: string };
  /** A fresh, non-existent directory path for the temporary worktree. */
  readonly tmpDir: () => string;
  /** git in `cwd`; null on failure. */
  readonly git: (cwd: string, args: readonly string[]) => string | null;
  /** Copy `<from>/policies` into `<to>` (the control map and exceptions the report reads); never committed. */
  readonly copyPolicies: (from: string, to: string) => void;
  readonly removeDir: (abs: string) => void;
}

export interface EvidenceResult { readonly code: number; readonly lines: readonly string[] }

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const validDate = (s: string): boolean => {
  const m = DATE.exec(s);
  if (!m) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const USAGE = "usage: gov evidence <verify [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--gov-home <path>] [--test-roots] | enable [--gov-home <path>] | report --pack <id> --from YYYY-MM-DD --to YYYY-MM-DD [--repo <name>] [--format md|json|html] [--gov-home <path>]>";
const NO_MODULE = "Auditor reports come with gov-check, which is not installed here — they are part of a subscription (https://portal.svayamtech.com). Verifying the evidence stays free: gov evidence verify.";
const REPORT_DIR = "evidence/reports/";

export async function evidenceCommand(positionals: readonly string[], flags: Readonly<Record<string, string | boolean>>, deps: EvidenceDeps): Promise<EvidenceResult> {
  const sub = positionals[0];
  if (sub === "verify") return Promise.resolve(evidenceVerify(flags, deps));
  if (sub === "enable") return deps.enable ? deps.enable(flagStr(flags, "gov-home")) : { code: 1, lines: ["gov evidence enable: not available here"] };
  if (sub === "report") return evidenceReport(flags, deps);
  return { code: 2, lines: [USAGE] };
}

export async function evidenceReport(flags: Readonly<Record<string, string | boolean>>, deps: EvidenceDeps): Promise<EvidenceResult> {
  const bad = (why: string): EvidenceResult => ({ code: 2, lines: [`gov evidence report: ${why}`, USAGE] });
  const pack = flagStr(flags, "pack");
  const from = flagStr(flags, "from");
  const to = flagStr(flags, "to");
  const repo = flagStr(flags, "repo");
  const format = flagStr(flags, "format") ?? "md";
  if (!pack) return bad("--pack <id> is required");
  if (!from || !validDate(from)) return bad("--from takes a date, YYYY-MM-DD");
  if (!to || !validDate(to)) return bad("--to takes a date, YYYY-MM-DD");
  if (from > to) return bad(`--from ${from} is after --to ${to}`);
  if (format !== "md" && format !== "json" && format !== "html") return bad(`--format is md, json or html, not "${format}"`);
  const r = deps.report;
  if (!r) return { code: 1, lines: ["gov evidence report: not available here"] };

  const gen = await r.generator();
  if (!gen) return { code: 1, lines: [NO_MODULE] };
  const h = r.home(flagStr(flags, "gov-home"));
  if (!h.ok) return { code: 1, lines: [`gov evidence report: ${h.line}`] };
  const home = h.home;
  const fail = (why: string): EvidenceResult => ({ code: 1, lines: [`gov evidence report: ${why}`] });

  if (r.git(home, ["fetch", "origin", EVIDENCE_BRANCH]) === null) {
    return fail(`could not fetch origin/${EVIDENCE_BRANCH} in ${home} — is evidence on for this organization? (gov evidence enable, once, by an owner)`);
  }
  const wt = r.tmpDir();
  if (r.git(home, ["worktree", "add", "--detach", wt, `origin/${EVIDENCE_BRANCH}`]) === null) return fail(`could not check out origin/${EVIDENCE_BRANCH} to a temporary folder`);
  try {
    r.copyPolicies(home, wt);
    let res;
    try {
      res = await gen.generate({ pack, from, to, ...(repo ? { repo } : {}), format, govHome: wt });
    } catch (e) {
      return fail(`the report module failed: ${(e as Error).message.split("\n")[0]}`);
    }
    if (res.broken) {
      const b = res.broken;
      return { code: 1, lines: [...res.lines, `The evidence chain is BROKEN at ${b.file}${b.line === undefined ? "" : ` line ${b.line}`}: ${b.reason}. No report was written.`] };
    }
    if (!res.ok) return { code: 1, lines: res.lines.length ? [...res.lines] : ["gov evidence report: the module produced no report"] };
    if (!res.files.length) return { code: 1, lines: [...res.lines, "gov evidence report: the module wrote no files"] };
    const stray = res.files.filter((f) => !f.startsWith(REPORT_DIR) || f.includes(".."));
    if (stray.length) return { code: 1, lines: [`gov evidence report: the module wrote outside ${REPORT_DIR} (${stray.join(", ")}) — nothing was committed.`] };

    if (r.git(wt, ["add", "--", ...res.files]) === null) return fail("could not stage the report files");
    const changed = r.git(wt, ["diff", "--cached", "--quiet"]) === null;
    if (!changed) return { code: 0, lines: [...res.lines, `The report files are already on ${EVIDENCE_BRANCH} and unchanged:`, ...res.files.map((f) => `  ${f}`)] };
    const msg = `evidence: ${pack} report ${from} to ${to}${repo ? ` (${repo})` : ""}\n\nGenerated by \`gov evidence report\`.`;
    if (r.git(wt, ["commit", "-q", "-m", msg]) === null) return fail("could not commit the report files");
    // Fast-forward only: a plain push (no force). If a writer appended meanwhile, rebase our one commit on it, once.
    let pushed = r.git(wt, ["push", "-q", "origin", `HEAD:refs/heads/${EVIDENCE_BRANCH}`]) !== null;
    if (!pushed && r.git(wt, ["fetch", "origin", EVIDENCE_BRANCH]) !== null && r.git(wt, ["rebase", `origin/${EVIDENCE_BRANCH}`]) !== null) {
      pushed = r.git(wt, ["push", "-q", "origin", `HEAD:refs/heads/${EVIDENCE_BRANCH}`]) !== null;
    }
    if (!pushed) return fail(`the report was generated but could not push to ${EVIDENCE_BRANCH} (rejected, or no write access) — nothing changed there; run it again`);
    const sha = (r.git(wt, ["rev-parse", "--short", "HEAD"]) ?? "").trim();
    return {
      code: 0,
      lines: [...res.lines, `Committed on ${EVIDENCE_BRANCH}${sha ? ` (${sha})` : ""}:`, ...res.files.map((f) => `  ${f}`),
        `  Read them: git fetch origin ${EVIDENCE_BRANCH} && git show origin/${EVIDENCE_BRANCH}:<path above>`],
    };
  } finally {
    r.git(home, ["worktree", "remove", "--force", wt]);
    r.removeDir(wt);
  }
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
