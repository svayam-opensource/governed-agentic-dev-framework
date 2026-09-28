// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE PROJECT PICKER — what Work offers, in what order, and what a keystroke means.
 *
 * Built from `knowledge/work-project-picker-design.md` (Policy Owner, agreed 2026-09-22), which was
 * prompted by a walk of `gov work` on an org with 100+ boards: *"since the number of projects may be
 * large, and GitHub may throttle on a large number of requests, would it make sense to add a search
 * so the list can be small and the user finds their project easily?"*
 *
 * Four things came out of that, and all four live here:
 *
 *   1. LOCAL FIRST — a project with a folder on this machine is listed from the disk alone, before any
 *      GitHub call is made, because "continue what I was doing yesterday" is most of the daily use.
 *   2. YOURS, THEN COULD-START — two labelled levels, never one undifferentiated list. Being assigned
 *      is the access, so that list costs two calls however big the org is; "could start" is the only
 *      list that needs a write-access call per board, and it is reached deliberately.
 *   3. `/text` SEARCH — filtering beats paging past a handful, and it is applied BEFORE any per-board
 *      access check, so a search saves GitHub calls rather than only screen space.
 *   4. LEAD WITH SEARCH PAST A THRESHOLD — at 42 entries a list is the wrong primary affordance.
 *
 * EVERYTHING IN THIS FILE IS PURE. Ranking, grouping, paging, the search-first decision and the key
 * vocabulary are functions of their arguments; the terminal, the disk and `gh` belong to the caller
 * (`work-flow.ts`). That is what lets the arithmetic below be tested with a list long enough to page
 * three times, which is the one thing the previous version of this list was never tested for — it
 * paginated 11, then 1, then 7, because the page size and the filter were applied in the wrong order.
 */
import { termsOf } from "../knowledge-search.js";
import { isRateLimited } from "../lifecycle/project-list.js";
import { numberPref, boolPref, stringPref, type Preferences } from "../preferences.js";

/** The three lists Work offers, in the order it offers them. */
export type PickerLevel = "local" | "mine" | "startable";

/** How the local list is ordered — `work.picker.localOrder`. */
export type LocalOrder = "last-used" | "number";

/** The least a thing must have to be ranked and listed. `title` is a board's, so the disk-only rows have none. */
export interface Pickable {
  readonly projectId: string;
  readonly title?: string;
}

// ── the settings, in force ────────────────────────────────────────────────────────────────────────

/**
 * The four `work.picker.*` settings, resolved. THREE OF THEM WERE DEFINED AND UNUSED: the file
 * documented `localFirst`, `localOrder` and `searchThreshold` and nothing read them, so `gov
 * preferences set work.picker.localFirst false` printed a confirmation and changed nothing. A
 * preference gov does not read is worse than one it does not have.
 */
export interface PickerSettings {
  readonly pageSize: number;
  readonly localFirst: boolean;
  readonly localOrder: LocalOrder;
  readonly searchThreshold: number;
}

/** `work.picker.pageSize`'s floor and default, kept here so the flow and the prefs file cannot disagree. */
export const MIN_PAGE_SIZE = 5;
export const DEFAULT_PAGE_SIZE = 15;
export const DEFAULT_SEARCH_THRESHOLD = 30;

/**
 * The settings as the flow will use them, clamped. A caller may hand through anything (a flag, a
 * preferences value that was valid when written and is out of range now), and a picker that shows
 * two rows per page, or none, is a broken picker — so the floor is applied HERE rather than at each use.
 */
export function pickerSettings(given: {
  readonly pageSize?: number; readonly localFirst?: boolean;
  readonly localOrder?: string; readonly searchThreshold?: number;
} = {}): PickerSettings {
  const size = Number(given.pageSize);
  const threshold = Number(given.searchThreshold);
  return {
    pageSize: Number.isFinite(size) && size >= MIN_PAGE_SIZE ? Math.floor(size) : DEFAULT_PAGE_SIZE,
    localFirst: given.localFirst ?? true,
    localOrder: given.localOrder === "number" ? "number" : "last-used",
    searchThreshold: Number.isFinite(threshold) && threshold >= 0 ? Math.floor(threshold) : DEFAULT_SEARCH_THRESHOLD,
  };
}

/** The same four, read from a person's `preferences.json` — one call, so a caller cannot wire three of four. */
export function pickerSettingsFromPreferences(prefs: Preferences): PickerSettings {
  return pickerSettings({
    pageSize: numberPref(prefs, "work.picker.pageSize"),
    localFirst: boolPref(prefs, "work.picker.localFirst"),
    localOrder: stringPref(prefs, "work.picker.localOrder") ?? "last-used",
    searchThreshold: numberPref(prefs, "work.picker.searchThreshold"),
  });
}

// ── paging ────────────────────────────────────────────────────────────────────────────────────────

export interface Paged<T> {
  readonly items: readonly T[];
  /** Where this page started, and where the next one does — the caller keeps no arithmetic of its own. */
  readonly offset: number;
  readonly nextOffset: number;
  readonly more: boolean;
  readonly total: number;
  readonly page: number;
  readonly pages: number;
}

/**
 * ONE PAGE OF A LIST THE CALLER ALREADY HAS — the filter is applied by the caller, before this.
 *
 * THE BUG THIS SHAPE PREVENTS: the picker used to page over BOARDS and then drop the ones that were
 * not offerable, so a "page of 15" arrived as 11, then 1, then 7 (a walk, 2026-09-22). The page size
 * belongs to what is SHOWN, which means the filtering has to have happened already — a function that
 * can only see the final list cannot make that mistake. Where an item's eligibility costs a GitHub
 * call and so cannot be resolved up front, use {@link fillPage}, which scans until the page is full.
 */
export function pageOf<T>(items: readonly T[], pageSize: number, offset: number): Paged<T> {
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const total = items.length;
  const off = Math.max(0, Math.min(Math.floor(offset) || 0, total));
  const slice = items.slice(off, off + size);
  return {
    items: slice,
    offset: off,
    nextOffset: off + slice.length,
    more: off + slice.length < total,
    total,
    page: Math.floor(off / size) + 1,
    pages: Math.max(1, Math.ceil(total / size)),
  };
}

/**
 * A FULL PAGE OF WHATEVER `keep` ADMITS — scanning from `offset` until `limit` items are found.
 *
 * For the one list whose eligibility costs a call per candidate ("boards you could start" needs a
 * write-access check). `keep` is called at most as many times as it takes to fill the page, which is
 * what keeps a large org from meaning a long wait — and never for a candidate a search already ruled
 * out, because the caller filters first (design §3.4: a search must save calls, not just screen space).
 *
 * `scanned` is how many candidates it looked at, so a caller can log the cost it actually paid.
 */
export function fillPage<T>(
  items: readonly T[], keep: (t: T) => boolean, limit: number, offset: number,
): { readonly items: T[]; readonly nextOffset: number; readonly more: boolean; readonly scanned: number } {
  const size = Math.max(1, Math.floor(limit) || 1);
  const out: T[] = [];
  let i = Math.max(0, Math.floor(offset) || 0);
  const from = i;
  for (; i < items.length && out.length < size; i++) if (keep(items[i]!)) out.push(items[i]!);
  return { items: out, nextOffset: i, more: i < items.length, scanned: i - from };
}

// ── matching ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Projects whose id matches `pattern` — a regex, so `43` finds `PRJ-43-…` and a full id still matches
 * itself. An invalid regex is matched LITERALLY rather than throwing: someone typing `gov work
 * --project=portal(v2` wants a project, not a lecture about escaping.
 *
 * This is the `--project=<pattern>` matcher, and it is the FLOOR of the interactive search below:
 * whatever the command line would match, the menu matches too, and ranks it first. (It lives here,
 * with the rest of the picker; `work-flow.ts` re-exports it, where every caller already imports it.)
 */
export function matchProjects<T extends { readonly projectId: string }>(items: readonly T[], pattern: string): T[] {
  let re: RegExp;
  try { re = new RegExp(pattern, "i"); }
  catch { /* an invalid regex is matched LITERALLY (see above) — someone typing `--project=portal(v2` wants a project, not a lecture */ return items.filter((i) => i.projectId.toLowerCase().includes(pattern.toLowerCase())); }
  return items.filter((i) => re.test(i.projectId));
}

/**
 * `/portal` — the entries that match, best first.
 *
 * The rules are `knowledge-search.ts`'s, because they are the ones this codebase has already argued
 * about and a person should not have to hold two ideas of "matches":
 *
 *   · EVERY term must appear somewhere — a search for two words must not return everything with either;
 *   · a match in the MORE SPECIFIC field wins — the project id is what a person half-remembers and
 *     types, the board title is the looser field, so an id hit outranks a title hit;
 *   · and the id REGEX (`matchProjects`, what `--project` uses) scores highest of all, so the menu can
 *     never match less than the command line does.
 *
 * Ties keep the order they arrived in — the caller sorts newest-board-first, and ranking must not
 * silently re-order what it cannot distinguish.
 */
export function rankProjects<T extends Pickable>(items: readonly T[], query: string): T[] {
  const q = query.trim();
  if (!q) return [...items];
  const terms = termsOf(q);
  if (!terms.length) return [...items];
  const regexHits = new Set(matchProjects(items, q).map((i) => i.projectId));

  const scored: { item: T; score: number; at: number }[] = [];
  items.forEach((item, at) => {
    const id = item.projectId.toLowerCase();
    const title = (item.title ?? "").toLowerCase();
    if (!terms.every((t) => id.includes(t) || title.includes(t)) && !regexHits.has(item.projectId)) return;
    let score = regexHits.has(item.projectId) ? 4 : 0;
    for (const t of terms) score += id.includes(t) ? 3 : title.includes(t) ? 1 : 0;
    if (terms.every((t) => id.includes(t))) score += 2;     // the whole query in the id: as specific as it gets
    scored.push({ item, score, at });
  });
  return scored.sort((a, b) => b.score - a.score || a.at - b.at).map((s) => s.item);
}

// ── the search-first decision ─────────────────────────────────────────────────────────────────────

/**
 * Past `threshold` entries, a level LEADS WITH SEARCH and offers paging second (design §3.5).
 *
 * Paging through 100 boards is the wrong tool at that size. It stays available — `m` still pages, and
 * a number still selects — but it is not what the prompt asks for first.
 *
 * `threshold` 0 is a real answer, not a disabled feature: somebody who sets it to 0 wants to type a
 * pattern every time. An already-filtered level never leads with search again (you have just searched).
 */
export function leadWithSearch(total: number, threshold: number, filtered = false): boolean {
  if (filtered) return false;
  if (!Number.isFinite(threshold) || threshold < 0) return false;
  return total > threshold;
}

// ── the key vocabulary ────────────────────────────────────────────────────────────────────────────

export type PickerInput =
  | { readonly kind: "pick"; readonly n: number }
  | { readonly kind: "search"; readonly query: string }
  | { readonly kind: "clear" }
  | { readonly kind: "more" }
  | { readonly kind: "level"; readonly to: Exclude<PickerLevel, "local"> }
  | { readonly kind: "back" }
  | { readonly kind: "unknown" };

/** What this level is offering, so a key that does not apply here is `unknown` rather than a silent no-op. */
export interface PickerKeys {
  readonly more?: boolean;
  readonly mine?: boolean;
  readonly startable?: boolean;
}

/**
 * ONE KEYSTROKE, ONE MEANING — the same at every level (design, "Keys").
 *
 *   1–n     pick            ALWAYS. Whatever else this prompt leads with, a number still selects.
 *   /text   search here     `/` because it is the search key in `less`, `vim` and `man`; `?` means help
 *   /       clear it
 *   m       next page
 *   g       yours on GitHub
 *   s       you could start
 *   0/Enter back one level   (the menu's stack rule, `361fe04`)
 *
 * A key the level does not offer is `unknown`: the footer names only what applies, and answering with
 * something that is not there must say so rather than appear to work.
 */
export function resolvePickerInput(raw: string, keys: PickerKeys = {}): PickerInput {
  const t = raw.trim();
  if (t === "" || t === "0") return { kind: "back" };
  if (t.startsWith("/")) {
    const q = t.slice(1).trim();
    return q ? { kind: "search", query: q } : { kind: "clear" };
  }
  const lower = t.toLowerCase();
  if (lower === "m") return keys.more ? { kind: "more" } : { kind: "unknown" };
  if (lower === "g") return keys.mine ? { kind: "level", to: "mine" } : { kind: "unknown" };
  if (lower === "s") return keys.startable ? { kind: "level", to: "startable" } : { kind: "unknown" };
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    return n >= 1 ? { kind: "pick", n } : { kind: "unknown" };
  }
  return { kind: "unknown" };
}

// ── what the level looks like ─────────────────────────────────────────────────────────────────────

/** One row as the person reads it: the id, and the one fact that tells it apart from its neighbours. */
export interface PickerRow {
  readonly projectId: string;
  /** `(active)`, `(not started)`, `BRNCH-121-… · 2 days ago` — never empty for a board, may be for a folder. */
  readonly note: string;
}

export interface LevelView {
  readonly level: PickerLevel;
  /** The rows of THIS page, already filtered and already access-checked where that costs a call. */
  readonly rows: readonly PickerRow[];
  /** How many entries the level has (after any filter). For `startable` that is BOARDS — see the note below. */
  readonly total: number;
  readonly page: number;
  readonly pages: number;
  readonly more: boolean;
  readonly query: string | null;
  /** Lead with the search prompt and list nothing (design §3.5). */
  readonly searchFirst: boolean;
  readonly keys: PickerKeys;
}

const HEADLINE: Record<PickerLevel, string> = {
  local: "On this machine — projects you have already opened (no GitHub call):",
  mine: "Yours on GitHub — the boards you are assigned on:",
  startable: "You could start — open boards nobody has seeded yet:",
};

/**
 * What a level of many entries says INSTEAD of a list (design §3.5, verbatim shape):
 *
 *     42 projects you could start. Type part of a name to search (/), or m to page through them.
 *
 * "boards nobody has started yet" rather than the design's "projects you could start" for that level,
 * because gov has NOT yet checked which of them it can write — that is the per-page call §3.3 defers.
 * Naming 42 as startable and then listing 11 would be the pagination lie in a different costume.
 */
const NOUN: Record<PickerLevel, (n: number) => string> = {
  local: (n) => `${n} project${n === 1 ? "" : "s"} on this machine`,
  mine: (n) => `${n} project${n === 1 ? "" : "s"} assigned to you`,
  startable: (n) => `${n} board${n === 1 ? "" : "s"} nobody has started yet`,
};

/** The whole level, as lines. Pure — so the screen is asserted in a unit test, not only in a pty. */
export function formatLevel(v: LevelView): string[] {
  const out: string[] = [""];
  out.push(`  ${HEADLINE[v.level]}`);
  if (v.query !== null) {
    out.push(v.total === 0
      ? `  nothing matches '${v.query}' here — / clears it, 0 goes back.`
      : `  ${v.total} match${v.total === 1 ? "" : "es"} '${v.query}'${v.pages > 1 ? ` · page ${v.page} of ${v.pages}` : ""}`);
  } else if (v.searchFirst) {
    out.push(`  ${NOUN[v.level](v.total)}. Type part of a name to search (/), or m to page through them.`);
  } else if (v.pages > 1) {
    out.push(`  page ${v.page} of ${v.pages}`);
  }
  if (!v.searchFirst) {
    const width = Math.max(0, ...v.rows.map((r) => r.projectId.length));
    v.rows.forEach((r, i) => out.push(`    ${String(i + 1).padStart(2)}) ${r.projectId.padEnd(width)}  ${r.note}`));
  }
  // ONE MATCH IS SHOWN, NEVER OPENED UNASKED (design §3.4). A search that lands on exactly one project
  // still waits for the keystroke: gov guessing here would seed a board on a typo.
  if (v.query !== null && v.total === 1) out.push("     press 1 to open it");
  out.push(...pickerFooter(v));
  return out;
}

/** The footer names ONLY the keys that apply here — an offer that does nothing is worse than none. */
export function pickerFooter(v: LevelView): string[] {
  const out: string[] = [];
  if (v.more) out.push("     m) more");
  out.push(v.query === null ? "     /text) search this list — e.g. /billing" : "     /text) search again  ·  /) show them all");
  if (v.keys.mine) out.push("     g) yours on GitHub");
  if (v.keys.startable) out.push("     s) you could start — boards with no project yet");
  out.push("     0) back");
  return out;
}

// ── when GitHub will not answer ───────────────────────────────────────────────────────────────────

/**
 * GITHUB THROTTLING IS A FIRST-CLASS ANSWER, NOT AN EXCEPTION (the design's own motivation).
 *
 * A picker that hangs, or that says "no projects", is worse than one that says what happened and shows
 * what it already has. gov reached the second of those once before — `lastFailure` exists because a
 * dropped connection was reported as "you have no projects" (a walk, 2026-09-22) — and a rate limit is
 * the same defect with a different cause: the list is empty for a reason that has nothing to do with
 * the person's projects, and the remedy is different for each.
 *
 * So: name the cause, say the projects are fine, and — the part that makes it usable — hand back the
 * list that costs nothing, the folders already on this machine.
 */
export function githubUnreachableLines(failure: string, localCount: number): string[] {
  const out = isRateLimited(failure)
    ? ["  GitHub is rate-limiting this token, so gov cannot list the org's boards right now.",
       "  Nothing is wrong with your projects. `gh api rate_limit` says when the limit resets."]
    : ["  Could not reach GitHub to list your projects — nothing is wrong with your projects.",
       "  Try again in a moment; if it keeps failing, check `gh auth status` and your network."];
  out.push(localCount > 0
    ? `  Here ${localCount === 1 ? "is the project" : `are the ${localCount} projects`} already on this machine — opening one needs no GitHub call.`
    : "  No project is cloned on this machine either, so there is nothing to offer offline.");
  return out;
}
