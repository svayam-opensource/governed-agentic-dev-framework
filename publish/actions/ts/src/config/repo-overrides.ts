// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Where the work happens, when that is not where the issue lives (#194).
 *
 * A board links an issue; `seed` takes that issue's repository as a participating
 * repo and cuts the project branch there (POL-044 — repos come from the board).
 * That is right until the issue is upstream of a fork:
 *
 *     genevaers/Workbench      the issue's home — readable, not writable
 *             │ fork
 *             ▼
 *     svm-geneva/Workbench     the adopter's own — where the work can happen
 *
 * Two facts gov had collapsed into one. Where the REASON for the work is recorded
 * and where the WORK happens need not be the same repository, and nothing in the
 * governance model says they must: the branch, the worktree, the pull request and
 * the merge all belong to the writable one.
 *
 * The mapping is DECLARED, never inferred. Resolving a fork automatically — "no
 * write access, and a fork exists under your org, so use it" — would decide where
 * someone's code is pushed without being told, and would guess when there are
 * several forks or the fork is stale. It lives in `org-config.yaml`, so it is
 * reviewed like any other governance change and everyone in the org sees the same
 * answer:
 *
 *     repo_overrides:
 *       genevaers/Workbench: svm-geneva/Workbench
 */

/** `owner/repo` → `owner/repo`. Both sides are slugs, never URLs. */
export type RepoOverrides = Readonly<Record<string, string>>;

/** `owner/repo` from any GitHub URL form, or null when it is not one. */
export function repoSlugFromUrl(url: string): string | null {
  const m = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * Read the `repo_overrides:` block. A nested map of `owner/repo: owner/repo`,
 * ended by the first line that is not indented.
 */
export function parseRepoOverrides(text: string): RepoOverrides {
  const out: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^repo_overrides:\s*(#.*)?$/.test(l));
  if (start < 0) return out;
  for (const raw of lines.slice(start + 1)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (!/^\s/.test(raw)) break;                                   // dedent ends the block
    const m = /^\s+["']?([^"':]+)["']?\s*:\s*["']?([^"'#]+?)["']?\s*(?:#.*)?$/.exec(raw);
    if (!m) continue;
    const from = m[1]!.trim();
    const to = m[2]!.trim();
    if (from && to) out[from] = to;
  }
  return out;
}

/**
 * Apply the map to a repo URL. Returns the URL unchanged when nothing matches —
 * the common case, and the one that must stay free of surprises.
 */
export function resolveWorkRepo(url: string, overrides: RepoOverrides): string {
  const slug = repoSlugFromUrl(url);
  if (!slug) return url;
  const target = overrides[slug];
  return target ? `https://github.com/${target}` : url;
}

/** The redirects actually used on this run — said out loud, because they are decisions made for you. */
export function appliedOverrides(urls: readonly string[], overrides: RepoOverrides): readonly { readonly from: string; readonly to: string }[] {
  const used: { from: string; to: string }[] = [];
  for (const u of urls) {
    const resolved = resolveWorkRepo(u, overrides);
    if (resolved !== u) used.push({ from: u, to: resolved });
  }
  return used;
}
