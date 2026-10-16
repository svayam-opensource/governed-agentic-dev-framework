// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WorkTrackerPort in memory — the reference adapter the conformance suite runs against in the unit tier. It
 * refuses what GitHub refuses (no assignee, an assignee it does not know, an empty title or comment, a board
 * without a Status field, an item not on the board), so code tested against it does not learn habits GitHub
 * would punish.
 *
 * Test helpers beside the port: the comments on an item, closing an item, refusing native `blocks` links (to
 * exercise the marker fallback), and the synchronous {@link BoardWriter} over the same boards.
 */
import { fail, ok, type Result } from "../../ports/result.js";
import {
  linkMarker, statusAsResult,
  type BoardCloseResult, type BoardStatusResult, type BoardWriter, type Item, type ItemRef, type LinkKind,
  type ProjectRef, type WorkState, type WorkTrackerPort,
} from "../../ports/work-tracker.js";

export interface MemoryProjectSeed {
  readonly ref: ProjectRef;
  readonly title: string;
  /** false: the board has no Status field, so setState fails `no-field`. Default true. */
  readonly statusField?: boolean;
  /** false: the invoker may read the board but not add to it — addToProject fails `denied`. Default true. */
  readonly writable?: boolean;
}

export interface MemoryWorkTrackerSeed {
  readonly projects?: readonly MemoryProjectSeed[];
  /** Logins that may be assigned. Absent: anyone. */
  readonly assignable?: readonly string[];
}

export interface MemoryWorkTracker extends WorkTrackerPort {
  /** The comments on an item, oldest first. */
  commentsOn(i: ItemRef): string[];
  /** The native links recorded (`a blocks b`). */
  nativeLinks(): { a: string; kind: LinkKind; b: string }[];
  /** Close an item — for arranging a search by state. */
  closeItem(i: ItemRef): void;
  /** From now on, refuse native `blocks` links, as GitHub does without issue dependencies. */
  refuseNativeBlocks(): void;
  /** The synchronous slice over the same boards. */
  boardWriter(): BoardWriter;
}

interface MItem { url: string; title: string; body: string; state: "open" | "closed"; labels: string[]; assignees: string[]; comments: string[] }
interface MProject { ref: ProjectRef; title: string; closed: boolean; description: string; statusField: boolean; writable: boolean; items: Map<string, WorkState | null> }

const pkey = (p: ProjectRef): string => `${p.owner.toLowerCase()}#${p.number}`;
const done: Result<void> = ok(undefined);

export function createMemoryWorkTracker(seed: MemoryWorkTrackerSeed = {}): MemoryWorkTracker {
  const projects = new Map<string, MProject>();
  const items = new Map<string, MItem>();
  const links: { a: string; kind: LinkKind; b: string }[] = [];
  const counters = new Map<string, number>();
  let blocksRefused = false;

  const addProject = (s: MemoryProjectSeed): void => {
    projects.set(pkey(s.ref), { ref: { owner: s.ref.owner, number: s.ref.number }, title: s.title, closed: false, description: "", statusField: s.statusField !== false, writable: s.writable !== false, items: new Map() });
  };
  for (const s of seed.projects ?? []) addProject(s);

  const noProject = (p: ProjectRef) => fail(`no project ${p.owner}#${p.number}`);
  const noItem = (i: ItemRef) => fail(`no item ${i.url}`);
  const view = (m: MItem): Item => ({ ref: { url: m.url }, title: m.title, body: m.body, state: m.state, labels: [...m.labels], assignees: [...m.assignees] });

  const setState = (p: ProjectRef, url: string, s: WorkState): BoardStatusResult => {
    const pr = projects.get(pkey(p));
    if (!pr || !pr.items.has(url)) return { ok: false, why: "not-on-board", detail: `${url} is not an item of board ${p.owner}#${p.number}` };
    if (!pr.statusField) return { ok: false, why: "no-field", detail: `board #${p.number} has no single-select field named Status` };
    pr.items.set(url, s);
    return { ok: true };
  };
  const closeProject = (p: ProjectRef, pointer?: string): BoardCloseResult => {
    const pr = projects.get(pkey(p));
    if (!pr) return { ok: false, why: "unreachable", detail: `no project ${p.owner}#${p.number}` };
    if (pointer !== undefined) pr.description = `Closed — the work continues at ${pointer}`;
    pr.closed = true;
    return { ok: true };
  };
  const comment = (i: ItemRef, text: string): Result<void> => {
    const m = items.get(i.url);
    if (!m) return noItem(i);
    if (!text.trim()) return fail("a comment needs text");
    m.comments.push(text);
    return done;
  };
  const addToProject = (p: ProjectRef, i: ItemRef): Result<void> => {
    const pr = projects.get(pkey(p));
    if (!pr) return noProject(p);
    if (!items.has(i.url)) return noItem(i);
    if (!pr.writable) return fail(`denied: may not add items to project ${p.owner}#${p.number}`);
    if (!pr.items.has(i.url)) pr.items.set(i.url, null);
    return done;
  };

  return {
    async project(p) {
      const pr = projects.get(pkey(p));
      return pr ? ok({ ref: pr.ref, title: pr.title, state: pr.closed ? "closed" : "open", url: `memory://projects/${pkey(p)}`, description: pr.description }) : noProject(p);
    },
    async items(p) {
      const pr = projects.get(pkey(p));
      if (!pr) return noProject(p);
      return ok([...pr.items].flatMap(([url, s]) => { const m = items.get(url); return m ? [{ ...view(m), workState: s }] : []; }));
    },
    async item(i) {
      const m = items.get(i.url);
      return m ? ok(view(m)) : noItem(i);
    },
    async create(where, item, onto = []) {
      const who = item.assignee?.trim() ?? "";
      if (!who) return fail("an item needs an assignee — gov never creates an unassigned one");
      if (seed.assignable && !seed.assignable.includes(who)) return fail(`'${who}' cannot be assigned in ${where.owner}/${where.name}`);
      if (!item.title.trim()) return fail("an item needs a title");
      const k = `${where.owner}/${where.name}`;
      const n = (counters.get(k) ?? 0) + 1;
      counters.set(k, n);
      const url = `memory://${k}/issues/${n}`;
      items.set(url, { url, title: item.title, body: item.body, state: "open", labels: [...(item.labels ?? [])], assignees: [who], comments: [] });
      for (const p of onto) {
        const a = addToProject(p, { url });
        if (!a.ok) return fail(`created ${url}, but it is not on project ${p.owner}#${p.number} — ${a.reason}`);
      }
      return ok({ url });
    },
    async addToProject(p, i) { return addToProject(p, i); },
    async removeFromProject(p, i) {
      const pr = projects.get(pkey(p));
      if (!pr) return noProject(p);
      if (!pr.items.delete(i.url)) return fail(`${i.url} is not an item of board ${p.owner}#${p.number}`);
      return done;
    },
    async setState(p, i, s) { return statusAsResult(setState(p, i.url, s)); },
    async link(a, b, kind) {
      if (!items.has(a.url)) return noItem(a);
      if (!items.has(b.url)) return noItem(b);
      if (kind === "blocks" && !blocksRefused) { links.push({ a: a.url, kind, b: b.url }); return ok({ via: "native" }); }
      const on = kind === "blocks" ? b : a;
      const say = { blocks: `Blocked by ${a.url}.`, relates: `Related to ${b.url}.`, "moved-to": `Moved to ${b.url}.` }[kind];
      const c = comment(on, `${say}\n\n${linkMarker(a, kind, b)}`);
      return c.ok ? ok({ via: "marker" }) : c;
    },
    async label(i, add, remove = []) {
      const m = items.get(i.url);
      if (!m) return noItem(i);
      m.labels = [...m.labels.filter((l) => !remove.includes(l)), ...add.filter((l) => !m.labels.includes(l))];
      return done;
    },
    async comment(i, text) { return comment(i, text); },
    async close(i) {
      const m = items.get(i.url);
      if (!m) return noItem(i);
      m.state = "closed";
      return done;
    },
    async search(q) {
      const inRepo = (url: string) => !q.repo || url.startsWith(`memory://${q.repo.owner}/${q.repo.name}/`);
      return ok([...items.values()]
        .filter((m) => inRepo(m.url))
        .filter((m) => !q.marker || m.body.includes(q.marker))
        .filter((m) => (q.labels ?? []).every((l) => m.labels.includes(l)))
        .filter((m) => !q.state || m.state === q.state)
        .map(view));
    },
    async createProject(owner, title) {
      if (!title.trim()) return fail("a project needs a title");
      const used = [...projects.values()].filter((p) => p.ref.owner.toLowerCase() === owner.toLowerCase()).map((p) => p.ref.number);
      const ref = { owner, number: Math.max(0, ...used) + 1 };
      addProject({ ref, title });
      return ok(ref);
    },
    async closeProject(p, pointer) { return statusAsResult(closeProject(p, pointer)); },

    commentsOn: (i) => [...(items.get(i.url)?.comments ?? [])],
    nativeLinks: () => links.map((l) => ({ ...l })),
    closeItem(i) {
      const m = items.get(i.url);
      if (!m) throw new Error(`memory work tracker: no item ${i.url}`);
      m.state = "closed";
    },
    refuseNativeBlocks() { blocksRefused = true; },
    boardWriter: () => ({ setState, closeProject }),
  };
}
