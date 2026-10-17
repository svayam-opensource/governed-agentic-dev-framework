// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE GOV REPO'S TREE AT ONE SIDE OF A POLICY PULL REQUEST (rule-model-design.md P1 "Org version"; W5).
 *
 * The gate compares two trees — the base the PR merges into, and its head — and the writers change the head. Both
 * see the repository through this one small seam, so every check and every writer is tested over an in-memory
 * tree, and the CLI (P3) chooses where a tree comes from: a git ref (`git ls-tree` + `git show`, the gate) or a
 * worktree on disk (the writers).
 *
 * `null` from {@link TreeReader.files} means the tree could not be listed — never "no files". A gate that read
 * "could not list" as "empty" would pass a PR it never looked at.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import type { GitRead } from "../../cli/policy-gate-io.js";

export interface TreeReader {
  /** Every file under `dir` (repo-relative, `/`-separated, no trailing slash), sorted; null = could not tell. */
  files(dir: string): readonly string[] | null;
  /** A file's text, or null when it is absent (or unreadable). */
  read(file: string): string | null;
}

export interface TreeWriter extends TreeReader {
  write(file: string, text: string): void;
  /** Delete one file (absent: nothing to do). Only the writers' own superseded output is ever removed (write.ts). */
  remove(file: string): void;
}

const under = (file: string, dir: string): boolean => dir === "" || file === dir || file.startsWith(`${dir}/`);

/** An in-memory tree. Writes land in the given record, so a test can inspect them. */
export function memTree(files: Record<string, string>): TreeWriter {
  return {
    files: (dir) => Object.keys(files).filter((f) => under(f, dir)).sort(),
    read: (file) => (Object.prototype.hasOwnProperty.call(files, file) ? files[file]! : null),
    write: (file, text) => { files[file] = text; },
    remove: (file) => { delete files[file]; },
  };
}

/** The tree at a git ref, read the way store-io reads it: what EXISTS from `ls-tree`, each file from `show`. */
export function gitTree(git: GitRead, repo: string, ref: string): TreeReader {
  return {
    files(dir) {
      const out = git(repo, ["ls-tree", "-r", "--name-only", ref, "--", dir]);
      if (out === null) return null;
      return out.split("\n").map((l) => l.trim()).filter((l) => l && under(l, dir)).sort();
    },
    read: (file) => git(repo, ["show", `${ref}:${file}`]),
  };
}

/** A worktree on disk, for the writers. Paths stay repo-relative. */
export function fsTree(root: string): TreeWriter {
  const walk = (rel: string): string[] => {
    const abs = path.join(root, rel);
    if (!existsSync(abs)) return [];
    if (!statSync(abs).isDirectory()) return [rel];
    return readdirSync(abs).flatMap((n) => walk(rel ? `${rel}/${n}` : n));
  };
  return {
    files: (dir) => walk(dir).filter((f) => !f.split("/").includes(".git")).sort(),
    read: (file) => {
      const abs = path.join(root, file);
      return existsSync(abs) && statSync(abs).isFile() ? readFileSync(abs, "utf8") : null;
    },
    write: (file, text) => {
      const abs = path.join(root, file);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, text);
    },
    remove: (file) => { rmSync(path.join(root, file), { force: true }); },
  };
}

/**
 * A tree as {@link GitRead}, so code that reads at a ref through git (store-io's `loadRuleStores`) reads a tree
 * unchanged. Answers `ls-tree … -- <roots…>` and `show <ref>:<path>`; anything else is "git did not answer".
 */
export function treeAsGit(tree: TreeReader): GitRead {
  return (_repo, args) => {
    if (args[0] === "ls-tree") {
      const roots = args.slice(args.indexOf("--") + 1);
      const all: string[] = [];
      for (const r of roots) {
        const f = tree.files(r);
        if (f === null) return null;
        all.push(...f);
      }
      return [...new Set(all)].join("\n");
    }
    if (args[0] === "show" && args[1]) return tree.read(args[1].slice(args[1].indexOf(":") + 1));
    return null;
  };
}
