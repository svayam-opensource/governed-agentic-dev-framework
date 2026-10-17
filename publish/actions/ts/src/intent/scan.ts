// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WHERE gov FINDS A PROJECT'S INTENTS (PRJ-121 intent 03, D2, ruling Q1).
 *
 * One path, one scanner: `projects/<PRJ>/intents/<NN-slug>/`, holding `intent.md`, `spec.md`, `plan.md` and
 * `build.md`. A single board issue is a one-issue intent; M6c's `projects/<PRJ>/issues/<n>/` is never read. A
 * folder under `intents/` whose name is not `NN-slug` is reported as skipped — never guessed at.
 *
 * Nothing happens without an adopted lifecycle: when `policies/active/ai-sdlc-lifecycle.md` is absent the scan
 * says so and reads nothing else, and its callers do nothing (spec §2.1, X6).
 *
 * The tree is injected (a working tree, a git ref, a fixture), so the scan is the same wherever the files live.
 * The Status it reports is what the FILE says; whether an APPROVED line is true is `approval.ts`'s question (Q2).
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { LIFECYCLE_POLICY_PATH, missingSections, parseLifecycle, statusOf, type ArtifactStatus, type ParsedLifecycle } from "./lifecycle-policy.js";

/** Read access to a repository tree, by repo-relative POSIX paths. */
export interface TreeReader {
  /** The names directly inside `dir`; null when `dir` is not a directory. */
  list(dir: string): Promise<readonly string[] | null>;
  /** The file's text; null when there is no such file. */
  read(file: string): Promise<string | null>;
}

/** `NN-slug`: two digits, a dash, lowercase words joined by dashes. */
export const INTENT_DIR_NAME = /^(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
export const INTENT_ARTIFACTS = ["intent", "spec", "plan", "build"] as const;
export type IntentArtifactKind = (typeof INTENT_ARTIFACTS)[number];

export interface IntentArtifact {
  readonly kind: IntentArtifactKind;
  readonly path: string;
  readonly text: string;
  /** The Status line as written; null when the file has none. */
  readonly status: ArtifactStatus | null;
  /** Required sections (§2.3) the file lacks. */
  readonly missing: readonly string[];
}

export interface ScannedIntent {
  readonly project: string;
  /** The folder name, `NN-slug`. */
  readonly id: string;
  readonly number: number;
  readonly slug: string;
  readonly dir: string;
  /** Present artifacts only. */
  readonly artifacts: Partial<Record<IntentArtifactKind, IntentArtifact>>;
}

export type ScanResult =
  | { readonly active: false; readonly message: string }
  | {
      readonly active: true;
      readonly lifecycle: ParsedLifecycle;
      readonly intents: readonly ScannedIntent[];
      readonly skipped: readonly { readonly path: string; readonly reason: string }[];
    };

export const intentsDir = (project: string): string => `projects/${project}/intents`;

export async function scanIntents(tree: TreeReader, project: string): Promise<ScanResult> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(project) || project.includes("..")) throw new Error(`not a project id: ${JSON.stringify(project)}`);
  const policy = await tree.read(LIFECYCLE_POLICY_PATH);
  if (policy === null) {
    return { active: false, message: `no lifecycle adopted (${LIFECYCLE_POLICY_PATH} is absent) — gov does nothing with intents` };
  }
  const root = intentsDir(project);
  const intents: ScannedIntent[] = [];
  const skipped: { path: string; reason: string }[] = [];
  for (const name of [...((await tree.list(root)) ?? [])].sort()) {
    const dir = `${root}/${name}`;
    const m = INTENT_DIR_NAME.exec(name);
    if (!m) {
      if ((await tree.list(dir)) !== null) skipped.push({ path: dir, reason: `folder name is not NN-slug (two digits, a dash, lowercase words): ${name}` });
      continue; // a loose file under intents/ is not an intent
    }
    const artifacts: Partial<Record<IntentArtifactKind, IntentArtifact>> = {};
    for (const kind of INTENT_ARTIFACTS) {
      const file = `${dir}/${kind}.md`;
      const text = await tree.read(file);
      if (text !== null) artifacts[kind] = { kind, path: file, text, status: statusOf(text), missing: missingSections(kind, text) };
    }
    intents.push({ project, id: name, number: Number(m[1]), slug: m[2], dir, artifacts });
  }
  return { active: true, lifecycle: parseLifecycle(policy), intents, skipped };
}

/** A {@link TreeReader} over a directory on disk. */
export function fsTree(rootDir: string): TreeReader {
  const at = (p: string): string => path.join(rootDir, ...p.split("/"));
  return {
    async list(dir) {
      try { return await fs.readdir(at(dir)); } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") return null;
        throw e;
      }
    },
    async read(file) {
      try { return await fs.readFile(at(file), "utf8"); } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "EISDIR" || code === "ENOTDIR") return null;
        throw e;
      }
    },
  };
}
