// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  credentialsPath, credKey, parseCredentials, getCredential, setCredential,
  listCredentialKeys, listIdentities, identityExists, defaultIdentity,
} from "../../src/security/credentials.js";

describe("security — per-user credential store", () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "gov-creds-")); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it("resolves the path under <work-root>/preferences/<identity>/credentials", () => {
    expect(credentialsPath("/w", "rkant")).to.equal(path.join("/w", "preferences", "rkant", "credentials"));
    expect(credKey("npm_token", "npm.svayamtech.com")).to.equal("npm_token:npm.svayamtech.com");
  });

  it("set → get round-trips; creates dir 0700 + file 0600", () => {
    const file = credentialsPath(root, "rkant");
    setCredential(file, "npm_token:npm.svayamtech.com", "brr.oidc.token.value");
    expect(getCredential(file, "npm_token:npm.svayamtech.com")).to.equal("brr.oidc.token.value");
    if (process.platform !== "win32") {
      expect(fs.statSync(file).mode & 0o777).to.equal(0o600);
      expect(fs.statSync(path.dirname(file)).mode & 0o777).to.equal(0o700);
    }
  });

  it("is LINE-PRESERVING — updating one key never clobbers other content", () => {
    const file = credentialsPath(root, "rkant");
    // a pre-existing store we did NOT create: comments, other keys, even a non-KEY=VALUE line
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "# my creds\nGH_TOKEN=ghp_existing\n[some-other-format-block]\nnpm_token:npmjs=old\n");
    setCredential(file, "npm_token:npmjs", "new");           // update an existing key
    setCredential(file, "vault_token:uat", "vt-123");        // append a new key
    const text = fs.readFileSync(file, "utf8");
    expect(text).to.include("# my creds");                    // comment preserved
    expect(text).to.include("GH_TOKEN=ghp_existing");         // unrelated key preserved
    expect(text).to.include("[some-other-format-block]");     // unknown line preserved
    expect(getCredential(file, "npm_token:npmjs")).to.equal("new");
    expect(getCredential(file, "vault_token:uat")).to.equal("vt-123");
    expect(getCredential(file, "GH_TOKEN")).to.equal("ghp_existing");
  });

  it("parse ignores blanks/comments; value keeps everything after the first '='", () => {
    const m = parseCredentials("# c\n\nA=1\nB= x=y=z \n");
    expect([...m.keys()]).to.deep.equal(["A", "B"]);
    expect(m.get("B")).to.equal(" x=y=z ");
  });

  it("lists identities + keys; identityExists reflects the file", () => {
    setCredential(credentialsPath(root, "rkant"), "a:b", "1");
    setCredential(credentialsPath(root, "gyan"), "c:d", "2");
    expect(listIdentities(root)).to.deep.equal(["gyan", "rkant"]);
    expect(identityExists(root, "rkant")).to.equal(true);
    expect(identityExists(root, "nobody")).to.equal(false);
    expect(listCredentialKeys(credentialsPath(root, "rkant"))).to.deep.equal(["a:b"]);
  });

  it("defaultIdentity prefers GOV_IDENTITY, else the logged-in user", () => {
    expect(defaultIdentity({ GOV_IDENTITY: "gyan", USER: "rkant" } as NodeJS.ProcessEnv)).to.equal("gyan");
    expect(defaultIdentity({ USER: "rkant" } as NodeJS.ProcessEnv)).to.equal("rkant");
    expect(defaultIdentity({} as NodeJS.ProcessEnv)).to.equal(os.userInfo().username);
  });

  it("get/list are safe on a missing file", () => {
    expect(getCredential(credentialsPath(root, "ghost"), "x")).to.equal(undefined);
    expect(listCredentialKeys(credentialsPath(root, "ghost"))).to.deep.equal([]);
    expect(listIdentities(path.join(root, "nope"))).to.deep.equal([]);
  });
});
