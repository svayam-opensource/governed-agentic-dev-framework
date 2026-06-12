import { execFileSync } from "node:child_process";

// Git helpers over the corpus repo. The corpus is READ-ONLY; we only read.
//
// commitSha provenance (rag-api-contract): each chunk's commitSha is the LAST
// commit that MODIFIED its source file — NOT the merge sha. The merge/sinceSha is
// used only to compute the changed-file set for incremental re-embed.

function git(repoRoot: string, args: string[]): string {
  return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" }).trim();
}

export function headSha(repoRoot: string): string {
  try { return git(repoRoot, ["rev-parse", "HEAD"]); } catch { return ""; }
}

/** Last commit that modified a specific file (provenance commitSha). */
export function lastCommitForFile(repoRoot: string, repoRelPath: string): string {
  try {
    return git(repoRoot, ["log", "-1", "--format=%H", "--", repoRelPath]);
  } catch {
    return "";
  }
}

/** Batch: map of repoRelPath -> last-modifying commit sha (one git call per file). */
export function lastCommitForFiles(repoRoot: string, paths: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of paths) m.set(p, lastCommitForFile(repoRoot, p));
  return m;
}

export interface ChangedFile {
  path: string;
  change: "A" | "M" | "D" | "R";
  oldPath?: string;
}

/** git diff --name-status sinceSha..HEAD, scoped to knowledge markdown. */
export function changedFiles(repoRoot: string, sinceSha: string): ChangedFile[] {
  const out = git(repoRoot, [
    "diff", "--name-status", "-M", `${sinceSha}..HEAD`, "--",
    "knowledge/**/*.md", "projects/**/knowledge/**/*.md",
  ]);
  const files: ChangedFile[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const code = parts[0][0] as ChangedFile["change"];
    if (code === "R") {
      files.push({ change: "R", oldPath: parts[1], path: parts[2] });
    } else {
      files.push({ change: code, path: parts[1] });
    }
  }
  return files;
}
