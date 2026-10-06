// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov rules build | check | report` — the disk and terminal side of {@link ../rules/rules-build.js}.
 *
 * THREE MODES, ONE COMPUTATION. `check` must fail exactly when the committed files differ from what `build` would
 * write, so both call the same `plan()` and differ only in what they do with the answer.
 *
 * READ FROM THE DEFAULT BRANCH by default. A rule row edited on a project branch is a PROPOSAL (GOV-FRM-086);
 * rendering it into the resident block would have an agent obeying a rule nobody ratified. `--working-tree` exists
 * for an author drafting, for `gov setup` (nothing is committed yet) and for `gov upgrade` (the new framework rows
 * are on disk, not yet on the branch), and it says so in the output every time.
 *
 * WHAT `check` ALSO FAILS ON: a STALE ROW — an in-force row whose source section's sha has moved on (Q9). The prose
 * changed and nobody re-read the rule against it; `gov rules propose` is the way out.
 */
import * as path from "node:path";
import { buildArtifacts, staleRows, formatStaleRow, summaryLines, type BuiltFile, type StaleRow } from "../rules/rules-build.js";
import { loadRuleStores, loadRuleStoresFrom, isStoreNote, RULE_STORE_PATHS, type StoreDiagnostic } from "../rules/model/store-io.js";
import { residentRows } from "../rules/cues/resident.js";
import { summariseRuleSet } from "../rules/model/rule-map.js";
import type { RuleSet } from "../rules/model/contracts.js";
import type { RuleClass } from "../rules/model/catalog.js";
import type { GitRead } from "./policy-gate-io.js";
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
  /** Read the rule stores from disk instead of from the ratified branch. */
  readonly workingTree?: boolean;
  /** Where the protocol body lives, relative to `home`. */
  readonly protocolPath?: string;
}

export interface RulesResult {
  readonly code: number;
  readonly lines: readonly string[];
}

const PROTOCOL = path.join("agent", "session-protocol.md");

/** Every store file `loadRuleStoresFrom` may ask for. Absent from disk and from the ref alike → nothing to build. */
const STORE_FILES = [RULE_STORE_PATHS.frameworkRules, RULE_STORE_PATHS.orgRules] as const;

/** A reader for one document, from the same place the rows came from. */
type ReadDoc = (rel: string) => string | null;

/** Where the rows and their source documents are read: the ratified branch, or the disk. */
function sourceOf(deps: RulesDeps, input: RulesInput): { readonly where: string; readonly readDoc: ReadDoc } | { readonly error: string } {
  if (input.workingTree) return { where: "the working tree", readDoc: (rel) => deps.fs.readFile(path.join(input.home, rel)) };
  const git = deps.git;
  if (!git) return { error: `git is not available, so the rules on ${input.defaultBranch} cannot be read` };
  return { where: input.defaultBranch, readDoc: (rel) => git(input.home, ["show", `${input.defaultBranch}:${rel}`]) };
}

/** Is there any rule store to build from? A workspace on the pre-rule-model layout has neither file. */
export function hasRuleStores(deps: RulesDeps, input: RulesInput): boolean {
  const src = sourceOf(deps, input);
  if ("error" in src) return false;
  return STORE_FILES.some((rel) => src.readDoc(rel) !== null);
}

/** Load the RuleSet from wherever `input` says. */
export function loadRules(deps: RulesDeps, input: RulesInput): { readonly set: RuleSet; readonly diagnostics: readonly StoreDiagnostic[]; readonly readDoc: ReadDoc } | { readonly error: string } {
  const src = sourceOf(deps, input);
  if ("error" in src) return src;
  const loaded = input.workingTree
    ? loadRuleStoresFrom({ where: src.where, read: (rel) => src.readDoc(rel) ?? undefined })
    : loadRuleStores(deps.git!, input.home, input.defaultBranch);
  if (!loaded.ok) return { error: loaded.reason };
  return { set: loaded.set, diagnostics: loaded.diagnostics, readDoc: src.readDoc };
}

export interface RulesPlan {
  readonly set: RuleSet;
  /** What SHOULD be on disk. */
  readonly files: readonly BuiltFile[];
  /** Row and binding findings that stop a build. */
  readonly errors: readonly string[];
  /** Layout notes (no framework store yet, …) — reported, never blocking. */
  readonly notes: readonly string[];
  readonly stale: readonly StaleRow[];
  readonly report: readonly string[];
}

const diag = (d: StoreDiagnostic): string => `  ${d.store}${d.id ? ` ${d.id}` : ""}  ${d.kind} — ${d.message}`;

/** What `build`/`check` would write, and why it might refuse. */
export function plan(deps: RulesDeps, input: RulesInput): { readonly result?: RulesPlan; readonly error?: string } {
  const loaded = loadRules(deps, input);
  if ("error" in loaded) return { error: loaded.error };
  const protocol = deps.fs.readFile(path.join(input.home, input.protocolPath ?? PROTOCOL));
  if (protocol === null) return { error: `${input.protocolPath ?? PROTOCOL} is missing — it is the body every agent file is rendered from.` };

  const built = buildArtifacts(protocol, loaded.set);
  if ("error" in built) return { error: built.error };
  return {
    result: {
      set: loaded.set,
      files: built.files,
      errors: loaded.diagnostics.filter((d) => !isStoreNote(d)).map(diag),
      notes: loaded.diagnostics.filter(isStoreNote).map(diag),
      stale: staleRows(loaded.set, loaded.readDoc),
      report: summaryLines(loaded.set),
    },
  };
}

const staleLines = (stale: readonly StaleRow[]): string[] => stale.length
  ? ["", `${stale.length} rule row(s) are pending re-review — their source section changed since the row was approved:`,
    ...stale.map((s) => `  ${formatStaleRow(s)}`),
    "  Re-read each against its section with `gov rules propose`, and have the result approved."]
  : [];

/** `gov rules <mode>`. */
export function rules(deps: RulesDeps, input: RulesInput, mode: "build" | "check" | "report"): RulesResult {
  const { result, error } = plan(deps, input);
  if (error || !result) return { code: 1, lines: [`gov rules ${mode}: ${error ?? "failed"}`] };

  const source = input.workingTree ? "the WORKING TREE (unratified — an agent is governed by the default branch)" : input.defaultBranch;
  const head = [`gov rules ${mode} — from ${source}`, ""];
  const notes = result.notes.length ? ["", "notes", ...result.notes] : [];

  if (mode === "report") {
    return {
      code: result.errors.length ? 1 : 0,
      lines: [...head, ...result.report, ...notes, ...staleLines(result.stale),
        ...(result.errors.length ? ["", `rule store errors (${result.errors.length})`, ...result.errors] : [])],
    };
  }

  if (result.errors.length) {
    return { code: 1, lines: [...head, `${result.errors.length} error(s) in the rule stores — fix these first:`, "", ...result.errors, "", "Nothing was written."] };
  }

  const stale = result.files.filter((f) => deps.fs.readFile(path.join(input.home, f.path)) !== f.content).map((f) => f.path);

  if (mode === "check") {
    const ok = !stale.length && !result.stale.length;
    return {
      code: ok ? 0 : 1,
      lines: [
        ...head,
        ...(stale.length
          ? [`${stale.length} generated file(s) are stale:`, ...stale.map((s) => `  ${s}`), "", "Run `gov rules build` and commit the result."]
          : ["every generated file matches the rule stores."]),
        ...staleLines(result.stale),
        ...(ok ? ["", ...result.report] : []),
      ],
    };
  }

  for (const f of result.files) deps.fs.writeFile(path.join(input.home, f.path), f.content);
  return {
    code: 0,
    lines: [
      ...head,
      `wrote ${result.files.length} file(s).`,
      ...(stale.length ? [] : ["  (nothing had changed)"]),
      "",
      ...result.report,
      ...notes,
      ...staleLines(result.stale),
      "",
      "Restart any running agent session: a session cannot pick up new rules in place.",
    ],
  };
}

/** What `gov doctor` reports about the rules, from the same plan `gov rules check` makes. Absent ⇒ no rows. */
export interface RulesFactsOut {
  readonly counts: Record<RuleClass, number>;
  readonly resident: number;
  readonly residentChars: number;
  readonly staleFiles: readonly string[];
  readonly staleRows: readonly string[];
  readonly errors: readonly string[];
}

export function rulesFacts(deps: RulesDeps, input: RulesInput): RulesFactsOut | { readonly error: string } | undefined {
  if (!hasRuleStores(deps, input)) return undefined;
  const { result, error } = plan(deps, input);
  if (error || !result) return { error: error ?? "the rules could not be planned" };
  const resident = residentRows(result.set);
  return {
    counts: summariseRuleSet(result.set),
    resident: resident.length,
    residentChars: resident.reduce((n, r) => n + (r.cue?.text.length ?? 0), 0),
    staleFiles: result.files.filter((f) => deps.fs.readFile(path.join(input.home, f.path)) !== f.content).map((f) => f.path),
    staleRows: result.stale.map((s) => s.id),
    errors: result.errors,
  };
}
