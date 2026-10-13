// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * VcsPort in memory — the reference adapter the conformance suite runs against in the unit tier. It refuses what
 * a real host refuses (a missing branch, head equal to base, a second open change request for the same pair, an
 * empty title), so code tested against it does not learn habits GitHub would punish.
 *
 * Test helpers beside the port: seed a change request, add a review, merge or close one.
 */
import { fail, ok } from "../../ports/result.js";
import type { ChangeRequest, ChangeRequestRef, Identity, NewChangeRequest, RepoRef, Review, VcsPort } from "../../ports/vcs.js";
import { isBotAccount } from "../github/vcs.js";

export interface MemoryRepoSeed {
  readonly repo: RepoRef;
  readonly defaultBranch: string;
  readonly visibility?: "public" | "private" | "internal";
  /** branch → sha */
  readonly branches: Readonly<Record<string, string>>;
  /** branch → the checks it requires */
  readonly requiredChecks?: Readonly<Record<string, readonly string[]>>;
}

export interface MemoryReviewSeed {
  readonly by: string;
  /** The account type, as a host reports it; a login ending in [bot] is a bot regardless. */
  readonly type?: "User" | "Bot";
  readonly verdict: Review["verdict"];
  readonly at?: string;
}

export interface MemoryVcs extends VcsPort {
  /** Open a change request without the port's checks — for arranging a test. */
  seedChangeRequest(cr: NewChangeRequest): ChangeRequestRef;
  addReview(ref: ChangeRequestRef, review: MemoryReviewSeed): void;
  merge(ref: ChangeRequestRef): void;
  close(ref: ChangeRequestRef): void;
}

const key = (r: RepoRef): string => `${r.owner}/${r.name}`;

export function createMemoryVcs(seed: { readonly repos?: readonly MemoryRepoSeed[]; readonly identity?: Identity } = {}): MemoryVcs {
  const repos = new Map(seed.repos?.map((r) => [key(r.repo), r]) ?? []);
  const crs = new Map<string, { cr: ChangeRequest; reviews: Review[] }[]>();
  let clock = 0;
  const now = (): string => new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString();

  const listFor = (r: RepoRef) => { const k = key(r); if (!crs.has(k)) crs.set(k, []); return crs.get(k)!; };
  const find = (ref: ChangeRequestRef) => crs.get(key(ref.repo))?.find((x) => x.cr.ref.number === ref.number);
  const add = (cr: NewChangeRequest): ChangeRequestRef => {
    const list = listFor(cr.repo);
    const ref = { repo: cr.repo, number: list.length + 1 };
    list.push({
      cr: { ref, state: "open", merged: false, draft: cr.draft === true, head: cr.head, base: cr.base, title: cr.title, url: `memory://${key(cr.repo)}/change/${ref.number}` },
      reviews: [],
    });
    return ref;
  };
  const set = (ref: ChangeRequestRef, patch: Partial<ChangeRequest>): void => {
    const x = find(ref);
    if (!x) throw new Error(`memory vcs: no change request #${ref.number} in ${key(ref.repo)}`);
    x.cr = { ...x.cr, ...patch };
  };

  return {
    async repo(r) {
      const s = repos.get(key(r));
      return s ? ok({ defaultBranch: s.defaultBranch, url: `memory://${key(r)}`, visibility: s.visibility ?? "private" }) : fail(`no repository ${key(r)}`);
    },
    async branch(r, name) {
      const s = repos.get(key(r));
      if (!s) return fail(`no repository ${key(r)}`);
      const sha = s.branches[name];
      return ok(sha === undefined ? null : { name, sha, protected: (s.requiredChecks?.[name]?.length ?? 0) > 0 });
    },
    async openChangeRequest(cr) {
      const s = repos.get(key(cr.repo));
      if (!s) return fail(`no repository ${key(cr.repo)}`);
      if (!cr.title.trim()) return fail("a change request needs a title");
      if (cr.head === cr.base) return fail(`head and base are both ${cr.head}`);
      for (const b of [cr.head, cr.base]) if (s.branches[b] === undefined) return fail(`no branch ${b} in ${key(cr.repo)}`);
      if (listFor(cr.repo).some((x) => x.cr.state === "open" && x.cr.head === cr.head && x.cr.base === cr.base)) {
        return fail(`a change request already exists for ${cr.head} → ${cr.base}`);
      }
      return ok(add(cr));
    },
    async changeRequest(ref) {
      const x = find(ref);
      return x ? ok(x.cr) : fail(`no change request #${ref.number} in ${key(ref.repo)}`);
    },
    async reviews(ref) {
      const x = find(ref);
      return x ? ok([...x.reviews]) : fail(`no change request #${ref.number} in ${key(ref.repo)}`);
    },
    async changeRequests(r, q) {
      if (!repos.get(key(r))) return fail(`no repository ${key(r)}`);
      const want = q.state ?? "all";
      return ok(listFor(r).map((x) => x.cr)
        .filter((c) => (q.base === undefined || c.base === q.base) && (q.head === undefined || c.head === q.head))
        .filter((c) => want === "all" || c.state === want)
        .sort((a, b) => b.ref.number - a.ref.number));
    },
    async requiredChecks(r, branch) {
      const s = repos.get(key(r));
      if (!s) return fail(`no repository ${key(r)}`);
      if (s.branches[branch] === undefined) return fail(`no branch ${branch} in ${key(r)}`);
      return ok([...(s.requiredChecks?.[branch] ?? [])]);
    },
    async identity() {
      return seed.identity ? ok(seed.identity) : fail("not signed in (no identity seeded)");
    },

    seedChangeRequest: add,
    addReview(ref, r) {
      const x = find(ref);
      if (!x) throw new Error(`memory vcs: no change request #${ref.number} in ${key(ref.repo)}`);
      x.reviews.push({ by: r.by, kind: isBotAccount(r.by, r.type) ? "bot" : "human", verdict: r.verdict, at: r.at ?? now() });
    },
    merge: (ref) => set(ref, { state: "merged", merged: true }),
    close: (ref) => set(ref, { state: "closed" }),
  };
}
