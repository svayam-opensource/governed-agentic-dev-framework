// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Answer validation for interactive prompts (#192).
 *
 * Every prompt used to have two outcomes: an answer it accepted, or an exit. A
 * typo, an org you cannot write to, a repo name already taken — each ended the
 * command and sent the adopter back to the shell to start over, sometimes minutes
 * in.
 *
 * There should be three, and the third is the one that was missing:
 *
 *     accept  → carry on
 *     reject  → say what is wrong with THAT value, and ask again
 *     Ctrl-C  → the user's own way out, which they already know
 *
 * QUITTING IS THE USER'S DECISION. Ctrl-C is universal, always available and
 * unambiguous. A tool that exits on someone's behalf because they mistyped is
 * deciding something that was never its to decide.
 *
 * A validator returns null when the value is good, or the sentence to show when it
 * is not. The sentence is about the VALUE — "an org slug is 2-6 letters or digits;
 * 'GENEVA-1' has a dash" — not about the field, because the reader already knows
 * what the field is; they just got it wrong.
 */

/** null = accepted. A string = why not, phrased for the person who typed it. */
export type Validator = (value: string) => string | null;

export const nonEmpty = (what: string): Validator => (v) =>
  v.trim() ? null : `${what} cannot be empty.`;

/**
 * 2–6 letters or digits. It decides `~/.gov/<slug>/`, so a character git or a
 * filesystem would argue about is not a preference we can honour.
 */
export const orgSlug: Validator = (v) => {
  const t = v.trim();
  if (!t) return "An org slug cannot be empty — it decides where your workspace lives (~/.gov/<slug>/).";
  if (!/^[A-Za-z0-9]+$/.test(t)) return `'${t}' has characters other than letters and digits. Use letters and digits only.`;
  if (t.length < 2 || t.length > 6) return `'${t}' is ${t.length} character(s). Use between 2 and 6.`;
  return null;
};

/** Shape only. Whether the address can DO anything is a separate question. */
export const emailShape: Validator = (v) => {
  const t = v.trim();
  if (!t) return "An email address cannot be empty.";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? null : `'${t}' does not look like an email address (name@example.com).`;
};

export const isoDate: Validator = (v) => {
  const t = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return `'${t}' is not a date in YYYY-MM-DD form.`;
  return Number.isNaN(Date.parse(t)) ? `'${t}' is not a real date.` : null;
};

/** `<org>/<repo>` — a name to CREATE, not a URL to clone. */
export const orgRepoTarget: Validator = (v) => {
  const t = v.trim();
  if (!t) return null;                                   // empty means "stop", handled by the caller
  if (/^(https?:\/\/|git@|ssh:\/\/)/.test(t)) {
    return `'${t}' is a clone URL. This asks for a repository to CREATE, as <organization>/<name>. If you meant to JOIN an organization that already uses gov, restart and choose B.`;
  }
  return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(t)
    ? null
    : `'${t}' is not <organization>/<name> — for example acme-corp/acme-governance.`;
};

/**
 * The workspace's default branch. Only two answers mean anything, so it is a
 * choice rather than free text: a typo here produces a branch name the rest of the
 * tool will look for and never find.
 */
export const BRANCH_CHOICES: readonly { readonly key: string; readonly branch: string }[] = [
  { key: "1", branch: "main" },
  { key: "2", branch: "master" },
];

export function parseBranchChoice(v: string): string | null {
  const t = v.trim().toLowerCase();
  const byKey = BRANCH_CHOICES.find((c) => c.key === t);
  if (byKey) return byKey.branch;
  const byName = BRANCH_CHOICES.find((c) => c.branch === t);   // typing "main" is not a mistake
  return byName ? byName.branch : null;
}

export const branchChoice: Validator = (v) =>
  parseBranchChoice(v) ? null : `Answer 1 for main or 2 for master. '${v.trim()}' is neither.`;

/** A git branch name for day-to-day development in code repos. Anything git accepts. */
export const branchName: Validator = (v) => {
  const t = v.trim();
  if (!t) return "A branch name cannot be empty.";
  if (/[\s~^:?*[\\]/.test(t) || t.startsWith("/") || t.endsWith("/") || t.includes("..")) {
    return `'${t}' is not a valid git branch name.`;
  }
  return null;
};
