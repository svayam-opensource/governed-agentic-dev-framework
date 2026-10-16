// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Q2 — what "approved" means to gov: a HUMAN account's approving review on the artifact's change request, read
 * through VcsPort, and the change request merged. Text an agent could write is never approval.
 */
import { expect } from "chai";
import { createMemoryVcs } from "../../src/adapters/memory/vcs.js";
import { approvalOf, approvedStatusLine, changeRequestFromUrl, markApproved, verifyStatus } from "../../src/intent/approval.js";

const REPO = { owner: "acme", name: "gov" };
const URL1 = "memory://acme/gov/change/1";

function arrange() {
  const vcs = createMemoryVcs({ repos: [{ repo: REPO, defaultBranch: "main", branches: { main: "1", "spec-03": "2" } }] });
  const ref = vcs.seedChangeRequest({ repo: REPO, head: "spec-03", base: "main", title: "spec 03", body: "" });
  return { vcs, ref };
}

const SPEC = (status: string): string =>
  `---\ndomain: development\n---\n\n# Spec 03: ports\n\n${status}\n<!-- One of: DRAFT · APPROVED … -->\n\n## Scope recap\ntext\r\nmore\n`;

describe("intent approval (Q2)", () => {
  it("a bot's approving review does not approve, even merged", async () => {
    const { vcs, ref } = arrange();
    vcs.addReview(ref, { by: "copilot-pull-request-reviewer[bot]", verdict: "approved" });
    vcs.addReview(ref, { by: "gov-agent", type: "Bot", verdict: "approved" });
    vcs.merge(ref);
    const r = await approvalOf(vcs, ref);
    expect(r.ok && r.value.approved).to.equal(false);
    expect(r.ok && !r.value.approved && r.value.reason).to.match(/no approving review from a person/);
  });

  it("a human approval without a merge does not approve", async () => {
    const { vcs, ref } = arrange();
    vcs.addReview(ref, { by: "ada", verdict: "approved" });
    const r = await approvalOf(vcs, ref);
    expect(r.ok && !r.value.approved && r.value.reason).to.match(/not merged/);
  });

  it("human review + merge → approved, by that person", async () => {
    const { vcs, ref } = arrange();
    vcs.addReview(ref, { by: "ada", verdict: "approved", at: "2026-10-11T09:00:00Z" });
    vcs.merge(ref);
    const r = await approvalOf(vcs, ref);
    expect(r.ok && r.value.approved && r.value.by).to.equal("ada");
    expect(r.ok && r.value.approved && r.value.url).to.equal(URL1);
  });

  describe("each reviewer's latest verdict counts", () => {
    it("approved then changes requested → not approved", async () => {
      const { vcs, ref } = arrange();
      vcs.addReview(ref, { by: "ada", verdict: "approved", at: "2026-10-11T09:00:00Z" });
      vcs.addReview(ref, { by: "ada", verdict: "changes-requested", at: "2026-10-11T10:00:00Z" });
      vcs.merge(ref);
      const r = await approvalOf(vcs, ref);
      expect(r.ok && r.value.approved).to.equal(false);
    });

    it("approved then dismissed → not approved", async () => {
      const { vcs, ref } = arrange();
      vcs.addReview(ref, { by: "ada", verdict: "approved", at: "2026-10-11T09:00:00Z" });
      vcs.addReview(ref, { by: "ada", verdict: "dismissed", at: "2026-10-11T10:00:00Z" });
      vcs.merge(ref);
      const r = await approvalOf(vcs, ref);
      expect(r.ok && r.value.approved).to.equal(false);
    });

    it("changes requested then approved → approved; a later pending review or comment changes nothing", async () => {
      const { vcs, ref } = arrange();
      vcs.addReview(ref, { by: "ada", verdict: "changes-requested", at: "2026-10-11T08:00:00Z" });
      vcs.addReview(ref, { by: "ada", verdict: "approved", at: "2026-10-11T09:00:00Z" });
      vcs.addReview(ref, { by: "ada", verdict: "commented", at: "2026-10-11T10:00:00Z" });
      vcs.addReview(ref, { by: "ada", verdict: "pending", at: "" });
      vcs.merge(ref);
      const r = await approvalOf(vcs, ref);
      expect(r.ok && r.value.approved && r.value.by).to.equal("ada");
    });

    it("reviews arriving out of order are ordered by time", async () => {
      const { vcs, ref } = arrange();
      vcs.addReview(ref, { by: "ada", verdict: "approved", at: "2026-10-11T11:00:00Z" });
      vcs.addReview(ref, { by: "ada", verdict: "changes-requested", at: "2026-10-11T09:00:00Z" });
      vcs.merge(ref);
      const r = await approvalOf(vcs, ref);
      expect(r.ok && r.value.approved).to.equal(true);
    });
  });

  it("Q8: when the policy names who approves, only those people count", async () => {
    const { vcs, ref } = arrange();
    vcs.addReview(ref, { by: "bob", verdict: "approved" });
    vcs.merge(ref);
    const r = await approvalOf(vcs, ref, { approvers: ["ada"] });
    expect(r.ok && !r.value.approved && r.value.reason).to.match(/ada/);
  });

  it("a host that cannot answer is a failed Result, not 'not approved'", async () => {
    const { vcs } = arrange();
    const r = await approvalOf(vcs, { repo: REPO, number: 99 });
    expect(r.ok).to.equal(false);
  });

  describe("a Status line claiming APPROVED is verified, never trusted", () => {
    it("Status text written by an agent with no change request link → not approved", async () => {
      const { vcs } = arrange();
      const r = await verifyStatus(vcs, SPEC("**Status: APPROVED by ada 2026-10-12**"));
      expect(r.ok && r.value.approved).to.equal(false);
      expect(r.ok && !r.value.approved && r.value.reason).to.match(/names no change request/);
    });

    it("Status text pointing at an unmerged change request → not approved", async () => {
      const { vcs, ref } = arrange();
      vcs.addReview(ref, { by: "ada", verdict: "approved" });
      const r = await verifyStatus(vcs, SPEC(`**Status: APPROVED by ada 2026-10-12 (${URL1})**`));
      expect(r.ok && !r.value.approved && r.value.reason).to.match(/not merged/);
    });

    it("Status text pointing at a change request only a bot approved → not approved", async () => {
      const { vcs, ref } = arrange();
      vcs.addReview(ref, { by: "gov-agent[bot]", verdict: "approved" });
      vcs.merge(ref);
      const r = await verifyStatus(vcs, SPEC(`**Status: APPROVED by gov-agent[bot] 2026-10-12 (${URL1})**`));
      expect(r.ok && r.value.approved).to.equal(false);
    });

    it("Status naming a person who did not approve the change request → not approved", async () => {
      const { vcs, ref } = arrange();
      vcs.addReview(ref, { by: "ada", verdict: "approved" });
      vcs.merge(ref);
      const r = await verifyStatus(vcs, SPEC(`**Status: APPROVED by mallory 2026-10-12 (${URL1})**`));
      expect(r.ok && !r.value.approved && r.value.reason).to.match(/mallory/);
    });

    it("Status backed by a human approval and a merge → approved", async () => {
      const { vcs, ref } = arrange();
      vcs.addReview(ref, { by: "ada", verdict: "approved" });
      vcs.merge(ref);
      const r = await verifyStatus(vcs, SPEC(`**Status: APPROVED by ada 2026-10-12 (${URL1})**`));
      expect(r.ok && r.value.approved).to.equal(true);
    });

    it("DRAFT and no Status line are not approved", async () => {
      const { vcs } = arrange();
      const d = await verifyStatus(vcs, SPEC("**Status:** DRAFT"));
      expect(d.ok && !d.value.approved && d.value.reason).to.match(/DRAFT/);
      const n = await verifyStatus(vcs, "# no status\n");
      expect(n.ok && !n.value.approved && n.value.reason).to.match(/no Status line/);
    });
  });

  it("reads change request links: GitHub, GitLab, memory; anything else is null", () => {
    expect(changeRequestFromUrl("https://github.com/acme/gov/pull/12")).to.deep.equal({ repo: REPO, number: 12 });
    expect(changeRequestFromUrl("https://gitlab.com/acme/gov/-/merge_requests/7")).to.deep.equal({ repo: REPO, number: 7 });
    expect(changeRequestFromUrl(URL1)).to.deep.equal({ repo: REPO, number: 1 });
    expect(changeRequestFromUrl("https://example.com/whatever")).to.equal(null);
  });

  describe("on merge, gov writes the Status line", () => {
    it("the line is exactly the Q2 form", () => {
      expect(approvedStatusLine({ by: "ada", on: "2026-10-12T17:03:00Z", url: URL1 })).to.equal(`**Status: APPROVED by ada 2026-10-12 (${URL1})**`);
    });

    it("replaces the Status line in place; every other byte is unchanged", async () => {
      const { vcs, ref } = arrange();
      vcs.addReview(ref, { by: "ada", verdict: "approved" });
      vcs.merge(ref);
      const a = await approvalOf(vcs, ref);
      if (!a.ok || !a.value.approved) throw new Error("expected approval");
      const before = SPEC("**Status:** DRAFT");
      const after = markApproved(before, a.value, "2026-10-12");
      expect(after.ok && after.value).to.equal(SPEC(`**Status: APPROVED by ada 2026-10-12 (${URL1})**`));
    });

    it("an artifact with no Status line is refused, not guessed", () => {
      const r = markApproved("# x\n", { approved: true, by: "ada", url: URL1, at: "" }, "2026-10-12");
      expect(r.ok).to.equal(false);
    });

    it("a bad date is refused", () => {
      expect(() => approvedStatusLine({ by: "ada", on: "yesterday", url: URL1 })).to.throw(/date/);
    });
  });
});
