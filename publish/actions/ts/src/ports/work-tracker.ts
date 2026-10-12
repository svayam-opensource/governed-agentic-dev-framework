// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The WorkTrackerPort — the neutral seam between gov's lifecycle and whatever tracks the work (a GitHub Project
 * board today). M4: new tracker code goes behind this port, never straight to `gh`.
 *
 * Started by PRJ-121 intent 05 (gadf#225, ruling Q4) with the two board writes the lifecycle makes; completed by
 * intent 03 (L02, spec 03 §6): projects, items, create (assignee required), add/remove, state, links, labels,
 * comments, search, createProject, closeProject. `setStatus` became `setState` (plan 03, decision 3).
 *
 * EVERY WRITE RETURNS ITS OUTCOME. The stub this replaced returned `void` and did nothing, and gov printed
 * success for two years of tasks whose Status never moved. A board that cannot be updated must not fail a task
 * or a merge — the branches are already made — but the caller is always told which and why.
 *
 * TWO SHAPES, ONE ADAPTER. {@link WorkTrackerPort} is the full port, async and {@link Result}-returning like every
 * port. The lifecycle commands that already wrote the board (task, merge, close, cancel) run synchronously end to
 * end, so they hold the {@link BoardWriter} slice — the same two writes, synchronous, with T04's typed reasons.
 * Each adapter builds both from one implementation; nothing is written twice.
 *
 * Vendor-neutral words: a "project" is a GitHub Project board; an "item" is an issue on it; the "state" is the
 * board's Status (Todo · In progress · Done).
 */
import type { Result } from "./result.js";
import type { RepoRef } from "./vcs.js";

/** A project (board), by owner and number. T04's `BoardRef` fits it. */
export interface ProjectRef { readonly owner: string; readonly number: number }

/** A work item, by its address on the tracker (on GitHub: the issue URL). */
export interface ItemRef { readonly url: string }

/** Where an item stands on a project — the board's Status. */
export type WorkState = "todo" | "in-progress" | "done";
export const WORK_STATES: readonly WorkState[] = ["todo", "in-progress", "done"];

/** The Status option each state sets, matched case-insensitively against the board's options. */
export const STATE_NAMES: Readonly<Record<WorkState, string>> = { todo: "Todo", "in-progress": "In progress", done: "Done" };

/** The state a Status option name means, or null for a name that is none of the three. */
export function stateOfStatus(name: string | null | undefined): WorkState | null {
  const n = (name ?? "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (n === "todo" || n === "to do") return "todo";
  if (n === "in progress") return "in-progress";
  if (n === "done") return "done";
  return null;
}

export interface Project {
  readonly ref: ProjectRef;
  readonly title: string;
  readonly state: "open" | "closed";
  /** Where a person opens it. */
  readonly url: string;
  /** The project's one-line description; `closeProject(p, pointer)` writes the pointer here. */
  readonly description: string;
}

export interface Item {
  readonly ref: ItemRef;
  readonly title: string;
  readonly body: string;
  /** open or closed — the item itself, not its place on a board. */
  readonly state: "open" | "closed";
  readonly labels: readonly string[];
  readonly assignees: readonly string[];
  /** Its Status on the project it was read from (`items()`); null when unset or none of the three; absent elsewhere. */
  readonly workState?: WorkState | null;
}

export interface NewItem {
  readonly title: string;
  readonly body: string;
  /** REQUIRED (spec 03 §7: no flag produces an unassigned issue). An empty one is refused before anything is created. */
  readonly assignee: string;
  readonly labels?: readonly string[];
}

export type LinkKind = "blocks" | "relates" | "moved-to";

/**
 * How a link was recorded: `native` — the tracker's own relation; `marker` — a comment carrying
 * {@link linkMarker}, because the tracker has no such relation or refused it (`blocks` falls back; spec §10).
 */
export interface LinkOutcome { readonly via: "native" | "marker" }

/**
 * The machine-readable line a marker link leaves in its comment — the whole relation (`a <kind> b`), so it reads
 * the same on whichever item carries it. Parsed by {@link parseLinkMarker}.
 */
export const linkMarker = (a: ItemRef, kind: LinkKind, b: ItemRef): string => `<!-- gov-link ${a.url} ${kind} ${b.url} -->`;
export function parseLinkMarker(text: string): { from: ItemRef; kind: LinkKind; to: ItemRef } | null {
  const m = /<!-- gov-link (\S+) (blocks|relates|moved-to) (\S+) -->/.exec(text);
  return m ? { from: { url: m[1]! }, kind: m[2] as LinkKind, to: { url: m[3]! } } : null;
}

export interface SearchQuery {
  /** Every one of these labels. */
  readonly labels?: readonly string[];
  /** Text the item's body contains, exactly (e.g. a `<!-- gov-signal … -->` marker). */
  readonly marker?: string;
  readonly state?: "open" | "closed";
  /** Where to look. The GitHub adapter needs it (it will not search all of GitHub); memory searches everything. */
  readonly repo?: RepoRef;
}

export interface WorkTrackerPort {
  project(p: ProjectRef): Promise<Result<Project>>;
  items(p: ProjectRef): Promise<Result<Item[]>>;
  item(i: ItemRef): Promise<Result<Item>>;
  /** Assignee REQUIRED. With `onto`, also added to each project; a project it could not join fails the call, naming the item made. */
  create(where: RepoRef, item: NewItem, onto?: readonly ProjectRef[]): Promise<Result<ItemRef>>;
  /** Idempotent: an item already on the project is ok. */
  addToProject(p: ProjectRef, i: ItemRef): Promise<Result<void>>;
  /** An item not on the project is a failure, not a quiet ok. */
  removeFromProject(p: ProjectRef, i: ItemRef): Promise<Result<void>>;
  setState(p: ProjectRef, i: ItemRef, s: WorkState): Promise<Result<void>>;
  /** `a <kind> b`: a blocks b · a relates to b · a moved to b. */
  link(a: ItemRef, b: ItemRef, kind: LinkKind): Promise<Result<LinkOutcome>>;
  label(i: ItemRef, add: readonly string[], remove?: readonly string[]): Promise<Result<void>>;
  comment(i: ItemRef, text: string): Promise<Result<void>>;
  search(q: SearchQuery): Promise<Result<Item[]>>;
  createProject(owner: string, title: string): Promise<Result<ProjectRef>>;
  /** Close it; with `pointer` (where the work went), the project's description says so first. */
  closeProject(p: ProjectRef, pointer?: string): Promise<Result<void>>;
}

// ── The synchronous slice the lifecycle commands hold (T04's shape, renamed) ──────────────────────────────────

/** Why a Status could not be set. */
export type BoardStatusWhy =
  | "no-field"       // the board has no single-select field named Status
  | "no-option"      // Status has no option with that name (matched case-insensitively)
  | "not-on-board"   // the issue is not an item of this board (or cannot be resolved at all)
  | "denied"         // the token may not read or write the board
  | "unreachable";   // anything else: network, an unexpected answer, no tracker wired

export type BoardStatusResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly why: BoardStatusWhy; readonly detail: string };

export type BoardCloseResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly why: "denied" | "unreachable"; readonly detail: string };

/**
 * The two board writes `gov task`, `gov merge`, `gov close` and `gov cancel` make, synchronously (those commands
 * are synchronous end to end). Never throws. The adapter's full {@link WorkTrackerPort} does the same through
 * `setState` / `closeProject`.
 */
export interface BoardWriter {
  /** Set the Status of the board item for `issueUrl`. */
  setState(p: ProjectRef, issueUrl: string, s: WorkState): BoardStatusResult;
  /** Close the board — the project then reads as completed (or cancelled). */
  closeProject(p: ProjectRef, pointer?: string): BoardCloseResult;
}

/** What a caller reports when no tracker was wired: a fact, not a silent skip. */
export const NO_TRACKER = { ok: false, why: "unreachable", detail: "no work tracker is wired into this command" } as const;

/** One issue's Status write, as task and merge report it. `status` is the board's word for the state. */
export interface BoardStatusOutcome {
  readonly issueUrl: string;
  readonly status: string;
  readonly result: BoardStatusResult;
}

/** A {@link BoardStatusResult} as a port {@link Result}: the reason starts with the why; only `unreachable` is retryable. */
export function statusAsResult(r: BoardStatusResult | BoardCloseResult): Result<void> {
  return r.ok ? { ok: true, value: undefined } : { ok: false, reason: `${r.why}: ${r.detail}`, retryable: r.why === "unreachable" };
}
