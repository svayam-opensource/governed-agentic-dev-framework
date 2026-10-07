// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE CONTENT GOV CARRIES — what is bundled, and that it comes back byte for byte (Policy Owner, 2026-10-07, option B).
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fingerprintEntries, materializeContentBundle, readContentBundle, selectContentFiles, writeContentBundle } from "../../src/maintain/content-bundle.js";
import { contentFingerprint } from "../../src/maintain/build-identity.js";

const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));
const write = (root: string, rel: string, data: string | Buffer): void => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), data); };

function content(): string {
  const c = tmp("bundle-");
  write(c, "MANIFEST.yaml", [
    "files:",
    "  - { src: VERSION, dst: VERSION, mode: scaffold-auto }",
    "  - { src: .gitignore, dst: .gitignore, mode: seed-once }",
    "  - { src: framework/docs/, dst: framework/docs/, mode: scaffold-auto }",
    "",
  ].join("\n"));
  write(c, "VERSION", "1.2.3\n");
  write(c, ".gitignore", "work/\n");
  write(c, "framework/docs/a.md", "# a\r\n");
  write(c, "framework/docs/logo.bin", Buffer.from([0, 255, 254, 10, 13]));
  return c;
}

describe("content bundle — the framework content, and nothing else", () => {
  it("bundles MANIFEST.yaml and every file a src row covers; not unlisted files, not OS/editor litter", () => {
    const c = content();
    write(c, "notes.md", "not shipped\n");
    write(c, "framework/docs/.DS_Store", "x");
    write(c, "framework/docs/a.md.swp", "x");
    write(c, "node_modules/x/index.js", "x");
    expect(selectContentFiles(c)).to.deep.equal([".gitignore", "MANIFEST.yaml", "VERSION", "framework/docs/a.md", "framework/docs/logo.bin"]);
  });

  it("round-trips byte for byte — .gitignore (which npm never packs as a file) and binary included", () => {
    const c = content();
    const file = path.join(tmp("bundle-out-"), "content-bundle.json");
    const entries = writeContentBundle(c, file);
    const m = materializeContentBundle(file);
    try {
      for (const e of entries) expect(fs.readFileSync(path.join(m.contentDir, e.path)).equals(fs.readFileSync(path.join(c, e.path))), e.path).to.equal(true);
      expect(contentFingerprint(m.contentDir)).to.equal(fingerprintEntries(entries)).and.to.equal(contentFingerprint(c));
    } finally { m.cleanup(); }
    expect(fs.existsSync(m.contentDir)).to.equal(false);
  });

  it("refuses a bundle that is not one, or whose paths escape", () => {
    const d = tmp("bundle-bad-");
    fs.writeFileSync(path.join(d, "a.json"), "{}");
    expect(() => readContentBundle(path.join(d, "a.json"))).to.throw(/not a gov content bundle/);
    fs.writeFileSync(path.join(d, "b.json"), JSON.stringify({ format: 1, files: [{ path: "../x", text: "x" }] }));
    expect(() => readContentBundle(path.join(d, "b.json"))).to.throw(/bad path/);
  });
});
