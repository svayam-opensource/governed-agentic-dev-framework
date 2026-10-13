// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd. — part of the OSS governed-agentic-dev-framework.
/**
 * The I/O for `gov evidence` (evidence-verb.ts holds the logic). WHERE THE LEDGER IS READ FROM, in order:
 *   1. `--gov-home <path>` (or PRJ_GOV_HOME, or the resolved governance repo) that has `evidence/` at its top — an
 *      auditor's clone of the evidence branch (`git clone -b gov/evidence …`);
 *   2. else that repository's `gov/evidence` branch, read through git (`origin/gov/evidence` first, then the local
 *      branch) into a temporary folder that is removed afterwards. Nothing is fetched: verifying stays offline.
 * No org-config.yaml is needed — the evidence branch is an orphan and an auditor has nothing else.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseArgv, flagStr } from "./args.js";
import { evidenceCommand } from "./evidence-verb.js";
import { dirSource, type LedgerSource } from "../evidence/verify.js";
import { prjResolveGov } from "../resolve/resolve-gov.js";
import { createNodeEnv, expandTilde } from "../resolve/node-env.js";
import { runResult, tryRun } from "../run-process.js";
import { ensureCheckModule } from "../check-seam/evidence.js";
import { createKeychain } from "../security/keychain.js";
import { readCliVersion } from "./main.js";
import { randomBytes } from "node:crypto";
import { parseOrgConfig } from "../config/org-config.js";
import { evidenceEnable } from "../lifecycle/evidence-setup.js";
import { githubVcs } from "../adapters/github/vcs.js";
import { ghRunner } from "./app-verb.js";
import { startLoopback } from "./app-loopback.js";
import type { EvidenceResult } from "./evidence-verb.js";

export const EVIDENCE_BRANCH = "gov/evidence";

const PGM = "gov-work:cli:evidence";

export function ledgerSourceAt(home: string): { ok: true; src: LedgerSource; cleanup?: () => void } | { ok: false; line: string } {
  if (fs.existsSync(path.join(home, "evidence"))) return { ok: true, src: dirSource(home) };
  const git = (args: string[]) => runResult("git", ["-C", home, ...args], { pgm: PGM, fn: "ledgerSourceAt" });
  const ref = [`origin/${EVIDENCE_BRANCH}`, EVIDENCE_BRANCH].find((r) => git(["rev-parse", "--verify", "--quiet", `${r}^{commit}`]).status === 0);
  if (!ref) {
    return { ok: false, line: `no evidence at ${home}: no evidence/ folder and no ${EVIDENCE_BRANCH} branch — run \`git -C ${home} fetch origin ${EVIDENCE_BRANCH}\`, or pass --gov-home <a checkout of ${EVIDENCE_BRANCH}>` };
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gov-evidence-"));
  const cleanup = (): void => fs.rmSync(tmp, { recursive: true, force: true });
  const tar = path.join(tmp, "evidence.tar");
  const a = git(["archive", "--format=tar", "-o", tar, ref, "evidence"]);
  const x = a.status === 0 ? runResult("tar", ["-xf", tar, "-C", tmp], { pgm: PGM, fn: "ledgerSourceAt" }) : a;
  if (x.status !== 0) {
    cleanup();
    return { ok: false, line: `could not read evidence/ from ${ref} in ${home}: ${(x.stderr || "git archive failed").trim().split("\n")[0]}` };
  }
  const inner = dirSource(tmp);
  return { ok: true, src: { where: `${home} @ ${ref}`, list: inner.list, read: inner.read }, cleanup };
}

/** `gov evidence enable`: needs the governance repo's org-config.yaml (the org, the gov repo's name). */
async function enableAt(govHome: string | undefined): Promise<EvidenceResult> {
  const override = govHome ?? process.env.PRJ_GOV_HOME;
  let home: string;
  if (override) home = path.resolve(expandTilde(override));
  else {
    const resolved = prjResolveGov(createNodeEnv());
    if (!resolved.ok) return { code: 1, lines: ["gov evidence enable: no governance repo resolved here — run it in your gov repo, or pass --gov-home <path>"] };
    home = resolved.home;
  }
  let text: string;
  try { text = fs.readFileSync(path.join(home, "org-config.yaml"), "utf8"); } catch { return { code: 1, lines: [`gov evidence enable: no org-config.yaml at ${home}`] }; /* unreadable = absent: said plainly */ }
  const c = parseOrgConfig(text);
  return evidenceEnable({
    vcs: githubVcs(ghRunner("gov-work:cli:evidence")),
    loopback: startLoopback,
    newState: () => randomBytes(16).toString("hex"),
    say: (l) => process.stdout.write(`${l}\n`),
  }, { githubOrg: c.githubOrg, workspaceRepo: c.workspaceRepo, orgSlugLower: c.orgSlugLower });
}

export async function runEvidence(argv: readonly string[]): Promise<number> {
  const parsed = parseArgv(argv);
  if ("error" in parsed) { process.stderr.write(`${parsed.error}\n`); return 2; }
  const r = await evidenceCommand(parsed.positionals, parsed.flags, {
    source: (govHome) => {
      const override = govHome ?? flagStr(parsed.flags, "gov-home") ?? process.env.PRJ_GOV_HOME;
      if (override) return ledgerSourceAt(path.resolve(expandTilde(override)));
      const resolved = prjResolveGov(createNodeEnv());
      if (!resolved.ok) return { ok: false, line: "no governance repo resolved here — pass --gov-home <a checkout of gov/evidence, or the gov repo>" };
      return ledgerSourceAt(resolved.home);
    },
    enable: enableAt,
    report: {
      // The paid module, started like `gov pack` does; null = not installed / not licensed here.
      generator: async () => {
        const override = flagStr(parsed.flags, "gov-home") ?? process.env.PRJ_GOV_HOME;
        const m = await ensureCheckModule(
          { surface: "local", ...(override ? { govHome: path.resolve(expandTilde(override)) } : {}), env: process.env, govVersion: readCliVersion() },
          { keychain: createKeychain() },
        );
        return m.state === "active" ? m.module.reports : null;
      },
      home: (govHome) => {
        const override = govHome ?? process.env.PRJ_GOV_HOME;
        if (override) return { ok: true, home: path.resolve(expandTilde(override)) };
        const resolved = prjResolveGov(createNodeEnv());
        return resolved.ok ? { ok: true, home: resolved.home } : { ok: false, line: "no governance repo resolved here — pass --gov-home <the gov repo, or a clone of gov/evidence>" };
      },
      tmpDir: () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gov-report-")), "wt"),
      git: (cwd, args) => tryRun("git", ["-C", cwd, ...args], { pgm: PGM, fn: "report" }) ?? null,
      copyPolicies: (from, to) => {
        const src = path.join(from, "policies");
        if (fs.existsSync(src)) fs.cpSync(src, path.join(to, "policies"), { recursive: true });
      },
      removeDir: (abs) => fs.rmSync(path.dirname(abs), { recursive: true, force: true }),
    },
  });
  for (const line of r.lines) (r.code === 2 ? process.stderr : process.stdout).write(`${line}\n`);
  return r.code;
}
