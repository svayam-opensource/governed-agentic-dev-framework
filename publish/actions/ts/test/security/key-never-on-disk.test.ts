// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// A10 — THE PERSONAL KEY NEVER TOUCHES DISK OR A LOG (spec 02 §8). A person logs in, asks for status, and makes a call
// that fails (the licence service refuses the key, echoing it back in its error). Then the whole temp $HOME — gov's
// run log included — and every line gov printed are searched for the key. None may hold it.
//
// Real code paths: the keychain runs a REAL process (a stand-in `secret-tool` on PATH, whose store is outside $HOME,
// as the OS keyring is) through gov's logged process runner, and the refusal comes from a real HTTP server on
// 127.0.0.1 through the real registry-token client. Nothing reaches the internet.
import { expect } from "chai";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import type { AddressInfo } from "node:net";
import { licenceCommand } from "../../src/cli/licence-verb.js";
import { httpRegistryToken } from "../../src/cli/licence-run.js";
import { createKeychain, keychainRunner, LICENCE_ACCOUNT } from "../../src/security/keychain.js";
import { endRun, startRun } from "../../src/log.js";
import { writeStandIn } from "../helpers/stand-in.js";

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");
const KEY = `${b64({ alg: "EdDSA", typ: "gov-key+jws", kid: "test-stub-1" })}.${b64({ org: 297356872, jti: "never-on-disk-7f3a" })}.c2lnbmF0dXJlLW9mLXRoZS1rZXk`;

const FAKE_SECRET_TOOL = `#!/usr/bin/env node
const fs = require("fs"), path = require("path");
const a = process.argv.slice(2), dir = process.env.FAKE_SECRET_STORE, f = path.join(dir, encodeURIComponent(a[a.indexOf("account") + 1]));
if (a[0] === "store") { let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => fs.writeFileSync(f, s)); }
else if (a[0] === "lookup") { if (fs.existsSync(f)) process.stdout.write(fs.readFileSync(f, "utf8")); else process.exit(1); }
else if (a[0] === "clear") { if (fs.existsSync(f)) fs.rmSync(f); }
`;

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(p)); else if (e.isFile()) out.push(p);
  }
  return out;
}

async function settledLog(dir: string): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const all = fs.existsSync(dir) ? filesUnder(dir).filter((f) => f.endsWith(".log")).map((f) => fs.readFileSync(f, "utf8")).join("\n") : "";
    if (all.includes("run finished")) return all;
    await new Promise((r) => setTimeout(r, 50));
  }
  return "";
}

// Every OS: the stand-in gets a `.cmd` beside it on Windows, so gov's spawn finds it there too (helpers/stand-in.ts).
describe("A10 — the personal key never on disk, never in a log", function () {
  this.timeout(30_000);
  let home = ""; let store = ""; let bin = ""; let server: http.Server; let base = "";
  const printed: string[] = [];

  before(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "gov-a10-home-"));
    store = fs.mkdtempSync(path.join(os.tmpdir(), "gov-a10-keyring-"));   // the "OS keyring": outside $HOME
    bin = fs.mkdtempSync(path.join(os.tmpdir(), "gov-a10-bin-"));
    writeStandIn(bin, "secret-tool", FAKE_SECRET_TOOL, "node");
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (d) => (body += d)).on("end", () => {
        // A careless service that echoes the key back in its refusal: gov must still not print or log it.
        res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: `key ${JSON.parse(body).personalKey} is revoked` }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  });

  after(() => {
    server.close();
    for (const d of [home, store, bin]) fs.rmSync(d, { recursive: true, force: true });
  });

  it("login + status + a refused install leave no trace of the key in $HOME, the run log, or the output", async () => {
    const env = { ...process.env, HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`, FAKE_SECRET_STORE: store };
    startRun({ argv: ["licence", "login"], command: "licence", project: "PRJ-9-demo", workRoot: path.join(home, "work"), login: "tester", version: "9.9.9" });
    const keychain = createKeychain({ platform: "linux", env: {}, run: keychainRunner(env) });
    const deps = {
      keychain,
      loadModule: () => Promise.resolve({ state: "absent" as const }),
      readKey: () => Promise.resolve(KEY),
      registryToken: httpRegistryToken(base),
      npmInstall: () => { throw new Error("npm must not run after a refusal"); },
      writeFile: (p: string, t: string) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); },
      installDir: path.join(home, ".local", "share", "gov", "gov-check"),
      portalUrl: "https://portal.example/keys",
    };

    const login = await licenceCommand(["login"], {}, deps);
    printed.push(...login.lines);
    expect(login.code, login.lines.join("\n")).to.equal(0);
    expect(await keychain.get(LICENCE_ACCOUNT)).to.equal(KEY);   // it IS stored — in the keyring, not $HOME

    const status = await licenceCommand(["status"], {}, deps);
    printed.push(...status.lines);
    const install = await licenceCommand(["install"], {}, deps);
    printed.push(...install.lines);
    expect(install.code).to.equal(1);
    expect(install.lines.join("\n")).to.match(/401/);

    endRun(install.code);
    const log = await settledLog(path.join(home, "work"));
    expect(log, "the run log was written").to.include("secret-tool");

    const hits = filesUnder(home).filter((f) => fs.readFileSync(f).includes(KEY));
    expect(hits, "files under $HOME holding the key").to.deep.equal([]);
    expect(log).to.not.include(KEY);
    expect(printed.join("\n")).to.not.include(KEY);
    // the distinctive middle of the key, in case something re-encoded the rest
    expect(log + printed.join("\n")).to.not.include("never-on-disk-7f3a").and.not.include(KEY.split(".")[1]!);
  });
});
