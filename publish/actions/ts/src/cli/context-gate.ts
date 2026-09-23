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
import { tryRun as tryRunProcess } from "../run-process.js";
import { prjResolveGov, workspaceStateMessage } from "../resolve/resolve-gov.js";
import { createNodeRegistryStore } from "../resolve/registry-store.js";
import { log } from "../log.js";
import { runContext } from "./run-context.js";
import { stateDir } from "../state-paths.js";
import { createNodeEnv } from "../resolve/node-env.js";
import { parseOrgConfig } from "../config/org-config.js";
import { readCliVersion } from "./main.js";
import {
  type ContextInfo, type Ack, contextFingerprint, hashText, renderBanner, isAcked, recordAck,
} from "./context-banner.js";

function tryRun(cmd: string, args: string[]): string | undefined {
  return tryRunProcess(cmd, args, { pgm: "gov-work:cli:context-gate" }) || undefined;
}

/** Resolve the invocation context from gov-work's own primitives. Fully defensive — never throws. */
function buildContextInfo(): ContextInfo {
  const services: Record<string, string | undefined> = {};
  const anomalies: string[] = [];
  let govRepo: string | undefined, orgConfigPath: string | undefined, orgConfigHash: string | undefined, branch: string | undefined, agentWorkRoot: string | undefined;
  let unresolved: string | undefined;
  try {
    const resolve = prjResolveGov(createNodeEnv());
    if (!resolve.ok) {
      let orgs: string[] = [];
      try { orgs = createNodeRegistryStore().readHomes().map((h) => h.org); } catch { /* unreadable → none */ }
      unresolved = workspaceStateMessage(resolve, orgs).text;
    }
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
      } catch { /* reported to the person as an anomaly on the banner, which is this function's whole job */ anomalies.push("org-config.yaml not found/readable"); }
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
  // ONE REMEDY, the same one doctor gives (PRJ-121, 2026-09-22). This said "run `gov setup` / `gov org use`":
  // two commands, each right for only one role, printed right after install to someone who has not been asked
  // their role yet. `gov` starts the first-run flow, which asks.
  // WHICH failure it is (PRJ-121, 2026-09-22): "not set up" only when nothing is registered — see workspaceStateMessage.
  if (!govRepo) anomalies.push(unresolved ?? "no organization set up on this machine yet — `gov` asks whether you are adopting the framework or joining your organization's");
  else if (!services.vault) anomalies.push("vault not configured (vault_addr) — governed creds/deploys need it");
  // WHAT gov DECIDED IT WAS LOOKING AT (PRJ-121, 2026-09-23). Every "why did it do that?" starts here: which
  // mode, which workspace, which branch. A walk spent a morning on a dead active org that this line names.
  log("info", "context resolved", "gov-work:cli:context-gate", "gather",
    { mode, govRepo, projectPath, branch, orgConfig: orgConfigPath, anomalies });
  return { mode, projectPath, agentWorkRoot, govRepo, orgConfigPath, orgConfigHash, user, branch, services, anomalies };
}

/**
 * WHERE THE ACKNOWLEDGEMENT LIVES (Policy Owner, 2026-09-23, preferences design §6 decision 3).
 *
 * It was `~/.gov-context-ack.json`: one file in the home directory, holding every org's acknowledgements
 * together. It is gov's own state about ONE org's context, so it belongs with that org, in the person's
 * folder — `<work-root>/preferences/<gh-login>/state/ack.json`. The old file is still READ, once, so nobody is
 * asked again for something they already confirmed; it is never written to again.
 */
export const ackFileLegacy = (home: string = process.env.HOME ?? process.env.USERPROFILE ?? "."): string =>
  path.join(home, ".gov-context-ack.json");

/** The acknowledgement's home: the person's state folder when gov knows whose it is, else the legacy file. PURE. */
export function ackFileFor(workRoot: string | null, login: string | null, home?: string): string {
  return workRoot && login ? path.join(stateDir(workRoot, login), "ack.json") : ackFileLegacy(home);
}

const ackFile = (): string => { const { workRoot, login } = runContext(); return ackFileFor(workRoot, login); };
const readJson = (f: string): Ack[] => { try { return JSON.parse(fsSync.readFileSync(f, "utf8")) as Ack[]; } catch { /* absent or unreadable is the ordinary answer here, not a failure */ return []; } };
const readAcks = (): Ack[] => {
  const here = readJson(ackFile());
  if (here.length) return here;
  const legacy = readJson(ackFileLegacy());        // read once, so an upgrade does not re-ask
  return legacy;
};
const writeAcks = (acks: Ack[]): void => {
  try {
    const f = ackFile();
    fsSync.mkdirSync(path.dirname(f), { recursive: true });
    fsSync.writeFileSync(f, JSON.stringify(acks), { mode: 0o600 });
  } catch { /* best effort */ }
};

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
  // NOTHING RESOLVED, NOTHING TO CONFIRM (PRJ-121, 2026-09-22). The gate exists so you cannot act on the wrong
  // org, repo or branch after they change. In `none` mode there is no org, repo or branch — so on a fresh machine
  // it asked a bare `Proceed? (y/N)` over "context: NONE", right after the installer promised to show each command
  // before running it, and in front of a READ-ONLY report. It guarded nothing and could not be answered
  // meaningfully. The banner still shows; the first REAL context still gets confirmed.
  if (info.mode === "none") return true;
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
