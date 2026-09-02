// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** The tier-2 key: two writes, no reads back (#196, Q6). */
import { expect } from "chai";
import { fingerprint, keysAgree, planCredentialWrites, credentialNotice } from "../../src/cli/agent-credentials.js";

describe("gov-work — handling an API key (#196)", () => {
  it("compares by digest, so drift is detectable without holding the value", () => {
    expect(keysAgree("sk-abc", "sk-abc")).to.equal(true);
    expect(keysAgree("sk-abc", "sk-different")).to.equal(false);
    expect(fingerprint("sk-abc"), "short, and not the key").to.have.length(12);
    expect(fingerprint("sk-abc")).to.not.contain("sk-");
  });

  it("ignores whitespace, which is how a copied key usually differs from itself", () => {
    expect(keysAgree("sk-abc", "  sk-abc\n")).to.equal(true);
  });

  it("treats a missing copy as agreement — there is nothing to disagree about yet", () => {
    expect(keysAgree(null, "sk-abc")).to.equal(true);
    expect(keysAgree("sk-abc", null)).to.equal(true);
  });

  it("writes both copies at 0600", () => {
    const w = planCredentialWrites("anthropic", "sk-x", "/home/t/.config/anthropic/key", "/home/t/.gov/geneva/projects/preferences/rk");
    expect(w).to.have.length(2);
    expect(w.every((x) => x.mode === 0o600), "a key readable by every process has leaked").to.equal(true);
    expect(w[0]!.path).to.equal("/home/t/.config/anthropic/key");
    expect(w[1]!.path).to.contain("preferences/rk/credentials");
  });

  it("labels the backup, because a bare key tells whoever finds it nothing", () => {
    const w = planCredentialWrites("anthropic", "sk-x", "/a", "/b");
    expect(w[1]!.contents).to.contain("saved by gov as a backup");
    expect(w[1]!.contents).to.contain("ANTHROPIC_KEY=sk-x");
  });

  it("says out loud that a key is being handled, and where it goes", () => {
    const text = credentialNotice("aider", "/home/t/.aider.conf", "/home/t/prefs").join("\n");
    expect(text).to.contain("gov has to handle it");
    expect(text).to.contain("/home/t/.aider.conf");
    expect(text).to.contain("0600");
    expect(text, "and what it will not do with it").to.contain("never puts it in an agent's context");
  });
});
