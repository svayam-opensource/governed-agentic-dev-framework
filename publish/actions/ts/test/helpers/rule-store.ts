// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * A governance repository's rule stores, as an in-memory tree — for tests that run checks or a build over rows
 * without a repository. The framework catalog is the SHIPPED one, so a binding a test writes is validated against
 * the actions an adopter really has.
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import type { GitRead } from "../../src/cli/policy-gate-io.js";

const CONTENT = path.join(import.meta.dirname, "..", "..", "..", "..", "content");

/** The shipped `framework/rules/catalog.yaml`. */
export const SHIPPED_CATALOG = readFileSync(path.join(CONTENT, "framework", "rules", "catalog.yaml"), "utf8");

/** One ref's files: path → text. */
export type Tree = Readonly<Record<string, string>>;

/** The minimum a tree needs to load: an org slug and the framework catalog. `orgRules` is `policies/rules.yaml`. */
export function storeTree(orgRules: string, extra: Tree = {}): Tree {
  return {
    "org-config.yaml": "org_slug: SVM\n",
    "framework/rules/catalog.yaml": SHIPPED_CATALOG,
    "framework/rules/rules.yaml": "[]\n",
    "policies/rules.yaml": orgRules,
    "policies/VERSION": "1.0.0\n",
    ...extra,
  };
}

/** One org rule row bound to `resource · event` → `action` with `with`, as YAML. */
export function boundRow(id: string, on: { resource: string; event: string }, action: string, withParams: Record<string, unknown>, onMiss: "fail" | "warn" = "fail"): string {
  return `- id: ${id}
  source: { doc: policies/org-policy.md, section: "3.1", sha: "abc1234" }
  expectation: "Everyone keeps rule ${id}."
  actor: [everyone]
  level: C02
  checks:
    - on: { resource: ${on.resource}, event: ${on.event} }
      action: ${action}
      with: ${JSON.stringify(withParams)}
      on_miss: ${onMiss}
  start: { version: "1.0.0", date: "2026-10-06" }
  end: null
`;
}

/**
 * A git that answers `ls-tree -r --name-only <ref> -- <prefixes…>` and `show <ref>:<path>` from in-memory trees,
 * plus any other call through `other`. It records every call, so a test can prove WHICH REF was read.
 */
export function treeGit(trees: Readonly<Record<string, Tree>>, other: (args: readonly string[]) => string | null = () => null): GitRead & { calls: string[][] } {
  const calls: string[][] = [];
  const git = ((_repo: string, args: readonly string[]): string | null => {
    calls.push([...args]);
    if (args[0] === "ls-tree") {
      const ref = args[3]!;
      const prefixes = args.slice(5);
      const tree = trees[ref];
      if (!tree) return "";
      return Object.keys(tree).filter((p) => !prefixes.length || prefixes.some((x) => p === x || p.startsWith(`${x}/`))).join("\n");
    }
    if (args[0] === "show") {
      const [ref, rel] = args[1]!.split(/:(.*)/s) as [string, string];
      return trees[ref]?.[rel] ?? null;
    }
    return other(args);
  }) as GitRead & { calls: string[][] };
  git.calls = calls;
  return git;
}
