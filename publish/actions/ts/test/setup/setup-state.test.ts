// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
// THE SET-UP BREADCRUMB (#391): the trail, resume, the issuer allow-list, and the redeem call against a stubbed fetch.
import { expect } from "chai";
import { createHash } from "node:crypto";
import {
  captureSetupCode, clientVersionField, emptySetupState, firstPending, issuerAllowed, markStep, parseSetupState, reconcile, redeemSetupCode,
  redeemUrl, REDEEM_LINES, resumeLine, serializeSetupState, settled, setupTrailDiagnostic, SETUP_ISSUER_ALLOWED_DOMAINS,
  stepStatus, type FetchLike, type SetupState,
} from "../../src/setup/setup-state.js";

const T0 = "2026-11-19T10:00:00.000Z";
const T1 = "2026-11-19T10:05:00.000Z";
const sha = (t: string): string => createHash("sha256").update(t).digest("hex");
const CODE = "GS-test-code-1234";
const ISSUER = "https://security-dev.svayamtech.com";
const env = { GOV_SETUP_CODE: CODE, GOV_SETUP_ISSUER: ISSUER };

/** Every required step done, a code waiting. */
const ready = (): SetupState => reconcile(captureSetupCode(emptySetupState(), env, T0, sha),
  { "client-installed": true, prerequisites: true, "governance-repo": true, "machine-env": true }, T0);

/** A fetch that records its call and answers as told. */
function stubFetch(answer: { status: number; body?: unknown } | Error) {
  const calls: { url: string; init: Parameters<FetchLike>[1] }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    if (answer instanceof Error) throw answer;
    return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: async () => answer.body };
  };
  return { fetch, calls };
}
const deps = (fetch: FetchLike) => ({ fetch, clientVersion: "2.0.0-test", now: T1, sha256: sha });

describe("gov-work — set-up breadcrumb: the file (#391)", () => {
  it("round-trips, in walking order, and drops anything it does not recognise", () => {
    const s = markStep(markStep(emptySetupState(), "machine-env", "pending", T0), "client-installed", "done", T0);
    const back = parseSetupState(serializeSetupState(s));
    expect(back.steps.map((x) => x.id)).to.deep.equal(["client-installed", "machine-env"]);
    const junk = parseSetupState(JSON.stringify({ steps: [{ id: "nope", status: "done", at: T0 }, { id: "prerequisites", status: "maybe", at: T0 }] }));
    expect(junk.steps).to.deep.equal([]);
    expect(parseSetupState("{not json").steps).to.deep.equal([]);
    expect(parseSetupState(null)).to.deep.equal(emptySetupState());
  });

  it("a step's time moves only when its status does", () => {
    const a = markStep(emptySetupState(), "prerequisites", "done", T0);
    expect(markStep(a, "prerequisites", "done", T1).steps[0]!.at).to.equal(T0);
    expect(markStep(a, "prerequisites", "pending", T1).steps[0]).to.deep.equal({ id: "prerequisites", status: "pending", at: T1 });
  });

  it("reconcile reflects the machine — a step the machine no longer shows goes back to pending — and never touches the signal", () => {
    let s = markStep(ready(), "setup-signal", "done", T0);
    s = reconcile(s, { "governance-repo": false }, T1);
    expect(stepStatus(s, "governance-repo")).to.equal("pending");
    expect(stepStatus(s, "client-installed"), "not probed: kept").to.equal("done");
    expect(stepStatus(s, "setup-signal")).to.equal("done");
  });
});

describe("gov-work — set-up breadcrumb: resume (#391)", () => {
  it("re-running resumes at the FIRST pending step, in walking order", () => {
    let s = reconcile(emptySetupState(), { "client-installed": true, prerequisites: true, "governance-repo": false, "machine-env": false }, T0);
    expect(firstPending(s)).to.equal("governance-repo");
    s = reconcile(s, { "governance-repo": true }, T1);
    expect(firstPending(s)).to.equal("machine-env");
    s = reconcile(s, { "machine-env": true }, T1);
    expect(firstPending(s), "no code, no signal step: nothing left").to.equal(null);
    expect(settled(s)).to.equal(true);
  });

  it("an empty trail is pending at the start; a waiting code keeps the trail unsettled", () => {
    expect(firstPending(emptySetupState())).to.equal("client-installed");
    expect(settled(ready())).to.equal(false);
    expect(firstPending(ready())).to.equal("setup-signal");
  });

  it("the resume line names what is done and where it picks up — and is silent with nothing to resume", () => {
    const s = reconcile(emptySetupState(), { "client-installed": true, prerequisites: true, "governance-repo": false }, T0);
    const line = resumeLine(s)!;
    expect(line).to.match(/^Resuming set-up/);
    expect(line).to.include("gov installed").and.include("Next: governance repository in place");
    expect(resumeLine(emptySetupState())).to.equal(null);
    expect(resumeLine(ready()), "only the signal is left: nothing to resume").to.equal(null);
  });
});

describe("gov-work — set-up breadcrumb: the code (#391)", () => {
  it("is taken from GOV_SETUP_CODE / GOV_SETUP_ISSUER and makes the signal pending", () => {
    const s = captureSetupCode(emptySetupState(), env, T0, sha);
    expect(s.setupCode).to.deep.equal({ code: CODE, issuer: ISSUER, receivedAt: T0 });
    expect(stepStatus(s, "setup-signal")).to.equal("pending");
    expect(captureSetupCode(emptySetupState(), {}, T0, sha)).to.deep.equal(emptySetupState());
  });

  it("a NEW code replaces the old one; the code already redeemed is not taken back", () => {
    const s = captureSetupCode(captureSetupCode(emptySetupState(), env, T0, sha), { ...env, GOV_SETUP_CODE: "GS-newer" }, T1, sha);
    expect(s.setupCode!.code).to.equal("GS-newer");
    const spent: SetupState = { ...emptySetupState(), redeemedCodeSha256: sha(CODE) };
    expect(captureSetupCode(spent, env, T1, sha).setupCode).to.equal(undefined);
  });
});

describe("gov-work — set-up breadcrumb: the issuer allow-list (#391)", () => {
  it("is *.svayamtech.com — the constant", () => {
    expect(SETUP_ISSUER_ALLOWED_DOMAINS).to.deep.equal(["svayamtech.com"]);
  });

  it("accepts https subdomains of an allowed domain, any path", () => {
    for (const ok of ["https://iam.svayamtech.com", "https://iam-dev.svayamtech.com/", "https://IAM.SvayamTech.com/realm/x", "https://a.b.svayamtech.com:8443"]) {
      expect(issuerAllowed(ok), ok).to.equal(true);
    }
  });

  it("refuses http, look-alike hosts, credentials in the URL and non-URLs", () => {
    for (const bad of [
      "http://iam.svayamtech.com", "https://evilsvayamtech.com", "https://svayamtech.com.example.net",
      "https://iam.svayamtech.co", "https://user:pw@iam.svayamtech.com", "https://127.0.0.1", "", "iam.svayamtech.com",
      "javascript:alert(1)", "https://svayamtech.com",
    ]) {
      expect(issuerAllowed(bad), bad).to.equal(false);
    }
  });

  it("the endpoint keeps the issuer's path and drops a trailing slash", () => {
    expect(redeemUrl("https://security-dev.svayamtech.com")).to.equal("https://security-dev.svayamtech.com/ident/gov-setup/redeem");
    expect(redeemUrl("https://iam.svayamtech.com/")).to.equal("https://iam.svayamtech.com/ident/gov-setup/redeem");
    expect(redeemUrl("https://iam.svayamtech.com/base")).to.equal("https://iam.svayamtech.com/base/ident/gov-setup/redeem");
  });
});

describe("gov-work — set-up breadcrumb: redeem (#391)", () => {
  it("SUCCESS: posts {code, steps, client_version} with no bearer, removes the code, marks setup-signal done, one line", async () => {
    const { fetch, calls } = stubFetch({ status: 200, body: { ok: true } });
    const r = await redeemSetupCode(ready(), deps(fetch));
    expect(r.outcome).to.equal("redeemed");
    expect(r.line).to.equal("Your gov web set-up step is complete.");
    expect(calls).to.have.length(1);
    expect(calls[0]!.url).to.equal("https://security-dev.svayamtech.com/ident/gov-setup/redeem");
    expect(calls[0]!.init.method).to.equal("POST");
    expect(Object.keys(calls[0]!.init.headers).map((h) => h.toLowerCase())).to.not.include("authorization");
    const body = JSON.parse(calls[0]!.init.body) as { code: string; steps: { id: string; status: string; at: string }[]; client_version: string };
    expect(body.code).to.equal(CODE);
    expect(body.client_version).to.equal("2.0.0-test");
    expect(body.steps.map((x) => x.id)).to.deep.equal(["client-installed", "prerequisites", "governance-repo", "machine-env"]);
    expect(r.state.setupCode).to.equal(undefined);
    expect(serializeSetupState(r.state)).to.not.include(CODE);
    expect(r.state.redeemedCodeSha256).to.equal(sha(CODE));
    expect(stepStatus(r.state, "setup-signal")).to.equal("done");
    expect(settled(r.state)).to.equal(true);
  });

  it("REFUSAL: keeps the code, says what to do in one line, never throws", async () => {
    const { fetch } = stubFetch({ status: 400, body: { error: { kind: "invalid_code" } } });
    const r = await redeemSetupCode(ready(), deps(fetch));
    expect(r.outcome).to.equal("refused");
    expect(r.state.setupCode?.code).to.equal(CODE);
    expect(stepStatus(r.state, "setup-signal")).to.equal("pending");
    expect(r.line).to.equal(REDEEM_LINES.refused).and.include("Install page").and.include("re-run `gov`");
    expect(r.line).to.not.include(CODE);
  });

  it("a 200 without {ok:true} is a refusal, not a success", async () => {
    const { fetch } = stubFetch({ status: 200, body: { ok: false } });
    expect((await redeemSetupCode(ready(), deps(fetch))).outcome).to.equal("refused");
  });

  it("RATE LIMITED (429 too_many_attempts): keeps the code and says to wait and re-run `gov` — not to get a new code", async () => {
    const { fetch } = stubFetch({ status: 429, body: { error: { kind: "too_many_attempts" } } });
    const r = await redeemSetupCode(ready(), deps(fetch));
    expect(r.outcome).to.equal("rate-limited");
    expect(r.state.setupCode?.code).to.equal(CODE);
    expect(r.line).to.equal(REDEEM_LINES.tooMany).and.include("wait").and.include("re-run `gov`").and.not.include("Install page");
  });

  it("client_version is sent only as printable ASCII of at most 64 characters", async () => {
    expect(clientVersionField("2.0.0-next.4")).to.equal("2.0.0-next.4");
    expect(clientVersionField("x".repeat(65))).to.equal(undefined);
    expect(clientVersionField("2.0\u00e9")).to.equal(undefined);
    const { fetch, calls } = stubFetch({ status: 200, body: { ok: true, account_name: "Acme" } });
    const r = await redeemSetupCode(ready(), { ...deps(fetch), clientVersion: "v".repeat(70) });
    expect(r.outcome, "account_name alongside ok:true is still success").to.equal("redeemed");
    expect(JSON.parse(calls[0]!.init.body)).to.not.have.property("client_version");
    expect(Buffer.byteLength(JSON.stringify((JSON.parse(calls[0]!.init.body) as { steps: unknown }).steps))).to.be.below(8 * 1024);
  });

  it("NETWORK ERROR or a 5xx: keeps the code and says to re-run later", async () => {
    for (const answer of [new Error("ECONNREFUSED"), { status: 503 }]) {
      const { fetch } = stubFetch(answer);
      const r = await redeemSetupCode(ready(), deps(fetch));
      expect(r.outcome).to.equal("unreachable");
      expect(r.state.setupCode?.code).to.equal(CODE);
      expect(r.line).to.equal(REDEEM_LINES.unreachable);
    }
  });

  it("NOT SENT until client-installed, governance-repo and machine-env are all done", async () => {
    const { fetch, calls } = stubFetch({ status: 200, body: { ok: true } });
    const s = reconcile(ready(), { "machine-env": false }, T1);
    const r = await redeemSetupCode(s, deps(fetch));
    expect(r.outcome).to.equal("not-ready");
    expect(r.line).to.equal(null);
    expect(calls).to.have.length(0);
  });

  it("NOT SENT to an issuer off the allow-list — the unsendable code is dropped, with one line", async () => {
    const { fetch, calls } = stubFetch({ status: 200, body: { ok: true } });
    const s = reconcile(captureSetupCode(emptySetupState(), { GOV_SETUP_CODE: CODE, GOV_SETUP_ISSUER: "https://collector.example.com" }, T0, sha),
      { "client-installed": true, prerequisites: true, "governance-repo": true, "machine-env": true }, T0);
    const r = await redeemSetupCode(s, deps(fetch));
    expect(r.outcome).to.equal("not-allowed");
    expect(calls).to.have.length(0);
    expect(r.state.setupCode).to.equal(undefined);
    expect(r.line).to.equal(REDEEM_LINES.notAllowed);
  });

  it("re-sending is harmless: with no code there is nothing to send", async () => {
    const { fetch, calls } = stubFetch({ status: 200, body: { ok: true } });
    const first = await redeemSetupCode(ready(), deps(fetch));
    const again = await redeemSetupCode(first.state, deps(fetch));
    expect(again.outcome).to.equal("no-code");
    expect(calls).to.have.length(1);
  });
});

describe("gov-work — set-up breadcrumb: doctor's row (#391)", () => {
  it("shows done/pending per step and that a signal is pending — never the code", () => {
    const d = setupTrailDiagnostic(ready())!;
    expect(d.name).to.equal("set-up");
    expect(d.status).to.equal("warn");
    expect(d.detail).to.include("client-installed done").and.include("machine-env done").and.include("setup-signal pending");
    expect(d.detail).to.include("a set-up signal for gov web is pending");
    expect(d.detail).to.not.include(CODE);
  });

  it("is ok once everything is done and gov web has been told; absent with no trail", () => {
    const done = markStep({ ...ready(), setupCode: undefined }, "setup-signal", "done", T1);
    const { setupCode: _gone, ...clean } = done;
    const d = setupTrailDiagnostic(clean)!;
    expect(d.status).to.equal("ok");
    expect(d.detail).to.include("gov web has been told");
    expect(setupTrailDiagnostic(emptySetupState())).to.equal(null);
  });

  it("a pending step reads as pending while the signal waits for it", () => {
    const d = setupTrailDiagnostic(reconcile(ready(), { "governance-repo": false }, T1))!;
    expect(d.detail).to.include("governance-repo pending").and.include("sent once the steps above are done");
  });
});
