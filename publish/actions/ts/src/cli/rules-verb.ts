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
 * READ FROM THE DEFAULT BRANCH by default. A policy edited on a project branch is a PROPOSAL (GOV-FRM-086); compile
 * it into the resident block and an agent starts obeying a rule nobody ratified — self-governance delivered into
 * the one place guaranteed to be read. `--working-tree` exists for the author who is drafting and wants to see
 * their own compile report, and it says so in the output every time.
 */
import * as path from "node:path";
import { build, renderRuleMap, isWarning, frameworkFirst, type PolicyDoc } from "../rules/rules-build.js";
import { renderAll, type RenderFailure } from "../rules/harness-render.js";
import { stampCues } from "../rules/cue-stamp.js";
import { LOCK_FILE, parseLock, writeLock, parseLegacyYamlLock, nextFree } from "../rules/pol-lock-io.js";
import { FRAMEWORK_POL_START, ORG_POL_START } from "../rules/pol-lock.js";
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
  /**
   * Re-stamp a cue whose clause changed but whose WORDING still holds — the "I re-read it and it is still right"
   * action. Never implied: an automatic re-stamp would silently approve every edit the staleness guard exists to
   * catch, so it has to be a thing a person types.
   */
  readonly restamp?: boolean;
}

export interface RulesResult {
  readonly code: number;
  readonly lines: readonly string[];
}

const PROTOCOL = path.join("agent", "session-protocol.md");
/** One lock per tree: the framework's numbers and an organization's are never mixed (POL ranges, design §3). */
const LOCK_DIRS = { framework: path.join("framework", "policies"), org: "policies" } as const;
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
function readLock(deps: RulesDeps, home: string, dir: string, start: number): { lock?: ReturnType<typeof parseLock>["lock"]; error?: string; migrated?: boolean } {
  const json = deps.fs.readFile(path.join(home, dir, LOCK_FILE));
  if (json !== null) return parseLock(json, start);
  const yaml = deps.fs.readFile(path.join(home, dir, ".pol-lock.yaml"));
  if (yaml !== null) {
    const legacy = parseLegacyYamlLock(yaml);
    return legacy.lock ? { lock: legacy.lock, migrated: true } : { error: legacy.error! };
  }
  return parseLock(null, start);
}

/** What `build`/`check` would write, and why it might refuse. */
export function plan(deps: RulesDeps, input: RulesInput): {
  readonly result?: { files: { path: string; content: string }[]; report: readonly string[]; asks: readonly { readonly message: string; readonly candidate?: string }[]; diagnostics: readonly string[]; locks: readonly { path: string; content: string }[]; stamps: readonly string[]; migrated?: boolean };
  readonly error?: string;
} {
  let docs = readPolicyDocs(deps, input);
  if (!docs.length) {
    return {
      error: input.workingTree
        ? `no policy documents under ${POLICY_ROOTS.join(" or ")} in ${input.home}.`
        : `no policy documents found on ${input.defaultBranch}. Is this a governance repository, and is that branch fetched?`,
    };
  }
  const fw = readLock(deps, input.home, LOCK_DIRS.framework, FRAMEWORK_POL_START);
  const org = readLock(deps, input.home, LOCK_DIRS.org, ORG_POL_START);
  if (fw.error || !fw.lock) return { error: fw.error ?? "could not read the framework lock" };
  if (org.error || !org.lock) return { error: org.error ?? "could not read the organization lock" };

  // STAMP THE CUES BEFORE COMPILING. A cue carrying `clause-sha=TBD` is one an author wrote and nobody hashed,
  // so `staleCues` reports every one of them and the real staleness — a clause edited without its cue being
  // re-approved — is lost in the noise. Filling the missing hashes is mechanical; approving a cue's WORDING is
  // not, and this does not do that (see `stampCues`: an existing hash is left alone).
  const stampedDocs = docs.map((d) => {
    const r = stampCues(d.path, d.text, input.restamp ? "restamp" : "fill-missing");
    return { doc: d, text: r.text, stamped: r.stamped };
  });
  const stamps = stampedDocs.flatMap((s) => s.stamped);
  const policyWrites = stampedDocs
    .filter((s) => s.text !== s.doc.text)
    .map((s) => ({ path: s.doc.path, content: s.text }));
  docs = stampedDocs.map((s) => ({ path: s.doc.path, text: s.text }));

  const built = build(docs, { framework: fw.lock, org: org.lock }, input.confirm ?? []);
  const protocol = deps.fs.readFile(path.join(input.home, input.protocolPath ?? PROTOCOL));
  if (protocol === null) return { error: `${input.protocolPath ?? PROTOCOL} is missing — it is the body every agent file is rendered from.` };

  // FRAMEWORK CUES FIRST, and `docs` is not in that order: `POLICY_ROOTS` lists `policies` before
  // `framework/policies`, so passing it straight through emitted the ORGANIZATION'S cues above the framework's —
  // the opposite of what §9.1 says, and a silent disagreement with `render-harness.mjs`, which ordered them
  // correctly. `build` sorts for its own purposes; the renderer needs the same order or the two producers of the
  // nine files differ by the one thing the wrapper exists to prevent.
  const rendered = renderAll(protocol, frameworkFirst(docs));
  if (isFailure(rendered)) return { error: rendered.error };

  const files = [
    // A stamped policy document is written back ONLY when the working tree was the source. The default read is
    // `git show <default>:<path>`, and writing that content into the worktree would put a ratified document's
    // bytes into somebody's branch as a side effect of a command they ran to LOOK at the rules.
    ...(input.workingTree ? policyWrites : []),
    ...rendered.files.map((f) => ({ path: path.join("agent", "harness", f.path), content: f.content })),
    { path: RULE_MAP, content: renderRuleMap(built.map) },
  ];
  const writes: { path: string; content: string }[] = [];
  for (const [which, dir] of Object.entries(LOCK_DIRS) as ["framework" | "org", string][]) {
    const before = which === "framework" ? fw.lock! : org.lock!;
    const w = writeLock(before, built.locks[which]);
    if (w.error) return { error: w.error };
    if (w.text) writes.push({ path: path.join(dir, LOCK_FILE), content: w.text });
  }

  return {
    result: {
      files, report: built.report, asks: built.asks,
      // Only ERRORS block. A warning is a backlog item, and a build that refuses until a 150-item backlog is
      // cleared is a build nobody runs.
      diagnostics: built.diagnostics.filter((d) => !isWarning(d)).map((d) => `  ${d.doc} §${d.section}:${d.line}  ${d.kind} — ${d.message}`),
      locks: writes, stamps,
      ...(fw.migrated || org.migrated ? { migrated: true } : {}),
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

  // Both locks are compared and written exactly like any other generated file, so there is one notion of "stale".
  const all = [...result.files, ...result.locks];
  const stale = all.filter((f) => deps.fs.readFile(path.join(input.home, f.path)) !== f.content).map((f) => f.path);

  if (mode === "check") {
    return stale.length
      ? { code: 1, lines: [...head, `${stale.length} generated file(s) are stale:`, ...stale.map((s) => `  ${s}`), "", "Run `gov rules build` and commit the result."] }
      : { code: 0, lines: [...head, "every generated file matches the policies.", ...result.report] };
  }

  for (const f of all) deps.fs.writeFile(path.join(input.home, f.path), f.content);
  // The interim YAML lock is removed only once its JSON replacement is safely written — never before, or a
  // failed write between the two would leave a workspace with no lock and every number unaccounted for.
  if (result.migrated) {
    for (const dir of Object.values(LOCK_DIRS)) deps.fs.rm(path.join(input.home, dir, ".pol-lock.yaml"));
  }

  const fwLock = result.locks.find((l) => l.path.startsWith(LOCK_DIRS.framework));
  return {
    code: 0,
    lines: [
      ...head,
      `wrote ${all.length} file(s)${result.migrated ? " (migrated .pol-lock.yaml → .pol-lock.json)" : ""}.`,
      ...(result.stamps.length ? [`  stamped ${result.stamps.length} cue(s) with their clause's hash: ${result.stamps.join(", ")}`] : []),
      ...(stale.length ? [] : ["  (nothing had changed)"]),
      "",
      ...result.report,
      ...(fwLock ? ["", `next framework POL number: ${nextFree(parseLock(fwLock.content, FRAMEWORK_POL_START).lock!)}`] : []),
      "",
      "Restart any running agent session: a session cannot pick up new rules in place.",
    ],
  };
}
