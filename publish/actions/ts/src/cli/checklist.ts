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

import { paint } from "./format.js";

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
  /** The ids in the org's approved_agents block, if it has one yet (#196). */
  readonly approvedAgents?: readonly string[];
  /**
   * Whether the starter project's review issue is closed — which is what "the
   * policies were reviewed" MEANS here, so even the soft step derives (#196, Q12).
   */
  readonly policiesReviewed?: boolean;
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
  const home = or(f.workspacePath, `~/.gov/${slug}/gov_repo`);
  // From the slug, lowercased, because that is how the directory is actually named —
  // a status line that shows a path nobody has is worse than showing none.
  const projects = `~/.gov/${slug.toLowerCase()}/projects`;
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
    { n: "5", done: f.ghAuthenticated && f.ghScopesOk, text: "Authorize gov for GitHub  (gh auth login -s repo,read:org,project)" },
    { n: "6", done: f.gitIdentityOk, text: "Configure git  (git config --global user.name / user.email)" },
    { n: "7", done: f.workspaceResolves, text: `Create the governance workspace folder at ${home}` },
  );

  // STEP 8 IS THE ONE THAT DIFFERS BY ROLE, and only this one. An adopter founds an
  // organization; a joiner clones one that exists. Listing the founding steps against
  // a joiner's name would be a list of things they must not do.
  //
  // BEFORE THE ROLE IS KNOWN, neither branch is shown. It used to fall through to the
  // adopter's — so someone who had not yet been asked whether they were adopting or
  // joining was shown five steps about founding an organization, as though the answer
  // were already given.
  const built = f.workspaceResolves;
  if (f.role === null) {
    items.push({ n: "8", done: built, text: "Set your organization up (adopters) — or bring in your org's (joiners)" });
  } else if (f.role === "joiner") {
    items.push({ n: "8", done: built, text: "Bring in your organization's governance repository (joiners)" });
    items.push({ n: "8a", sub: true, done: built, text: `Clone it to ${home}` });
  } else {
    items.push({ n: "8", done: built, text: "Set your organization up (adopters)" });
    items.push({ n: "8a", sub: true, done: built, text: `Create the governance repository at ${home}, from the framework template` });
    // The one decision adoption cannot defer: an org with no approved agent cannot
    // run any, and everyone who joins is offered exactly what is chosen here (#196).
    items.push({ n: "8b", sub: true, done: Boolean(f.approvedAgents?.length), text: "Choose which AI agents this organization allows" });
    items.push({ n: "8c", sub: true, done: built, text: "Seed the starter policies and agent harness into it" });
    items.push({ n: "8d", sub: true, done: built, text: "Replace the framework's placeholders with your organization's values" });
    items.push({ n: "8e", sub: true, done: built, text: "Commit and push it to your organization" });
    items.push({ n: "8f", sub: true, done: f.policiesReviewed ?? false, text: "Review the seeded policies and make them yours" });
  }

  items.push(
    { n: "9", done: Boolean(f.orgActive), text: "Finish setting up this machine" },
    { n: "9a", sub: true, done: Boolean(f.orgActive), text: `Activate the org — ${or(f.orgActive, "<your GitHub org>")} → ${home}` },
    { n: "9b", sub: true, done: f.workspaceResolves, text: `Prepare the project work root at ${projects}` },
  );
  return items;
}

/**
 * `color` off by default (#204): the tick is the meaning, and the colour only makes it easier
 * to find. A done item's text is dimmed rather than its tick recoloured twice — the eye is
 * looking for what is LEFT, and dimming what is finished is what puts it there.
 */
export function renderChecklist(items: readonly ChecklistItem[], color = false): readonly string[] {
  const width = Math.max(...items.map((i) => i.n.length));
  return items.map((i) => {
    const num = `${i.n}.`.padEnd(width + 1);
    const box = i.done ? `[${paint("\u2713", "green", color)}]` : "[ ]";
    return `  ${i.sub ? "   " : ""}${num} ${box} ${i.done ? paint(i.text, "dim", color) : i.text}`;
  });
}

const RULE = "=".repeat(88);

/** Shown once, before anything runs, so nobody meets these one surprise at a time. */
export function checklistPreamble(color = false): readonly string[] {
  return [
    "",
    RULE,
    `  ${paint("What to expect", "bold", color)}`,
    RULE,
    "  · Nothing is installed or changed without being shown to you first.",
    "  · Each step reports as it completes, so you always know how far along you are.",
    "  · Some steps only you can do — a browser sign-in, an administrator password,",
    "    a name for your organization. gov will stop and ask.",
    "",
  ];
}

/** The banner that opens one step, so the run reads as the plan did. */
export function stepBanner(item: ChecklistItem, color = false): readonly string[] {
  return ["", "", RULE, paint(`===> ${item.n}. ${item.text}`, "bold", color), ""];
}

/** The line that closes it. */
export function stepDone(item: ChecklistItem, ok = true, color = false): string {
  return `===> ${item.n}. [${ok ? paint("\u2713", "green", color) : " "}] ${item.text}`;
}

/**
 * The whole list again, with a heading that tells the truth about where you are.
 *
 * It said "Final status" at the end of `doctor --fix` — with the organization still
 * to set up, five unticked steps on screen, and the next question already queued.
 * A heading that announces an ending which has not come teaches the reader to
 * distrust the rest of the screen.
 */
export function statusSoFar(items: readonly ChecklistItem[], color = false): readonly string[] {
  const remaining = items.filter((i) => !i.done && !i.sub).length;
  return [
    "",
    RULE,
    `  ${paint(remaining
      ? `Where things stand \u2014 ${remaining} step(s) still to go`
      : "Where things stand \u2014 everything on this machine is done", "bold", color)}`,
    RULE,
    ...renderChecklist(items, color),
    "",
  ];
}

/**
 * The end, and meant to be kept — which is why every path is spelled out rather
 * than referred to.
 */
export function finalStatus(items: readonly ChecklistItem[], color = false): readonly string[] {
  return [
    "",
    RULE,
    `  ${paint("Final status \u2014 worth a screenshot. These paths are also in your org-config.yaml.", "bold", color)}`,
    RULE,
    ...renderChecklist(items, color),
    "",
  ];
}

/** Shown again as work completes, so "how far along am I" never needs asking. */
export function checklistProgress(items: readonly ChecklistItem[], color = false): readonly string[] {
  const done = items.filter((i) => i.done && !i.sub).length;
  const total = items.filter((i) => !i.sub).length;
  return ["", `Progress \u2014 ${done} of ${total} done:`, "", ...renderChecklist(items, color), ""];
}
