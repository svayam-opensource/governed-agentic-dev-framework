// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The whole adoption, on one screen, ticked off as it happens (#186).
 *
 * Adoption is a dozen steps across two processes — a shell installer that has no
 * Node yet, then `gov` itself — and an adopter met them one surprise at a time:
 * a prompt with no idea how many more were coming, an install that seemed finished
 * and then asked for something else, a browser sign-in arriving out of nowhere. The
 * complaint underneath every one of those was the same: *what is this going to do,
 * and how far along am I?*
 *
 * DERIVED, NOT RECORDED. There is no progress file, and there must not be: two
 * processes writing one would disagree, and a stale tick is worse than no tick.
 * Every item is a question gov can answer by looking — is Node here, is `gh` signed
 * in, does the workspace resolve — so the list is recomputed each time it is shown
 * and cannot drift from the machine it describes.
 *
 * The steps an installer owns (Node, gov itself) are ticked by the time gov can run
 * at all, which is why they are safe to derive too: if you are reading this list,
 * they are done.
 */

/** What gov can see about how far adoption has got. */
export interface ChecklistFacts {
  readonly gitPresent: boolean;
  readonly ghPresent: boolean;
  readonly ghAuthenticated: boolean;
  readonly ghScopesOk: boolean;
  readonly gitIdentityOk: boolean;
  readonly workspaceResolves: boolean;
  readonly orgActive: string | null;
  readonly workspacePath: string | null;
  readonly orgSlug: string | null;
  /** Adopter (founding) or joiner. Null before the question is answered. */
  readonly role: "adopter" | "joiner" | null;
  /** The package manager, so the commands shown are the ones that will run. */
  readonly installCmd?: { readonly git: string; readonly ghRepo?: string; readonly gh: string };
}

export interface ChecklistItem {
  readonly n: string;
  readonly done: boolean;
  readonly text: string;
  /** Indented under its parent. */
  readonly sub?: boolean;
}

const or = (v: string | null | undefined, placeholder: string): string => (v && v.trim() ? v : placeholder);

/**
 * The list. Numbering matches what the adopter was shown a moment ago, so an item
 * does not change its number as the run progresses — a checklist whose lines move
 * is not a checklist.
 */
export function checklist(f: ChecklistFacts): readonly ChecklistItem[] {
  const slug = or(f.orgSlug, "<org-slug>");
  const items: ChecklistItem[] = [
    // If this list is being rendered, gov is running, which needs Node 24. Both are
    // therefore done by construction rather than by memory.
    { n: "1", done: true, text: "Install Node version 24" },
    { n: "2", done: true, text: "Install the governance client — gov" },
    { n: "3", done: f.gitPresent, text: `Install dependency — git${f.installCmd ? `  (${f.installCmd.git})` : ""}` },
    { n: "4", done: f.ghPresent, text: "Install dependency — gh, the GitHub CLI" },
  ];
  if (f.installCmd?.ghRepo) {
    items.push({ n: "4a", sub: true, done: f.ghPresent, text: `Add GitHub's package repository  (${f.installCmd.ghRepo})` });
    items.push({ n: "4b", sub: true, done: f.ghPresent, text: `Install gh  (${f.installCmd.gh})` });
  }
  items.push(
    { n: "5", done: f.ghAuthenticated, text: "Sign in to GitHub  (gh auth login)" },
    { n: "6", done: f.ghAuthenticated && f.ghScopesOk, text: "Grant gov the permissions it needs  (repo, read:org, project)" },
    { n: "7", done: f.gitIdentityOk, text: "Tell git who you are  (user.name, user.email)" },
    { n: "8", done: f.workspaceResolves, text: `Create the governance workspace at ${or(f.workspacePath, `~/.gov/${slug}/gov_repo`)}` },
    { n: "9", done: Boolean(f.orgActive), text: `Activate it — ${or(f.orgActive, "<your GitHub org>")} → ${or(f.workspacePath, `~/.gov/${slug}/gov_repo`)}` },
  );

  if (f.role === "adopter") {
    // Only an adopter founds an organization. A joiner's workspace already has all
    // of this in it, and listing it against their name would be a list of things
    // they must not do.
    const done = f.workspaceResolves;
    items.push(
      { n: "10", done, text: "Set your organization up (adopters only)" },
      { n: "10a", sub: true, done, text: "Create the governance repository from the framework template" },
      { n: "10b", sub: true, done, text: "Seed the starter policies and agent harness into it" },
      { n: "10c", sub: true, done, text: "Replace the framework's placeholders with your organization's values" },
      { n: "10d", sub: true, done, text: "Commit and push it to your organization" },
      { n: "10e", sub: true, done: false, text: "Review the seeded policies and make them yours" },
    );
  }
  return items;
}

export function renderChecklist(items: readonly ChecklistItem[]): readonly string[] {
  const width = Math.max(...items.map((i) => i.n.length));
  return items.map((i) => {
    const num = `${i.n}.`.padEnd(width + 1);
    return `  ${i.sub ? "   " : ""}${num} [${i.done ? "✓" : " "}] ${i.text}`;
  });
}

/** Shown once, before anything runs, so nobody meets these one surprise at a time. */
export function checklistPreamble(): readonly string[] {
  return [
    "",
    "Thank you for installing the governance framework.",
    "",
    "These are the steps to a working setup. gov will do what it can and ask you when",
    "it cannot — a browser sign-in, an administrator password, a decision that is yours.",
    "Nothing changes your machine without being shown to you first.",
    "",
  ];
}

/** Shown again as work completes, so "how far along am I" never needs asking. */
export function checklistProgress(items: readonly ChecklistItem[]): readonly string[] {
  const done = items.filter((i) => i.done && !i.sub).length;
  const total = items.filter((i) => !i.sub).length;
  return ["", `Progress — ${done} of ${total} done:`, "", ...renderChecklist(items), ""];
}
