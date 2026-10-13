// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The MSI build, run on any OS (PRJ-121 plan 04 T13). Downloads, archive extraction and npm are injected; the
 * staged tree is written to a real temporary directory so the layout assertions read real files. The WiX step
 * itself needs Windows and is proved by adopter-e2e / windows (T16).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseShasums, verifyChecksum, nodeZipName, NODE_ARCHES } from "../lib/node-dist.mjs";
import { stage, LAUNCHERS, msiVersion } from "../lib/stage.mjs";
import { componentsWxs } from "../lib/wxs.mjs";
import { parseArgs, extractCommand } from "../scripts/build.mjs";

const sha = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "gov-msi-test-"));

const ZIP = Buffer.from("pretend this is node-v24.21.0-win-x64.zip");
const goodShasums = (arch: string, bytes = ZIP): string =>
  `${sha("other")}  node-v24.21.0-linux-x64.tar.xz\n${sha(bytes)}  node-v24.21.0-win-${arch}.zip\n`;

/** A fake world: nodejs.org, the archive tools and npm. Each writes what the real one would, in miniature. */
function fakeDeps(over: { shasums?: string; zip?: Buffer } = {}) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      download: async (url: string): Promise<Buffer> => {
        calls.push(`download ${url}`);
        if (url.endsWith("SHASUMS256.txt")) return Buffer.from(over.shasums ?? goodShasums("x64"));
        return over.zip ?? ZIP;
      },
      extractZip: async (_zip: string, into: string): Promise<void> => {
        calls.push("extractZip");
        const top = path.join(into, "node-v24.21.0-win-x64");
        fs.mkdirSync(path.join(top, "node_modules", "npm", "bin"), { recursive: true });
        fs.writeFileSync(path.join(top, "node.exe"), "MZ");
        fs.writeFileSync(path.join(top, "npm.cmd"), "@echo npm");
        fs.writeFileSync(path.join(top, "npx.cmd"), "@echo npx");
        fs.writeFileSync(path.join(top, "node_modules", "npm", "bin", "npm-cli.js"), "");
      },
      extractTgz: async (_tgz: string, into: string): Promise<void> => {
        calls.push("extractTgz");
        fs.mkdirSync(path.join(into, "package", "lib", "esm", "cli"), { recursive: true });
        fs.writeFileSync(path.join(into, "package", "package.json"),
          JSON.stringify({ name: "@svayam-opensource/gov", version: "1.2.3", bin: { gov: "./lib/esm/cli/bin.js" } }));
        fs.writeFileSync(path.join(into, "package", "lib", "esm", "cli", "bin.js"), "");
      },
      npmCi: async (dir: string): Promise<void> => {
        calls.push(`npmCi ${path.basename(dir)}`);
        assert.ok(fs.existsSync(path.join(dir, "package-lock.json")), "npm ci runs against the lockfile");
        fs.mkdirSync(path.join(dir, "node_modules", "js-yaml"), { recursive: true });
        fs.writeFileSync(path.join(dir, "node_modules", "js-yaml", "index.js"), "");
      },
      log: (): void => undefined,
    },
  };
}

function inputs(out: string, arch = "x64") {
  const src = tmp();
  fs.writeFileSync(path.join(src, "gov.tgz"), "tgz");
  fs.writeFileSync(path.join(src, "package-lock.json"), "{}");
  return { version: "1.2.3", arch, outDir: out, govTgz: path.join(src, "gov.tgz"), govLock: path.join(src, "package-lock.json"), nodeVersion: "v24.21.0" };
}

test("SHASUMS256.txt is parsed into name → hash", () => {
  const m = parseShasums(goodShasums("arm64"));
  assert.equal(m.get("node-v24.21.0-win-arm64.zip"), sha(ZIP));
  assert.equal(m.size, 2);
});

test("the zip name for each shipped arch", () => {
  assert.deepEqual([...NODE_ARCHES], ["x64", "arm64"]);
  assert.equal(nodeZipName("v24.21.0", "x64"), "node-v24.21.0-win-x64.zip");
  assert.equal(nodeZipName("24.21.0", "arm64"), "node-v24.21.0-win-arm64.zip");
  assert.throws(() => nodeZipName("v24.21.0", "ia32"), /arch/);
  assert.throws(() => nodeZipName("v22.1.0", "x64"), /Node 24/);
});

test("a checksum mismatch fails, naming the file and both hashes", () => {
  const sums = parseShasums(goodShasums("x64"));
  assert.throws(() => verifyChecksum(Buffer.from("tampered"), "node-v24.21.0-win-x64.zip", sums),
    (e: Error) => /node-v24\.21\.0-win-x64\.zip/.test(e.message) && e.message.includes(sha(ZIP)) && e.message.includes(sha("tampered")));
  assert.throws(() => verifyChecksum(ZIP, "node-v24.21.0-win-arm64.zip", sums), /not listed/);
  assert.doesNotThrow(() => verifyChecksum(ZIP, "node-v24.21.0-win-x64.zip", sums));
});

test("the build fails on a checksum mismatch, before anything is unpacked", async () => {
  const out = tmp();
  const { deps, calls } = fakeDeps({ zip: Buffer.from("tampered") });
  await assert.rejects(stage(inputs(out), deps), /checksum/i);
  assert.ok(!calls.includes("extractZip"), "nothing unpacked from an unverified archive");
  assert.ok(!fs.existsSync(path.join(out, "stage-x64", "node")), "no node\\ staged");
});

test("the staged tree: node\\, app\\, bin\\ — and nothing else at the root", async () => {
  const out = tmp();
  const { deps, calls } = fakeDeps();
  const r = await stage(inputs(out), deps);
  assert.equal(r.root, path.join(out, "stage-x64"));
  assert.deepEqual(fs.readdirSync(r.root).sort(), ["app", "bin", "node"]);
  for (const f of ["node.exe", "npm.cmd", "npx.cmd", "node_modules/npm/bin/npm-cli.js"]) {
    assert.ok(fs.existsSync(path.join(r.root, "node", f)), `node\\${f}`);
  }
  for (const f of ["package.json", "package-lock.json", "lib/esm/cli/bin.js", "node_modules/js-yaml/index.js"]) {
    assert.ok(fs.existsSync(path.join(r.root, "app", f)), `app\\${f}`);
  }
  assert.deepEqual(calls.filter((c) => !c.startsWith("download")), ["extractZip", "extractTgz", "npmCi app"]);
  assert.ok(calls.some((c) => c === "download https://nodejs.org/dist/v24.21.0/SHASUMS256.txt"));
  assert.ok(calls.some((c) => c === "download https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip"));
});

test("bin\\ holds only the launchers", async () => {
  const out = tmp();
  const r = await stage(inputs(out), fakeDeps().deps);
  assert.deepEqual(fs.readdirSync(path.join(r.root, "bin")).sort(), [...LAUNCHERS].sort());
  assert.deepEqual([...LAUNCHERS], ["gov.cmd"]);
});

test("the launcher keeps T11's contract: GOV_BIN_DIR = bin\\, node\\ first on PATH, npm's prefix = node\\", async () => {
  const out = tmp();
  const r = await stage(inputs(out), fakeDeps().deps);
  const cmd = fs.readFileSync(path.join(r.root, "bin", "gov.cmd"), "utf8");
  assert.match(cmd, /\r\n/, "CRLF — cmd.exe misreads LF batch files");
  assert.match(cmd, /^@echo off/);
  assert.match(cmd, /setlocal/i, "the PATH change stays inside gov's own process");
  assert.match(cmd, /set "GOV_BIN_DIR=%GOV_ROOT%\\bin"/);
  assert.match(cmd, /set "PATH=%GOV_ROOT%\\node;%PATH%"/);
  assert.match(cmd, /set "NPM_CONFIG_PREFIX=%GOV_ROOT%\\node"/);
  assert.match(cmd, /"%GOV_ROOT%\\node\\node\.exe" "%GOV_ROOT%\\app\\lib\\esm\\cli\\bin\.js" %\*/);
  assert.match(cmd, /exit \/b %ERRORLEVEL%/);
});

test("the launcher path comes from the package's own bin entry", async () => {
  const out = tmp();
  const { deps } = fakeDeps();
  const orig = deps.extractTgz;
  deps.extractTgz = async (tgz: string, into: string) => {
    await orig(tgz, into);
    const pj = path.join(into, "package", "package.json");
    fs.writeFileSync(pj, JSON.stringify({ name: "@svayam-opensource/gov", version: "1.2.3", bin: { gov: "./lib/cli.js" } }));
    fs.writeFileSync(path.join(into, "package", "lib", "cli.js"), "");
  };
  const r = await stage(inputs(out), deps);
  assert.match(fs.readFileSync(path.join(r.root, "bin", "gov.cmd"), "utf8"), /app\\lib\\cli\.js" %\*/);
});

test("a package whose version is not the one asked for is refused", async () => {
  const out = tmp();
  await assert.rejects(stage({ ...inputs(out), version: "1.2.4" }, fakeDeps().deps), /1\.2\.3.*1\.2\.4|1\.2\.4.*1\.2\.3/);
});

test("arm64 stages from the arm64 zip", async () => {
  const out = tmp();
  const { deps, calls } = fakeDeps({ shasums: goodShasums("arm64") });
  const orig = deps.extractZip;
  deps.extractZip = async (z: string, into: string) => {
    await orig(z, into);
    fs.renameSync(path.join(into, "node-v24.21.0-win-x64"), path.join(into, "node-v24.21.0-win-arm64"));
  };
  const r = await stage(inputs(out, "arm64"), deps);
  assert.equal(r.root, path.join(out, "stage-arm64"));
  assert.ok(calls.includes("download https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-arm64.zip"));
});

test("MSI ProductVersion is the numeric part of the package version", () => {
  assert.equal(msiVersion("1.2.3"), "1.2.3");
  assert.equal(msiVersion("1.2.3-rc.1"), "1.2.3");
  assert.equal(msiVersion("v2.0.0"), "2.0.0");
  assert.throws(() => msiVersion("256.0.0"), /255/);
  assert.throws(() => msiVersion("one"), /version/);
});

test("components fragment: one component per directory, HKCU key path, a RemoveFolder each, stable GUIDs", async () => {
  const out = tmp();
  const r = await stage(inputs(out), fakeDeps().deps);
  const a = componentsWxs(r.root);
  const b = componentsWxs(r.root);
  assert.equal(a, b, "deterministic: same tree → same source");
  assert.match(a, /<DirectoryRef Id="INSTALLFOLDER">/);
  assert.match(a, /<Directory Id="[^"]+" Name="node">/);
  assert.match(a, /<Directory Id="BINFOLDER" Name="bin">/);
  const comps = a.match(/<Component /g) ?? [];
  const dirs = a.match(/<Directory /g) ?? [];
  assert.equal(comps.length, dirs.length, "one component per directory");
  assert.equal((a.match(/<RemoveFolder /g) ?? []).length, comps.length);
  assert.equal((a.match(/<RegistryValue Root="HKCU"[^>]*KeyPath="yes"/g) ?? []).length, comps.length);
  assert.match(a, /Source="[^"]*node\.exe"/);
  // only bin\ goes on PATH, and only in the user's environment
  const env = a.match(/<Environment [^>]*\/>/g) ?? [];
  assert.equal(env.length, 1);
  assert.match(env[0], /Name="PATH"/);
  assert.match(env[0], /Value="\[BINFOLDER\]"/);
  assert.match(env[0], /System="no"/);
  assert.match(env[0], /Part="last"/);
  const guids = [...a.matchAll(/Guid="([0-9A-F-]{36})"/g)].map((m) => m[1]);
  assert.equal(new Set(guids).size, guids.length, "no GUID reused");
});

test("the build CLI names what is missing", () => {
  assert.throws(() => parseArgs([]), /--version/);
  assert.throws(() => parseArgs(["--version", "1.2.3", "--arch", "x86", "--out", "o", "--gov-tgz", "g.tgz"]), /arch/);
  const a = parseArgs(["--version", "1.2.3", "--arch", "arm64", "--out", "o", "--gov-tgz", "g.tgz"]);
  assert.equal(a.arch, "arm64");
  assert.equal(a.nodeVersion, fs.readFileSync(path.join(import.meta.dirname, "..", "node-version.txt"), "utf8").trim());
});

test("archives unpack with Windows' own bsdtar, never a GNU tar earlier on PATH (Git Bash's reads D:\\… as a remote host)", () => {
  const w = extractCommand("zip", "D:\\a\\_temp\\msi\\node.zip", "D:\\a\\_temp\\msi\\work", "win32", { SystemRoot: "C:\\Windows" });
  assert.equal(w.cmd, "C:\\Windows\\System32\\tar.exe");
  assert.deepEqual(w.args, ["-xf", "D:\\a\\_temp\\msi\\node.zip", "-C", "D:\\a\\_temp\\msi\\work"]);
  assert.equal(w.shell, false, "no shell between us and the archive path");
  assert.equal(extractCommand("tgz", "D:\\g.tgz", "D:\\w", "win32", {}).cmd, "C:\\Windows\\System32\\tar.exe");
  assert.deepEqual(extractCommand("zip", "/o/n.zip", "/o/w", "linux", {}), { cmd: "unzip", args: ["-q", "/o/n.zip", "-d", "/o/w"], shell: false });
  assert.deepEqual(extractCommand("tgz", "/o/g.tgz", "/o/w", "darwin", {}), { cmd: "tar", args: ["-xzf", "/o/g.tgz", "-C", "/o/w"], shell: false });
});
