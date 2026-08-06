// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The CONTEXT GATE: show where this invocation is acting, and prompt when that has CHANGED.
 *
 * This file used to be the plugin HOST as well — it discovered `gov-cicd` and `do-admin` at runtime,
 * merged their verbs into the menu, and delegated governed invocations to them. That is gone: `gov`,
 * `gov-cicd` and `gov-infra` are three independent clients now, each invoked directly
 * (adr-three-clients, PRJ-43). What remains is gov-work's own business — telling you which org, which
 * repo and which branch you are about to act on, and making you confirm when that answer changes.
 */
import * as path from "node:path";
import * as fsSync from "node:fs";
import * as readline from "node:readline";
import { spawnSync } from "node:child_process";
import { prjResolveGov } from "../resolve/resolve-gov.js";
import { createNodeEnv } from "../resolve/node-env.js";
import { parseOrgConfig } from "../config/org-config.js";
import { readCliVersion } from "./main.js";
import {
  type ContextInfo, type Ack, contextFingerprint, hashText, renderBanner, isAcked, recordAck,
} from "./context-banner.js";

function tryRun(cmd: string, args: string[]): string | undefined {
  try { const r = spawnSync(cmd, args, { encoding: "utf8" }); return r.status === 0 ? r.stdout.trim() || undefined : undefined; } catch { return undefined; }
}

/** Resolve the invocation context from gov-work's own primitives. Fully defensive — never throws. */
function buildContextInfo(): ContextInfo {
  const services: Record<string, string | undefined> = {};
  const anomalies: string[] = [];
  let govRepo: string | undefined, orgConfigPath: string | undefined, orgConfigHash: string | undefined, branch: string | undefined, agentWorkRoot: string | undefined;
  try {
    const resolve = prjResolveGov(createNodeEnv());
    if (resolve.ok) {
      govRepo = resolve.home;
      const p = path.join(resolve.home, "org-config.yaml");
      try {
        const text = fsSync.readFileSync(p, "utf8");
        orgConfigPath = p; orgConfigHash = hashText(text);
        const c = parseOrgConfig(text);
        agentWorkRoot = c.agentWorkRoot || undefined;
        if (c.vaultAddr) services.vault = c.vaultAddr;
        Object.assign(services, c.services);   // oidc/jenkins/npm/docker from the now-typed `services:` block
      } catch { anomalies.push("org-config.yaml not found/readable"); }
      branch = tryRun("git", ["-C", resolve.home, "rev-parse", "--abbrev-ref", "HEAD"]);
    }
  } catch { /* unresolved → none mode */ }
  let projectPath: string | undefined;
  const cwd = process.cwd();
  if (agentWorkRoot && cwd.startsWith(agentWorkRoot + path.sep)) {
    const seg = path.relative(agentWorkRoot, cwd).split(path.sep)[0];
    if (seg) projectPath = path.join(agentWorkRoot, seg);
  }
  const mode: ContextInfo["mode"] = projectPath ? "project" : govRepo ? "governed" : "none";
  const user = tryRun("git", ["config", "user.email"]) ?? tryRun("gh", ["api", "user", "--jq", ".login"]);
  if (!govRepo) anomalies.push("no gov workspace resolved — run `gov setup` / `gov org use`");
  else if (!services.vault) anomalies.push("vault not configured (vault_addr) — governed creds/deploys need it");
  return { mode, projectPath, agentWorkRoot, govRepo, orgConfigPath, orgConfigHash, user, branch, services, anomalies };
}

const ackFile = (): string => path.join(process.env.HOME ?? process.env.USERPROFILE ?? ".", ".gov-context-ack.json");
const readAcks = (): Ack[] => { try { return JSON.parse(fsSync.readFileSync(ackFile(), "utf8")) as Ack[]; } catch { return []; } };
const writeAcks = (acks: Ack[]): void => { try { fsSync.writeFileSync(ackFile(), JSON.stringify(acks), { mode: 0o600 }); } catch { /* best effort */ } };

async function promptYesNo(label: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => rl.question(label, (a) => { rl.close(); resolve(/^y(es)?$/i.test(a.trim())); }));
}

/** Show the banner (always) and prompt only on a CHANGED context fingerprint. Returns false to bail. */
export async function confirmContextOrBail(argv: readonly string[]): Promise<boolean> {
  if ("GOV_NO_BANNER" in process.env) return true;
  const info = buildContextInfo();
  const fp = contextFingerprint(info, undefined, readCliVersion());
  for (const l of renderBanner(info)) process.stderr.write(l + "\n");
  const now = Date.now();
  const acks = readAcks();
  if (isAcked(acks, fp, now)) return true;
  if ("GOV_YES" in process.env || argv.includes("--yes") || argv.includes("-y")) { writeAcks(recordAck(acks, fp, now)); return true; }
  if (!process.stdin.isTTY) {
    const expect = process.env.GOV_EXPECT_CONTEXT;
    if (expect && expect !== fp) { process.stderr.write(`context assertion FAILED — expected ${expect}, got ${fp} (see banner above)\n`); return false; }
    return true;
  }
  process.stderr.write(`  context changed (fp ${fp}). `);
  if (await promptYesNo("Proceed? (y/N) ")) { writeAcks(recordAck(acks, fp, now)); return true; }
  process.stderr.write("aborted — context not confirmed.\n");
  return false;
}
