// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov rules build | check | report` — the disk and terminal side of the compiler.
 *
 * THREE MODES, ONE COMPUTATION. `check` must fail exactly when the committed artifacts differ from what `build`
 * would write, so both call the same `build()` and differ only in what they do with the answer. Two code paths
 * computing "what should be there" is how a freshness check comes to pass on a stale file — which is the state
 * `render-harness.mjs --check` was already in: implemented, and called by nothing.
 *
 * READ FROM THE DEFAULT BRANCH by default. A policy edited on a project branch is a PROPOSAL (POL-086b); compile
 * it into the resident block and an agent starts obeying a rule nobody ratified — self-governance delivered into
 * the one place guaranteed to be read. `--working-tree` exists for the author who is drafting and wants to see
 * their own compile report, and it says so in the output every time.
 */
import * as path from "node:path";
import { build, renderRuleMap, type PolicyDoc } from "../rules/rules-build.js";
import { renderAll, type RenderFailure } from "../rules/harness-render.js";
import { LOCK_FILE, parseLock, writeLock, parseLegacyYamlLock, nextFree } from "../rules/pol-lock-io.js";
import { FRAMEWORK_POL_START } from "../rules/pol-lock.js";
import { POLICY_ROOTS, type GitRead } from "./policy-gate-io.js";
import type { Fs } from "../lifecycle/fs-io.js";

export interface RulesDeps {
  readonly fs: Fs;
  readonly git?: GitRead;
}

export interface RulesInput {
  /** The governance repository (or the project worktree, which is the same repository). */
  readonly home: string;
  /** The ratified branch. Ignored with `workingTree`. */
  readonly defaultBranch: string;
  /** Compile what is on disk instead of what is ratified — for an author mid-draft. */
  readonly workingTree?: boolean;
  /** Where the protocol body lives, relative to `home`. */
  readonly protocolPath?: string;
  /** POL numbers whose rewording the owner has confirmed — the answer to a `build` that stopped and asked. */
  readonly confirm?: readonly string[];
}

export interface RulesResult {
  readonly code: number;
  readonly lines: readonly string[];
}

const PROTOCOL = path.join("agent", "session-protocol.md");
const LOCK_DIR = path.join("framework", "policies");
const RULE_MAP = path.join("agent", "harness", "rule-map.md");
const isFailure = (x: unknown): x is RenderFailure => typeof x === "object" && x !== null && "error" in x;

/** Every policy document, from the ratified branch or from disk. */
export function readPolicyDocs(deps: RulesDeps, input: RulesInput): PolicyDoc[] {
  if (input.workingTree) {
    const docs: PolicyDoc[] = [];
    for (const root of POLICY_ROOTS) {
      for (const name of deps.fs.readdir(path.join(input.home, root)).sort()) {
        if (!name.endsWith(".md")) continue;
        const text = deps.fs.readFile(path.join(input.home, root, name));
        if (text !== null) docs.push({ path: `${root}/${name}`, text });
      }
    }
    return docs;
  }
  const git = deps.git;
  if (!git) return [];
  const listing = git(input.home, ["ls-tree", "-r", "--name-only", input.defaultBranch, "--", ...POLICY_ROOTS]);
  if (listing === null) return [];
  const docs: PolicyDoc[] = [];
  for (const rel of listing.split("\n").map((l) => l.trim()).filter((l) => l.endsWith(".md"))) {
    const text = git(input.home, ["show", `${input.defaultBranch}:${rel}`]);
    if (text !== null) docs.push({ path: rel, text });
  }
  return docs;
}

/**
 * Read the lock, migrating the interim YAML one if that is what is on disk.
 *
 * The framework already SHIPPED `.pol-lock.yaml`, so an adopter may hold one. Refusing to read it would discard
 * every number the framework had allocated — the one outcome the lock exists to prevent — so it is read once and
 * rewritten as JSON.
 */
function readLock(deps: RulesDeps, home: string): { lock?: ReturnType<typeof parseLock>["lock"]; error?: string; migrated?: boolean } {
  const json = deps.fs.readFile(path.join(home, LOCK_DIR, LOCK_FILE));
  if (json !== null) return parseLock(json, FRAMEWORK_POL_START);
  const yaml = deps.fs.readFile(path.join(home, LOCK_DIR, ".pol-lock.yaml"));
  if (yaml !== null) {
    const legacy = parseLegacyYamlLock(yaml);
    return legacy.lock ? { lock: legacy.lock, migrated: true } : { error: legacy.error! };
  }
  return parseLock(null, FRAMEWORK_POL_START);
}

/** What `build`/`check` would write, and why it might refuse. */
export function plan(deps: RulesDeps, input: RulesInput): {
  readonly result?: { files: { path: string; content: string }[]; report: readonly string[]; asks: readonly { readonly message: string; readonly candidate?: string }[]; diagnostics: readonly string[]; lockText?: string; migrated?: boolean };
  readonly error?: string;
} {
  const docs = readPolicyDocs(deps, input);
  if (!docs.length) {
    return {
      error: input.workingTree
        ? `no policy documents under ${POLICY_ROOTS.join(" or ")} in ${input.home}.`
        : `no policy documents found on ${input.defaultBranch}. Is this a governance repository, and is that branch fetched?`,
    };
  }
  const got = readLock(deps, input.home);
  if (got.error || !got.lock) return { error: got.error ?? "could not read the lock" };

  const built = build(docs, got.lock, input.confirm ?? []);
  const protocol = deps.fs.readFile(path.join(input.home, input.protocolPath ?? PROTOCOL));
  if (protocol === null) return { error: `${input.protocolPath ?? PROTOCOL} is missing — it is the body every agent file is rendered from.` };

  const rendered = renderAll(protocol, docs);
  if (isFailure(rendered)) return { error: rendered.error };

  const files = [
    ...rendered.files.map((f) => ({ path: path.join("agent", "harness", f.path), content: f.content })),
    { path: RULE_MAP, content: renderRuleMap(built.map) },
  ];
  const lockWrite = writeLock(got.lock, built.lock);
  if (lockWrite.error) return { error: lockWrite.error };

  return {
    result: {
      files, report: built.report, asks: built.asks,
      diagnostics: built.diagnostics.map((d) => `  ${d.doc} §${d.section}:${d.line}  ${d.kind} — ${d.message}`),
      ...(lockWrite.text ? { lockText: lockWrite.text } : {}),
      ...(got.migrated ? { migrated: true } : {}),
    },
  };
}

/** `gov rules <mode>`. */
export function rules(deps: RulesDeps, input: RulesInput, mode: "build" | "check" | "report"): RulesResult {
  const { result, error } = plan(deps, input);
  if (error || !result) return { code: 1, lines: [`gov rules ${mode}: ${error ?? "failed"}`] };

  const source = input.workingTree ? "the WORKING TREE (unratified — an agent is governed by the default branch)" : input.defaultBranch;
  const head = [`gov rules ${mode} — from ${source}`, ""];

  if (mode === "report") {
    return { code: result.diagnostics.length ? 1 : 0, lines: [...head, ...result.report, ...(result.diagnostics.length ? ["", `notation errors (${result.diagnostics.length})`, ...result.diagnostics] : [])] };
  }

  // A question must stop a write. Reusing a number would hand a reworded clause an approval it never had;
  // allocating a fresh one would leave every existing citation pointing at a retired rule.
  if (result.asks.length) {
    const candidates = [...new Set(result.asks.map((a) => a.candidate).filter((c): c is string => Boolean(c)))];
    return {
      code: 1,
      lines: [
        ...head,
        `${result.asks.length} clause(s) cannot be numbered without a decision:`,
        "",
        ...result.asks.map((a) => `  ${a.message}`),
        "",
        "Read each clause. If it IS the reworded rule that number names, confirm it — the old text is kept in the",
        "entry's history, so an audit can still say which wording the number was allocated for:",
        "",
        ...(candidates.length ? [`  gov rules build --confirm ${candidates.join(",")}`, ""] : []),
        "If it is a NEW rule instead, give it its own number in the clause and run build again.",
        "",
        "Nothing was written.",
      ],
    };
  }
  if (result.diagnostics.length) {
    return { code: 1, lines: [...head, `${result.diagnostics.length} notation error(s) — fix these first:`, "", ...result.diagnostics, "", "Nothing was written."] };
  }

  const stale: string[] = [];
  for (const f of result.files) {
    if (deps.fs.readFile(path.join(input.home, f.path)) !== f.content) stale.push(f.path);
  }
  if (result.lockText && deps.fs.readFile(path.join(input.home, LOCK_DIR, LOCK_FILE)) !== result.lockText) stale.push(`${LOCK_DIR}/${LOCK_FILE}`);

  if (mode === "check") {
    return stale.length
      ? { code: 1, lines: [...head, `${stale.length} generated file(s) are stale:`, ...stale.map((s) => `  ${s}`), "", "Run `gov rules build` and commit the result."] }
      : { code: 0, lines: [...head, "every generated file matches the policies.", ...result.report] };
  }

  for (const f of result.files) deps.fs.writeFile(path.join(input.home, f.path), f.content);
  if (result.lockText) deps.fs.writeFile(path.join(input.home, LOCK_DIR, LOCK_FILE), result.lockText);
  // The interim YAML lock is removed only once its JSON replacement is safely written — never before, or a
  // failed write between the two would leave a workspace with no lock and every number unaccounted for.
  if (result.migrated) deps.fs.rm(path.join(input.home, LOCK_DIR, ".pol-lock.yaml"));

  return {
    code: 0,
    lines: [
      ...head,
      `wrote ${result.files.length} file(s)${result.lockText ? " and the lock" : ""}${result.migrated ? " (migrated .pol-lock.yaml → .pol-lock.json)" : ""}.`,
      ...(stale.length ? [] : ["  (nothing had changed)"]),
      "",
      ...result.report,
      "",
      `next POL number: ${nextFree(parseLock(result.lockText ?? null, FRAMEWORK_POL_START).lock!)}`,
      "",
      "Restart any running agent session: a session cannot pick up new rules in place.",
    ],
  };
}
