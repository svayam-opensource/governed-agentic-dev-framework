// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// FINDING THE PAID MODULE (spec 02 §5, S7). A fake module is planted through GOV_CHECK_PATH: it loads and activates
// when its host API fits; a major mismatch, a module that declines, or one that throws is ONE quiet line; nothing
// installed is `absent` with no line at all.
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { discoverModule, govCheckInstallDir, loadCheckModule } from "../../src/check-seam/loader.js";
import { createHost } from "../../src/check-seam/host.js";
import { HOST_API } from "../../src/check-seam/public.js";

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "gov-check-loader-"));

function plant(body: string): string {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@svayam/gov-check", type: "module", exports: { ".": { import: "./index.mjs" } } }));
  fs.writeFileSync(path.join(dir, "index.mjs"), body);
  return dir;
}

const MODULE = (major: number, activate = "return { entitlements: ['evidence'], evidenceSink: { record() {}, flush: async () => ({ ok: true }) }, actions: new Map(), catalogs: [], reports: { generate: async () => ({ ok: true, files: [], lines: [] }) }, packs: { list: () => [], proposal: () => null }, licence: { status: () => ({ state: 'licensed', entitlements: ['evidence'] }), login: async () => {} } };") =>
  `export const api = { major: ${major}, minHostMinor: 0 };\nexport async function activate(host, opts) { ${activate} }\n`;

const host = createHost({ govVersion: "2.0.0-test" });
const load = (env: Record<string, string>, extra: { govRoot?: string; installDir?: string } = {}) =>
  loadCheckModule({ env, host, opts: { surface: "local" }, govRoot: extra.govRoot ?? tmp(), installDir: extra.installDir ?? tmp() });

describe("check-seam loader (spec 02 §5, S7)", () => {
  it("GOV_CHECK_PATH → loads and activates a module whose API fits", async () => {
    const r = await load({ GOV_CHECK_PATH: plant(MODULE(HOST_API.major)) });
    expect(r.state).to.equal("active");
    if (r.state === "active") {
      expect(r.via).to.equal("GOV_CHECK_PATH");
      expect(r.module.entitlements).to.deep.equal(["evidence"]);
    }
  });

  it("a host-API major mismatch → refused with exactly one quiet line", async () => {
    const r = await load({ GOV_CHECK_PATH: plant(MODULE(HOST_API.major + 1)) });
    expect(r.state).to.equal("refused");
    if (r.state === "refused") {
      expect(r.lines).to.have.length(1);
      expect(r.lines[0]).to.match(/host API .* running without it/);
    }
  });

  it("a module that declines to start (no lease) → refused, its one line", async () => {
    const r = await load({ GOV_CHECK_PATH: plant(MODULE(HOST_API.major, "return { ok: false, lines: ['gov-check: no lease — evidence is off for this run.', 'second'] };")) });
    expect(r).to.deep.equal({ state: "refused", lines: ["gov-check: no lease — evidence is off for this run."] });
  });

  it("a module that throws, or is not a module → refused with one line, never a throw", async () => {
    const boom = await load({ GOV_CHECK_PATH: plant(MODULE(HOST_API.major, "throw new Error('kaboom\\nstack');")) });
    expect(boom.state).to.equal("refused");
    if (boom.state === "refused") expect(boom.lines).to.deep.equal(["gov-check: it failed to start (kaboom) — running without it."]);
    const junk = await load({ GOV_CHECK_PATH: plant("export const x = 1;\n") });
    expect(junk.state).to.equal("refused");
  });

  it("nothing installed → absent, no line", async () => {
    expect(await load({})).to.deep.equal({ state: "absent" });
    expect(await load({ GOV_CHECK_PATH: path.join(tmp(), "nope") })).to.deep.equal({ state: "absent" });
  });

  it("discovers the global sibling and the licence-install location — by file look-ups only", () => {
    const root = tmp();
    const govRoot = path.join(root, "node_modules", "@svayam-opensource", "gov");
    const sibling = path.join(root, "node_modules", "@svayam", "gov-check");
    fs.mkdirSync(govRoot, { recursive: true });
    fs.mkdirSync(sibling, { recursive: true });
    fs.writeFileSync(path.join(sibling, "package.json"), "{}");
    expect(discoverModule({ env: {}, govRoot, installDir: tmp() })).to.deep.equal({ entry: sibling, via: "global" });

    const inst = tmp();
    const target = path.join(inst, "node_modules", "@svayam", "gov-check");
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "package.json"), "{}");
    expect(discoverModule({ env: {}, govRoot: tmp(), installDir: inst })).to.deep.equal({ entry: target, via: "licence-install" });
  });

  it("the licence-install location follows the platform's data folder, and GOV_CHECK_HOME overrides it", () => {
    expect(govCheckInstallDir({}, "linux", "/home/a")).to.equal(path.join("/home/a", ".local", "share", "gov", "gov-check"));
    expect(govCheckInstallDir({ XDG_DATA_HOME: "/x" }, "darwin", "/home/a")).to.equal(path.join("/x", "gov", "gov-check"));
    expect(govCheckInstallDir({ LOCALAPPDATA: "C:\\L" }, "win32", "C:\\U")).to.equal(path.join("C:\\L", "gov", "gov-check"));
    expect(govCheckInstallDir({ GOV_CHECK_HOME: "/opt/gc" }, "linux", "/home/a")).to.equal("/opt/gc");
  });
});
