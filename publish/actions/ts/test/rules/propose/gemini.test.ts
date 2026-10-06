// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// The `gemini` provider (Policy Owner, 2026-10-07): generateContent over fetch, the key in a header only, every
// cut-off, refusal and block an error rather than a reply. No network: fetch is a fake.
import { expect } from "chai";
import { geminiModel, GEMINI_URL, GEMINI_KEY_ENV, ModelReplyRejected } from "../../../src/rules/propose/providers/gemini.js";
import { ModelProviderError, type FetchLike } from "../../../src/rules/propose/providers/anthropic.js";
import { chooseModel } from "../../../src/rules/propose/providers/index.js";
import type { ModelRequest } from "../../../src/rules/propose/model-port.js";

const REQ: ModelRequest = { system: "SYS", user: "USER" };
const KEY = "AIza-test-secret-gemini-key";
type Call = { url: string; init: { method: string; headers: Record<string, string>; body: string } };

function fakeFetch(replies: ({ status: number; body: unknown; retryAfter?: string } | Error)[]): FetchLike & { calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (url: string, init: Call["init"]) => {
    calls.push({ url, init });
    const r = replies.shift();
    if (!r) throw new Error("no more replies");
    if (r instanceof Error) throw r;
    return { status: r.status, headers: { get: (n: string) => (n === "retry-after" ? r.retryAfter ?? null : null) }, text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)) };
  }) as FetchLike & { calls: Call[] };
  f.calls = calls;
  return f;
}
const ok = (parts: unknown[], finishReason = "STOP") => ({ status: 200, body: { candidates: [{ content: { role: "model", parts }, finishReason }] } });
const noSleep = async (): Promise<void> => {};

async function rejected(p: Promise<unknown>): Promise<Error> {
  try { await p; } catch (e) { return e as Error; }
  return expect.fail("should throw");
}

describe("rules propose — the gemini adapter (generateContent over fetch)", () => {
  it("posts the system text, the section and JSON mode to the model's generateContent; returns the text", async () => {
    const f = fakeFetch([ok([{ text: "{\"verdicts\":[]}" }])]);
    const out = await geminiModel({ apiKey: KEY, model: "gemini-org", fetch: f, maxTokens: 1234 }).complete(REQ);
    expect(out).to.equal("{\"verdicts\":[]}");
    expect(f.calls).to.have.length(1);
    expect(f.calls[0]!.url).to.equal(`${GEMINI_URL}/gemini-org:generateContent`);
    expect(f.calls[0]!.init.method).to.equal("POST");
    const body = JSON.parse(f.calls[0]!.init.body);
    expect(body).to.deep.equal({
      systemInstruction: { parts: [{ text: "SYS" }] },
      contents: [{ role: "user", parts: [{ text: "USER" }] }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 1234 },
    });
  });

  it("the key travels only in the x-goog-api-key header — never in the URL or the body", async () => {
    const f = fakeFetch([ok([{ text: "{}" }])]);
    await geminiModel({ apiKey: KEY, model: "m", fetch: f }).complete(REQ);
    expect(f.calls[0]!.init.headers["x-goog-api-key"]).to.equal(KEY);
    expect(f.calls[0]!.url).to.not.contain(KEY).and.not.contain("key=");
    expect(f.calls[0]!.init.body).to.not.contain(KEY);
    const others = Object.entries(f.calls[0]!.init.headers).filter(([k]) => k !== "x-goog-api-key");
    for (const [, v] of others) expect(v).to.not.contain(KEY);
  });

  it("JSON-mode text split across several parts is joined; thought parts are left out", async () => {
    const f = fakeFetch([ok([{ text: "{\"verd" }, { text: "thinking…", thought: true }, { text: "icts\":" }, { text: "[]}" }])]);
    expect(await geminiModel({ apiKey: KEY, model: "m", fetch: f }).complete(REQ)).to.equal("{\"verdicts\":[]}");
  });

  it("a reply cut off at MAX_TOKENS is an error, not half a proposal", async () => {
    const e = await rejected(geminiModel({ apiKey: KEY, model: "m", fetch: fakeFetch([ok([{ text: "{\"verd" }], "MAX_TOKENS")]) }).complete(REQ));
    expect(e).to.be.instanceOf(ModelReplyRejected).and.instanceOf(ModelProviderError);
    expect((e as ModelReplyRejected).kind).to.equal("cut-off");
    expect(e.message).to.contain("cut off");
  });

  for (const reason of ["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT"]) {
    it(`finishReason ${reason} is a refusal (typed), naming the reason`, async () => {
      const e = await rejected(geminiModel({ apiKey: KEY, model: "m", fetch: fakeFetch([ok([{ text: "{}" }], reason)]) }).complete(REQ));
      expect(e).to.be.instanceOf(ModelReplyRejected);
      expect((e as ModelReplyRejected).kind).to.equal("refused");
      expect((e as ModelReplyRejected).reason).to.equal(reason);
      expect(e.message).to.contain(reason);
    });
  }

  it("a blocked prompt (promptFeedback.blockReason) is an error, even with a candidate", async () => {
    const body = { promptFeedback: { blockReason: "SAFETY" }, candidates: [{ content: { parts: [{ text: "{}" }] }, finishReason: "STOP" }] };
    const e = await rejected(geminiModel({ apiKey: KEY, model: "m", fetch: fakeFetch([{ status: 200, body }]) }).complete(REQ));
    expect(e).to.be.instanceOf(ModelReplyRejected);
    expect((e as ModelReplyRejected).kind).to.equal("blocked");
    expect(e.message).to.contain("SAFETY");
  });

  it("no candidates, or a candidate with no text, is an error", async () => {
    const none = await rejected(geminiModel({ apiKey: KEY, model: "m", fetch: fakeFetch([{ status: 200, body: { candidates: [] } }]) }).complete(REQ));
    expect((none as ModelReplyRejected).kind).to.equal("no-candidates");
    const missing = await rejected(geminiModel({ apiKey: KEY, model: "m", fetch: fakeFetch([{ status: 200, body: {} }]) }).complete(REQ));
    expect((missing as ModelReplyRejected).kind).to.equal("no-candidates");
    const empty = await rejected(geminiModel({ apiKey: KEY, model: "m", fetch: fakeFetch([ok([{ text: "  " }])]) }).complete(REQ));
    expect(empty).to.be.instanceOf(ModelProviderError);
  });

  it("any other finishReason (OTHER, SPII…) is not a clean reply either", async () => {
    for (const reason of ["OTHER", "SPII", "MALFORMED_FUNCTION_CALL"]) {
      const e = await rejected(geminiModel({ apiKey: KEY, model: "m", fetch: fakeFetch([ok([{ text: "{}" }], reason)]) }).complete(REQ));
      expect(e, reason).to.be.instanceOf(ModelReplyRejected);
    }
  });

  it("retries a 429 (after retry-after), then succeeds", async () => {
    const waits: number[] = [];
    const f = fakeFetch([{ status: 429, body: { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "quota" } }, retryAfter: "3" }, ok([{ text: "x" }])]);
    expect(await geminiModel({ apiKey: KEY, model: "m", fetch: f, sleep: async (ms) => { waits.push(ms); } }).complete(REQ)).to.equal("x");
    expect(waits).to.deep.equal([3000]);
    expect(f.calls).to.have.length(2);
  });

  it("a 500 every time: retried, then an error naming the status and the API's message", async () => {
    const err = { status: 500, body: { error: { code: 500, status: "INTERNAL", message: "backend down" } } };
    const f = fakeFetch([err, err, err]);
    const e = await rejected(geminiModel({ apiKey: KEY, model: "m", fetch: f, sleep: noSleep, retries: 2 }).complete(REQ));
    expect(e).to.be.instanceOf(ModelProviderError);
    expect(e.message).to.contain("500").and.contain("INTERNAL").and.contain("backend down").and.contain("Gemini").and.not.contain(KEY);
    expect(f.calls).to.have.length(3);
  });

  it("a 400 is not retried", async () => {
    const f = fakeFetch([{ status: 400, body: { error: { code: 400, status: "INVALID_ARGUMENT", message: "bad model" } } }]);
    const e = await rejected(geminiModel({ apiKey: KEY, model: "m", fetch: f, sleep: noSleep }).complete(REQ));
    expect(e.message).to.contain("400").and.contain("bad model");
    expect(f.calls).to.have.length(1);
  });

  it("the logger never receives the key — not on a network failure, a refusal by status, or a reply", async () => {
    const lines: string[] = [];
    const log = (...args: unknown[]): void => { lines.push(JSON.stringify(args)); };
    const f = fakeFetch([
      new Error(`connect failed for key ${KEY}`),
      { status: 503, body: { error: { message: `echo ${KEY}` } } },
      ok([{ text: "{}" }]),
    ]);
    expect(await geminiModel({ apiKey: KEY, model: "m", fetch: f, sleep: noSleep, log }).complete(REQ)).to.equal("{}");
    expect(lines.length).to.be.greaterThan(1);
    for (const l of lines) expect(l).to.not.contain(KEY);
    // And a final failure's message is scrubbed too.
    const g = fakeFetch([{ status: 400, body: { error: { message: `bad key ${KEY}` } } }]);
    const e = await rejected(geminiModel({ apiKey: KEY, model: "m", fetch: g, log }).complete(REQ));
    expect(e.message).to.not.contain(KEY);
    for (const l of lines) expect(l).to.not.contain(KEY);
  });
});

describe("rules propose — choosing gemini", () => {
  const deps = { ci: false, anthropicKey: () => null, geminiKey: () => KEY, runCommand: () => "" };
  it("gemini with a model and a key → a Gemini model", () => {
    const c = chooseModel({ provider: "gemini", model: "gemini-org", command: "", ciAllowed: false }, deps);
    expect(c.ok).to.equal(true);
    expect(c.ok ? c.describe : "").to.contain("gemini-org").and.contain("Gemini");
  });
  it("gemini with no key → refuses, naming GEMINI_API_KEY in plain words", () => {
    const c = chooseModel({ provider: "gemini", model: "m", command: "", ciAllowed: false }, { ...deps, geminiKey: () => null });
    expect(c.ok).to.equal(false);
    const text = c.ok ? "" : c.lines.join(" ");
    expect(text).to.contain(GEMINI_KEY_ENV).and.contain("Gemini");
    expect(GEMINI_KEY_ENV).to.equal("GEMINI_API_KEY");
  });
  it("gemini with no model → refuses, naming the provider", () => {
    const c = chooseModel({ provider: "gemini", model: "", command: "", ciAllowed: false }, deps);
    expect(c.ok ? "" : c.lines.join(" ")).to.contain("`gemini`").and.contain("models.propose.model");
  });
  it("the anthropic key is never asked for when gemini is chosen", () => {
    let asked = 0;
    chooseModel({ provider: "gemini", model: "m", command: "", ciAllowed: false }, { ...deps, anthropicKey: () => { asked++; return "x"; } });
    expect(asked).to.equal(0);
  });
});
