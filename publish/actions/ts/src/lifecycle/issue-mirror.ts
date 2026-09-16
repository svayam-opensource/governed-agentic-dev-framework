// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Mirroring an upstream issue into the repo you can actually write (#194, option E).
 *
 * `repo_overrides` sends the BRANCH to your fork while the board still links the
 * upstream issue. That works, and it leaves one thing crooked: the board item is
 * an issue in a repository your organization does not own, so assigning it, closing
 * it, or holding anyone to it are all things you cannot do. Under this model a
 * board item is a unit of work with an accountable owner (POL-413, POL-075) — and
 * an upstream issue can be a REASON for work without being able to be that.
 *
 * So: create your own issue, quoting theirs, and put that on the board. The
 * upstream one stays what it is — someone else's report, which you are free to
 * read and benefit from, exactly as the adopter asked:
 *
 *   > It would be helpful if I can see the issues raised in the parent and benefit
 *   > from problems being reported there, so that I can fix them in my own copy.
 *
 * The mirror is a link, not a copy of record. It quotes enough to work from and
 * points at the original for everything else, because two full copies of one
 * report drift apart and nothing reconciles them.
 */

/** What we read from the upstream issue. */
export interface UpstreamIssue {
  readonly repo: string;          // owner/repo
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly url: string;
  readonly state: string;
  readonly author: string | null;
}

/** `owner/repo#number` from an issue URL, or null. */
export function parseIssueUrl(url: string): { readonly repo: string; readonly number: number } | null {
  const m = /github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/.exec(url.trim());
  return m ? { repo: `${m[1]}/${m[2]}`, number: Number(m[3]) } : null;
}

/** The mirror's title — recognisable at a glance in a board column. */
export function mirrorTitle(up: UpstreamIssue): string {
  return `${up.title}  (${up.repo}#${up.number})`;
}

/**
 * The mirror's body. Attribution first, then enough of the original to work from,
 * then the link. Never a silent copy: whoever opens this must be able to tell in
 * one line that the report is someone else's.
 */
export function mirrorBody(up: UpstreamIssue, opts?: { readonly maxQuote?: number }): string {
  const max = opts?.maxQuote ?? 4000;
  const truncated = up.body.length > max;
  // An empty body quotes to "> ", which is truthy and therefore silently replaced
  // the fallback with a blank quote block. Decide on the SOURCE, not on its render.
  const hasBody = up.body.trim().length > 0;
  const quoted = hasBody
    ? (truncated ? `${up.body.slice(0, max)}\n\n…` : up.body).split("\n").map((l) => `> ${l}`).join("\n")
    : "> (the upstream issue has no description)";

  return [
    `Mirrored from **${up.url}**${up.author ? ` (reported by @${up.author})` : ""}.`,
    "",
    "That issue belongs to another repository. This one exists so the work can be",
    "owned, assigned and closed here, in the repository this organization writes.",
    "The original stays the record of the report; read it there for anything this",
    "quote does not carry.",
    "",
    `**Upstream state at mirror time:** ${up.state}`,
    "",
    "---",
    "",
    quoted,
    ...(truncated ? ["", `_Quote truncated — see ${up.url} for the rest._`] : []),
  ].join("\n");
}

/** Refuse to mirror what does not need mirroring. */
export function mirrorPrecheck(up: { repo: string }, githubOrg: string): string | null {
  const owner = up.repo.split("/")[0] ?? "";
  if (owner.toLowerCase() === githubOrg.toLowerCase()) {
    return `${up.repo} is already in your organization — put that issue on the board directly, no mirror needed.`;
  }
  return null;
}
