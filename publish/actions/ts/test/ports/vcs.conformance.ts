// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE VcsPort CONFORMANCE SUITE (PRJ-121 intent 03, D7, plan L03).
 *
 * One suite, every adapter. Unit tests run it against `memory` (test/ports/vcs.memory.test.ts); the live tier runs
 * it against `github` in svayam-e2e with a fixture that points at a prepared sandbox repository. An adapter that
 * passes here answers every question the same way, so the code that asks never needs to know which one it got.
 *
 * Not a `*.test.ts` file on purpose: mocha does not pick it up by itself; a runner imports {@link vcsConformance}
 * and hands it a fixture.
 */
import { expect } from "chai";
import type { ChangeRequestRef, Identity, RepoRef, VcsPort } from "../../src/ports/vcs.js";

/** What an adapter's runner prepares for the suite. Everything named here must already exist. */
export interface VcsFixture {
  readonly vcs: VcsPort;
  /** A repository the port can read and open change requests in. */
  readonly repo: RepoRef;
  /** Its default branch. */
  readonly defaultBranch: string;
  /** A branch with at least one commit its default branch lacks — the head of the change request the suite opens. */
  readonly head: string;
  /** A branch name that does not exist. */
  readonly missingBranch: string;
  /** A repository that does not exist (or this identity cannot see). */
  readonly missingRepo: RepoRef;
  /** What `requiredChecks` must answer for a branch, and for a branch with none. */
  readonly requiredChecks: { readonly branch: string; readonly checks: readonly string[]; readonly unprotected: string };
  /** A change request already reviewed by a person and by a bot. Absent → the review case is skipped. */
  readonly reviewed?: { readonly ref: ChangeRequestRef; readonly human: string; readonly bot: string };
  /** A merged change request. Absent → the merged case is skipped. */
  readonly merged?: ChangeRequestRef;
  /** Who the port is signed in as. */
  readonly identity: Identity;
  /** Undo what the suite created (live: close the change request it opened, delete nothing else). */
  cleanup?(opened: readonly ChangeRequestRef[]): Promise<void>;
}

/** Register the suite under `describe("VcsPort conformance — <name>")`. `setup` runs before each case. */
export function vcsConformance(name: string, setup: () => Promise<VcsFixture> | VcsFixture): void {
  describe(`VcsPort conformance — ${name}`, function () {
    let fx: VcsFixture;
    const opened: ChangeRequestRef[] = [];

    beforeEach(async () => { fx = await setup(); opened.length = 0; });
    afterEach(async () => { if (fx?.cleanup) await fx.cleanup(opened); });

    it("repo(): the default branch and the url", async () => {
      const r = await fx.vcs.repo(fx.repo);
      expect(r.ok, JSON.stringify(r)).to.equal(true);
      if (!r.ok) return;
      expect(r.value.defaultBranch).to.equal(fx.defaultBranch);
      expect(r.value.url).to.contain(fx.repo.name);
      expect(["public", "private", "internal"]).to.include(r.value.visibility);
    });

    it("repo(): one that does not exist is a failure with a reason, not a value", async () => {
      const r = await fx.vcs.repo(fx.missingRepo);
      expect(r.ok).to.equal(false);
      if (!r.ok) expect(r.reason).to.be.a("string").and.not.equal("");
    });

    it("branch(): an existing branch has a sha; a missing one is ok(null), not a failure", async () => {
      const b = await fx.vcs.branch(fx.repo, fx.head);
      expect(b.ok, JSON.stringify(b)).to.equal(true);
      if (b.ok) { expect(b.value?.name).to.equal(fx.head); expect(b.value?.sha).to.match(/^[0-9a-f]{7,40}$/); }
      const m = await fx.vcs.branch(fx.repo, fx.missingBranch);
      expect(m).to.deep.equal({ ok: true, value: null });
    });

    it("openChangeRequest() then changeRequest(): open, with the head and base asked for", async () => {
      const o = await fx.vcs.openChangeRequest({ repo: fx.repo, head: fx.head, base: fx.defaultBranch, title: "conformance: open", body: "opened by the VcsPort conformance suite", draft: true });
      expect(o.ok, JSON.stringify(o)).to.equal(true);
      if (!o.ok) return;
      opened.push(o.value);
      expect(o.value.number).to.be.a("number").and.greaterThan(0);
      const c = await fx.vcs.changeRequest(o.value);
      expect(c.ok, JSON.stringify(c)).to.equal(true);
      if (!c.ok) return;
      expect(c.value).to.deep.include({ state: "open", merged: false, head: fx.head, base: fx.defaultBranch, title: "conformance: open", draft: true });
      expect(c.value.url).to.be.a("string").and.not.equal("");
    });

    it("openChangeRequest(): onto a branch that does not exist fails, with a reason", async () => {
      const o = await fx.vcs.openChangeRequest({ repo: fx.repo, head: fx.missingBranch, base: fx.defaultBranch, title: "conformance: no head", body: "" });
      if (o.ok) opened.push(o.value);
      expect(o.ok).to.equal(false);
      if (!o.ok) expect(o.reason).to.not.equal("");
    });

    it("changeRequest(): a merged one says merged", async function () {
      if (!fx.merged) return this.skip();
      const c = await fx.vcs.changeRequest(fx.merged);
      expect(c.ok, JSON.stringify(c)).to.equal(true);
      if (c.ok) expect(c.value).to.deep.include({ state: "merged", merged: true });
    });

    it("changeRequest(): one that does not exist is a failure", async () => {
      const c = await fx.vcs.changeRequest({ repo: fx.repo, number: 999_999 });
      expect(c.ok).to.equal(false);
    });

    it("reviews(): each review says who, whether a person or a bot, the verdict and when", async function () {
      if (!fx.reviewed) return this.skip();
      const r = await fx.vcs.reviews(fx.reviewed.ref);
      expect(r.ok, JSON.stringify(r)).to.equal(true);
      if (!r.ok) return;
      const human = r.value.find((x) => x.by === fx.reviewed!.human);
      const bot = r.value.find((x) => x.by === fx.reviewed!.bot);
      expect(human?.kind, "the person").to.equal("human");
      expect(bot?.kind, "the bot").to.equal("bot");
      for (const x of r.value) {
        expect(["approved", "changes-requested", "commented", "dismissed", "pending"]).to.include(x.verdict);
        expect(x.at).to.be.a("string");
      }
    });

    it("requiredChecks(): the names a protected branch requires, and none for an unprotected one", async () => {
      const r = await fx.vcs.requiredChecks(fx.repo, fx.requiredChecks.branch);
      expect(r.ok, JSON.stringify(r)).to.equal(true);
      if (r.ok) expect([...r.value].sort()).to.deep.equal([...fx.requiredChecks.checks].sort());
      const u = await fx.vcs.requiredChecks(fx.repo, fx.requiredChecks.unprotected);
      expect(u).to.deep.equal({ ok: true, value: [] });
    });

    it("identity(): the login, and whether it is a person or a bot", async () => {
      const i = await fx.vcs.identity();
      expect(i).to.deep.equal({ ok: true, value: fx.identity });
    });
  });
}
