// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// THE OS KEYCHAIN PORT (spec 02 §5, plan 02 E05): macOS `security`, Linux `secret-tool`, Windows Credential Manager
// through PowerShell; the environment (GOV_LICENCE_KEY) as the fallback; NEVER a file. Each OS is driven through a
// fake tool runner that records exactly what was run — so the test can also prove the secret never travels on argv
// (where `ps` and gov's own process log would see it), only on stdin.
import { expect } from "chai";
import { createKeychain, LICENCE_ACCOUNT, type KeychainRun } from "../../src/security/keychain.js";

const KEY = "eyJhbGciOiJFZERTQSIsInR5cCI6Imdvdi1rZXkrandzIn0.eyJvcmcixIn0.c2lnbmF0dXJl";

interface Call { cmd: string; args: readonly string[]; input?: string }

/** A fake OS store: what the tool would keep, keyed by account, plus every call made. */
function fakeTool(platform: NodeJS.Platform, opts: { missing?: boolean; fail?: boolean } = {}) {
  const store = new Map<string, string>();
  const calls: Call[] = [];
  const run: KeychainRun = (cmd, args, input) => {
    calls.push({ cmd, args, ...(input !== undefined ? { input } : {}) });
    if (opts.missing) return { status: null, stdout: "", stderr: "", notFound: true };
    if (opts.fail) return { status: 1, stdout: "", stderr: "the daemon is not running", notFound: false };
    if (platform === "darwin") {
      if (args[0] === "find-generic-password") { const a = args[args.indexOf("-a") + 1]!; const v = store.get(a); return v ? { status: 0, stdout: `${v}\n`, stderr: "", notFound: false } : { status: 44, stdout: "", stderr: "not found", notFound: false }; }
      if (args[0] === "-i") { const m = /-a (\S+) -w "([^"]*)"/.exec(input ?? ""); if (m) store.set(m[1]!, m[2]!); return { status: 0, stdout: "", stderr: "", notFound: false }; }
      if (args[0] === "delete-generic-password") { store.delete(args[args.indexOf("-a") + 1]!); return { status: 0, stdout: "", stderr: "", notFound: false }; }
    }
    if (platform === "linux") {
      const a = args[args.indexOf("account") + 1]!;
      if (args[0] === "lookup") { const v = store.get(a); return v ? { status: 0, stdout: v, stderr: "", notFound: false } : { status: 1, stdout: "", stderr: "", notFound: false }; }
      if (args[0] === "store") { store.set(a, input ?? ""); return { status: 0, stdout: "", stderr: "", notFound: false }; }
      if (args[0] === "clear") { store.delete(a); return { status: 0, stdout: "", stderr: "", notFound: false }; }
    }
    if (platform === "win32") {
      const script = Buffer.from(args[args.indexOf("-EncodedCommand") + 1]!, "base64").toString("utf16le");
      const a = /\$target = 'gov:([a-z0-9/-]+)'/.exec(script)![1]!;
      const action = /# action: (\w+)/.exec(script)![1];
      if (action === "get") { const v = store.get(a); return v ? { status: 0, stdout: v, stderr: "", notFound: false } : { status: 2, stdout: "", stderr: "", notFound: false }; }
      if (action === "set") { store.set(a, input ?? ""); return { status: 0, stdout: "", stderr: "", notFound: false }; }
      if (action === "delete") { store.delete(a); return { status: 0, stdout: "", stderr: "", notFound: false }; }
    }
    return { status: 9, stdout: "", stderr: "unexpected", notFound: false };
  };
  return { store, calls, run };
}

const cases: [NodeJS.Platform, string, string][] = [
  ["darwin", "security", "macOS keychain"],
  ["linux", "secret-tool", "Secret Service (secret-tool)"],
  ["win32", "powershell.exe", "Windows Credential Manager"],
];

describe("keychain port — one OS store per platform, never a file", () => {
  for (const [platform, tool, backend] of cases) {
    describe(platform, () => {
      it(`stores, reads back and deletes through ${tool}; names its backend`, async () => {
        const f = fakeTool(platform);
        const k = createKeychain({ platform, env: {}, run: f.run });
        expect(k.backend).to.equal(backend);
        expect(await k.get(LICENCE_ACCOUNT)).to.equal(null);
        await k.set(LICENCE_ACCOUNT, KEY);
        expect(f.store.get(LICENCE_ACCOUNT)).to.equal(KEY);
        expect(await k.get(LICENCE_ACCOUNT)).to.equal(KEY);
        await k.delete(LICENCE_ACCOUNT);
        expect(await k.get(LICENCE_ACCOUNT)).to.equal(null);
        expect(f.calls.every((c) => c.cmd === tool)).to.equal(true);
      });

      it("the secret travels on stdin only — never on argv", async () => {
        const f = fakeTool(platform);
        const k = createKeychain({ platform, env: {}, run: f.run });
        await k.set(LICENCE_ACCOUNT, KEY);
        await k.get(LICENCE_ACCOUNT);
        for (const c of f.calls) {
          expect(c.args.join(" "), `${c.cmd} argv`).to.not.include(KEY);
          if (c.args.includes("-EncodedCommand")) expect(Buffer.from(c.args[c.args.indexOf("-EncodedCommand") + 1]!, "base64").toString("utf16le")).to.not.include(KEY);
        }
        expect(f.calls.some((c) => c.input?.includes(KEY))).to.equal(true);
      });

      it(`missing ${tool} → reads give null (or the environment), a write is refused with a plain hint`, async () => {
        const f = fakeTool(platform, { missing: true });
        const k = createKeychain({ platform, env: {}, run: f.run });
        expect(await k.get(LICENCE_ACCOUNT)).to.equal(null);
        let err: Error | undefined;
        try { await k.set(LICENCE_ACCOUNT, KEY); } catch (e) { err = e as Error; }
        expect(err?.message).to.include(tool.replace(".exe", "")).and.match(/GOV_LICENCE_KEY/);
        expect(err?.message).to.not.include(KEY);
        const withEnv = createKeychain({ platform, env: { GOV_LICENCE_KEY: KEY }, run: f.run });
        expect(await withEnv.get(LICENCE_ACCOUNT)).to.equal(KEY);
        expect(await withEnv.lookup(LICENCE_ACCOUNT)).to.deep.equal({ secret: KEY, from: "env" });
      });

      it("a tool that fails is reported without the secret in the message", async () => {
        const k = createKeychain({ platform, env: {}, run: fakeTool(platform, { fail: true }).run });
        let err: Error | undefined;
        try { await k.set(LICENCE_ACCOUNT, KEY); } catch (e) { err = e as Error; }
        expect(err?.message).to.match(/could not store/).and.not.include(KEY);
      });
    });
  }

  it("the keychain wins over the environment; the environment is the fallback for the licence key only", async () => {
    const f = fakeTool("linux");
    const k = createKeychain({ platform: "linux", env: { GOV_LICENCE_KEY: "from-env" }, run: f.run });
    expect(await k.lookup(LICENCE_ACCOUNT)).to.deep.equal({ secret: "from-env", from: "env" });
    await k.set(LICENCE_ACCOUNT, KEY);
    expect(await k.lookup(LICENCE_ACCOUNT)).to.deep.equal({ secret: KEY, from: "keychain" });
    expect(await k.get("writer-key")).to.equal(null);
  });

  it("a platform with no supported store is env-only: reads the environment, refuses to write anywhere", async () => {
    const k = createKeychain({ platform: "aix", env: { GOV_LICENCE_KEY: KEY }, run: () => { throw new Error("must not run a tool"); } });
    expect(k.backend).to.equal("env only");
    expect(await k.get(LICENCE_ACCOUNT)).to.equal(KEY);
    let err: Error | undefined;
    try { await k.set(LICENCE_ACCOUNT, KEY); } catch (e) { err = e as Error; }
    expect(err?.message).to.match(/GOV_LICENCE_KEY/);
  });

  it("the licence key lives at the account gov-check reads: gov-licence/personal-key", () => {
    expect(LICENCE_ACCOUNT).to.equal("gov-licence/personal-key");
  });

  it("refuses an account name or a secret that could break out of the tool's input", async () => {
    const k = createKeychain({ platform: "darwin", env: {}, run: fakeTool("darwin").run });
    let e1: Error | undefined; let e2: Error | undefined;
    try { await k.set("bad account", KEY); } catch (e) { e1 = e as Error; }
    try { await k.set(LICENCE_ACCOUNT, 'x" -s other'); } catch (e) { e2 = e as Error; }
    expect(e1?.message).to.match(/account/);
    expect(e2?.message).to.match(/characters/).and.not.include('x" -s other');
  });
});
