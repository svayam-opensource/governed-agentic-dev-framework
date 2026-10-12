// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * ORG-AUTHORED CHECK ACTIONS: `bash` AND `python` (PRJ-121 intent 05, Item 8; Policy Owner ruling Q8, 2026-10-12).
 *
 * An organization that needs a check the builtins cannot express writes one under `policies/actions/<name>/`, the
 * Check Owner reviews it (CODEOWNERS), and a rule row binds it as `bash/<name>` or `python/<name>` (the catalog
 * entry, `policies/rules/checks-catalog.yaml`). THE CONTRACT:
 *
 *   policies/actions/<name>/action.yaml     tool: bash | python      (must agree with the catalog entry's tool)
 *                                           entry: run.sh | run.py   (a file in the same folder)
 *                                           timeout: 60              (seconds; optional, default 60)
 *                                           needs: [github]          (optional; the only need there is)
 *   in   env  GOV_RULE_ID, GOV_EVENT, GOV_RESOURCE, GOV_REPO_DIR (also the working directory), GOV_PARAMS (the
 *             binding's `with:` as JSON), GOV_CHANGED_FILES (a file: one changed path per line; empty when the
 *             event has no changeset)
 *   out  exit code  0 pass · 1 miss (the binding's `on_miss` decides fail or warn) · anything else cannot-tell
 *        stdout     optional JSON lines {"rule"?, "file"?, "line"?, "message"} — each one a finding; any other
 *                   line is the action's own log and is ignored
 *   a timeout, a missing interpreter, an unreadable action.yaml → cannot-tell, never a pass.
 *
 * SAFETY (spec §6 "Running org code"):
 *   - The code is read from the DEFAULT BRANCH only, as the rules are, and materialised into a temp dir. A pull
 *     request that changes `policies/actions/` cannot run its own new code before it merges (Q13).
 *   - The child env is an ALLOW-LIST: nothing of gov's own env is inherited. No GitHub or gov token reaches the
 *     action unless its action.yaml declares `needs: [github]` — then GH_TOKEN and GITHUB_TOKEN, nothing more.
 *   - A timeout kills it.
 *
 * {@link runOrgAction} is pure over the injected tree and {@link ActionExecutor}; {@link createNodeActionExecutor}
 * is the one adapter that touches the disk and a process (through run-process.ts, so it is logged).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import yaml from "js-yaml";
import { runCapture } from "../../run-process.js";
import type { Action } from "../model/catalog.js";
import type { EventContext } from "../model/contracts.js";
import type { BuiltinOutcome } from "./builtin.js";

/** Where org action code lives, in the governance repository. */
export const ACTIONS_DIR = "policies/actions";
/** The tools this executor runs. */
export const ORG_TOOLS = ["bash", "python"] as const;
export type OrgTool = (typeof ORG_TOOLS)[number];
const KNOWN_NEEDS = ["github"] as const;
const DEFAULT_TIMEOUT_SEC = 60;
const MAX_TIMEOUT_SEC = 600;

/**
 * What a child gets of the parent's env, by name. Everything else — every token, every cloud credential, every
 * GOV_* setting of gov's own — stays behind. GitHub's own non-secret run facts are passed so an action can say
 * where it ran.
 */
export const ENV_ALLOW_LIST = [
  "PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TMPDIR", "TERM", "CI",
  "GITHUB_ACTIONS", "GITHUB_REPOSITORY", "GITHUB_EVENT_NAME", "GITHUB_SHA", "GITHUB_REF", "GITHUB_SERVER_URL", "GITHUB_RUN_ID",
] as const;
/** Added only when action.yaml says `needs: [github]`. */
export const GITHUB_TOKEN_VARS = ["GH_TOKEN", "GITHUB_TOKEN"] as const;

export interface ActionSpec {
  readonly tool: OrgTool;
  readonly entry: string;
  readonly timeoutSec: number;
  readonly needs: readonly string[];
}

/** One run, fully decided: the executor adds only GOV_CHANGED_FILES (the path of the file it writes). */
export interface ActionRun {
  readonly tool: OrgTool;
  /** The entry script, relative to the action folder. */
  readonly entry: string;
  /** The action folder from the default branch: path relative to the folder → text. */
  readonly files: Readonly<Record<string, string>>;
  /** The working directory — the checked-out repository the check judges. */
  readonly cwd: string;
  /** The child's WHOLE env (already allow-listed). */
  readonly env: Readonly<Record<string, string>>;
  readonly changedFiles: readonly string[];
  readonly timeoutMs: number;
}

export type ActionResult =
  | { readonly kind: "exited"; readonly status: number; readonly stdout: string; readonly stderr: string }
  | { readonly kind: "timed-out"; readonly stdout: string; readonly stderr: string }
  | { readonly kind: "not-found"; readonly command: string }
  | { readonly kind: "error"; readonly message: string };

/** The port: run one action to completion. Synchronous, as the runner is. */
export interface ActionExecutor {
  run(r: ActionRun): ActionResult;
}

/** `action.yaml` → the spec, or why not. */
export function parseActionSpec(text: string): { ok: true; spec: ActionSpec } | { ok: false; reason: string } {
  let doc: unknown;
  try {
    doc = yaml.load(text, { schema: yaml.JSON_SCHEMA });
  } catch (e) {
    return { ok: false, reason: `is not YAML (${e instanceof Error ? e.message.split("\n")[0] : String(e)})` };
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { ok: false, reason: "is not a map" };
  const d = doc as Record<string, unknown>;
  if (!(ORG_TOOLS as readonly unknown[]).includes(d.tool)) return { ok: false, reason: `says tool "${String(d.tool)}" — it must be bash or python` };
  if (typeof d.entry !== "string" || !d.entry.trim()) return { ok: false, reason: "names no entry script (`entry: run.sh`)" };
  const entry = d.entry.trim();
  if (path.posix.isAbsolute(entry) || path.posix.normalize(entry).split("/").includes("..")) {
    return { ok: false, reason: `entry "${entry}" leaves the action's folder` };
  }
  let timeoutSec = DEFAULT_TIMEOUT_SEC;
  if (d.timeout !== undefined) {
    if (typeof d.timeout !== "number" || !(d.timeout > 0) || d.timeout > MAX_TIMEOUT_SEC) {
      return { ok: false, reason: `timeout must be a number of seconds above 0 and at most ${MAX_TIMEOUT_SEC}` };
    }
    timeoutSec = d.timeout;
  }
  const needsRaw = d.needs === undefined ? [] : d.needs;
  if (!Array.isArray(needsRaw) || !needsRaw.every((n) => typeof n === "string")) return { ok: false, reason: "needs must be a list (`needs: [github]`)" };
  const unknown = needsRaw.filter((n) => !(KNOWN_NEEDS as readonly string[]).includes(n));
  if (unknown.length) return { ok: false, reason: `needs ${unknown.map((n) => `"${n}"`).join(", ")}, which gov does not know (only: ${KNOWN_NEEDS.join(", ")})` };
  return { ok: true, spec: { tool: d.tool as OrgTool, entry: path.posix.normalize(entry), timeoutSec, needs: needsRaw as string[] } };
}

export interface OrgActionInput {
  readonly ruleId: string;
  readonly action: Action;
  readonly params: Readonly<Record<string, unknown>>;
  readonly ctx: EventContext;
  /** A file at the DEFAULT branch of the governance repository, or null. */
  readonly readDefault: (p: string) => string | null;
  /** Every file under a folder at the DEFAULT branch (repository-relative), or null when it cannot be listed. */
  readonly listDefault?: (dir: string) => readonly string[] | null;
  readonly executor?: ActionExecutor;
  /** The parent env the allow-list is taken from. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The checked-out repository the check judges. */
  readonly repoDir?: string;
}

const cannot = (findings: string[]): BuiltinOutcome => ({ verdict: "cannot-tell", findings });

/** Run one org `bash`/`python` action under the contract above. A `miss` is turned into fail or warn by the runner. */
export function runOrgAction(input: OrgActionInput): BuiltinOutcome {
  const { ruleId, action, ctx } = input;
  const tag = `${ruleId} [${action.id}]`;
  const name = action.id.slice(action.id.indexOf("/") + 1);
  const dir = `${ACTIONS_DIR}/${name}`;
  if (!input.executor || !input.listDefault || input.repoDir === undefined) {
    return cannot([`${tag}: gov cannot run a ${action.tool} action here (no checkout to run it in), so nothing was checked.`]);
  }
  const listed = input.listDefault(dir);
  if (listed === null) return cannot([`${tag}: ${dir}/ could not be listed on the default branch, so nothing was checked.`]);
  const specText = listed.includes(`${dir}/action.yaml`) ? input.readDefault(`${dir}/action.yaml`) : null;
  if (specText === null) {
    return cannot([`${tag}: ${dir}/action.yaml is not on the default branch — an action runs only once it has merged there, so nothing was checked.`]);
  }
  const parsed = parseActionSpec(specText);
  if (!parsed.ok) return cannot([`${tag}: ${dir}/action.yaml ${parsed.reason}, so nothing was checked.`]);
  const spec = parsed.spec;
  if (spec.tool !== action.tool) return cannot([`${tag}: ${dir}/action.yaml says tool "${spec.tool}" but the catalog binds it as ${action.tool}, so nothing was checked.`]);
  if (!listed.includes(`${dir}/${spec.entry}`)) return cannot([`${tag}: entry "${spec.entry}" is not in ${dir}/ on the default branch, so nothing was checked.`]);

  const files: Record<string, string> = {};
  for (const p of listed) {
    const text = input.readDefault(p);
    if (text === null) return cannot([`${tag}: ${p} could not be read from the default branch, so nothing was checked.`]);
    files[p.slice(dir.length + 1)] = text;
  }

  const parent = input.env ?? {};
  const env: Record<string, string> = {};
  const pass = (k: string) => { const v = parent[k]; if (v !== undefined) env[k] = v; };
  ENV_ALLOW_LIST.forEach(pass);
  if (spec.needs.includes("github")) GITHUB_TOKEN_VARS.forEach(pass);
  Object.assign(env, {
    GOV_RULE_ID: ruleId,
    GOV_EVENT: ctx.event,
    GOV_RESOURCE: ctx.resource,
    GOV_REPO_DIR: input.repoDir,
    GOV_PARAMS: JSON.stringify(input.params ?? {}),
  });
  const changed = Array.isArray(ctx.payload.changed)
    ? (ctx.payload.changed as { path?: unknown }[]).map((f) => f?.path).filter((p): p is string => typeof p === "string")
    : [];

  const r = input.executor.run({ tool: spec.tool, entry: spec.entry, files, cwd: input.repoDir, env, changedFiles: changed, timeoutMs: Math.round(spec.timeoutSec * 1000) });
  switch (r.kind) {
    case "not-found": return cannot([`${tag}: ${r.command} not found on this machine, so nothing was checked.`]);
    case "error": return cannot([`${tag}: the action could not start (${r.message}), so nothing was checked.`]);
    case "timed-out": return cannot([`${tag}: timed out after ${spec.timeoutSec}s, so nothing was checked.`]);
    default: break;
  }
  const findings = parseFindings(r.stdout, ruleId).map((f) => `${tag}: ${f}`);
  if (r.status === 0) return { verdict: "pass", findings };
  if (r.status === 1) return { verdict: "miss", findings: findings.length ? findings : [`${tag}: the action reported a miss (exit 1) and gave no finding.`] };
  const err = r.stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(" · ").slice(0, 300);
  return cannot([`${tag}: the action exited ${r.status}${err ? ` (${err})` : ""} — only 0 (pass) and 1 (miss) are verdicts, so nothing was checked.`, ...findings]);
}

/** The JSON lines on stdout that are findings. Any other line is the action's own log. */
function parseFindings(stdout: string, ruleId: string): string[] {
  const out: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    let o: unknown;
    try { o = JSON.parse(t); } catch { continue; /* not JSON: the action's own log line */ }
    if (!o || typeof o !== "object") continue;
    const f = o as Record<string, unknown>;
    const message = typeof f.message === "string" ? f.message : typeof f.finding === "string" ? f.finding : undefined;
    if (!message) continue;
    const where = typeof f.file === "string" && f.file ? `${f.file}${typeof f.line === "number" ? `:${f.line}` : ""}: ` : "";
    const rule = typeof f.rule === "string" && f.rule && f.rule !== ruleId ? `(${f.rule}) ` : "";
    out.push(`${rule}${where}${message}`);
  }
  return out;
}

/** The interpreters, overridable for a test that needs one to be missing. */
export interface NodeExecutorOptions { readonly bash?: string; readonly python?: string }

/** The real executor: a temp dir with the action's files and the changed-files list, the interpreter, then cleanup. */
export function createNodeActionExecutor(opts: NodeExecutorOptions = {}): ActionExecutor {
  return {
    run(r: ActionRun): ActionResult {
      const command = r.tool === "bash" ? (opts.bash ?? "bash") : (opts.python ?? "python3");
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gov-action-"));
      try {
        const code = path.join(tmp, "action");
        for (const [rel, text] of Object.entries(r.files)) {
          const abs = path.join(code, rel);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, text);
        }
        const changedFile = path.join(tmp, "changed-files.txt");
        fs.writeFileSync(changedFile, r.changedFiles.join("\n"));
        const res = runCapture(command, [path.join(code, r.entry)], {
          cwd: r.cwd, env: { ...r.env, GOV_CHANGED_FILES: changedFile }, timeoutMs: r.timeoutMs,
          pgm: "gov-work:rules:checks:executor", fn: "run", meta: { tool: r.tool },
        });
        // `python3` is the name the ruling gives; a test may name another missing command.
        if (res.notFound) return { kind: "not-found", command: r.tool === "python" ? "python3" : command };
        if (res.timedOut) return { kind: "timed-out", stdout: res.stdout, stderr: res.stderr };
        if (res.status === null) return { kind: "error", message: res.error ?? "killed by a signal" };
        return { kind: "exited", status: res.status, stdout: res.stdout, stderr: res.stderr };
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  };
}
