// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * #45 — `gov auth login` must authenticate `gov deploy`. One umbrella, one session, keyed by the IAM
 * identity EMAIL (Policy-Owner ruling 2026-08-04).
 *
 * These cases assert the PLUGIN's half of the contract, from inside the host. That direction is the point:
 * the bug was two correct implementations of two different conventions, and a test that only checked "did
 * the host write a file it can read back" passed throughout.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { saveSession, loadSession, sessionIdentity, readCurrentIdentity, authPath } from "../../src/security/auth-store.js";

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "gov-session-"));
const TOKENS = { idToken: "idt", accessToken: "acc", expiresAt: 1_800_000_000_000 };

describe("#45 — one session store, keyed by the IAM identity", () => {
  it("keys the session by the IAM EMAIL, not the OS username", () => {
    const root = tmp();
    const file = saveSession(root, "rkant@svayam.ai", TOKENS);
    expect(file).to.equal(authPath(root, "rkant@svayam.ai"));
    expect(file).to.contain("preferences/rkant@svayam.ai/gov-auth.json");
  });

  // THE REGRESSION, in the direction that matters: gov-cicd resolves the directory through `.current` and
  // then reads `.token`. A login that does not write BOTH cannot authenticate a governed verb, however
  // correct it looks from this side.
  it("writes what the PLUGIN reads — the `.current` pointer and a `token` field", () => {
    const root = tmp();
    saveSession(root, "rkant@svayam.ai", TOKENS);

    expect(readCurrentIdentity(root)).to.equal("rkant@svayam.ai");          // the pointer gov-cicd follows

    const onDisk = JSON.parse(fs.readFileSync(authPath(root, "rkant@svayam.ai"), "utf8"));
    expect(onDisk.token).to.equal("acc");                                    // what gov-cicd reads
    expect(onDisk.user).to.equal("rkant@svayam.ai");
    expect(onDisk.accessToken).to.equal("acc");                              // what the host reads
    expect(onDisk.expiresAt).to.equal(TOKENS.expiresAt);
  });

  it("is written 0600 — a bearer for every gov verb is not group-readable", () => {
    const root = tmp();
    const file = saveSession(root, "rkant@svayam.ai", TOKENS);
    expect(fs.statSync(file).mode & 0o777).to.equal(0o600);
  });

  it("round-trips through the pointer, with no identity supplied by the caller", () => {
    const root = tmp();
    saveSession(root, "rkant@svayam.ai", TOKENS);
    const s = loadSession(root, {} as NodeJS.ProcessEnv);
    expect(s?.token).to.equal("acc");
    expect(s?.user).to.equal("rkant@svayam.ai");
  });

  describe("identity resolution", () => {
    it("prefers an explicit GOV_IDENTITY over the pointer", () => {
      const root = tmp();
      saveSession(root, "rkant@svayam.ai", TOKENS);
      expect(sessionIdentity(root, { GOV_IDENTITY: "someone.else@svayam.ai" } as NodeJS.ProcessEnv)).to.equal("someone.else@svayam.ai");
    });

    it("prefers the pointer over the OS username", () => {
      const root = tmp();
      saveSession(root, "rkant@svayam.ai", TOKENS);
      expect(sessionIdentity(root, { USER: "rkant" } as NodeJS.ProcessEnv)).to.equal("rkant@svayam.ai");
    });

    // MIGRATION: a session saved before this change lives under the OS username with no pointer. It must
    // keep working until the next login rewrites it — otherwise the fix for a login bug logs everyone out.
    it("falls back to the OS username when no pointer exists yet", () => {
      const root = tmp();
      expect(sessionIdentity(root, { USER: "rkant" } as NodeJS.ProcessEnv)).to.equal("rkant");
    });
  });
});
