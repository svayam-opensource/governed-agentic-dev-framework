// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The GitHub VcsPort adapter over a FAKE `gh` (PRJ-121 intent 03, L03): what it asks GitHub, how it reads the
 * answers, and that every failure comes back as a Result with a reason — never a throw, never a quiet empty value.
 * The same adapter runs the conformance suite live (test/ports/vcs.conformance.ts) in svayam-e2e.
 */
import { expect } from "chai";
import { createGithubVcs, isBotAccount } from "../../src/adapters/github/vcs.js";
import type { GhReply } from "../../src/adapters/github/gh.js";

const REPO = { owner: "acme", name: "app" };
const ok = (body: unknown): GhReply => ({ status: 0, stdout: typeof body === "string" ? body : JSON.stringify(body), stderr: "" });
const err = (stderr: string, status = 1): GhReply => ({ status, stdout: "", stderr });

/** A fake gh: the first route whose key the joined args start with answers; anything else is a test failure. */
function fakeGh(routes: Record<string, GhReply>) {
  const calls: string[][] = [];
  const gh = (args: readonly string[]): GhReply => {
    calls.push([...args]);
    const line = args.join(" ");
    const key = Object.keys(routes).find((k) => line.startsWith(k));
    if (!key) throw new Error(`fake gh: no route for: ${line}`);
    return routes[key]!;
  };
  return { gh, calls };
}

describe("VcsPort — GitHub adapter (fake gh)", () => {
  it("repo(): reads default branch, url and visibility", async () => {
    const f = fakeGh({ "api repos/acme/app": ok({ default_branch: "main", html_url: "https://github.com/acme/app", visibility: "private" }) });
    expect(await createGithubVcs({ gh: f.gh }).repo(REPO)).to.deep.equal({ ok: true, value: { defaultBranch: "main", url: "https://github.com/acme/app", visibility: "private" } });
  });

  it("repo(): not found is a failure with a reason; a dropped connection is retryable", async () => {
    const nf = await createGithubVcs({ gh: fakeGh({ "api repos/": err("gh: Not Found (HTTP 404)") }).gh }).repo(REPO);
    expect(nf.ok).to.equal(false);
    if (!nf.ok) { expect(nf.reason).to.match(/not found/i); expect(nf.retryable).to.equal(false); }
    const eof = await createGithubVcs({ gh: fakeGh({ "api repos/": err("Post \"https://api.github.com/graphql\": EOF") }).gh }).repo(REPO);
    expect(eof.ok === false && eof.retryable).to.equal(true);
  });

  it("repo(): a reply that is not JSON is a failure, not a crash", async () => {
    const r = await createGithubVcs({ gh: fakeGh({ "api repos/": ok("<html>") }).gh }).repo(REPO);
    expect(r.ok).to.equal(false);
  });

  it("branch(): a sha; 404 → ok(null)", async () => {
    const f = fakeGh({
      "api repos/acme/app/branches/dev": ok({ name: "dev", commit: { sha: "abc1234def" }, protected: true }),
      "api repos/acme/app/branches/gone": err("gh: Branch not found (HTTP 404)"),
    });
    const v = createGithubVcs({ gh: f.gh });
    expect(await v.branch(REPO, "dev")).to.deep.equal({ ok: true, value: { name: "dev", sha: "abc1234def", protected: true } });
    expect(await v.branch(REPO, "gone")).to.deep.equal({ ok: true, value: null });
  });

  it("openChangeRequest(): POSTs head, base, title, body and draft; returns the number", async () => {
    const f = fakeGh({ "api -X POST repos/acme/app/pulls": ok({ number: 42, html_url: "https://github.com/acme/app/pull/42" }) });
    const r = await createGithubVcs({ gh: f.gh }).openChangeRequest({ repo: REPO, head: "feat", base: "dev", title: "T", body: "B", draft: true });
    expect(r).to.deep.equal({ ok: true, value: { repo: REPO, number: 42 } });
    const a = f.calls[0]!;
    for (const want of ["head=feat", "base=dev", "title=T", "body=B", "draft=true"]) expect(a, want).to.include(want);
  });

  it("openChangeRequest(): GitHub's refusal comes back as the reason", async () => {
    const f = fakeGh({ "api -X POST": err("gh: Validation Failed (HTTP 422)\nA pull request already exists for acme:feat.") });
    const r = await createGithubVcs({ gh: f.gh }).openChangeRequest({ repo: REPO, head: "feat", base: "dev", title: "T", body: "" });
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.contain("already exists");
  });

  it("changeRequest(): state, merged, head, base, draft; merged wins over closed", async () => {
    const f = fakeGh({ "api repos/acme/app/pulls/7": ok({ number: 7, state: "closed", merged: true, draft: false, title: "x", html_url: "u", head: { ref: "feat" }, base: { ref: "dev" } }) });
    const r = await createGithubVcs({ gh: f.gh }).changeRequest({ repo: REPO, number: 7 });
    expect(r).to.deep.equal({ ok: true, value: { ref: { repo: REPO, number: 7 }, state: "merged", merged: true, draft: false, title: "x", url: "u", head: "feat", base: "dev" } });
  });

  it("reviews(): reads every page, and marks a person and a bot", async () => {
    const lines = [
      { user: { login: "bob", type: "User" }, state: "APPROVED", submitted_at: "2026-10-01T00:00:00Z" },
      { user: { login: "copilot-pull-request-reviewer[bot]", type: "Bot" }, state: "COMMENTED", submitted_at: "2026-10-01T00:01:00Z" },
      { user: { login: "gov-checks", type: "Bot" }, state: "CHANGES_REQUESTED", submitted_at: "2026-10-01T00:02:00Z" },
      { user: { login: "carol", type: "User" }, state: "DISMISSED", submitted_at: "2026-10-01T00:03:00Z" },
      { user: null, state: "PENDING", submitted_at: null },
    ].map((x) => JSON.stringify(x)).join("\n");
    const f = fakeGh({ "api --paginate repos/acme/app/pulls/7/reviews": ok(`${lines}\n`) });
    const r = await createGithubVcs({ gh: f.gh }).reviews({ repo: REPO, number: 7 });
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.value.map((x) => [x.by, x.kind, x.verdict])).to.deep.equal([
      ["bob", "human", "approved"],
      ["copilot-pull-request-reviewer[bot]", "bot", "commented"],
      ["gov-checks", "bot", "changes-requested"],
      ["carol", "human", "dismissed"],
      ["ghost", "human", "pending"],
    ]);
    expect(r.value[0]!.at).to.equal("2026-10-01T00:00:00Z");
  });

  it("requiredChecks(): branch protection and rulesets together, once each", async () => {
    const f = fakeGh({
      "api repos/acme/app/branches/main": ok({ name: "main", commit: { sha: "a" }, protected: true, protection: { required_status_checks: { contexts: ["build"], checks: [{ context: "build" }, { context: "test" }] } } }),
      "api repos/acme/app/rules/branches/main": ok([{ type: "pull_request" }, { type: "required_status_checks", parameters: { required_status_checks: [{ context: "gov/rules" }, { context: "test" }] } }]),
    });
    const r = await createGithubVcs({ gh: f.gh }).requiredChecks(REPO, "main");
    expect(r.ok && [...r.value].sort()).to.deep.equal(["build", "gov/rules", "test"]);
  });

  it("requiredChecks(): an unprotected branch, and a plan without rulesets, are [] — not failures", async () => {
    const f = fakeGh({
      "api repos/acme/app/branches/dev": ok({ name: "dev", commit: { sha: "a" }, protected: false }),
      "api repos/acme/app/rules/branches/dev": err("gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)"),
    });
    expect(await createGithubVcs({ gh: f.gh }).requiredChecks(REPO, "dev")).to.deep.equal({ ok: true, value: [] });
  });

  it("requiredChecks(): a missing branch, or an unreadable ruleset, is a failure", async () => {
    const missing = fakeGh({ "api repos/acme/app/branches/x": err("gh: Branch not found (HTTP 404)"), "api repos/acme/app/rules": ok([]) });
    expect((await createGithubVcs({ gh: missing.gh }).requiredChecks(REPO, "x")).ok).to.equal(false);
    const refused = fakeGh({ "api repos/acme/app/branches/m": ok({ name: "m", commit: { sha: "a" }, protected: false }), "api repos/acme/app/rules": err("gh: Bad credentials (HTTP 401)") });
    expect((await createGithubVcs({ gh: refused.gh }).requiredChecks(REPO, "m")).ok).to.equal(false);
  });

  it("identity(): login and kind", async () => {
    expect(await createGithubVcs({ gh: fakeGh({ "api user": ok({ login: "rkant", type: "User" }) }).gh }).identity()).to.deep.equal({ ok: true, value: { login: "rkant", kind: "human" } });
    expect(await createGithubVcs({ gh: fakeGh({ "api user": ok({ login: "gov-bot[bot]", type: "Bot" }) }).gh }).identity()).to.deep.equal({ ok: true, value: { login: "gov-bot[bot]", kind: "bot" } });
  });

  it("a gh that throws (not installed) is a failure, never an exception", async () => {
    const r = await createGithubVcs({ gh: () => { throw new Error("spawn gh ENOENT"); } }).identity();
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.contain("ENOENT");
  });
});

describe("isBotAccount", () => {
  it("a login ending in [bot], or an account of type Bot", () => {
    expect(isBotAccount("dependabot[bot]")).to.equal(true);
    expect(isBotAccount("gov-checks", "Bot")).to.equal(true);
    expect(isBotAccount("rkant", "User")).to.equal(false);
    expect(isBotAccount("robot")).to.equal(false);
  });
});
