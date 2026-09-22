// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** The tier-2 key: two writes, no reads back (#196, Q6). */
import { expect } from "chai";
import { fingerprint, keysAgree, planCredentialWrites, credentialNotice, credentialsPathFor, storedCredential, storeIsPrivate } from "../../src/cli/agent-credentials.js";

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
    // Labelled — it is the store now (Policy Owner, 2026-09-22), not "a backup", and says what gov does with it.
    expect(w[1]!.contents).to.contain("saved by gov; gov loads it into the sessions it starts");
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

// PRJ-121, 2026-09-22 — on a walk the backup held `IBM_BOB_KEY=…` while Bob reads `BOB_API_KEY`, so sourcing it
// (the recovery the backup exists for) set a variable nothing reads. And the file was overwritten per agent.
describe("the backup — the agent's real variable, and one file that keeps every agent's key", () => {
  it("names the variable the AGENT reads, not one derived from its id", () => {
    const w = planCredentialWrites("ibm-bob", "k1", "", "/p", "BOB_API_KEY");
    expect(w[1]!.contents).to.contain("BOB_API_KEY=k1");
    expect(w[1]!.contents).to.not.contain("IBM_BOB_KEY=");
  });

  it("merges: a second agent's key does not erase the first's", () => {
    const first = planCredentialWrites("ibm-bob", "k1", "", "/p", "BOB_API_KEY")[1]!.contents;
    const both = planCredentialWrites("claude-code", "k2", "", "/p", "ANTHROPIC_API_KEY", first)[1]!.contents;
    expect(both).to.contain("BOB_API_KEY=k1").and.to.contain("ANTHROPIC_API_KEY=k2");
  });

  it("replaces only this agent's line — including one an older gov wrote under the derived name", () => {
    const old = "# ibm-bob — saved by gov as a backup. The agent's own config is what it reads.\nIBM_BOB_KEY=old\nOTHER=keep\n";
    const next = planCredentialWrites("ibm-bob", "new", "", "/p", "BOB_API_KEY", old)[1]!.contents;
    expect(next).to.contain("BOB_API_KEY=new").and.to.contain("OTHER=keep");
    expect(next, "the stale legacy line is gone, not left to be sourced by mistake").to.not.contain("IBM_BOB_KEY=old");
    expect(next.match(/# ibm-bob — saved by gov/g), "one comment per agent").to.have.length(1);
  });
});

// Policy Owner, 2026-09-22: "Any credentials, including agent API keys, should be stored/loaded in/from the
// designated user preferences folder/file." On a walk, a key pasted once was gone the moment gov exited.
describe("the store — loaded into the sessions gov starts", () => {
  it("lives beside the person's preferences file", () => {
    expect(credentialsPathFor("/home/t/.gov/svmgen/projects/", "svayam-rkant")).to.equal("/home/t/.gov/svmgen/projects/preferences/svayam-rkant/credentials");
  });

  it("returns the value of the agent's real variable", () => {
    expect(storedCredential("# c\nBOB_API_KEY=k1\n", "BOB_API_KEY", "ibm-bob")).to.equal("k1");
  });

  it("still loads a key an older gov stored under the derived name — nobody is asked twice", () => {
    // Exactly the file the 2026-09-21 walk left behind.
    const walk = "# ibm-bob — saved by gov as a backup. The agent's own config is what it reads.\nIBM_BOB_KEY=k-old\n";
    expect(storedCredential(walk, "BOB_API_KEY", "ibm-bob")).to.equal("k-old");
  });

  it("the real name wins over the legacy one when both are present", () => {
    expect(storedCredential("IBM_BOB_KEY=old\nBOB_API_KEY=new\n", "BOB_API_KEY", "ibm-bob")).to.equal("new");
  });

  it("finds nothing in no file, an empty value, or another agent's line", () => {
    expect(storedCredential(null, "BOB_API_KEY", "ibm-bob")).to.equal(null);
    expect(storedCredential("BOB_API_KEY=\n", "BOB_API_KEY", "ibm-bob")).to.equal(null);
    expect(storedCredential("ANTHROPIC_API_KEY=x\n", "BOB_API_KEY", "ibm-bob")).to.equal(null);
    expect(storedCredential("XBOB_API_KEY=x\n", "BOB_API_KEY", "ibm-bob"), "a prefix is not a match").to.equal(null);
  });

  it("is loaded only if no one else can read it", () => {
    expect(storeIsPrivate(0o100600, "linux")).to.equal(true);
    expect(storeIsPrivate(0o100644, "linux"), "group/world-readable → refuse").to.equal(false);
    expect(storeIsPrivate(0o100640, "darwin")).to.equal(false);
    expect(storeIsPrivate(0o100644, "win32"), "no mode bits to check on Windows").to.equal(true);
  });
});
