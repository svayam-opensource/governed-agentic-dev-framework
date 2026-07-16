// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
// `gov creds set` arg parse + scope routing (personal default per 2.ii.b; --shared for account creds).
import { expect } from "chai";
import { parseCredsSet } from "../../src/cli/creds-scoped.js";

describe("creds-scoped — arg parse + scope routing", () => {
  it("defaults to PERSONAL scope with key + optional value", () => {
    expect(parseCredsSet(["npm.svayamtech.com", "tok"])).to.deep.equal({ key: "npm.svayamtech.com", value: "tok", scope: "personal", fromNpmrc: false });
    expect(parseCredsSet(["npm.svayamtech.com"]).value).to.equal(undefined);
  });

  it("--shared routes to the account store; --from-npmrc is flagged; flags aren't positionals", () => {
    const r = parseCredsSet(["mykey", "--shared", "--from-npmrc"]);
    expect(r.key).to.equal("mykey");
    expect(r.value).to.equal(undefined);
    expect(r.scope).to.equal("shared");
    expect(r.fromNpmrc).to.equal(true);
  });

  it("--from-npmrc without a value keeps personal scope and no positional value", () => {
    expect(parseCredsSet(["npm.svayamtech.com", "--from-npmrc"])).to.deep.equal({ key: "npm.svayamtech.com", value: undefined, scope: "personal", fromNpmrc: true });
  });
});
