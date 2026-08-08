// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { bumpVersion } from "../../src/maintain/bump-version.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import { px } from "../helpers/paths.js";

/** An in-memory Fs over a repo-relative path → content map. */
function memFs(files: Record<string, string>) {
  const store = { ...files };
  const rel = (p: string) => px(p).replace(/^\/repo\//, "");
  const fs: Fs = {
    pathExists: (p) => px(rel(p)) in store,
    readFile: (p) => store[rel(p)] ?? null,
    writeFile: (p, c) => { store[rel(p)] = c; },
    mkdirp: () => {},
    rm: () => {},
    readdir: () => [],
  };
  return { fs, store };
}

const PKG = "publish/actions/ts/package.json";
const VERSION = "publish/content/VERSION";

describe("gov-work — bumpVersion (CLI package + content VERSION)", () => {
  it("writes the version to the CLI package + content/VERSION, preserving package.json formatting", () => {
    const { fs, store } = memFs({ [PKG]: '{\n  "name": "x",\n  "version": "0.7.4",\n  "type": "module"\n}\n' });
    const r = bumpVersion(fs, "/repo", "0.8.0");
    expect(r.ok).to.equal(true);
    if (r.ok) expect(r.written).to.have.lengthOf(2);
    // only the version value changed; the rest of package.json is intact
    expect(store[PKG]).to.equal('{\n  "name": "x",\n  "version": "0.8.0",\n  "type": "module"\n}\n');
    expect(store[VERSION]).to.equal("0.8.0\n");
  });

  it("accepts a pre-release and rejects a non-version", () => {
    const { fs } = memFs({ [PKG]: '{"version":"1.0.0"}' });
    expect(bumpVersion(fs, "/repo", "1.2.3-rc.1").ok).to.equal(true);
    expect(bumpVersion(fs, "/repo", "1.2")).to.include({ ok: false, code: 2 });
    expect(bumpVersion(fs, "/repo", "latest")).to.include({ ok: false, code: 2 });
  });

  it("errors on a missing CLI package.json or missing version field", () => {
    expect(bumpVersion(memFs({}).fs, "/repo", "1.0.0").ok).to.equal(false);
    expect(bumpVersion(memFs({ [PKG]: "{}" }).fs, "/repo", "1.0.0").ok).to.equal(false);
  });
});
