// SPDX-License-Identifier: LicenseRef-Svayam-Proprietary
/**
 * Policy-declared credential NEEDs (credential-seam, governance half). Every port/seam that requires a
 * credential DECLARES its key in the org's `knowledge/deployment/{build,deploy}-policy.yaml` under a
 * `credentials:` list — the policy is the single source of truth for *what keys are needed*, not code.
 * `gov-work creds` reads those declarations, turns each into a NEED, and prompts for whatever isn't yet
 * in the user's credential store.
 *
 * gov-work is dependency-free by design (it hand-parses org-config.yaml), so this is a minimal
 * line-oriented reader of the `credentials:` block (single-line values) — NOT a full YAML parser. The
 * consuming side (gov-operate) parses the same block with its real YAML lib.
 */
import * as path from "node:path";
import type { Need, NeedProbes } from "./needs.js";

/** One declared credential requirement (a `credentials:` list item in a policy). */
export interface PolicyCredDecl {
  /** the credential-store key (also the prompt subject). */
  readonly key: string;
  /** one-line human title shown in the NEED/GAP summary. */
  readonly title?: string;
  /** where/how to obtain it — shown when this is a GAP. */
  readonly where?: string;
  /** the env var a consumer materializes the value into (gov-operate); default = the key. */
  readonly env?: string;
}

const FIELDS = new Set(["key", "title", "where", "env"]);
const clean = (v: string): string => v.replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");

/** Parse the `credentials:` list from a policy YAML. Line-oriented, single-line values. Everything
 *  outside the block is ignored; a dedent to a top-level key ends it. */
export function parseCredentialDecls(text: string): PolicyCredDecl[] {
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && !/^credentials\s*:\s*(#.*)?$/.test(lines[i])) i++;
  if (i >= lines.length) return [];
  const out: PolicyCredDecl[] = [];
  let cur: Record<string, string> | null = null;
  const push = (): void => {
    if (cur && cur.key) out.push({ key: cur.key, title: cur.title, where: cur.where, env: cur.env });
    cur = null;
  };
  for (i++; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === "" || /^\s*#/.test(raw)) continue;
    if (raw.length - raw.trimStart().length === 0) break;         // top-level key → block ended
    const dash = /^\s*-\s+(.*)$/.exec(raw);
    if (dash) push();
    if (dash) cur = {};
    const body = dash ? dash[1] : raw;
    const kv = /^\s*([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(body);
    if (kv && cur && FIELDS.has(kv[1])) cur[kv[1]] = clean(kv[2]);
  }
  push();
  return out;
}

/** Turn declarations into NEEDs (satisfied ⇔ the key is already in the credential store). */
export function policyCredNeeds(decls: readonly PolicyCredDecl[]): Need[] {
  return decls.map((c) => ({
    id: c.key,
    title: c.title ?? `credential ${c.key}`,
    credKey: c.key,
    instructions: `${c.where ?? `Provide the value for ${c.key}.`}\n  Paste it below — gov saves it for you.`,
    satisfied: (p: NeedProbes) => p.hasCred(c.key),
  }));
}

/** The build + deploy policy files under the governance repo's `knowledge/deployment/`. */
export function policyPaths(govHome: string): string[] {
  return ["build-policy.yaml", "deploy-policy.yaml"].map((f) => path.join(govHome, "knowledge", "deployment", f));
}

/** Read + de-dupe the credential NEEDs declared across the org's build + deploy policies. First
 *  declaration of a key wins (build before deploy). */
export function readPolicyCredNeeds(readFile: (p: string) => string | null | undefined, govHome: string): Need[] {
  const decls: PolicyCredDecl[] = [];
  const seen = new Set<string>();
  for (const p of policyPaths(govHome)) {
    const text = readFile(p);
    if (!text) continue;
    for (const d of parseCredentialDecls(text)) if (!seen.has(d.key)) { seen.add(d.key); decls.push(d); }
  }
  return policyCredNeeds(decls);
}
