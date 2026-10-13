// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// ONE CANONICALISER (spec 02 §3.2). Every line hash, seal and chain signature is over the canonical JSON of a value, and
// the writer (closed gov-check) and the verifier (open gov) must agree byte for byte — so there is exactly one
// implementation, here, handed to the module through the host. Fixed vectors pin it: a change to them breaks every
// ledger ever written.
import { expect } from "chai";
import { canonicalJson, sha256Hex } from "../../src/evidence/canonical.js";
import { entryHash, entryPayload, lineDigest, sealPayload, segmentRoot, verifyEd25519, ZERO_HASH } from "../../src/evidence/hash.js";

describe("evidence — canonical JSON (fixed vectors)", () => {
  const vectors: [unknown, string][] = [
    [{ b: 2, a: 1 }, '{"a":1,"b":2}'],
    [{ z: { y: [3, 2, { b: null, a: false }] }, A: "x" }, '{"A":"x","z":{"y":[3,2,{"a":false,"b":null}]}}'],
    ["é \"\\\n", '"é \\"\\\\\\n"'],
    [[], "[]"],
    [{}, "{}"],
    [-0, "0"],
    [9007199254740991, "9007199254740991"],
  ];
  for (const [v, s] of vectors) it(`canonicalises ${JSON.stringify(v)}`, () => expect(canonicalJson(v)).to.equal(s));

  it("orders keys by UTF-16 code units (RFC 8785)", () => {
    expect(canonicalJson({ "é": 1, z: 2, "😀": 3, a: 4 })).to.equal('{"a":4,"z":2,"é":1,"😀":3}');
  });

  it("refuses values with no single canonical form: fractions, NaN, Infinity, undefined, functions, unsafe integers", () => {
    for (const bad of [1.5, NaN, Infinity, undefined, () => 1, 2 ** 60, { a: undefined }, [undefined], BigInt(1)]) {
      expect(() => canonicalJson(bad), String(bad)).to.throw(/canonical/);
    }
  });

  it("sha256Hex hashes UTF-8 text and bytes", () => {
    expect(sha256Hex("")).to.equal("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex(new Uint8Array([0x61, 0x62, 0x63]))).to.equal("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex(canonicalJson({ b: 1, a: 2 }))).to.equal(sha256Hex('{"a":2,"b":1}'));
  });
});

// THE LEDGER HASHES (spec 02 §3.2), pinned by vectors computed OUTSIDE this codebase (Python hashlib, RFC 8032 §7.1
// test 1). The writer (gov-check, through the host) and the verifier (`gov evidence verify`) share these functions.
describe("evidence — ledger hashes and signatures (fixed vectors)", () => {
  it("seal root = sha256 over the concatenated raw 32-byte line digests", () => {
    expect(segmentRoot([{ b: 1, a: 2 }, { x: "é" }])).to.equal("d0f91bbac65c75e8d99bbde74afa2c791fec3265c9bbd786a92fdf870cc7b18e");
    expect(lineDigest({ b: 1, a: 2 }).toString("hex")).to.equal(sha256Hex('{"a":2,"b":1}'));
    expect(segmentRoot([])).to.equal("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("entry hash (the next prev) covers the whole entry, sig included; the signing payload leaves sig out", () => {
    const e = { n: 1, segment: "2026/10/12/ci-1-1-1.jsonl", sha256: "a".repeat(64), prev: ZERO_HASH, writer: "test-w", sig: "AAAA" };
    expect(entryHash(e)).to.equal("d3f2f70b0e7eaae2fb56b639c1e21792d432c633e580b14280a1f8cc249526e6");
    expect(entryPayload(e)).to.equal(`{"n":1,"prev":"${"0".repeat(64)}","segment":"2026/10/12/ci-1-1-1.jsonl","sha256":"${"a".repeat(64)}","writer":"test-w"}`);
    expect(sealPayload({ segment: "s", count: 1, sig: "x" })).to.equal('{"count":1,"segment":"s"}');
    expect(ZERO_HASH).to.equal("0".repeat(64));
  });

  it("Ed25519 verification matches RFC 8032 test 1 (empty message) and refuses a changed byte", () => {
    const jwk = { kty: "OKP" as const, crv: "Ed25519" as const, x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo" };
    const sig = "5VZDAMNgrHKQhuLMgG6CioSHfx645dl02HPgZSJJAVVfuIIVkKM7rMYeOXAc-bRr0lv18FlbviRlUUFDjnoQCw";
    expect(verifyEd25519(jwk, "", sig)).to.equal(true);
    expect(verifyEd25519(jwk, "x", sig)).to.equal(false);
    expect(verifyEd25519(jwk, "", sig.replace(/^5/, "6"))).to.equal(false);
    expect(verifyEd25519(jwk, "", "not base64url!")).to.equal(false);
  });
});
