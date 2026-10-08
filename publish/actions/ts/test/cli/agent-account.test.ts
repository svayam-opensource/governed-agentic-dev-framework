// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * F24 (PRJ-121, 2026-10-08). IBM Bob exited with
 *
 *     Error: Your Free trial has expired. You have reached the end of your free trial period. Upgrade your plan to continue.
 *
 * and gov told the person it was a first-run step — "accepting a licence, or signing in" — and offered to open Bob
 * again. Nothing on this machine can fix an expired trial. gov must say so plainly, name whose matter it is, and let
 * the person carry on with another approved agent.
 */
import { expect } from "chai";
import { recogniseAccountFailure, accountFailureLine } from "../../src/cli/agent-account.js";

const BOB_TRIAL = "Error: Your Free trial has expired. You have reached the end of your free trial period. Upgrade your plan to continue.\n";

describe("account and billing failures in an agent's early output (F24)", () => {
  it("recognises IBM Bob's expired trial, and says it plainly", () => {
    const f = recogniseAccountFailure("ibm-bob", BOB_TRIAL);
    expect(f).to.not.equal(null);
    expect(accountFailureLine("ibm-bob", f!)).to.equal(
      "IBM Bob cannot run: its account's free trial has expired — that is between you and IBM, gov cannot fix it.");
  });

  it("a generic set covers agents with no patterns of their own", () => {
    expect(recogniseAccountFailure("aider", "Error: You exceeded your current quota, please check your plan and billing details.")?.reason)
      .to.contain("quota");
    expect(recogniseAccountFailure("gemini-code-assist", "Error: API key expired. Please renew the API key.")?.reason)
      .to.contain("API key");
    expect(recogniseAccountFailure("claude-code", "Credit balance is too low")?.reason).to.contain("credit");
  });

  it("names the vendor whose matter it is", () => {
    expect(accountFailureLine("openai-codex", { reason: "its account has run out of quota" })).to.contain("between you and OpenAI");
    expect(accountFailureLine("claude-code", { reason: "x" })).to.contain("between you and Anthropic");
  });

  it("leaves genuine first-run steps — a licence, a sign-in, a missing key — to the first-run path", () => {
    expect(recogniseAccountFailure("ibm-bob", "Error: A license agreement is required. Please accept the license terms before proceeding.")).to.equal(null);
    expect(recogniseAccountFailure("ibm-bob", "Error: Bob API key is required. Set BOB_API_KEY environment variable.")).to.equal(null);
    expect(recogniseAccountFailure("claude-code", "Please sign in: https://claude.ai/login")).to.equal(null);
  });

  it("reads only EARLY output — a session transcript that discusses quotas is not a billing failure", () => {
    const long = `${"x".repeat(10_000)}\nwe hit the free trial has expired path in the billing module\n`;
    expect(recogniseAccountFailure("ibm-bob", long)).to.equal(null);
  });
});
