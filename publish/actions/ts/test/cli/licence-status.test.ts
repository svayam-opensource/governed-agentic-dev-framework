// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// `gov licence login | status | install` (plan 02 E05). status shows what the installed module says — org, plan,
// entitlements, lease expiry — and where the personal key lives; open gov never judges a licence itself (spec 02 §5:
// verification in open gov would be decorative). All network and module access is through fakes.
import { expect } from "chai";
import * as path from "node:path";
import { licenceCommand, type LicenceDeps, type ModuleState } from "../../src/cli/licence-verb.js";
import { createKeychain, LICENCE_ACCOUNT, type OsKeychain } from "../../src/security/keychain.js";
import type { LicenceStatus } from "../../src/check-seam/public.js";

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");
const KEY = `${b64({ alg: "EdDSA", typ: "gov-key+jws", kid: "test-stub-1" })}.${b64({ org: 297356872, jti: "k1" })}.c2ln`;

function memoryKeychain(env: Record<string, string> = {}): OsKeychain {
  const store = new Map<string, string>();
  return createKeychain({
    platform: "linux", env,
    run: (_c, args, input) => {
      const a = args[args.indexOf("account") + 1]!;
      if (args[0] === "store") { store.set(a, input!); return { status: 0, stdout: "", stderr: "", notFound: false }; }
      if (args[0] === "lookup") { const v = store.get(a); return { status: v ? 0 : 1, stdout: v ?? "", stderr: "", notFound: false }; }
      store.delete(a); return { status: 0, stdout: "", stderr: "", notFound: false };
    },
  });
}

const licensed: LicenceStatus = {
  state: "licensed", org: { vcs: "github", id: 297356872 }, plan: "pilot", entitlements: ["evidence"], leaseExpiry: "2026-10-20T08:00:00Z",
};

function deps(over: Partial<LicenceDeps> = {}, status: LicenceStatus = licensed): LicenceDeps & { logins: string[]; files: Map<string, string> } {
  const logins: string[] = [];
  const files = new Map<string, string>();
  const active: ModuleState = { state: "active", via: "licence-install", licence: { status: () => status, login: (k) => { logins.push(k); return Promise.resolve(); } } };
  return {
    keychain: memoryKeychain(),
    loadModule: () => Promise.resolve(active),
    readKey: () => Promise.resolve(KEY),
    registryToken: () => Promise.resolve({ ok: true, token: "npm_tok_123" }),
    npmInstall: () => ({ status: 0, stderr: "" }),
    writeFile: (p, t) => { files.set(p, t); },
    installDir: "/data/gov/gov-check",
    portalUrl: "https://portal.example/keys",
    logins, files,
    ...over,
  };
}

describe("gov licence status", () => {
  it("shows org, plan, entitlements and lease expiry from the module, and where the key lives", async () => {
    const d = deps();
    await d.keychain.set(LICENCE_ACCOUNT, KEY);
    const r = await licenceCommand(["status"], {}, d);
    const out = r.lines.join("\n");
    expect(r.code, out).to.equal(0);
    expect(out).to.match(/personal key\s+stored in Secret Service \(secret-tool\)/);
    expect(out).to.match(/state\s+licensed/);
    expect(out).to.match(/org\s+github 297356872/);
    expect(out).to.match(/plan\s+pilot/);
    expect(out).to.match(/entitlements\s+evidence/);
    expect(out).to.match(/lease expires\s+2026-10-20T08:00:00Z/);
    expect(out).to.not.include(KEY);
  });

  it("grace is shown with its reason and still exits 0; refused exits 1 with the reason", async () => {
    const g = await licenceCommand(["status"], {}, deps({}, { ...licensed, state: "grace", reason: "the licence service is unreachable; the cached lease is used until its grace ends" }));
    expect(g.code).to.equal(0);
    expect(g.lines.join("\n")).to.match(/state\s+grace/).and.match(/reason\s+the licence service is unreachable/);
    const f = await licenceCommand(["status"], {}, deps({}, { state: "refused", entitlements: [], reason: "the subscription ended on 2026-09-30" }));
    expect(f.code).to.equal(1);
    expect(f.lines.join("\n")).to.match(/subscription ended/);
  });

  it("no module installed: says so and how to install it; the key is still reported (from the environment here)", async () => {
    const r = await licenceCommand(["status"], {}, deps({ keychain: memoryKeychain({ GOV_LICENCE_KEY: KEY }), loadModule: () => Promise.resolve({ state: "absent" }) }));
    const out = r.lines.join("\n");
    expect(r.code).to.equal(1);
    expect(out).to.match(/personal key\s+from GOV_LICENCE_KEY/);
    expect(out).to.match(/gov-check\s+not installed — `gov licence install`/);
  });

  it("a module that does not fit is reported in its own one line", async () => {
    const r = await licenceCommand(["status"], {}, deps({ loadModule: () => Promise.resolve({ state: "refused", lines: ["gov-check: the installed module speaks host API 2.x — running without it."] }) }));
    expect(r.lines.join("\n")).to.match(/host API 2\.x/);
  });

  it("no key anywhere: points at `gov licence login`", async () => {
    const r = await licenceCommand(["status"], {}, deps({ loadModule: () => Promise.resolve({ state: "absent" }) }));
    expect(r.lines.join("\n")).to.match(/personal key\s+not set — `gov licence login`/);
  });
});

describe("gov licence login", () => {
  it("stores the key in the keychain, hands it to the module, and never prints it", async () => {
    const d = deps();
    const r = await licenceCommand(["login"], {}, d);
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(await d.keychain.get(LICENCE_ACCOUNT)).to.equal(KEY);
    expect(d.logins).to.deep.equal([KEY]);
    expect(r.lines.join("\n")).to.include("https://portal.example/keys").and.match(/stored in Secret Service/).and.not.include(KEY);
  });

  it("refuses what is not a personal key (gov-key+jws), and stores nothing", async () => {
    const d = deps({ readKey: () => Promise.resolve("sk-ant-not-a-gov-key") });
    const r = await licenceCommand(["login"], {}, d);
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.match(/not a gov personal key/).and.not.include("sk-ant-not-a-gov-key");
    expect(await d.keychain.get(LICENCE_ACCOUNT)).to.equal(null);
  });

  it("nothing pasted → usage-free failure, nothing stored", async () => {
    const d = deps({ readKey: () => Promise.resolve(null) });
    expect((await licenceCommand(["login"], {}, d)).code).to.equal(1);
  });

  it("an env-only machine: tells the person to export GOV_LICENCE_KEY, and writes no file", async () => {
    const d = deps({ keychain: createKeychain({ platform: "aix", env: {}, run: () => { throw new Error("no tool"); } }) });
    const r = await licenceCommand(["login"], {}, d);
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.match(/GOV_LICENCE_KEY/).and.not.include(KEY);
    expect(d.files.size).to.equal(0);
  });
});

describe("gov licence install", () => {
  it("exchanges the key for a short-lived registry token, passes it to npm in the ENVIRONMENT only, and writes no token to .npmrc", async () => {
    const seen: { dir: string; spec: string; env: Record<string, string> }[] = [];
    const asked: string[] = [];
    const d = deps({
      registryToken: (k) => { asked.push(k); return Promise.resolve({ ok: true, token: "npm_tok_123" }); },
      npmInstall: (dir, spec, env) => { seen.push({ dir, spec, env }); return { status: 0, stderr: "" }; },
    });
    await d.keychain.set(LICENCE_ACCOUNT, KEY);
    const r = await licenceCommand(["install"], {}, d);
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(asked).to.deep.equal([KEY]);
    expect(seen).to.have.length(1);
    expect(seen[0]!.dir).to.equal("/data/gov/gov-check");
    expect(seen[0]!.spec).to.match(/^@svayam\/gov-check@/);
    // BASIC auth, user `gov-registry`, password = the token: the only form the registry's gate plugin is handed. An
    // `_authToken` is sent as a Bearer token, which Verdaccio keeps for its OWN sessions — the install arrived
    // anonymous and got 401 (measured against Verdaccio 6.3.1 with verdaccio-gov-auth).
    const basic = Buffer.from("gov-registry:npm_tok_123").toString("base64");
    expect(seen[0]!.env).to.deep.equal({ GOV_CHECK_REGISTRY_AUTH: basic });
    const npmrc = d.files.get(path.join("/data/gov/gov-check", ".npmrc"))!;   // written with path.join: `\data\…` on Windows
    expect(npmrc).to.include("@svayam:registry=https://npm.svayamtech.com/");
    expect(npmrc).to.include("//npm.svayamtech.com/:_auth=${GOV_CHECK_REGISTRY_AUTH}");
    // A Svayam developer's own ~/.npmrc often holds an SSO `_authToken` for this host, and npm prefers a token over
    // `_auth` across config layers — so this file blanks it, or npm would read gov-check as that person (403).
    expect(npmrc.split("\n")).to.include("//npm.svayamtech.com/:_authToken=");
    // gov-check's own dependencies (public npm packages) come from npmjs, never through npm.svayamtech.com: a gov
    // registry token reaches gov-check only, so a developer whose default registry is npm.svayamtech.com got 403.
    expect(npmrc.split("\n")).to.include("registry=https://registry.npmjs.org/");
    for (const t of d.files.values()) expect(t).to.not.include(KEY).and.not.include("npm_tok_123").and.not.include(basic);
    expect(r.lines.join("\n")).to.not.include("npm_tok_123").and.not.include(basic);
  });

  it("no key → points at login, asks nothing of the network", async () => {
    let called = false;
    const r = await licenceCommand(["install"], {}, deps({ registryToken: () => { called = true; return Promise.resolve({ ok: false, reason: "x" }); } }));
    expect(r.code).to.equal(1);
    expect(called).to.equal(false);
    expect(r.lines.join("\n")).to.match(/gov licence login/);
  });

  it("the service refuses the key → one plain line, npm never runs", async () => {
    let ran = false;
    const d = deps({ registryToken: () => Promise.resolve({ ok: false, reason: "HTTP 403: the organization has no evidence entitlement" }), npmInstall: () => { ran = true; return { status: 0, stderr: "" }; } });
    await d.keychain.set(LICENCE_ACCOUNT, KEY);
    const r = await licenceCommand(["install"], {}, d);
    expect(r.code).to.equal(1);
    expect(ran).to.equal(false);
    expect(r.lines.join("\n")).to.match(/no evidence entitlement/);
  });

  it("npm fails → its last line, with the token and the key scrubbed", async () => {
    const d = deps({ npmInstall: () => ({ status: 1, stderr: `npm ERR! 401 for token npm_tok_123 and ${KEY}\n` }) });
    await d.keychain.set(LICENCE_ACCOUNT, KEY);
    const r = await licenceCommand(["install"], {}, d);
    expect(r.code).to.equal(1);
    const out = r.lines.join("\n");
    expect(out).to.match(/npm ERR! 401/).and.not.include("npm_tok_123").and.not.include(KEY);
  });

  it("an unknown subcommand is usage (2)", async () => {
    expect((await licenceCommand(["renew"], {}, deps())).code).to.equal(2);
  });
});
