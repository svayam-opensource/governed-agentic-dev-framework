// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// ONE CANONICALISER (spec 02 §3.2). Every line hash, seal and chain signature is over the canonical JSON of a value, and
// the writer (closed gov-check) and the verifier (open gov) must agree byte for byte — so there is exactly one
// implementation, here, handed to the module through the host. Fixed vectors pin it: a change to them breaks every
// ledger ever written.
import { expect } from "chai";
import { canonicalJson, sha256Hex } from "../../src/evidence/canonical.js";

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
