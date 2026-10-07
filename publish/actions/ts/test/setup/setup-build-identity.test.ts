// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov setup <org>/<repo>` SEEDS FROM THIS GOV'S OWN BUILD (the rule `gov upgrade` follows — adoption walk #9).
 *
 * Setup seeded a new repository from the template copy's `publish/content` — the template's DEFAULT branch, whatever
 * build that happened to be — with no check against the gov doing the seeding. It now seeds from the content this gov
 * was built with (the template copy when it IS that build, else its checkout's own content or the template fetched at
 * its build commit — never `main`) and refuses content whose fingerprint differs.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { contentFingerprint, type BuildIdentity } from "../../src/maintain/build-identity.js";
import { selectSetupContent } from "../../src/setup/create.js";

const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));
function content(version = "1.2.3"): string {
  const c = tmp("setup-bid-");
  fs.writeFileSync(path.join(c, "MANIFEST.yaml"), "files: []\n");
  fs.writeFileSync(path.join(c, "VERSION"), `${version}\n`);
  return c;
}
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

describe("gov setup — seeds only from this gov's own build", () => {
  it("a source checkout seeds from its own content — no fetch", () => {
    const own = content();
    const id: BuildIdentity = { version: "checkout", commit: null, dirty: false, contentFingerprint: contentFingerprint(own), source: "checkout", contentDir: own };
    let fetched = false;
    const r = selectSetupContent(id, null, () => { fetched = true; throw new Error("no"); });
    expect(r.ok && r.contentDir).to.equal(own);
    expect(fetched).to.equal(false);
  });

  it("a built gov fetches the commit it was built from — never main", () => {
    const own = content();
    const id: BuildIdentity = { version: "1.2.3", commit: COMMIT, dirty: false, contentFingerprint: contentFingerprint(own), source: "build" };
    const refs: string[] = [];
    const r = selectSetupContent(id, null, (_t, ref) => { refs.push(ref); return { contentDir: own, cleanup: () => {}, commit: ref }; });
    expect(refs).to.deep.equal([COMMIT]);
    expect(r.ok).to.equal(true);
  });

  it("content from another build is refused — same VERSION or not — and nothing is seeded", () => {
    const own = content(), other = content();
    fs.writeFileSync(path.join(other, "MANIFEST.yaml"), "files: [] # main moved on\n");
    const id: BuildIdentity = { version: "1.2.3", commit: COMMIT, dirty: false, contentFingerprint: contentFingerprint(own), source: "build" };
    let cleaned = false;
    const r = selectSetupContent(id, null, () => ({ contentDir: other, cleanup: () => { cleaned = true; }, commit: COMMIT }));
    expect(r.ok).to.equal(false);
    if (!r.ok) {
      expect(r.lines[0]).to.match(/^gov setup: refused/);
      expect(r.lines.join("\n")).to.match(/Nothing was seeded/);
    }
    expect(cleaned, "the fetched copy is removed").to.equal(true);
  });

  it("the template copy is used when it IS this build — no fetch", () => {
    const copy = content();
    const id: BuildIdentity = { version: "1.2.3", commit: COMMIT, dirty: false, contentFingerprint: contentFingerprint(copy), source: "build" };
    const r = selectSetupContent(id, copy, () => { throw new Error("must not fetch"); });
    expect(r.ok && r.contentDir).to.equal(copy);
  });

  it("a template copy from another build (the template's default branch moved on) is NOT used — this build is fetched", () => {
    const own = content(), copy = content();
    fs.writeFileSync(path.join(copy, "VERSION"), "1.2.3\n# main\n");
    const id: BuildIdentity = { version: "1.2.3", commit: COMMIT, dirty: false, contentFingerprint: contentFingerprint(own), source: "build" };
    const refs: string[] = [];
    const r = selectSetupContent(id, copy, (_t, ref) => { refs.push(ref); return { contentDir: own, cleanup: () => {}, commit: ref }; });
    expect(r.ok && r.contentDir).to.equal(own);
    expect(refs).to.deep.equal([COMMIT]);
  });

  it("a gov that cannot say what it was built with seeds nothing", () => {
    const r = selectSetupContent(null, null, () => { throw new Error("unreachable"); });
    expect(r.ok).to.equal(false);
  });

  it("a fetch that fails is a refusal with the reason, not a throw", () => {
    const id: BuildIdentity = { version: "1.2.3", commit: COMMIT, dirty: false, contentFingerprint: "sha256:x", source: "build" };
    const r = selectSetupContent(id, null, () => { throw new Error("could not fetch"); });
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.lines.join("\n")).to.contain("could not fetch");
  });
});
