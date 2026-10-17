// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// ONE IMPLEMENTATION (plan 02 E06): the host gov hands a paid module carries the very ledger functions the free
// verifier runs — the writer signs what `gov evidence verify` checks, byte for byte. Host API 1.1 added them.
import { expect } from "chai";
import { createHost } from "../../src/check-seam/host.js";
import { checkLockStep, HOST_API } from "../../src/check-seam/public.js";
import * as hash from "../../src/evidence/hash.js";
import { dirSource, verifyLedger } from "../../src/evidence/verify.js";

describe("check-seam — host.ledger is the verifier's own code (host API 1.1)", () => {
  it("hands the module the same function objects the verifier uses", () => {
    const h = createHost({ govVersion: "2.0.0" });
    expect(h.ledger?.segmentRoot).to.equal(hash.segmentRoot);
    expect(h.ledger?.entryHash).to.equal(hash.entryHash);
    expect(h.ledger?.sealPayload).to.equal(hash.sealPayload);
    expect(h.ledger?.verifyLedger).to.equal(verifyLedger);
    expect(h.ledger?.dirSource).to.equal(dirSource);
    expect(h.ledger?.ZERO_HASH).to.equal("0".repeat(64));
  });

  it("is minor 1 of API 1: a module that needs host.ledger declares minHostMinor 1 and fits", () => {
    expect(HOST_API).to.deep.equal({ major: 1, minor: 1 });
    expect(checkLockStep({ major: 1, minHostMinor: 1 }).ok).to.equal(true);
    expect(checkLockStep({ major: 1, minHostMinor: 0 }).ok).to.equal(true);
  });
});
